import { CHUNK_SIZE } from '../../world/constants';
import type { ChunkFile } from '../../world/decodeGlyphChunk';

export const dungeon_1_0:ChunkFile = {
	id: 'dungeon_1_0',
	origin: { cx: 1, cz: 0 },
	legend: {
		'#': { def: 'wall', height: 2, blocked: true },
		'.': { def: 'floor', height: 0 },
		'T': { kind: 'entity', def: 'wall_torch' },
		'r': { kind: 'entity', def: 'bitterroot' },
		'h': { kind: 'entity', def: 'brew_hearth' },
		'N': { kind: 'entity', def: 'sickbed' },
		'L': { kind: 'entity', def: 'sickbed' },
	},
	tiles: [
		'################',
		'#..............#',
		'#..N........L..#',
		'#..............#',
		'#......h.......#',
		'#T............T#',
		'...............#',
		'#..............#',
		'#..............#',
		'#......r.......#',
		'#..............#',
		'#..............#',
		'#T............T#',
		'#..............#',
		'#..............#',
		'################',
	],
	names: {
		r: 'Bitterroot',
		h: 'BrewHearth',
		N: 'NollCot',
		L: 'LinaCot',
	},
};

if (dungeon_1_0.tiles.length !== CHUNK_SIZE) {
	throw new Error('dungeon_1_0 is not 16 rows');
}
for (const row of dungeon_1_0.tiles) {
	if (row.length !== CHUNK_SIZE) {
		throw new Error(`dungeon_1_0 row length ${row.length}`);
	}
}
