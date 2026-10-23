import { Time, type GameObject } from '@arc-director/kindling';
import { parseArc, pascalCase, STOCK_COLLECTIVE_VERBS, STOCK_FORMATION_VERBS, ArcDirector, type Kit } from 'arc-director';
import { MarketNPC, MarketGate, Merchant, Wanted } from '../../engine/components';
import { CharacterMotor } from '../../characters/CharacterMotor';
import { NPCInput } from '../../characters/NPCInput';
import { compactName, distXZ, findCarried, itemMatchesName, tryInsert } from '../../items/inventory';
import { dropItem, USE_RANGE } from '../../items/pickup';
import type { GameHost, CharacterCtx } from '../adapter';
import { customerCount, guardPost, spawnRandomCustomer, MARKET_SEEDS, HIVE_UNITS, GUARD_UNITS } from '../market';
import { squareList } from '../../items/wares';
import { coinsOf } from '../../items/wallet';
import { idOf, findObject } from '../names';
import { takeSome } from '../items';
import { BODY_VERBS, GAME_VERBS, reportTheft, stealVerb } from '../verbs';
import { showSpeech } from '../playerTalk';
import { answerCries, noteSecurityCry } from '../alarm';
import { Alarm } from '../../engine/components';

const nextMarketNPCTimestamp = new WeakMap<GameHost, number>();

/** How close to the gate counts as having walked out. A plain go_to stops about a meter short, and a new arrival stands four meters inside. */
const DOORWAY = 1.2;

/** How long a shopper strolls before the next look around, unless the hive sends them somewhere. */
const BROWSE = 16;

/** How long a shopper stands, when the next gap is an idle one. */
const IDLE_FOR = [5, 14];

/** A stroll through the square. Default CharacterMotor is 3.4. */
const MARKET_WALK = 1.7;

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
		const mind = host.arc?.character(who);
		if (mind) {
			mind.tags = mind.tags.filter((tag) => tag !== 'wanting');
		}
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

const gated = new WeakSet<GameHost>();

/**
 * Each gate's threshold, a region: any shopper is gone the moment it steps onto it. On the threshold, not merely near
 * it: a new arrival stands four meters inside. A wanted thief is stopped there, beside the guard, until caught. Once,
 * as soon as the gates have loaded with their chunks.
 */
function addGateExits(host:GameHost):void {
	const director = host.arc;
	if (!director || gated.has(host)) {
		return;
	}
	// What each shopper walked in with. Read again every tick, so a purchase shows, and only while they are in the square.
	director.addRegion('purses', {
		from: [-Infinity, -Infinity],
		to: [Infinity, Infinity],
		who: ({ character }) => character.getComponent(MarketNPC)?.kind === 'customer',
		memory: ({ character }) => {
			const wants = character.getComponent(MarketNPC)?.wants ?? [];
			const gold = `${coinsOf(character)} gold`;
			return wants.length > 0 ? `carrying ${gold}, looking for ${wants.join(' and ')}` : `carrying ${gold}, done looking`;
		},
	});
	host.world.forEachComponent(MarketGate, (_exit, gate) => {
		gated.add(host);
		const name = idOf(gate);
		const { x, z } = gate.transform.position;
		director.addRegion(`${name}Threshold`, {
			center: [x, z],
			radius: DOORWAY,
			who: ({ character }) => character.getComponent(MarketNPC)?.kind === 'customer' && !character.getComponent(Wanted)?.enabled,
			onEnter: ({ character }) => despawn(host, character),
		});
	});
}

/** CharacterMotor's own walk, m/s. NPCs in this scene use {@link MARKET_WALK} instead. */
const PLAYER_WALK = 3.4;

/** Shoppers, sellers and guards, every tick, so a new arrival is paced on the next one. The player keeps the normal walk. */
function paceMarket(host:GameHost):void {
	for (const go of host.world.objects) {
		const motor = go.getComponent(CharacterMotor);
		if (motor) {
			motor.maxSpeed = go.id === 'Player' ? PLAYER_WALK : MARKET_WALK;
		}
	}
}

/**
 * A shopper with nothing else to do either strolls or stands, about half the time each. Anything already running is
 * left alone: an order to a stall, a haggle, the walk out. Not a law, because a law that stays true would take the
 * stall order back.
 */
function browse(host:GameHost):void {
	host.world.forEachComponent(MarketNPC, (npc, go) => {
		if (npc.kind !== 'customer' || npc.wants.length === 0) {
			return;
		}
		const character = host.arc?.character(idOf(go));
		if (!character || character.arc) {
			return;
		}
		const idle = Math.random() < 0.5;
		const seconds = idle ? IDLE_FOR[0] + Math.floor(Math.random() * (IDLE_FOR[1] - IDLE_FOR[0] + 1)) : BROWSE;
		void character.enact(parseArc(idle ? `wait(seconds=${seconds})` : `wander(seconds=${seconds})`, character.verbs));
	});
}

