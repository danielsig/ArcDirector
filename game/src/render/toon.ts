import * as THREE from 'three';
import { patchShader, ToonMaterial, type ToonMaterialParameters } from '@arc-director/kindling';
import { getNature, WATER_UPPER_Y } from './nature';
import { CELL_SIZE, MOON_BLUE, TILE_HEIGHT } from '../world/constants';

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
	/** Riverbank earth: tints the grey wet-sand picture brown. */
	earth: 0xf0d2b0,
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
		patternScale: 0.25,
		patternInk: 0.55,
		sideDark: 0.5,
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

/** Slates: a roof of dark blue-grey tiles in staggered courses. Shared; do not tint. */
export function slateMat():ToonMaterial {
	return remember('slate', {
		color: 0x4a5160,
		pattern: 'brick',
		patternScale: 0.26,
		brickLength: 0.4,
		patternInk: 0.45,
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

/** Masonry aglow with moonlight, as inside a window open to the night. */
export function moonlitStoneMat():ToonMaterial {
	return remember('stoneMoonlit', { ...STONE_WALL, emissive: MOON_BLUE, emissiveIntensity: 0.12 });
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
		sideDark: 0.5,
		shadowSide: THREE.FrontSide,
		polygonOffset: true,
		polygonOffsetFactor: 1,
		polygonOffsetUnits: 1,
	});
}

/** Flat cliff faces (behind a waterfall): the ledged rock picture (`NatureMaps.cliff`), as `pushRockFace` lays it. */
export function cliffMat(map:THREE.Texture):ToonMaterial {
	// Both sides: a row's end caps face whichever way the row ends.
	return remember(`cliff:${map.uuid}`, { map, rim: 0.12, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide });
}

/** A model tile's own picture (a cliff tile, a rock), drawn from either side. */
export function tileMat(map:THREE.Texture):ToonMaterial {
	return remember(`tile:${map.uuid}`, { map, rim: 0.12, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide });
}

/** Height up to which rocks in the river look wet: a span over the surface, where it laps and splashes. */
const WET_LINE = WATER_UPPER_Y + 0.09;

/** The riverbed's blue as it comes out on screen (`toonWaterMat`, sRGB 50, 148, 184), in the output's linear colour. */
const UNDERWATER = 'vec3(0.04, 0.31, 0.5)';
/** Meters under the surface over which a rock fades from tinted to nearly the riverbed's blue. */
const UNDERWATER_FADE = 0.2;

/**
 * Darkens `mat` below {@link WET_LINE} in world space, its edge soft, so whatever stands in the river looks wet;
 * under the water's surface it is tinted the water's blue, as if seen through it.
 */
function wetBelowWaterline(mat:ToonMaterial):ToonMaterial {
	patchShader(mat, 'wetBelowWaterline', (shader) => {
		shader.vertexShader = `varying float vWetY;
${shader.vertexShader}`.replace(
			'#include <begin_vertex>',
			`#include <begin_vertex>
			vec4 wetAt = vec4(transformed, 1.0);
			#ifdef USE_INSTANCING
			wetAt = instanceMatrix * wetAt;
			#endif
			vWetY = (modelMatrix * wetAt).y;`,
		);
		shader.fragmentShader = `varying float vWetY;
${shader.fragmentShader}`.replace(
			'#include <tonemapping_fragment>',
			// After tone mapping, so it darkens as much on screen however brightly the rock is lit.
			`#include <tonemapping_fragment>
			gl_FragColor.rgb *= mix(0.5, 1.0, smoothstep(${(WET_LINE - 0.015).toFixed(3)}, ${(WET_LINE + 0.015).toFixed(3)}, vWetY));
			// Under the surface: seen through the water, fading into the riverbed's blue the deeper it goes.
			float under = 1.0 - smoothstep(${(WATER_UPPER_Y - 0.01).toFixed(3)}, ${(WATER_UPPER_Y + 0.01).toFixed(3)}, vWetY);
			float deep = smoothstep(${WATER_UPPER_Y.toFixed(3)}, ${(WATER_UPPER_Y - UNDERWATER_FADE).toFixed(3)}, vWetY);
			gl_FragColor.rgb = mix(gl_FragColor.rgb, ${UNDERWATER}, under * mix(0.55, 0.9, deep));`,
		);
	});
	return mat;
}

/** Rocks and boulders in and by the river: their models' picture (`map`), wet in the river. */
export function riverRockMat(map:THREE.Texture):ToonMaterial {
	return wetBelowWaterline(remember(`riverRock:${map.uuid}`, { map, rim: 0.12, shadowSide: THREE.FrontSide }));
}



/** Cobbled path. Sits just above the lawn, with no outline of its own. */
export function dirtMat():ToonMaterial {
	const mat = remember('dirt', {
		color: PALETTE.dirt,
		// The well's cobble pattern in the path's light brown, with larger stones.
		pattern: 'stone',
		patternScale: 0.28,
		patternInk: 0.5,
		sideDark: 0.5,
		side: THREE.DoubleSide,
		shadowSide: THREE.DoubleSide,
		polygonOffset: true,
		polygonOffsetFactor: -1,
		polygonOffsetUnits: -4,
		outline: false,
	});
	// The skirt stores the same UV as the top. The stone picture must sample that ground position on the side too, or a grout line stops at the edge.
	patchShader(mat, 'dirtSide', (shader) => {
		shader.fragmentShader = shader.fragmentShader.replace(
			'p = an.x > an.z ? vec2(w.z, w.y) : vec2(w.x, w.y);',
			'p = vec2(dot(w.xz, vec2(uTopAxis.y, -uTopAxis.x)), dot(w.xz, uTopAxis));',
		);
	});
	return mat;
}

/**
 * Riverbank sand and pebbles along the water's edge, laid across the bank (`bankUV`), fading at its top into the lawn
 * where the sand's lawn mask is white: the lawn's own green and pattern, so the bank meets the grass unseen. No ink,
 * like the lawn.
 */
export function sandMat():ToonMaterial {
	const { sand, sandLawn } = getNature();
	const mat = remember(`sand:${sand.uuid}`, {
		map: sand,
		color: PALETTE.earth,
		pattern: 'meadow',
		patternScale: MEADOW.patternScale,
		patternInk: MEADOW.patternInk,
		sideDark: 0.5,
		shadowSide: THREE.FrontSide,
		outline: false,
	});
	patchShader(mat, 'sandLawn', (shader) => {
		shader.uniforms.uSandLawn = { value: sandLawn };
		shader.uniforms.uLawnColor = { value: new THREE.Color(PALETTE.grass) };
		shader.fragmentShader = `uniform sampler2D uSandLawn;\nuniform vec3 uLawnColor;\n${shader.fragmentShader}`
			.replace('#include <map_fragment>', '#include <map_fragment>\nfloat sandLawn = texture2D(uSandLawn, vMapUv).r;')
			.replace('diffuseColor.rgb = toonPattern(diffuseColor.rgb);', 'diffuseColor.rgb = mix(diffuseColor.rgb, toonPattern(uLawnColor), sandLawn);');
	});
	return mat;
}

/** The lawn's pattern, shared with the sand that fades into it. */
const MEADOW = { patternScale: 0.9, patternInk: 0.28 };

/** Lawn: painted patches and blade strokes, no texture. No ink: grass edges are soft. */
export function meadowMat():ToonMaterial {
	return remember('meadow', {
		color: PALETTE.grass,
		pattern: 'meadow',
		...MEADOW,
		sideDark: 0.5,
		shadowSide: THREE.FrontSide,
		outline: false,
	});
}

