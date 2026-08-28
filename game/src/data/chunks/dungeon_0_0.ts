import { CHUNK_SIZE } from '../../world/constants';
import type { ChunkFile } from '../../world/decodeGlyphChunk';

export const dungeon_0_0:ChunkFile = {
	id: 'dungeon_0_0',
	origin: { cx: 0, cz: 0 },
	legend: {
		'#': { def: 'wall', height: 2, blocked: true },
		'.': { def: 'floor', height: 0 },
		',': { def: 'floor', height: 1 },
		's': { def: 'stairs', height: 1 },
		'T': { kind: 'entity', def: 'wall_torch' },
		't': { kind: 'entity', def: 'wall_torch', over: ',' },
		'C': { kind: 'entity', def: 'chest', over: ',' },
		'@': { kind: 'entity', def: 'player_start' },
		'I': { kind: 'entity', def: 'door', axis: 'x' },
		'p': { kind: 'entity', def: 'health_potion' },
		'o': { kind: 'entity', def: 'health_potion' },
		'B': { kind: 'entity', def: 'traveler_pack' },
		'w': { kind: 'entity', def: 'wooden_torch' },
		'S': { kind: 'entity', def: 'iron_sword' },
		'H': { kind: 'entity', def: 'wooden_shield' },
		'G': { kind: 'entity', def: 'leather_glove' },
		'l': { kind: 'entity', def: 'leather_glove' },
		'm': { kind: 'entity', def: 'bomb' },
	},
	tiles: [
		'################',
		'#........,,t,,,#',
		'#........,,,,,,#',
		'#........,,,C,,#',
		'#........ssss..#',
		'#T............T#',
		'#......@.......I',
		'#..mB..........#',
		'#.pow..........#',
		'#.SHGl.........#',
		'#..............#',
		'#..............#',
		'#T............T#',
		'#..##......##..#',
		'#..............#',
		'################',
	],
	names: {
		C: 'ArmoryChest',
		I: 'EastGate',
	},
};

if (dungeon_0_0.tiles.length !== CHUNK_SIZE) {
	throw new Error('dungeon_0_0 is not 16 rows');
}
for (const row of dungeon_0_0.tiles) {
	if (row.length !== CHUNK_SIZE) {
		throw new Error(`dungeon_0_0 row length ${row.length}`);
	}
}
