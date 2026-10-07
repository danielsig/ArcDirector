/** A square of `size` × `size` tiles at chunk coordinate `origin`. Tiles are row-major (`localZ * size + localX`). */
export class Chunk<T = unknown> {
	constructor(
		public readonly id:string,
		public readonly origin:{ cx:number; cz:number },
		/** Tiles per side. */
		public readonly size:number,
		/** Meters per tile. */
		public readonly cellSize:number,
		public readonly tiles:T[],
	) {}

	public worldOriginX():number {
		return this.origin.cx * this.size * this.cellSize;
	}

	public worldOriginZ():number {
		return this.origin.cz * this.size * this.cellSize;
	}

	public tile(localX:number, localZ:number):T | undefined {
		if (localX < 0 || localZ < 0 || localX >= this.size || localZ >= this.size) {
			return undefined;
		}
		return this.tiles[localZ * this.size + localX];
	}

	/** Every tile, row by row (`localZ` outer, `localX` inner). */
	public forEachTile(fn:(tile:T, localX:number, localZ:number)=>void):void {
		for (let localZ = 0; localZ < this.size; localZ++) {
			for (let localX = 0; localX < this.size; localX++) {
				fn(this.tiles[localZ * this.size + localX], localX, localZ);
			}
		}
	}

	public tileAtWorld(x:number, z:number):T | undefined {
		const { localX, localZ } = this.worldToLocal(x, z);
		return this.tile(localX, localZ);
	}

	public worldCellCenter(localX:number, localZ:number):{ x:number; z:number } {
		return {
			x: this.worldOriginX() + (localX + 0.5) * this.cellSize,
			z: this.worldOriginZ() + (localZ + 0.5) * this.cellSize,
		};
	}

	public worldToLocal(x:number, z:number):{ localX:number; localZ:number } {
		return {
			localX: Math.floor((x - this.worldOriginX()) / this.cellSize),
			localZ: Math.floor((z - this.worldOriginZ()) / this.cellSize),
		};
	}

	/** Meters from the point to the nearest edge of this chunk on XZ. 0 inside. */
	public distanceTo(x:number, z:number):number {
		const span = this.size * this.cellSize;
		const minX = this.worldOriginX();
		const minZ = this.worldOriginZ();
		const dx = x - Math.min(Math.max(x, minX), minX + span);
		const dz = z - Math.min(Math.max(z, minZ), minZ + span);
		return Math.hypot(dx, dz);
	}
}
