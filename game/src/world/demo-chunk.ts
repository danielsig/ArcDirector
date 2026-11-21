import { Chunk, type XZ, type ChunkCoord, type TileSpec } from '@arc-director/kindling';
import type { Surface } from '../kit/land/land';
import type { TerrainDef } from './terrain-kinds';
import { CELL_SIZE, CHUNK_SIZE } from './constants';
import type { EntityLegend } from './decode-glyph-chunk';

/** Props whose collider is thinner than the cell. Physics blocks the whole cell. */
export const SOLID_PROPS = new Set<string>(['tree', 'boulder', 'pillar', 'pillar_broken']);

/** Kindling's tile, with what the legend calls it and, in water, its current (world XZ; zero or omitted is still water). */
export type Tile = TileSpec<Surface> & { def:TerrainDef; flow?:XZ };

/** A legend's entity as placed in its chunk: the cell, its glyph, and the name the map gives that glyph. */
export type ChunkEntity = Omit<EntityLegend, 'kind' | 'over'> & { localX:number; localZ:number; glyph:string; name?:string };

export class DemoChunk extends Chunk<Tile> {
	public readonly entities:ChunkEntity[];

	constructor(id:string, origin:ChunkCoord, tiles:Tile[], entities:ChunkEntity[]) {
		super(id, origin, CHUNK_SIZE, CELL_SIZE, tiles);
		this.entities = entities;
	}
}
