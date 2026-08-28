import { CELL_SIZE, CHUNK_SIZE } from './constants';

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

export class Chunk {
	id:string;
	origin:{ cx:number; cz:number };
	tiles:Tile[];
	entities:ChunkEntity[];

	constructor(
		id:string,
		origin:{ cx:number; cz:number },
		tiles:Tile[],
		entities:ChunkEntity[],
	) {
		this.id = id;
		this.origin = origin;
		this.tiles = tiles;
		this.entities = entities;
	}

	worldOriginX():number {
		return this.origin.cx * CHUNK_SIZE * CELL_SIZE;
	}

	worldOriginZ():number {
		return this.origin.cz * CHUNK_SIZE * CELL_SIZE;
	}

	tile(localX:number, localZ:number):Tile | undefined {
		if (
			localX < 0
			|| localZ < 0
			|| localX >= CHUNK_SIZE
			|| localZ >= CHUNK_SIZE
		) {
			return undefined;
		}
		return this.tiles[localZ * CHUNK_SIZE + localX];
	}

	tileAtWorld(x:number, z:number):Tile | undefined {
		const localX = Math.floor((x - this.worldOriginX()) / CELL_SIZE);
		const localZ = Math.floor((z - this.worldOriginZ()) / CELL_SIZE);
		return this.tile(localX, localZ);
	}

	worldCellCenter(localX:number, localZ:number):{ x:number; z:number } {
		return {
			x: this.worldOriginX() + (localX + 0.5) * CELL_SIZE,
			z: this.worldOriginZ() + (localZ + 0.5) * CELL_SIZE,
		};
	}

	worldToLocal(x:number, z:number):{ localX:number; localZ:number } {
		return {
			localX: Math.floor((x - this.worldOriginX()) / CELL_SIZE),
			localZ: Math.floor((z - this.worldOriginZ()) / CELL_SIZE),
		};
	}
}
