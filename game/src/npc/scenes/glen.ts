import { ArcDirector, STOCK_VERBS, type AgentSpec } from 'arc-director';
import { Bridge, Celebrating } from '../../engine/components';
import type { GameHost } from '../adapter';
import type { HostCtx } from '../types';
import { findCarried, itemMatchesName } from '../../items/inventory';

export const FORAGER:AgentSpec = {
	id: 'Forager',
	rank: 0.5,
	identity: {
		name: 'Forager',
		role: 'You are Wren, a glen forager. The land names you Forager. You harvest FireMushroom. It only grows in the forest among the trees. Use names, never coordinates.',
		traits: ['quiet', 'hungry', 'kind'],
	},
	goals: [{
		text: 'Trade FireMushroom for SilverTrout.',
		priority: 2,
	}],
	memories: [
		{
			text: 'FireMushroom only grows in the forest among the trees. I pick_up FireMushroom there.',
			tags: ['FireMushroom'],
			pinned: true,
		},
	],
	pinnedWatches: {
		hurt: 'isHurt(me)',
		approaching: 'hasHeard || some(others.nearby().approaching())',
		bridge: 'hasJustOpened(MillBridge) || some(events.filter("bridge"))',
	},
	watchesWritable: false,
};

export const MILLER:AgentSpec = {
	id: 'Miller',
	rank: 0.5,
	identity: {
		name: 'Miller',
		role: 'You are Oat, miller of the cottage. The land names you Miller. You work the sluice. MillBridge is your leverage: you do not lower it unpaid. You keep FireMushroom as the mill-fee. Use names, never coordinates.',
		traits: ['stubborn', 'fair', 'tired'],
	},
	goals: [{
		text: 'Get FireMushroom.',
		priority: 2,
	}],
	memories: [
		{
			text: 'MillCrank is in my pack. MillLever is the sluice. MillBridge lowers when I use MillCrank on MillLever. FireMushroom is the mill-fee. I keep the mushroom.',
			tags: ['MillCrank', 'MillLever', 'FireMushroom', 'MillBridge'],
			pinned: true,
		},
	],
};

export const ANGLER:AgentSpec = {
	id: 'Angler',
	rank: 0.5,
	identity: {
		name: 'Angler',
		role: 'You are Pike, an angler. The land names you Angler. SilverTrout is in your pack. Use names, never coordinates.',
		traits: ['wet', 'impatient', 'hungry'],
	},
	goals: [{
		text: 'Trade SilverTrout for FireMushroom.',
		priority: 2,
	}],
	memories: [
		{
			text: 'SilverTrout is in my pack. I will not drop it in the water.',
			tags: ['SilverTrout'],
			pinned: true,
		},
	],
	watches: { bridge: 'hasJustOpened(MillBridge) || some(events.filter("bridge"))' },
};

export const SERVANT:AgentSpec = {
	id: 'Servant',
	rank: 1,
	identity: {
		name: 'Servant',
		role: 'You are Lira, a servant. The land names you Servant. Follow Player when idle. If they tell you to stay, wait there. Use names, never coordinates.',
		traits: ['obedient', 'watchful', 'eager'],
	},
	goals: [{
		text: 'Serve Player.',
		priority: 2,
	}],
	memories: [
		{
			text: 'I serve Player. If CottageDoor is locked I need CottageKey.',
			tags: ['Player', 'follow', 'CottageDoor', 'CottageKey'],
			pinned: true,
		},
	],
};

export const GLEN_SEEDS:AgentSpec[] = [FORAGER, MILLER, ANGLER, SERVANT];

function goalDone(host:GameHost, id:string):boolean {
	if (id === 'Miller') {
		const miller = host.world.findByID('Miller');
		return !!miller && !!findCarried(miller, (it) => itemMatchesName(it, 'FireMushroom'));
	}
	if (id === 'Forager') {
		const forager = host.world.findByID('Forager');
		return !!forager && !!findCarried(forager, (it) => itemMatchesName(it, 'SilverTrout'));
	}
	if (id === 'Angler') {
		const angler = host.world.findByID('Angler');
		return !!angler && !findCarried(angler, (it) => itemMatchesName(it, 'SilverTrout')) && angler.transform.position.z < 20;
	}
	return false;
}

function checkBargain(host:GameHost):void {
	if (host.bargainDone) {
		return;
	}
	const forager = host.world.findByID('Forager');
	const miller = host.world.findByID('Miller');
	const angler = host.world.findByID('Angler');
	if (!forager || !miller || !angler) {
		return;
	}
	let bridgeOpen = false;
	host.world.forEachComponent(Bridge, (span) => {
		if (span.open) {
			bridgeOpen = true;
		}
	});
	const fee = !!findCarried(miller, (it) => itemMatchesName(it, 'FireMushroom'));
	const trout = !!findCarried(forager, (it) => itemMatchesName(it, 'SilverTrout'));
	const crossed = angler.transform.position.z < 20;
	if (!bridgeOpen || !fee || !trout || !crossed) {
		return;
	}
	host.bargainDone = true;
	host.world.setMessage('The glen holds — trout, mushroom, and a lowered bridge');
	for (const go of [forager, miller, angler]) {
		let hop = go.getComponent(Celebrating);
		if (!hop) {
			hop = go.addComponent(new Celebrating());
		}
		hop.until = host.world.time + 48;
		hop.enabled = true;
	}
}

export function createDirector(host:GameHost):ArcDirector<HostCtx> {
	host.hooks = { checkBargain, goalDone };
	return host.configure(new ArcDirector<HostCtx>())
		.withDefaultKit(host.kit = { verbs: [...STOCK_VERBS] })
		.addAgent(FORAGER)
		.addAgent(MILLER)
		.addAgent(ANGLER)
		.addAgent(SERVANT);
}
