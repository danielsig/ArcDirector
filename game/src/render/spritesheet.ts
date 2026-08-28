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
	FWD_KEY_RGB,
	FWD_SHEET_H,
	FWD_SHEET_W,
	IDLE_FRONT,
	IDLE_FWD,
	IDLE_SIDE,
	ITEM_BOMB,
	ITEM_GLOVE,
	ITEM_KEY,
	ITEM_POTION,
	ITEM_SWORD,
	ITEM_TORCH,
	KEY_RGB,
	SHEET_H,
	SHEET_W,
	TORCH_STICK,
	WALK,
	WALK_BACK,
	WALK_FWD,
	type PxRect,
} from './atlas';
import {
	FLOOR_STAMPS,
	ROCKS_H,
	ROCKS_W,
	WALL_ROW_COUNT,
	WALL_STAMPS,
	type RockStamp,
} from './rocksAtlas';
import { rasterizeImage, warpQuad, type AtlasPixels } from './unproject';
import { disposeNpcAnims } from './humanAnims';
import { disposeSwordAnims } from './swordAnims';

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
	walk:THREE.CanvasTexture[];
	walkN:THREE.CanvasTexture[];
	walkM:THREE.CanvasTexture[];
	walkFwd:THREE.CanvasTexture[];
	walkFwdN:THREE.CanvasTexture[];
	walkFwdM:THREE.CanvasTexture[];
	idleFront:THREE.CanvasTexture;
	idleFrontN:THREE.CanvasTexture;
	idleFrontM:THREE.CanvasTexture;
	idleFwd:THREE.CanvasTexture;
	idleFwdN:THREE.CanvasTexture;
	idleFwdM:THREE.CanvasTexture;
	idleSide:THREE.CanvasTexture;
	idleSideN:THREE.CanvasTexture;
	idleSideM:THREE.CanvasTexture;
	walkBack:THREE.CanvasTexture;
	walkBackN:THREE.CanvasTexture;
	walkBackM:THREE.CanvasTexture;
	torchStick:THREE.CanvasTexture;
	torchStickN:THREE.CanvasTexture;
	torchStickM:THREE.CanvasTexture;
	flame:THREE.CanvasTexture[];
	floorTiles:SpriteMaps[];
	wallTiles:SpriteMaps[];
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

