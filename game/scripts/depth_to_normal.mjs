/**
 * Bake tangent-space normals from sprite depth maps with OpenCV.
 *
 * Fits each `_d.png` onto the matching albedo silhouette, inpaints holes,
 * upscales, Gaussian-blurs, then uses OpenCV's 5×5 Sobel so the hat reads as a
 * round volume. Outside the albedo, bleeds the average interior limb normal
 * (not the 1px Sobel wrap) `--bleed` px so a 1–3px depth-gen miss still samples
 * that edge.
 *
 *   pnpm --filter @arc-director/game normals
 *   node scripts/depth_to_normal.mjs --dir DIR [--filter REGEX] [--bleed 8]
 *
 * `--bleed` is the outer spill in pixels (default 8). Rim shell and erode
 * scale with it (8 → 4px shell/erode; 0 → none).
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import cvModule from '@techstark/opencv-js';

import { isWorkDir, listCharacterEntries } from './characters.mjs';
const UPSCALE = 4;
const GAUSS_SIGMA = 3.4;
const STRENGTH = 0.42;
/** Extra pixels of figure normals outside the albedo, for 1–3px depth-gen miss. */
const BLEED = 8;
/** Drop this many px of silhouette wrap before sampling a limb-side normal (at default bleed). */
const BLEED_ERODE = 4;
/** Replace this many px of the figure rim (camera-facing wrap) with that sample (at default bleed). */
const BLEED_SHELL = 4;
const FLAT_N = [128, 128, 255];

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
	const buf = PNG.sync.write(png);
	let last = null;
	for (let attempt = 0; attempt < 12; attempt++) {
		try {
			fs.writeFileSync(file, buf);
			return;
		} catch (err) {
			last = err;
			const t = Date.now() + 200 * (attempt + 1);
			while (Date.now() < t) {
				/* wait for Windows to release the PNG */
			}
		}
	}
	throw last;
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

function largestMaskBox(mask, w, h) {
	const seen = new Uint8Array(w * h);
	let best = null;
	let bestN = 0;
	const qx = new Int32Array(w * h);
	const qy = new Int32Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i0 = y * w + x;
			if (seen[i0] || !mask[i0]) {
				seen[i0] = 1;
				continue;
			}
			let n = 0;
			let x0 = x;
			let y0 = y;
			let x1 = x + 1;
			let y1 = y + 1;
			let qs = 0;
			let qe = 0;
			qx[qe] = x;
			qy[qe] = y;
			qe += 1;
			seen[i0] = 1;
			while (qs < qe) {
				const cx = qx[qs];
				const cy = qy[qs];
				qs += 1;
				n += 1;
				if (cx < x0) x0 = cx;
				if (cy < y0) y0 = cy;
				if (cx + 1 > x1) x1 = cx + 1;
				if (cy + 1 > y1) y1 = cy + 1;
				const nbr = [[1, 0], [-1, 0], [0, 1], [0, -1]];
				for (const [dx, dy] of nbr) {
					const nx = cx + dx;
					const ny = cy + dy;
					if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
					const ni = ny * w + nx;
					if (seen[ni]) continue;
					if (!mask[ni]) {
						seen[ni] = 1;
						continue;
					}
					seen[ni] = 1;
					qx[qe] = nx;
					qy[qe] = ny;
					qe += 1;
				}
			}
			if (n > bestN) {
				bestN = n;
				best = { x0, y0, x1, y1 };
			}
		}
	}
	return best;
}

