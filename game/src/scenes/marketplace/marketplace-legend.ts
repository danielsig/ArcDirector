import { MarketplaceGate } from '../../engine/components';
import type { EntityLegend, TerrainLegend } from '../../world/decode-glyph-chunk';
import { postLegend } from './wares';

const CANAL_FLOW = { x: 1, z: 0 };

/** A shop's door: open all day, no key, named after the shop. A shop keeps no hearth, so no chimney. */
function shopDoor(roof?:EntityLegend['roof'], flipped = false):EntityLegend {
	return { kind: 'entity', def: flipped ? 'door_flipped' : 'door', axis: 'z', over: 'P', locked: false, open: true, roof, chimney: false };
}

/** A prop standing on a shop's floorboards. */
function furnish(def:string, extra:Partial<EntityLegend> = {}):EntityLegend {
	return { kind: 'entity', def, over: 'P', ...extra };
}

export const MARKETPLACE_LEGEND:Record<string, TerrainLegend | EntityLegend> = {
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
	'D': { kind: 'entity', def: 'gate', axis: 'x', over: '.', locked: false, open: true, components: [MarketplaceGate] },
	'I': { kind: 'entity', def: 'gate', axis: 'x', over: '.', locked: false, open: true, components: [MarketplaceGate] },
	'A': shopDoor('slate', true),
	// In ToyShop's north wall: turned around, so it opens out onto the square, as ApothecaryShopDoor does, its leaf to the
	// west, clear of the line that runs out of the door to Toymaker's serving spot.
	'T': { ...shopDoor(undefined, true), yaw: -Math.PI / 2 },
	't': { kind: 'entity', def: 'wall_torch', over: '.' },
	/** A torch on a shop's inside wall, over its floorboards. */
	'u': { kind: 'entity', def: 'wall_torch', over: 'P' },
	'*': { kind: 'entity', def: 'tree', over: '"' },
	'@': { kind: 'entity', def: 'player_start' },
	/** The stalls: their wares spill out beside them. */
	a: postLegend('BakerStall', [
		{ prop: 'sacks', right: -1.35, forward: -0.1, yaw: 0.3 },
		{ prop: 'barrel', right: 1.25, forward: -0.25 },
		{ prop: 'crate', right: 1.3, forward: 0.4, yaw: 0.2 },
	]),
	b: postLegend('WeaverStall', [
		{ prop: 'basket', right: -1.25, forward: 0.2 },
		{ prop: 'crate', right: 1.3, forward: -0.1, yaw: -0.15 },
	]),
	c: postLegend('PotterStall', [
		{ prop: 'pots', right: -1.45, forward: 0.05, yaw: 0.4 },
		{ prop: 'urn', right: -1.2, forward: -0.75 },
		{ prop: 'urn', right: 1.2, forward: -0.35, yaw: 1.2 },
		{ prop: 'pots', right: 1.5, forward: 0.45, yaw: 2.2 },
	]),
	d: postLegend('CutlerStall', [
		{ prop: 'weaponRack', right: 1.45, forward: -0.15, yaw: -Math.PI / 2 },
		{ prop: 'crate', right: -1.3, forward: -0.05 },
		{ prop: 'bucket', right: -1.25, forward: 0.5 },
	]),
	g: postLegend('SushiStall', [
		{ prop: 'bucket', right: -1.25, forward: 0.25 },
		{ prop: 'barrel', right: -1.3, forward: -0.45 },
		{ prop: 'creel', right: 1.3, forward: -0.05, yaw: 0.4 },
	]),
	/** A shop counter: a stall indoors, facing the door. A row of them is one counter, out to the walls at its ends. */
	C: postLegend('ApothecaryCounter'),
	K: postLegend('ToyCounter'),
	// Inside the shops.
	S: furnish('shelf', { on: ['jars'] }),
	x: furnish('crate'),
	y: furnish('sacks'),
	z: furnish('brazier'),
};
