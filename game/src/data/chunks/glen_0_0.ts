import { CHUNK_SIZE } from '../../world/constants';
import type { ChunkFile } from '../../world/decodeGlyphChunk';
import { GLEN_LEGEND } from './glenLegend';

export const glen_0_0:ChunkFile = {
	id: 'glen_0_0',
	origin: { cx: 0, cz: 0 },
	legend: GLEN_LEGEND,
	tiles: [
		'################',
		'#..*..*.....*...',
		'#.*....*..*.....',
		'#..n*.....*..*..',
		'#.*...*.........',
		'#....*...m...*.*',
		'#.*......*......',
		'#...*..*....*...',
		'#.....*.........',
		'#.*.......*.....',
		'#...*..*....*...',
		'#....*..........',
		'#.*......*......',
		'#...*...........',
		'#...............',
		'#...............',
	],
	names: {
		m: 'FireMushroom',
	},
};

if (glen_0_0.tiles.length !== CHUNK_SIZE) {
	throw new Error('glen_0_0 is not 16 rows');
}
for (const row of glen_0_0.tiles) {
	if (row.length !== CHUNK_SIZE) {
		throw new Error(`glen_0_0 row length ${row.length}`);
	}
}
