import type { Component, XZ, ChunkCoord } from '@arc-director/kindling';
import type { BesideProp } from '../kit/props/dressing-plan';
import { CHUNK_SIZE } from './constants';
import { DemoChunk, type ChunkEntity, type Tile } from './demo-chunk';
import { TERRAIN, type TerrainDef } from './terrain-kinds';

export type TerrainLegend = {
	def:TerrainDef;
	height:number;
	blocked?:boolean;
	flow?:XZ;
};

export type EntityLegend = {
	kind:'entity';
	def:string;
	axis?:'x' | 'z';
	over?:string;
	keyID?:string;
	locked?:boolean;
	/** Which side a locked door cannot be opened from without its key: see `Lock.lockedFrom`. Both when unset. */
	lockedFrom?:'both' | 'outside';
	open?:boolean;
	/** What it works, by id: a lever's bridge. */
	works?:string;
	/** Components its object gets besides its kind's own (a marketplace gate's `MarketplaceGate`). */
	components?:(new ()=>Component)[];
	/** A door's house: what its roof is made of. Thatch when unset. */
	roof?:RoofStyle;
	/** A door's house: `false` for no chimney. Houses 5 m wide or more have one when unset. */
	chimney?:boolean;
	/** Radians. Turns a prop glyph or a stall; otherwise it faces off a wall it stands against. */
	yaw?:number;
	/** How grown a tree is, 0 a sapling to 1 (when unset) full grown: a young one at the edge of a wood is slender and short. */
	age?:number;
	/** What share of trees are pines, 0 to 0.5 (every other cell, when unset); oaks grow in place of the rest. */
	pines?:number;
	/** Meters (world X, Z) a prop glyph stands off its cell's center: a chair drawn up to a table, oars on a wall. */
	offset?:{ x:number; z:number, y?:number };
	/** A rock in water: how its ripples trail. Omitted, the current draws them, or in still water they spread all round. */
	wake?:Wake;
	/** Props set on top of a prop glyph (a plate on a table), at its `PROP_TOP` height; the wares (mesh ids) on a stall's counter. */
	on?:string[];
	/** Props standing beside a stall, never in front of it where customers stand. */
	beside?:BesideProp[];
	/** What reading or examining it says (an inscription). */
	text?:string;
	/** What a chest holds. */
	contents?:LootSpec[];
	/** An item lying about: how many. One when unset. */
	count?:number;
	/** An item lying about where it grows: tagged `wild` until picked, for the scene's rules. */
	wild?:boolean;
};

/**
 * Ripples trailing off a rock: the way (world X, Z), as far as the vector is long (1 is as far as the current draws
 * them), and how wide they `spread` (1, the default, is as narrow as the current draws them).
 */
export type Wake = { x:number; z:number; spread?:number };

/** What a house's roof is made of. */
export type RoofStyle = 'thatch' | 'slate';

/** Items made fresh into a chest or a pack: the def, the name everyone calls it by, and how many. */
export type LootSpec = { defID:string; name:string; count?:number };

export type ChunkFile = {
	id:string;
	origin:ChunkCoord;
	legend:Record<string, TerrainLegend | EntityLegend>;
	tiles:string[];
	names?:Record<string, string>;
};

function isEntity(spec:TerrainLegend | EntityLegend):spec is EntityLegend {
	return 'kind' in spec && spec.kind === 'entity';
}

/** A legend's tile as decoded: its def's kind copied on, blocked by default when it is a block (no deck). */
function tileOf(spec:TerrainLegend):Tile {
	const { surface, deck, wade, climb } = TERRAIN[spec.def];
	return { def: spec.def, height: spec.height, flow: spec.flow, surface, deck, wade, climb, blocked: spec.blocked ?? deck === undefined };
}

export type DecodedChunk = {
	chunk:DemoChunk;
	playerStart:XZ | null;
};

export function decodeGlyphChunk(file:ChunkFile):DecodedChunk {
	if (file.tiles.length !== CHUNK_SIZE) {
		throw new Error(`chunk ${file.id}: expected ${CHUNK_SIZE} rows, got ${file.tiles.length}`);
	}

	const tiles:Tile[] = [];
	const entities:ChunkEntity[] = [];
	let playerStart:XZ | null = null;
	const chunk = new DemoChunk(file.id, file.origin, tiles, entities);

	for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
		const row = file.tiles[localZ];
		if (row.length !== CHUNK_SIZE) {
			throw new Error(
				`chunk ${file.id}: row ${localZ} length ${row.length}, expected ${CHUNK_SIZE}`,
			);
		}
		for (let localX = 0; localX < CHUNK_SIZE; localX++) {
			const glyph = row[localX];
			const spec = file.legend[glyph];
			if (!spec) {
				throw new Error(`chunk ${file.id}: unknown glyph '${glyph}' at ${localX},${localZ}`);
			}
			if (isEntity(spec)) {
				const { kind, over = '.', ...legend } = spec;
				const overSpec = file.legend[over];
				tiles.push(tileOf(overSpec && !isEntity(overSpec) ? overSpec : { def: 'floor', height: 0 }));
				if (spec.def === 'player_start') {
					playerStart = chunk.worldCellCenter(localX, localZ);
				}
				else {
					entities.push({ ...legend, localX, localZ, glyph, name: file.names?.[glyph] });
				}
			}
			else {
				tiles.push(tileOf(spec));
			}
		}
	}

	return { chunk, playerStart };
}

/**
 * Cut one map, `CHUNK_SIZE` cells to a chunk on both axes, into chunk files `${prefix}_${cx}_${cz}`. `names` are
 * shared by every chunk, so a named glyph must be unique across the whole map.
 */
export function splitGlyphMap(
	prefix:string,
	legend:ChunkFile['legend'],
	rows:string[],
	names:Record<string, string> = {},
):ChunkFile[] {
	const width = rows[0]?.length ?? 0;
	if (rows.length % CHUNK_SIZE !== 0 || width % CHUNK_SIZE !== 0 || rows.some((row) => row.length !== width)) {
		throw new Error(`${prefix} map must be whole chunks: ${width} × ${rows.length}`);
	}
	const files:ChunkFile[] = [];
	for (let cz = 0; cz < rows.length / CHUNK_SIZE; cz++) {
		for (let cx = 0; cx < width / CHUNK_SIZE; cx++) {
			files.push({
				id: chunkName(prefix, cx, cz),
				origin: { cx, cz },
				legend,
				tiles: rows.slice(cz * CHUNK_SIZE, (cz + 1) * CHUNK_SIZE).map((row) => row.slice(cx * CHUNK_SIZE, (cx + 1) * CHUNK_SIZE)),
				names,
			});
		}
	}
	return files;
}

function chunkName(prefix:string, cx:number, cz:number):string {
	return `${prefix}_${cx}_${cz}`;
}
