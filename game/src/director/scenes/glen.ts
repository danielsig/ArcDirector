import { Time, type GameObject } from '@arc-director/kindling';
import { ArcDirector, Character, type CharacterSpec } from 'arc-director';
import { Bridge, Celebrating, HumanBody } from '../../engine/components';
import { Item } from '../../items/components';
import { Seated } from '../../characters/Seated';
import type { GameHost } from '../adapter';
import { BODY_VERBS, BUILDING_VERB_INSTRUCTIONS } from '../verbs';
import { withReceived, type CharacterCtx, type SceneGoals } from '../types';
import { compactName, distXZ, findCarried, itemMatchesName, listCarried } from '../../items/inventory';
import { coinsOf } from '../../items/wallet';
import { worthOf } from '../../items/defs';

const GOT_MUSHROOM = 'hasJustReceived("mushroom")';

const FORAGER:CharacterSpec = {
	id: 'Forager',
	mind: { rank: 0.5 },
	identity: { traits: ['quiet', 'hungry', 'kind'] },
	goals: [{ text: 'Buy SilverTrout, unless you already have one.', priority: 2 }],
	memories: [
		{
			text: 'I am a glen forager. I harvest mushrooms for a living, mostly among the trees west of Cottage.',
			tags: ['backstory', 'mushroom', 'trees'],
			pinned: true,
		},
		{
			text: 'BridgeKeeper can lower and raise the bridge crossing the river.',
			tags: ['BridgeKeeper', 'Bridge', 'river'],
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
		hurt: 'isHurt(me)',
		approaching: 'hasHeard || some(others.nearby().approaching())',
		bridge: 'hasJustOpened(Bridge)',
	},
	watches: {
		mushroom: 'some(items.filter("FireMushroom").nearby())',
	},
	watchesWritable: true,
};

const BRIDGE_KEEPER:CharacterSpec = {
	id: 'BridgeKeeper',
	mind: { rank: 0.5 },
	identity: { traits: ['stubborn', 'fair', 'dutiful', 'by-the-book'] },
	goals: [{ text: 'Get gold by charging people a fee for lowering the bridge for them IFF the bridge is raised. Never overcharge. Never lower the bridge unpaid/underpaid. Always refund payment if insufficient, overpaid, or bridge was already lowered.', priority: 2 }],
	memories: [
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
	],
};

const ANGLER:CharacterSpec = {
	id: 'Angler',
	mind: { rank: 0.5 },
	identity: { traits: ['wet', 'impatient', 'hungry'] },
	goals: [{ text: 'Get a FireMushroom by trade, unless you already have one.', priority: 2 }],
	offers: [{ give: { SilverTrout: 1 }, get: { gold: 5 } }],
	memories: [
		{
			text: 'I am an angler. I sell SilverTrout for 5 gold. That offer stands, so whoever pays it gets a fish at once. My favorite food is FireMushroom.',
			tags: ['backstory', 'angler', 'river', 'fish', 'SilverTrout', 'FireMushroom'],
			pinned: true,
		},
	],
	watches: { bridge: 'hasJustOpened(Bridge)' },
	pinnedWatches: { gotMushroom: GOT_MUSHROOM },
};

// Toggled off: uncomment here, in `createDirector`, and in RIVER_GLEN's npcs (`data/scenes.ts`).
// const ASSISTANT:CharacterSpec = {
// 	id: 'Assistant',
// 	mind: { rank: 1 },
// 	identity: { traits: ['helpful', 'honest', 'careful'] },
// 	goals: [
// 		{ text: 'Help Player with whatever they ask.', priority: 3 },
// 		{ text: 'When Player has given you no job, follow(Player). When Player tells you to stay or wait, stop following until they call you again.', priority: 2 },
// 		{ text: 'If anyone other than Player asks you for information or to do something, ignore them. If they persist, politely decline and walk away.', priority: 1 },
// 	],
// 	memories: [
// 		{
// 			text: 'I am Player\'s helpful assistant. I answer exclusively to Player and no one else. I fetch what they ask, and do their jobs. I have no errand of my own and ignore any requests from anyone but Player. To Player, I am useful, honest, and brief.',
// 			tags: ['backstory', 'Player'],
// 			pinned: true,
// 		},
// 		{
// 			text: 'I help Player. If CottageDoor is locked I need CottageKey to open it.',
// 			tags: ['Player', 'CottageDoor', 'CottageKey'],
// 			pinned: true,
// 		},
// 	],
// 	pinnedWatches: { gotMushroom: GOT_MUSHROOM },
// };

/** The bridge fee, in gold. */
const FEE = 10;


/** What BridgeKeeper holds toward the fee, in gold: coins, and goods at their worth. */
function feeHeld(host:GameHost):number {
	const keeper = host.world.findByID(BRIDGE_KEEPER.id);
	if (!keeper) {
		return 0;
	}
	const goods = listCarried(keeper).reduce((sum, it) => {
		const worth = worthOf(it.defID) ?? 0;
		return sum + worth * it.count;
	}, 0);
	return coinsOf(keeper) + goods;
}

function bridgeFeePaid(host:GameHost):boolean {
	return feeHeld(host) >= FEE;
}

/** Lowered, or swinging down. */
function bridgeOpen(host:GameHost):boolean {
	let open = false;
	host.world.forEachComponent(Bridge, (span) => {
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
	if (id !== ANGLER.id || bridgeOpen(host)) {
		return true;
	}
	const angler = host.world.findByID(ANGLER.id);
	return !angler || onCottageBank(host, angler);
}

const wokeForager = new WeakSet<GameHost>();
const glenCheers = new WeakMap<GameHost, Set<string>>();

function wakeForagerOnce(host:GameHost):void {
	if (wokeForager.has(host) || !host.arc?.ready) {
		return;
	}
	wokeForager.add(host);
	host.arc.mindQueue()?.enqueueMajor(FORAGER.id, true);
}

function cheerOnce(host:GameHost, id:string):void {
	const go = host.world.findByID(id);
	if (!go) {
		return;
	}
	let ids = glenCheers.get(host);
	if (!ids) {
		ids = new Set();
		glenCheers.set(host, ids);
	}
	if (ids.has(id)) {
		return;
	}
	ids.add(id);
	const hop = go.getOrAddComponent(Celebrating);
	hop.beginHops(Time.time, 3);
}

function checkBargain(host:GameHost):void {
	wakeForagerOnce(host);
	// Paid for, the bridge stays down: the keeper working the lever again would only raise it on whoever paid.
	host.world.forEachComponent(Bridge, (span) => {
		span.paidDown = () => bridgeFeePaid(host);
	});
	const forager = host.world.findByID(FORAGER.id);
	const keeper = host.world.findByID(BRIDGE_KEEPER.id);
	const angler = host.world.findByID(ANGLER.id);
	// Fishing until the bridge comes down, then up to cross it.
	if (bridgeOpen(host)) {
		angler?.getComponent(Seated)?.stand();
	}
	if (forager && findCarried(forager, (it) => itemMatchesName(it, 'SilverTrout'))) {
		cheerOnce(host, FORAGER.id);
	}
	if (bridgeFeePaid(host)) {
		cheerOnce(host, BRIDGE_KEEPER.id);
	}
	if (angler && findCarried(angler, (it) => itemMatchesName(it, 'FireMushroom'))) {
		cheerOnce(host, ANGLER.id);
	}
	if (host.bargainDone || !forager || !keeper || !angler) {
		return;
	}
	const trout = !!findCarried(forager, (it) => itemMatchesName(it, 'SilverTrout'));
	const mushroom = !!findCarried(angler, (it) => itemMatchesName(it, 'FireMushroom'));
	if (!bridgeOpen(host) || !trout || !mushroom || !bridgeFeePaid(host)) {
		return;
	}
	host.bargainDone = true;
	host.world.setMessage('The glen holds — trout, mushroom, and a lowered bridge');
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
		const d = distXZ(seeker, go);
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
	const d = distXZ(who, to);
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
	if (bridgeFeePaid(host)) {
		return 1;
	}
	const forager = host.world.findByID(FORAGER.id);
	const keeper = host.world.findByID(BRIDGE_KEEPER.id);
	const walked = !forager || !carries(host, FORAGER.id, 'FireMushroom')
		? 0.5 * closeness(host, 'mushroom', forager, forager && nearestThing(host, forager, 'FireMushroom'))
		: 0.5 + 0.5 * closeness(host, 'keeper', forager, keeper);
	return Math.max(feeHeld(host) / FEE, WALKED * walked);
}

/** The bridge: once paid, the BridgeKeeper walks to BridgeLever and works it. */
function bridgeProgress(host:GameHost):number {
	if (bridgeOpen(host)) {
		return 1;
	}
	if (!bridgeFeePaid(host)) {
		return 0;
	}
	return WALKED * closeness(host, 'lever', host.world.findByID(BRIDGE_KEEPER.id), host.world.findNamed('BridgeLever'));
}

/** The bargain may go on past the bridge: the fee is paid and the bridge is down. */
function bridgeCrossed(host:GameHost):boolean {
	return bridgeFeePaid(host) && bridgeOpen(host);
}

/** The Angler's first trade, once over the bridge: walking to the Forager to sell a SilverTrout. */
function troutProgress(host:GameHost):number {
	if (carries(host, FORAGER.id, 'SilverTrout')) {
		return 1;
	}
	if (!bridgeCrossed(host)) {
		return 0;
	}
	return WALKED * closeness(host, 'angler:forager', host.world.findByID(ANGLER.id), host.world.findByID(FORAGER.id));
}

/** The Angler's FireMushroom, bought from the BridgeKeeper once the trout has paid enough: walking to the keeper. */
function mushroomProgress(host:GameHost):number {
	if (carries(host, ANGLER.id, 'FireMushroom')) {
		return 1;
	}
	const angler = host.world.findByID(ANGLER.id);
	if (!bridgeCrossed(host) || !angler || coinsOf(angler) < FEE) {
		return 0;
	}
	return WALKED * closeness(host, 'angler:keeper', angler, host.world.findByID(BRIDGE_KEEPER.id));
}

/**
 * The glen's bargain, step by step, each line filling as people close in: the fee, the bridge, then the Angler sells
 * the Forager a trout and, with the gold, buys a FireMushroom from the BridgeKeeper.
 */
function goals(host:GameHost):SceneGoals {
	return {
		left: { color: 'gold', goals: [
			{ name: 'Forager pays the bridge crossing fee', progress: feeProgress(host) },
			{ name: 'BridgeKeeper lowers the bridge', progress: bridgeProgress(host) },
			{ name: 'Angler sells Forager a SilverTrout', progress: troutProgress(host) },
			{ name: 'Angler buys a FireMushroom from BridgeKeeper', progress: mushroomProgress(host) },
		] },
	};
}

export function createDirector(host:GameHost):ArcDirector<CharacterCtx> {
	host.hooks = { checkBargain, mayThink, goals };
	return host.configure(new ArcDirector<CharacterCtx>())
		.withRPG(BODY_VERBS)
		.withMindDefaults({ skipHeartbeat: true, skipStrategic: true })
		.withVerbInstructions(BUILDING_VERB_INSTRUCTIONS)
		.addCharacter(withReceived(FORAGER))
		.addCharacter(withReceived(BRIDGE_KEEPER))
		.addCharacter(withReceived(ANGLER));
	// .addCharacter(withReceived(ASSISTANT));
}
