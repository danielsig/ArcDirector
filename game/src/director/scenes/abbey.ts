import { ArcDirector, type CharacterSpec } from 'arc-director';
import { Sickbed, Celebrating } from '../../engine/components';
import { findCarried, itemMatchesName } from '../../items/inventory';
import type { GameHost } from '../adapter';
import { addStatusVerbs, BUILDING_VERB_INSTRUCTIONS, GAME_VERBS } from '../verbs';
import { withReceived, type CharacterCtx } from '../types';

const HERBALIST:CharacterSpec = {
	id: 'Fern',
	mind: {},
	identity: { role: 'Herbalist', traits: ['plain', 'anxious', 'generous'] },
	goals: [{
		text: 'See Noll well again.',
		priority: 2,
	}],
	memories: [
		{
			text: 'I am a forager. My boy Noll lies fevered on NollCot in the vault beyond EastGate. I harvest Bitterroot. Use names, never coordinates.',
			tags: ['backstory', 'NollCot', 'Bitterroot'],
			pinned: true,
		},
		{
			text: 'Noll lies on NollCot in the vault. I tend him. I pick Bitterroot, and it grows past EastGate.',
			tags: ['NollCot', 'Bitterroot', 'EastGate'],
			pinned: true,
		},
	],
};

const ALCHEMIST:CharacterSpec = {
	id: 'Sable',
	mind: {},
	identity: { role: 'Alchemist', traits: ['proud', 'hungry', 'exact'] },
	goals: [{
		text: 'Get paid, brew the cure, keep the coin.',
		priority: 2,
	}],
	memories: [
		{
			text: 'I am a vault alchemist. I am penniless and will not brew unpaid. I know a secret: BrassKey is inside locked ArmoryChest. Use names, never coordinates.',
			tags: ['backstory', 'BrassKey', 'ArmoryChest'],
			pinned: true,
		},
		{
			text: 'I brew at BrewHearth in the vault. Bitterroot and GoldCoin make two MagicPotion. I keep the coin. I give the vials away. BrassKey is inside ArmoryChest.',
			tags: ['brew', 'BrewHearth', 'Bitterroot', 'GoldCoin', 'MagicPotion', 'ArmoryChest'],
			pinned: true,
		},
	],
};

const CAPTAIN:CharacterSpec = {
	id: 'Lys',
	mind: {},
	identity: { role: 'Captain', traits: ['brisk', 'fair', 'worried'] },
	goals: [{
		text: 'See Lina well again.',
		priority: 2,
	}],
	memories: [
		{
			text: 'I am pay-captain of the dungeon watch. My sister Lina lies fevered on LinaCot in the vault. Use names, never coordinates.',
			tags: ['backstory', 'LinaCot'],
			pinned: true,
		},
		{
			text: 'ChestKey and GoldCoin are in my traveler pack. ChestKey opens ArmoryChest. I do not know what is inside. Lina lies on LinaCot in the vault. I tend her.',
			tags: ['ChestKey', 'ArmoryChest', 'GoldCoin', 'LinaCot'],
			pinned: true,
		},
	],
};

function inVault(host:GameHost, id:string):boolean {
	const go = host.world.findByID(id);
	if (!go) {
		return false;
	}
	const { cx, cz } = host.world.chunkCoordAt(go.transform.position.x, go.transform.position.z);
	return cx === 1 && cz === 0;
}

function cotTended(host:GameHost, id:string):boolean {
	const cot = host.world.findNamed(id);
	return !!cot?.getComponent(Sickbed)?.tended;
}

function goalDone(host:GameHost, id:string):boolean {
	if (id === HERBALIST.id) {
		return cotTended(host, 'NollCot');
	}
	if (id === CAPTAIN.id) {
		return cotTended(host, 'LinaCot');
	}
	if (id === ALCHEMIST.id) {
		const alchemist = host.world.findByID(ALCHEMIST.id);
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
	const herbalist = host.world.findByID(HERBALIST.id);
	const alchemist = host.world.findByID(ALCHEMIST.id);
	const captain = host.world.findByID(CAPTAIN.id);
	if (!herbalist || !alchemist || !captain) {
		return;
	}
	const gold = !!findCarried(alchemist, (it) => itemMatchesName(it, 'GoldCoin'));
	if (
		!cotTended(host, 'NollCot')
		|| !cotTended(host, 'LinaCot')
		|| !gold
		|| !inVault(host, HERBALIST.id)
		|| !inVault(host, ALCHEMIST.id)
		|| !inVault(host, CAPTAIN.id)
	) {
		return;
	}
	host.bargainDone = true;
	host.world.setMessage('The vault holds — Noll and Lina tend, the coin is paid');
	for (const go of [herbalist, alchemist, captain]) {
		const hop = go.getOrAddComponent(Celebrating);
		hop.until = host.world.time + 48;
		hop.enabled = true;
	}
}

export function createDirector(host:GameHost):ArcDirector<CharacterCtx> {
	host.hooks = { checkBargain, goalDone };
	return addStatusVerbs(host.configure(new ArcDirector<CharacterCtx>()), host)
		.withDefaultKit(host.kit = { verbs: [...GAME_VERBS, 'set_status', 'rest'] })
		.withVerbInstructions(BUILDING_VERB_INSTRUCTIONS)
		.withNames({ seen: (observer, target) => host.characterOf(target.id)?.persona.identity.role ?? target.id })
		.addCharacter(withReceived(HERBALIST))
		.addCharacter(withReceived(ALCHEMIST))
		.addCharacter(withReceived(CAPTAIN));
}
