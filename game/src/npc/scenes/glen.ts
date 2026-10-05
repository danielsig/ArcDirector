import { ArcDirector, type AgentSpec } from 'arc-director';
import { Bridge, Celebrating } from '../../engine/components';
import type { GameHost } from '../adapter';
import { BUILDING_VERB_INSTRUCTIONS, GAME_VERBS } from '../verbs';
import type { AgentCtx } from '../types';
import { getDef } from '../../items/defs';
import { findCarried, itemMatchesName } from '../../items/inventory';
import { coinsOf } from '../../items/wallet';

const GOT_MUSHROOM = 'hasJustReceived("mushroom")';
const BRIDGE_FEE = getDef('fire_mushroom').components.Goods?.ask ?? 10;
const TROUT_ASK = getDef('silver_trout').components.Goods?.ask ?? 5;

const FORAGER:AgentSpec = {
	id: 'Forager',
	rank: 0.5,
	identity: { traits: ['quiet', 'hungry', 'kind'] },
	goals: [{
		text: 'Give one FireMushroom to BridgeKeeper, then buy SilverTrout from Angler. Once you are carrying SilverTrout, stop. Do not search for another FireMushroom.',
		priority: 2,
	}],
	memories: [
		{
			text: `I am a glen forager. I live among the trees west of Cottage. Only I harvest FireMushroom. BridgeKeeper's bridge fee is FireMushroom or ${BRIDGE_FEE} gold. I start with ${TROUT_ASK} gold, enough for SilverTrout, not the bridge fee. I do not work the sluice. I do not walk into water. Use names, never coordinates.`,
			tags: ['backstory', 'BridgeKeeper', 'FireMushroom', 'SilverTrout'],
			pinned: true,
		},
		{
			text: 'FireMushroom grows among the trees west of Cottage, outdoors. Search only while I am not carrying SilverTrout. If I am not carrying FireMushroom and not carrying SilverTrout and the scene has not named it, wander(until=some(items.filter("FireMushroom").nearby())). When that wander ends, pick_up(FireMushroom) — do not wander that same search again. Once I am carrying SilverTrout, do not search for FireMushroom.',
			tags: ['FireMushroom', 'trees'],
			pinned: true,
		},
		{
			text: `give(item=FireMushroom, to=BridgeKeeper) once. I start with ${TROUT_ASK} gold — enough for SilverTrout, not the ${BRIDGE_FEE}-gold bridge fee. go_to(Angler) and buy(item=SilverTrout, from=Angler). buy offer is gold. When I am carrying SilverTrout, the errand is done. CottageDoor is not my work.`,
			tags: ['BridgeKeeper', 'Angler', 'SilverTrout', 'gold'],
			pinned: true,
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

const BRIDGE_KEEPER:AgentSpec = {
	id: 'BridgeKeeper',
	rank: 0.5,
	identity: { traits: ['stubborn', 'fair', 'dutiful'] },
	goals: [{
		text: `Take FireMushroom or ${BRIDGE_FEE} gold as the bridge fee, then lower Bridge. Sell FireMushroom to Angler for ${BRIDGE_FEE} gold.`,
		priority: 2,
	}],
	memories: [
		{
			text: `I keep Bridge at the cottage and work the sluice. The bridge fee is FireMushroom or ${BRIDGE_FEE} gold — FireMushroom is worth ${BRIDGE_FEE} gold. Do not lower Bridge unpaid. Paid work is still work: once I have FireMushroom or ${BRIDGE_FEE} gold, I lower the sluice. I do not ask Forager for gold. CottageDoor and CottageKey are not my job. Use names, never coordinates.`,
			tags: ['backstory', 'Bridge', 'FireMushroom', 'Forager', 'gold'],
			pinned: true,
		},
		{
			text: `BridgeCrank is in my pack. BridgeLever is the sluice. Do not lower Bridge unpaid. When I am carrying FireMushroom or me.gold >= ${BRIDGE_FEE}, use(item=BridgeCrank, target=BridgeLever). I sell FireMushroom to Angler; I do not buy SilverTrout. CottageDoor is not my work.`,
			tags: ['BridgeCrank', 'BridgeLever', 'Bridge', 'FireMushroom', 'Angler', 'gold'],
			pinned: true,
		},
	],
	pinnedWatches: { gotMushroom: GOT_MUSHROOM },
	laws: [{
		name: 'sluice',
		watch: `(isCarrying("FireMushroom") || me.gold >= ${BRIDGE_FEE}) && !isOpen(Bridge)`,
		arc: 'use(item=BridgeCrank, target=BridgeLever)',
		pinned: true,
	}],
};

const ANGLER:AgentSpec = {
	id: 'Angler',
	rank: 0.5,
	identity: { traits: ['wet', 'impatient', 'hungry'] },
	goals: [{
		text: `Sell SilverTrout to Forager for ${TROUT_ASK} gold. Buy FireMushroom from BridgeKeeper for ${BRIDGE_FEE} gold.`,
		priority: 2,
	}],
	memories: [
		{
			text: `I am an angler. I sell SilverTrout to Forager for ${TROUT_ASK} gold — not to BridgeKeeper. Then I have ${BRIDGE_FEE} gold and buy FireMushroom from BridgeKeeper. I do not buy the mushroom until I have ${BRIDGE_FEE} gold. Use names, never coordinates.`,
			tags: ['backstory', 'Forager', 'BridgeKeeper', 'SilverTrout', 'FireMushroom'],
			pinned: true,
		},
		{
			text: `SilverTrout is in my pack and costs ${TROUT_ASK} gold. I will not drop it in the water. sell(item=SilverTrout, to=Forager). BridgeKeeper does not buy trout. I start with ${TROUT_ASK} gold. wait(until=me.gold >= ${BRIDGE_FEE}) then go_to(BridgeKeeper) and buy(item=FireMushroom, from=BridgeKeeper).`,
			tags: ['SilverTrout', 'FireMushroom', 'BridgeKeeper', 'Forager', 'gold'],
			pinned: true,
		},
	],
	watches: { bridge: 'hasJustOpened(Bridge)' },
	pinnedWatches: { gotMushroom: GOT_MUSHROOM },
};

const ASSISTANT:AgentSpec = {
	id: 'Assistant',
	rank: 1,
	identity: { traits: ['helpful', 'honest', 'careful'] },
	goals: [
		{ text: 'Help Player with whatever they ask.', priority: 2 },
		{ text: 'When Player has given you no job, follow(Player). When Player tells you to stay or wait, stop following until they call you again.', priority: 1 },
	],
	memories: [
		{
			text: 'I am a helpful assistant. I answer Player, fetch what they ask, and do their jobs. I have no errand of my own. Be useful, honest, and brief. Use names, never coordinates.',
			tags: ['backstory', 'Player'],
			pinned: true,
		},
		{
			text: 'I help Player. If CottageDoor is locked I need CottageKey.',
			tags: ['Player', 'CottageDoor', 'CottageKey'],
			pinned: true,
		},
	],
	pinnedWatches: { gotMushroom: GOT_MUSHROOM },
};

function bridgeFeePaid(host:GameHost):boolean {
	const keeper = host.world.findByID(BRIDGE_KEEPER.id);
	return !!keeper && coinsOf(keeper) >= BRIDGE_FEE;
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
	let hop = go.getComponent(Celebrating);
	if (!hop) {
		hop = go.addComponent(new Celebrating());
	}
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
	if (keeper && coinsOf(keeper) >= BRIDGE_FEE) {
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

export function createDirector(host:GameHost):ArcDirector<AgentCtx> {
	host.hooks = { checkBargain, goalDone };
	host.kit = { verbs: [...GAME_VERBS, 'buy', 'sell'] };
	return host.configure(new ArcDirector<AgentCtx>())
		.withDefaultKit(host.kit)
		.withVerbInstructions(BUILDING_VERB_INSTRUCTIONS)
		.addAgent(FORAGER)
		.addAgent(BRIDGE_KEEPER)
		.addAgent(ANGLER)
		.addAgent(ASSISTANT);
}
