import * as THREE from 'three';
import {
	CHEST_BACK,
	CHEST_BOTTOM,
	CHEST_FRONT,
	CHEST_KEY_RGB,
	CHEST_LEFT,
	CHEST_LID,
	CHEST_LID_END_L,
	CHEST_LID_END_R,
	CHEST_RIGHT,
	FLAME,
	ITEM_BOMB,
	ITEM_GLOVE,
	ITEM_KEY,
	ITEM_POTION,
	ITEM_SWORD,
	ITEM_TORCH,
	KEY_RGB,
	TORCH_STICK,
	type PxRect,
} from './atlas';

export type ChestFaces = {
	front:THREE.CanvasTexture;
	back:THREE.CanvasTexture;
	left:THREE.CanvasTexture;
	right:THREE.CanvasTexture;
	lid:THREE.CanvasTexture;
	lidEndL:THREE.CanvasTexture;
	lidEndR:THREE.CanvasTexture;
	bottom:THREE.CanvasTexture;
};

export type SpriteMaps = {
	map:THREE.CanvasTexture;
	nrm:THREE.CanvasTexture;
	met:THREE.CanvasTexture;
};

export type SheetTextures = {
	torchStick:THREE.CanvasTexture;
	torchStickN:THREE.CanvasTexture;
	torchStickM:THREE.CanvasTexture;
	flame:THREE.CanvasTexture[];
	chest:ChestFaces;
	chestN:ChestFaces;
	chestM:ChestFaces;
	items:Record<string, SpriteMaps>;
};

let textures:SheetTextures | null = null;
let pending:Promise<SheetTextures> | null = null;
const owned:THREE.Texture[] = [];
const mats:THREE.Material[] = [];
const matByKey = new Map<string, THREE.Material>();

export function pixelArt(canvas:HTMLCanvasElement, wrap:THREE.Wrapping = THREE.ClampToEdgeWrapping):THREE.CanvasTexture {
	const tex = new THREE.CanvasTexture(canvas);
	tex.magFilter = THREE.NearestFilter;
	tex.minFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = wrap;
	tex.wrapT = wrap;
	tex.needsUpdate = true;
	owned.push(tex);
	return tex;
}

export function pixelArtData(canvas:HTMLCanvasElement, wrap:THREE.Wrapping = THREE.ClampToEdgeWrapping):THREE.CanvasTexture {
	const tex = new THREE.CanvasTexture(canvas);
	tex.magFilter = THREE.NearestFilter;
	tex.minFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;
	tex.colorSpace = THREE.NoColorSpace;
	tex.wrapS = wrap;
	tex.wrapT = wrap;
	tex.needsUpdate = true;
	owned.push(tex);
	return tex;
}

function copyAlpha(from:HTMLCanvasElement, to:HTMLCanvasElement):void {
	if (from.width !== to.width || from.height !== to.height) {
		return;
	}
	const srcCtx = from.getContext('2d', { willReadFrequently: true });
	const dstCtx = to.getContext('2d', { willReadFrequently: true });
	if (!srcCtx || !dstCtx) {
		return;
	}
	const src = srcCtx.getImageData(0, 0, from.width, from.height);
	const dst = dstCtx.getImageData(0, 0, to.width, to.height);
	const s = src.data;
	const d = dst.data;
	for (let i = 3; i < s.length; i += 4) {
		d[i] = s[i];
	}
	dstCtx.putImageData(dst, 0, 0);
}

function cropNormal(
	img:HTMLImageElement,
	rect:PxRect,
	alpha:HTMLCanvasElement | null,
	wrap:THREE.Wrapping = THREE.ClampToEdgeWrapping,
):THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = rect.w;
	canvas.height = rect.h;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		throw new Error('2d context');
	}
	ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
	if (alpha) {
		copyAlpha(alpha, canvas);
	}
	return pixelArtData(canvas, wrap);
}