function rockTex(
	canvas:HTMLCanvasElement,
	opts:{ normal?:boolean; wrap?:THREE.Wrapping },
):THREE.CanvasTexture {
	const tex = new THREE.CanvasTexture(canvas);
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = opts.normal ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
	tex.generateMipmaps = !opts.normal;
	tex.anisotropy = opts.normal ? 1 : 4;
	tex.colorSpace = opts.normal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
	tex.wrapS = opts.wrap ?? THREE.ClampToEdgeWrapping;
	tex.wrapT = opts.wrap ?? THREE.ClampToEdgeWrapping;
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

/** Character normals: linear so a hat reads as a dome, not 102 sparkles. */
export function smoothNormalTex(canvas:HTMLCanvasElement, wrap:THREE.Wrapping = THREE.ClampToEdgeWrapping):THREE.CanvasTexture {
	const tex = new THREE.CanvasTexture(canvas);
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearFilter;
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
	atlasW?:number,
	atlasH?:number,
):THREE.CanvasTexture {
	const aw = atlasW ?? img.naturalWidth;
	const ah = atlasH ?? img.naturalHeight;
	const sx = img.naturalWidth / aw;
	const sy = img.naturalHeight / ah;
	const canvas = document.createElement('canvas');
	canvas.width = rect.w;
	canvas.height = rect.h;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		throw new Error('2d context');
	}
	ctx.drawImage(
		img,
		rect.x * sx,
		rect.y * sy,
		rect.w * sx,
		rect.h * sy,
		0,
		0,
		rect.w,
		rect.h,
	);
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

const ROCK_KEY = [110, 19, 54] as const;

function isRockKey(px:Uint8ClampedArray, i:number):boolean {
	return keyDist(px, i, ROCK_KEY) < 64;
}

/** Replace atlas-key fringe so LinearFilter / RepeatWrapping cannot bleed magenta. */
function fillKeyBleed(canvas:HTMLCanvasElement):void {
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		return;
	}
	const w = canvas.width;
	const h = canvas.height;
	const img = ctx.getImageData(0, 0, w, h);
	const d = img.data;
	let fr = 0;
	let fg = 0;
	let fb = 0;
	let fn = 0;
	for (let i = 0; i < d.length; i += 4) {
		if (!isRockKey(d, i)) {
			fr += d[i];
			fg += d[i + 1];
			fb += d[i + 2];
			fn += 1;
		}
	}
	if (fn === 0) {
		return;
	}
	fr = (fr / fn) | 0;
	fg = (fg / fn) | 0;
	fb = (fb / fn) | 0;
	const src = new Uint8ClampedArray(d);
	for (let pass = 0; pass < 4; pass++) {
		src.set(d);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const i = (y * w + x) * 4;
				if (!isRockKey(src, i)) {
					continue;
				}
				let sr = 0;
				let sg = 0;
				let sb = 0;
				let c = 0;
				for (let oy = -1; oy <= 1; oy++) {
					for (let ox = -1; ox <= 1; ox++) {
						if (ox === 0 && oy === 0) {
							continue;
						}
						const xx = x + ox;
						const yy = y + oy;
						if (xx < 0 || yy < 0 || xx >= w || yy >= h) {
							continue;
						}
						const j = (yy * w + xx) * 4;
						if (isRockKey(src, j)) {
							continue;
						}
						sr += src[j];
						sg += src[j + 1];
						sb += src[j + 2];
						c += 1;
					}
				}
				if (c > 0) {
					d[i] = (sr / c) | 0;
					d[i + 1] = (sg / c) | 0;
					d[i + 2] = (sb / c) | 0;
				}
				else if (pass === 3) {
					d[i] = fr;
					d[i + 1] = fg;
					d[i + 2] = fb;
				}
			}
		}
	}
	ctx.putImageData(img, 0, 0);
}

function lumAt(px:Uint8ClampedArray, w:number, h:number, x:number, y:number, fallback:number):number {
	x = Math.min(w - 1, Math.max(0, x));
	y = Math.min(h - 1, Math.max(0, y));
	const i = (y * w + x) * 4;
	if (isRockKey(px, i)) {
		return fallback;
	}
	return Math.pow((px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255, 1.45);
}

function lumField(px:Uint8ClampedArray, w:number, h:number):Float32Array {
	const lum = new Float32Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			lum[y * w + x] = lumAt(px, w, h, x, y, 0.5);
		}
	}
	return lum;
}

function sampleF(src:Float32Array, w:number, h:number, x:number, y:number, fallback:number):number {
	if (x < 0 || y < 0 || x >= w || y >= h) {
		return fallback;
	}
	return src[y * w + x];
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

/**
 * Drop brick-face grain. Keep only dark grout as a hard ridge — no Gaussian,
 * no photo mix. 5×5 median kills speckles; black-hat finds mortar; a high
 * relative cut plus a long-run filter throws pits away and leaves sharp lines.
 */
function groutNormal(src:HTMLCanvasElement, scale:number):HTMLCanvasElement {
	const ctx = src.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		throw new Error('2d context');
	}
	const w = src.width;
	const h = src.height;
	const px = ctx.getImageData(0, 0, w, h).data;
	const lum = medianField(lumField(px, w, h), w, h, 2);
	const radius = Math.min(8, Math.max(5, Math.round(Math.min(w, h) / 22)));
	const closed = morph(morph(lum, w, h, radius, true), w, h, radius, false);
	const height = new Float32Array(w * h);
	let maxGroove = 0;
	for (let i = 0; i < height.length; i++) {
		const groove = Math.max(0, closed[i] - lum[i]);
		height[i] = groove;
		if (groove > maxGroove) {
			maxGroove = groove;
		}
	}
	const thresh = Math.max(0.03, maxGroove * 0.28);
	for (let i = 0; i < height.length; i++) {
		height[i] = height[i] > thresh ? 1 : 0;
	}
	const minRun = Math.max(14, Math.round(Math.min(w, h) / 10));
	height.set(keepLongRuns(height, w, h, minRun));
	const out = document.createElement('canvas');
	out.width = w;
	out.height = h;
	const octx = out.getContext('2d');
	if (!octx) {
		throw new Error('2d context');
	}
	const dst = octx.createImageData(w, h);
	const d = dst.data;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			const c = height[y * w + x];
			const tl = sampleF(height, w, h, x - 1, y - 1, c);
			const t = sampleF(height, w, h, x, y - 1, c);
			const tr = sampleF(height, w, h, x + 1, y - 1, c);
			const l = sampleF(height, w, h, x - 1, y, c);
			const r = sampleF(height, w, h, x + 1, y, c);
			const bl = sampleF(height, w, h, x - 1, y + 1, c);
			const b = sampleF(height, w, h, x, y + 1, c);
			const br = sampleF(height, w, h, x + 1, y + 1, c);
			const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
			const gy = (bl + 2 * b + br) - (tl + 2 * t + tr);
			const nx = -gx * scale;
			const ny = gy * scale;
			const nz = 1;
			const len = Math.hypot(nx, ny, nz) || 1;
			d[i] = (nx / len * 127.5 + 128) | 0;
			d[i + 1] = (ny / len * 127.5 + 128) | 0;
			d[i + 2] = (nz / len * 127.5 + 128) | 0;
			d[i + 3] = 255;
		}
	}
	octx.putImageData(dst, 0, 0);
	return out;
}

