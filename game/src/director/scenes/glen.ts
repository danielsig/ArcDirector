import { Time, distanceXZ, type GameObject } from '@arc-director/kindling';
import { ArcDirector, type CharacterSpec, type Kit } from 'arc-director';
import { Belly } from '../../engine/Belly';
import { Bridge, Celebrating, HumanBody } from '../../engine/components';
import type { DemoWorld } from '../../engine/demo-world';
import { Item } from '../../items/item-components';
import type { GameHost } from '../adapter';
import { BODY_VERBS, BUILDING_VERB_INSTRUCTIONS, doClose, doRead, FISH_VERB, GAME_VERBS, REST_VERBS } from '../game-verbs';
import { withReceived, type CharacterCtx, type SceneGoals } from '../game-types';
import { compactName, findCarried, itemMatchesName, listCarried } from '../../items/inventory';
import { coinsOf } from '../../items/wallet';
import { worthOf } from '../../items/defs';

const GOT_MUSHROOM = 'hasJustReceived("mushroom")';
/** A mind at rest looks up now and then, and may find something else to do. With a book open, it does not. */
const LOOKS_UP = 'prev.secondsAgo > 180 && !(me is "reading")';

/** What the glen's folk can do. The Angler and the Player fish besides. */
const FOLK_VERBS = [...GAME_VERBS, 'offer', 'sit', 'sleep', 'close', 'read'];
const FOLK:Kit = { verbs: FOLK_VERBS };

/** A goal's test: whoever it is has eaten `defID`. */
function ate(defID:string):(ctx:CharacterCtx)=>boolean {
	return ({ character }) => !!character.getComponent(Belly)?.ate.includes(defID);
}

const FORAGER:CharacterSpec<CharacterCtx> = {
	id: 'Forager',
	mind: { rank: 0.5 },
	kit: FOLK,
	identity: { traits: ['shy', 'gentle', 'curious', 'soft-spoken'] },
	goals: [
		{ text: 'Buy a SilverTrout from Angler, your favorite food, and eat it if you are hungry.', priority: 2, until: ate('silver_trout') },
		{ text: 'Examine the mushrooms among the trees west of Cottage, and remember which look best.', priority: 1 },
	],
	memories: [
		{
			text: 'I am a glen forager. I came out of the forest down the trail to the north, and the forest is my home: I have no house in the glen. I harvest mushrooms for a living, mostly among the trees west of Cottage.',
			tags: ['backstory', 'mushroom', 'trees', 'forest'],
			pinned: true,
		},
		{
			text: 'I trust the woods more than people, and I use few words, always politely. Mushrooms delight me: I talk about them when I talk at all. BridgeKeeper frightens me a little, but is fair. Angler is loud, but the fish is worth it.',
			tags: ['character', 'manner'],
			pinned: true,
		},
		{
			text: 'With nothing left to do, I eat if I am hungry, then rest or harvest. I never buy back what I sold, and I talk only when I have something new to say.',
			tags: ['daily', 'rest'],
			pinned: true,
		},
		{
			text: 'Only BridgeKeeper can work BridgeLever. To cross the river, I ask BridgeKeeper to lower the bridge.',
			tags: ['BridgeKeeper', 'BridgeLever', 'Bridge', 'river'],
			pinned: true,
		},
		{
			text: 'FireMushroom grows among the trees west of Cottage, outdoors.',
			tags: ['FireMushroom', 'trees', 'harvest', 'mushroom'],
		},
		{
			text: 'Angler is the only one who sells SilverTrout as far as I know.',
			tags: ['Angler', 'SilverTrout'],
		},
		{
			text: 'I last saw Angler on the other side of the river.',
			tags: ['Angler', 'river'],
		},
	],
	pinnedWatches: {
		gotMushroom: GOT_MUSHROOM,
		// Heard speech wakes a mind by itself; these wake it once each, not for as long as they stay true.
		hurt: 'isHurt(me) && prev.secondsAgo > 20',
		approaching: 'hasRisen("approaching", count(others.nearby().approaching()))',
		bridge: 'hasJustOpened(Bridge)',
		looksUp: LOOKS_UP,
	},
	// watches: {
	// 	mushroom: 'hasRisen("mushrooms", count(items.filter("FireMushroom").nearby()))',
	// },
	watchesWritable: true,
};

