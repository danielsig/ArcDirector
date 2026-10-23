import type { EntityLegend, TerrainLegend } from '../../world/decodeGlyphChunk';

const CANAL_FLOW = { x: 1, z: 0 };

/** A shop's door: open all day, no key, named after the shop. A shop keeps no hearth, so no chimney. */
function shopDoor(roof?:EntityLegend['roof'], flipped = false):EntityLegend {
	return { kind: 'entity', def: flipped ? 'door_flipped' : 'door', axis: 'z', over: 'P', locked: false, open: true, roof, chimney: false };
}

/** A prop standing on a shop's floorboards. */
function furnish(def:string, extra:Partial<EntityLegend> = {}):EntityLegend {
	return { kind: 'entity', def, over: 'P', ...extra };
}

export const MARKET_LEGEND:Record<string, TerrainLegend | EntityLegend> = {
	'#': { def: 'wall', height: 2, blocked: true },
	'.': { def: 'floor', height: 0 },
	'"': { def: 'grass', height: 0 },
	',': { def: 'floor', height: 1 },
	's': { def: 'stairs', height: 1 },
	/** Boardwalk along the canal, and the floorboards inside the shops. */
	'P': { def: 'plank', height: 0 },
	'>': { def: 'water', height: 0, blocked: true, flow: CANAL_FLOW },
	/** Footbridge: walkable deck over the flowing canal. */
	'=': { def: 'bridge', height: 0, flow: CANAL_FLOW },
	/** Thin timber walls and windows: the shops. */
	'%': { def: 'wood_wall', height: 0, blocked: true },
	'+': { def: 'window', height: 0, blocked: true },
	/** The town gates: stone piers and iron leaves standing open. */
	'D': { kind: 'entity', def: 'gate', axis: 'x', over: '.', locked: false, open: true, exit: true },
	'I': { kind: 'entity', def: 'gate', axis: 'x', over: '.', locked: false, open: true, exit: true },
	'A': shopDoor('slate', true),
	'T': shopDoor(),
	't': { kind: 'entity', def: 'wall_torch', over: '.' },
	'*': { kind: 'entity', def: 'tree', over: '"' },
	'@': { kind: 'entity', def: 'player_start' },
	a: { kind: 'entity', def: 'stall', over: '.' },
	b: { kind: 'entity', def: 'stall', over: '.' },
	c: { kind: 'entity', def: 'stall', over: '.' },
	d: { kind: 'entity', def: 'stall', over: '.' },
	g: { kind: 'entity', def: 'stall', over: '.' },
	/** A shop counter: a stall indoors, facing the door. A row of them is one counter, out to the walls at its ends. */
	C: furnish('stall'),
	// Inside the shops.
	S: furnish('shelf', { on: ['jars'] }),
	x: furnish('crate'),
	y: furnish('sacks'),
	z: furnish('brazier'),
};
