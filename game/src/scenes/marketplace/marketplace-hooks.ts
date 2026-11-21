import { Time, distanceXZ, type GameObject } from '@arc-director/kindling';
import { parseArc, pascalCase, STOCK_COLLECTIVE_VERBS, STOCK_FORMATION_VERBS, type ArcDirector, type Kit } from 'arc-director';
import { MarketplaceNPC, MarketplaceGate, Merchant, Wanted, idOf } from '../../engine/components';
import { CharacterMotor } from '../../characters/CharacterMotor';
import { compactName, findCarried, itemMatchesName, tryInsert } from '../../items/inventory';
import { dropItem, USE_RANGE } from '../../items/pickup';
import type { GameHost, CharacterCtx } from '../../director/adapter';
import type { SceneHooks } from '../../director/game-types';
import { customerCount, guardPost, spawnRandomCustomer, MARKETPLACE_CAST, SELLER_MEMORIES } from './marketplace-hive';
import { squareList } from './wares';
import { mindsOf } from '../scene';
import { coinsOf } from '../../items/wallet';
import { findObject } from '../../director/names';
import { takeSome } from '../../director/items';
import { BODY_VERBS, GAME_VERBS, markThief, REST_VERBS } from '../../director/game-verbs';
import { showSpeech } from '../../director/player-talk';
import { answerCries, noteSecurityCry } from './marketplace-alarm';
import { Alarm } from '../../engine/components';

/** What the marketplace keeps as it runs, saved with the game: when the next shopper may walk in. */
type Marketplace = { nextCustomerAt:number };

/** How close to the gate counts as having walked out. A plain go_to stops about a meter short, and a new arrival stands four meters inside. */
const DOORWAY = 1.2;

/** How long a shopper strolls before the next look around, unless the hive sends them somewhere. */
const BROWSE = 16;

/** How long a shopper stands, when the next gap is an idle one. */
const IDLE_FOR = [5, 14];

/** A stroll through the square. Default CharacterMotor is 3.4. */
const MARKETPLACE_WALK = 1.7;

function stallOwner(host:GameHost, itemName:string):GameObject | undefined {
	let owner:GameObject | undefined;
	host.world.forEachComponent(Merchant, (shop, go) => {
		if (shop.goods.some((good) => compactName(good) === compactName(itemName))) {
			owner = go;
		}
	});
	return owner;
}

/** Stall goods taken unpaid are stolen: the taker is wanted, and everyone hears of it. */
function afterPickUp(host:GameHost, character:GameObject, name:string):void {
	const [who, owner] = [idOf(character), stallOwner(host, name)];
	if (owner && who !== idOf(owner) && markThief(host, character, name, idOf(owner), 'took unpaid stall goods')) {
		host.arc?.pushEvent({ kind: 'Theft', text: `${who} took unpaid stall goods: ${name} from ${idOf(owner)}`, tags: ['steal', name, who, idOf(owner)], major: true });
	}
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
	host.world.setMessage(`${id} left the marketplace`);
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
	const npc = thief.getComponent(MarketplaceNPC);
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
	host.world.forEachComponent(MarketplaceNPC, (npc, guard) => {
		if (npc.kind !== 'guard') {
			return;
		}
		host.world.forEachComponent(Wanted, (mark, thief) => {
			if (!mark.enabled) {
				return;
			}
			if (distanceXZ(guard, thief) <= USE_RANGE) {
				catchThief(host, guard, thief);
			}
		});
	});
}

/**
 * Any shopper on a gate's threshold is gone: on it, not merely near it, since a new arrival stands four meters inside.
 * A wanted thief is stopped there, beside the guard, until caught.
 */
function exitGates(host:GameHost):void {
	const gone:GameObject[] = [];
	host.world.forEachComponent(MarketplaceGate, (exit, gate) => host.world.forEachComponent(MarketplaceNPC, (npc, go) => {
		if (npc.kind === 'customer' && !go.getComponent(Wanted)?.enabled && distanceXZ(go, gate) <= DOORWAY) {
			gone.push(go);
		}
	}));
	gone.forEach((go) => despawn(host, go));
}
/** CharacterMotor's own walk, m/s. NPCs in this scene use {@link MARKETPLACE_WALK} instead. */
const PLAYER_WALK = 3.4;

