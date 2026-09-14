import * as THREE from 'three';
import { loadImage } from './spritesheet';

export type NatureMaps = {
	grass:THREE.Texture;
	blade:THREE.Texture;
	oak:THREE.Texture;
	pine:THREE.Texture;
	water:THREE.Texture;
	fall:THREE.Texture;
	wood:THREE.Texture;
	thatch:THREE.Texture;
	boulder:THREE.Texture;
};

export const WIND_GRASS = 0.04;
export const WIND_TREE = 0.05;
export const GRASS_Y = 0.012;
export const WATER_UPPER_Y = GRASS_Y;
export const WATER_LOWER_Y = GRASS_Y - 0.14;
export const GRASS_UV_REP = 4;
/** Occupancy G channel is world-Y / this. Taller than abbey walls. */
export const GRASS_CLIP_MAX_Y = 4;

function windVertex(amount:number):string {
	return `float windSway = sin(uTime * 1.35 + modelMatrix[3].x * 0.7 + modelMatrix[3].z * 0.5) * ${amount.toFixed(3)} * uv.y;
					transformed.x += windSway;
					transformed.z += windSway * 0.28;`;
}

const GRASS_CLIP_VERT = 'varying vec3 vWorldPos;\n';
const GRASS_CLIP_FRAG = `uniform sampler2D uGrassClip;
uniform vec2 uClipOrigin;
uniform vec2 uClipSize;
uniform float uClipMaxY;
varying vec3 vWorldPos;
`;
const GRASS_CLIP_WORLD = `#include <project_vertex>
			{
				vec4 gw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
				gw = instanceMatrix * gw;
#endif
				gw = modelMatrix * gw;
				vWorldPos = gw.xyz;
			}`;
/** World-space tile prisms: discard fragments inside non-grass volumes. */
const GRASS_CLIP_DISCARD = `#include <clipping_planes_fragment>
			{
				vec2 clipUv = (vWorldPos.xz - uClipOrigin) / uClipSize;
				if (clipUv.x >= 0.0 && clipUv.y >= 0.0 && clipUv.x <= 1.0 && clipUv.y <= 1.0) {
					vec4 occ = texture2D(uGrassClip, clipUv);
					if (occ.r < 0.5 && vWorldPos.y < occ.g * uClipMaxY) {
						discard;
					}
				}
			}`;

let clipWhite:THREE.DataTexture | null = null;

function clipWhiteTex():THREE.DataTexture {
	if (!clipWhite) {
		clipWhite = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
		clipWhite.needsUpdate = true;
		clipWhite.userData.shared = true;
	}
	return clipWhite;
}

function attachGrassClip(mat:THREE.Material):{
	uGrassClip:{ value:THREE.Texture };
	uClipOrigin:{ value:THREE.Vector2 };
	uClipSize:{ value:THREE.Vector2 };
	uClipMaxY:{ value:number };
} {
	const uniforms = {
		uGrassClip: { value: clipWhiteTex() as THREE.Texture },
		uClipOrigin: { value: new THREE.Vector2(0, 0) },
		uClipSize: { value: new THREE.Vector2(1, 1) },
		uClipMaxY: { value: GRASS_CLIP_MAX_Y },
	};
	mat.userData.uGrassClip = uniforms.uGrassClip;
	mat.userData.uClipOrigin = uniforms.uClipOrigin;
	mat.userData.uClipSize = uniforms.uClipSize;
	mat.userData.uClipMaxY = uniforms.uClipMaxY;
	return uniforms;
}

const windMats = new Set<THREE.Material>();
const matCache = new Map<string, THREE.Material>();
let maps:NatureMaps | null = null;
let pending:Promise<NatureMaps> | null = null;

function remember<T extends THREE.Material>(key:string, make:() => T):T {
	const hit = matCache.get(key);
	if (hit) {
		return hit as T;
	}
	const mat = make();
	mat.userData.shared = true;
	matCache.set(key, mat);
	return mat;
}

type TimeUniform = { value:number };

/** One object for every compile of this material (AO clones, fog variants, …). */
function timeUniform(mat:THREE.Material):TimeUniform {
	const hit = mat.userData.uTime as TimeUniform | undefined;
	if (hit) {
		return hit;
	}
	const u:TimeUniform = { value: 0 };
	mat.userData.uTime = u;
	return u;
}

function bindTime(mat:THREE.Material, shader:{ uniforms:Record<string, { value:unknown }> }):void {
	shader.uniforms.uTime = timeUniform(mat);
}

function track(mat:THREE.Material):void {
	timeUniform(mat);
	trackNature(mat);
}

export function trackNature(mat:THREE.Material):void {
	windMats.add(mat);
}

export function untrackNature(mat:THREE.Material):void {
	windMats.delete(mat);
}

/** Drop GPU + JS refs for materials reused across chunks/props. */
export function disposeSharedNature():void {
	for (const mat of matCache.values()) {
		mat.dispose();
	}
	matCache.clear();
	windMats.clear();
	clipWhite?.dispose();
	clipWhite = null;
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		maps = null;
		pending = null;
		disposeSharedNature();
	});
}

