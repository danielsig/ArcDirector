import type { Climb } from '@arc-director/kindling';
import type { Surface } from '../kit/land/land';

/** Tops of the floor sheets, meters above `height * TILE_HEIGHT`. The chunk mesh draws these; feet stand on them. */
export const GRASS_Y = 0.012;
export const STONE_Y = 0.002;
export const PLANK_Y = 0.03;
export const DECK_TOP = 0.04;
/** A river's see-through surface, and its opaque bed 1 cm under it, where feet rest. */
export const WATER_UPPER_Y = GRASS_Y - 0.12;
export const WATER_LOWER_Y = WATER_UPPER_Y - 0.01;

/** What a terrain def is. `surface`, `deck`, `wade` and `climb` are Kindling's `TileSpec`, copied onto every tile of the def at decode. */
export type TerrainKind = {
	surface:Surface;
	/** Where a foot rests above the tile height: a floor sheet, a river's bed. None on a block or blocked land. */
	deck?:number;
	wade?:true;
	climb?:Climb;
	/** Drawn as land (cliff tiles, rivers on clifftops, woods), not as a block. */
	land?:true;
	/** One board down the middle of the cell (`thin-wall.ts`). */
	thin?:true;
	/** Water is drawn here (open water, and the deck of a footbridge over it). */
	water?:true;
	/** Needs the nature textures before it can draw. */
	nature?:true;
};

const KINDS = {
	floor: { surface: 'floor', deck: STONE_Y },
	stairs: { surface: 'floor', deck: STONE_Y, climb: {} },
	grass: { surface: 'meadow', deck: GRASS_Y, nature: true },
	plank: { surface: 'wood', deck: PLANK_Y, nature: true },
	bridge: { surface: 'wood', deck: DECK_TOP, water: true },
	water: { surface: 'water', deck: WATER_LOWER_Y, wade: true, water: true, nature: true },
	wall: { surface: 'rock' },
	ruin_wall: { surface: 'rock' },
	wood_wall: { surface: 'wood', thin: true, nature: true },
	window: { surface: 'wood', thin: true, nature: true },
	cliff: { surface: 'meadow', land: true, nature: true },
	cliff_water: { surface: 'water', land: true, nature: true },
	forest: { surface: 'forest', land: true, nature: true },
	trail: { surface: 'trail', land: true, nature: true },
} as const satisfies Record<string, TerrainKind>;

/** The terrain defs a legend may name. */
export type TerrainDef = keyof typeof KINDS;

/** What each terrain def is. */
export const TERRAIN:Record<TerrainDef, TerrainKind> = KINDS;
