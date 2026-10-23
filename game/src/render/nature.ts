import * as THREE from 'three';
import { patchShader, ToonMaterial, hash } from '@arc-director/kindling';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TILE_HEIGHT } from '../world/constants';
import type { Wake } from '../world/decodeGlyphChunk';

export type NatureMaps = {
	water:THREE.Texture;
	/** Riverbank sand and pebbles, laid across the bank: dry at the top, wet at the bottom (`bankUV`). */
	sand:THREE.Texture;
	/** Where the sand fades into the lawn, in the same layout: white lawn, black sand. */
	sandLawn:THREE.Texture;
	/** Cliff rock in ledges, mossy at the foot: one picture is {@link CLIFF_TILE} high. */
	cliff:THREE.Texture;
	/** A cliff tile (`models/Cliff.glb`): a rock slope 1 m up and 1 m back, its foot along +Z, its lip at -Z. */
	cliffTile:ModelTile;
	/** Small rocks (`models/Rocks.glb`), biggest across first; they share one picture. */
	rocks:ModelTile[];
	/** Boulders (`models/Boulders.glb`), biggest across first; they share one picture. */
	boulders:ModelTile[];
};

/** A model's mesh, as geometry to instance, the picture painted on it, and its meters across (the wider way on the ground). */
export type ModelTile = { geom:THREE.BufferGeometry; map:THREE.Texture; across:number };

function tileOf(geom:THREE.BufferGeometry, mesh:THREE.Mesh):ModelTile {
	geom.userData.shared = true;
	geom.computeBoundingBox();
	const size = geom.boundingBox!.getSize(new THREE.Vector3());
	const map = (mesh.material as THREE.MeshStandardMaterial).map!;
	map.anisotropy = 4;
	return { geom, map, across: Math.max(size.x, size.z) };
}

/** The first mesh of a GLB, its node's transform applied. */
async function loadTile(url:string):Promise<ModelTile> {
	const gltf = await new GLTFLoader().loadAsync(url);
	let tile:ModelTile | undefined;
	gltf.scene.updateMatrixWorld(true);
	gltf.scene.traverse((node) => {
		const mesh = node as THREE.Mesh;
		if (tile || !mesh.isMesh) {
			return;
		}
		tile = tileOf(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), mesh);
	});
	if (!tile) {
		throw new Error(`${url}: no mesh`);
	}
	return tile;
}

/** One of `pieces`, picked by where it stands, so the same spot always shows the same one. */
export function pieceAt(pieces:ModelTile[], x:number, z:number):ModelTile {
	return pieces[Math.floor(hash(x, z, 61) * pieces.length) % pieces.length]!;
}

/** Every mesh of a sheet of props split by `buildModels` (`split`), in file order, each in its own frame: origin at its foot. */
async function loadPieces(url:string):Promise<ModelTile[]> {
	const gltf = await new GLTFLoader().loadAsync(url);
	const pieces:ModelTile[] = [];
	gltf.scene.traverse((node) => {
		const mesh = node as THREE.Mesh;
		if (mesh.isMesh) {
			pieces.push(tileOf(mesh.geometry, mesh));
		}
	});
	if (pieces.length === 0) {
		throw new Error(`${url}: no mesh`);
	}
	return pieces;
}

/** Meters of cliff one copy of the cliff picture covers, up and (by its shape) across. */
export const CLIFF_TILE = { up: 2.45, across: 2.45 * 576 / 988 };

/**
 * Meters along a bank one copy of the riverbank sand painting covers (`bankUV`). Its height spans the bank, dry top to
 * wet foot, about as wide, so its pebbles come out round, the biggest about 5 cm.
 */
export const SAND_TILE = 0.5;

export const GRASS_Y = 0.012;
/** A river's surface: its current lines, foam and ripples. */
export const WATER_UPPER_Y = GRASS_Y - 0.12;
/** A river's bed: just under its surface, so ripples lie on the water and no bank shows through it. */
export const WATER_LOWER_Y = WATER_UPPER_Y - 0.01;
export const GRASS_UV_REP = 4;
/**
 * A river's surface draws after the see-through things under it, so they still show through, and before a waterfall's
 * mist (2), which veils it.
 */
