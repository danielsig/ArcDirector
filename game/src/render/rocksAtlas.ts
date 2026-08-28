import * as THREE from 'three';
import type { PxQuad } from './unproject';
import { insetQuad } from './unproject';

export const ROCKS_W = 1408;
export const ROCKS_H = 1408;

export type RockStamp = {
	quad:PxQuad;
	outW:number;
	outH:number;
};

/** World size of one brick course on unprojected 3-course front faces. */
export const BRICK_HEIGHT = 1 / 6;
export const WALL_OUT_W = 1344;
export const WALL_OUT_H = 120;
export const WALL_ROW_COUNT = 3;
export const WALL_PERIOD_V = 3 * WALL_ROW_COUNT * BRICK_HEIGHT;
export const WALL_PERIOD_U = (WALL_OUT_W / (WALL_OUT_H * WALL_ROW_COUNT)) * WALL_PERIOD_V;

export const FLOOR_OUT = 160;

/**
 * Front faces of the three continuous wall rows (skip the gapped top row).
 * Corners are the 3D front rectangle as it appears in the perspective photo.
 */
const WALL_FRONTS:PxQuad[] = [
	{ tl: { x: 56, y: 292 }, tr: { x: 1354, y: 292 }, br: { x: 1368, y: 408 }, bl: { x: 66, y: 408 } },
	{ tl: { x: 52, y: 492 }, tr: { x: 1356, y: 492 }, br: { x: 1376, y: 604 }, bl: { x: 62, y: 604 } },
	{ tl: { x: 50, y: 684 }, tr: { x: 1364, y: 684 }, br: { x: 1376, y: 796 }, bl: { x: 60, y: 796 } },
];

function wallStamps():RockStamp[] {
	return WALL_FRONTS.map((band) => ({
		quad: insetQuad(band, 0.04),
		outW: WALL_OUT_W,
		outH: WALL_OUT_H,
	}));
}

export const WALL_STAMPS:RockStamp[] = wallStamps();

/** Vertical grout X at y=1000; other depths go through the floor vanishing point. */
const FLOOR_X_AT_1000 = [32, 209, 377, 539, 704, 872, 1035, 1200, 1375];
const FLOOR_VP_X = 704;
const FLOOR_VP_Y = -5524;
const FLOOR_GROUT_Y = [828, 937, 1071, 1211, 1366];

function floorXAt(i:number, y:number):number {
	const xRef = FLOOR_X_AT_1000[i];
	return FLOOR_VP_X + (xRef - FLOOR_VP_X) * (y - FLOOR_VP_Y) / (1000 - FLOOR_VP_Y);
}

function floorStamps():RockStamp[] {
	const out:RockStamp[] = [];
	for (let row = 0; row < FLOOR_GROUT_Y.length - 1; row++) {
		const y0 = FLOOR_GROUT_Y[row];
		const y1 = FLOOR_GROUT_Y[row + 1];
		for (let col = 0; col < FLOOR_X_AT_1000.length - 1; col++) {
			out.push({
				quad: insetQuad({
					tl: { x: floorXAt(col, y0), y: y0 },
					tr: { x: floorXAt(col + 1, y0), y: y0 },
					br: { x: floorXAt(col + 1, y1), y: y1 },
					bl: { x: floorXAt(col, y1), y: y1 },
				}, 0.1),
				outW: FLOOR_OUT,
				outH: FLOOR_OUT,
			});
		}
	}
	return out;
}

export const FLOOR_STAMPS:RockStamp[] = floorStamps();

/** Stable pick in `0..count-1` from world cell + chunk origin. */
export function rockVariant(cellX:number, cellZ:number, salt:number, count:number):number {
	let n = Math.imul(cellX | 0, 73856093) ^ Math.imul(cellZ | 0, 19349663) ^ Math.imul(salt, 83492791);
	n = Math.imul(n ^ (n >>> 16), 2246822519);
	n = Math.imul(n ^ (n >>> 13), 3266489917);
	return (n >>> 0) % count;
}

export function rockFlip(cellX:number, cellZ:number, salt:number):boolean {
	return rockVariant(cellX, cellZ, salt + 17, 2) === 1;
}

/** Same stamp along a stretch matching the unprojected wall width. */
export function rockRunVariant(cellX:number, cellZ:number, salt:number, count:number):number {
	const p = Math.max(1, Math.round(WALL_PERIOD_U));
	return rockVariant(Math.floor(cellX / p), Math.floor(cellZ / p), salt, count);
}

export function insetPlaneUVs(geom:THREE.BufferGeometry, pad = 0.02):void {
	const uv = geom.getAttribute('uv');
	for (let i = 0; i < uv.count; i++) {
		uv.setX(i, pad + uv.getX(i) * (1 - 2 * pad));
		uv.setY(i, pad + uv.getY(i) * (1 - 2 * pad));
	}
	uv.needsUpdate = true;
}

export function insetBoxTopUVs(geom:THREE.BoxGeometry, pad = 0.02):void {
	const uv = geom.getAttribute('uv');
	for (let face = 2; face <= 3; face++) {
		for (let i = 0; i < 4; i++) {
			const vi = face * 4 + i;
			uv.setX(vi, pad + uv.getX(vi) * (1 - 2 * pad));
			uv.setY(vi, pad + uv.getY(vi) * (1 - 2 * pad));
		}
	}
	uv.needsUpdate = true;
}

/**
 * Project brick UVs from world position so adjacent walls and stair
 * treads/risers share grout lines. Works on InstancedMesh.
 */
export function applyWorldBrickUVs(mat:THREE.MeshStandardMaterial):void {
	const invU = 1 / WALL_PERIOD_U;
	const invV = 1 / WALL_PERIOD_V;
	const prev = mat.onBeforeCompile;
	const prevKey = mat.customProgramCacheKey.bind(mat);
	mat.customProgramCacheKey = () => `${prevKey()}|rockWorldUV`;
	mat.onBeforeCompile = (shader, renderer) => {
		prev.call(mat, shader, renderer);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <uv_vertex>',
			`#include <uv_vertex>
			{
				vec4 wp4 = vec4(position, 1.0);
				#ifdef USE_INSTANCING
					wp4 = instanceMatrix * wp4;
				#endif
				wp4 = modelMatrix * wp4;
				vec3 n = normal;
				#ifdef USE_INSTANCING
					n = mat3(instanceMatrix) * n;
				#endif
				n = normalize(mat3(modelMatrix) * n);
				vec3 an = abs(n);
				vec2 wuv;
				if (an.y >= an.x && an.y >= an.z) {
					wuv = vec2(wp4.x * ${invU.toFixed(8)}, wp4.z * ${invU.toFixed(8)});
				}
				else if (an.x >= an.z) {
					wuv = vec2(wp4.z * ${invU.toFixed(8)}, wp4.y * ${invV.toFixed(8)});
				}
				else {
					wuv = vec2(wp4.x * ${invU.toFixed(8)}, wp4.y * ${invV.toFixed(8)});
				}
				#ifdef USE_MAP
					vMapUv = wuv;
				#endif
				#ifdef USE_NORMALMAP
					vNormalMapUv = wuv;
				#endif
				#ifdef USE_METALNESSMAP
					vMetalnessMapUv = wuv;
				#endif
			}`,
		);
	};
}
