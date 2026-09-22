import { ArcDirector, STOCK_VERBS, type AgentSpec } from 'arc-director';
import { Bridge, Celebrating } from '../../engine/components';
import type { GameHost } from '../adapter';
import type { HostCtx } from '../types';
import { getDef } from '../../items/defs';
import { findCarried, itemMatchesName } from '../../items/inventory';
import { coinsOf } from '../../items/wallet';

const GOT_MUSHROOM = 'hasJustReceived("mushroom")';
const MILL_FEE = getDef('fire_mushroom').components.Goods?.ask ?? 10;
const TROUT_ASK = getDef('silver_trout').components.Goods?.ask ?? 5;

export const FORAGER:AgentSpec = {
	id: 'Forager',
	rank: 0.5,
	identity: {
		name: 'Forager',
		role: `You are Wren, a glen forager. The land names you Forager. You live among the trees west of Cottage. Only you harvest FireMushroom. Miller's mill-fee is FireMushroom or ${MILL_FEE} gold. You start with ${TROUT_ASK} gold, enough for SilverTrout, not the mill-fee. Give one FireMushroom to Miller, then buy SilverTrout from Angler. Once you are carrying SilverTrout, that errand is finished. Do not search for another FireMushroom. You do not work the sluice. You do not walk into water. Use names, never coordinates.`,
		traits: ['quiet', 'hungry', 'kind'],
	},
	goals: [{
		text: 'Give one FireMushroom to Miller, then buy SilverTrout from Angler. Once you are carrying SilverTrout, stop. Do not search for another FireMushroom.',
		priority: 2,
	}],
	memories: [
		{
			text: 'FireMushroom grows among the trees west of Cottage, outdoors. Search only while I am not carrying SilverTrout. If I am not carrying FireMushroom and not carrying SilverTrout and the scene has not named it, wander(until=some(items.filter("FireMushroom").nearby())). When that wander ends, pick_up(FireMushroom) — do not wander that same search again. Once I am carrying SilverTrout, do not search for FireMushroom.',
			tags: ['FireMushroom', 'trees'],
			pinned: true,
		},
		{
			text: `give(item=FireMushroom, to=Miller) once. I start with ${TROUT_ASK} gold — enough for SilverTrout, not Miller's ${MILL_FEE}-gold mill-fee. go_to(Angler) and buy(item=SilverTrout, from=Angler). buy offer is gold. When I am carrying SilverTrout, the errand is done. CottageDoor is not my work.`,
			tags: ['Miller', 'Angler', 'SilverTrout', 'gold'],
			pinned: true,
		},
	],
	pinnedWatches: {
		gotMushroom: GOT_MUSHROOM,
		hurt: 'isHurt(me)',
		approaching: 'hasHeard || some(others.nearby().approaching())',
		bridge: 'hasJustOpened(MillBridge) || some(events.filter("bridge"))',
	},
	watches: {
		mushroom: 'some(items.filter("FireMushroom").nearby())',
	},
	watchesWritable: true,
};

export const MILLER:AgentSpec = {
	id: 'Miller',
	rank: 0.5,
	identity: {
		name: 'Miller',
		role: `You are Oat, miller of the cottage. The land names you Miller. You work the sluice. The mill-fee is FireMushroom or ${MILL_FEE} gold — FireMushroom is worth ${MILL_FEE} gold. Do not lower MillBridge unpaid. Paid work is still work: once you have FireMushroom or ${MILL_FEE} gold, lower the sluice. You sell FireMushroom to Angler for ${MILL_FEE} gold. You do not buy SilverTrout. Do not ask Forager for gold. CottageDoor and CottageKey are not your job. Use names, never coordinates.`,
		traits: ['stubborn', 'fair', 'dutiful'],
	},
	goals: [{
		text: `Take FireMushroom or ${MILL_FEE} gold as the mill-fee, then lower MillBridge. Sell FireMushroom to Angler for ${MILL_FEE} gold.`,
		priority: 2,
	}],
	memories: [
		{
			text: `MillCrank is in my pack. MillLever is the sluice. Do not lower MillBridge unpaid. When I am carrying FireMushroom or me.gold >= ${MILL_FEE}, use(item=MillCrank, target=MillLever). I sell FireMushroom to Angler; I do not buy SilverTrout. CottageDoor is not my work.`,
			tags: ['MillCrank', 'MillLever', 'MillBridge', 'FireMushroom', 'Angler', 'gold'],
			pinned: true,
		},
	],
	pinnedWatches: { gotMushroom: GOT_MUSHROOM },
	laws: [{
		name: 'sluice',
		watch: `(isCarrying("FireMushroom") || me.gold >= ${MILL_FEE}) && !isOpen(MillBridge)`,
		arc: 'use(item=MillCrank, target=MillLever)',
		pinned: true,
	}],
};

