import { CHUNK_SIZE } from '../../world/constants';
import type { ChunkFile } from '../../world/decodeGlyphChunk';
import { GLEN_LEGEND } from './glenLegend';

export const glen_0_1:ChunkFile = {
	id: 'glen_0_1',
	origin: { cx: 0, cz: 1 },
	legend: GLEN_LEGEND,
	tiles: [
		'#...............',
		'#..~~~~.o.....L.',
		'#W~~~~~.........',
		'#~~~~~~.........',
		'#>>>>>>>>>>>>=>>',
		'#>>>>>>>>>>>>=>>',
		'#>>>>>>>>>>>>=>>',
		'#...............',
		'#..o............',
		'#....o..........',
		'#...............',
		'#..o............',
		'#...............',
		'#...............',
		'#...............',
		'################',
	],
	names: {
		W: 'Falls',
		'=': 'Bridge',
		L: 'BridgeLever',
	},
};

if (glen_0_1.tiles.length !== CHUNK_SIZE) {
	throw new Error('glen_0_1 is not 16 rows');
}
for (const row of glen_0_1.tiles) {
	if (row.length !== CHUNK_SIZE) {
		throw new Error(`glen_0_1 row length ${row.length}`);
	}
}
