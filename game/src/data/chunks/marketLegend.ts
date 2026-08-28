import type { EntityLegend, TerrainLegend } from '../../world/decodeGlyphChunk';

export const MARKET_LEGEND:Record<string, TerrainLegend | EntityLegend> = {
	'#': { def: 'wall', height: 2, blocked: true },
	'%': { def: 'wood_wall', height: 2, blocked: true },
	'.': { def: 'floor', height: 0 },
	',': { def: 'plank', height: 0 },
	'D': { kind: 'entity', def: 'door', axis: 'x', over: '.', locked: false, open: false, exit: true },
	'I': { kind: 'entity', def: 'door', axis: 'x', over: '.', locked: false, open: false, exit: true },
	'T': { kind: 'entity', def: 'wall_torch', over: '.' },
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
