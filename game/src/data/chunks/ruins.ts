import { splitGlyphMap, type ChunkFile } from '../../world/decodeGlyphChunk';

/**
 * A forest temple fallen to ruin, mirrored east to west so neither side starts better. Broken outer walls with
 * breaches, a colonnade inside them, a low-walled sanctum with a dais at its heart, and fallen columns and rubble
 * to hide behind. Standing pillars and the walls block arrows; rubble and drums only slow the feet.
 */
const RUINS_ROWS = [
	'********************************',
	'**::*:::*:::*::::::*:::*:::*::**',
	'*:b::::::::::&::::&::::::::::b:*',
	'*:::RRRrrR::RRrrrrRR::RrrRRR:::*',
	'*:::R......................R:::*',
	'*::&r..P..P..P....P..P..P..r&::*',
	'**::R......................R::**',
	'*:::r..:................:..r:::*',
	'*:b:R..P...rrrr..rrrr...P..R:b:*',
	'*:::R......r........r......R:::*',
	'*:::...P...r:......:r...P...:::*',
	'**::.......R........R.......::**',
	'*:::R......r........r......R:::*',
	'*:&:R..P...r..ssss..r...P..R:&:*',
	'*:::R......r.s,,,Bs.r......R:::*',
	'**::R..|.....s,,,,s.....|..R::**',
	'*:::R........s,,,,s........R:::*',
	'*:::R......r.sB,,,s.r......R:::*',
	'*:b:R..P...r..ssss..r...P..R:b:*',
	'*:::R......r........r......R:::*',
	'**::.......R........R.......::**',
	'*:::...P...r:......:r...P...:::*',
	'*:::R......r........r......R:::*',
	'*:&:R..P...rrrr..rrrr...P..R:&:*',
	'*:::r..:................:..r:::*',
	'**::R.........d..d.........R::**',
	'*::&r..P..P..P....P..P..P..r&::*',
	'*:::R...-.......@......-...R:::*',
	'*:::RRrrrR::RRRrrRRR::RrrrRR:::*',
	'*:b::::::::::&::::&::::::::::b:*',
	'**::*:::*:::*::::::*:::*:::*::**',
	'********************************',
];

export const RUINS_CHUNKS:ChunkFile[] = splitGlyphMap('ruins', {
	'*': { kind: 'entity', def: 'tree', over: ':' },
	':': { def: 'grass', height: 0 },
	'.': { def: 'floor', height: 0 },
	',': { def: 'floor', height: 1 },
	's': { def: 'stairs', height: 1 },
	/** Ruined walls: a tall broken stretch, and a low one. */
	'R': { def: 'ruin_wall', height: 3, blocked: true },
	'r': { def: 'ruin_wall', height: 1, blocked: true },
	'P': { kind: 'entity', def: 'pillar', over: '.' },
	'b': { kind: 'entity', def: 'boulder', over: ':' },
	'%': { kind: 'entity', def: 'rubble', over: '.' },
	'&': { kind: 'entity', def: 'rubble', over: ':' },
	'd': { kind: 'entity', def: 'drums', over: '.' },
	'-': { kind: 'entity', def: 'fallenColumn', over: '.', yaw: 0 },
	'|': { kind: 'entity', def: 'fallenColumn', over: '.', yaw: Math.PI / 2 },
	'B': { kind: 'entity', def: 'brazier', over: ',' },
	'@': { kind: 'entity', def: 'player_start', over: '.' },
}, RUINS_ROWS);
