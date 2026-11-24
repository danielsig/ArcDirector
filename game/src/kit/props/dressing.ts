import { hash, instanced } from '@arc-director/kindling';
import * as THREE from 'three';
import type { DemoChunk } from '../../world/demo-chunk';
import type { GlyphTerrain } from '../../world/GlyphTerrain';
import type { ChunkLayer } from '../../render/build-chunk-mesh';
import { propParts } from './prop-meshes';
import { treeGrowth, treeKind, treeParts } from '../trees/trees';

export type DressingDraw = {
	geom:THREE.BufferGeometry;
	mat:THREE.Material;
	cast:boolean;
	x:number;
	y:number;
	z:number;
	rx:number;
	ry:number;
	rz:number;
	sx:number;
	sy:number;
	sz:number;
};

/** How far apart in `age` the young trees of one legend glyph grow, so no two match. */
const AGE_SPREAD = 0.2;

/** Instanced draws for this chunk: props and trees. The road is part of the ground mesh; grass blades are `grass-batch.ts`. */
function dressingDraws(chunk:DemoChunk, terrain:GlyphTerrain):DressingDraw[] {
	const draws:DressingDraw[] = [];
	for (const spot of terrain.plan.props) {
		if (terrain.chunkAtWorld(spot.x, spot.z) !== chunk) {
			continue;
		}
		const cos = Math.cos(spot.yaw);
		const sin = Math.sin(spot.yaw);
		for (const part of propParts(spot.prop)) {
			// Same turn as the mesh rotation below (Three.js yaw about +Y).
			const lx = part.x * cos + part.z * sin;
			const lz = -part.x * sin + part.z * cos;
			draws.push({ geom: part.geom, mat: part.mat, cast: part.cast, x: spot.x + lx, y: spot.y + part.y, z: spot.z + lz, rx: part.rx, ry: spot.yaw + part.ry, rz: part.rz, sx: 1, sy: 1, sz: 1 });
		}
	}
	for (const ent of chunk.entities) {
		if (ent.def !== 'tree') {
			continue;
		}
		const center = chunk.worldCellCenter(ent.localX, ent.localZ);
		const kind = treeKind(ent, center);
		const variant = Math.floor(hash(center.x, center.z, 13) * 8);
		const s = 0.88 + hash(center.x, center.z, 9) * 0.28;
		const age = ent.age === undefined ? 1 : THREE.MathUtils.clamp(ent.age + (hash(center.x, center.z, 16) - 0.5) * AGE_SPREAD, 0, 1);
		const growth = treeGrowth(kind, age);
		const x = center.x + (hash(center.x, center.z, 11) - 0.5) * 0.2;
		const z = center.z + (hash(center.x, center.z, 12) - 0.5) * 0.2;
		const yaw = hash(center.x, center.z, 14) * Math.PI * 2;
		for (const part of treeParts(kind, variant, age)) {
			draws.push({ geom: part.geom, mat: part.mat, cast: true, x, y: 0, z, rx: 0, ry: yaw, rz: 0, sx: s * growth.wide, sy: s * growth.tall, sz: s * growth.wide });
		}
	}
	return draws;
}

/** The chunk's props and trees, one instanced mesh per part and material. */
export const dressingLayer:ChunkLayer = ({ group, terrain, chunk }) => {
	const buckets = new Map<string, DressingDraw[]>();
	for (const draw of dressingDraws(chunk, terrain)) {
		const key = `${draw.geom.uuid}|${draw.mat.uuid}|${draw.cast ? 1 : 0}`;
		let list = buckets.get(key);
		if (!list) {
			list = [];
			buckets.set(key, list);
		}
		list.push(draw);
	}
	for (const list of buckets.values()) {
		const first = list[0]!;
		instanced(group, first.geom, first.mat, list, first.cast, (item, o) => {
			// Part tilt first (X, Z), then the prop's yaw (Y): YXZ order.
			o.rotation.set(item.rx, item.ry, item.rz, 'YXZ');
			o.position.set(item.x, item.y, item.z);
			o.scale.set(item.sx, item.sy, item.sz);
		});
	}
};
