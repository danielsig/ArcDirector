import type { Flight } from '@arc-director/kindling';
import * as THREE from 'three';
import type { ChunkLayer } from '../../render/build-chunk-mesh';
import { addSlabs, cellSlab, runSlab, type Slab } from '../../render/slabs';
import { stoneStairMat, stoneWallMat } from '../../render/toon';
import { CELL_SIZE, TILE_HEIGHT, WALL_HEIGHT } from '../../world/constants';

/** How far down from the wall tops the rock ceiling over a stairwell reaches. */
const STAIRWELL_CEILING = 0.3;

/**
 * Stairs: each flight of a climbing tile (`flightsAt`) as its steps, solid from the ground, a flight running along X
 * or Z; a slope (`steps: 0`) as one wedge, any way. Blocked stairs are a stairwell cut into the rock, out of reach:
 * a ceiling at the wall tops hides where they lead.
 */
export const stairLayer:ChunkLayer = ({ group, chunk, terrain }) => {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	/** Steps by the way they climb and whether they cast shadows: each a material and a draw. */
	const flights = new Map<string, { mat:THREE.Material; cast:boolean; steps:Slab[] }>();
	const ceilings:Slab[] = [];
	chunk.forEachTile((tile, lx, lz) => {
		if (!tile.climb) {
			return;
		}
		if (tile.blocked) {
			ceilings.push(cellSlab(chunk, lx, lz, WALL_HEIGHT - STAIRWELL_CEILING, WALL_HEIGHT));
		}
		const top = tile.height * TILE_HEIGHT;
		const bottom = Math.max(0, top - (tile.climb.rise ?? TILE_HEIGHT));
		for (const f of terrain.flightsAt(chunk.tileCoord(lx, lz))) {
			const steps = f.steps ?? tile.climb.steps ?? terrain.steps;
			if (steps === 0) {
				group.add(slope(f, ox + lx * CELL_SIZE, oz + lz * CELL_SIZE, bottom, top, !tile.blocked));
				continue;
			}
			const [dx, dz] = [f.head.x - f.foot.x, f.head.z - f.foot.z];
			const across = (f.width ?? 1) * CELL_SIZE;
			const tread = Math.abs(dz === 0 ? dx : dz) / steps * CELL_SIZE;
			// A stairwell's steps cast no shadow: light coming down them from far off would have each step shade the next.
			const key = `${Math.sign(dx)},${Math.sign(dz)},${tile.blocked}`;
			const flight = flights.get(key) ?? flights.set(key, { mat: stoneStairMat({ x: Math.sign(dx), z: Math.sign(dz) }), cast: !tile.blocked, steps: [] }).get(key)!;
			for (let i = 0; i < steps; i++) {
				const [from, to] = [f.from ?? 0, f.to ?? 1];
				const h = bottom + (from + (to - from) * (i + 1) / steps) * (top - bottom);
				const u = (i + 0.5) / steps;
				const at = { x: ox + (lx + f.foot.x + dx * u) * CELL_SIZE, z: oz + (lz + f.foot.z + dz * u) * CELL_SIZE };
				flight.steps.push(runSlab(at, dz === 0 ? 'x' : 'z', -tread / 2, tread / 2, 0, h, across));
			}
		}
	});
	for (const { mat, cast, steps } of flights.values()) {
		addSlabs(group, mat, steps, cast);
	}
	addSlabs(group, stoneWallMat(), ceilings, true);
};

/** A smooth flight as a wedge solid from the ground: its side the shape of the rise, pushed out across its width. */
function slope(f:Flight, x0:number, z0:number, bottom:number, top:number, cast:boolean):THREE.Mesh {
	const [dx, dz] = [f.head.x - f.foot.x, f.head.z - f.foot.z];
	const [run, width] = [Math.hypot(dx, dz) * CELL_SIZE, (f.width ?? 1) * CELL_SIZE];
	const at = (share:number):number => bottom + share * (top - bottom);
	const side = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(run, 0), new THREE.Vector2(run, at(f.to ?? 1)), new THREE.Vector2(0, at(f.from ?? 0))]);
	const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(side, { depth: width, bevelEnabled: false }).translate(0, 0, -width / 2), stoneStairMat({ x: Math.sign(dx), z: Math.sign(dz) }));
	// The shape's X runs from the foot to the head.
	mesh.rotation.y = Math.atan2(-dz, dx);
	mesh.position.set(x0 + f.foot.x * CELL_SIZE, 0, z0 + f.foot.z * CELL_SIZE);
	mesh.castShadow = cast;
	mesh.receiveShadow = true;
	return mesh;
}