function chromaMagenta(img:HTMLImageElement):HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	const scale = Math.min(1, 768 / Math.max(img.naturalWidth, img.naturalHeight));
	canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
	canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		throw new Error('2d context');
	}
	ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
	const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const px = data.data;
	for (let i = 0; i < px.length; i += 4) {
		const r = px[i];
		const g = px[i + 1];
		const b = px[i + 2];
		if (r > 120 && b > 120 && g < 130 && (r + b) > g * 2.15) {
			px[i + 3] = 0;
		}
	}
	ctx.putImageData(data, 0, 0);
	return canvas;
}

/** Lime/chartreuse art → one shared Shire pasture hue and a tight lightness band. */
function rgbToHsl(r:number, g:number, b:number):[number, number, number] {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) {
		return [0, 0, l];
	}
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h = 0;
	if (max === r) {
		h = (g - b) / d + (g < b ? 6 : 0);
	}
	else if (max === g) {
		h = (b - r) / d + 2;
	}
	else {
		h = (r - g) / d + 4;
	}
	return [h / 6, s, l];
}

function hslToRgb(h:number, s:number, l:number):[number, number, number] {
	const hue2rgb = (p:number, q:number, t:number):number => {
		let x = t;
		if (x < 0) {
			x += 1;
		}
		if (x > 1) {
			x -= 1;
		}
		if (x < 1 / 6) {
			return p + (q - p) * 6 * x;
		}
		if (x < 1 / 2) {
			return q;
		}
		if (x < 2 / 3) {
			return p + (q - p) * (2 / 3 - x) * 6;
		}
		return p;
	};
	if (s <= 1e-5) {
		const v = Math.round(l * 255);
		return [v, v, v];
	}
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	return [
		Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
		Math.round(hue2rgb(p, q, h) * 255),
		Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
	];
}

function hash2(x:number, y:number):number {
	const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
	return n - Math.floor(n);
}

function tintShire(canvas:HTMLCanvasElement):void {
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		return;
	}
	const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const px = data.data;
	let minL = 1;
	let maxL = 0;
	for (let i = 0; i < px.length; i += 4) {
		if (px[i + 3] < 12) {
			continue;
		}
		const l = rgbToHsl(px[i], px[i + 1], px[i + 2])[2];
		minL = Math.min(minL, l);
		maxL = Math.max(maxL, l);
	}
	const span = Math.max(0.04, maxL - minL);
	for (let i = 0; i < px.length; i += 4) {
		if (px[i + 3] < 12) {
			continue;
		}
		const l = rgbToHsl(px[i], px[i + 1], px[i + 2])[2];
		const t = (l - minL) / span;
		const [r, g, b] = hslToRgb(0.32, 0.54, 0.24 + t * 0.06);
		px[i] = r;
		px[i + 1] = g;
		px[i + 2] = b;
	}
	ctx.putImageData(data, 0, 0);
}

function meanOpaque(src:HTMLCanvasElement):[number, number, number] {
	const ctx = src.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		return [46, 96, 48];
	}
	const px = ctx.getImageData(0, 0, src.width, src.height).data;
	let r = 0;
	let g = 0;
	let b = 0;
	let n = 0;
	for (let i = 0; i < px.length; i += 4) {
		if (px[i + 3] < 40) {
			continue;
		}
		r += px[i];
		g += px[i + 1];
		b += px[i + 2];
		n += 1;
	}
	if (n === 0) {
		return [46, 96, 48];
	}
	return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

function recodeOpaque(canvas:HTMLCanvasElement, rgb:[number, number, number]):void {
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		return;
	}
	const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const px = data.data;
	for (let i = 0; i < px.length; i += 4) {
		if (px[i + 3] < 12) {
			px[i + 3] = 0;
			continue;
		}
		px[i] = rgb[0];
		px[i + 1] = rgb[1];
		px[i + 2] = rgb[2];
		px[i + 3] = 255;
	}
	ctx.putImageData(data, 0, 0);
}

function outlineCutout(canvas:HTMLCanvasElement, rgb:[number, number, number]):void {
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		return;
	}
	const { width, height } = canvas;
	const src = ctx.getImageData(0, 0, width, height);
	const px = src.data;
	const out = ctx.createImageData(width, height);
	out.data.set(px);
	const alpha = (x:number, y:number):number => {
		if (x < 0 || y < 0 || x >= width || y >= height) {
			return 0;
		}
		return px[(y * width + x) * 4 + 3];
	};
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			if (px[i + 3] < 40) {
				continue;
			}
			if (alpha(x - 1, y) < 40 || alpha(x + 1, y) < 40 || alpha(x, y - 1) < 40 || alpha(x, y + 1) < 40) {
				out.data[i] = rgb[0];
				out.data[i + 1] = rgb[1];
				out.data[i + 2] = rgb[2];
			}
		}
	}
	ctx.putImageData(out, 0, 0);
}

function wrapI(i:number, size:number):number {
	return ((i % size) + size) % size;
}

function wrapF(v:number, size:number):number {
	return ((v % size) + size) % size;
}

function lerp(a:number, b:number, t:number):number {
	return a + (b - a) * t;
}

