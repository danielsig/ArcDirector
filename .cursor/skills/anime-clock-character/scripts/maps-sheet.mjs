#!/usr/bin/env node
/**
 * Pack fitted albedos into an 8-column sheet (80 frames → 8×10), then
 * unpack / fit-d / fit-m a generated shape (`_d`) or metallic sheet onto
 * those cells. Layout JSON can also be a 2×4 walk-hour sheet (repair path).
 *
 *   node maps-sheet.mjs pack DIR --out albedo.png --json layout.json
 *   node maps-sheet.mjs fit-d DEPTH.png --json layout.json --out DIR [--albedo albedo.png] [--sheet fitted_d.png] [--letterbox]
 *   node maps-sheet.mjs fit-m METAL.png --json layout.json --out DIR [--albedo albedo.png] [--sheet fitted_m.png]
 *   node maps-sheet.mjs bake-m DIR [--shine 128] [--sheet fitted_m.png]
 *   node maps-sheet.mjs unpack SHEET.png --json layout.json --suffix _d --out DIR
 *   node maps-sheet.mjs unpack SHEET.png --json layout.json --suffix _n --out DIR
 *   node maps-sheet.mjs unpack SHEET.png --json layout.json --suffix _m --out DIR
 *   node maps-sheet.mjs flipx-n SRC.png --out DST.png
 *   node maps-sheet.mjs check DIR
 *   node maps-sheet.mjs selftest
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { PNG } = createRequire(path.resolve(here, '../../../../game/package.json'))('pngjs');

const KEY = [255, 0, 255];
const DEPTH_BG = [0, 0, 0, 255];
const FLAT_N = [128, 128, 255, 255];
const COLS = 8;
const OFFSET_MAX = 12;
/** idle_02 / walk_02 = 1:30 (45° from 12); idle_04 / walk_04 = 4:30 (135° from 12). */
const FRAMES = [
	'idle_01', 'idle_02', 'idle_03', 'idle_04', 'idle_05', 'idle_06', 'idle_08', 'idle_09', 'idle_10', 'idle_12',
	...[12, 2, 3, 4, 6, 8, 9, 10].flatMap((hour) => {
		const tag = String(hour).padStart(2, '0');
		return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `walk_${tag}_${i}`);
	}),
	'take_06_0', 'take_06_1', 'take_06_2', 'take_06_3',
	'take_06_4', 'take_06_5', 'take_06_6', 'take_06_7',
];

function arg(flag, fallback) {
	const i = process.argv.indexOf(flag);
	if (i < 0) {
		return fallback;
	}
	return process.argv[i + 1];
}

function readPng(file) {
	return PNG.sync.read(fs.readFileSync(file));
}

function writePng(file, png) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, PNG.sync.write(png));
}

function emptyPng(w, h, rgba = [...KEY, 255]) {
	const png = new PNG({ width: w, height: h, colorType: 6 });
	for (let i = 0; i < png.data.length; i += 4) {
		png.data[i] = rgba[0];
		png.data[i + 1] = rgba[1];
		png.data[i + 2] = rgba[2];
		png.data[i + 3] = rgba[3];
	}
	return png;
}

function blit(dst, src, dx, dy) {
	for (let y = 0; y < src.height; y++) {
		for (let x = 0; x < src.width; x++) {
			const tx = dx + x;
			const ty = dy + y;
			if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) {
				continue;
			}
			const si = (y * src.width + x) * 4;
			const di = (ty * dst.width + tx) * 4;
			dst.data[di] = src.data[si];
			dst.data[di + 1] = src.data[si + 1];
			dst.data[di + 2] = src.data[si + 2];
			dst.data[di + 3] = src.data[si + 3];
		}
	}
}

function magDist(r, g, b) {
	return Math.abs(r - KEY[0]) + Math.abs(g - KEY[1]) + Math.abs(b - KEY[2]);
}

function isKeyMag(r, g, b, a) {
	if (a < 8) {
		return true;
	}
	return magDist(r, g, b) < 48;
}

function fillFor(suffix) {
	return suffix === '_n' ? FLAT_N : DEPTH_BG;
}

function contentBox(png) {
	const { width: w, height: h, data } = png;
	let x0 = w;
	let y0 = h;
	let x1 = 0;
	let y1 = 0;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			if (isKeyMag(data[i], data[i + 1], data[i + 2], data[i + 3])) {
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

function magFrac(png) {
	const { data } = png;
	let n = 0;
	const total = data.length / 4;
	for (let i = 0; i < data.length; i += 4) {
		if (magDist(data[i], data[i + 1], data[i + 2]) < 48) {
			n += 1;
		}
	}
	return n / total;
}

function gridBox(src, aspect) {
	const { width: w, height: h } = src;
	const srcA = w / h;
	if (Math.abs(srcA - aspect) < 0.04) {
		return { x0: 0, y0: 0, x1: w, y1: h };
	}
	if (srcA > aspect) {
		const innerW = h * aspect;
		const x0 = (w - innerW) / 2;
		return { x0, y0: 0, x1: x0 + innerW, y1: h };
	}
	const innerH = w / aspect;
	const y0 = (h - innerH) / 2;
	return { x0: 0, y0, x1: w, y1: y0 + innerH };
}

function sampleBilinear(src, fx, fy) {
	const { width: w, height: h, data } = src;
	const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx)));
	const y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
	const x1 = Math.max(0, Math.min(w - 1, x0 + 1));
	const y1 = Math.max(0, Math.min(h - 1, y0 + 1));
	const tx = fx - Math.floor(fx);
	const ty = fy - Math.floor(fy);
	const i00 = (y0 * w + x0) * 4;
	const i10 = (y0 * w + x1) * 4;
	const i01 = (y1 * w + x0) * 4;
	const i11 = (y1 * w + x1) * 4;
	const out = [0, 0, 0, 0];
	for (let c = 0; c < 4; c++) {
		const a = data[i00 + c] * (1 - tx) + data[i10 + c] * tx;
		const b = data[i01 + c] * (1 - tx) + data[i11 + c] * tx;
		out[c] = a * (1 - ty) + b * ty;
	}
	return out;
}

