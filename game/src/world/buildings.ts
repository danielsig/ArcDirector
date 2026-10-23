import type { Chunk, ChunkEntity } from './Chunk';
import { CELL_SIZE } from './constants';
import type { RoofStyle } from './decodeGlyphChunk';
import { THIN_WALLS, WALL_THICKNESS } from './thinWall';

/** Where a door is (its cell's world centre) and which way is out (`dx`, `dz`, one of them ±1). */
export type DoorAnchor = { x:number; z:number; dx:number; dz:number };

/** A box on the ground, world XZ meters. */
export type GroundBox = { minX:number; maxX:number; minZ:number; maxZ:number };

/**
 * A house: a ring of thin walls with a door in it, named after its door (`HutDoor` makes `Hut`). A side may be a
 * stone wall it stands against instead: its thin walls then run up to the stone, and the house reaches it.
 */
export type Building = {
	name:string;
	chunk:Chunk;
	door:ChunkEntity;
	roof:RoofStyle;
	chimney:boolean;
	out:DoorAnchor;
	/** Where the walls stand: down the middle of the thin walls, and on the face of any stone wall. */
	walls:GroundBox;
	/** Inside the walls, up to their faces. */
	inside:GroundBox;
};

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Every house on `chunks`: each door set in thin walls, with the walls joined to it. */
export function findBuildings(chunks:Iterable<Chunk>):Building[] {
	const out:Building[] = [];
	for (const chunk of chunks) {
		const doors = chunk.entities.filter((e) => e.def === 'door' || e.def === 'door_flipped');
		const doorAt = (lx:number, lz:number):boolean => doors.some((d) => d.localX === lx && d.localZ === lz);
		const wallAt = (lx:number, lz:number):boolean => THIN_WALLS.has(chunk.tile(lx, lz)?.def ?? '') || doorAt(lx, lz);
		const stoneAt = (lx:number, lz:number):boolean => {
			const tile = chunk.tile(lx, lz);
			return !!tile?.blocked && tile.def !== 'water' && !THIN_WALLS.has(tile.def);
		};
		for (const door of doors) {
			if (!SIDES.some(([dx, dz]) => THIN_WALLS.has(chunk.tile(door.localX + dx, door.localZ + dz)?.def ?? ''))) {
				continue;
			}
			// The walls joined to the door.
			const seen = new Set<string>([`${door.localX},${door.localZ}`]);
			const todo:[number, number][] = [[door.localX, door.localZ]];
			let [minLX, maxLX, minLZ, maxLZ] = [door.localX, door.localX, door.localZ, door.localZ];
			while (todo.length > 0) {
				const [lx, lz] = todo.pop()!;
				minLX = Math.min(minLX, lx);
				maxLX = Math.max(maxLX, lx);
				minLZ = Math.min(minLZ, lz);
				maxLZ = Math.max(maxLZ, lz);
				for (const [dx, dz] of SIDES) {
					const key = `${lx + dx},${lz + dz}`;
					if (!seen.has(key) && wallAt(lx + dx, lz + dz)) {
						seen.add(key);
						todo.push([lx + dx, lz + dz]);
					}
				}
			}
			// A side is stone when its own line is not all thin wall and stone runs the whole way along past it.
			const span = (a:number, b:number):number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
			const stoneX = (lx:number, past:number):boolean => span(minLZ, maxLZ).some((lz) => !wallAt(lx, lz)) && span(minLZ, maxLZ).every((lz) => stoneAt(past, lz));
			const stoneZ = (lz:number, past:number):boolean => span(minLX, maxLX).some((lx) => !wallAt(lx, lz)) && span(minLX, maxLX).every((lx) => stoneAt(lx, past));
			// Each side: how far past its cells' middle the wall stands (a stone face is at their edge), and how far in from there the inner face is.
			const side = (stone:boolean):{ out:number; inset:number } => (stone ? { out: CELL_SIZE / 2, inset: 0 } : { out: 0, inset: WALL_THICKNESS / 2 });
			const west = side(stoneX(minLX, minLX - 1));
			const east = side(stoneX(maxLX, maxLX + 1));
			const north = side(stoneZ(minLZ, minLZ - 1));
			const south = side(stoneZ(maxLZ, maxLZ + 1));
			const nw = chunk.worldCellCenter(minLX, minLZ);
			const se = chunk.worldCellCenter(maxLX, maxLZ);
			const walls = { minX: nw.x - west.out, maxX: se.x + east.out, minZ: nw.z - north.out, maxZ: se.z + south.out };
			const c = chunk.worldCellCenter(door.localX, door.localZ);
			const dx = door.localX === minLX ? -1 : door.localX === maxLX ? 1 : 0;
			const dz = dx !== 0 ? 0 : door.localZ === minLZ ? -1 : 1;
			out.push({
				name: (door.name ?? '').replace(/Door$/, ''),
				chunk,
				door,
				roof: door.roof ?? 'thatch',
				chimney: door.chimney ?? true,
				out: { x: c.x, z: c.z, dx, dz },
				walls,
				inside: { minX: walls.minX + west.inset, maxX: walls.maxX - east.inset, minZ: walls.minZ + north.inset, maxZ: walls.maxZ - south.inset },
			});
		}
	}
	return out;
}