function mixRgb(a:[number, number, number], b:[number, number, number], t:number):[number, number, number] {
	return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function tileValue(x:number, y:number, size:number, cell:number):number {
	const n = size / cell;
	const gx = x / cell;
	const gy = y / cell;
	const x0 = Math.floor(gx);
	const y0 = Math.floor(gy);
	const tx = gx - x0;
	const ty = gy - y0;
	const sx = tx * tx * (3 - 2 * tx);
	const sy = ty * ty * (3 - 2 * ty);
	const at = (ix:number, iy:number):number => hash2(((ix % n) + n) % n, ((iy % n) + n) % n);
	return lerp(lerp(at(x0, y0), at(x0 + 1, y0), sx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), sx), sy);
}

function smoothstep(e0:number, e1:number, x:number):number {
	const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-5, e1 - e0)));
	return t * t * (3 - 2 * t);
}

function matchMean(canvas:HTMLCanvasElement, target:[number, number, number]):void {
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		return;
	}
	const mean = meanOpaque(canvas);
	const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const px = data.data;
	const sx = target[0] / Math.max(1, mean[0]);
	const sy = target[1] / Math.max(1, mean[1]);
	const sz = target[2] / Math.max(1, mean[2]);
	for (let i = 0; i < px.length; i += 4) {
		px[i] = Math.max(0, Math.min(255, Math.round(px[i] * sx)));
		px[i + 1] = Math.max(0, Math.min(255, Math.round(px[i + 1] * sy)));
		px[i + 2] = Math.max(0, Math.min(255, Math.round(px[i + 2] * sz)));
	}
	ctx.putImageData(data, 0, 0);
}

function tiledVoronoi(x:number, y:number, size:number, cells:number, pts:{ x:number; y:number }[]):{ f1:number; f2:number } {
	const cell = size / cells;
	const gx = Math.floor(x / cell);
	const gy = Math.floor(y / cell);
	let f1 = 1e9;
	let f2 = 1e9;
	for (let oy = -1; oy <= 1; oy++) {
		for (let ox = -1; ox <= 1; ox++) {
			const ix = wrapI(gx + ox, cells);
			const iy = wrapI(gy + oy, cells);
			const pt = pts[iy * cells + ix];
			const d = Math.hypot(x - (pt.x + ox * size), y - (pt.y + oy * size));
			if (d < f1) {
				f2 = f1;
				f1 = d;
			}
			else if (d < f2) {
				f2 = d;
			}
		}
	}
	return { f1, f2 };
}

function scatterPts(size:number, cells:number, salt:number):{ x:number; y:number }[] {
	const cell = size / cells;
	const pts:{ x:number; y:number }[] = [];
	for (let gy = 0; gy < cells; gy++) {
		for (let gx = 0; gx < cells; gx++) {
			pts.push({
				x: (gx + 0.2 + hash2(gx + salt, gy) * 0.6) * cell,
				y: (gy + 0.2 + hash2(gx, gy + salt + 3) * 0.6) * cell,
			});
		}
	}
	return pts;
}

/** Top-down cartoon lawn: round plant canopies and tip speckles, never side-view blades. */
function paintGrassyTile(pasture:[number, number, number]):HTMLCanvasElement {
	const size = 256;
	const out = document.createElement('canvas');
	out.width = size;
	out.height = size;
	const ctx = out.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		return out;
	}
	const cells = 16;
	const cell = size / cells;
	const pts = scatterPts(size, cells, 11);
	const gap = hslToRgb(0.33, 0.48, 0.24);
	const crown = hslToRgb(0.34, 0.50, 0.38);
	const tip = hslToRgb(0.37, 0.44, 0.46);
	const img = ctx.createImageData(size, size);
	const px = img.data;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const v = tiledVoronoi(x, y, size, cells, pts);
			const plant = 1 - smoothstep(cell * 0.12, cell * 0.52, v.f1);
			const crack = 1 - smoothstep(0.02, cell * 0.16, v.f2 - v.f1);
			const meadow = tileValue(x, y, size, 128) * 0.45 + tileValue(x + 17, y + 9, size, 64) * 0.35 + tileValue(x, y, size, 32) * 0.2;
			let rgb = mixRgb(pasture, gap, crack * 0.5);
			rgb = mixRgb(rgb, crown, plant * 0.5);
			rgb = mixRgb(rgb, mixRgb(gap, crown, meadow), 0.22);
			const speck = hash2(x * 1.13, y * 1.07);
			if (speck > 0.91 && plant > 0.2) {
				rgb = mixRgb(rgb, tip, 0.75);
			}
			else if (speck < 0.05) {
				rgb = mixRgb(rgb, gap, 0.35);
			}
			const i = (y * size + x) * 4;
			px[i] = rgb[0];
			px[i + 1] = rgb[1];
			px[i + 2] = rgb[2];
			px[i + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);
	matchMean(out, pasture);
	return out;
}

function scatterFoam(size:number, cells:number, salt:number):{ x:number; y:number }[] {
	const cell = size / cells;
	const pts:{ x:number; y:number }[] = [];
	for (let gy = 0; gy < cells; gy++) {
		for (let gx = 0; gx < cells; gx++) {
			const hex = (gy % 2) * 0.28;
			pts.push({
				x: (gx + 0.1 + hex + hash2(gx + salt, gy) * 0.52) * cell,
				y: (gy + 0.1 + hash2(gx, gy + salt + 9) * 0.52) * cell,
			});
		}
	}
	return pts;
}

