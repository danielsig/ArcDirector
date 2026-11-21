import * as THREE from 'three';
import { solidMesh } from '@arc-director/kindling';
import { columnParts, type PropPart } from '../props/prop-meshes';
import { sharedMesh, spawnProp, type Thing } from '../thing';

/** Prop parts as one object of its own, for things that stand in the world (a pillar for cover). */
function partsMesh(parts:PropPart[]):THREE.Group {
	const g = new THREE.Group();
	for (const part of parts) {
		const mesh = solidMesh(part.geom, part.mat, part.cast);
		mesh.position.set(part.x, part.y, part.z);
		mesh.rotation.set(part.rx, part.ry, part.rz, 'YXZ');
		g.add(mesh);
	}
	return g;
}

/** How tall a column stands, whole and snapped off: a whole one hides what is behind it, a stump is seen over. */
const TALL:Record<string, number> = { pillar: 2.6, pillar_broken: 1.3 };

/** A temple column, whole or snapped off: cover in a fight. */
export const pillar:Thing = {
	defs: ['pillar', 'pillar_broken'],
	spawn: (world, chunk, ents) => ents.forEach((ent) => world.add(spawnProp(chunk, ent, ent.def, 0.6, undefined, TALL[ent.def]))),
	meshes: {
		pillar: sharedMesh(() => partsMesh(columnParts(false))),
		pillar_broken: sharedMesh(() => partsMesh(columnParts(true))),
	},
};