export const SURFACE_ORDER = 1;

const windMats = new Set<THREE.Material>();
const matCache = new Map<string, THREE.Material>();
let maps:NatureMaps | null = null;
let pending:Promise<NatureMaps> | null = null;

function remember<T extends THREE.Material>(key:string, make:()=>T):T {
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

/**
 * Sway on the shared wind clock, growing with height above the mesh origin.
 * Each instance (or mesh) gets its own phase from where it stands.
 */
export function windSway(mat:THREE.Material, amount:number):void {
	patchShader(mat, `sway:${amount}`, (shader) => {
		bindTime(mat, shader);
		shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
			'#include <begin_vertex>',
			`#include <begin_vertex>
			{
				vec3 root = modelMatrix[3].xyz;
				#ifdef USE_INSTANCING
					root += instanceMatrix[3].xyz;
				#endif
				float phase = uTime * 1.1 + root.x * 0.63 + root.z * 0.41;
				float bend = position.y * position.y * ${amount.toFixed(4)};
				transformed.x += sin(phase) * bend;
				transformed.z += sin(phase * 0.77 + 1.3) * bend * 0.6;
			}`,
		);
	});
	track(mat);
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
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		maps = null;
		pending = null;
		disposeSharedNature();
	});
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
	const at = (ix:number, iy:number):number => hash(((ix % n) + n) % n, ((iy % n) + n) % n);
	return lerp(lerp(at(x0, y0), at(x0 + 1, y0), sx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), sx), sy);
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