function isDepthBg(r, g, b, a) {
	if (a < 8) {
		return true;
	}
	if (isKeyMag(r, g, b, a)) {
		return true;
	}
	return r < 18 && g < 18 && b < 18;
}

/** Back-quarter robes sit at lum ~7–26; isDepthBg would drop them and bbox only hair/hands. */
function isMetalBg(r, g, b, a) {
	if (a < 8) {
		return true;
	}
	if (isKeyMag(r, g, b, a)) {
		return true;
	}
	return r + g + b < 6;
}

function occupancyBands(arr, minRun, minLen) {
	const out = [];
	let i = 0;
	while (i < arr.length) {
		if (arr[i] >= minRun) {
			let j = i;
			while (j < arr.length && arr[j] >= minRun) {
				j += 1;
			}
			if (j - i >= minLen) {
				out.push({ a: i, b: j });
			}
			i = j;
			continue;
		}
		i += 1;
	}
	return out;
}

function expandToGutters(bands, limit) {
	return bands.map((b, i) => ({
		a: i === 0 ? Math.max(0, b.a) : Math.floor((bands[i - 1].b + b.a) / 2),
		b: i === bands.length - 1 ? Math.min(limit, b.b) : Math.ceil((b.b + bands[i + 1].a) / 2),
	}));
}

/** Equal cols×rows of the source canvas. Metal gens are too dark for occupancy bands. */
function evenGridBands(src, cols, rows) {
	const colBands = [];
	const rowBands = [];
	for (let c = 0; c < cols; c++) {
		colBands.push({
			a: Math.round((c * src.width) / cols),
			b: Math.round(((c + 1) * src.width) / cols),
		});
	}
	for (let r = 0; r < rows; r++) {
		rowBands.push({
			a: Math.round((r * src.height) / rows),
			b: Math.round(((r + 1) * src.height) / rows),
		});
	}
	return { colBands, rowBands, how: `${cols}x${rows} even-grid` };
}

function findOccupancyBands(src, cols, rows) {
	const { width: w, height: h, data } = src;
	const colN = new Array(w).fill(0);
	const rowN = new Array(h).fill(0);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			if (isDepthBg(data[i], data[i + 1], data[i + 2], data[i + 3])) {
				continue;
			}
			colN[x] += 1;
			rowN[y] += 1;
		}
	}
	const colBands = occupancyBands(colN, Math.max(3, h * 0.008), 6);
	const rowBands = occupancyBands(rowN, Math.max(3, w * 0.006), 6);
	if (colBands.length !== cols || rowBands.length !== rows) {
		return null;
	}
	return {
		colBands: expandToGutters(colBands, w),
		rowBands: expandToGutters(rowBands, h),
		how: `${cols}x${rows} cell-bands`,
	};
}

function occupiedGridBox(src, cols, rows) {
	const bands = findOccupancyBands(src, cols, rows);
	if (!bands) {
		return null;
	}
	const { colBands, rowBands } = bands;
	return {
		x0: colBands[0].a,
		y0: rowBands[0].a,
		x1: colBands[colBands.length - 1].b,
		y1: rowBands[rowBands.length - 1].b,
		how: `${cols}x${rows} bands`,
	};
}

function largestComponentBox(png, isBg) {
	const { width: w, height: h, data } = png;
	const seen = new Uint8Array(w * h);
	let best = null;
	let bestN = 0;
	const qx = new Int32Array(w * h);
	const qy = new Int32Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i0 = y * w + x;
			if (seen[i0]) {
				continue;
			}
			const p = i0 * 4;
			if (isBg(data[p], data[p + 1], data[p + 2], data[p + 3])) {
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
				if (cx < x0) {
					x0 = cx;
				}
				if (cy < y0) {
					y0 = cy;
				}
				if (cx + 1 > x1) {
					x1 = cx + 1;
				}
				if (cy + 1 > y1) {
					y1 = cy + 1;
				}
				const nbr = [[1, 0], [-1, 0], [0, 1], [0, -1]];
				for (const [dx, dy] of nbr) {
					const nx = cx + dx;
					const ny = cy + dy;
					if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
						continue;
					}
					const ni = ny * w + nx;
					if (seen[ni]) {
						continue;
					}
					const np = ni * 4;
					if (isBg(data[np], data[np + 1], data[np + 2], data[np + 3])) {
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
				best = { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
			}
		}
	}
	return best;
}

function depthGenBox(src, layout, forceLetterbox = false) {
	if (!forceLetterbox) {
		const occupied = occupiedGridBox(src, layout.cols, layout.rows);
		if (occupied) {
			return occupied;
		}
	}
	const box = gridBox(src, layout.sheetW / layout.sheetH);
	return { ...box, how: 'letterbox' };
}

