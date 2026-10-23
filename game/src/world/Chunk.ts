import { Chunk as KindlingChunk } from '@arc-director/kindling';
import { CELL_SIZE, CHUNK_SIZE } from './constants';
import type { LootSpec, RoofStyle, Wake } from './decodeGlyphChunk';

/** Props whose collider is thinner than the cell. Physics blocks the whole cell. */
export const SOLID_PROPS = new Set<string>(['tree', 'boulder', 'pillar', 'pillar_broken']);

export type Tile = {
	def:string;
	height:number;
	blocked:boolean;
	/** World XZ current; zero or omitted is still water. */
	flow?:{ x:number; z:number };
};

export type ChunkEntity = {
	def:string;
	localX:number;
	localZ:number;
	glyph:string;
	axis:'x' | 'z' | undefined;
	name:string | undefined;
	keyID:string | undefined;
	locked:boolean | undefined;
	open:boolean | undefined;
	exit:boolean | undefined;
	roof:RoofStyle | undefined;
	chimney:boolean | undefined;
	yaw:number | undefined;
	offset:{ x:number; z:number, y?:number } | undefined;
	wake:Wake | undefined;
	on:string[] | undefined;
	text:string | undefined;
	contents:LootSpec[] | undefined;
};

export class Chunk extends KindlingChunk<Tile> {
	public readonly entities:ChunkEntity[];
	/** Cells a `SOLID_PROPS` prop stands on. Filled on first query; decode pushes entities after `new Chunk`. */
	private _props:Set<number> | null = null;

	constructor(id:string, origin:{ cx:number; cz:number }, tiles:Tile[], entities:ChunkEntity[]) {
		super(id, origin, CHUNK_SIZE, CELL_SIZE, tiles);
		this.entities = entities;
	}

	/** Whether a `SOLID_PROPS` prop stands on the cell at a world point. */
	public solidPropAt(x:number, z:number):boolean {
		this._props ??= new Set(this.entities.filter((ent) => SOLID_PROPS.has(ent.def)).map((ent) => ent.localZ * CHUNK_SIZE + ent.localX));
		const { localX, localZ } = this.worldToLocal(x, z);
		return !!this.tile(localX, localZ) && this._props.has(localZ * CHUNK_SIZE + localX);
	}
}
