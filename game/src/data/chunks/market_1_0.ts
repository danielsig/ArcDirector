import { CHUNK_SIZE } from '../../world/constants';
import type { ChunkFile } from '../../world/decodeGlyphChunk';
import { MARKET_LEGEND } from './marketLegend';

export const market_1_0:ChunkFile = {
	id: 'market_1_0',
	origin: { cx: 1, cz: 0 },
	legend: MARKET_LEGEND,
	tiles: [
		'################',
		'.%%%%%%%%%%%%%%#',
		'.T,e,,,,,,,,f,T#',
		'.,,,,,,,,,,,,,,#',
		'.,,,,,,,,,,,,,,#',
		'.,,,,,,,,,,,,,,#',
		'.ssssssssssssss#',
		'...............I',
		'....@..........#',
		'...g........h..#',
		'.t............t#',
		'...............#',
		'>>>>>>>....>>>>#',
		'>>>>>>>....>>>>#',
		'...............#',
		'...............#',
	],
	names: {
		I: 'EastGate',
		e: 'SpiceStall',
		f: 'CandleStall',
		g: 'FruitStall',
		h: 'RibbonStall',
	},
};

if (market_1_0.tiles.length !== CHUNK_SIZE) {
	throw new Error('market_1_0 is not 16 rows');
}
for (const row of market_1_0.tiles) {
	if (row.length !== CHUNK_SIZE) {
		throw new Error(`market_1_0 row length ${row.length}`);
	}
}