function foamEdge(d:number, cell:number, vary:number):number {
	const core = cell * (0.12 + vary * 0.07);
	const halo = core + cell * 0.13;
	if (d <= core) {
		return 1;
	}
	if (d < halo) {
		return 1 - (d - core) / (halo - core);
	}
	return 0;
}

/** Dense organic foam web — hex-staggered sites so it does not read as a square tile. */
function paintToonWater():HTMLCanvasElement {
	const size = 256;
	const cellsA = 16;
	const cellsB = 11;
	const cellA = size / cellsA;
	const cellB = size / cellsB;
	const out = document.createElement('canvas');
	out.width = size;
	out.height = size;
	const ctx = out.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		return out;
	}
	const ptsA = scatterFoam(size, cellsA, 7);
	const ptsB = scatterFoam(size, cellsB, 19);
	const img = ctx.createImageData(size, size);
	const px = img.data;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const wx = wrapF(
				x
				+ (tileValue(x, y, size, 96) - 0.5) * cellA * 0.55
				+ (tileValue(x + 19, y + 27, size, 48) - 0.5) * cellA * 0.28,
				size,
			);
			const wy = wrapF(
				y
				+ (tileValue(x + 41, y + 13, size, 96) - 0.5) * cellA * 0.55
				+ (tileValue(x + 7, y + 53, size, 48) - 0.5) * cellA * 0.28,
				size,
			);
			const a = tiledVoronoi(wx, wy, size, cellsA, ptsA);
			const b = tiledVoronoi(wx, wy, size, cellsB, ptsB);
			const vary = tileValue(x, y, size, 64);
			const line = Math.max(foamEdge(a.f2 - a.f1, cellA, vary), foamEdge(b.f2 - b.f1, cellB, vary) * 0.78);
			const g = Math.round(line * 15) * 17;
			const i = (y * size + x) * 4;
			px[i] = g;
			px[i + 1] = g;
			px[i + 2] = g;
			px[i + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);
	return out;
}

function contentUVFromCanvas(canvas:HTMLCanvasElement):{ u0:number; v0:number; u1:number; v1:number } {
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		return { u0: 0, v0: 0, u1: 1, v1: 1 };
	}
	const { width, height } = canvas;
	const px = ctx.getImageData(0, 0, width, height).data;
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (px[(y * width + x) * 4 + 3] < 12) {
				continue;
			}
			if (x < minX) {
				minX = x;
			}
			if (y < minY) {
				minY = y;
			}
			if (x > maxX) {
				maxX = x;
			}
			if (y > maxY) {
				maxY = y;
			}
		}
	}
	if (maxX < 0) {
		return { u0: 0, v0: 0, u1: 1, v1: 1 };
	}
	const pad = 1;
	minX = Math.max(0, minX - pad);
	minY = Math.max(0, minY - pad);
	maxX = Math.min(width - 1, maxX + pad);
	maxY = Math.min(height - 1, maxY + pad);
	return {
		u0: minX / width,
		u1: (maxX + 1) / width,
		v0: 1 - (maxY + 1) / height,
		v1: 1 - minY / height,
	};
}

function texFromCanvas(canvas:HTMLCanvasElement, repeat:boolean):THREE.Texture {
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.generateMipmaps = true;
	tex.anisotropy = 4;
	tex.userData.contentUV = contentUVFromCanvas(canvas);
	if (repeat) {
		tex.wrapS = THREE.RepeatWrapping;
		tex.wrapT = THREE.RepeatWrapping;
	}
	else {
		tex.wrapS = THREE.ClampToEdgeWrapping;
		tex.wrapT = THREE.ClampToEdgeWrapping;
	}
	return tex;
}

async function loadCutout(src:string, repeat:boolean):Promise<THREE.Texture> {
	const img = await loadImage(src);
	return texFromCanvas(chromaMagenta(img), repeat);
}

async function loadMatchedGrass(_tileSrc:string, bladeSrc:string):Promise<{ grass:THREE.Texture; blade:THREE.Texture }> {
	const bladeImg = await loadImage(bladeSrc);
	const blades = chromaMagenta(bladeImg);
	const pasture = hslToRgb(0.33, 0.52, 0.34);
	recodeOpaque(blades, pasture);
	outlineCutout(blades, [10, 28, 12]);
	const lawn = paintGrassyTile(pasture);
	const bladeTex = texFromCanvas(blades, false);
	bladeTex.generateMipmaps = true;
	bladeTex.minFilter = THREE.LinearMipmapLinearFilter;
	bladeTex.magFilter = THREE.LinearFilter;
	const grassTex = texFromCanvas(lawn, true);
	const host = window as unknown as { __grassDbg?:{ pasture:[number, number, number]; lawn:ReturnType<typeof meanOpaque>; blade:ReturnType<typeof meanOpaque> } };
	host.__grassDbg = { pasture, lawn: meanOpaque(lawn), blade: meanOpaque(blades) };
	return {
		grass: grassTex,
		blade: bladeTex,
	};
}