function rockMaps(
	albedo:AtlasPixels,
	nrm:AtlasPixels,
	met:THREE.CanvasTexture,
	stamp:RockStamp,
	wrap:THREE.Wrapping,
):SpriteMaps {
	const mapCanvas = warpQuad(albedo, stamp.quad, stamp.outW, stamp.outH, ROCKS_W, ROCKS_H);
	fillKeyBleed(mapCanvas);
	void nrm;
	return {
		map: rockTex(mapCanvas, { wrap }),
		nrm: rockTex(groutNormal(mapCanvas, 10), { normal: true, wrap }),
		met,
	};
}

const WALL_STACK_ORDERS = [
	[0, 1, 2],
	[1, 2, 0],
	[2, 0, 1],
];

function stackWallMaps(
	albedo:AtlasPixels,
	nrm:AtlasPixels,
	met:THREE.CanvasTexture,
	order:number[],
	wrap:THREE.Wrapping,
):SpriteMaps {
	const stampH = WALL_STAMPS[0].outH;
	const stampW = WALL_STAMPS[0].outW;
	const mapCanvas = document.createElement('canvas');
	mapCanvas.width = stampW;
	mapCanvas.height = stampH * WALL_ROW_COUNT;
	const mapCtx = mapCanvas.getContext('2d');
	if (!mapCtx) {
		throw new Error('2d context');
	}
	for (let i = 0; i < order.length; i++) {
		const stamp = WALL_STAMPS[order[i]];
		const mapPiece = warpQuad(albedo, stamp.quad, stamp.outW, stamp.outH, ROCKS_W, ROCKS_H);
		fillKeyBleed(mapPiece);
		mapCtx.drawImage(mapPiece, 0, i * stampH);
	}
	void nrm;
	return {
		map: rockTex(mapCanvas, { wrap }),
		nrm: rockTex(groutNormal(mapCanvas, 10), { normal: true, wrap }),
		met,
	};
}

function darkMet(wrap:THREE.Wrapping):THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 4;
	canvas.height = 4;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('2d context');
	}
	ctx.fillStyle = '#141414';
	ctx.fillRect(0, 0, 4, 4);
	return rockTex(canvas, { normal: true, wrap });
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
	return cropNormal(nrm, rect, alpha, THREE.ClampToEdgeWrapping, SHEET_W, SHEET_H);
}