function keyDist(px:Uint8ClampedArray, i:number, key:readonly [number, number, number]):number {
	return Math.abs(px[i] - key[0]) + Math.abs(px[i + 1] - key[1]) + Math.abs(px[i + 2] - key[2]);
}

/** Key only pixels connected to the crop border so interior maroon shading stays opaque. */
function floodKeyMask(px:Uint8ClampedArray, w:number, h:number, key:readonly [number, number, number], hard:number):Uint8Array {
	const n = w * h;
	const bg = new Uint8Array(n);
	const qx = new Int32Array(n);
	const qy = new Int32Array(n);
	let qt = 0;
	const push = (x:number, y:number):void => {
		if (x < 0 || y < 0 || x >= w || y >= h) {
			return;
		}
		const id = y * w + x;
		if (bg[id]) {
			return;
		}
		if (keyDist(px, id * 4, key) >= hard) {
			return;
		}
		bg[id] = 1;
		qx[qt] = x;
		qy[qt] = y;
		qt += 1;
	};
	for (let x = 0; x < w; x++) {
		push(x, 0);
		push(x, h - 1);
	}
	for (let y = 0; y < h; y++) {
		push(0, y);
		push(w - 1, y);
	}
	let qh = 0;
	while (qh < qt) {
		const x = qx[qh];
		const y = qy[qh];
		qh += 1;
		push(x + 1, y);
		push(x - 1, y);
		push(x, y + 1);
		push(x, y - 1);
	}
	return bg;
}

function crop(
	img:HTMLImageElement,
	rect:PxRect,
	mode:'sprite' | 'flame' | 'opaque',
	key:readonly [number, number, number] = KEY_RGB,
	despill = true,
	floodBg = false,
):HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = rect.w;
	canvas.height = rect.h;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		throw new Error('2d context');
	}
	ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
	if (mode === 'opaque') {
		return canvas;
	}
	const data = ctx.getImageData(0, 0, rect.w, rect.h);
	const px = data.data;
	const w = rect.w;
	const h = rect.h;
	const hard = floodBg ? 20 : 48;
	const soft = floodBg ? 40 : 96;
	const bg = floodBg ? floodKeyMask(px, w, h, key, hard) : null;
	for (let i = 0; i < px.length; i += 4) {
		const r = px[i];
		const g = px[i + 1];
		const b = px[i + 2];
		const dist = keyDist(px, i, key);
		let a = 255;
		if (bg) {
			const id = i >> 2;
			if (bg[id]) {
				a = 0;
			}
			else if (dist < soft) {
				const x = id % w;
				const y = (id / w) | 0;
				const edge =
					(x > 0 && bg[id - 1]) ||
					(x + 1 < w && bg[id + 1]) ||
					(y > 0 && bg[id - w]) ||
					(y + 1 < h && bg[id + w]);
				if (edge) {
					a = Math.round(255 * (dist - hard) / (soft - hard));
					if (a < 0) {
						a = 0;
					}
					else if (a > 255) {
						a = 255;
					}
				}
			}
		}
		else if (dist < hard) {
			a = 0;
		}
		else if (dist < soft) {
			a = Math.round(255 * (dist - hard) / (soft - hard));
		}
		if (mode === 'flame' && a > 0) {
			const max = Math.max(r, g, b);
			const min = Math.min(r, g, b);
			const sat = max === 0 ? 0 : (max - min) / max;
			const hot = max > 210 && g > 155;
			const flame = max > 165 && sat > 0.42 && r >= g && r > 110 && (r - b) > 45;
			if (!hot && !flame) {
				a = 0;
			}
		}
		if (despill && a > 0 && dist < 140) {
			const mag = (r - g) + (b - g) * 0.35;
			if (mag > 8) {
				px[i] = Math.max(g, r - mag);
				px[i + 2] = Math.min(b, g + 18);
			}
		}
		px[i + 3] = a;
	}
	ctx.putImageData(data, 0, 0);
	return canvas;
}