export function loadNature():Promise<NatureMaps> {
	if (maps) {
		return Promise.resolve(maps);
	}
	if (pending) {
		return pending;
	}
	const base = `${import.meta.env.BASE_URL}nature/`;
	pending = Promise.all([
		loadMatchedGrass(`${base}grass_tile.png`, `${base}grass_blade.png`),
		loadCutout(`${base}tree_oak.png`, false),
		loadCutout(`${base}tree_pine.png`, false),
		loadCutout(`${base}waterfall.png`, false),
		loadCutout(`${base}wood_plank.png`, true),
		loadCutout(`${base}thatch.png`, true),
		loadCutout(`${base}boulder.png`, false),
	]).then(([grassPair, oak, pine, fall, wood, thatch, boulder]) => {
		const waterCanvas = paintToonWater();
		const water = texFromCanvas(waterCanvas, true);
		water.colorSpace = THREE.NoColorSpace;
		water.generateMipmaps = false;
		water.minFilter = THREE.LinearFilter;
		water.magFilter = THREE.LinearFilter;
		water.needsUpdate = true;
		maps = { grass: grassPair.grass, blade: grassPair.blade, oak, pine, water, fall, wood, thatch, boulder };
		return maps;
	}).catch((err:unknown) => {
		pending = null;
		throw err;
	});
	return pending;
}

export function getNature():NatureMaps {
	if (!maps) {
		throw new Error('nature textures not loaded');
	}
	return maps;
}

export function natureReady():boolean {
	return maps !== null;
}

export function natureMat(
	map:THREE.Texture,
	opts:{
		alpha?:boolean;
		wind?:boolean;
		windAmount?:number;
		scroll?:boolean;
		flow?:'fall' | 'surface';
		color?:number;
		roughness?:number;
	} = {},
):THREE.MeshStandardMaterial {
	const key = `std:${map.uuid}:${opts.alpha ? 1 : 0}:${opts.wind ? 1 : 0}:${opts.windAmount ?? ''}:${opts.scroll ? 1 : 0}:${opts.flow ?? ''}:${opts.color ?? ''}:${opts.roughness ?? ''}`;
	return remember(key, () => makeNatureMat(map, opts));
}

function makeNatureMat(
	map:THREE.Texture,
	opts:{
		alpha?:boolean;
		wind?:boolean;
		windAmount?:number;
		scroll?:boolean;
		flow?:'fall' | 'surface';
		color?:number;
		roughness?:number;
	},
):THREE.MeshStandardMaterial {
	const cutout = !!opts.alpha && !opts.scroll;
	const surface = opts.flow === 'surface';
	const mat = new THREE.MeshStandardMaterial({
		map,
		roughness: opts.roughness ?? (surface ? 0.28 : 0.92),
		metalness: surface ? 0.14 : 0,
		side: THREE.DoubleSide,
		transparent: surface || (!!opts.alpha && !cutout),
		opacity: surface ? 0.9 : 1,
		alphaTest: opts.flow === 'fall' ? 0.1 : (opts.alpha && !surface ? 0.22 : 0),
		depthWrite: !surface && opts.flow !== 'fall',
	});
	if (opts.wind || opts.scroll) {
		mat.onBeforeCompile = (shader) => {
			bindTime(mat, shader);
			shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`;
			if (opts.wind) {
				shader.vertexShader = shader.vertexShader.replace(
					'#include <begin_vertex>',
					`#include <begin_vertex>
				${windVertex(opts.windAmount ?? WIND_TREE)}`,
				);
			}
			if (opts.scroll) {
				if (opts.flow === 'fall') {
					shader.vertexShader = shader.vertexShader.replace(
						'#include <begin_vertex>',
						`#include <begin_vertex>
						transformed.x += sin(uTime * 2.6 + position.y * 7.0) * 0.028;
						transformed.z += sin(uTime * 1.9 + position.y * 5.5) * 0.02;`,
					);
				}
				else if (opts.flow === 'surface') {
					shader.vertexShader = shader.vertexShader.replace(
						'#include <common>',
						`#include <common>
						attribute vec2 flow;`,
					);
					shader.vertexShader = shader.vertexShader.replace(
						'#include <uv_vertex>',
						`#include <uv_vertex>
						vMapUv -= flow * (uTime * 0.08);`,
					);
					shader.fragmentShader = `uniform float uTime;\n${shader.fragmentShader}`;
					shader.fragmentShader = shader.fragmentShader.replace(
						'#include <map_fragment>',
						`#include <map_fragment>
						diffuseColor.rgb += 0.03 * sin(uTime * 0.8 + vMapUv.x * 10.0 + vMapUv.y * 6.0);`,
					);
				}
				else {
					shader.vertexShader = shader.vertexShader.replace(
						'#include <uv_vertex>',
						`#include <uv_vertex>
						vMapUv += vec2(uTime * 0.03, uTime * 0.07);`,
					);
					shader.fragmentShader = `uniform float uTime;\n${shader.fragmentShader}`;
					shader.fragmentShader = shader.fragmentShader.replace(
						'#include <map_fragment>',
						`#include <map_fragment>
						diffuseColor.rgb += 0.03 * sin(uTime * 0.8 + vMapUv.x * 10.0 + vMapUv.y * 6.0);`,
					);
				}
			}
		};
		track(mat);
	}
	if (opts.color !== undefined) {
		mat.color.setHex(opts.color);
	}
	return mat;
}

export function grassLookMat(
	map:THREE.Texture,
	opts:{ alpha?:boolean; wind?:boolean; windAmount?:number; clipWater?:boolean } = {},
):THREE.MeshLambertMaterial {
	const key = `grass:${map.uuid}:${opts.alpha ? 1 : 0}:${opts.wind ? 1 : 0}:${opts.windAmount ?? ''}:${opts.clipWater ? 1 : 0}:vol`;
	return remember(key, () => makeGrassLookMat(map, opts));
}

function makeGrassLookMat(
	map:THREE.Texture,
	opts:{ alpha?:boolean; wind?:boolean; windAmount?:number; clipWater?:boolean },
):THREE.MeshLambertMaterial {
	const mat = new THREE.MeshLambertMaterial({
		map,
		color: 0xffffff,
		side: opts.alpha ? THREE.DoubleSide : THREE.FrontSide,
		shadowSide: THREE.FrontSide,
		alphaTest: opts.alpha ? 0.18 : 0,
		alphaToCoverage: !!opts.alpha,
		fog: true,
	});
	const clip = opts.clipWater ? attachGrassClip(mat) : null;
	mat.customProgramCacheKey = () => `grass:${opts.alpha ? 1 : 0}:${opts.wind ? 1 : 0}:${opts.clipWater ? 1 : 0}:vol`;
	mat.onBeforeCompile = (shader) => {
		bindTime(mat, shader);
		if (clip) {
			shader.uniforms.uGrassClip = clip.uGrassClip;
			shader.uniforms.uClipOrigin = clip.uClipOrigin;
			shader.uniforms.uClipSize = clip.uClipSize;
			shader.uniforms.uClipMaxY = clip.uClipMaxY;
		}
		shader.vertexShader = `uniform float uTime;\nvarying vec3 vUpView;\n${clip ? GRASS_CLIP_VERT : ''}${shader.vertexShader}`;
		shader.vertexShader = shader.vertexShader.replace(
			'vViewPosition = - mvPosition.xyz;',
			`vViewPosition = - mvPosition.xyz;
			vUpView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`,
		);
		if (opts.wind) {
			shader.vertexShader = shader.vertexShader.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				${windVertex(opts.windAmount ?? WIND_GRASS)}`,
			);
		}
		if (clip) {
			shader.vertexShader = shader.vertexShader.replace(
				'#include <project_vertex>',
				GRASS_CLIP_WORLD,
			);
			shader.fragmentShader = `${GRASS_CLIP_FRAG}${shader.fragmentShader}`;
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <clipping_planes_fragment>',
				GRASS_CLIP_DISCARD,
			);
		}
		shader.fragmentShader = `varying vec3 vUpView;\n${shader.fragmentShader}`;
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <normal_fragment_begin>',
			`#include <normal_fragment_begin>
			normal = normalize(mix(normal, vUpView, 0.88));
			nonPerturbedNormal = normal;`,
		);
	};
	track(mat);
	return mat;
}