function cropAlbedoCell(sheet, cell) {
	const dst = emptyPng(cell.w, cell.h, KEY);
	for (let y = 0; y < cell.h; y++) {
		for (let x = 0; x < cell.w; x++) {
			const sx = cell.x + x;
			const sy = cell.y + y;
			if (sx < 0 || sy < 0 || sx >= sheet.width || sy >= sheet.height) {
				continue;
			}
			const si = (sy * sheet.width + sx) * 4;
			const di = (y * cell.w + x) * 4;
			dst.data[di] = sheet.data[si];
			dst.data[di + 1] = sheet.data[si + 1];
			dst.data[di + 2] = sheet.data[si + 2];
			dst.data[di + 3] = sheet.data[si + 3];
		}
	}
	return dst;
}

function cropBandCell(src, bands, cell, fill) {
	const cb = bands.colBands[cell.col];
	const rb = bands.rowBands[cell.row];
	if (!cb || !rb) {
		return null;
	}
	const dst = emptyPng(Math.max(1, cb.b - cb.a), Math.max(1, rb.b - rb.a), fill);
	for (let y = 0; y < dst.height; y++) {
		for (let x = 0; x < dst.width; x++) {
			const sx = cb.a + x;
			const sy = rb.a + y;
			if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) {
				continue;
			}
			const si = (sy * src.width + sx) * 4;
			const di = (y * dst.width + x) * 4;
			dst.data[di] = src.data[si];
			dst.data[di + 1] = src.data[si + 1];
			dst.data[di + 2] = src.data[si + 2];
			dst.data[di + 3] = src.data[si + 3];
		}
	}
	return dst;
}

function downLum(png, step, albedoMode) {
	const sw = Math.max(1, Math.floor(png.width / step));
	const sh = Math.max(1, Math.floor(png.height / step));
	const out = new Float32Array(sw * sh);
	for (let sy = 0; sy < sh; sy++) {
		for (let sx = 0; sx < sw; sx++) {
			let acc = 0;
			let n = 0;
			for (let y = sy * step; y < Math.min(png.height, (sy + 1) * step); y++) {
				for (let x = sx * step; x < Math.min(png.width, (sx + 1) * step); x++) {
					const i = (y * png.width + x) * 4;
					const r = png.data[i];
					const g = png.data[i + 1];
					const b = png.data[i + 2];
					const a = png.data[i + 3];
					if (albedoMode) {
						if (isKeyMag(r, g, b, a)) {
							continue;
						}
					} else if (a < 8) {
						continue;
					}
					acc += (r + g + b) / 3;
					n += 1;
				}
			}
			out[sy * sw + sx] = n ? acc / n : 0;
		}
	}
	return { lum: out, w: sw, h: sh };
}

function translateClip(src, albedo, dx, dy) {
	const w = albedo.width;
	const h = albedo.height;
	const dst = emptyPng(w, h, DEPTH_BG);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			if (isKeyMag(albedo.data[i], albedo.data[i + 1], albedo.data[i + 2], albedo.data[i + 3])) {
				continue;
			}
			const sx = x - dx;
			const sy = y - dy;
			if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) {
				continue;
			}
			const si = (sy * src.width + sx) * 4;
			dst.data[i] = src.data[si];
			dst.data[i + 1] = src.data[si + 1];
			dst.data[i + 2] = src.data[si + 2];
			dst.data[i + 3] = 255;
		}
	}
	return dst;
}

/** Integer search: content is sampled from (x-dx,y-dy), so +dx moves it right. */
function nudgeToAlbedo(src, albedo) {
	const step = 4;
	const a = downLum(albedo, step, true);
	const s = downLum(src, step, false);
	let bestDx = 0;
	let bestDy = 0;
	let best = -1;
	for (let dy = -8; dy <= 8; dy++) {
		for (let dx = 0; dx <= 28; dx++) {
			let score = 0;
			const dsx = Math.round(dx / step);
			const dsy = Math.round(dy / step);
			for (let y = 0; y < a.h; y++) {
				const sy = y - dsy;
				if (sy < 0 || sy >= s.h) {
					continue;
				}
				for (let x = 0; x < a.w; x++) {
					const al = a.lum[y * a.w + x];
					if (al <= 0) {
						continue;
					}
					const sx = x - dsx;
					if (sx < 0 || sx >= s.w) {
						continue;
					}
					const ml = s.lum[sy * s.w + sx];
					score += al * (ml > 40 ? ml * 4 : ml);
				}
			}
			if (score > best) {
				best = score;
				bestDx = dx;
				bestDy = dy;
			}
		}
	}
	if (bestDx === 0 && bestDy === 0) {
		return { png: src, dx: 0, dy: 0 };
	}
	return { png: translateClip(src, albedo, bestDx, bestDy), dx: bestDx, dy: bestDy };
}