function fitDepth(albedo, depth) {
	const w = albedo.width;
	const h = albedo.height;
	const aMask = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) {
		const r = albedo.data[i * 4];
		const g = albedo.data[i * 4 + 1];
		const b = albedo.data[i * 4 + 2];
		const a = albedo.data[i * 4 + 3];
		const mag = Math.abs(r - 255) + Math.abs(g - 0) + Math.abs(b - 255) < 48;
		aMask[i] = a > 16 && !mag ? 1 : 0;
	}
	const aBox = spriteBox(aMask, w, h);
	const same = depth.width === w && depth.height === h;
	const valid = new Uint8Array(w * h);
	let height;
	if (same) {
		height = new Float32Array(w * h);
		for (let i = 0; i < w * h; i++) {
			if (!aMask[i]) {
				continue;
			}
			const lum = lumAt(depth, i * 4);
			if (lum <= 6 / 765) {
				continue;
			}
			height[i] = lum;
			valid[i] = 1;
		}
	} else {
		const dMask = new Uint8Array(depth.width * depth.height);
		for (let i = 0; i < dMask.length; i++) {
			dMask[i] = lumAt(depth, i * 4) > 36 / 255 ? 1 : 0;
		}
		const dBox = largestMaskBox(dMask, depth.width, depth.height) ?? spriteBox(dMask, depth.width, depth.height);
		const cropW = Math.max(1, dBox.x1 - dBox.x0);
		const cropH = Math.max(1, dBox.y1 - dBox.y0);
		const aw = Math.max(1, aBox.x1 - aBox.x0);
		const ah = Math.max(1, aBox.y1 - aBox.y0);
		const scale = ah / cropH;
		const mappedW = cropW * scale;
		const x0 = aBox.x0 + (aw - mappedW) / 2;
		const crop = new cv.Mat(cropH, cropW, cv.CV_32FC1);
		for (let y = 0; y < cropH; y++) {
			for (let x = 0; x < cropW; x++) {
				const sx = dBox.x0 + x;
				const sy = dBox.y0 + y;
				crop.data32F[y * cropW + x] = lumAt(depth, (sy * depth.width + sx) * 4);
			}
		}
		const fitted = new cv.Mat();
		cv.resize(crop, fitted, new cv.Size(Math.max(1, Math.round(mappedW)), ah), 0, 0, cv.INTER_CUBIC);
		crop.delete();
		height = new Float32Array(w * h);
		const fw = fitted.cols;
		const fh = fitted.rows;
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const i = y * w + x;
				if (!aMask[i]) {
					continue;
				}
				const sx = Math.round((x + 0.5 - x0) * (fw / mappedW) - 0.5);
				const sy = Math.round((y + 0.5 - aBox.y0) * (fh / ah) - 0.5);
				if (sx < 0 || sy < 0 || sx >= fw || sy >= fh) {
					continue;
				}
				const v = fitted.data32F[sy * fw + sx];
				if (v <= 6 / 765) {
					continue;
				}
				height[i] = v;
				valid[i] = 1;
			}
		}
		fitted.delete();
	}
	let lo = 1;
	let hi = 0;
	for (let i = 0; i < height.length; i++) {
		if (!valid[i]) {
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
			if (!valid[i]) {
				continue;
			}
			height[i] = (height[i] - lo) / span;
		}
	}
	return { height, mask: aMask, valid, w, h };
}

function heightToNormal(height, mask, valid, w, h) {
	const gray = new Uint8Array(w * h);
	const hole = new Uint8Array(w * h);
	const ink = 0.22;
	for (let i = 0; i < w * h; i++) {
		const stroke = mask[i] && valid[i] && height[i] < ink;
		gray[i] = valid[i] && !stroke ? Math.max(0, Math.min(255, (height[i] * 255) | 0)) : 0;
		hole[i] = mask[i] && valid[i] && !stroke ? 0 : 255;
	}
	const src = cv.matFromArray(h, w, cv.CV_8UC1, gray);
	const holeMat = cv.matFromArray(h, w, cv.CV_8UC1, hole);
	const filled = new cv.Mat();
	cv.inpaint(src, holeMat, filled, 5, cv.INPAINT_TELEA);
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

/** Box radius (px) for a lateral-weighted average of the limb-side normal. */
const BLEED_AVG = 3;

function erodeMask(mask, w, h, r) {
	const out = new Uint8Array(w * h);
	if (r <= 0) {
		out.set(mask);
		return out;
	}
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			if (!mask[i]) {
				continue;
			}
			let ok = true;
			const y0 = y - r;
			const y1 = y + r;
			const x0 = x - r;
			const x1 = x + r;
			if (y0 < 0 || x0 < 0 || y1 >= h || x1 >= w) {
				continue;
			}
			for (let yy = y0; yy <= y1 && ok; yy++) {
				for (let xx = x0; xx <= x1; xx++) {
					if (!mask[yy * w + xx]) {
						ok = false;
						break;
					}
				}
			}
			if (ok) {
				out[i] = 1;
			}
		}
	}
	return out;
}

