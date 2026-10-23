import { TILE_HEIGHT, WALL_HEIGHT } from '../../world/constants';
import type { EntityLegend, TerrainLegend } from '../../world/decodeGlyphChunk';

const CLIFF = WALL_HEIGHT / TILE_HEIGHT;

function water(flow:{ x:number; z:number } = { x: 0, z: 0 }):TerrainLegend {
	return { def: 'water', height: 0, blocked: true, flow };
}

export const GLEN_LEGEND:Record<string, TerrainLegend | EntityLegend> = {
	/** The cliff on the west side, as high as the waterfall pours from. */
	'#': { def: 'cliff', height: CLIFF, blocked: true },
	/** The river on the clifftop that feeds the waterfall. */
	'R': { def: 'cliff_water', height: CLIFF, blocked: true, flow: { x: 1, z: 0 } },
	/** Woods too thick to walk into, where the river leaves the glen. */
	'F': { def: 'forest', height: 0, blocked: true },
	/** A dark road into the woods; the road on the map runs up to it. */
	':': { def: 'trail', height: 0, blocked: true },
	/** Thin walls stand on the floor: bodies walk the open halves of their cells. */
	'%': { def: 'wood_wall', height: 0, blocked: true },
	'+': { def: 'window', height: 0, blocked: true },
	'.': { def: 'grass', height: 0 },
	',': { def: 'plank', height: 0 },
	'~': water(),
	'>': water({ x: 1, z: 0 }),
	'<': water({ x: -1, z: 0 }),
	'v': water({ x: 0, z: 1 }),
	'^': water({ x: 0, z: -1 }),
	/** Numpad diagonals: 7 NW, 9 NE, 1 SW, 3 SE. */
	'1': water({ x: -1, z: 1 }),
	'3': water({ x: 1, z: 1 }),
	'7': water({ x: -1, z: -1 }),
	'9': water({ x: 1, z: -1 }),
	'*': { kind: 'entity', def: 'tree', over: '.' },
	'o': { kind: 'entity', def: 'boulder', over: '.' },
	/**
	 * Boulders standing in the still pool under the waterfall: ripples all round (`O`), or trailing a little east in
	 * a wide arch (`N`). `B` stands in the current, which draws its ripples.
	 */
	'O': { kind: 'entity', def: 'boulder', over: '~' },
	'N': { kind: 'entity', def: 'boulder', over: '~', wake: { x: 0.24, z: -0.13, spread: 1.5 } },
	'B': { kind: 'entity', def: 'boulder', over: '>' },
	'D': { kind: 'entity', def: 'door', axis: 'z', over: ',', keyID: 'brass' },
	/** A door no key locks. */
	'd': { kind: 'entity', def: 'door', axis: 'z', over: ',', locked: false },
	'b': { kind: 'entity', def: 'bed', over: ',' },
	/** A chair facing north, over the river. */
	'h': { kind: 'entity', def: 'chair', over: '.', yaw: Math.PI },
	// The angler's yard and room.
	'a': { kind: 'entity', def: 'fishRack', over: '.' },
	'c': { kind: 'entity', def: 'creel', over: '.', offset: { x: 0.3, z: 0.1 } },
	'u': { kind: 'entity', def: 'bucket', over: '.', offset: { x: -0.1, z: 0.2 } },
	'e': { kind: 'entity', def: 'oars', over: '.', offset: { x: -0.45, z: 0 } },
	'g': { kind: 'entity', def: 'net', over: '.', offset: { x: 0.1, z: 0 } },
	'p': { kind: 'entity', def: 'barrel', over: '.', offset: { x: -0.1, z: 0.15 } },
	'x': { kind: 'entity', def: 'crate', over: '.', offset: { x: 0.15, z: 0.2 }, on: ['bucket'] },
	/** A big shelf on the south wall by the bed, the night's plate still on it, and a chair drawn up to it. */
	'q': { kind: 'entity', def: 'wallShelf', over: ',', offset: { x: -0.15, z: 0.3 }, on: ['plate'] },
	'j': { kind: 'entity', def: 'chair', over: ',', yaw: 0, offset: { x: -0.15, z: 1.05 } },
	'T': { kind: 'entity', def: 'wall_torch', over: ',' },
	'k': { kind: 'entity', def: 'brass_key', over: '.' },
	'L': { kind: 'entity', def: 'bridge_lever', over: '.' },
	'=': { kind: 'entity', def: 'bridge_span', over: '>' },
	'W': { kind: 'entity', def: 'waterfall', over: '~' },
	'm': { kind: 'entity', def: 'fire_mushroom', over: '.' },
	'n': { kind: 'entity', def: 'moon_mushroom', over: '.' },
	'@': { kind: 'entity', def: 'player_start' },
};
