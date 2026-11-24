import { splitGlyphMap, type ChunkFile } from '../../world/decode-glyph-chunk';
import { MARKETPLACE_LEGEND } from './marketplace-legend';

/**
 * The marketplace, 2 by 2 chunks, inside the town walls. North-east, ApothecaryShop stands in the corner, bigger than
 * the stalls, slate-roofed, its door opening south onto the square. South-east, SushiStall, staffed by SushiChef, with a bench to eat at, and
 * ToyShop (thatched, smaller) in the corner, its door opening north. Each shop's counter runs from its west wall most
 * of the way across.
 */
export const MARKETPLACE_CHUNKS:ChunkFile[] = splitGlyphMap('marketplace', MARKETPLACE_LEGEND, [
	'################################',
	'#""*"""""*"".,,,,,,,,...%PSPSPz#',
	'#""""""""""".,,,,,,,,...+PPPPPP#',
	'#............,,,,,,,,...%PPPPPP#',
	'#....a...b...,,,,,,,,...%CCCCPP#',
	'#............,,,,,,,,...+PPPPPP#',
	'#............ssssssss...%xPPPPy#',
	'#t......................%%%A%%%#',
	'#..............................#',
	'D..............................#',
	'#..............................#',
	'#t.............................#',
	'#..............................#',
	'#..............................#',
	'#PPPPPPPPPPPPPPPPPPPPPPPPPPPPPP#',
	'>>>>>=>>>>>>>>>==>>>>>>>>>=>>>>>',
	'>>>>>=>>>>>>>>>==>>>>>>>>>=>>>>>',
	'>>>>>=>>>>>>>>>==>>>>>>>>>=>>>>>',
	'#PPPPPPPPPPPPPPPPPPPPPPPPPPPPPP#',
	'#"""...........@...............#',
	'#"*"...........................#',
	'#""".........""""""...........t#',
	'#............"*""*"............#',
	'#............""""""............I',
	'#.............................t#',
	'#..............................#',
	'#.....c......d......g....%%%T%%#',
	'#........................+PPPPu#',
	'#""""""""""""""""""""""..%KKKKP#',
	'#"""*""""""*""""""""*""..%PPPPP#',
	'#""""""""""""""""""""""..%xPSPy#',
	'################################',
], {
	D: 'WestGate',
	a: 'BakerStall',
	b: 'WeaverStall',
	A: 'ApothecaryShopDoor',
	C: 'ApothecaryCounter',
	c: 'PotterStall',
	d: 'CutlerStall',
	I: 'EastGate',
	g: 'SushiStall',
	T: 'ToyShopDoor',
	K: 'ToyCounter',
});
