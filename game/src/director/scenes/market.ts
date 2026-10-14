import { Time, type GameObject } from '@arc-director/kindling';
import { pascalCase, STOCK_COLLECTIVE_VERBS, ArcDirector, type Kit, type LawSpec } from 'arc-director';
import { MarketNPC, MarketGate, Merchant, Wanted } from '../../engine/components';
import { NPCInput } from '../../characters/NPCInput';
import { compactName, distXZ, findCarried, itemMatchesName, tryInsert } from '../../items/inventory';
import { dropItem, USE_RANGE } from '../../items/pickup';
import type { GameHost, CharacterCtx } from '../adapter';
import { customerCount, guardPost, spawnRandomCustomer, MARKET_SEEDS, HIVE_UNITS, GUARD_UNITS } from '../market';
import { priceList, STALLS } from '../../items/wares';
import { idOf, findObject } from '../names';
import { takeSome } from '../items';
import { reportTheft, addStealVerb, GAME_VERBS } from '../verbs';
import { showSpeech } from '../playerTalk';
import { answerCries, noteSecurityCry } from '../alarm';
import { Alarm } from '../../engine/components';

const nextMarketNPCTimestamp = new WeakMap<GameHost, number>();

/** How close to the gate counts as having walked out. Wider than a shopper's arrival step (0.45). */
const DOORWAY = 0.8;

/**
 * Every shopper who still wants this good walks to the stall and pays the vendor's standing price. The tag is the
 * live want: a trade takes it off.
 */
function shopErrand(name:string, good:string, stall:string, vendor:string, ask:number):LawSpec[] {
	const wanting = `units.filter("${good}")`;
	return [{
		name,
		who: wanting,
		watch: `not(some(me.inventory.filter("${good}")))`,
		arc: `go_to(${stall}) && offer(to=${vendor}, give={"gold":${ask}}, get={"${good}":1}) && leave()`,
		pinned: true,
	}];
}

function stallOwner(host:GameHost, itemName:string):GameObject | undefined {
	let owner:GameObject | undefined;
	host.world.forEachComponent(Merchant, (shop, go) => {
		if (shop.goods.some((good) => compactName(good) === compactName(itemName))) {
			owner = go;
		}
	});
	return owner;
}

function afterPickUp(host:GameHost, character:GameObject, name:string):void {
	if (character.getComponent(MarketNPC)?.kind === 'guard') {
		return;
	}
	const owner = stallOwner(host, name);
	if (!owner) {
		return;
	}
	if (idOf(character) === idOf(owner)) {
		return;
	}
	reportTheft(host, character, name, idOf(owner), 'took unpaid stall goods');
}

function despawn(host:GameHost, go:GameObject):void {
	const id = idOf(go);
	host.arc?.removeCharacter(id);
	host.world.remove(go);
	host.arc?.pushEvent({
		kind: 'Left',
		text: `${id} left through the gate`,
		tags: [id, 'gate'],
		major: true,
	});
	host.world.setMessage(`${id} left the market`);
}

function catchThief(host:GameHost, guard:GameObject, thief:GameObject):void {
	const mark = thief.getComponent(Wanted);
	if (!mark?.enabled) {
		return;
	}
	const seized:string[] = [];
	for (const name of [...mark.items]) {
		const stock = findCarried(thief, (it) => itemMatchesName(it, name));
		if (!stock) {
			continue;
		}
		const gift = takeSome(thief, stock);
		const owner = (mark.fromID ? findObject(host.world, mark.fromID) : undefined) ?? stallOwner(host, gift.name);
		if (owner && owner !== guard && tryInsert(owner, gift)) {
			seized.push(pascalCase(gift.name) || gift.name);
			continue;
		}
		if (!tryInsert(guard, gift)) {
			dropItem(guard, gift);
		}
		seized.push(pascalCase(gift.name) || gift.name);
	}
	mark.enabled = false;
	mark.items = [];
	mark.reason = '';
	const alarm = thief.getComponent(Alarm);
	if (alarm) {
		alarm.enabled = false;
	}
	const who = idOf(thief);
	const watch = idOf(guard);
	const loot = seized.length > 0 ? seized.join(' and ') : 'the goods';
	showSpeech(host, guard, `That's stolen. ${loot} goes back.`);
	host.arc?.pushEvent({
		kind: 'Caught',
		text: `${watch} caught ${who} and took ${loot} back`,
		tags: ['steal', watch, who],
		major: true,
	});
	host.world.setMessage(`${watch} caught ${who} stealing`);
	const npc = thief.getComponent(MarketNPC);
	if (npc?.kind === 'customer') {
		npc.wants = [];
		npc.leaving = true;
	}
}

