import { dungeonTheme } from '../../audio/songs';
import { DUNGEON_LOOK } from '../../render/look';
import type { Scene } from '../scene';
import { directDungeon, DUNGEON_CAST, DUNGEON_HOOKS, KNIGHT, HEALER, WITCH } from './dungeon-crawl';
import { DUNGEON_KNOWLEDGE } from './dungeon-knowledge';
import { DUNGEON_CHUNKS } from './dungeon-map';

export const DUNGEON:Scene = {
	id: 'dungeon',
	title: 'Dungeon Crawl',
	blurb: 'A party of three works its way through a five-room crypt.',
	look: DUNGEON_LOOK,
	music: dungeonTheme(),
	knowledge: DUNGEON_KNOWLEDGE,
	// Solid rock past the crypt's walls: black, not more floor.
	ground: 'void',
	healthBars: true,
	minimapFollow: true,
	// Play as Participant and the party's archer, Kaelen, is you.
	player: { name: 'Kaelen', tags: ['Archer'], equip: ['short_bow'] },
	chunks: DUNGEON_CHUNKS,
	rooms: [
		{ name: 'Gatehouse', from: [3, 37], to: [12, 44], memory: 'The Gatehouse, where we came down into the crypt. Cold air breathes up from the north.' },
		{ name: 'Storeroom', from: [3, 30], to: [13, 35], memory: 'Dusty old junk fills the Storeroom, dry as tinder, and a thick web chokes the passage north.', memories: { [WITCH.id]: 'A cobweb. I hate the very sight of cobwebs: they make my skin crawl, and I want that one gone.' } },
		{ name: 'PillaredHall', from: [2, 12], to: [19, 26], memory: 'Claw marks score the pillars of the Pillared Hall, and something shuffles in the dark between them.' },
		{ name: 'Ossuary', from: [29, 13], to: [40, 24], memory: 'The Ossuary reeks of rot, and old bones crunch underfoot.' },
		{ name: 'ThroneCrypt', from: [46, 9], to: [62, 31], memory: 'The HollowKing\'s throne room, cold as the grave. Here he dies, and the treasure is ours.', memories: {
			[KNIGHT.id]: 'Steel barely scratches the HollowKing; Morrigan\'s witchfire burns him. I keep him off her while she hexes.',
			[HEALER.id]: 'Steel barely scratches the HollowKing; Morrigan\'s witchfire burns him. I keep Morrigan alive above all.',
			[WITCH.id]: 'Steel barely scratches the HollowKing, but my witchfire burns him: I hex him from behind Valerius.',
		} },
		{ name: 'Treasury', from: [51, 33], to: [58, 40], memory: 'Gold glints everywhere in the Treasury.' },
	],
	cast: DUNGEON_CAST,
	ambient: 'Black stone halls of the crypt, deep under the hills, lit by old torches.',
	brief: `A party of three, Valerius the knight, Seraphine the healer and Morrigan the witch, goes down into the Sunken Crypt for the SunCrown in its treasury. Kaelen, their archer, is you: set Player to Participant to join them, or stay an Observer and watch. Valerius gives the orders, and any of them may solve a puzzle; if he falls, Morrigan leads.

Five rooms lie between them and the crown, joined by winding passages with dead ends. North of the Gatehouse, a Cobweb chokes the way out of the Storeroom; a flame burns it, and a WoodenTorch lies among the Storeroom's junk. In the Pillared Hall, SealedDoor opens to whoever speaks the answer to the riddle on RiddleStone (footsteps). The Ossuary keeps CryptKey in OssuaryChest, and CryptKey opens CryptGate. Beyond it the HollowKing guards the Throne Crypt. Everyone knows his weakness: steel and arrows barely scratch him, but witchfire burns, so Morrigan's hex does triple damage. When he falls, HoardGate opens on the Treasury, and the SunCrown waits in HoardChest.

Monsters in each room wake when the party comes in sight and fight to the death. It is done when someone in the party holds the SunCrown.`,
	hooks: DUNGEON_HOOKS,
	direct: directDungeon,
};