const BRIDGE_KEEPER:CharacterSpec<CharacterCtx> = {
	id: 'BridgeKeeper',
	mind: { rank: 0.5 },
	kit: FOLK,
	identity: { traits: ['stubborn', 'fair', 'dutiful', 'by-the-book', 'dry-witted'] },
	goals: [{
		text: 'Get gold by charging people a fee for lowering the bridge for them IFF the bridge is raised. Never overcharge. Never lower the bridge unpaid/underpaid. Refund a payment that is too little or too much, or that comes after the bridge is already lowered. A fee that lowered the bridge is yours to keep.',
		priority: 2,
		until: ({ world }) => bridgeOpen(world) && bridgeFeePaid(world),
	}, {
		text: 'In quiet moments, sit down with a book from your CottageBookshelf.',
		priority: 1,
	}],
	memories: [
		{
			text: 'I have kept this Bridge for thirty years, as my father did. I speak in short, dry sentences and quote the rules. I quietly like Forager, who pays and keeps quiet, and I find Angler a noisy braggart. Nothing pleases me more than a chair and a book. My CottageBookshelf holds five: Almanac, RiverTales, TollBook, MushroomLore and OldSongs.',
			tags: ['character', 'manner'],
			pinned: true,
		},
		{
			text: 'I operate the Bridge near the cottage. I accept 10 gold or items of equal value as payment for lowering the bridge: one FireMushroom is worth 10 gold, so it pays the whole fee, but a MoonMushroom is worth only 1 gold and does not. Once I hold the payment, I lower the bridge for whoever paid. I do not lower Bridge unpaid. Payment lasts for a full day and I will lower the bridge for whoever paid until the payment expires.',
			tags: ['backstory', 'Bridge', 'gold'],
			pinned: true,
		},
		{
			text: 'I raise or lower the bridge only by working BridgeLever with the BridgeCrank in my pack. Taking gold or an item does not move it on its own. Sight says whether Bridge is raised or lowered right now. I never lower it until I have been paid beforehand.',
			tags: ['BridgeCrank', 'BridgeLever', 'Bridge'],
			pinned: true,
		},
		{
			text: 'I keep SpareKey hidden by the woodpile on the east side of Cottage, in case I lose CottageKey.',
			tags: ['SpareKey', 'CottageKey', 'Cottage'],
		},
		{
			text: 'My home is Cottage, north of the river. CottageKey in my pack opens CottageDoor, and CottageChair and CottageBed are inside. With nothing left to do, I go home and rest, and I talk only when I have something new to say.',
			tags: ['home', 'Cottage'],
			pinned: true,
		},
	],
	pinnedWatches: { looksUp: LOOKS_UP },
};

const ANGLER:CharacterSpec<CharacterCtx> = {
	id: 'Angler',
	mind: { rank: 0.5 },
	identity: { traits: ['wet', 'impatient', 'boastful', 'cheerful'] },
	goals: [
		{ text: 'Get a FireMushroom by trade, your favorite food, and eat it if you are hungry.', priority: 2, until: ate('fire_mushroom') },
		{ text: 'Fish whenever you are free, and land more trout than anyone ever has.', priority: 1 },
	],
	offers: [{ give: { SilverTrout: 1 }, get: { gold: 5 } }],
	memories: [
		{
			text: 'I am an angler. I sell SilverTrout for 5 gold. That offer stands, so whoever pays it gets a fish at once. My favorite food is FireMushroom.',
			tags: ['backstory', 'angler', 'river', 'fish', 'SilverTrout', 'FireMushroom'],
			pinned: true,
		},
		{
			text: 'I love a good story, above all about the fish that got away, each bigger than the last. I grumble about the weather and tease BridgeKeeper for being stiff. Forager is too quiet, but pays well.',
			tags: ['character', 'manner'],
			pinned: true,
		},
		{
			text: 'My home is Hut, south of the river, with HutChair and HutBed inside. With nothing left to do, I fish or rest at home, and I talk only when I have something new to say.',
			tags: ['home', 'Hut'],
			pinned: true,
		},
	],
	watches: { bridge: 'hasJustOpened(Bridge)' },
	pinnedWatches: { gotMushroom: GOT_MUSHROOM, looksUp: LOOKS_UP },
};