function seizeNearby(host:GameHost):void {
	host.world.forEachComponent(MarketNPC, (npc, guard) => {
		if (npc.kind !== 'guard') {
			return;
		}
		host.world.forEachComponent(Wanted, (mark, thief) => {
			if (!mark.enabled) {
				return;
			}
			if (distXZ(guard, thief) <= USE_RANGE) {
				catchThief(host, guard, thief);
			}
		});
	});
}

const wokeHive = new WeakSet<GameHost>();

function wakeHive(host:GameHost):void {
	if (wokeHive.has(host) || !host.arc?.ready) {
		return;
	}
	wokeHive.add(host);
	host.arc.mindQueue()?.enqueueMajor('MarketHive', true);
}

function tickMarketNPC(host:GameHost):void {
	wakeHive(host);
	seizeNearby(host);
	answerCries(host);
	const doomed:GameObject[] = [];
	host.world.forEachComponent(MarketGate, (exit, gate) => {
		host.world.forEachComponent(MarketNPC, (npc, go) => {
			if (npc.kind !== 'customer') {
				return;
			}
			if (go.getComponent(Wanted)?.enabled) {
				return;
			}
			if (npc.leaveGate && idOf(gate) !== npc.leaveGate) {
				return;
			}
			// On the threshold, not merely near it: a new arrival stands two meters inside.
			if (distXZ(go, gate) <= DOORWAY) {
				doomed.push(go);
			}
		});
	});
	for (const go of doomed) {
		despawn(host, go);
	}
	const due = nextMarketNPCTimestamp.get(host) ?? 12;
	if (Time.time < due) {
		return;
	}
	nextMarketNPCTimestamp.set(host, Time.time + 10 + Math.random() * 12);
	if (customerCount(host.world) >= 10) {
		return;
	}
	if (Math.random() < 0.35) {
		return;
	}
	const spawned = spawnRandomCustomer(host.world);
	if (!spawned) {
		return;
	}
	host.arc?.pushEvent({
		kind: 'Arrived',
		text: `${spawned.id} arrived from the street`,
		tags: [spawned.id, 'market'],
		major: true,
	});
	if (!host.arc?.ready) {
		return;
	}
	host.arc.collective('MarketHive')?.addCharacter({ id: spawned.id, tags: spawned.tags, kit: HIVE_KIT });
	spawned.go.getComponent(NPCInput)!.aiOn = true;
}

/** What anyone at the market may do. */
const MARKET_VERBS = [...GAME_VERBS, 'offer', 'steal'];

/** Shoppers walk, buy, and leave. No formations: a crowd verb is how a whole stall gets mobbed. */
const HIVE_KIT:Kit = { verbs: [...MARKET_VERBS, 'leave'] };

/** Guards walk, talk, and wait. They do not trade or steal. `stand` is their post beside the door. */
const GUARD_KIT:Kit = { verbs: [...GAME_VERBS, 'stand'] };

/** Every market mind. Recall is how it reads the trade ledger. */
const LEDGER_NOTE = 'The ledger of who gave or traded what, from whom, to whom, in what quantity, and for what, is your memory. Whenever any of that is in doubt, call recall. That is how you read the ledger. Never guess a trade.';