/** Uniform height scale, horizontally centered in the albedo box. No independent X stretch. */
function mapUniformOntoAlbedo(src, srcBox, albedo, isBg) {
	const w = albedo.width;
	const h = albedo.height;
	const dst = emptyPng(w, h, DEPTH_BG);
	const aBox = figureBox(albedo, null);
	if (!aBox || !srcBox || srcBox.w < 2 || srcBox.h < 2) {
		return dst;
	}
	const scale = aBox.h / srcBox.h;
	const mappedW = srcBox.w * scale;
	const x0 = aBox.x0 + (aBox.w - mappedW) / 2;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const ai = (y * w + x) * 4;
			if (isKeyMag(albedo.data[ai], albedo.data[ai + 1], albedo.data[ai + 2], albedo.data[ai + 3])) {
				continue;
			}
			const fx = srcBox.x0 + ((x + 0.5 - x0) / scale) - 0.5;
			const fy = srcBox.y0 + ((y + 0.5 - aBox.y0) / scale) - 0.5;
			if (fx < srcBox.x0 - 1 || fy < srcBox.y0 - 1 || fx >= srcBox.x1 || fy >= srcBox.y1) {
				continue;
			}
			const [r, g, b, a] = sampleBilinear(src, fx, fy);
			if (isKeyMag(r, g, b, a) || a < 8) {
				continue;
			}
			if (isBg && isBg(r, g, b, a)) {
				continue;
			}
			dst.data[ai] = r;
			dst.data[ai + 1] = g;
			dst.data[ai + 2] = b;
			dst.data[ai + 3] = 255;
		}
	}
	return dst;
}

function mapMetalOntoAlbedo(src, srcBox, albedo) {
	return mapUniformOntoAlbedo(src, srcBox, albedo, null);
}

function mapBoxOntoAlbedo(src, srcBox, albedo, skipDepthBg) {
	const w = albedo.width;
	const h = albedo.height;
	const dst = emptyPng(w, h, DEPTH_BG);
	const aBox = figureBox(albedo, null);
	if (!aBox || !srcBox || srcBox.w < 2 || srcBox.h < 2) {
		return dst;
	}
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const ai = (y * w + x) * 4;
			if (isKeyMag(albedo.data[ai], albedo.data[ai + 1], albedo.data[ai + 2], albedo.data[ai + 3])) {
				continue;
			}
			const fx = srcBox.x0 + ((x + 0.5 - aBox.x0) * srcBox.w) / aBox.w - 0.5;
			const fy = srcBox.y0 + ((y + 0.5 - aBox.y0) * srcBox.h) / aBox.h - 0.5;
			if (fx < srcBox.x0 - 1 || fy < srcBox.y0 - 1 || fx >= srcBox.x1 || fy >= srcBox.y1) {
				continue;
			}
			const [r, g, b, a] = sampleBilinear(src, fx, fy);
			if (isKeyMag(r, g, b, a)) {
				continue;
			}
			if (skipDepthBg && isDepthBg(r, g, b, a)) {
				continue;
			}
			dst.data[ai] = r;
			dst.data[ai + 1] = g;
			dst.data[ai + 2] = b;
			dst.data[ai + 3] = 255;
		}
	}
	return dst;
}

function fitDepthCell(depth, albedo) {
	const dBox = largestComponentBox(depth, isMetalBg) ?? figureBox(depth, DEPTH_BG);
	return mapUniformOntoAlbedo(depth, dBox, albedo, isMetalBg);
}

function cropMapped(src, genBox, albBox, cell, fill) {
	const dst = emptyPng(cell.w, cell.h, fill);
	const aw = Math.max(1, albBox.x1 - albBox.x0);
	const ah = Math.max(1, albBox.y1 - albBox.y0);
	const gw = Math.max(1, genBox.x1 - genBox.x0);
	const gh = Math.max(1, genBox.y1 - genBox.y0);
	for (let yy = 0; yy < cell.h; yy++) {
		for (let xx = 0; xx < cell.w; xx++) {
			const fx = genBox.x0 + ((cell.x + xx + 0.5 - albBox.x0) * gw) / aw - 0.5;
			const fy = genBox.y0 + ((cell.y + yy + 0.5 - albBox.y0) * gh) / ah - 0.5;
			if (fx < genBox.x0 - 1 || fy < genBox.y0 - 1 || fx >= genBox.x1 || fy >= genBox.y1) {
				continue;
			}
			const [r, g, b, a] = sampleBilinear(src, fx, fy);
			if (isKeyMag(r, g, b, a)) {
				continue;
			}
			const i = (yy * cell.w + xx) * 4;
			dst.data[i] = r;
			dst.data[i + 1] = g;
			dst.data[i + 2] = b;
			dst.data[i + 3] = a;
		}
	}
	return dst;
}

function packCmd() {
	const dir = process.argv[3];
	const out = arg('--out');
	const jsonPath = arg('--json', out ? out.replace(/\.png$/i, '.json') : null);
	if (!dir || !out || !jsonPath) {
		throw new Error('pack DIR --out albedo.png --json layout.json');
	}
	const present = [];
	let cellW = 0;
	let cellH = 0;
	for (const stem of FRAMES) {
		const file = path.join(dir, `${stem}.png`);
		if (!fs.existsSync(file)) {
			continue;
		}
		const png = readPng(file);
		cellW = Math.max(cellW, png.width);
		cellH = Math.max(cellH, png.height);
		present.push({ stem, png });
	}
	if (!cellW || !cellH) {
		throw new Error(`no albedo frames in ${dir}`);
	}
	const rows = Math.ceil(present.length / COLS);
	const sheet = emptyPng(cellW * COLS, cellH * rows);
	const cells = [];
	const stems = present.map((p) => p.stem);
	for (let i = 0; i < present.length; i++) {
		const col = i % COLS;
		const row = Math.floor(i / COLS);
		const x = col * cellW;
		const y = row * cellH;
		const { stem, png } = present[i];
		const ox = x + Math.floor((cellW - png.width) / 2);
		const oy = y + (cellH - png.height);
		blit(sheet, png, ox, oy);
		cells.push({ stem, col, row, x, y, w: cellW, h: cellH, present: true });
	}
	writePng(out, sheet);
	const layout = {
		cols: COLS,
		rows,
		cellW,
		cellH,
		sheetW: sheet.width,
		sheetH: sheet.height,
		figureBox: contentBox(sheet),
		stems: stems.join(','),
		cells,
	};
	fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
	fs.writeFileSync(jsonPath, `${JSON.stringify(layout, null, '\t')}\n`);
	console.log(`pack ${out} ${sheet.width}x${sheet.height} ${cells.length}/${FRAMES.length} figures`);
}