function nearestMask(mask, w, h, x, y, maxDist) {
	const inf = maxDist + 0.01;
	let best = inf;
	let sx = -1;
	let sy = -1;
	const y0 = Math.max(0, y - maxDist);
	const y1 = Math.min(h - 1, y + maxDist);
	const x0 = Math.max(0, x - maxDist);
	const x1 = Math.min(w - 1, x + maxDist);
	for (let yy = y0; yy <= y1; yy++) {
		for (let xx = x0; xx <= x1; xx++) {
			if (!mask[yy * w + xx]) {
				continue;
			}
			const d = Math.hypot(xx - x, yy - y);
			if (d <= maxDist && d < best) {
				best = d;
				sx = xx;
				sy = yy;
			}
		}
	}
	return sx < 0 ? null : { x: sx, y: sy, d: best };
}

function decodeNormal(rgb, i) {
	const o = i * 3;
	return [
		(rgb[o] - 128) / 127.5,
		(rgb[o + 1] - 128) / 127.5,
		(rgb[o + 2] - 128) / 127.5,
	];
}

function encodeNormal(nx, ny, nz) {
	const len = Math.hypot(nx, ny, nz) || 1;
	return [
		(nx / len) * 127.5 + 128,
		(ny / len) * 127.5 + 128,
		(nz / len) * 127.5 + 128,
	];
}

function averageInteriorNormal(rgb, mask, w, h, cx, cy, radius) {
	let nx = 0;
	let ny = 0;
	let nz = 0;
	let wsum = 0;
	const y0 = Math.max(0, cy - radius);
	const y1 = Math.min(h - 1, cy + radius);
	const x0 = Math.max(0, cx - radius);
	const x1 = Math.min(w - 1, cx + radius);
	for (let yy = y0; yy <= y1; yy++) {
		for (let xx = x0; xx <= x1; xx++) {
			const i = yy * w + xx;
			if (!mask[i]) {
				continue;
			}
			const v = decodeNormal(rgb, i);
			if (v[2] > 0.85 && Math.hypot(v[0], v[1]) < 0.4) {
				continue;
			}
			const lat = Math.hypot(v[0], v[1]);
			const weight = lat * lat + 0.04;
			nx += v[0] * weight;
			ny += v[1] * weight;
			nz += v[2] * weight;
			wsum += weight;
		}
	}
	if (!wsum) {
		return null;
	}
	return encodeNormal(nx, ny, nz);
}

function nearBackground(mask, w, h, x, y, reach) {
	const y0 = Math.max(0, y - reach);
	const y1 = Math.min(h - 1, y + reach);
	const x0 = Math.max(0, x - reach);
	const x1 = Math.min(w - 1, x + reach);
	for (let yy = y0; yy <= y1; yy++) {
		for (let xx = x0; xx <= x1; xx++) {
			if (!mask[yy * w + xx]) {
				return true;
			}
		}
	}
	return false;
}

function bleedScale(bleed) {
	const t = BLEED > 0 ? bleed / BLEED : 0;
	const shell = Math.round(BLEED_SHELL * t);
	const erode = Math.round(BLEED_ERODE * t);
	return { shell, erode, search: bleed + erode };
}

function isOutlinePixel(mask, w, h, x, y, shell) {
	return shell > 0 && nearBackground(mask, w, h, x, y, shell);
}