export function createDirector(host:GameHost):ArcDirector<CharacterCtx> {
	host.hooks = {
		allowTheft: true,
		afterPickUp,
		tickMarketNPC,
		onSpoke: noteSecurityCry,
	};
	host.kit = { verbs: [...MARKET_VERBS] };
	const hiveKit = { verbs: [...GAME_VERBS, ...STOCK_COLLECTIVE_VERBS, 'offer', 'steal'] };
	const guardVoice = { verbs: [...GAME_VERBS, ...STOCK_COLLECTIVE_VERBS] };
	const d = addStealVerb(host.configure(new ArcDirector<CharacterCtx>()), host)
		.withSight({ limit: 16 })
		.withDefaultKit(host.kit)
		.withSystemNote(LEDGER_NOTE)
		.addVerb('leave', {
			args: {},
			help: 'a shopper walks out through their own gate once they have everything they came for',
			handler: (call) => {
				const npc = call.ctx.character.getComponent(MarketNPC);
				if (npc?.kind !== 'customer' || !npc.leaveGate) {
					return { ok: false, verb: 'leave', reason: 'nowhere to leave' };
				}
				if (npc.wants.length > 0) {
					return { ok: true, verb: 'leave', reason: 'still shopping' };
				}
				return call.goTo(npc.leaveGate, 0.45);
			},
		})
		.addVerb('stand', {
			args: {},
			help: 'a guard walks to their side of the gate, beside the doorway',
			handler: (call) => {
				const post = guardPost(call.ctx.world, call.ctx.character);
				if (!post) {
					return { ok: false, verb: 'stand', reason: 'no gate to hold' };
				}
				return call.goToPoint([post.x, post.z], 0.35);
			},
		})
		.addCollective({
			id: 'MarketHive',
			kit: hiveKit,
			// An issued choose uses the local model, whatever the menu's default.
			systemOne: 'local',
			identity: { role: 'Hive', traits: ['busy', 'fair', 'watchful'] },
			goals: [{
				text: 'Keep the square moving: shoppers get what they came for and leave.',
				priority: 2,
			}],
			memories: [{
				text: `I am the canal-market hive. I am not a character in this scene. A canal runs east to west through the middle, crossed by three footbridges. BakerStall WeaverStall and WestGate are on the north square; PotterStall CutlerStall and EastGate are on the south square. ${priceList()}. Shoppers are tagged Shopper plus what they still want and their leave gate (EastGate or WestGate). Baker Weaver Potter Cutler never leave their stalls. Shoppers already walk to the stall that sells their tag as soon as they arrive, buy that good at the posted price, then leave by their own gate once they hold it. Never issue go_to, follow, or offer to a shopper, and never to a whole units.filter("Loaf") or any other group. Do not line shoppers up. Do not send the stall keepers anywhere. The Guards collective holds the gates; leave them be. Names, never coordinates. Trades live in memory: call recall to read who gave or traded what.`,
				tags: ['backstory', 'market'],
				pinned: true,
			}],
			pinnedSightFocus: ['isHurt(it)', 'isNear(it, Player)'],
			pinnedWatches: {
				theft: 'some(events.filter("theft"))',
			},
			characters: HIVE_UNITS.map((unit) => ({ ...unit, kit: HIVE_KIT })),
			laws: [{
				name: 'flee',
				who: 'units.filter("Shopper")',
				watch: 'isHurt(me)',
				arc: 'go_to(WestGate)',
				pinned: true,
			},
			...STALLS.flatMap((stall) => stall.wares.flatMap((ware) => shopErrand(ware.defID, ware.name, stall.stall, stall.vendor, ware.ask))),
			],
		})
		.addCollective({
			id: 'Guards',
			kit: guardVoice,
			// Standing `choose` picks hold, chase, or answer with the local model, whatever the menu's default.
			systemOne: 'local',
			mind: { skipStart: true, skipMajor: true },
			identity: { role: 'Watch', traits: ['stern', 'alert'] },
			goals: [{
				text: 'Hold the gates. Chase a thief. Run to anyone who cries a security word.',
				priority: 2,
			}],
			memories: [{
				text: 'I am the market watch, not a person in the square. Holt and Pike stand on either side of WestGate, never in the doorway. Brant and Cass stand on either side of EastGate the same way. A security word is theft, thief, thieves, stole, stolen, stealing, steal, robbed, robbery, robber, mugged, mugging, or help. Each guard already chases a thief and runs to a cry; I do not issue them a path for that. A thief outranks a cry. When a guard reaches the crier, they ask who stole, or what is needed if the word was help.',
				tags: ['backstory', 'guard'],
				pinned: true,
			}],
			characters: GUARD_UNITS.map((unit) => ({ ...unit, kit: GUARD_KIT })),
			laws: [{
				name: 'chase',
				who: 'units',
				watch: 'some(others.filter("thief"))',
				arc: 'go_to(others.filter("thief").minBy(u => distance(me, u)))',
				pinned: true,
			}, {
				name: 'answer',
				who: 'units',
				watch: 'some(others.filter("alarm"))',
				arc: 'go_to(others.filter("alarm").minBy(u => distance(me, u)))',
				pinned: true,
			}],
		});
	for (const seed of MARKET_SEEDS) {
		d.addCharacter(seed);
	}
	return d;
}