function unpackSheet(file, jsonPath, suffix, out) {
	const layout = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
	const src = readPng(file);
	const fill = fillFor(suffix);
	const albBox = layout.figureBox
		?? (fs.existsSync(path.join(path.dirname(jsonPath), 'albedo.png'))
			? contentBox(readPng(path.join(path.dirname(jsonPath), 'albedo.png')))
			: { x0: 0, y0: 0, x1: layout.sheetW, y1: layout.sheetH });
	let genBox;
	let mapBox;
	if (suffix === '_d') {
		genBox = figureBox(src, DEPTH_BG) ?? gridBox(src, layout.sheetW / layout.sheetH);
		mapBox = albBox;
	} else {
		genBox = gridBox(src, layout.sheetW / layout.sheetH);
		mapBox = { x0: 0, y0: 0, x1: layout.sheetW, y1: layout.sheetH };
	}
	fs.mkdirSync(out, { recursive: true });
	let n = 0;
	for (const cell of layout.cells) {
		if (!cell.present) {
			continue;
		}
		writePng(path.join(out, `${cell.stem}${suffix}.png`), cropMapped(src, genBox, mapBox, cell, fill));
		n += 1;
	}
	return n;
}

function unpackCmd() {
	const file = process.argv[3];
	const jsonPath = arg('--json');
	const suffix = arg('--suffix');
	const out = arg('--out');
	if (!file || !jsonPath || !suffix || !out) {
		throw new Error('unpack SHEET.png --json layout.json --suffix _d|_n|_m --out DIR');
	}
	if (suffix !== '_d' && suffix !== '_n' && suffix !== '_m') {
		throw new Error('suffix must be _d or _n or _m');
	}
	const n = unpackSheet(file, jsonPath, suffix, out);
	console.log(`unpack ${n} ${suffix} cells -> ${out}`);
}

function fitDCmd() {
	const file = process.argv[3];
	const jsonPath = arg('--json');
	const out = arg('--out');
	const albSheetPath = arg('--albedo', jsonPath ? path.join(path.dirname(jsonPath), 'albedo.png') : null);
	const sheetOut = arg('--sheet');
	if (!file || !jsonPath || !out) {
		throw new Error('fit-d DEPTH.png --json layout.json --out DIR [--albedo albedo.png] [--sheet fitted_d.png] [--letterbox]');
	}
	if (!fs.existsSync(albSheetPath)) {
		throw new Error(`albedo stitch missing: ${albSheetPath}`);
	}
	const layout = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
	const src = readPng(file);
	const albSheet = readPng(albSheetPath);
	const bands = evenGridBands(src, layout.cols, layout.rows);
	fs.mkdirSync(out, { recursive: true });
	const fittedSheet = sheetOut ? emptyPng(layout.sheetW, layout.sheetH, DEPTH_BG) : null;
	let n = 0;
	for (const cell of layout.cells) {
		if (!cell.present) {
			continue;
		}
		const albPath = path.join(out, `${cell.stem}.png`);
		const albedo = fs.existsSync(albPath) ? readPng(albPath) : cropAlbedoCell(albSheet, cell);
		const sliced = cropBandCell(src, bands, cell, DEPTH_BG);
		const fitted = fitDepthCell(sliced, albedo);
		writePng(path.join(out, `${cell.stem}_d.png`), fitted);
		if (fittedSheet) {
			blit(fittedSheet, fitted, cell.x, cell.y);
		}
		n += 1;
	}
	if (fittedSheet) {
		writePng(sheetOut, fittedSheet);
	}
	console.log(`fit-d ${n} _d cells -> ${out} (${bands.how}+uniform)${sheetOut ? ` sheet ${sheetOut}` : ''}`);
}

function maskStampCell(src, albedo) {
	const w = albedo.width;
	const h = albedo.height;
	const dst = emptyPng(w, h, DEPTH_BG);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			if (isKeyMag(albedo.data[i], albedo.data[i + 1], albedo.data[i + 2], albedo.data[i + 3])) {
				continue;
			}
			const sx = Math.min(src.width - 1, Math.max(0, x));
			const sy = Math.min(src.height - 1, Math.max(0, y));
			const si = (sy * src.width + sx) * 4;
			const r = src.data[si];
			const g = src.data[si + 1];
			const b = src.data[si + 2];
			const a = src.data[si + 3];
			if (isKeyMag(r, g, b, a)) {
				continue;
			}
			dst.data[i] = r;
			dst.data[i + 1] = g;
			dst.data[i + 2] = b;
			dst.data[i + 3] = 255;
		}
	}
	return dst;
}

