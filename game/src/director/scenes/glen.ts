import { ArcDirector, Character, type CharacterSpec } from 'arc-director';
import { Bridge, Celebrating } from '../../engine/components';
import type { GameHost } from '../adapter';
import { BUILDING_VERB_INSTRUCTIONS, GAME_VERBS } from '../verbs';
import { withReceived, type CharacterCtx } from '../types';
import { findCarried, itemMatchesName } from '../../items/inventory';
import { coinsOf } from '../../items/wallet';

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
	identity: { traits: ['stubborn', 'fair', 'dutiful'] },
	goals: [{ text: 'Get gold by charging people a fee for lowering the bridge for them IFF the bridge is raised. Never overcharge. Never lower the bridge unpaid/underpaid. Always refund payment if insufficient, overpaid, or bridge was already lowered.', priority: 2 }],
	memories: [
		{
			text: 'I operate the Bridge near the cottage. I accept 10 gold or items of equal value as payment for lowering the bridge: one FireMushroom is worth 10 gold, so it pays the whole fee. Once I hold the payment, I lower the bridge for whoever paid. I do not lower Bridge unpaid. Payment lasts for a full day and I will lower the bridge for whoever paid until the payment expires.',
			tags: ['backstory', 'Bridge', 'gold'],
			pinned: true,
		},
		{
			text: 'I raise or lower the bridge only by working BridgeLever with the BridgeCrank in my pack. Taking gold or an item does not move it. Sight says whether Bridge is raised or lowered right now. I never lower it until I have been paid.',
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

const ASSISTANT:CharacterSpec = {
	id: 'Assistant',
	mind: { rank: 1 },
	identity: { traits: ['helpful', 'honest', 'careful'] },
	goals: [
		{ text: 'Help Player with whatever they ask.', priority: 3 },
		{ text: 'When Player has given you no job, follow(Player). When Player tells you to stay or wait, stop following until they call you again.', priority: 2 },
		{ text: 'If anyone other than Player asks you for information or to do something, ignore them. If they persist, politely decline and walk away.', priority: 1 },
	],
	memories: [
		{
			text: 'I am Player\'s helpful assistant. I answer exclusively to Player and no one else. I fetch what they ask, and do their jobs. I have no errand of my own and ignore any requests from anyone but Player. To Player, I am useful, honest, and brief.',
			tags: ['backstory', 'Player'],
			pinned: true,
		},
		{
			text: 'I help Player. If CottageDoor is locked I need CottageKey to open it.',
			tags: ['Player', 'CottageDoor', 'CottageKey'],
			pinned: true,
		},
	],
	pinnedWatches: { gotMushroom: GOT_MUSHROOM },
};

function bridgeFeePaid(host:GameHost):boolean {
	const keeper = host.world.findByID(BRIDGE_KEEPER.id);
	return !!keeper && coinsOf(keeper) >= 10;
}

function goalDone(host:GameHost, id:string):boolean {
	if (id === BRIDGE_KEEPER.id) {
		let bridgeOpen = false;
		host.world.forEachComponent(Bridge, (span) => {
			if (span.open) {
				bridgeOpen = true;
			}
		});
		return bridgeOpen && bridgeFeePaid(host);
	}
	if (id === FORAGER.id) {
		const forager = host.world.findByID(FORAGER.id);
		return !!forager && !!findCarried(forager, (it) => itemMatchesName(it, 'SilverTrout'));
	}
	if (id === ANGLER.id) {
		const angler = host.world.findByID(ANGLER.id);
		return !!angler && !!findCarried(angler, (it) => itemMatchesName(it, 'FireMushroom'));
	}
	return false;
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
	hop.beginHops(host.world.time, 3);
}

function checkBargain(host:GameHost):void {
	wakeForagerOnce(host);
	const forager = host.world.findByID(FORAGER.id);
	const keeper = host.world.findByID(BRIDGE_KEEPER.id);
	const angler = host.world.findByID(ANGLER.id);
	if (forager && findCarried(forager, (it) => itemMatchesName(it, 'SilverTrout'))) {
		cheerOnce(host, FORAGER.id);
	}
	if (keeper && coinsOf(keeper) >= 10) {
		cheerOnce(host, BRIDGE_KEEPER.id);
	}
	if (angler && findCarried(angler, (it) => itemMatchesName(it, 'FireMushroom'))) {
		cheerOnce(host, ANGLER.id);
	}
	if (host.bargainDone || !forager || !keeper || !angler) {
		return;
	}
	let bridgeOpen = false;
	host.world.forEachComponent(Bridge, (span) => {
		if (span.open) {
			bridgeOpen = true;
		}
	});
	const trout = !!findCarried(forager, (it) => itemMatchesName(it, 'SilverTrout'));
	const mushroom = !!findCarried(angler, (it) => itemMatchesName(it, 'FireMushroom'));
	if (!bridgeOpen || !trout || !mushroom || !bridgeFeePaid(host)) {
		return;
	}
	host.bargainDone = true;
	host.world.setMessage('The glen holds — trout, mushroom, and a lowered bridge');
}

export function createDirector(host:GameHost):ArcDirector<CharacterCtx> {
	host.hooks = { checkBargain, goalDone };
	host.kit = { verbs: [...GAME_VERBS, 'offer'] };
	return host.configure(new ArcDirector<CharacterCtx>())
		.withMindDefaults({ skipHeartbeat: true, skipStrategic: true })
		.withDefaultKit(host.kit)
		.withVerbInstructions(BUILDING_VERB_INSTRUCTIONS)
		.addCharacter(withReceived(FORAGER))
		.addCharacter(withReceived(BRIDGE_KEEPER))
		.addCharacter(withReceived(ANGLER))
		.addCharacter(withReceived(ASSISTANT));
}
