import { CHUNK_SIZE } from '../../world/constants';
import type { ChunkFile } from '../../world/decodeGlyphChunk';
import { MARKET_LEGEND } from './marketLegend';

/**
 * The north-east quarter: ApothecaryShop stands in the corner of the town walls, bigger than the stalls,
 * slate-roofed, its door opening south onto the square. Its counter runs from the west wall most of the way across.
 */
export const market_1_0:ChunkFile = {
	id: 'market_1_0',
	origin: { cx: 1, cz: 0 },
	legend: MARKET_LEGEND,
	tiles: [
		'################',
		',,,,,...%PSPSPz#',
		',,,,,...+PPPPPP#',
		',,,,,...%PPPPPP#',
		',,,,,...%CCCCPP#',
		',,,,,...+PPPPPP#',
		'sssss...%xPPPPy#',
		'........%%%A%%%#',
		'...............#',
		'...............#',
		'...............#',
		'...............#',
		'...............#',
		'...............#',
		'PPPPPPPPPPPPPPP#',
		'=>>>>>>>>>=>>>>>',
	],
	names: {
		A: 'ApothecaryShopDoor',
		C: 'ApothecaryCounter',
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