/** The bridge fee, in gold. */
const FEE = 10;


/** What BridgeKeeper holds toward the fee, in gold: coins, and goods at their worth. */
function feeHeld(world:DemoWorld):number {
	const keeper = world.findByID(BRIDGE_KEEPER.id);
	if (!keeper) {
		return 0;
	}
	const goods = listCarried(keeper).reduce((sum, it) => {
		const worth = worthOf(it.defID) ?? 0;
		return sum + worth * it.count;
	}, 0);
	return coinsOf(keeper) + goods;
}

function bridgeFeePaid(world:DemoWorld):boolean {
	return feeHeld(world) >= FEE;
}

/** Lowered, or swinging down. */
function bridgeOpen(world:DemoWorld):boolean {
	let open = false;
	world.forEachComponent(Bridge, (span) => {
		open ||= span.open;
	});
	return open;
}

/** The glen's river runs east–west under Bridge; the cottage is on its north bank. */
function onCottageBank(host:GameHost, go:GameObject):boolean {
	let north = false;
	host.world.forEachComponent(Bridge, (span) => {
		north ||= go.transform.position.z < span.gameObject.transform.position.z;
	});
	return north;
}

/** Angler, cut off across a raised bridge, has nothing to think about until it comes down. */
function mayThink(host:GameHost, id:string):boolean {
	if (id !== ANGLER.id || bridgeOpen(host.world)) {
		return true;
	}
	const angler = host.world.findByID(ANGLER.id);
	return !angler || onCottageBank(host, angler);
}

const wokeForager = new WeakSet<GameHost>();

function wakeForagerOnce(host:GameHost):void {
	if (wokeForager.has(host) || !host.arc) {
		return;
	}
	wokeForager.add(host);
	host.arc.queue.enqueueMajor(FORAGER.id, true);
}

/** Whether `id` has reached the goal the scene is about: its only one with a test, off its list by now. */
function reached(host:GameHost, id:string):boolean {
	const goals = host.arc?.character(id)?.persona.goals;
	return !!goals && !goals.some((goal) => goal.until);
}

function checkBargain(host:GameHost):void {
	wakeForagerOnce(host);
	// Paid for, the bridge stays down: the keeper working the lever again would only raise it on whoever paid.
	host.world.forEachComponent(Bridge, (span) => {
		span.paidDown = () => bridgeFeePaid(host.world);
	});
	if (!host.bargainDone && [FORAGER, BRIDGE_KEEPER, ANGLER].every((spec) => reached(host, spec.id))) {
		host.bargainDone = true;
		host.world.setMessage('The glen holds — trout, mushroom, and a lowered bridge');
	}
}

function carries(host:GameHost, id:string, item:string):boolean {
	const go = host.world.findByID(id);
	return !!go && !!findCarried(go, (it) => itemMatchesName(it, item));
}

/** Where `item` can be had nearest `seeker`: lying about, or carried by someone else. */
function nearestThing(host:GameHost, seeker:GameObject, item:string):GameObject | undefined {
	const want = compactName(item);
	let best:GameObject | undefined;
	let bestDist = Infinity;
	const consider = (go:GameObject):void => {
		const d = distanceXZ(seeker, go);
		if (go !== seeker && d < bestDist) {
			best = go;
			bestDist = d;
		}
	};
	host.world.forEachComponent(Item, (it, go) => {
		if (compactName(it.defID) === want || compactName(go.name) === want) {
			consider(go);
		}
	});
	host.world.forEachComponent(HumanBody, (body, go) => {
		if (findCarried(go, (it) => itemMatchesName(it, item))) {
			consider(go);
		}
	});
	return best;
}

/** The farthest each leg of the way has been, so closing in reads as progress from wherever it started. */
const legStarts = new WeakMap<GameHost, Map<string, number>>();

/** How far `who` has come toward `to`, 0 to 1, since `leg` was first asked about. */
function closeness(host:GameHost, leg:string, who:GameObject | undefined, to:GameObject | undefined):number {
	if (!who || !to) {
		return 0;
	}
	let starts = legStarts.get(host);
	if (!starts) {
		starts = new Map();
		legStarts.set(host, starts);
	}
	const d = distanceXZ(who, to);
	const start = Math.max(d, starts.get(leg) ?? 0);
	starts.set(leg, start);
	return start > 0 ? 1 - d / start : 1;
}