function scatterFoam(size:number, cells:number, salt:number):{ x:number; y:number }[] {
	const cell = size / cells;
	const pts:{ x:number; y:number }[] = [];
	for (let gy = 0; gy < cells; gy++) {
		for (let gx = 0; gx < cells; gx++) {
			const hex = (gy % 2) * 0.28;
			pts.push({
				x: (gx + 0.1 + hex + hash(gx + salt, gy) * 0.52) * cell,
				y: (gy + 0.1 + hash(gx, gy + salt + 9) * 0.52) * cell,
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

export function loadNature():Promise<NatureMaps> {
	if (maps) {
		return Promise.resolve(maps);
	}
	if (pending) {
		return pending;
	}
	// Water is painted in code; the riverbank sand and the cliff rock are pictures in public/textures.
	const loader = new THREE.TextureLoader();
	pending = Promise.all([
		loader.loadAsync(`${import.meta.env.BASE_URL}textures/riverbank-sand.jpg`),
		loader.loadAsync(`${import.meta.env.BASE_URL}textures/riverbank-sand-lawn.png`),
		loader.loadAsync(`${import.meta.env.BASE_URL}textures/cliff-rock.jpg`),
		loadTile(`${import.meta.env.BASE_URL}models/Cliff.glb`),
		loadPieces(`${import.meta.env.BASE_URL}models/Rocks.glb`),
		loadPieces(`${import.meta.env.BASE_URL}models/Boulders.glb`),
	]).then(([sand, sandLawn, cliff, cliffTile, rocks, boulders]) => {
		const water = texFromCanvas(paintToonWater(), true);
		water.colorSpace = THREE.NoColorSpace;
		water.generateMipmaps = false;
		water.minFilter = THREE.LinearFilter;
		water.magFilter = THREE.LinearFilter;
		water.needsUpdate = true;
		sand.colorSpace = THREE.SRGBColorSpace;
		// Repeats along the bank; across it runs once, dry to wet.
		sand.wrapS = THREE.RepeatWrapping;
		sand.wrapT = THREE.ClampToEdgeWrapping;
		sand.anisotropy = 4;
		sandLawn.colorSpace = THREE.NoColorSpace;
		sandLawn.wrapS = THREE.RepeatWrapping;
		sandLawn.wrapT = THREE.ClampToEdgeWrapping;
		cliff.colorSpace = THREE.SRGBColorSpace;
		// Mirrored across, so its sides always meet; up, the mossy foot starts each face.
		cliff.wrapS = THREE.MirroredRepeatWrapping;
		cliff.wrapT = THREE.RepeatWrapping;
		cliff.anisotropy = 4;
		maps = { water, sand, sandLawn, cliff, cliffTile, rocks, boulders };
		return maps;
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

const WATER_NOISE = `
float waterHash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float waterNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), f.x),
		mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), f.x),
		f.y
	);
}
`;

export type WaterLayer = 'lower' | 'upper';

/**
 * Two sheets: a bed tinted by depth, and over it thin current lines, a bank edge line, and rings spreading from
 * waterfalls over the water they land in (not the river they pour from).
 */
export function toonWaterMat(map:THREE.Texture, layer:WaterLayer):ToonMaterial {
	return remember(`water:${layer}:52:${map.uuid}`, () => makeToonWaterMat(map, layer));
}

/**
 * The river's blue (`toon`): deep in the middle, lighter toward the banks, with a slow drifting wobble. One crisp
 * step (the earthen bank marks the edge, so no shallow band hugs it).
 */
const WATER_BLUE = `float wob = waterNoise(vec2(q.x * 0.6 - uTime * 0.36 * moving, q.y * 1.4) + 4.0);
			float s = clamp(vShore * 1.6 + (wob - 0.5) * 0.3, 0.0, 1.0);
			// A crisp anime depth band, edged by a thin lighter line.
			float aa = fwidth(s) + 0.01;
			float b1 = smoothstep(0.24 - aa, 0.24 + aa, s);
			vec3 toon = mix(vec3(0.03, 0.19, 0.38), vec3(0.06, 0.34, 0.58), b1);
			float rim = 1.0 - smoothstep(0.0, 0.035, abs(s - 0.24));
			toon = mix(toon, vec3(0.45, 0.75, 0.85), rim * 0.45);
			// Light and shade drifting downstream, in two crisp steps.
			float drift = waterNoise(vec2(q.x * 0.7 - uTime * 0.45 * moving, q.y * 2.4 + 5.0));
			toon *= mix(1.0, 0.88 + 0.24 * step(0.55, drift), moving);`;

/** How much the surface's blue hides what is under it, between its foam. */
const SURFACE_OPACITY = 0.8;

function makeToonWaterMat(map:THREE.Texture, layer:WaterLayer):ToonMaterial {
	const upper = layer === 'upper';
	const mat = new ToonMaterial({
		map,
		color: 0xffffff,
		transparent: upper,
		opacity: 1,
		// Writes depth, as window glass does: the ink pass sees a flat surface and inks nothing through it.
		depthWrite: true,
		side: THREE.DoubleSide,
		shadowSide: THREE.FrontSide,
		outline: false,
		// The bed is hidden for now.
		visible: upper,
	});
	const bob = upper
		? '(sin(position.x * 1.15 + uTime) + sin(position.z * 1.9 + uTime * 0.7)) * 0.003'
		: '(sin(position.x * 0.85 + uTime * 0.55 + 2.1) + sin(position.z * 1.25 + uTime * 0.4 + 1.3)) * 0.002';
	patchShader(mat, `wwRiver54:${layer}`, (shader) => {
		bindTime(mat, shader);
		shader.uniforms.uFalls = fallLandings;
		shader.uniforms.uRocks = rockSpots;
		shader.uniforms.uRockWays = rockWays;
		shader.vertexShader = `uniform float uTime;
attribute vec2 flow;
attribute float shore;
varying vec2 vFlow;
varying float vShore;
varying float vWaterY;
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
			transformed.y += ${bob};
			vWaterY = (modelMatrix * vec4(transformed, 1.0)).y;`,
		);
		shader.fragmentShader = `uniform float uTime;
uniform vec4 uFalls[${FALLS}];
uniform vec4 uRocks[${ROCKS}];
uniform vec3 uRockWays[${ROCKS}];
varying vec2 vFlow;
varying float vShore;
varying float vWaterY;
${WATER_NOISE}
${shader.fragmentShader}`;
		const tint = upper
			// Over the bed: thin current lines riding downstream, big rings spreading from where waterfalls land,
			// and small ones trailing off rocks. Nothing else rings, clumps or glitters.
			? `// Current lines across the whole width: thin ridges of noise stretched along the flow, sliding downstream.
			float lane = waterNoise(vec2(q.x * 0.35 - uTime * 0.495 * moving, q.y * 5.0 + 1.7));
			float lanes = moving * (1.0 - smoothstep(0.0, 0.05, abs(lane - 0.5)))
				* smoothstep(0.35, 0.65, waterNoise(vec2(q.x * 0.6 - uTime * 0.495 * moving, q.y * 1.3 + 8.0)));
			// Faint dashes trailing downstream just off the bank.
			float trail = smoothstep(0.22, 0.3, vShore) * (1.0 - smoothstep(0.34, 0.4, vShore))
				* smoothstep(0.6, 0.66, waterNoise(vec2(q.x * 1.6 - uTime * 0.54 * moving, q.y * 9.0)));
			// Waterfall rings: wide, slowly spreading, wobbling a little, fading with distance. On the river a fall pours
			// from (up on the cliff, a level or more above where it lands) there are none: it whitens toward the lip instead.
			float fallRing = 0.0;
			for (int i = 0; i < ${FALLS}; i++) {
				if (uTime - uFalls[i].w > 0.5) {
					continue;
				}
				float above = step(${(TILE_HEIGHT / 2).toFixed(3)}, abs(vWaterY - uFalls[i].y));
				vec2 off = wp - uFalls[i].xz;
				float d = length(off) + 0.12 * sin(atan(off.y, off.x) * 5.0 + uTime * 0.9);
				// Foam where it lands, its edge churning, turning into rings: thick bands that thin as they
				// spread and are gone by about 6 m. A ring is where the phase is near a whole number.
				float churn = waterNoise(vec2(atan(off.y, off.x) * 2.0, uTime * 0.8)) * 0.35;
				float foamPool = 1.0 - smoothstep(0.75, 0.95, d - churn);
				// Up on the cliff: one long fade up the river, white at the lip (half a meter upstream of the landing).
				float upstream = -dot(off, down);
				float whiten = (1.0 - smoothstep(0.5, 3.5, upstream)) * step(0.0, upstream);
				foamPool = mix(foamPool, whiten, above);
				float ringHalf = mix(0.3, 0.485, smoothstep(0.9, 4.0, d));
				float band = abs(fract(d * 0.45 - uTime * 0.3) - 0.5);
				float line = smoothstep(ringHalf, ringHalf + 0.015, band);
				fallRing = max(fallRing, max(foamPool, (1.0 - above) * line * smoothstep(0.7, 1.1, d) * (1.0 - smoothstep(2.5, 6.0, d))));
			}
			// Rock ripples: the waterfall's rings made small, a foam collar where the rock breaks the surface and rings
			// spreading from it, trailing off downstream with the current only. In still water they trail the
			// rock's own way (all round if it has none).
			float rockRing = 0.0;
			for (int i = 0; i < ${ROCKS}; i++) {
				if (uTime - uRocks[i].w > 0.5) {
					continue;
				}
				vec2 off = wp - uRocks[i].xy;
				// Which way and how far the ripples trail: the rock's own wake if it has one, else as far as the current
				// draws them (1), else nowhere: round (any way will do, unstretched), and reaching about half as far.
				float own = length(uRockWays[i].xy);
				float wake = step(0.01, own);
				float reach = mix(moving, own, wake);
				float flowing = step(0.01, reach);
				vec2 way = wake > 0.5 ? uRockWays[i].xy / own : moving > 0.5 ? down : vec2(1.0, 0.0);
				float along = dot(off, way);
				// A narrow wake: drawn far out downstream, barely past the rock's sides (wider by its spread).
				float stretch = 1.0 + reach;
				float squeeze = mix(1.0, 1.6 / uRockWays[i].z, flowing);
				float d = (length(vec2(along / stretch, dot(off, vec2(-way.y, way.x)) * squeeze)) - uRocks[i].z) * mix(1.79, 1.0, flowing);
				// The collar hugs the rock all round; only the rings trail off downstream.
				float collar = 1.0 - smoothstep(0.03, 0.07, length(off) - uRocks[i].z);
				float band = abs(fract(d * 4.0 - uTime * 0.7) - 0.5);
				float rings = smoothstep(0.4, 0.415, band) * smoothstep(0.06, 0.12, d) * (1.0 - smoothstep(0.25, 0.6, d))
					* mix(1.0, smoothstep(0.0, 0.3, along), flowing);
				rockRing = max(rockRing, max(collar, rings));
			}
			float alpha = clamp(max(max(lanes * 0.5, trail * 0.35), max(fallRing * 0.85, rockRing * 0.8)), 0.0, 1.0);
			// The foam over the river's blue, see-through.
			${WATER_BLUE}
			diffuseColor = vec4(mix(toon, vec3(0.86, 0.96, 1.0), alpha), max(alpha, ${SURFACE_OPACITY.toFixed(2)}));`
			// The bed: the river's blue.
			: `${WATER_BLUE}
			diffuseColor = vec4(toon, 1.0);`;
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <map_fragment>',
			`float moving = step(0.2, length(vFlow));
			// Along (x) and across (y) the current; patterns move downstream as uTime grows.
			vec2 down = moving > 0.5 ? normalize(vFlow) : vec2(1.0, 0.0);
			vec2 wp = vMapUv;
			vec2 q = vec2(dot(wp, down), dot(wp, vec2(-down.y, down.x)));
			${tint}`,
		);
	});
	track(mat);
	return mat;
}

export function waterBedMat():ToonMaterial {
	return remember('waterBed', () => new ToonMaterial({ color: 0x0a5a8c }));
}

/** Most waterfalls whose rings the river draws at once. */
const FALLS = 4;
/** Each slot: where the fall lands (x, y, z) and the wind-clock time it was last marked (stale slots go dark). */
const fallLandings = { value: Array.from({ length: FALLS }, () => new THREE.Vector4(0, 0, 0, -1e9)) };
let natureTime = 0;
let nextFallSlot = 0;

/** A slot for one waterfall's landing point. */
export function claimFallSlot():number {
	return nextFallSlot++ % FALLS;
}

/** Where a waterfall lands this frame, in world space. The water at that height draws its rings from here until marks stop. */
export function markFallLanding(slot:number, at:THREE.Vector3):void {
	fallLandings.value[slot]?.set(at.x, at.y, at.z, natureTime);
}

/** Most rocks standing in water whose ripples the river draws at once. */
const ROCKS = 8;
/** Each slot: where a rock stands in the water (x, z), its radius at the waterline, and the wind-clock time it was last marked. */
const rockSpots = { value: Array.from({ length: ROCKS }, () => new THREE.Vector4(0, 0, 0, -1e9)) };
/** Each slot: the way a rock's ripples trail (world XZ, as far as it is long; zero for the current's, or all round in still water), and how wide they spread (1 as the current draws them). */
const rockWays = { value: Array.from({ length: ROCKS }, () => new THREE.Vector3(0, 0, 1)) };
let nextRockSlot = 0;

/** A slot for one rock standing in water. */
export function claimRockSlot():number {
	return nextRockSlot++ % ROCKS;
}

/**
 * Where a rock stands in the water this frame, in world XZ, its radius at the waterline, and its `wake` (see
 * `EntityLegend.wake`): the river ripples round it until marks stop.
 */
export function markRock(slot:number, x:number, z:number, radius:number, wake:Wake):void {
	rockSpots.value[slot]?.set(x, z, radius, natureTime);
	rockWays.value[slot]?.set(wake.x, wake.z, wake.spread ?? 1);
}

export function tickNature(time:number):void {
	natureTime = time;
	for (const mat of windMats) {
		const u = mat.userData.uTime as { value:number } | undefined;
		if (u) {
			u.value = time;
		}
	}
}

/**
 * Falling water: blue with light streaks and white foam ribbons racing down, a white lip where it
 * spills over and white churn at the foot. Torn sides ripple. `uv.y` runs 1 (lip) to 0 (pool).
 */
export function fallSheetMat():ToonMaterial {
	return remember('fallSheet', () => {
		const mat = new ToonMaterial({ side: THREE.DoubleSide, outline: false });
		mat.defines = { ...mat.defines, USE_UV: '' };
		patchShader(mat, 'fallSheet', (shader) => {
			bindTime(mat, shader);
			shader.fragmentShader = `uniform float uTime;\n${WATER_NOISE}\n${shader.fragmentShader}`.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
				{
					float down = vUv.y;
					float torn = min(vUv.x, 1.0 - vUv.x);
					if (torn < 0.03 + 0.06 * waterNoise(vec2(vUv.y * 7.0 + uTime * 2.0, vUv.x * 4.0))) {
						discard;
					}
					float body = waterNoise(vec2(vUv.x * 9.0, vUv.y * 2.2 + uTime * 1.7));
					float ribbon = waterNoise(vec2(vUv.x * 21.0 + 3.0, vUv.y * 3.5 + uTime * 2.6));
					vec3 c = mix(vec3(0.14, 0.46, 0.72), vec3(0.5, 0.8, 0.94), smoothstep(0.38, 0.62, body));
					c = mix(c, vec3(0.94, 0.98, 1.0), smoothstep(0.7, 0.76, ribbon));
					float lip = smoothstep(0.88, 0.95, down);
					float churn = (1.0 - smoothstep(0.0, 0.16, down)) * smoothstep(0.35, 0.6, waterNoise(vec2(vUv.x * 12.0, uTime * 3.0)));
					diffuseColor.rgb = mix(c, vec3(0.95, 0.99, 1.0), clamp(lip + churn, 0.0, 1.0));
				}`,
			);
		});
		track(mat);
		return mat;
	});
}

/** Chunky inked foam puffs that churn at the foot of a fall: each instance swells and bobs on its own beat. */
export function fallFoamMat():ToonMaterial {
	return remember('fallFoam', () => {
		const mat = new ToonMaterial({ color: 0xf2f8ff, rim: 0.3, bands: [0.7, 0.88, 1] });
		patchShader(mat, 'fallFoam', (shader) => {
			bindTime(mat, shader);
			shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				{
					float phase = 0.0;
					#ifdef USE_INSTANCING
						phase = instanceMatrix[3].x * 7.0 + instanceMatrix[3].z * 5.0;
					#endif
					transformed *= 1.0 + 0.2 * sin(uTime * 5.5 + phase);
					transformed.y += 0.04 * sin(uTime * 4.0 + phase * 1.3);
				}`,
			);
		});
		track(mat);
		return mat;
	});
}

/**
 * Spray mist at the foot of a fall: soft, unlined puffs that drift up and out from the wall, swell and fade, each instance on
 * its own beat. Draw with depthWrite off; the shapes are plain spheres.
 */
export function fallMistMat():ToonMaterial {
	return remember('fallMist', () => {
		const mat = new ToonMaterial({ color: 0xf4fbff, transparent: true, depthWrite: false, outline: false, bands: [0.85, 1] });
		patchShader(mat, 'fallMist2', (shader) => {
			bindTime(mat, shader);
			shader.vertexShader = `uniform float uTime;\nvarying float vMistFade;\n${shader.vertexShader}`.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				{
					float phase = 0.0;
					#ifdef USE_INSTANCING
						phase = fract(instanceMatrix[3].x * 3.7 + instanceMatrix[3].z * 5.3);
					#endif
					float life = fract(uTime * 0.2 + phase);
					// Up and out along its own heading, slowing as it goes, growing to about three times its size.
					float a = (phase - 0.5) * 2.4;
					float rise = sqrt(life);
					transformed *= 0.5 + life * 1.5;
					transformed.x += sin(a) * rise * 1.3;
					transformed.z += (0.35 + 0.3 * cos(a)) * rise * 1.1;
					transformed.y += rise * 0.9;
					vMistFade = smoothstep(0.0, 0.2, life) * (1.0 - smoothstep(0.45, 1.0, life));
				}`,
			);
			shader.fragmentShader = `varying float vMistFade;\n${shader.fragmentShader}`.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
				diffuseColor.a *= 0.42 * vMistFade;`,
			);
		});
		track(mat);
		return mat;
	});
}
