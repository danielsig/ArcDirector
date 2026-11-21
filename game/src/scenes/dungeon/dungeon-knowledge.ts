import type { KnowledgeEntry } from 'arc-director';

/** The Sunken Crypt, in the order the party meets it. */
export const DUNGEON_KNOWLEDGE:KnowledgeEntry[] = [
	{
		name: 'Crypt',
		aliases: ['dungeon', 'map', 'rooms', 'way', 'route'],
		text: 'This crypt, which you are already inside, room by room: the Gatehouse where you came in; the Storeroom north of it, full of old junk; a passage north out of it choked by Cobweb; the Pillared Hall; SealedDoor on its east wall; the round Ossuary; a winding passage north, east and back south to CryptGate; the Throne Crypt of the HollowKing; HoardGate at its south end; the Treasury with HoardChest. Rooms are not go_to names: go_to the named thing in them. Dead-end side passages may hide potions.',
	},
	{
		name: 'Cobweb',
		aliases: ['web', 'webs', 'spider web'],
		text: 'A thick web blocking the passage north out of the Storeroom, old and dry as tinder.',
	},
	{
		name: 'WoodenTorch',
		aliases: ['torch', 'flame', 'fire'],
		text: 'Item. A lit torch, still burning.',
		item: true,
	},
	{
		name: 'SealedDoor',
		aliases: ['sealed door', 'riddle door', 'door'],
		text: 'Door on the east wall of the Pillared Hall, to the Ossuary. No key opens it. Whoever says the answer to the riddle on RiddleStone aloud, standing near it, opens it: say aloud the one thing the riddle describes.',
	},
	{
		name: 'RiddleStone',
		aliases: ['riddle', 'inscription', 'stone', 'tablet'],
		text: 'Carved stone beside SealedDoor. Its riddle is the password; sight shows the carving. Answer with one word, aloud.',
	},
	{
		name: 'OssuaryChest',
		aliases: ['chest', 'ossuary'],
		text: 'Unlocked chest in the Ossuary. It holds CryptKey.',
	},
	{
		name: 'CryptKey',
		aliases: ['key', 'iron key', 'crypt key'],
		text: 'Item in OssuaryChest. It opens CryptGate.',
		item: true,
	},
	{
		name: 'CryptGate',
		aliases: ['crypt gate', 'gate'],
		text: 'Locked gate into the Throne Crypt, at the end of the winding passage past the Ossuary. Only CryptKey opens it.',
	},
	{
		name: 'HollowKing',
		aliases: ['king', 'boss', 'hollow king', 'weakness'],
		text: 'The dead king of the crypt, in the Throne Crypt. His grave-iron shrugs off steel and arrows: every blow but a hex does half. Witchfire is his weakness: hex does triple. Shield the Witch and let her burn him.',
	},
	{
		name: 'HoardGate',
		aliases: ['hoard gate', 'treasury gate'],
		text: 'Gate at the south end of the Throne Crypt. No key: it opens by itself when the HollowKing falls.',
	},
	{
		name: 'HoardChest',
		aliases: ['hoard', 'treasure', 'treasury'],
		text: 'Unlocked chest in the Treasury behind HoardGate. It holds SunCrown and gold.',
	},
	{
		name: 'SunCrown',
		aliases: ['crown', 'sun crown', 'prize'],
		text: 'Item in HoardChest. What the party came for: taking it ends the quest.',
		item: true,
	},
	{
		name: 'Monsters',
		aliases: ['ghoul', 'skeleton', 'monster', 'undead', 'enemy', 'enemies'],
		text: 'Ghouls, Skeletons, BoneArchers and a CultWitch guard the rooms. They wake when they see you and fight to the death. Your fight laws strike back for you; in a fight, stay together and keep Seraphine behind Valerius.',
	},
	{
		name: 'HealthPotion',
		aliases: ['potion', 'heal'],
		text: 'Item. use(item=HealthPotion) drinks it and heals you a little.',
		item: true,
	},
];