function tickMarketNPC(host:GameHost):void {
	paceMarket(host);
	addGateExits(host);
	browse(host);
	seizeNearby(host);
	answerCries(host);
	const due = nextMarketNPCTimestamp.get(host) ?? 12;
	if (Time.time < due) {
		return;
	}
	nextMarketNPCTimestamp.set(host, Time.time + 1 + Math.random() * 2);
	if (customerCount(host.world) >= 14) {
		return;
	}
	if (Math.random() < 0.2) {
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
	});
	if (!host.arc?.ready) {
		return;
	}
	host.arc.collective('MarketHive')?.addCharacter({ id: spawned.id, tags: spawned.tags, kit: HIVE_KIT });
	spawned.go.getComponent(NPCInput)!.aiOn = true;
}

/** The market's laws are the scene's: its minds step in with orders, and nobody writes laws. */
const MARKET_VERBS = GAME_VERBS.filter((verb) => verb !== 'law' && verb !== 'unlaw');

/** Shoppers walk, buy, and leave. No formations: a crowd verb is how a whole stall gets mobbed. */
const HIVE_KIT:Kit = { verbs: [...MARKET_VERBS, 'offer', 'steal'] };

/** What the market's minds order their people with. No formations: neither shoppers nor guards march. */
const ORDERS = STOCK_COLLECTIVE_VERBS.filter((verb) => !(STOCK_FORMATION_VERBS as readonly string[]).includes(verb));

/** Guards walk, talk, and wait. They do not trade or steal. `stand` is their post beside the door. */
const GUARD_KIT:Kit = { verbs: [...MARKET_VERBS, 'stand'] };

/** Every market mind. Recall is how it reads the trade ledger. */
const LEDGER_NOTE = 'The ledger of who gave or traded what, from whom, to whom, in what quantity, and for what, is your memory. Whenever any of that is in doubt, call recall. That is how you read the ledger. Never guess a trade.';

export function createDirector(host:GameHost):ArcDirector<CharacterCtx> {
	host.hooks = {
		allowTheft: true,
		afterPickUp,
		tickMarketNPC,
		onSpoke: noteSecurityCry,
	};
	const hiveKit = { verbs: [...MARKET_VERBS, ...ORDERS, 'offer', 'steal'] };
	const guardVoice = { verbs: [...MARKET_VERBS, ...ORDERS] };
	const d = host.configure(new ArcDirector<CharacterCtx>())
		.withRPG({ ...BODY_VERBS, steal: stealVerb(host) })
		.withSight({ limit: 16 })
		.withSystemNote(LEDGER_NOTE)
		.addVerb('stand', {
			args: {},
			help: 'a guard walks to their side of the gate, beside the doorway',
			handler: (call) => {
				const post = guardPost(call.ctx.world, call.ctx.character);
				if (!post) {
					return { ok: false, verb: 'stand', reason: 'no gate to hold' };
				}
				return call.goToPoint([post.x, post.z], { within: 0.35 });
			},
		})
		.addCollective({
			id: 'MarketHive',
			kit: hiveKit,
			// One shopper per order. A filter such as units.filter("Shopper") would march the whole square.
			maxUnitsPerIssue: 1,
			identity: { role: 'Hive', traits: ['busy', 'fair', 'thrifty', 'watchful'] },
			// They stroll on their own. The game's minds skip the heartbeat unless asked: this one thinks on it, about whom to send and what to offer.
			mind: { skipStart: true, skipStrategic: true, skipMajor: true, skipHeartbeat: false },
			goals: [{
				text: 'Shoppers look around and buy what they came for when the price suits them, then leave by their own gate.',
				priority: 2,
			}],
			// A pinned memory replaces the one with its first two tags: each line its own second tag.
			memories: Object.entries({
				self: 'I am the canal-market hive, the shoppers\' one mind, not a person in the square.',
				canal: 'A canal runs east to west through the middle of the market, crossed by three footbridges.',
				squares: `${squareList()}.`,
				tags: 'Each shopper is tagged Shopper and wanting, with each good it still wants and the gate it leaves by. The wanting tag comes off with the last of those, and then they walk to that gate on their own.',
				others: 'The sellers keep their own stalls and think for themselves; the Guards hold the gates. A seller answers a low offer themselves.',
			}).map(([key, text]) => ({ text, tags: ['backstory', key], pinned: true })),
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
			}, {
				// The want tag comes off with the last purchase. The watch stays true the whole walk, or the law would abort it.
				name: 'leave-east',
				who: 'units.filter("EastGate")',
				watch: '!(me is "wanting")',
				arc: 'go_to(EastGate)',
				pinned: true,
			}, {
				name: 'leave-west',
				who: 'units.filter("WestGate")',
				watch: '!(me is "wanting")',
				arc: 'go_to(WestGate)',
				pinned: true,
			}],
		})
		.addCollective({
			id: 'Guards',
			kit: guardVoice,
			mind: { skipStart: true, skipMajor: true },
			identity: { role: 'Watch', traits: ['stern', 'alert'] },
			goals: [{
				text: 'Keep the market safe: thieves caught, cries answered, gates held.',
				priority: 2,
			}],
			memories: Object.entries({
				self: 'I am the market watch, the guards\' one mind, not a person in the square.',
				gates: 'Holt keeps WestGate and Brant keeps EastGate, each beside the doorway so the way through stays clear.',
				cries: 'A guard who reaches someone who cried out asks what happened before doing anything else.',
			}).map(([key, text]) => ({ text, tags: ['backstory', key], pinned: true })),
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