function medianField(src:Float32Array, w:number, h:number, radius:number):Float32Array {
	const out = new Float32Array(src.length);
	const win = new Float32Array((2 * radius + 1) ** 2);
	const mid = win.length >> 1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let n = 0;
			for (let oy = -radius; oy <= radius; oy++) {
				for (let ox = -radius; ox <= radius; ox++) {
					const xx = Math.min(w - 1, Math.max(0, x + ox));
					const yy = Math.min(h - 1, Math.max(0, y + oy));
					win[n++] = src[yy * w + xx];
				}
			}
			win.sort((a, b) => a - b);
			out[y * w + x] = win[mid];
		}
	}
	return out;
}

function morph(src:Float32Array, w:number, h:number, radius:number, dilate:boolean):Float32Array {
	const out = new Float32Array(src.length);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let v = dilate ? 0 : 1;
			for (let oy = -radius; oy <= radius; oy++) {
				for (let ox = -radius; ox <= radius; ox++) {
					const xx = Math.min(w - 1, Math.max(0, x + ox));
					const yy = Math.min(h - 1, Math.max(0, y + oy));
					const s = src[yy * w + xx];
					v = dilate ? Math.max(v, s) : Math.min(v, s);
				}
			}
			out[y * w + x] = v;
		}
	}
	return out;
}

function keepLongRuns(src:Float32Array, w:number, h:number, minRun:number):Float32Array {
	const keep = new Float32Array(src.length);
	for (let y = 0; y < h; y++) {
		let x = 0;
		while (x < w) {
			if (src[y * w + x] === 0) {
				x++;
				continue;
			}
			const x0 = x;
			while (x < w && src[y * w + x] !== 0) {
				x++;
			}
			if (x - x0 >= minRun) {
				keep.fill(1, y * w + x0, y * w + x);
			}
		}
	}
	for (let x = 0; x < w; x++) {
		let y = 0;
		while (y < h) {
			if (src[y * w + x] === 0) {
				y++;
				continue;
			}
			const y0 = y;
			while (y < h && src[y * w + x] !== 0) {
				y++;
			}
			if (y - y0 >= minRun) {
				for (let yy = y0; yy < y; yy++) {
					keep[yy * w + x] = 1;
				}
			}
		}
	}
	return keep;
}

function chestOpaque(img:HTMLImageElement, rect:PxRect):THREE.CanvasTexture {
	return pixelArt(crop(img, rect, 'opaque'));
}

function chestKeyed(img:HTMLImageElement, rect:PxRect):THREE.CanvasTexture {
	return pixelArt(crop(img, rect, 'sprite', CHEST_KEY_RGB, false));
}

function chestNormal(
	nrm:HTMLImageElement,
	rect:PxRect,
	albedo:HTMLImageElement,
	keyed:boolean,
):THREE.CanvasTexture {
	const alpha = keyed
		? crop(albedo, rect, 'sprite', CHEST_KEY_RGB, false)
		: crop(albedo, rect, 'opaque');
	return cropNormal(nrm, rect, alpha, THREE.ClampToEdgeWrapping);
}

