import type { EntityLegend, TerrainLegend } from '../../world/decodeGlyphChunk';

function water(flow:{ x:number; z:number } = { x: 0, z: 0 }):TerrainLegend {
	return { def: 'water', height: 0, blocked: true, flow };
}

export const GLEN_LEGEND:Record<string, TerrainLegend | EntityLegend> = {
	'#': { def: 'wall', height: 2, blocked: true },
	'%': { def: 'wood_wall', height: 2, blocked: true },
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
	'D': { kind: 'entity', def: 'door', axis: 'z', over: ',', keyID: 'brass' },
	'T': { kind: 'entity', def: 'wall_torch', over: ',' },
	'k': { kind: 'entity', def: 'brass_key', over: '.' },
	'L': { kind: 'entity', def: 'mill_lever', over: '.' },
	'=': { kind: 'entity', def: 'bridge_span', over: '>' },
	'W': { kind: 'entity', def: 'waterfall', over: '~' },
	'm': { kind: 'entity', def: 'fire_mushroom', over: '.' },
	'@': { kind: 'entity', def: 'player_start' },
};
