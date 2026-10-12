import * as THREE from 'three';
import { patchShader } from './shader.js';

/**
 * Drawn surface detail, computed from world position so it needs no texture or UVs.
 * Sides read the pattern upright; tops lay it along the slope (roofs) or flat (floors).
 */
export type ToonPattern = 'none' | 'brick' | 'plank' | 'thatch' | 'stone' | 'meadow';

const PATTERN_ID:Record<ToonPattern, number> = { none: 0, brick: 1, plank: 2, thatch: 3, stone: 4, meadow: 5 };

export type ToonMaterialParameters = THREE.MeshToonMaterialParameters & {
	/** Light levels from shadow to lit, each 0–1. Default three bands. */
	bands?:number[];
	/** Multiplies the unlit side (sky and ambient light), for hue-shifted shadows. */
	shade?:THREE.ColorRepresentation;
	/** Back-light rim strength, 0 for none. */
	rim?:number;
	pattern?:ToonPattern;
	/** Meters per pattern course (one brick, board, straw row or stone). */
	patternScale?:number;
	/** Meters per course on upward faces. Default `patternScale`. Match it to tread depth and tile size so tops line up. */
	topScale?:number;
	/** Brick length in meters, staggered by half each course. Default two side courses. */
	brickLength?:number;
	/** Direction courses count along on flat tops (rows run across it). Default +z. Stairs point it uphill so each tread continues the brick course below it. */
	topAxis?:{ x:number; z:number };
	/** How dark pattern lines are, 0 (none) to 1 (black). */
	patternInk?:number;
	/** Drawn with ink outlines by the renderer. Off for grass, foliage and other noisy surfaces. */
	outline?:boolean;
};

const DEFAULT_BANDS = [0.42, 0.74, 1];
const ramps = new Map<string, THREE.DataTexture>();

/** A cached 1×N ramp with hard steps, for `gradientMap`. */
export function toonRamp(bands:number[] = DEFAULT_BANDS):THREE.DataTexture {
	const key = bands.join(',');
	let tex = ramps.get(key);
	if (!tex) {
		const data = new Uint8Array(bands.map((b) => Math.round(THREE.MathUtils.clamp(b, 0, 1) * 255)));
		tex = new THREE.DataTexture(data, bands.length, 1, THREE.RedFormat);
		tex.minFilter = THREE.NearestFilter;
		tex.magFilter = THREE.NearestFilter;
		tex.generateMipmaps = false;
		tex.needsUpdate = true;
		ramps.set(key, tex);
	}
	return tex;
}

const TOON_VERTEX = `
#if TOON_PATTERN > 0
{
	vec4 toonWorld = vec4(transformed, 1.0);
	vec3 toonNormal = objectNormal;
	#ifdef USE_INSTANCING
		toonWorld = instanceMatrix * toonWorld;
		toonNormal = mat3(instanceMatrix) * toonNormal;
	#endif
	vToonWorld = (modelMatrix * toonWorld).xyz;
	vToonNormal = normalize(mat3(modelMatrix) * toonNormal);
}
#endif
`;

const TOON_COMMON_VERTEX = `
#if TOON_PATTERN > 0
varying vec3 vToonWorld;
varying vec3 vToonNormal;
#endif
`;