function fitMCmd() {
	const file = process.argv[3];
	const jsonPath = arg('--json');
	const out = arg('--out');
	const albSheetPath = arg('--albedo', jsonPath ? path.join(path.dirname(jsonPath), 'albedo.png') : null);
	const sheetOut = arg('--sheet');
	const depthPath = arg('--depth');
	if (!file || !jsonPath || !out) {
		throw new Error('fit-m METAL.png --json layout.json --out DIR [--albedo albedo.png] [--sheet fitted_m.png] [--depth DEPTH.png]');
	}
	if (!fs.existsSync(albSheetPath)) {
		throw new Error(`albedo stitch missing: ${albSheetPath}`);
	}
	const layout = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
	const src = readPng(file);
	const albSheet = readPng(albSheetPath);
	void depthPath;
	const bands = evenGridBands(src, layout.cols, layout.rows);
	fs.mkdirSync(out, { recursive: true });
	const fittedSheet = sheetOut ? emptyPng(layout.sheetW, layout.sheetH, DEPTH_BG) : null;
	let n = 0;
	let nudgedN = 0;
	for (const cell of layout.cells) {
		if (!cell.present) {
			continue;
		}
		const albPath = path.join(out, `${cell.stem}.png`);
		const albedo = fs.existsSync(albPath) ? readPng(albPath) : cropAlbedoCell(albSheet, cell);
		const sliced = cropBandCell(src, bands, cell, DEPTH_BG);
		const mBox = largestComponentBox(sliced, isMetalBg) ?? {
			x0: 0, y0: 0, x1: sliced.width, y1: sliced.height, w: sliced.width, h: sliced.height,
		};
		let fitted = mapMetalOntoAlbedo(sliced, mBox, albedo);
		const nudged = nudgeToAlbedo(fitted, albedo);
		fitted = nudged.png;
		if (nudged.dx || nudged.dy) {
			nudgedN += 1;
			console.log(`  ${cell.stem} metal +${nudged.dx}x ${nudged.dy >= 0 ? '+' : ''}${nudged.dy}y`);
		}
		writePng(path.join(out, `${cell.stem}_m.png`), fitted);
		if (fittedSheet) {
			blit(fittedSheet, fitted, cell.x, cell.y);
		}
		n += 1;
	}
	if (fittedSheet) {
		writePng(sheetOut, fittedSheet);
	}
	console.log(`fit-m ${n} _m cells -> ${out} (${bands.how}+metal-box+nudge, nudged ${nudgedN})${sheetOut ? ` sheet ${sheetOut}` : ''}`);
}

const OUTLINE_LUM = 0.18;
const SHINE_DEFAULT = 128;

function bakeMetalCell(albedo, shine) {
	const w = albedo.width;
	const h = albedo.height;
	const dst = emptyPng(w, h, DEPTH_BG);
	for (let i = 0; i < albedo.data.length; i += 4) {
		const r = albedo.data[i];
		const g = albedo.data[i + 1];
		const b = albedo.data[i + 2];
		const a = albedo.data[i + 3];
		if (isKeyMag(r, g, b, a)) {
			continue;
		}
		if ((r + g + b) / 765 < OUTLINE_LUM) {
			continue;
		}
		dst.data[i] = shine;
		dst.data[i + 1] = shine;
		dst.data[i + 2] = shine;
		dst.data[i + 3] = 255;
	}
	return dst;
}

function bakeMCmd() {
	const dir = process.argv[3];
	const shine = Number(arg('--shine', String(SHINE_DEFAULT)));
	const sheetOut = arg('--sheet');
	if (!dir) {
		throw new Error('bake-m DIR [--shine 128] [--sheet fitted_m.png]');
	}
	if (!Number.isFinite(shine) || shine < 0 || shine > 255) {
		throw new Error('--shine must be 0..255');
	}
	const stems = FRAMES.filter((stem) => fs.existsSync(path.join(dir, `${stem}.png`)));
	if (!stems.length) {
		throw new Error(`no albedo frames in ${dir}`);
	}
	let n = 0;
	let fittedSheet = null;
	for (const stem of stems) {
		const albedo = readPng(path.join(dir, `${stem}.png`));
		const fitted = bakeMetalCell(albedo, shine);
		writePng(path.join(dir, `${stem}_m.png`), fitted);
		if (sheetOut) {
			if (!fittedSheet) {
				const cols = COLS;
				const rows = Math.ceil(stems.length / cols);
				fittedSheet = emptyPng(cols * albedo.width, rows * albedo.height, DEPTH_BG);
			}
			const idx = stems.indexOf(stem);
			const col = idx % COLS;
			const row = Math.floor(idx / COLS);
			blit(fittedSheet, fitted, col * albedo.width, row * albedo.height);
		}
		n += 1;
	}
	if (fittedSheet && sheetOut) {
		writePng(sheetOut, fittedSheet);
	}
	console.log(`bake-m ${n} _m cells -> ${dir} shine ${shine}${sheetOut ? ` sheet ${sheetOut}` : ''}`);
}

function flipXN(src) {
	const dst = emptyPng(src.width, src.height, FLAT_N);
	for (let y = 0; y < src.height; y++) {
		for (let x = 0; x < src.width; x++) {
			const si = (y * src.width + x) * 4;
			const r = src.data[si];
			const g = src.data[si + 1];
			const b = src.data[si + 2];
			const a = src.data[si + 3];
			const di = (y * src.width + (src.width - 1 - x)) * 4;
			if (isKeyMag(r, g, b, a)) {
				continue;
			}
			dst.data[di] = 255 - r;
			dst.data[di + 1] = g;
			dst.data[di + 2] = b;
			dst.data[di + 3] = a;
		}
	}
	return dst;
}