const FOAM_WEB = `
vec2 foamHash22(vec2 p) {
	p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
	return fract(sin(p) * 43758.5453);
}
float foamRidge(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	float f1 = 8.0;
	float f2 = 8.0;
	for (int oy = -1; oy <= 1; oy++) {
		for (int ox = -1; ox <= 1; ox++) {
			vec2 g = vec2(float(ox), float(oy));
			vec2 cell = i + g;
			vec2 o = foamHash22(cell);
			o.x += 0.34 * step(0.5, mod(cell.y, 2.0));
			vec2 r = g + o * 0.7 - f;
			float d = length(r);
			if (d < f1) {
				f2 = f1;
				f1 = d;
			} else if (d < f2) {
				f2 = d;
			}
		}
	}
	return f2 - f1;
}
float foamWeb(vec2 p) {
	float a = foamRidge(p);
	float w = max(fwidth(a) * 0.85, 0.03);
	return 1.0 - smoothstep(0.05 - w, 0.16 + w, a);
}
`;

export type WaterLayer = 'lower' | 'upper';

/** Two foam sheets: river glyphs scroll the web; still pond does not shear. */
export function toonWaterMat(map:THREE.Texture, layer:WaterLayer):THREE.MeshLambertMaterial {
	return remember(`water:${layer}:30:${map.uuid}`, () => makeToonWaterMat(map, layer));
}