function build(
	main:HTMLImageElement,
	chests:HTMLImageElement,
	fwd:HTMLImageElement,
	mainN:HTMLImageElement,
	chestsN:HTMLImageElement,
	fwdN:HTMLImageElement,
	mainM:HTMLImageElement,
	chestsM:HTMLImageElement,
	fwdM:HTMLImageElement,
	rocks:HTMLImageElement,
	rocksN:HTMLImageElement,
):SheetTextures {
	const walkA = WALK.map((r) => crop(main, r, 'sprite'));
	const walkFwdA = WALK_FWD.map((r) => crop(fwd, r, 'sprite', FWD_KEY_RGB, false, true));
	const idleFrontA = crop(main, IDLE_FRONT, 'sprite');
	const idleFwdA = crop(fwd, IDLE_FWD, 'sprite', FWD_KEY_RGB, false, true);
	const idleSideA = crop(main, IDLE_SIDE, 'sprite');
	const walkBackA = crop(main, WALK_BACK, 'sprite');
	const torchStickA = crop(main, TORCH_STICK, 'sprite');
	const mainAtlas = (img:HTMLImageElement, r:PxRect, a:HTMLCanvasElement | null, w:THREE.Wrapping = THREE.ClampToEdgeWrapping) =>
		cropNormal(img, r, a, w, SHEET_W, SHEET_H);
	const fwdAtlas = (img:HTMLImageElement, r:PxRect, a:HTMLCanvasElement | null) =>
		cropNormal(img, r, a, THREE.ClampToEdgeWrapping, FWD_SHEET_W, FWD_SHEET_H);
	const itemMaps = (r:PxRect):SpriteMaps => {
		const a = crop(main, r, 'sprite');
		return {
			map: pixelArt(a),
			nrm: mainAtlas(mainN, r, a),
			met: mainAtlas(mainM, r, a),
		};
	};
	const wallWrap = THREE.RepeatWrapping;
	const rockMet = darkMet(wallWrap);
	const rocksPx = rasterizeImage(rocks);
	const rocksNPx = rasterizeImage(rocksN);
	const wallTiles = WALL_STACK_ORDERS.map((order) => stackWallMaps(rocksPx, rocksNPx, rockMet, order, wallWrap));
	const floorTiles = FLOOR_STAMPS.map((s) => rockMaps(rocksPx, rocksNPx, rockMet, s, THREE.ClampToEdgeWrapping));
	return {
		walk: walkA.map((c) => pixelArt(c)),
		walkN: WALK.map((r, i) => mainAtlas(mainN, r, walkA[i])),
		walkM: WALK.map((r, i) => mainAtlas(mainM, r, walkA[i])),
		walkFwd: walkFwdA.map((c) => pixelArt(c)),
		walkFwdN: WALK_FWD.map((r, i) => fwdAtlas(fwdN, r, walkFwdA[i])),
		walkFwdM: WALK_FWD.map((r, i) => fwdAtlas(fwdM, r, walkFwdA[i])),
		idleFront: pixelArt(idleFrontA),
		idleFrontN: mainAtlas(mainN, IDLE_FRONT, idleFrontA),
		idleFrontM: mainAtlas(mainM, IDLE_FRONT, idleFrontA),
		idleFwd: pixelArt(idleFwdA),
		idleFwdN: fwdAtlas(fwdN, IDLE_FWD, idleFwdA),
		idleFwdM: fwdAtlas(fwdM, IDLE_FWD, idleFwdA),
		idleSide: pixelArt(idleSideA),
		idleSideN: mainAtlas(mainN, IDLE_SIDE, idleSideA),
		idleSideM: mainAtlas(mainM, IDLE_SIDE, idleSideA),
		walkBack: pixelArt(walkBackA),
		walkBackN: mainAtlas(mainN, WALK_BACK, walkBackA),
		walkBackM: mainAtlas(mainM, WALK_BACK, walkBackA),
		torchStick: pixelArt(torchStickA),
		torchStickN: mainAtlas(mainN, TORCH_STICK, torchStickA),
		torchStickM: mainAtlas(mainM, TORCH_STICK, torchStickA),
		flame: FLAME.map((r) => pixelArt(crop(main, r, 'flame', KEY_RGB, true, true))),
		floorTiles,
		wallTiles,
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

export async function loadBitmap(src:string, srgb:boolean):Promise<ImageBitmap> {
	const res = await fetch(src);
	if (!res.ok) {
		throw new Error(`failed to load ${src}`);
	}
	const blob = await res.blob();
	// ImageBitmap skips UNPACK_FLIP_Y; pre-flip so it matches CanvasTexture.
	return createImageBitmap(blob, {
		colorSpaceConversion: srgb ? 'default' : 'none',
		premultiplyAlpha: 'none',
		imageOrientation: 'flipY',
	});
}

/** Crop a flipped atlas using PNG/top-left rects from the packer. */
export function cropBitmap(src:ImageBitmap, x:number, y:number, w:number, h:number):Promise<ImageBitmap> {
	return createImageBitmap(src, x, src.height - y - h, w, h);
}

export function pixelArtImage(
	image:ImageBitmap | HTMLImageElement,
	srgb:boolean,
	wrap:THREE.Wrapping = THREE.ClampToEdgeWrapping,
):THREE.Texture {
	const tex = new THREE.Texture(image);
	tex.magFilter = THREE.NearestFilter;
	tex.minFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;
	tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
	tex.wrapS = wrap;
	tex.wrapT = wrap;
	tex.flipY = false;
	tex.needsUpdate = true;
	owned.push(tex);
	return tex;
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
		loadImage(`${base}spritesheet.jpg`),
		loadImage(`${base}chests.jpg`),
		loadImage(`${base}spritesheet_forward_walk.jpg`),
		loadImage(`${base}spritesheet_normal.png`),
		loadImage(`${base}chests_normal.png`),
		loadImage(`${base}spritesheet_forward_walk_normal.png`),
		loadImage(`${base}spritesheet_metallic.jpg`),
		loadImage(`${base}chests_metallic.jpg`),
		loadImage(`${base}spritesheet_forward_walk_metallic.jpg`),
		loadImage(`${base}rocks.jpg`),
		loadImage(`${base}rocks_normal.png`),
	]).then(([main, chests, fwd, mainN, chestsN, fwdN, mainM, chestsM, fwdM, rocks, rocksN]) => {
		textures = build(main, chests, fwd, mainN, chestsN, fwdN, mainM, chestsM, fwdM, rocks, rocksN);
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
):THREE.MeshLambertMaterial {
	const mat = new THREE.MeshLambertMaterial({
		map,
		normalMap: normalMap ?? null,
		transparent: true,
		alphaTest: 0.28,
		normalScale: new THREE.Vector2(0.85, 0.85),
		side: THREE.DoubleSide,
		depthWrite: true,
		toneMapped: true,
	});
	mat.customProgramCacheKey = () => 'spriteLambert';
	mat.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader.replace(
			'#include <shadowmap_vertex>',
			`#include <shadowmap_vertex>
#if defined( USE_SHADOWMAP ) && ( NUM_POINT_LIGHT_SHADOWS > 0 )
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		vec3 toFrag = vPointShadowCoord[ i ].xyz;
		float dist = length( toFrag );
		vPointShadowCoord[ i ].xyz = toFrag * ( max( dist - 0.14, 0.04 ) / max( dist, 1e-4 ) );
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

export function tileMaterial(
	map:THREE.Texture,
	extras:THREE.MeshStandardMaterialParameters = {},
):THREE.MeshStandardMaterial {
	const nrm = extras.normalMap as THREE.Texture | null | undefined;
	const key = `tile:${map.uuid}:${nrm?.uuid ?? ''}:${extras.polygonOffset ? 1 : 0}:${String(extras.polygonOffsetFactor ?? '')}:${String(extras.metalness ?? '')}`;
	const hit = matByKey.get(key);
	if (hit) {
		return hit as THREE.MeshStandardMaterial;
	}
	const mat = new THREE.MeshStandardMaterial({
		map,
		roughness: 0.93,
		metalness: extras.metalnessMap ? 1 : 0.03,
		shadowSide: THREE.FrontSide,
		normalScale: extras.normalMap ? new THREE.Vector2(1.85, 1.85) : undefined,
		...extras,
	});
	mat.userData.shared = true;
	matByKey.set(key, mat);
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
	disposeNpcAnims();
	disposeSwordAnims();
}
