import { CHUNK_SIZE } from '../../world/constants';
import type { ChunkFile } from '../../world/decodeGlyphChunk';
import { RUINS_LEGEND } from './ruinsLegend';

export const ruins_0_0:ChunkFile = {
	id: 'ruins_0_0',
	origin: { cx: 0, cz: 0 },
	legend: RUINS_LEGEND,
	tiles: [
		'****************',
		'**.o.#..#..#.o**',
		'*.#..........#..',
		'*...............',
		'*#............#.',
		'*...............',
		'*...............',
		'*...............',
		'*...............',
		'*...............',
		'*...............',
		'*#............#.',
		'*...............',
		'*.#..........#..',
		'**.o.........@..',
		'****************',
	],
	names: {},
};

if (ruins_0_0.tiles.length !== CHUNK_SIZE) {
	throw new Error('ruins_0_0 is not 16 rows');
}
for (const row of ruins_0_0.tiles) {
	if (row.length !== CHUNK_SIZE) {
		throw new Error(`ruins_0_0 row length ${row.length}`);
	}
}