function makeToonWaterMat(map:THREE.Texture, layer:WaterLayer):THREE.MeshLambertMaterial {
	const upper = layer === 'upper';
	const mat = new THREE.MeshLambertMaterial({
		map,
		color: 0xffffff,
		transparent: upper,
		opacity: 1,
		depthWrite: !upper,
		side: THREE.DoubleSide,
		shadowSide: THREE.FrontSide,
		fog: true,
		toneMapped: true,
	});
	const flow = upper ? 0.16 : 0.09;
	const foamOff = upper ? 'vec2(1.85, 0.92)' : 'vec2(0.0)';
	const still = upper ? 'vec2(0.08, 0.045)' : 'vec2(-0.04, 0.07)';
	const bob = upper
		? '(sin(position.x * 1.15 + uTime) + sin(position.z * 1.9 + uTime * 0.7)) * 0.003'
		: '(sin(position.x * 0.85 + uTime * 0.55 + 2.1) + sin(position.z * 1.25 + uTime * 0.4 + 1.3)) * 0.002';
	mat.customProgramCacheKey = () => `wwRiver30:${layer}`;
	mat.onBeforeCompile = (shader) => {
		bindTime(mat, shader);
		shader.vertexShader = `uniform float uTime;
attribute vec2 flow;
attribute float shore;
varying vec2 vFlow;
varying float vShore;
${shader.vertexShader}`;
		shader.vertexShader = shader.vertexShader.replace(
			'#include <uv_vertex>',
			`#include <uv_vertex>
			vFlow = flow;
			vShore = shore;`,
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			`#include <begin_vertex>
			transformed.y += ${bob};`,
		);
		shader.fragmentShader = `uniform float uTime;
varying vec2 vFlow;
varying float vShore;
${FOAM_WEB}
${shader.fragmentShader}`;
		const tint = upper
			? `vec3 water = vec3(0.022, 0.408, 0.762);
			vec3 web = vec3(0.745, 0.931, 0.956);
			float line = foamWeb(wp);
			vec3 toon = mix(water, web, smoothstep(0.28, 0.82, line));
			float rim = smoothstep(0.14, 0.52, vShore);
			toon = mix(toon, web, rim * mix(0.12, 1.0, line));
			float alpha = mix(0.28, 0.94, max(smoothstep(0.22, 0.78, line), rim * 0.4));
			diffuseColor = vec4(toon, alpha);`
			: `vec3 water = vec3(0.022, 0.408, 0.762);
			vec3 deep = vec3(0.010, 0.177, 0.497);
			float line = foamWeb(wp);
			vec3 toon = mix(water, deep, smoothstep(0.28, 0.82, line));
			diffuseColor = vec4(toon, 1.0);`;
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <map_fragment>',
			`vec2 dir = vFlow;
			float moving = step(0.2, length(dir));
			vec2 wp = vMapUv * 1.62 + ${foamOff};
			wp -= dir * (uTime * ${flow.toFixed(3)});
			wp += (1.0 - moving) * uTime * ${still};
			${tint}`,
		);
	};
	track(mat);
	return mat;
}

export function waterBedMat():THREE.MeshStandardMaterial {
	return remember('waterBed', () => new THREE.MeshStandardMaterial({
		color: 0x0a5a8c,
		roughness: 1,
		metalness: 0,
	}));
}

export function natureDepthMat(
	map:THREE.Texture,
	opts:{ wind?:boolean; windAmount?:number; clipWater?:boolean } = {},
):THREE.MeshDepthMaterial {
	const key = `depth:${map.uuid}:${opts.wind ? 1 : 0}:${opts.windAmount ?? ''}:${opts.clipWater ? 1 : 0}:vol`;
	return remember(key, () => makeNatureDepthMat(map, opts));
}

function makeNatureDepthMat(
	map:THREE.Texture,
	opts:{ wind?:boolean; windAmount?:number; clipWater?:boolean },
):THREE.MeshDepthMaterial {
	const mat = new THREE.MeshDepthMaterial({
		map,
		alphaTest: 0.22,
		depthPacking: THREE.RGBADepthPacking,
		side: THREE.DoubleSide,
	});
	const clip = opts.clipWater ? attachGrassClip(mat) : null;
	if (opts.wind || clip) {
		mat.customProgramCacheKey = () => `depthWind:${opts.wind ? 1 : 0}:${opts.clipWater ? 1 : 0}:vol`;
		mat.onBeforeCompile = (shader) => {
			bindTime(mat, shader);
			if (clip) {
				shader.uniforms.uGrassClip = clip.uGrassClip;
				shader.uniforms.uClipOrigin = clip.uClipOrigin;
				shader.uniforms.uClipSize = clip.uClipSize;
				shader.uniforms.uClipMaxY = clip.uClipMaxY;
			}
			shader.vertexShader = `uniform float uTime;\n${clip ? GRASS_CLIP_VERT : ''}${shader.vertexShader}`;
			if (opts.wind) {
				shader.vertexShader = shader.vertexShader.replace(
					'#include <begin_vertex>',
					`#include <begin_vertex>
				${windVertex(opts.windAmount ?? WIND_TREE)}`,
				);
			}
			if (clip) {
				shader.vertexShader = shader.vertexShader.replace(
					'#include <project_vertex>',
					GRASS_CLIP_WORLD,
				);
				shader.fragmentShader = `${GRASS_CLIP_FRAG}${shader.fragmentShader}`;
				shader.fragmentShader = shader.fragmentShader.replace(
					'#include <clipping_planes_fragment>',
				GRASS_CLIP_DISCARD,
			);
			}
		};
		track(mat);
	}
	return mat;
}

export function tickNature(time:number):void {
	for (const mat of windMats) {
		const u = mat.userData.uTime as { value:number } | undefined;
		if (u) {
			u.value = time;
		}
	}
}

function trackTime(mat:THREE.Material, uniform:{ value:number }):void {
	mat.userData.uTime = uniform;
	track(mat);
}

const FALL_NOISE = `float hash11(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise11(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	float a = hash11(i);
	float b = hash11(i + vec2(1.0, 0.0));
	float c = hash11(i + vec2(0.0, 1.0));
	float d = hash11(i + vec2(1.0, 1.0));
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm11(vec2 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < 4; i++) {
		v += a * noise11(p);
		p = p * 2.03 + 11.7;
		a *= 0.5;
	}
	return v;
}`;