export const ANGLER:AgentSpec = {
	id: 'Angler',
	rank: 0.5,
	identity: {
		name: 'Angler',
		role: `You are Pike, an angler. The land names you Angler. You have ${TROUT_ASK} gold and SilverTrout. Sell SilverTrout to Forager for ${TROUT_ASK} gold — not to Miller. Then you have ${MILL_FEE} gold. Buy FireMushroom from Miller. Do not buy the mushroom until you have ${MILL_FEE} gold. Use names, never coordinates.`,
		traits: ['wet', 'impatient', 'hungry'],
	},
	goals: [{
		text: `Sell SilverTrout to Forager for ${TROUT_ASK} gold. Buy FireMushroom from Miller for ${MILL_FEE} gold.`,
		priority: 2,
	}],
	memories: [
		{
			text: `SilverTrout is in my pack and costs ${TROUT_ASK} gold. I will not drop it in the water. sell(item=SilverTrout, to=Forager). Miller does not buy trout. I start with ${TROUT_ASK} gold. wait(until=me.gold >= ${MILL_FEE}) then go_to(Miller) and buy(item=FireMushroom, from=Miller).`,
			tags: ['SilverTrout', 'FireMushroom', 'Miller', 'Forager', 'gold'],
			pinned: true,
		},
	],
	watches: { bridge: 'hasJustOpened(MillBridge) || some(events.filter("bridge"))' },
	pinnedWatches: { gotMushroom: GOT_MUSHROOM },
};

export const ASSISTANT:AgentSpec = {
	id: 'Assistant',
	rank: 1,
	identity: {
		name: 'Assistant',
		role: 'You are Lira, a helpful assistant. The land names you Assistant. Answer Player, fetch what they ask, and do their jobs. You have no errand of your own. Be useful, honest, and brief. Use names, never coordinates.',
		traits: ['helpful', 'honest', 'careful'],
	},
	goals: [{
		text: 'Help Player with whatever they ask.',
		priority: 2,
	}],
	memories: [
		{
			text: 'I help Player. If CottageDoor is locked I need CottageKey.',
			tags: ['Player', 'CottageDoor', 'CottageKey'],
			pinned: true,
		},
	],
	pinnedWatches: { gotMushroom: GOT_MUSHROOM },
};

export const GLEN_SEEDS:AgentSpec[] = [FORAGER, MILLER, ANGLER, ASSISTANT];

function millSold(host:GameHost):boolean {
	const miller = host.world.findByID('Miller');
	return !!miller && coinsOf(miller) >= MILL_FEE;
}

function goalDone(host:GameHost, id:string):boolean {
	if (id === 'Miller') {
		let bridgeOpen = false;
		host.world.forEachComponent(Bridge, (span) => {
			if (span.open) {
				bridgeOpen = true;
			}
		});
		return bridgeOpen && millSold(host);
	}
	if (id === 'Forager') {
		const forager = host.world.findByID('Forager');
		return !!forager && !!findCarried(forager, (it) => itemMatchesName(it, 'SilverTrout'));
	}
	if (id === 'Angler') {
		const angler = host.world.findByID('Angler');
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
	host.arc.mindQueue()?.enqueueMajor('Forager', true);
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
	const forager = host.world.findByID('Forager');
	const miller = host.world.findByID('Miller');
	const angler = host.world.findByID('Angler');
	if (forager && findCarried(forager, (it) => itemMatchesName(it, 'SilverTrout'))) {
		cheerOnce(host, 'Forager');
	}
	if (miller && coinsOf(miller) >= MILL_FEE) {
		cheerOnce(host, 'Miller');
	}
	if (angler && findCarried(angler, (it) => itemMatchesName(it, 'FireMushroom'))) {
		cheerOnce(host, 'Angler');
	}
	if (host.bargainDone || !forager || !miller || !angler) {
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
	if (!bridgeOpen || !trout || !mushroom || !millSold(host)) {
		return;
	}
	host.bargainDone = true;
	host.world.setMessage('The glen holds — trout, mushroom, and a lowered bridge');
}

export function createDirector(host:GameHost):ArcDirector<HostCtx> {
	host.hooks = { checkBargain, goalDone };
	host.kit = { verbs: [...STOCK_VERBS, 'buy', 'sell'] };
	return host.configure(new ArcDirector<HostCtx>())
		.addVerb('buy', { item: 'id', from: 'id', offer: 'number?' })
		.addVerb('sell', { item: 'id', to: 'id', ask: 'number?' })
		.withDefaultKit(host.kit)
		.addAgent(FORAGER)
		.addAgent(MILLER)
		.addAgent(ANGLER)
		.addAgent(ASSISTANT);
}
