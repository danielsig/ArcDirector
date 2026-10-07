import { Chunk as KindlingChunk } from '@arc-director/kindling';
import { CELL_SIZE, CHUNK_SIZE } from './constants';

/** Props whose collider is thinner than the cell. Physics blocks the whole cell. */
export const SOLID_PROPS = new Set<string>(['tree', 'boulder']);

/** Props that fill their cell for routes and sight lines. */
export const CELL_PROPS = new Set<string>([...SOLID_PROPS, 'stall']);

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
};

export class Chunk extends KindlingChunk<Tile> {
	public readonly entities:ChunkEntity[];
	/** Cell-filling prop defs by cell. Filled on first query; decode pushes entities after `new Chunk`. */
	private _props:(string | undefined)[] | null = null;

	public constructor(id:string, origin:{ cx:number; cz:number }, tiles:Tile[], entities:ChunkEntity[]) {
		super(id, origin, CHUNK_SIZE, CELL_SIZE, tiles);
		this.entities = entities;
	}

	/** The `CELL_PROPS` prop standing on the cell at a world point, by def. */
	public propAtWorld(x:number, z:number):string | undefined {
		if (!this._props) {
			this._props = [];
			for (const ent of this.entities) {
				if (CELL_PROPS.has(ent.def)) {
					this._props[ent.localZ * CHUNK_SIZE + ent.localX] = ent.def;
				}
			}
		}
		const { localX, localZ } = this.worldToLocal(x, z);
		return this.tile(localX, localZ) ? this._props[localZ * CHUNK_SIZE + localX] : undefined;
	}
}