function flipXNCmd() {
	const file = process.argv[3];
	const out = arg('--out', file.replace(/\.png$/i, '_flipx.png'));
	if (!file) {
		throw new Error('flipx-n SRC.png --out DST.png');
	}
	writePng(out, flipXN(readPng(file)));
	console.log('flipx-n', out);
}

function figureBox(png, skipFill) {
	const { width: w, height: h, data } = png;
	let x0 = w;
	let y0 = h;
	let x1 = 0;
	let y1 = 0;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			const r = data[i];
			const g = data[i + 1];
			const b = data[i + 2];
			const a = data[i + 3];
			if (isKeyMag(r, g, b, a)) {
				continue;
			}
			if (skipFill) {
				const dr = Math.abs(r - skipFill[0]) + Math.abs(g - skipFill[1]) + Math.abs(b - skipFill[2]);
				if (dr < 18) {
					continue;
				}
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
		return null;
	}
	return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

function magCount(png) {
	const { data } = png;
	let n = 0;
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < 8) {
			continue;
		}
		if (magDist(data[i], data[i + 1], data[i + 2]) < 48) {
			n += 1;
		}
	}
	return n;
}

function nearFill(r, g, b, fill) {
	return Math.abs(r - fill[0]) + Math.abs(g - fill[1]) + Math.abs(b - fill[2]) < 24;
}

function albOpaque(alb, x, y) {
	if (x < 0 || y < 0 || x >= alb.width || y >= alb.height) {
		return false;
	}
	const i = (y * alb.width + x) * 4;
	return !isKeyMag(alb.data[i], alb.data[i + 1], alb.data[i + 2], alb.data[i + 3]);
}

function dilateOpaque(alb, x, y, r) {
	for (let dy = -r; dy <= r; dy++) {
		for (let dx = -r; dx <= r; dx++) {
			if (albOpaque(alb, x + dx, y + dy)) {
				return true;
			}
		}
	}
	return false;
}

function checkStemMaps(dir, stem) {
	const albPath = path.join(dir, `${stem}.png`);
	const dPath = path.join(dir, `${stem}_d.png`);
	const nPath = path.join(dir, `${stem}_n.png`);
	const mPath = path.join(dir, `${stem}_m.png`);
	if (!fs.existsSync(albPath)) {
		return [];
	}
	if (!fs.existsSync(dPath) && !fs.existsSync(nPath) && !fs.existsSync(mPath)) {
		return [];
	}
	const alb = readPng(albPath);
	const albBox = figureBox(alb, null);
	const fails = [];
	const checkLayer = (file, suffix) => {
		if (!fs.existsSync(file)) {
			fails.push(`${stem}${suffix} missing`);
			return;
		}
		const png = readPng(file);
		const fill = fillFor(suffix);
		if (png.width !== alb.width || png.height !== alb.height) {
			fails.push(`${stem}${suffix} ${png.width}x${png.height} vs albedo ${alb.width}x${alb.height}`);
		}
		const mag = magCount(png);
		if (mag) {
			fails.push(`${stem}${suffix} magenta ${mag}`);
		}
		const box = figureBox(png, fill);
		if (suffix === '_d' && albBox && box) {
			const dx = box.x0 - albBox.x0;
			const dy = box.y0 - albBox.y0;
			if (Math.abs(dx) > OFFSET_MAX || Math.abs(dy) > OFFSET_MAX) {
				fails.push(`${stem}${suffix} offset ${dx},${dy} (max ${OFFSET_MAX})`);
			}
		}
		if (suffix === '_n' && albBox) {
			let ax = 0;
			let ay = 0;
			let an = 0;
			let nx = 0;
			let ny = 0;
			let nn = 0;
			for (let y = 0; y < png.height; y++) {
				for (let x = 0; x < png.width; x++) {
					if (albOpaque(alb, x, y)) {
						ax += x;
						ay += y;
						an += 1;
					}
					const i = (y * png.width + x) * 4;
					if (albOpaque(alb, x, y) && !nearFill(png.data[i], png.data[i + 1], png.data[i + 2], fill)) {
						nx += x;
						ny += y;
						nn += 1;
					}
				}
			}
			if (an && nn) {
				const dx = Math.round(nx / nn - ax / an);
				const dy = Math.round(ny / nn - ay / an);
				if (Math.abs(dx) > OFFSET_MAX || Math.abs(dy) > OFFSET_MAX) {
					fails.push(`${stem}${suffix} offset ${dx},${dy} (max ${OFFSET_MAX})`);
				}
			}
		}
		let leak = 0;
		let off = 0;
		for (let y = 0; y < png.height; y++) {
			for (let x = 0; x < png.width; x++) {
				const i = (y * png.width + x) * 4;
				const figure = dilateOpaque(alb, x, y, suffix === '_n' ? 8 : 2);
				const filled = nearFill(png.data[i], png.data[i + 1], png.data[i + 2], fill);
				if (!figure) {
					off += 1;
					if (!filled) {
						leak += 1;
					}
				}
			}
		}
		if (off && leak / off > (suffix === '_n' ? 0.04 : 0.06)) {
			fails.push(`${stem}${suffix} bg leak ${(100 * leak / off).toFixed(1)}% (want ${suffix === '_n' ? '#8080FF' : 'black'})`);
		}
	};
	if (fs.existsSync(dPath)) {
		checkLayer(dPath, '_d');
	}
	if (fs.existsSync(nPath)) {
		checkLayer(nPath, '_n');
	}
	if (fs.existsSync(mPath)) {
		checkLayer(mPath, '_m');
	}
	return fails;
}

