import { CHUNK_SIZE } from '../../world/constants';
import type { ChunkFile } from '../../world/decodeGlyphChunk';
import { MARKET_LEGEND } from './marketLegend';

export const market_0_0:ChunkFile = {
	id: 'market_0_0',
	origin: { cx: 0, cz: 0 },
	legend: MARKET_LEGEND,
	tiles: [
		'################',
		'#T.%%....%%....#',
		'#..a....b......#',
		'#..............#',
		'#..............#',
		'#..............#',
		'D...............',
		'#...............',
		'#...............',
		'#..............#',
		'#..............#',
		'#..c....d......#',
		'#..%%....%%....#',
		'#T.............#',
		'#..............#',
		'################',
	],
	names: {
		D: 'WestGate',
		a: 'BakerStall',
		b: 'WeaverStall',
		c: 'PotterStall',
		d: 'CutlerStall',
	},
};

if (market_0_0.tiles.length !== CHUNK_SIZE) {
	throw new Error('market_0_0 is not 16 rows');
}
for (const row of market_0_0.tiles) {
	if (row.length !== CHUNK_SIZE) {
		throw new Error(`market_0_0 row length ${row.length}`);
	}
}
