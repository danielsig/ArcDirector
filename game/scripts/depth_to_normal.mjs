/**
 * Bake tangent-space normals from sprite depth maps with OpenCV.
 *
 * Fits each `_d.png` onto the matching albedo silhouette, inpaints holes,
 * upscales, Gaussian-blurs, then uses OpenCV's 5×5 Sobel so the hat reads as a
 * round volume. Writes `_n.png` next to the albedo.
 *
 *   pnpm --filter @arc-director/game normals
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import cvModule from '@techstark/opencv-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/characters');
const UPSCALE = 4;
const GAUSS_SIGMA = 3.4;
const STRENGTH = 0.42;

async function getCv() {
	if (cvModule instanceof Promise) {
		return await cvModule;
	}
	if (cvModule.Mat) {
		return cvModule;
	}
	await new Promise((resolve) => {
		cvModule.onRuntimeInitialized = () => resolve();
	});
	return cvModule;
}

const cv = await getCv();

function readPng(file) {
	return PNG.sync.read(fs.readFileSync(file));
}

function writePng(file, png) {
	fs.writeFileSync(file, PNG.sync.write(png));
}

function spriteBox(mask, w, h) {
	let x0 = w;
	let y0 = h;
	let x1 = 0;
	let y1 = 0;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (!mask[y * w + x]) {
				continue;
			}
			if (x < x0) {
				x0 = x;
			}
			if (y < y0) {
				y0 = y;
			}
			if (x + 1 > x1) {
				x1 = x + 1;
			}
			if (y + 1 > y1) {
				y1 = y + 1;
			}
		}
	}
	if (x1 <= x0) {
		return { x0: 0, y0: 0, x1: w, y1: h };
	}
	return { x0, y0, x1, y1 };
}

function lumAt(png, i) {
	return (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 765;
}

function fitDepth(albedo, depth) {
	const w = albedo.width;
	const h = albedo.height;
	const aMask = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) {
		aMask[i] = albedo.data[i * 4 + 3] > 16 ? 1 : 0;
	}
	const dMask = new Uint8Array(depth.width * depth.height);
	for (let i = 0; i < dMask.length; i++) {
		dMask[i] = lumAt(depth, i * 4) > 36 / 255 ? 1 : 0;
	}
	const aBox = spriteBox(aMask, w, h);
	const dBox = spriteBox(dMask, depth.width, depth.height);
	const cropW = Math.max(1, dBox.x1 - dBox.x0);
	const cropH = Math.max(1, dBox.y1 - dBox.y0);
	const aw = Math.max(1, aBox.x1 - aBox.x0);
	const ah = Math.max(1, aBox.y1 - aBox.y0);
	const crop = new cv.Mat(cropH, cropW, cv.CV_32FC1);
	for (let y = 0; y < cropH; y++) {
		for (let x = 0; x < cropW; x++) {
			const sx = dBox.x0 + x;
			const sy = dBox.y0 + y;
			crop.data32F[y * cropW + x] = lumAt(depth, (sy * depth.width + sx) * 4);
		}
	}
	const fitted = new cv.Mat();
	cv.resize(crop, fitted, new cv.Size(aw, ah), 0, 0, cv.INTER_CUBIC);
	crop.delete();
	const height = new Float32Array(w * h);
	for (let y = 0; y < ah; y++) {
		for (let x = 0; x < aw; x++) {
			const i = (aBox.y0 + y) * w + (aBox.x0 + x);
			if (!aMask[i]) {
				continue;
			}
			height[i] = fitted.data32F[y * aw + x];
		}
	}
	fitted.delete();
	let lo = 1;
	let hi = 0;
	for (let i = 0; i < height.length; i++) {
		if (!aMask[i]) {
			continue;
		}
		if (height[i] < lo) {
			lo = height[i];
		}
		if (height[i] > hi) {
			hi = height[i];
		}
	}
	const span = hi - lo;
	if (span > 0.02) {
		for (let i = 0; i < height.length; i++) {
			if (!aMask[i]) {
				continue;
			}
			height[i] = (height[i] - lo) / span;
		}
	}
	return { height, mask: aMask, w, h };
}

function heightToNormal(height, mask, w, h) {
	const gray = new Uint8Array(w * h);
	const hole = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) {
		gray[i] = Math.max(0, Math.min(255, (height[i] * 255) | 0));
		hole[i] = mask[i] ? 0 : 255;
	}
	const src = cv.matFromArray(h, w, cv.CV_8UC1, gray);
	const holeMat = cv.matFromArray(h, w, cv.CV_8UC1, hole);
	const filled = new cv.Mat();
	cv.inpaint(src, holeMat, filled, 3, cv.INPAINT_TELEA);
	src.delete();
	holeMat.delete();
	const hi = new cv.Mat();
	cv.resize(filled, hi, new cv.Size(w * UPSCALE, h * UPSCALE), 0, 0, cv.INTER_CUBIC);
	filled.delete();
	const k = 2 * Math.ceil(3 * GAUSS_SIGMA) + 1;
	const blur = new cv.Mat();
	cv.GaussianBlur(hi, blur, new cv.Size(k, k), GAUSS_SIGMA, GAUSS_SIGMA);
	hi.delete();
	const src32 = new cv.Mat();
	blur.convertTo(src32, cv.CV_32F, 1 / 255);
	blur.delete();
	const gx = new cv.Mat();
	const gy = new cv.Mat();
	cv.Sobel(src32, gx, cv.CV_32F, 1, 0, 5);
	cv.Sobel(src32, gy, cv.CV_32F, 0, 1, 5);
	src32.delete();
	const packed = new Uint8Array(w * UPSCALE * h * UPSCALE * 3);
	const gw = w * UPSCALE;
	const gh = h * UPSCALE;
	for (let y = 0; y < gh; y++) {
		for (let x = 0; x < gw; x++) {
			const gxv = gx.data32F[y * gw + x];
			const gyv = gy.data32F[y * gw + x];
			let nx = -gxv * STRENGTH;
			let ny = gyv * STRENGTH;
			let nz = 1;
			const len = Math.hypot(nx, ny, nz) || 1;
			nx /= len;
			ny /= len;
			nz /= len;
			const i = (y * gw + x) * 3;
			packed[i] = (nx * 127.5 + 128) | 0;
			packed[i + 1] = (ny * 127.5 + 128) | 0;
			packed[i + 2] = (nz * 127.5 + 128) | 0;
		}
	}
	gx.delete();
	gy.delete();
	const rgb = cv.matFromArray(gh, gw, cv.CV_8UC3, packed);
	const small = new cv.Mat();
	cv.resize(rgb, small, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
	rgb.delete();
	const out = new Uint8Array(small.data);
	small.delete();
	return out;
}

function bakeOne(albedoPath, depthPath, outPath) {
	const albedo = readPng(albedoPath);
	const depth = readPng(depthPath);
	const { height, mask, w, h } = fitDepth(albedo, depth);
	const rgb = heightToNormal(height, mask, w, h);
	const png = new PNG({ width: w, height: h });
	for (let i = 0; i < w * h; i++) {
		png.data[i * 4] = rgb[i * 3];
		png.data[i * 4 + 1] = rgb[i * 3 + 1];
		png.data[i * 4 + 2] = rgb[i * 3 + 2];
		png.data[i * 4 + 3] = albedo.data[i * 4 + 3];
	}
	writePng(outPath, png);
	console.log(`opencv sobel -> ${outPath}`);
}

const KINDS = new Set(['player', 'guard', 'robe', 'merchant', 'princess', 'sorceress']);

function walkDepths(dir, found, depth = 0) {
	if (!fs.existsSync(dir)) {
		return;
	}
	for (const name of fs.readdirSync(dir)) {
		const full = path.join(dir, name);
		if (fs.statSync(full).isDirectory()) {
			if (depth === 0 && !KINDS.has(name)) {
				continue;
			}
			walkDepths(full, found, depth + 1);
			continue;
		}
		if (name.endsWith('_d.png')) {
			found.push(full);
		}
	}
}

const files = [];
walkDepths(ROOT, files);
files.sort();
const only = process.argv[2];
const selected = only ? files.filter((f) => f.includes(only)) : files;
if (selected.length === 0) {
	console.error(only ? `no *_d.png matching ${only}` : `no *_d.png under ${ROOT}`);
	process.exit(1);
}
for (const depthPath of selected) {
	const stem = path.basename(depthPath).replace(/_d\.png$/i, '');
	const dir = path.dirname(depthPath);
	const albedoPath = path.join(dir, `${stem}.png`);
	if (!fs.existsSync(albedoPath)) {
		console.log(`skip (no albedo) ${depthPath}`);
		continue;
	}
	bakeOne(albedoPath, depthPath, path.join(dir, `${stem}_n.png`));
}