function spillNormals(rgb, mask, w, h, bleed) {
	const { shell, erode, search } = bleedScale(bleed);
	const core = erodeMask(mask, w, h, erode);
	const out = new Uint8Array(w * h * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			const o = i * 3;
			if (mask[i] && !isOutlinePixel(mask, w, h, x, y, shell)) {
				out[o] = rgb[o];
				out[o + 1] = rgb[o + 1];
				out[o + 2] = rgb[o + 2];
				continue;
			}
			if (!mask[i]) {
				const edge = nearestMask(mask, w, h, x, y, bleed);
				if (!edge) {
					out[o] = FLAT_N[0];
					out[o + 1] = FLAT_N[1];
					out[o + 2] = FLAT_N[2];
					continue;
				}
			}
			const hit = nearestMask(core, w, h, x, y, search);
			if (!hit) {
				out[o] = mask[i] ? rgb[o] : FLAT_N[0];
				if (!mask[i]) {
					out[o + 1] = FLAT_N[1];
					out[o + 2] = FLAT_N[2];
				} else {
					out[o + 1] = rgb[o + 1];
					out[o + 2] = rgb[o + 2];
				}
				continue;
			}
			const avg = averageInteriorNormal(rgb, core, w, h, hit.x, hit.y, BLEED_AVG);
			if (!avg) {
				out[o] = FLAT_N[0];
				out[o + 1] = FLAT_N[1];
				out[o + 2] = FLAT_N[2];
				continue;
			}
			out[o] = avg[0];
			out[o + 1] = avg[1];
			out[o + 2] = avg[2];
		}
	}
	return out;
}

function bakeOne(albedoPath, depthPath, outPath, bleed) {
	const albedo = readPng(albedoPath);
	const depth = readPng(depthPath);
	const { height, mask, valid, w, h } = fitDepth(albedo, depth);
	const rgb = spillNormals(heightToNormal(height, mask, valid, w, h), mask, w, h, bleed);
	const png = new PNG({ width: w, height: h });
	for (let i = 0; i < w * h; i++) {
		png.data[i * 4] = rgb[i * 3];
		png.data[i * 4 + 1] = rgb[i * 3 + 1];
		png.data[i * 4 + 2] = rgb[i * 3 + 2];
		png.data[i * 4 + 3] = 255;
	}
	writePng(outPath, png);
	console.log(`opencv sobel -> ${outPath}`);
}

function walkDepths(dir, found) {
	if (!fs.existsSync(dir)) {
		return;
	}
	for (const name of fs.readdirSync(dir)) {
		if (isWorkDir(name)) {
			continue;
		}
		const full = path.join(dir, name);
		if (fs.statSync(full).isDirectory()) {
			walkDepths(full, found);
			continue;
		}
		if (name.endsWith('_d.png')) {
			found.push(full);
		}
	}
}

function flag(name) {
	const i = args.indexOf(name);
	if (i < 0 || i + 1 >= args.length) {
		return null;
	}
	return args[i + 1];
}

const args = process.argv.slice(2);
const dirOnly = flag('--dir');
const filterRaw = flag('--filter');
const bleedRaw = flag('--bleed');
const bleed = bleedRaw == null ? BLEED : Number(bleedRaw);
if (!Number.isFinite(bleed) || bleed < 0) {
	console.error(`--bleed must be a >= 0 number (got ${bleedRaw})`);
	process.exit(1);
}
let filterRe = null;
if (filterRaw) {
	try {
		filterRe = new RegExp(filterRaw);
	} catch {
		console.error(`--filter: invalid regex ${JSON.stringify(filterRaw)}`);
		process.exit(1);
	}
}

const files = [];
if (dirOnly) {
	walkDepths(path.resolve(dirOnly), files);
} else {
	for (const { dir } of listCharacterEntries()) {
		walkDepths(dir, files);
	}
}
files.sort();
const selected = filterRe
	? files.filter((f) => filterRe.test(path.basename(f)) || filterRe.test(f))
	: files;
if (selected.length === 0) {
	console.error(filterRaw ? `no *_d.png matching /${filterRaw}/` : 'no *_d.png in character folders');
	process.exit(1);
}
console.log(`bake ${selected.length} _d → _n bleed=${bleed}${filterRaw ? ` filter=/${filterRaw}/` : ''}`);
for (const depthPath of selected) {
	const stem = path.basename(depthPath).replace(/_d\.png$/i, '');
	const dir = path.dirname(depthPath);
	const albedoPath = path.join(dir, `${stem}.png`);
	if (!fs.existsSync(albedoPath)) {
		console.log(`skip (no albedo) ${depthPath}`);
		continue;
	}
	bakeOne(albedoPath, depthPath, path.join(dir, `${stem}_n.png`), bleed);
}
