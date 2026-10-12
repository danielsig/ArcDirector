import type { EntityLegend, TerrainLegend } from '../../world/decodeGlyphChunk';

const CANAL_FLOW = { x: 1, z: 0 };

export const MARKET_LEGEND:Record<string, TerrainLegend | EntityLegend> = {
	'#': { def: 'wall', height: 2, blocked: true },
	'.': { def: 'floor', height: 0 },
	'"': { def: 'grass', height: 0 },
	',': { def: 'floor', height: 1 },
	's': { def: 'stairs', height: 1 },
	'P': { def: 'plank', height: 0 },
	'>': { def: 'water', height: 0, blocked: true, flow: CANAL_FLOW },
	/** Footbridge: walkable deck over the flowing canal. */
	'=': { def: 'bridge', height: 0, flow: CANAL_FLOW },
	'D': { kind: 'entity', def: 'door', axis: 'x', over: '.', locked: false, open: true, exit: true },
	'I': { kind: 'entity', def: 'door', axis: 'x', over: '.', locked: false, open: true, exit: true },
	't': { kind: 'entity', def: 'wall_torch', over: '.' },
	'*': { kind: 'entity', def: 'tree', over: '"' },
	'@': { kind: 'entity', def: 'player_start' },
	a: { kind: 'entity', def: 'stall', over: '.' },
	b: { kind: 'entity', def: 'stall', over: '.' },
	c: { kind: 'entity', def: 'stall', over: '.' },
	d: { kind: 'entity', def: 'stall', over: '.' },
	e: { kind: 'entity', def: 'stall', over: '.' },
	f: { kind: 'entity', def: 'stall', over: '.' },
	g: { kind: 'entity', def: 'stall', over: '.' },
	h: { kind: 'entity', def: 'stall', over: '.' },
};
