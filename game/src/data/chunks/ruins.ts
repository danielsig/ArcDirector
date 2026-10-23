import { splitGlyphMap, type ChunkFile } from '../../world/decodeGlyphChunk';

/**
 * A forest temple fallen to ruin in the middle of a wood, mirrored east to west so neither side starts better. Broken
 * outer walls with breaches, a colonnade inside them, a low-walled sanctum with a dais at its heart, two braziers on it,
 * and fallen columns and rubble to hide behind. A paved road comes out of the wood on each side and forks to that
 * side's two breaches. Standing pillars and the walls block arrows; rubble and drums only slow the feet.
 */
const RUINS_ROWS = [
	'****************************************************************',
	'*::::::*:*:**:::**::*:::*:::*::::::*:::*:::*::**:::**:*:*::::::*',
	'*:*::::**:::*:*:*:b::::::::::&::::&::::::::::b:*:*:*:::**::::*:*',
	'*::*::*::::::**:*:::RRRrrR::RRrrrrRR::RrrRRR:::*:**::::::*::*::*',
	'*::::*::*:*:::::*:::R......................R:::*:::::*:*::*::::*',
	'***:*::::::***::*::&r..P..P..P....P..P..P..r&::*::***::::::*:***',
	'**:::b*:::*::::***::R......................R::***::::*:::*b:::**',
	'*bb*::::*:::::***:::r..:................:..r:::***:::::*::::*bb*',
	'*:::::::*::**:::*:b:R..P...rrrr..rrrr...P..R:b:*:::**::*:::::::*',
	'**:::::::*:::*:**:::R......r........r......R:::**:*:::*:::::::**',
	'**::::::*:::*:::*___...P...r:......:r...P...___*:::*:::*::::::**',
	'***::::::::*::*:*___.......R........R.......___*:*::*::::::::***',
	'*:*::b:*::*:*:::*__:R....3.r........r.8....R:__*:::*:*::*:b::*:*',
	'*:::::*:*:*::*::*__:R..P...r..ssss..r...P..R:__*::*::*:*:*:::::*',
	'*::::::::::::&::*__:R.....1r.s,,,Bs.r6.....R:__*::&::::::::::::*',
	'*__________________:R..|.....s,,,,s.....|..R:__________________*',
	'*__________________:R...5....s,,,,s....0...R:__________________*',
	'*:::::::::::::::*__:R.....2r.sQ,,,s.r7.....R:__*:::::::::::::::*',
	'*::::::*::::*:::*__:R..P...r..ssss..r...P..R:__*:::*::::*::::::*',
	'*::::::::**:::::*__:R....4.r........r.9....R:__*:::::**::::::::*',
	'******:*::*:::*:*___.......R....@...R.......___*:*:::*::*:******',
	'*::*:*:*b*:**:::*___...P...r:......:r...P...___*:::**:*b*:*:*::*',
	'*:::::*::**::::**:::R......r........r......R:::**::::**::*:::::*',
	'*b:*::*::*::::*:*:&:R..P...rrrr..rrrr...P..R:&:*:*::::*::*::*:b*',
	'*:::*:::*::::::**:::r..:................:..r:::**::::::*:::*:::*',
	'*:****:*:*:*::::**::R.........d..d.........R::**::::*:*:*:****:*',
	'*:::*:::::**:*:**::&r..P..P..P....P..P..P..r&::**:*:**:::::*:::*',
	'*:*:::**:*:::::**:::R...-..............-...R:::**:::::*:**:::*:*',
	'*:::::**:**:::::*:::RRrrrR::RRRrrRRR::RrrrRR:::*:::::**:**:::::*',
	'**::*::::*:*:*::*:b::::::::::&::::&::::::::::b:*::*:*:*::::*::**',
	'******::b*:b::*:**::*:::*:::*::::::*:::*:::*::**:*::b:*b::******',
	'****************************************************************',
];

const PILLAR = { kind: 'entity', def: 'pillar', over: '.' } as const;
const COLUMN = { kind: 'entity', def: 'fallenColumn', over: '.', yaw: Math.PI / 2 } as const;
const STUMP = { kind: 'entity', def: 'pillar_broken', over: '.' } as const;

export const RUINS_CHUNKS:ChunkFile[] = splitGlyphMap('ruins', {
	'*': { kind: 'entity', def: 'tree', over: ':' },
	':': { def: 'grass', height: 0 },
	'.': { def: 'floor', height: 0 },
	',': { def: 'floor', height: 1 },
	's': { def: 'stairs', height: 1 },
	/** Ruined walls: a tall broken stretch, and a low one. */
	'R': { def: 'ruin_wall', height: 3, blocked: true },
	'r': { def: 'ruin_wall', height: 1, blocked: true },
	'P': PILLAR,
	'b': { kind: 'entity', def: 'boulder', over: ':' },
	'%': { kind: 'entity', def: 'rubble', over: '.' },
	'&': { kind: 'entity', def: 'rubble', over: ':' },
	'd': { kind: 'entity', def: 'drums', over: '.' },
	'-': { kind: 'entity', def: 'fallenColumn', over: '.', yaw: 0 },
	'|': COLUMN,
	/** Broken pillars by the sanctum's west and east gaps, named: where each fighter heads as its party comes in. */
	'1': STUMP, '2': STUMP, '3': STUMP, '4': STUMP, '5': STUMP, '6': STUMP, '7': STUMP, '8': STUMP, '9': STUMP, '0': STUMP,
	'B': { kind: 'entity', def: 'brazier', over: ',' },
	'Q': { kind: 'entity', def: 'brazier', over: ',' },
	/** The old paved road through the wood. */
	'_': { def: 'floor', height: 0 },
	'@': { kind: 'entity', def: 'player_start', over: '.' },
}, RUINS_ROWS, {
	B: 'EastBrazier',
	Q: 'WestBrazier',
	1: 'StumpW1',
	2: 'StumpW2',
	3: 'StumpW3',
	4: 'StumpW4',
	5: 'StumpW5',
	6: 'StumpE1',
	7: 'StumpE2',
	8: 'StumpE3',
	9: 'StumpE4',
	0: 'StumpE5',
});
