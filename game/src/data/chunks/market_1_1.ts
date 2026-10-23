import { CHUNK_SIZE } from '../../world/constants';
import type { ChunkFile } from '../../world/decodeGlyphChunk';
import { MARKET_LEGEND } from './marketLegend';

/**
 * The south-east quarter: FruitStall, staffed by Grocer, and ToyShop (thatched, smaller than ApothecaryShop) in the
 * corner of the town walls, its door opening north onto the square. Its counter runs from the west wall most of the
 * way across.
 */
export const market_1_1:ChunkFile = {
	id: 'market_1_1',
	origin: { cx: 1, cz: 1 },
	legend: MARKET_LEGEND,
	tiles: [
		'=>>>>>>>>>=>>>>>',
		'=>>>>>>>>>=>>>>>',
		'PPPPPPPPPPPPPPP#',
		'...............#',
		'...............#',
		'"""...........t#',
		'"*"............#',
		'"""............I',
		'..............t#',
		'...............#',
		'....g....%%%T%%#',
		'.........+PPPPP#',
		'"""""""..%CCCCP#',
		'""""*""..%PPPPP#',
		'"""""""..%xPSPy#',
		'################',
	],
	names: {
		I: 'EastGate',
		g: 'FruitStall',
		T: 'ToyShopDoor',
		C: 'ToyCounter',
	},
};

if (market_1_1.tiles.length !== CHUNK_SIZE) {
	throw new Error('market_1_1 is not 16 rows');
}
for (const row of market_1_1.tiles) {
	if (row.length !== CHUNK_SIZE) {
		throw new Error(`market_1_1 row length ${row.length}`);
	}
}
