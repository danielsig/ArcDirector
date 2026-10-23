import { CHUNK_SIZE } from '../../world/constants';
import type { ChunkFile } from '../../world/decodeGlyphChunk';
import { GLEN_LEGEND } from './glenLegend';

export const glen_1_1:ChunkFile = {
	id: 'glen_1_1',
	origin: { cx: 1, cz: 1 },
	legend: GLEN_LEGEND,
	tiles: [
		'...............F',
		'...............F',
		'...............F',
		'...............F',
		'>>>>>>>>>>>>>>>>',
		'>>>B>>>>>>>>>>>>',
		'>>>>>>>>>>>>>>>>',
		'...............F',
		'..........chu..F',
		'....oxp..a.....F',
		'.....g%d%%e....F',
		'......%j,+.....F',
		'......%qb%.....F',
		'......%%%%.....F',
		'...............F',
		'FFFFFFFFFFFFFFFF',
	],
	names: {
		d: 'HutDoor',
	},
};

if (glen_1_1.tiles.length !== CHUNK_SIZE) {
	throw new Error('glen_1_1 is not 16 rows');
}
for (const row of glen_1_1.tiles) {
	if (row.length !== CHUNK_SIZE) {
		throw new Error(`glen_1_1 row length ${row.length}`);
	}
}
