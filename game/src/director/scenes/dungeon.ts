import { ArcDirector, type CharacterSpec } from 'arc-director';
import { Sickbed, Celebrating } from '../../engine/components';
import { findCarried, itemMatchesName } from '../../items/inventory';
import type { GameHost } from '../adapter';
import { addStatusVerbs, BUILDING_VERB_INSTRUCTIONS, GAME_VERBS } from '../verbs';
import { withReceived, type CharacterCtx } from '../types';

const GATE_OPENED = 'hasJustOpened(EastGate)';

const HERBALIST:CharacterSpec = {
	id: 'Fern',
	mind: {},
	identity: { role: 'Herbalist', traits: ['plain', 'anxious', 'generous'] },
	goals: [{ text: 'Cure Noll: use MagicPotion on NollCot.', priority: 2 }],
	memories: [
		{
			text: 'I am a herbalist. My boy Noll lies fevered on NollCot in Vault, beyond EastGate. I tend him.',
			tags: ['backstory', 'Noll', 'NollCot', 'Vault'],
			pinned: true,
		},
		{
			text: 'Only MagicPotion cures fever. Alchemist brews it from Bitterroot, for a GoldCoin fee.',
			tags: ['MagicPotion', 'Bitterroot', 'Alchemist', 'cure'],
			pinned: true,
		},
		{
			text: 'Bitterroot grows in Vault. Only I can harvest it.',
			tags: ['Bitterroot', 'harvest', 'Vault'],
		},
		{
			text: 'I have no gold of my own.',
			tags: ['GoldCoin', 'gold'],
		},
	],
	pinnedWatches: { gate: GATE_OPENED },
};

const ALCHEMIST:CharacterSpec = {
	id: 'Sable',
	mind: {},
	identity: { role: 'Alchemist', traits: ['proud', 'hungry', 'exact'] },
	goals: [{ text: 'Get paid a GoldCoin, then brew MagicPotion at BrewHearth.', priority: 2 }],
	memories: [
		{
			text: 'I am an alchemist. I brew at BrewHearth in Vault, beyond EastGate. I am penniless and never brew unpaid.',
			tags: ['backstory', 'BrewHearth', 'Vault'],
			pinned: true,
		},
		{
			text: 'One Bitterroot and a GoldCoin fee brew two MagicPotion. I keep the coin and give both potions away.',
			tags: ['brew', 'Bitterroot', 'GoldCoin', 'MagicPotion'],
			pinned: true,
		},
		{
			text: 'A secret only I know: BrassKey, which unlocks EastGate, lies inside ArmoryChest.',
			tags: ['BrassKey', 'ArmoryChest', 'EastGate', 'secret'],
			pinned: true,
		},
	],
	pinnedWatches: { gate: GATE_OPENED },
};

const CAPTAIN:CharacterSpec = {
	id: 'Lys',
	mind: {},
	identity: { role: 'Captain', traits: ['brisk', 'fair', 'worried'] },
	goals: [{ text: 'Cure Lina: use MagicPotion on LinaCot.', priority: 2 }],
	memories: [
		{
			text: 'I am pay-captain of the dungeon watch. My sister Lina lies fevered on LinaCot in Vault, beyond EastGate. I tend her.',
			tags: ['backstory', 'Lina', 'LinaCot', 'Vault'],
			pinned: true,
		},
		{
			text: 'My traveler pack holds ChestKey and GoldCoin. ChestKey unlocks ArmoryChest; I do not know what is inside.',
			tags: ['ChestKey', 'ArmoryChest', 'GoldCoin'],
			pinned: true,
		},
	],
	pinnedWatches: { gate: GATE_OPENED },
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
