import { CHUNK_SIZE } from '../../world/constants';
import type { ChunkFile } from '../../world/decodeGlyphChunk';
import { GLEN_LEGEND } from './glenLegend';

export const glen_1_0:ChunkFile = {
	id: 'glen_1_0',
	origin: { cx: 1, cz: 0 },
	legend: GLEN_LEGEND,
	tiles: [
		'################',
		'...............#',
		'....o..........#',
		'......%%%%%%...#',
		'......%T,,,%...#',
		'......%,,,,%...#',
		'......%,,,,%...#',
		'......%%D%%%...#',
		'.........k.....#',
		'...............#',
		'....@..........#',
		'...............#',
		'...............#',
		'...............#',
		'...............#',
		'...............#',
	],
	names: {
		D: 'CottageDoor',
		k: 'CottageKey',
		T: 'CottageHearth',
	},
};

if (glen_1_0.tiles.length !== CHUNK_SIZE) {
	throw new Error('glen_1_0 is not 16 rows');
}
for (const row of glen_1_0.tiles) {
	if (row.length !== CHUNK_SIZE) {
		throw new Error(`glen_1_0 row length ${row.length}`);
	}
}