const TOON_COMMON_FRAGMENT = `
uniform vec3 uToonShade;
uniform float uToonRim;
#if TOON_PATTERN > 0
uniform float uPatternScale;
uniform float uPatternTopScale;
uniform float uBrickLength;
uniform vec2 uTopAxis;
uniform float uPatternInk;
varying vec3 vToonWorld;
varying vec3 vToonNormal;

float toonHash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// 1 on a line of half-width w (in pattern units) around distance d, antialiased.
float toonLine(float d, float w) {
	float fw = fwidth(d);
	return 1.0 - smoothstep(w - fw, w + fw, d);
}

// x: tone, y: line.
vec2 toonBrick(vec2 p, float len) {
	float row = floor(p.y);
	p.x += mod(row, 2.0) * len * 0.5;
	vec2 cell = vec2(floor(p.x / len), row);
	vec2 f = vec2(fract(p.x / len) * len, fract(p.y));
	float d = min(min(f.x, len - f.x), min(f.y, 1.0 - f.y));
	return vec2(0.92 + 0.16 * toonHash(cell), toonLine(d, 0.06));
}

// Boards along x, one per unit of y: dark seams, rarer butt joints, long wavy grain.
vec2 toonPlank(vec2 p) {
	float row = floor(p.y);
	float f = fract(p.y);
	float len = 8.0 + 6.0 * toonHash(vec2(row, 7.0));
	float sx = p.x + toonHash(vec2(row, 3.0)) * len;
	float board = floor(sx / len);
	float joint = min(fract(sx / len), 1.0 - fract(sx / len)) * len;
	float seam = min(f, 1.0 - f);
	float g = p.y * 4.0 + 0.5 * sin(p.x * 0.7 + row * 1.7) + 0.25 * sin(p.x * 2.1 + board * 3.1);
	float grain = abs(fract(g) - 0.5);
	float line = max(toonLine(seam, 0.07), max(0.8 * toonLine(joint, 0.06), 0.28 * toonLine(grain, 0.06)));
	float tone = (0.8 + 0.32 * toonHash(vec2(board, row))) * (0.88 + 0.12 * smoothstep(0.0, 0.22, seam));
	return vec2(tone, line);
}

// Straw courses, one per unit of y with y rising uphill: ragged strand tips hang over
// the course below, and each course darkens where the next one overlaps it.
vec2 toonThatch(vec2 p) {
	float col = floor(p.x * 8.0);
	float y = p.y + 0.28 * toonHash(vec2(col, floor(p.y)));
	float row = floor(y);
	float f = fract(y);
	float strand = abs(fract(p.x * 8.0) - 0.5);
	float pick = toonHash(vec2(col, row + 5.0));
	float tone = (1.1 - 0.38 * smoothstep(0.35, 1.0, f)) * (0.9 + 0.18 * pick);
	float line = max(toonLine(f, 0.05), 0.45 * toonLine(strand, 0.1) * step(0.55, pick) * smoothstep(0.15, 0.6, f));
	return vec2(tone, line);
}

float toonValue(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(toonHash(i), toonHash(i + vec2(1.0, 0.0)), f.x),
		mix(toonHash(i + vec2(0.0, 1.0)), toonHash(i + vec2(1.0, 1.0)), f.x),
		f.y
	);
}

// Painted lawn: soft light and dark patches, with a short tilted blade stroke in some cells.
vec2 toonMeadow(vec2 p) {
	float n = toonValue(p * 0.35) * 0.65 + toonValue(p * 1.1 + 13.0) * 0.35;
	float tone = 0.84 + 0.28 * smoothstep(0.32, 0.72, n);
	vec2 c = floor(p * 2.5);
	vec2 f = fract(p * 2.5) - 0.5;
	float h = toonHash(c);
	vec2 q = f - (vec2(toonHash(c + 3.1), toonHash(c + 7.7)) - 0.5) * 0.5;
	float lean = (h - 0.78) * 3.0;
	float tick = step(0.6, h) * toonLine(abs(q.x - q.y * lean), 0.035) * (1.0 - smoothstep(0.08, 0.2, abs(q.y)));
	return vec2(tone, tick);
}

vec2 toonStone(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	float f1 = 8.0;
	float f2 = 8.0;
	vec2 best = vec2(0.0);
	for (int y = -1; y <= 1; y++) {
		for (int x = -1; x <= 1; x++) {
			vec2 g = vec2(float(x), float(y));
			vec2 o = vec2(toonHash(i + g), toonHash(i + g + 17.0));
			float d = length(g + 0.15 + o * 0.7 - f);
			if (d < f1) {
				f2 = f1;
				f1 = d;
				best = i + g;
			}
			else if (d < f2) {
				f2 = d;
			}
		}
	}
	return vec2(0.88 + 0.2 * toonHash(best), toonLine(f2 - f1, 0.07));
}

vec3 toonPattern(vec3 diffuse) {
	vec3 n = normalize(vToonNormal);
	vec3 an = abs(n);
	float scale = an.y > 0.5 ? uPatternTopScale : uPatternScale;
	vec3 w = vToonWorld / scale;
	vec2 p;
	vec2 slope = n.xz;
	if (an.y > 0.5 && dot(slope, slope) > 0.0025) {
		// Slopes (roofs): courses run along the eaves, y rising uphill.
		slope = normalize(slope);
		p = vec2(dot(w.xz, vec2(-slope.y, slope.x)), -dot(w.xz, slope));
	}
	else if (an.y > 0.5) {
		p = vec2(dot(w.xz, vec2(uTopAxis.y, -uTopAxis.x)), dot(w.xz, uTopAxis));
	}
	else {
		p = an.x > an.z ? vec2(w.z, w.y) : vec2(w.x, w.y);
	}
	#if TOON_PATTERN == 1
		vec2 tl = toonBrick(p, uBrickLength / scale);
	#elif TOON_PATTERN == 2
		vec2 tl = toonPlank(p);
	#elif TOON_PATTERN == 3
		vec2 tl = toonThatch(p);
	#elif TOON_PATTERN == 5
		vec2 tl = toonMeadow(p);
	#else
		vec2 tl = toonStone(p);
	#endif
	// Fade lines out where they would shimmer.
	float fade = 1.0 - smoothstep(0.25, 0.6, length(fwidth(p)));
	return diffuse * mix(tl.x, 1.0, 1.0 - fade) * mix(1.0, 1.0 - uPatternInk, tl.y * fade);
}
#endif
`;

const TOON_COLOR = `
#if TOON_PATTERN > 0
	diffuseColor.rgb = toonPattern(diffuseColor.rgb);
#endif
`;

const TOON_LIGHTS = `
reflectedLight.indirectDiffuse *= uToonShade;
{
	float toonRim = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
	reflectedLight.indirectDiffuse += diffuseColor.rgb * uToonRim * smoothstep(0.6, 0.66, toonRim);
}
`;