/** Shoppers, sellers and guards, every tick, so a new arrival is paced on the next one. The player keeps the normal walk. */
function paceMarketplace(host:GameHost):void {
	for (const go of host.world.objects) {
		const motor = go.getComponent(CharacterMotor);
		if (motor) {
			motor.maxSpeed = go.id === 'Player' ? PLAYER_WALK : MARKETPLACE_WALK;
		}
	}
}

/**
 * A shopper with nothing else to do either strolls or stands, about half the time each. Anything already running is
 * left alone: an order to a stall, a haggle, the walk out. Not a law, because a law that stays true would take the
 * stall order back.
 */
function browse(host:GameHost):void {
	host.world.forEachComponent(MarketplaceNPC, (npc, go) => {
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

function tickMarketplaceNPC(host:GameHost):void {
	paceMarketplace(host);
	exitGates(host);
	browse(host);
	seizeNearby(host);
	answerCries(host);
	const state = host.sceneState<Marketplace>();
	if (Time.time < (state.nextCustomerAt ?? 12)) {
		return;
	}
	state.nextCustomerAt = Time.time + 1 + Math.random() * 2;
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
		tags: [spawned.id, 'marketplace'],
	});
	if (!host.arc) {
		return;
	}
	host.arc.collective('MarketplaceHive')?.addCharacter({ id: spawned.id, tags: spawned.tags, kit: HIVE_KIT });
}

/** The marketplace's laws are the scene's: its minds step in with orders, and nobody writes laws. */
const MARKETPLACE_VERBS = GAME_VERBS.filter((verb) => verb !== 'law' && verb !== 'unlaw');

/** Shoppers walk, buy, and leave. No formations: a crowd verb is how a whole stall gets mobbed. */
const HIVE_KIT:Kit = { verbs: [...MARKETPLACE_VERBS, 'offer', 'steal', 'sit'] };

/** What the marketplace's minds order their people with. No formations: neither shoppers nor guards march. */
const ORDERS = STOCK_COLLECTIVE_VERBS.filter((verb) => !(STOCK_FORMATION_VERBS as readonly string[]).includes(verb));

/** Guards walk, talk, and wait. They do not trade or steal. `stand` is their post beside the door. */
const GUARD_KIT:Kit = { verbs: [...MARKETPLACE_VERBS, 'stand'] };

/** Every marketplace mind. Recall is how it reads the trade ledger. */
const LEDGER_NOTE = 'The ledger of who gave or traded what, from whom, to whom, in what quantity, and for what, is your memory. Whenever any of that is in doubt, call recall. That is how you read the ledger. Never guess a trade.';

export const MARKETPLACE_HOOKS:SceneHooks<GameHost> = { allowTheft: true, afterPickUp, tick: tickMarketplaceNPC, onSpoke: noteSecurityCry };

/** The sellers', the hive's and the guards' minds, their verbs and the gates' regions, onto the host's director. */
export function directMarketplace(host:GameHost, director:ArcDirector<CharacterCtx, GameObject>):ArcDirector<CharacterCtx, GameObject> {
	const hiveKit = { verbs: [...MARKETPLACE_VERBS, ...ORDERS, 'offer', 'steal', 'sit'] };
	const guardVoice = { verbs: [...MARKETPLACE_VERBS, ...ORDERS] };
	const d = director
		.withRPG({ ...BODY_VERBS, ...REST_VERBS })
		.withStealing()
		.withSight({ limit: 16 })
		.withMind({ systemNote: LEDGER_NOTE })
		// What each shopper walked in with. Read again every tick, so a purchase shows, and only while they are in the square.
		.addRegions({ purses: {
			from: [-Infinity, -Infinity],
			to: [Infinity, Infinity],
			who: ({ character }) => character.getComponent(MarketplaceNPC)?.kind === 'customer',
			memory: ({ character }) => {
				const wants = character.getComponent(MarketplaceNPC)?.wants ?? [];
				const gold = `${coinsOf(character)} gold`;
				return wants.length > 0 ? `carrying ${gold}, looking for ${wants.join(' and ')}` : `carrying ${gold}, done looking`;
			},
		} })
		.withVerbs((v) => v.add('stand', {
			args: {},
			help: 'a guard walks to their side of the gate, beside the doorway',
			handler: (call) => {
				const post = guardPost(call.ctx.world, call.ctx.character);
				if (!post) {
					return { status: 'failed', verb: 'stand', reason: 'no gate to hold' };
				}
				return call.goToPoint([post.x, post.z], { within: 0.35 });
			},
		}))
		.addCollective({
			id: 'MarketplaceHive',
			kit: hiveKit,
			// One shopper per order. A filter such as units.filter("Shopper") would march the whole square.
			maxUnitsPerCommand: 1,
			identity: { role: 'Hive', traits: ['busy', 'fair', 'thrifty', 'watchful'] },
			// They stroll on their own. It rethinks on the timer, about whom to send and what to offer.
			mind: { skipStrategic: true, skipMajor: true },
			goals: [{
				text: 'Shoppers look around and buy what they came for when the price suits them, then leave by their own gate.',
				priority: 2,
			}, {
				text: 'Shoppers talk with each other as they browse. When two stand near each other, order one to say a line to the other, and the other to answer it a little later, both in the same think. They talk as townsfolk of a fantasy marketplace would: prices and haggling, the harvest, the weather on the canal, news off the road, a guild quarrel, a rumor from the keep. One plain sentence each, in their own voice, never about the hive.',
				priority: 1,
			}],
			// A pinned memory replaces the one with its first two tags: each line its own second tag.
			memories: Object.entries({
				self: 'I am the canal-marketplace hive, the shoppers\' one mind, not a person in the square.',
				canal: 'A canal runs east to west through the middle of the marketplace, crossed by three footbridges.',
				squares: `${squareList()}.`,
				tags: 'Each shopper is tagged Shopper and wanting, with each good it still wants and the gate it leaves by. The wanting tag comes off with the last of those, and then they walk to that gate on their own.',
				others: 'The sellers keep their own stalls and have their own mind, the Sellers; the Guards hold the gates. A seller answers a low offer themselves.',
			}).map(([key, text]) => ({ text, tags: ['backstory', key], pinned: true })),
			pinnedSightFocus: ['isHurt(it)', 'isNear(it, Player)'],
			pinnedWatches: {
				theft: 'some(events.filter("theft"))',
			},
			characters: mindsOf(MARKETPLACE_CAST, 'MarketplaceHive').map((unit) => ({ ...unit, kit: HIVE_KIT })),
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
			mind: { skipMajor: true },
			identity: { role: 'Watch', traits: ['stern', 'alert'] },
			goals: [{
				text: 'Keep the marketplace safe: thieves caught, cries answered, gates held.',
				priority: 2,
			}],
			memories: Object.entries({
				self: 'I am the marketplace watch, the guards\' one mind, not a person in the square.',
				gates: 'Holt keeps WestGate and Brant keeps EastGate, each beside the doorway so the way through stays clear.',
				cries: 'A guard who reaches someone who cried out asks what happened before doing anything else.',
			}).map(([key, text]) => ({ text, tags: ['backstory', key], pinned: true })),
			characters: mindsOf(MARKETPLACE_CAST, 'Guards').map((unit) => ({ ...unit, kit: GUARD_KIT })),
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
	return d.addCollective({
		id: 'Sellers',
		kit: { verbs: [...MARKETPLACE_VERBS, ...ORDERS, 'offer'] },
		// One seller per order: each answers the offers made to them.
		maxUnitsPerCommand: 1,
		identity: { role: 'Hive', traits: ['shrewd', 'fair', 'proud of their wares'] },
		// A posted price sells itself. The hive thinks when someone offers a seller something else, and that seller answers it, or rethinks when idle.
		mind: { skipMajor: true, skipStrategic: true },
		pinnedWatches: { offer: 'some(events.filter("offer"))' },
		goals: [
			{ text: 'Every seller stays at their own post and never leaves it.', priority: 2 },
			{ text: 'Sell at the posted prices. Someone who offers a seller less waits for that seller\'s answer: accept with the reverse offer, or counter, never under that ware\'s floor.', priority: 2 },
		],
		memories: [
			{ text: 'I am the sellers\' one mind, not a person in the square: each seller keeps their own stall, and I answer for them.', tags: ['backstory', 'self'], pinned: true },
			...SELLER_MEMORIES,
		],
		characters: mindsOf(MARKETPLACE_CAST, 'Sellers').map((unit) => ({ ...unit, kit: { verbs: [...MARKETPLACE_VERBS, 'offer'] } })),
	});
}