function build(
	main:HTMLImageElement,
	chests:HTMLImageElement,
	mainN:HTMLImageElement,
	chestsN:HTMLImageElement,
	mainM:HTMLImageElement,
	chestsM:HTMLImageElement,
):SheetTextures {
	const torchStickA = crop(main, TORCH_STICK, 'sprite');
	const mainAtlas = (img:HTMLImageElement, r:PxRect, a:HTMLCanvasElement | null, w:THREE.Wrapping = THREE.ClampToEdgeWrapping) =>
		cropNormal(img, r, a, w);
	const itemMaps = (r:PxRect):SpriteMaps => {
		const a = crop(main, r, 'sprite');
		return {
			map: pixelArt(a),
			nrm: mainAtlas(mainN, r, a),
			met: mainAtlas(mainM, r, a),
		};
	};
	return {
		torchStick: pixelArt(torchStickA),
		torchStickN: mainAtlas(mainN, TORCH_STICK, torchStickA),
		torchStickM: mainAtlas(mainM, TORCH_STICK, torchStickA),
		flame: FLAME.map((r) => pixelArt(crop(main, r, 'flame', KEY_RGB, true, true))),
		chest: {
			front: chestOpaque(chests, CHEST_FRONT),
			back: chestOpaque(chests, CHEST_BACK),
			left: chestOpaque(chests, CHEST_LEFT),
			right: chestOpaque(chests, CHEST_RIGHT),
			lid: chestOpaque(chests, CHEST_LID),
			lidEndL: chestKeyed(chests, CHEST_LID_END_L),
			lidEndR: chestKeyed(chests, CHEST_LID_END_R),
			bottom: chestOpaque(chests, CHEST_BOTTOM),
		},
		chestN: {
			front: chestNormal(chestsN, CHEST_FRONT, chests, false),
			back: chestNormal(chestsN, CHEST_BACK, chests, false),
			left: chestNormal(chestsN, CHEST_LEFT, chests, false),
			right: chestNormal(chestsN, CHEST_RIGHT, chests, false),
			lid: chestNormal(chestsN, CHEST_LID, chests, false),
			lidEndL: chestNormal(chestsN, CHEST_LID_END_L, chests, true),
			lidEndR: chestNormal(chestsN, CHEST_LID_END_R, chests, true),
			bottom: chestNormal(chestsN, CHEST_BOTTOM, chests, false),
		},
		chestM: {
			front: chestNormal(chestsM, CHEST_FRONT, chests, false),
			back: chestNormal(chestsM, CHEST_BACK, chests, false),
			left: chestNormal(chestsM, CHEST_LEFT, chests, false),
			right: chestNormal(chestsM, CHEST_RIGHT, chests, false),
			lid: chestNormal(chestsM, CHEST_LID, chests, false),
			lidEndL: chestNormal(chestsM, CHEST_LID_END_L, chests, true),
			lidEndR: chestNormal(chestsM, CHEST_LID_END_R, chests, true),
			bottom: chestNormal(chestsM, CHEST_BOTTOM, chests, false),
		},
		items: {
			'item_key': itemMaps(ITEM_KEY),
			'item_bomb': itemMaps(ITEM_BOMB),
			'item_sword': itemMaps(ITEM_SWORD),
			'item_torch': itemMaps(ITEM_TORCH),
			'item_potion': itemMaps(ITEM_POTION),
			'item_glove': itemMaps(ITEM_GLOVE),
			'item_pack': {
				map: chestOpaque(chests, CHEST_BACK),
				nrm: chestNormal(chestsN, CHEST_BACK, chests, false),
				met: chestNormal(chestsM, CHEST_BACK, chests, false),
			},
			'item_shield': {
				map: chestOpaque(chests, CHEST_LEFT),
				nrm: chestNormal(chestsN, CHEST_LEFT, chests, false),
				met: chestNormal(chestsM, CHEST_LEFT, chests, false),
			},
		},
	};
}

export function loadImage(src:string):Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`failed to load ${src}`));
		img.src = src;
	});
}

export function sheetReady():boolean {
	return textures !== null;
}

export function loadSpritesheet():Promise<SheetTextures> {
	if (textures) {
		return Promise.resolve(textures);
	}
	if (pending) {
		return pending;
	}
	const base = import.meta.env.BASE_URL;
	pending = Promise.all([
		loadImage(`${base}sprites.jpg`),
		loadImage(`${base}chest.jpg`),
		loadImage(`${base}sprites_normal.png`),
		loadImage(`${base}chest_normal.png`),
		loadImage(`${base}sprites_metallic.jpg`),
		loadImage(`${base}chest_metallic.jpg`),
	]).then(([main, chests, mainN, chestsN, mainM, chestsM]) => {
		textures = build(main, chests, mainN, chestsN, mainM, chestsM);
		return textures;
	}).catch((err:unknown) => {
		pending = null;
		throw err;
	});
	return pending;
}

