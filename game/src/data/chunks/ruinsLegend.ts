import type { EntityLegend, TerrainLegend } from '../../world/decodeGlyphChunk';

export const RUINS_LEGEND:Record<string, TerrainLegend | EntityLegend> = {
	'#': { def: 'wall', height: 2, blocked: true },
	'.': { def: 'grass', height: 0 },
	'*': { kind: 'entity', def: 'tree', over: '.' },
	'o': { kind: 'entity', def: 'boulder', over: '.' },
	'@': { kind: 'entity', def: 'player_start' },
};
