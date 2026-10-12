import * as THREE from 'three';
import { ToonMaterial, type ToonMaterialParameters } from '@arc-director/kindling';
import { CELL_SIZE, TILE_HEIGHT } from '../world/constants';

/** Base colors of the world. Scene lights and ink (`look.ts`) set the mood per scene. */
export const PALETTE = {
	wood: 0x8a5530,
	woodLight: 0xc4a06a,
	woodDark: 0x6a4a2a,
	thatch: 0xc8902f,
	rock: 0x8f8a82,
	wall: 0x6e6f74,
	floor: 0x857d70,
	iron: 0x3a3a42,
	dirt: 0xc48a4e,
	leaf: 0x2f6e2e,
	grass: 0x3f7a2e,
	leafDark: 0x2c6430,
	flower: 0xd64545,
	flowerGold: 0xe6c14a,
	linen: 0xd9c7a2,
} as const;

const shared = new Map<string, ToonMaterial>();

function remember(key:string, params:ToonMaterialParameters):ToonMaterial {
	let mat = shared.get(key);
	if (!mat) {
		mat = new ToonMaterial(params);
		mat.userData.shared = true;
		shared.set(key, mat);
	}
	return mat;
}

/** A plain toon material of its own, safe to tint per object. */
export function toon(color:number, extras:ToonMaterialParameters = {}):ToonMaterial {
	return new ToonMaterial({ color, shadowSide: THREE.FrontSide, ...extras });
}

/** Boards: walls, floors, bridges, roof gables. Shared; do not tint. */
export function plankMat(color:number = PALETTE.wood):ToonMaterial {
	return remember(`plank:${color}`, {
		color,
		pattern: 'plank',
		patternScale: 0.24,
		patternInk: 0.55,
		side: THREE.DoubleSide,
		shadowSide: THREE.DoubleSide,
	});
}

export function thatchMat():ToonMaterial {
	return remember('thatch', {
		color: PALETTE.thatch,
		pattern: 'thatch',
		patternScale: 0.2,
		patternInk: 0.5,
		side: THREE.DoubleSide,
		shadowSide: THREE.DoubleSide,
	});
}

const STONE_WALL:ToonMaterialParameters = {
	color: PALETTE.wall,
	pattern: 'brick',
	// One course per stair step (TILE_HEIGHT / 4); WALL_HEIGHT is 14 courses.
	patternScale: TILE_HEIGHT / 4,
	// One row per stair tread (CELL_SIZE / 4).
	topScale: CELL_SIZE / 4,
	// Two treads long, staggered by one: every step edge lands on a joint.
	brickLength: CELL_SIZE / 2,
	shadowSide: THREE.FrontSide,
};

/** Masonry: bricks on sides, the same bricks laid flat on tops. */
export function stoneWallMat():ToonMaterial {
	return remember('stoneWall', STONE_WALL);
}

/** Masonry for stairs climbing toward `uphill`: each tread is the top of the brick course below it. */
export function stoneStairMat(uphill:{ x:number; z:number }):ToonMaterial {
	return remember(`stoneStair:${uphill.x},${uphill.z}`, { ...STONE_WALL, topAxis: uphill });
}

export function stoneFloorMat():ToonMaterial {
	return remember('stoneFloor', {
		color: PALETTE.floor,
		pattern: 'brick',
		// 1 × 0.5 m flagstones, on the tile grid.
		patternScale: CELL_SIZE / 2,
		patternInk: 0.35,
		shadowSide: THREE.FrontSide,
		polygonOffset: true,
		polygonOffsetFactor: 1,
		polygonOffsetUnits: 1,
	});
}

export function rockMat():ToonMaterial {
	return remember('rock', { color: PALETTE.rock, rim: 0.12 });
}

/** Cobbled path. Sits just above the lawn, with no outline of its own. */
export function dirtMat():ToonMaterial {
	return remember('dirt', {
		color: PALETTE.dirt,
		// The well's cobble pattern in the path's light brown, with larger stones.
		pattern: 'stone',
		patternScale: 0.28,
		patternInk: 0.5,
		shadowSide: THREE.FrontSide,
		polygonOffset: true,
		polygonOffsetFactor: -1,
		polygonOffsetUnits: -4,
		outline: false,
	});
}

/** Lawn: painted patches and blade strokes, no texture. No ink: grass edges are soft. */
export function meadowMat():ToonMaterial {
	return remember('meadow', {
		color: PALETTE.grass,
		pattern: 'meadow',
		patternScale: 0.9,
		patternInk: 0.28,
		shadowSide: THREE.FrontSide,
		outline: false,
	});
}