export function getSheet():SheetTextures {
	if (!textures) {
		throw new Error('spritesheet not loaded');
	}
	return textures;
}

export function spriteMaterial(
	map:THREE.Texture,
	normalMap?:THREE.Texture,
	metalnessMap?:THREE.Texture,
	opts:{ alphaTest?:number } = {},
):THREE.MeshLambertMaterial {
	const cel = map.userData.cel === true;
	const alphaTest = opts.alphaTest ?? (cel ? 0.12 : 0.28);
	const mat = new THREE.MeshLambertMaterial({
		map,
		normalMap: normalMap ?? null,
		// alphaTest already discards holes. transparent+black RGB fringe
		// blends a dark card around cel take/walk pads.
		transparent: false,
		alphaTest,
		normalScale: new THREE.Vector2(cel ? 0.55 : 0.85, cel ? 0.55 : 0.85),
		side: cel ? THREE.FrontSide : THREE.DoubleSide,
		depthWrite: true,
		toneMapped: true,
	});
	mat.customProgramCacheKey = () => cel ? 'spriteSkipCaster5Cel' : 'spriteSkipCaster5';
	// Pull the shadow sample past the body cylinder so it still shades the
	// floor and other sprites, not this billboard. Do not shrink the caster.
	mat.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader.replace(
			'#include <shadowmap_vertex>',
			`#include <shadowmap_vertex>
#if defined( USE_SHADOWMAP ) && ( NUM_POINT_LIGHT_SHADOWS > 0 )
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		vec3 toFrag = vPointShadowCoord[ i ].xyz;
		float dist = length( toFrag );
		vPointShadowCoord[ i ].xyz = toFrag * ( max( dist - 0.9, 0.04 ) / max( dist, 1e-4 ) );
	}
#endif
#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		vDirectionalShadowCoord[ i ].z -= 0.02 * vDirectionalShadowCoord[ i ].w;
	}
#endif`,
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
			`vec3 spriteL = directLight.direction;
	spriteL.z = mix( spriteL.z, 0.0, 0.2 );
	float dotNL = saturate( dot( geometryNormal, normalize( spriteL ) ) );`,
		);
	};
	void metalnessMap;
	mats.push(mat);
	return mat;
}

export function flameMaterial(map:THREE.Texture):THREE.MeshBasicMaterial {
	const mat = new THREE.MeshBasicMaterial({
		map,
		transparent: true,
		alphaTest: 0.2,
		depthWrite: false,
		side: THREE.DoubleSide,
		toneMapped: false,
	});
	mats.push(mat);
	return mat;
}

export function unlitSpriteMaterial(map:THREE.Texture):THREE.MeshBasicMaterial {
	const mat = new THREE.MeshBasicMaterial({
		map,
		transparent: true,
		alphaTest: 0.28,
		side: THREE.DoubleSide,
		depthWrite: true,
		toneMapped: false,
	});
	mats.push(mat);
	return mat;
}

export function chestMaterial(
	map:THREE.Texture,
	opts:{ alpha?:boolean; normalMap?:THREE.Texture; metalnessMap?:THREE.Texture } = {},
):THREE.MeshStandardMaterial {
	const mat = new THREE.MeshStandardMaterial({
		map,
		normalMap: opts.normalMap ?? null,
		metalnessMap: opts.metalnessMap ?? null,
		roughness: 0.82,
		metalness: opts.metalnessMap ? 1 : 0.04,
		shadowSide: THREE.FrontSide,
		transparent: opts.alpha === true,
		alphaTest: opts.alpha === true ? 0.22 : 0,
		side: opts.alpha === true ? THREE.DoubleSide : THREE.FrontSide,
	});
	mats.push(mat);
	return mat;
}

export function disposeSpritesheet():void {
	for (const t of owned) {
		t.dispose();
	}
	owned.length = 0;
	for (const m of mats) {
		m.dispose();
	}
	mats.length = 0;
	matByKey.clear();
	textures = null;
	pending = null;
}
