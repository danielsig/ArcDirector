import { CHUNK_SIZE } from '../../world/constants';
import type { ChunkFile } from '../../world/decodeGlyphChunk';
import { MARKET_LEGEND } from './marketLegend';

export const market_0_1:ChunkFile = {
	id: 'market_0_1',
	origin: { cx: 0, cz: 1 },
	legend: MARKET_LEGEND,
	tiles: [
		'>>>>>=>>>>>>>>>=',
		'>>>>>=>>>>>>>>>=',
		'#PPPPPPPPPPPPPPP',
		'#"""...........@',
		'#"*"............',
		'#"""........."""',
		'#............"*"',
		'#............"""',
		'#...............',
		'#...............',
		'#.....c......d..',
		'#...............',
		'#"""""""""""""""',
		'#"""*""""""*""""',
		'#"""""""""""""""',
		'################',
	],
	names: {
		c: 'PotterStall',
		d: 'CutlerStall',
	},
};

if (market_0_1.tiles.length !== CHUNK_SIZE) {
	throw new Error('market_0_1 is not 16 rows');
}
for (const row of market_0_1.tiles) {
	if (row.length !== CHUNK_SIZE) {
		throw new Error(`market_0_1 row length ${row.length}`);
	}
}