function checkCmd() {
	const dir = process.argv[3];
	if (!dir) {
		throw new Error('check DIR');
	}
	const stems = FRAMES.filter((stem) => fs.existsSync(path.join(dir, `${stem}.png`)));
	const mapped = stems.filter((stem) => (
		fs.existsSync(path.join(dir, `${stem}_d.png`))
		|| fs.existsSync(path.join(dir, `${stem}_n.png`))
		|| fs.existsSync(path.join(dir, `${stem}_m.png`))
	));
	if (!mapped.length) {
		console.log(`check-maps ${dir} skip (no _d/_n/_m)`);
		return;
	}
	let bad = 0;
	for (const stem of mapped) {
		const fails = checkStemMaps(dir, stem);
		if (fails.length) {
			bad += fails.length;
			console.log(`${stem} FAIL ${fails.join('; ')}`);
		} else {
			console.log(`${stem} maps ok`);
		}
	}
	console.log(bad ? `FAIL ${bad} map problems` : `OK ${mapped.length} map stems`);
	if (bad) {
		process.exitCode = 1;
	}
}

function paintRect(png, x, y, w, h, rgba) {
	for (let yy = 0; yy < h; yy++) {
		for (let xx = 0; xx < w; xx++) {
			const px = x + xx;
			const py = y + yy;
			if (px < 0 || py < 0 || px >= png.width || py >= png.height) {
				continue;
			}
			const i = (py * png.width + px) * 4;
			png.data[i] = rgba[0];
			png.data[i + 1] = rgba[1];
			png.data[i + 2] = rgba[2];
			png.data[i + 3] = rgba[3];
		}
	}
}

function scaleHalf(src) {
	const dst = emptyPng(Math.floor(src.width / 2), Math.floor(src.height / 2), KEY);
	for (let y = 0; y < dst.height; y++) {
		for (let x = 0; x < dst.width; x++) {
			const si = ((y * 2) * src.width + (x * 2)) * 4;
			const di = (y * dst.width + x) * 4;
			dst.data[di] = src.data[si];
			dst.data[di + 1] = src.data[si + 1];
			dst.data[di + 2] = src.data[si + 2];
			dst.data[di + 3] = src.data[si + 3];
		}
	}
	return dst;
}

function selftestCmd() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maps-sheet-'));
	const cell = emptyPng(64, 80, KEY);
	paintRect(cell, 18, 6, 28, 68, [200, 200, 200, 255]);
	writePng(path.join(root, 'idle_06.png'), cell);
	const maps = path.join(root, 'maps');
	const albOut = path.join(maps, 'albedo.png');
	const jsonPath = path.join(maps, 'layout.json');
	process.argv = ['node', 'maps-sheet.mjs', 'pack', root, '--out', albOut, '--json', jsonPath];
	packCmd();
	const alb = readPng(albOut);
	const half = scaleHalf(alb);
	const dSheet = emptyPng(half.width, half.height, KEY);
	const nSheet = emptyPng(half.width, half.height, KEY);
	for (let i = 0; i < half.data.length; i += 4) {
		if (isKeyMag(half.data[i], half.data[i + 1], half.data[i + 2], half.data[i + 3])) {
			continue;
		}
		dSheet.data[i] = 180;
		dSheet.data[i + 1] = 180;
		dSheet.data[i + 2] = 180;
		dSheet.data[i + 3] = 255;
		nSheet.data[i] = 90;
		nSheet.data[i + 1] = 140;
		nSheet.data[i + 2] = 230;
		nSheet.data[i + 3] = 255;
	}
	const dPath = path.join(maps, 'gen_d.png');
	const nPath = path.join(maps, 'gen_n.png');
	writePng(dPath, dSheet);
	writePng(nPath, nSheet);
	process.argv = ['node', 'maps-sheet.mjs', 'fit-d', dPath, '--json', jsonPath, '--albedo', albOut, '--out', root];
	fitDCmd();
	unpackSheet(nPath, jsonPath, '_n', root);
	process.argv = ['node', 'maps-sheet.mjs', 'check', root];
	checkCmd();
	const ok = process.exitCode ? 0 : 1;
	fs.rmSync(root, { recursive: true, force: true });
	if (!ok) {
		console.log('selftest FAIL');
		process.exitCode = 1;
		return;
	}
	console.log('selftest OK');
}

const cmd = process.argv[2];
if (cmd === 'pack') {
	packCmd();
} else if (cmd === 'unpack') {
	unpackCmd();
} else if (cmd === 'fit-d') {
	fitDCmd();
} else if (cmd === 'fit-m' || cmd === 'fit-r') {
	fitMCmd();
} else if (cmd === 'bake-m') {
	bakeMCmd();
} else if (cmd === 'flipx-n') {
	flipXNCmd();
} else if (cmd === 'check') {
	checkCmd();
} else if (cmd === 'selftest') {
	selftestCmd();
} else {
	console.error('usage: pack|unpack|fit-d|fit-m|bake-m|flipx-n|check|selftest');
	process.exit(1);
}
