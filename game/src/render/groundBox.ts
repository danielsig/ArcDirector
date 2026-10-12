import * as THREE from 'three';
import type { World } from '../engine/World';
import { meadowMat } from './toon';
import { GRASS_Y } from './nature';

const OUTER = 96;
/** Pull the outer lawn under the perimeter walls so the sky cannot show at the base. */
const TUCK = 0.72;

function mapBounds(world:World):{ minX:number; maxX:number; minZ:number; maxZ:number; cx:number; cz:number } {
	const { minX, maxX, minZ, maxZ } = world.chunkBounds() ?? { minX: 0, maxX: 32, minZ: 0, maxZ: 32 };
	return { minX, maxX, minZ, maxZ, cx: (minX + maxX) * 0.5, cz: (minZ + maxZ) * 0.5 };
}

function groundStrip(mat:THREE.Material, x:number, z:number, w:number, d:number):THREE.Mesh {
	const geo = new THREE.PlaneGeometry(Math.max(w, 0.01), Math.max(d, 0.01));
	geo.rotateX(-Math.PI / 2);
	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.set(x, GRASS_Y, z);
	mesh.receiveShadow = true;
	mesh.castShadow = false;
	mesh.frustumCulled = false;
	return mesh;
}

/** Grass around the map (no blades). Tucks under the outer walls so the sky cannot leak through. */
export function createGroundBox(world:World):THREE.Group {
	const mat = meadowMat();
	const g = new THREE.Group();
	g.name = 'groundBox';
	const b = mapBounds(world);
	const x0 = b.cx - OUTER;
	const x1 = b.cx + OUTER;
	const z0 = b.cz - OUTER;
	const z1 = b.cz + OUTER;
	const holeX0 = b.minX + TUCK;
	const holeX1 = b.maxX - TUCK;
	const holeZ0 = b.minZ + TUCK;
	const holeZ1 = b.maxZ - TUCK;

	const westW = holeX0 - x0;
	const eastW = x1 - holeX1;
	const midW = holeX1 - holeX0;
	const fullD = z1 - z0;
	const northD = holeZ0 - z0;
	const southD = z1 - holeZ1;

	g.add(groundStrip(mat, (x0 + holeX0) * 0.5, b.cz, westW, fullD));
	g.add(groundStrip(mat, (holeX1 + x1) * 0.5, b.cz, eastW, fullD));
	g.add(groundStrip(mat, b.cx, (z0 + holeZ0) * 0.5, midW, northD));
	g.add(groundStrip(mat, b.cx, (holeZ1 + z1) * 0.5, midW, southD));
	return g;
}
