import * as THREE from 'three';
import { hash, register } from '@arc-director/kindling';
import { BOULDER_SIZE } from '../../world/constants';
import type { Wake } from '../../world/decode-glyph-chunk';
import { claimRockSlot, getNature, markRock, natureReady } from '../../render/nature';
import { riverRockMat, tileMat } from '../../render/toon';
import { sharedMesh, spawnProp, type Thing } from '../thing';
import { TERRAIN, WATER_UPPER_Y } from '../../world/terrain-kinds';

/** Meters across a boulder of size 1: a map's `o` boulder, or one out in the land past the map. */
export const BOULDER_ACROSS = 1.15;

let boulders = 0;

/**
 * A boulder: the boulder models in turn, each {@link BOULDER_ACROSS} across. One with a `wake` stands in water: on
 * the riverbed, a little bigger so as much shows, wet where the water laps it, and rippling the water round it
 * (see `EntityLegend.wake`).
 */
function createBoulderMesh(wake?:Wake):THREE.Group {
	const inWater = wake !== undefined;
	const g = new THREE.Group();
	const all = getNature().boulders;
	const piece = all[boulders++ % all.length]!;
	const mesh = new THREE.Mesh(piece.geom, inWater ? riverRockMat(piece.map) : tileMat(piece.map));
	mesh.scale.setScalar((inWater ? 1.2 : 1) * BOULDER_ACROSS / piece.across);
	if (inWater) {
		// Sunk 17 cm under the surface at the smallest size a map gives it (`BOULDER_SIZE`); bigger ones settle deeper.
		mesh.position.y = (WATER_UPPER_Y - 0.17) / BOULDER_SIZE.min;
		// Tell the river where it stands every frame, so it ripples round it (never culled, so ripples near
		// the edge of view keep going).
		mesh.frustumCulled = false;
		const slot = claimRockSlot();
		const at = new THREE.Vector3();
		const size = new THREE.Vector3();
		mesh.onBeforeRender = () => {
			g.getWorldPosition(at);
			g.getWorldScale(size);
			const radius = 0.34 * mesh.scale.x * piece.across * size.x;
			// About the waterline's width: a dome is a little narrower there than at its foot.
			markRock(slot, at.x, at.z, radius, wake);
		};
	}
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	g.add(mesh);
	return g;
}

/** A boulder of its own size. Standing in the river, it sits on the bed, looks wet, and ripples the water along its `wake`. */
export const boulder:Thing = {
	defs: ['boulder'],
	spawn: (world, chunk, ents) => ents.forEach((ent) => {
		const at = chunk.worldCellCenter(ent.localX, ent.localZ);
		const size = BOULDER_SIZE.min + (BOULDER_SIZE.max - BOULDER_SIZE.min) * hash(at.x, at.z, 71) ** 1.5;
		const tile = chunk.tile(ent.localX, ent.localZ);
		const wake = tile && TERRAIN[tile.def].water ? ent.wake ?? { x: 0, z: 0 } : undefined;
		const meshID = wake ? `river_boulder:${wake.x},${wake.z},${wake.spread ?? 1}` : 'boulder';
		if (wake) {
			register(meshID, () => (natureReady() ? createBoulderMesh(wake) : undefined));
		}
		const go = spawnProp(chunk, ent, meshID, 0.4 * size);
		go.transform.scale = size;
		world.add(go);
	}),
	meshes: { boulder: sharedMesh(() => createBoulderMesh(), natureReady) },
};
