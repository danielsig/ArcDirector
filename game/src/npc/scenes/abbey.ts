import { ArcDirector, STOCK_VERBS, type AgentSpec } from 'arc-director';
import { Sickbed, Celebrating } from '../../engine/components';
import { worldToChunk } from '../../engine/World';
import { findCarried, itemMatchesName } from '../../items/inventory';
import type { GameHost } from '../adapter';
import type { HostCtx } from '../types';

export const HERBALIST:AgentSpec = {
	id: 'Herbalist',
	identity: {
		name: 'Herbalist',
		role: 'You are Fern, a forager. The hall names you Herbalist. Your boy Noll lies fevered on NollCot in the vault beyond EastGate. You harvest Bitterroot. Use names, never coordinates.',
		traits: ['plain', 'anxious', 'generous'],
	},
	goals: [{
		text: 'See Noll well again.',
		priority: 2,
	}],
	memories: [
		{
			text: 'Noll lies on NollCot in the vault. I tend him. I pick Bitterroot, and it grows past EastGate.',
			tags: ['NollCot', 'Bitterroot', 'EastGate'],
			pinned: true,
		},
	],
};

export const ALCHEMIST:AgentSpec = {
	id: 'Alchemist',
	identity: {
		name: 'Alchemist',
		role: 'You are Sable, a vault alchemist. The hall names you Alchemist. You are penniless and will not brew unpaid. You know a secret: BrassKey is inside locked ArmoryChest. You brew at BrewHearth. Keep the coin. Give the vials away. Use names, never coordinates.',
		traits: ['proud', 'hungry', 'exact'],
	},
	goals: [{
		text: 'Get paid, brew the cure, keep the coin.',
		priority: 2,
	}],
	memories: [
		{
			text: 'I brew at BrewHearth in the vault. Bitterroot and GoldCoin make two MagicPotion. I keep the coin. I give the vials away. BrassKey is inside ArmoryChest.',
			tags: ['brew', 'BrewHearth', 'Bitterroot', 'GoldCoin', 'MagicPotion', 'ArmoryChest'],
			pinned: true,
		},
	],
};

export const CAPTAIN:AgentSpec = {
	id: 'Captain',
	identity: {
		name: 'Captain',
		role: 'You are Lys, pay-captain of the abbey watch. The hall names you Captain. Your sister Lina lies fevered on LinaCot in the vault. ChestKey and GoldCoin start in your pack. ChestKey opens ArmoryChest; you do not know what is inside. Use names, never coordinates.',
		traits: ['brisk', 'fair', 'worried'],
	},
	goals: [{
		text: 'See Lina well again.',
		priority: 2,
	}],
	memories: [
		{
			text: 'ChestKey and GoldCoin are in my traveler pack. ChestKey opens ArmoryChest. I do not know what is inside. Lina lies on LinaCot in the vault. I tend her.',
			tags: ['ChestKey', 'ArmoryChest', 'GoldCoin', 'LinaCot'],
			pinned: true,
		},
	],
};

export const ABBEY_SEEDS:AgentSpec[] = [HERBALIST, ALCHEMIST, CAPTAIN];

function inVault(host:GameHost, id:string):boolean {
	const go = host.world.findByID(id);
	if (!go) {
		return false;
	}
	const { cx, cz } = worldToChunk(go.transform.position.x, go.transform.position.z);
	return cx === 1 && cz === 0;
}

function cotTended(host:GameHost, id:string):boolean {
	const cot = host.world.findNamed(id);
	return !!cot?.getComponent(Sickbed)?.tended;
}

function goalDone(host:GameHost, id:string):boolean {
	if (id === 'Herbalist') {
		return cotTended(host, 'NollCot');
	}
	if (id === 'Captain') {
		return cotTended(host, 'LinaCot');
	}
	if (id === 'Alchemist') {
		const alchemist = host.world.findByID('Alchemist');
		return cotTended(host, 'NollCot')
			&& cotTended(host, 'LinaCot')
			&& !!alchemist
			&& !!findCarried(alchemist, (it) => itemMatchesName(it, 'GoldCoin'));
	}
	return false;
}

function checkBargain(host:GameHost):void {
	if (host.bargainDone) {
		return;
	}
	const herbalist = host.world.findByID('Herbalist');
	const alchemist = host.world.findByID('Alchemist');
	const captain = host.world.findByID('Captain');
	if (!herbalist || !alchemist || !captain) {
		return;
	}
	const gold = !!findCarried(alchemist, (it) => itemMatchesName(it, 'GoldCoin'));
	if (
		!cotTended(host, 'NollCot')
		|| !cotTended(host, 'LinaCot')
		|| !gold
		|| !inVault(host, 'Herbalist')
		|| !inVault(host, 'Alchemist')
		|| !inVault(host, 'Captain')
	) {
		return;
	}
	host.bargainDone = true;
	host.world.setMessage('The vault holds — Noll and Lina tend, the coin is paid');
	for (const go of [herbalist, alchemist, captain]) {
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
		.addVerb('set_status', { text: 'string', seconds: 'number?' })
		.addVerb('rest', {})
		.withDefaultKit(host.kit = { verbs: [...STOCK_VERBS, 'set_status', 'rest'] })
		.addAgent(HERBALIST)
		.addAgent(ALCHEMIST)
		.addAgent(CAPTAIN);
}