/** Clears alpha so the renderer's outline pass skips this surface. Last write in the shader. */
const TOON_NO_OUTLINE = `
#ifdef TOON_NO_OUTLINE
	gl_FragColor.a = 0.0;
#endif
`;

/**
 * `MeshToonMaterial` with a hard-stepped ramp, tinted shadow side, rim light and drawn patterns.
 * Keeps Three's lights, shadows, fog, maps and instancing; stacks with other {@link patchShader} edits.
 */
export class ToonMaterial extends THREE.MeshToonMaterial {
	public readonly shade:THREE.Color;
	private _outline = true;
	private readonly _uniforms:{
		uToonShade:THREE.IUniform<THREE.Color>;
		uToonRim:THREE.IUniform<number>;
		uPatternScale:THREE.IUniform<number>;
		uPatternTopScale:THREE.IUniform<number>;
		uBrickLength:THREE.IUniform<number>;
		uTopAxis:THREE.IUniform<THREE.Vector2>;
		uPatternInk:THREE.IUniform<number>;
	};

	constructor(params:ToonMaterialParameters = {}) {
		const { bands, shade, rim, pattern, patternScale, topScale, brickLength, topAxis, patternInk, outline, ...base } = params;
		super({ gradientMap: toonRamp(bands), ...base });
		this.shade = new THREE.Color(shade ?? 0xffffff);
		this._uniforms = {
			uToonShade: { value: this.shade },
			uToonRim: { value: rim ?? 0 },
			uPatternScale: { value: patternScale ?? 0.25 },
			uPatternTopScale: { value: topScale ?? patternScale ?? 0.25 },
			uBrickLength: { value: brickLength ?? 2 * (patternScale ?? 0.25) },
			uTopAxis: { value: new THREE.Vector2(topAxis?.x ?? 0, topAxis?.z ?? 1).normalize() },
			uPatternInk: { value: patternInk ?? 0.45 },
		};
		this.defines = {
			...this.defines,
			TOON_PATTERN: PATTERN_ID[pattern ?? 'none'],
		};
		this.outline = outline ?? true;
		const uniforms = this._uniforms;
		patchShader(this, 'toon', (shader) => {
			Object.assign(shader.uniforms, uniforms);
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', `#include <common>\n${TOON_COMMON_VERTEX}`)
				.replace('#include <project_vertex>', `#include <project_vertex>\n${TOON_VERTEX}`);
			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', `#include <common>\n${TOON_COMMON_FRAGMENT}`)
				.replace('#include <color_fragment>', `#include <color_fragment>\n${TOON_COLOR}`)
				.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${TOON_LIGHTS}`)
				.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${TOON_NO_OUTLINE}`);
		});
	}

	public override copy(source:ToonMaterial):this {
		super.copy(source);
		this.defines = { ...source.defines };
		this.outline = source.outline;
		this.shade.copy(source.shade);
		this.rim = source.rim;
		this.patternScale = source.patternScale;
		this.topScale = source.topScale;
		this.brickLength = source.brickLength;
		this._uniforms.uTopAxis.value.copy(source._uniforms.uTopAxis.value);
		this.patternInk = source.patternInk;
		return this;
	}

	public get rim():number {
		return this._uniforms.uToonRim.value;
	}

	public set rim(value:number) {
		this._uniforms.uToonRim.value = value;
	}

	public get patternScale():number {
		return this._uniforms.uPatternScale.value;
	}

	public set patternScale(value:number) {
		this._uniforms.uPatternScale.value = value;
	}

	public get topScale():number {
		return this._uniforms.uPatternTopScale.value;
	}

	public set topScale(value:number) {
		this._uniforms.uPatternTopScale.value = value;
	}

	public get brickLength():number {
		return this._uniforms.uBrickLength.value;
	}

	public set brickLength(value:number) {
		this._uniforms.uBrickLength.value = value;
	}

	public get patternInk():number {
		return this._uniforms.uPatternInk.value;
	}

	public set patternInk(value:number) {
		this._uniforms.uPatternInk.value = value;
	}

	public get outline():boolean {
		return this._outline;
	}

	/**
	 * Off keeps this surface out of the ink pass, which reads alpha as its mask. Opaque surfaces write
	 * alpha 0; transparent ones keep their alpha for blending and leave the mask beneath untouched.
	 * Set `transparent` first.
	 */
	public set outline(value:boolean) {
		this._outline = value;
		const defines = this.defines ??= {};
		if (!value && !this.transparent) {
			defines.TOON_NO_OUTLINE = '';
		}
		else {
			delete defines.TOON_NO_OUTLINE;
		}
		if (!value && this.transparent) {
			this.blending = THREE.CustomBlending;
			this.blendEquation = THREE.AddEquation;
			this.blendSrc = THREE.SrcAlphaFactor;
			this.blendDst = THREE.OneMinusSrcAlphaFactor;
			this.blendSrcAlpha = THREE.ZeroFactor;
			this.blendDstAlpha = THREE.OneFactor;
		}
		else if (this.blending === THREE.CustomBlending) {
			this.blending = THREE.NormalBlending;
		}
		this.needsUpdate = true;
	}
}