export function waterfallSheetMat(opts:{ speed:number; shift:number; mist?:boolean }):THREE.ShaderMaterial {
	const mist = !!opts.mist;
	return remember(`fall:${opts.speed}:${opts.shift}:${mist ? 1 : 0}`, () => makeWaterfallSheetMat(opts.speed, opts.shift, mist));
}

function makeWaterfallSheetMat(speed:number, shift:number, mist:boolean):THREE.ShaderMaterial {
	const mat = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		uniforms: {
			uTime: { value: 0 },
			uSpeed: { value: speed },
			uShift: { value: shift },
			uMist: { value: mist ? 1 : 0 },
		},
		vertexShader: `
			uniform float uTime;
			varying vec2 vUv;
			void main() {
				vUv = uv;
				vec3 p = position;
				float fall = 1.0 - uv.y;
				float n = sin(uv.x * 16.0 + uTime * 3.2 + uv.y * 5.0);
				p.x += n * 0.055 * fall;
				p.z += sin(uv.x * 9.0 + uv.y * 11.0 + uTime * 2.6) * 0.07 * fall;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
			}
		`,
		fragmentShader: `
			uniform float uTime;
			uniform float uSpeed;
			uniform float uShift;
			uniform float uMist;
			varying vec2 vUv;
			${FALL_NOISE}
			void main() {
				vec2 uvA = vec2(vUv.x * 5.5 + uShift, vUv.y * 2.15 + uTime * uSpeed);
				vec2 uvB = vec2(vUv.x * 8.2 - uShift * 1.4, vUv.y * 3.1 + uTime * uSpeed * 1.65);
				float a = fbm11(uvA);
				float b = fbm11(uvB + 4.2);
				float streaks = pow(max(a, b * 0.92), 1.55);
				streaks *= 0.55 + 0.45 * smoothstep(0.15, 0.75, noise11(vec2(vUv.x * 18.0, vUv.y * 3.5 + uTime * uSpeed * 2.4)));
				float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
				edge *= 0.7 + 0.3 * noise11(vec2(vUv.x * 22.0, vUv.y * 5.0 + uTime * 1.1));
				float foam = smoothstep(0.32, 0.0, vUv.y) * (0.35 + 0.65 * b);
				vec3 water = mix(vec3(0.38, 0.68, 0.88), vec3(0.86, 0.95, 1.0), streaks);
				vec3 col = mix(water, vec3(0.96, 0.99, 1.0), foam);
				float alpha = edge * mix(0.22 + streaks * 0.78, 0.9, foam);
				alpha *= smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.02, 0.9, vUv.y);
				if (uMist > 0.5) {
					col = mix(col, vec3(0.92, 0.97, 1.0), 0.45);
					alpha *= 0.45;
				}
				if (alpha < 0.07) {
					discard;
				}
				gl_FragColor = vec4(col, alpha);
			}
		`,
	});
	trackTime(mat, mat.uniforms.uTime);
	return mat;
}

export function waterfallFoamMat():THREE.ShaderMaterial {
	return remember('fallFoam', () => makeWaterfallFoamMat());
}

function makeWaterfallFoamMat():THREE.ShaderMaterial {
	const mat = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		uniforms: { uTime: { value: 0 } },
		vertexShader: `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			uniform float uTime;
			varying vec2 vUv;
			${FALL_NOISE}
			void main() {
				vec2 c = vUv - 0.5;
				float r = length(c) * 2.0;
				float ang = atan(c.y, c.x);
				float n = fbm11(vec2(ang * 1.8, r * 5.0 - uTime * 1.55));
				float ring = smoothstep(1.05, 0.22, r) * smoothstep(0.0, 0.18, r);
				float alpha = ring * (0.18 + 0.7 * n);
				vec3 col = mix(vec3(0.62, 0.84, 0.95), vec3(1.0), n);
				if (alpha < 0.06) {
					discard;
				}
				gl_FragColor = vec4(col, alpha);
			}
		`,
	});
	trackTime(mat, mat.uniforms.uTime);
	return mat;
}

export function waterfallSplashMat():THREE.MeshBasicMaterial {
	return remember('fallSplash', () => makeWaterfallSplashMat());
}

function makeWaterfallSplashMat():THREE.MeshBasicMaterial {
	const mat = new THREE.MeshBasicMaterial({
		color: 0xeef8ff,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		opacity: 0.8,
	});
	mat.onBeforeCompile = (shader) => {
		bindTime(mat, shader);
		shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`;
		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			`#include <common>
			varying float vLife;`,
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			`#include <begin_vertex>
			float phase = fract(sin(instanceMatrix[3].x * 19.19 + instanceMatrix[3].z * 4.73) * 43758.5453);
			float t = fract(uTime * 0.72 + phase);
			vLife = t;
			transformed.y += t * 0.62;
			transformed *= (1.0 - t * 0.82);`,
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			`#include <common>
			varying float vLife;`,
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			`#include <color_fragment>
			diffuseColor.a *= (1.0 - vLife) * smoothstep(0.0, 0.12, vLife);`,
		);
	};
	track(mat);
	return mat;
}
