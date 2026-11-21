import { instanced, type Bounds, type Chunk, type XZ } from '@arc-director/kindling';
import * as THREE from 'three';

/** An axis-aligned box in world meters, drawn as a scaled unit cube (patterns are world-space, so boards stay true). */
export type Slab = Bounds & { minY:number; maxY:number };

const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
unitBox.userData.shared = true;

/** `slabs` as one instanced mesh in `group`: one material, or one per face as a `BoxGeometry` takes them (+X, −X, +Y, −Y, +Z, −Z). */
export function addSlabs(group:THREE.Group, mat:THREE.Material | THREE.Material[], slabs:Slab[], castShadow:boolean):THREE.InstancedMesh | undefined {
	return instanced(group, unitBox, mat, slabs, castShadow, (s, o) => {
		o.position.set((s.minX + s.maxX) / 2, s.minY, (s.minZ + s.maxZ) / 2);
		o.scale.set(s.maxX - s.minX, s.maxY - s.minY, s.maxZ - s.minZ);
	});
}

/** The whole of `chunk`'s cell `lx`, `lz`, from `y0` up to `y1`. */
export function cellSlab(chunk:Chunk<unknown>, lx:number, lz:number, y0:number, y1:number):Slab {
	return runSlab(chunk.worldCellCenter(lx, lz), 'x', -chunk.cellSize / 2, chunk.cellSize / 2, y0, y1, chunk.cellSize);
}

/** A box spanning `u0`–`u1` along a wall run and `y0`–`y1` up, `depth` thick, about the cell's center line. */
export function runSlab(center:XZ, run:'x' | 'z', u0:number, u1:number, y0:number, y1:number, depth:number):Slab {
	const across = { min: -depth / 2, max: depth / 2 };
	const [ax, az] = run === 'x' ? [{ min: u0, max: u1 }, across] : [across, { min: u0, max: u1 }];
	return { minX: center.x + ax.min, maxX: center.x + ax.max, minY: y0, maxY: y1, minZ: center.z + az.min, maxZ: center.z + az.max };
}