/** Short of the step itself: walking there fills the line most of the way, doing it fills the rest. */
const WALKED = 0.9;

/**
 * The fee: the Forager walks to a FireMushroom, then carries it to the BridgeKeeper. Whatever the keeper already
 * holds toward the fee counts too.
 */
function feeProgress(host:GameHost):number {
	if (bridgeFeePaid(host.world)) {
		return 1;
	}
	const forager = host.world.findByID(FORAGER.id);
	const keeper = host.world.findByID(BRIDGE_KEEPER.id);
	const walked = !forager || !carries(host, FORAGER.id, 'FireMushroom')
		? 0.5 * closeness(host, 'mushroom', forager, forager && nearestThing(host, forager, 'FireMushroom'))
		: 0.5 + 0.5 * closeness(host, 'keeper', forager, keeper);
	return Math.max(feeHeld(host.world) / FEE, WALKED * walked);
}

/** The bridge: once paid, the BridgeKeeper walks to BridgeLever and works it. */
function bridgeProgress(host:GameHost):number {
	if (bridgeOpen(host.world)) {
		return 1;
	}
	if (!bridgeFeePaid(host.world)) {
		return 0;
	}
	return WALKED * closeness(host, 'lever', host.world.findByID(BRIDGE_KEEPER.id), host.world.findNamed('BridgeLever'));
}

/** How much of a meal's line the walk to its seller fills, and how much having the food does. */
const AT_SELLER = 0.5;
const ACQUIRED = 0.75;

/** `eater`'s favorite food: walking to whoever sells it fills half the line, having it three quarters, and eating it all. */
export function mealProgress(host:GameHost, eater:string, seller:string, item:string):number {
	if (reached(host, eater)) {
		return 1;
	}
	if (carries(host, eater, item)) {
		return ACQUIRED;
	}
	return AT_SELLER * closeness(host, `${eater}:${seller}`, host.world.findByID(eater), host.world.findByID(seller));
}

/**
 * The glen's bargain, step by step, each line filling as people close in: the fee, the bridge, then the Forager eats
 * the trout it wanted and the Angler the FireMushroom.
 */
function goals(host:GameHost):SceneGoals {
	return {
		left: { color: 'gold', goals: [
			{ name: 'Forager pays the bridge crossing fee', progress: feeProgress(host) },
			{ name: 'BridgeKeeper lowers the bridge', progress: bridgeProgress(host) },
			{ name: 'Forager eats a SilverTrout', progress: mealProgress(host, FORAGER.id, ANGLER.id, 'SilverTrout') },
			{ name: 'Angler eats a FireMushroom', progress: mealProgress(host, ANGLER.id, BRIDGE_KEEPER.id, 'FireMushroom') },
		] },
	};
}

export function createDirector(host:GameHost):ArcDirector<CharacterCtx, GameObject> {
	host.hooks = { checkBargain, mayThink, goals };
	return host.configure(new ArcDirector<CharacterCtx, GameObject>())
		.withRPG({ ...BODY_VERBS, ...REST_VERBS })
		.withVerbs((v) => v
			.add('fish', FISH_VERB)
			.add('read', {
				args: { item: 'id' },
				help: 'reads a while from a book you carry',
				seen: 'reading',
				handler: (call) => doRead(call, call.args.item),
			})
			.add('close', {
				args: { target: 'id' },
				help: 'walks to a door and shuts it',
				seen: 'closing {target}',
				handler: (call) => doClose(call, call.args.target),
			}))
		.withDefaultKit({ verbs: [...FOLK_VERBS, 'fish'] })
		.withMind({ skipStrategic: true, verbInstructions: BUILDING_VERB_INSTRUCTIONS })
		.withGoals({ onReached: (id) => host.world.findByID(id)?.getOrAddComponent(Celebrating).beginHops(Time.time, 3) })
		.addCharacter(withReceived(FORAGER))
		.addCharacter(withReceived(BRIDGE_KEEPER))
		.addCharacter(withReceived(ANGLER));
	// .addCharacter(withReceived(ASSISTANT));
}
