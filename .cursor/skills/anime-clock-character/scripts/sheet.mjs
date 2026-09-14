#!/usr/bin/env node
/**
 * Magenta-key sprite sheets and fit each figure into a 3:4 canvas without stretching.
 *
 *   node sheet.mjs slice SHEET.png --cols C --rows R --stems a,b --out DIR
 *   node sheet.mjs fit FILE.png --out FILE.png [--allow-lowres]
 *   node sheet.mjs inspect SHEET.png --cols C --rows R --stems a,b
 *   node sheet.mjs check DIR --clip idle|walk|take|all
 *   node sheet.mjs check-guides
 *   node sheet.mjs lock-head DIR walk_04
 *   node sheet.mjs replace SHEET.png --cols C --rows R --index I --cell CELL.png --out SHEET.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const gamePkg = path.join(repo, 'game', 'package.json');
const { PNG } = createRequire(gamePkg)('pngjs');

const KEY = [255, 0, 255];
const HARD = 80;
/** Magenta/pink leftover from AA against the key. Skin (#fbd9c0) and red lips do not match. */
const CANVAS_W = 384;
const CANVAS_H = 512;
const MARGIN = 16;
/** Fitted figure bbox width/height. True 50° profile ~0.29; needles ~0.19; fat walk ~1.50. */
const ASPECT_MIN = 0.28;
const ASPECT_MAX = 0.85;
/** Front idle lock must be a person, not a needle. */
const LOCK_ASPECT_MIN = 0.45;
const ASPECT_SPREAD = 0.30;
const MIN_OPAQUE = 10000;
/** Fitted figure must fill the card vertically. A wide hat that shrinks the body fails this. */
const FILL_H_MIN = 0.90;
/** GenerateImage must land at least this big. Smaller is a low-res fail — regen, do not upscale. */
const SRC_MIN_W = 768;
const SRC_MIN_H = 1024;
/** vs matching pose guide: extra opaque mass in the lower 45% of the bbox (long eye-level legs). */
const TILT_BOT_MAX = 0.05;
/** vs matching pose guide: opaque y-centroid shifted down (camera stood up). */
const TILT_YCENT_MAX = 0.03;
const GUIDES_DIR = path.resolve(here, '../guides');

/** idle_02 = 1:30 (45° from 12); idle_04 = 4:30 (135° from 12). idle_01/05 unused by facing. */
const CLIPS = {
	idle: [
		'idle_01', 'idle_02', 'idle_03', 'idle_04', 'idle_05', 'idle_06',
		'idle_08', 'idle_09', 'idle_10', 'idle_12',
	],
	walk: [12, 2, 3, 4, 6, 8, 9, 10].flatMap((hour) => {
		const tag = String(hour).padStart(2, '0');
		return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `walk_${tag}_${i}`);
	}),
	take: [
		'take_06_0', 'take_06_1', 'take_06_2', 'take_06_3',
		'take_06_4', 'take_06_5', 'take_06_6', 'take_06_7',
	],
};
CLIPS.all = [...CLIPS.idle, ...CLIPS.walk, ...CLIPS.take];
/** No mannequin cel yet — do not fail check-guides, and do not fill with a generated dummy. */
const OPTIONAL_GUIDES = new Set(['idle_01', 'idle_05']);

function optionalGuide(stem) {
	return OPTIONAL_GUIDES.has(stem);
}

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

function emptyPng(w, h) {
	const png = new PNG({ width: w, height: h, colorType: 6 });
	png.data.fill(0);
	return png;
}

function fillPng(w, h, rgba) {
	const png = emptyPng(w, h);
	const [r, g, b, a] = rgba;
	for (let i = 0; i < png.data.length; i += 4) {
		png.data[i] = r;
		png.data[i + 1] = g;
		png.data[i + 2] = b;
		png.data[i + 3] = a;
	}
	return png;
}

function blitShift(src, ox, oy, fill) {
	const dst = fill ? fillPng(src.width, src.height, fill) : emptyPng(src.width, src.height);
	for (let y = 0; y < src.height; y++) {
		const ty = y + oy;
		if (ty < 0 || ty >= src.height) {
			continue;
		}
		for (let x = 0; x < src.width; x++) {
			const tx = x + ox;
			if (tx < 0 || tx >= src.width) {
				continue;
			}
			const si = (y * src.width + x) * 4;
			if (!fill && src.data[si + 3] < 1) {
				continue;
			}
			const di = (ty * src.width + tx) * 4;
			dst.data[di] = src.data[si];
			dst.data[di + 1] = src.data[si + 1];
			dst.data[di + 2] = src.data[si + 2];
			dst.data[di + 3] = src.data[si + 3];
		}
	}
	return dst;
}

function keyDist(d, i) {
	return Math.abs(d[i] - KEY[0]) + Math.abs(d[i + 1] - KEY[1]) + Math.abs(d[i + 2] - KEY[2]);
}

function magSpill(r, g, b) {
	const mag = Math.min(r, b);
	return mag > g + 8 && (r + b - 2 * g) > 16;
}

/** Weaker magenta tint — used on silhouette edges (near-black purple fringe). */
function magBias(r, g, b) {
	return Math.min(r, b) > g + 2 && (r + b - 2 * g) > 6;
}

function isMagenta(d, i) {
	if (d[i + 3] < 16) {
		return true;
	}
	if (keyDist(d, i) < HARD) {
		return true;
	}
	const r = d[i];
	const g = d[i + 1];
	const b = d[i + 2];
	return r > 190 && b > 190 && g < 110 && r + b - 2 * g > 200;
}

function floodKey(png) {
	const { width: w, height: h, data } = png;
	const n = w * h;
	const bg = new Uint8Array(n);
	const qx = new Int32Array(n);
	const qy = new Int32Array(n);
	let qt = 0;
	const push = (x, y) => {
		if (x < 0 || y < 0 || x >= w || y >= h) {
			return;
		}
		const id = y * w + x;
		if (bg[id]) {
			return;
		}
		if (!isMagenta(data, id * 4)) {
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
	for (let i = 0; i < n; i++) {
		if (bg[i] || isMagenta(data, i * 4)) {
			data[i * 4] = 0;
			data[i * 4 + 1] = 0;
			data[i * 4 + 2] = 0;
			data[i * 4 + 3] = 0;
		}
	}
}

function magHalo(png) {
	const { width: w, height: h, data } = png;
	const alpha = (x, y) => {
		if (x < 0 || y < 0 || x >= w || y >= h) {
			return 0;
		}
		return data[(y * w + x) * 4 + 3];
	};
	let n = 0;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			if (data[i + 3] < 16) {
				continue;
			}
			const r = data[i];
			const g = data[i + 1];
			const b = data[i + 2];
			if (magSpill(r, g, b)) {
				n += 1;
				continue;
			}
			const edge = alpha(x - 1, y) < 16 || alpha(x + 1, y) < 16
				|| alpha(x, y - 1) < 16 || alpha(x, y + 1) < 16;
			if (edge && magBias(r, g, b)) {
				n += 1;
			}
		}
	}
	return n;
}

/** Neutralize magenta AA on the silhouette; strip magenta from leftover interior outlines. */
function despill(png) {
	const { width: w, height: h, data } = png;
	const alpha = (x, y) => {
		if (x < 0 || y < 0 || x >= w || y >= h) {
			return 0;
		}
		return data[(y * w + x) * 4 + 3];
	};
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			if (data[i + 3] < 16) {
				continue;
			}
			const edge = alpha(x - 1, y) < 16 || alpha(x + 1, y) < 16
				|| alpha(x, y - 1) < 16 || alpha(x, y + 1) < 16;
			if (!edge) {
				continue;
			}
			const r = data[i];
			const g = data[i + 1];
			const b = data[i + 2];
			if (!magBias(r, g, b) && !magSpill(r, g, b)) {
				continue;
			}
			data[i] = g;
			data[i + 2] = g;
		}
	}
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < 16) {
			continue;
		}
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];
		if (!magSpill(r, g, b)) {
			continue;
		}
		const spill = Math.min(r, b) - g;
		data[i] = Math.max(0, r - spill);
		data[i + 2] = Math.max(0, b - spill);
	}
}

function copyRect(src, x, y, w, h) {
	const dst = emptyPng(w, h);
	for (let yy = 0; yy < h; yy++) {
		for (let xx = 0; xx < w; xx++) {
			const si = ((y + yy) * src.width + (x + xx)) * 4;
			const di = (yy * w + xx) * 4;
			dst.data[di] = src.data[si];
			dst.data[di + 1] = src.data[si + 1];
			dst.data[di + 2] = src.data[si + 2];
			dst.data[di + 3] = src.data[si + 3];
		}
	}
	return dst;
}

function cellRect(sheet, col, row, cols, rows) {
	const cw = Math.floor(sheet.width / cols);
	const ch = Math.floor(sheet.height / rows);
	return { x: col * cw, y: row * ch, w: cw, h: ch };
}

/** Opaque 4-connected components. Used to drop leaked idle-frame bars. */
function opaqueComponents(png) {
	const { width: w, height: h, data } = png;
	const n = w * h;
	const seen = new Uint8Array(n);
	const comps = [];
	const qx = new Int32Array(n);
	const qy = new Int32Array(n);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const start = y * w + x;
			if (seen[start] || data[start * 4 + 3] < 16) {
				continue;
			}
			let qt = 0;
			let qh = 0;
			qx[qt] = x;
			qy[qt] = y;
			qt += 1;
			seen[start] = 1;
			let x0 = x;
			let y0 = y;
			let x1 = x;
			let y1 = y;
			let count = 0;
			while (qh < qt) {
				const cx = qx[qh];
				const cy = qy[qh];
				qh += 1;
				count += 1;
				if (cx < x0) {
					x0 = cx;
				}
				if (cy < y0) {
					y0 = cy;
				}
				if (cx > x1) {
					x1 = cx;
				}
				if (cy > y1) {
					y1 = cy;
				}
				const nbr = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
				for (const [nx, ny] of nbr) {
					if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
						continue;
					}
					const id = ny * w + nx;
					if (seen[id] || data[id * 4 + 3] < 16) {
						continue;
					}
					seen[id] = 1;
					qx[qt] = nx;
					qy[qt] = ny;
					qt += 1;
				}
			}
			comps.push({ x0, y0, x1, y1, n: count });
		}
	}
	return comps;
}

/**
 * The framed idle sits in top-left of a 3×3. GenerateImage often copies its
 * white frame into the cell below (`walk_HH_2` / `take_06_2`) as a thin bar.
 * `fit` then treats that bar as figure, so bbox is card-wide and uniform
 * scale shrinks the character. Drop those orphan strips; they are not the body.
 */
function keyOrphanEdgeBars(png) {
	const { width: w, height: h, data } = png;
	const comps = opaqueComponents(png);
	if (comps.length < 2) {
		return 0;
	}
	let largestN = 0;
	for (const c of comps) {
		if (c.n > largestN) {
			largestN = c.n;
		}
	}
	const kill = new Uint8Array(w * h);
	let keyed = 0;
	for (const c of comps) {
		if (c.n >= largestN || c.n < 40) {
			continue;
		}
		const cw = c.x1 - c.x0 + 1;
		const ch = c.y1 - c.y0 + 1;
		const wideThin = cw > w * 0.4 && ch < h * 0.08;
		const tallThin = ch > h * 0.4 && cw < w * 0.08;
		const nearTop = c.y0 < h * 0.12;
		const nearLeft = c.x0 < w * 0.08;
		const nearRight = c.x1 > w * 0.92;
		if (!(wideThin && nearTop) && !(tallThin && (nearLeft || nearRight))) {
			continue;
		}
		for (let y = c.y0; y <= c.y1; y++) {
			for (let x = c.x0; x <= c.x1; x++) {
				const id = y * w + x;
				if (data[id * 4 + 3] < 16) {
					continue;
				}
				kill[id] = 1;
			}
		}
	}
	for (let i = 0; i < kill.length; i++) {
		if (!kill[i]) {
			continue;
		}
		data[i * 4] = 0;
		data[i * 4 + 1] = 0;
		data[i * 4 + 2] = 0;
		data[i * 4 + 3] = 0;
		keyed += 1;
	}
	return keyed;
}

function bbox(png) {
	let x0 = png.width;
	let y0 = png.height;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < png.height; y++) {
		for (let x = 0; x < png.width; x++) {
			const i = (y * png.width + x) * 4;
			if (png.data[i + 3] < 16) {
				continue;
			}
			if (x < x0) {
				x0 = x;
			}
			if (y < y0) {
				y0 = y;
			}
			if (x > x1) {
				x1 = x;
			}
			if (y > y1) {
				y1 = y;
			}
		}
	}
	if (x1 < x0) {
		return null;
	}
	return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function sample(png, x, y) {
	const ix = Math.max(0, Math.min(png.width - 1, x));
	const iy = Math.max(0, Math.min(png.height - 1, y));
	const x0 = Math.floor(ix);
	const y0 = Math.floor(iy);
	const x1 = Math.min(png.width - 1, x0 + 1);
	const y1 = Math.min(png.height - 1, y0 + 1);
	const fx = ix - x0;
	const fy = iy - y0;
	const p = (xx, yy) => (yy * png.width + xx) * 4;
	let r = 0;
	let g = 0;
	let b = 0;
	let a = 0;
	const w00 = (1 - fx) * (1 - fy);
	const w10 = fx * (1 - fy);
	const w01 = (1 - fx) * fy;
	const w11 = fx * fy;
	for (const [i, wt] of [[p(x0, y0), w00], [p(x1, y0), w10], [p(x0, y1), w01], [p(x1, y1), w11]]) {
		const aa = png.data[i + 3] / 255;
		if (aa < 0.06) {
			continue;
		}
		r += png.data[i] * aa * wt;
		g += png.data[i + 1] * aa * wt;
		b += png.data[i + 2] * aa * wt;
		a += aa * wt;
	}
	if (a < 0.02) {
		return [0, 0, 0, 0];
	}
	return [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a * 255)];
}

function scaleUniform(src, dw, dh) {
	const out = emptyPng(dw, dh);
	if (dw < 1 || dh < 1 || src.width < 1 || src.height < 1) {
		return out;
	}
	const sx = src.width / dw;
	const sy = src.height / dh;
	for (let y = 0; y < dh; y++) {
		for (let x = 0; x < dw; x++) {
			const px = sample(src, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5);
			const i = (y * dw + x) * 4;
			out.data[i] = px[0];
			out.data[i + 1] = px[1];
			out.data[i + 2] = px[2];
			out.data[i + 3] = px[3];
		}
	}
	return out;
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
			if (src.data[si + 3] < 16) {
				continue;
			}
			const di = (ty * dst.width + tx) * 4;
			dst.data[di] = src.data[si];
			dst.data[di + 1] = src.data[si + 1];
			dst.data[di + 2] = src.data[si + 2];
			dst.data[di + 3] = src.data[si + 3];
		}
	}
}

/** Uniform scale into a 3:4 canvas. Never stretch. Feet on the bottom margin. */
function fitCanvas(src, allowLow = false) {
	const keyed = copyRect(src, 0, 0, src.width, src.height);
	floodKey(keyed);
	const nBar = keyOrphanEdgeBars(keyed);
	despill(keyed);
	const box = bbox(keyed);
	if (!box) {
		return emptyPng(CANVAS_W, CANVAS_H);
	}
	const pad = Math.max(2, Math.round(Math.max(box.w, box.h) * 0.04));
	const x = Math.max(0, box.x - pad);
	const y = Math.max(0, box.y - pad);
	const w = Math.min(keyed.width - x, box.w + pad * 2);
	const h = Math.min(keyed.height - y, box.h + pad * 2);
	const cropped = copyRect(keyed, x, y, w, h);
	const innerW = CANVAS_W - MARGIN * 2;
	const innerH = CANVAS_H - MARGIN * 2;
	let s = Math.min(innerW / cropped.width, innerH / cropped.height);
	const destSized = src.width === CANVAS_W && src.height === CANVAS_H;
	if (s > 1.02) {
		// Dest-size re-fit after stripping a leaked frame bar (walk_HH_2). Modest upscale only.
		if (nBar > 0 && destSized && s <= 1.25) {
			// keep s
		} else if (!allowLow) {
			throw new Error(
				`upscale ${cropped.width}x${cropped.height} -> ${CANVAS_W}x${CANVAS_H} (src too small; regen at ≥${SRC_MIN_W}x${SRC_MIN_H})`,
			);
		} else {
			// Strip cells are already dest size. Do not 4× nearest — pad instead of inventing pixels.
			s = 1;
		}
	}
	const dw = Math.max(1, Math.round(cropped.width * s));
	const dh = Math.max(1, Math.round(cropped.height * s));
	const scaled = scaleUniform(cropped, dw, dh);
	despill(scaled);
	const out = emptyPng(CANVAS_W, CANVAS_H);
	const ox = Math.floor((CANVAS_W - dw) / 2);
	const oy = CANVAS_H - MARGIN - dh;
	blit(out, scaled, ox, oy);
	despill(out);
	return out;
}

function extractCell(sheet, col, row, cols, rows) {
	const { x, y, w, h } = cellRect(sheet, col, row, cols, rows);
	return fitCanvas(copyRect(sheet, x, y, w, h));
}

function sliceCmd() {
	const file = process.argv[3];
	const cols = Number(arg('--cols'));
	const rows = Number(arg('--rows'));
	const stems = arg('--stems', '').split(',').map((s) => s.trim()).filter(Boolean);
	const out = arg('--out');
	if (!file || !cols || !rows || !out || stems.length !== cols * rows) {
		throw new Error('slice SHEET.png --cols C --rows R --stems a,b,... --out DIR');
	}
	const sheet = readPng(file);
	fs.mkdirSync(out, { recursive: true });
	for (let i = 0; i < stems.length; i++) {
		if (stems[i].startsWith('_')) {
			continue;
		}
		const col = i % cols;
		const row = Math.floor(i / cols);
		const cell = extractCell(sheet, col, row, cols, rows);
		const dest = path.join(out, `${stems[i]}.png`);
		writePng(dest, cell);
		const box = bbox(cell);
		const aspect = box ? (box.w / box.h).toFixed(3) : 'empty';
		console.log(`${stems[i]} ${cell.width}x${cell.height} bboxA=${aspect}`);
	}
}

function fitCmd() {
	const file = process.argv[3];
	const out = arg('--out', file);
	if (!file) {
		throw new Error('fit FILE.png --out FILE.png');
	}
	const src = readPng(file);
	const allowLow = process.argv.includes('--allow-lowres');
	const destSized = src.width === CANVAS_W && src.height === CANVAS_H;
	if (!allowLow && !destSized && (src.width < SRC_MIN_W || src.height < SRC_MIN_H)) {
		console.log(`fit ${file} FAIL src ${src.width}x${src.height} < ${SRC_MIN_W}x${SRC_MIN_H} (low-res — regen)`);
		process.exitCode = 1;
		return;
	}
	let cell;
	try {
		cell = fitCanvas(src, allowLow);
	} catch (err) {
		console.log(`fit ${file} FAIL ${err instanceof Error ? err.message : err}`);
		process.exitCode = 1;
		return;
	}
	writePng(out, cell);
	const box = bbox(cell);
	const halo = magHalo(cell);
	console.log(`fit ${out} bbox ${box ? box.w + 'x' + box.h : 'empty'} A=${box ? (box.w / box.h).toFixed(3) : '-'} magHalo=${halo}`);
	if (halo) {
		process.exitCode = 1;
	}
}

function lockHeadCmd() {
	const dir = process.argv[3];
	const prefix = process.argv[4];
	if (!dir || !prefix) {
		throw new Error('lock-head DIR walk_04');
	}
	const files = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => path.join(dir, `${prefix}_${i}.png`));
	const frames = files.map((file) => {
		if (!fs.existsSync(file)) {
			throw new Error(`missing ${file}`);
		}
		const png = readPng(file);
		const box = bbox(png);
		if (!box) {
			throw new Error(`empty ${file}`);
		}
		const y1 = box.y + Math.max(8, Math.round(box.h * 0.22));
		let sx = 0;
		let n = 0;
		for (let y = box.y; y < y1; y++) {
			for (let x = box.x; x < box.x + box.w; x++) {
				if (png.data[(y * png.width + x) * 4 + 3] < 16) {
					continue;
				}
				sx += x;
				n += 1;
			}
		}
		return {
			file,
			png,
			headX: n ? sx / n : box.x + box.w / 2,
			headY: box.y,
			footY: box.y + box.h,
		};
	});
	const targetY = Math.min(...frames.map((f) => f.headY));
	const xs = frames.map((f) => f.headX).sort((a, b) => a - b);
	const targetX = xs[Math.floor(xs.length / 2)];
	for (const frame of frames) {
		const dx = targetX - frame.headX;
		const dy = targetY - frame.headY;
		if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
			console.log(`${path.basename(frame.file)} head ${frame.headX.toFixed(1)},${frame.headY} (ok)`);
			continue;
		}
		const ox = Math.round(dx);
		const oy = Math.round(dy);
		writePng(frame.file, blitShift(frame.png, ox, oy, null));
		const stem = frame.file.replace(/\.png$/i, '');
		const maps = [
			[`${stem}_d.png`, [0, 0, 0, 255]],
			[`${stem}_m.png`, [0, 0, 0, 255]],
			[`${stem}_n.png`, [128, 128, 255, 255]],
		];
		for (const [file, fill] of maps) {
			if (!fs.existsSync(file)) {
				continue;
			}
			writePng(file, blitShift(readPng(file), ox, oy, fill));
		}
		console.log(`${path.basename(frame.file)} head ${frame.headX.toFixed(1)},${frame.headY} -> ${targetX.toFixed(1)},${targetY} d=${ox},${oy}`);
	}
}

function replaceCmd() {
	const file = process.argv[3];
	const cols = Number(arg('--cols'));
	const rows = Number(arg('--rows'));
	const index = Number(arg('--index'));
	const cellFile = arg('--cell');
	const out = arg('--out', file);
	if (!file || !cols || !rows || Number.isNaN(index) || !cellFile) {
		throw new Error('replace SHEET.png --cols C --rows R --index I --cell CELL.png --out SHEET.png');
	}
	const sheet = readPng(file);
	const fitted = fitCanvas(readPng(cellFile));
	const col = index % cols;
	const row = Math.floor(index / cols);
	const { x, y, w, h } = cellRect(sheet, col, row, cols, rows);
	for (let yy = 0; yy < h; yy++) {
		for (let xx = 0; xx < w; xx++) {
			const i = ((y + yy) * sheet.width + (x + xx)) * 4;
			sheet.data[i] = KEY[0];
			sheet.data[i + 1] = KEY[1];
			sheet.data[i + 2] = KEY[2];
			sheet.data[i + 3] = 255;
		}
	}
	const s = Math.min(w / fitted.width, h / fitted.height);
	const dw = Math.max(1, Math.round(fitted.width * s));
	const dh = Math.max(1, Math.round(fitted.height * s));
	const scaled = scaleUniform(fitted, dw, dh);
	const ox = x + Math.floor((w - dw) / 2);
	const oy = y + (h - dh);
	blit(sheet, scaled, ox, oy);
	writePng(out, sheet);
	console.log(`replaced index ${index} -> ${out}`);
}

function opaqueCount(png) {
	let n = 0;
	for (let i = 3; i < png.data.length; i += 4) {
		if (png.data[i] >= 16) {
			n += 1;
		}
	}
	return n;
}

function measureKeyed(png) {
	const keyed = copyRect(png, 0, 0, png.width, png.height);
	floodKey(keyed);
	const box = bbox(keyed);
	const opaque = opaqueCount(keyed);
	if (!box) {
		return { empty: true, opaque: 0, canvasW: png.width, canvasH: png.height, halo: magHalo(png) };
	}
	const aspect = box.w / box.h;
	const edge = box.x <= 0 || box.y <= 0
		|| box.x + box.w >= png.width || box.y + box.h >= png.height;
	return {
		empty: false,
		opaque,
		canvasW: png.width,
		canvasH: png.height,
		box,
		aspect,
		edge,
		halo: magHalo(png),
	};
}

/** Vertical mass vs a 50° guide: eye-level standing sheets dump extra pixels into the legs. */
function tiltMass(png) {
	const keyed = copyRect(png, 0, 0, png.width, png.height);
	floodKey(keyed);
	const box = bbox(keyed);
	if (!box) {
		return null;
	}
	let n = 0;
	let sy = 0;
	let top = 0;
	let bot = 0;
	for (let y = box.y; y < box.y + box.h; y++) {
		for (let x = box.x; x < box.x + box.w; x++) {
			if (keyed.data[(y * keyed.width + x) * 4 + 3] < 16) {
				continue;
			}
			n += 1;
			const t = (y - box.y) / box.h;
			sy += t;
			if (t < 0.25) {
				top += 1;
			}
			if (t >= 0.55) {
				bot += 1;
			}
		}
	}
	if (n < 1) {
		return null;
	}
	return { yCent: sy / n, top25: top / n, bot45: bot / n };
}

function tiltFails(stem, png) {
	const guidePath = path.join(GUIDES_DIR, `${stem}.png`);
	if (!fs.existsSync(guidePath)) {
		return [];
	}
	const cell = tiltMass(png);
	const guide = tiltMass(readPng(guidePath));
	if (!cell || !guide) {
		return [];
	}
	const fails = [];
	const dBot = cell.bot45 - guide.bot45;
	const dY = cell.yCent - guide.yCent;
	if (dBot > TILT_BOT_MAX) {
		fails.push(`tilt bot45 ${cell.bot45.toFixed(3)} vs guide ${guide.bot45.toFixed(3)} (camera too low)`);
	}
	if (dY > TILT_YCENT_MAX) {
		fails.push(`tilt yCent ${cell.yCent.toFixed(3)} vs guide ${guide.yCent.toFixed(3)} (camera too low)`);
	}
	return fails;
}

function failLine(stem, m, medianAspect) {
	const fails = [];
	if (m.empty) {
		fails.push('empty');
	}
	if (m.canvasW !== CANVAS_W || m.canvasH !== CANVAS_H) {
		fails.push(`canvas ${m.canvasW}x${m.canvasH} want ${CANVAS_W}x${CANVAS_H}`);
	}
	if (!m.empty && m.opaque < MIN_OPAQUE) {
		fails.push(`opaque ${m.opaque}`);
	}
	if (!m.empty && (m.aspect < ASPECT_MIN || m.aspect > ASPECT_MAX)) {
		fails.push(`bboxA ${m.aspect.toFixed(3)} not in ${ASPECT_MIN}-${ASPECT_MAX}`);
	}
	if (stem === 'idle_06' && !m.empty && m.aspect < LOCK_ASPECT_MIN) {
		fails.push(`bboxA ${m.aspect.toFixed(3)} < ${LOCK_ASPECT_MIN} (idle_06 lock too skinny)`);
	}
	if (!m.empty && m.box && m.box.h / CANVAS_H < FILL_H_MIN) {
		fails.push(`fillH ${(m.box.h / CANVAS_H).toFixed(3)} < ${FILL_H_MIN} (too short on the card)`);
	}
	if (!m.empty && medianAspect && Math.abs(m.aspect - medianAspect) > ASPECT_SPREAD) {
		fails.push(`bboxA ${m.aspect.toFixed(3)} vs median ${medianAspect.toFixed(3)}`);
	}
	if (m.edge) {
		fails.push('bbox touches canvas edge (clip)');
	}
	if (m.halo > 0) {
		fails.push(`magHalo ${m.halo} (magenta/pink on the figure — regen)`);
	}
	return fails;
}

function opaqueAt(png, x, y) {
	if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
		return false;
	}
	return png.data[(y * png.width + x) * 4 + 3] >= 16;
}

function xorFrac(a, b, y0frac, y1frac) {
	const ka = copyRect(a, 0, 0, a.width, a.height);
	const kb = copyRect(b, 0, 0, b.width, b.height);
	floodKey(ka);
	floodKey(kb);
	const box = bbox(ka) ?? bbox(kb);
	if (!box) {
		return 0;
	}
	const y0 = box.y + Math.floor(box.h * y0frac);
	const y1 = box.y + Math.floor(box.h * y1frac);
	let n = 0;
	let d = 0;
	for (let y = y0; y <= y1; y++) {
		for (let x = box.x; x < box.x + box.w; x++) {
			n += 1;
			if (opaqueAt(ka, x, y) !== opaqueAt(kb, x, y)) {
				d += 1;
			}
		}
	}
	return n ? d / n : 0;
}

function motionFails(dir) {
	const fails = [];
	for (const hh of ['12', '02', '04', '06']) {
		const opposite = fs.existsSync(path.join(dir, `walk_${hh}_4.png`)) ? 4 : 2;
		const files = [0, opposite].map((i) => {
			const f = path.join(dir, `walk_${hh}_${i}.png`);
			return fs.existsSync(f) ? readPng(f) : null;
		});
		if (files.some((p) => !p)) {
			continue;
		}
		const stride = xorFrac(files[0], files[1], 0.4, 1);
		if (stride < 0.07) {
			fails.push(`walk_${hh} _0 vs _${opposite} xor=${stride.toFixed(3)} (still cycle)`);
		}
	}
	const t0 = path.join(dir, 'take_06_0.png');
	const t7 = path.join(dir, 'take_06_7.png');
	if (fs.existsSync(t0) && fs.existsSync(t7)) {
		const reach = xorFrac(readPng(t0), readPng(t7), 0.15, 0.75);
		if (reach < 0.06) {
			fails.push(`take_06_0 vs _7 xor=${reach.toFixed(3)} (arm never moved)`);
		}
	}
	return fails;
}

function median(values) {
	if (values.length === 0) {
		return 0;
	}
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function inspectCmd() {
	const file = process.argv[3];
	const cols = Number(arg('--cols'));
	const rows = Number(arg('--rows'));
	const stems = arg('--stems', '').split(',').map((s) => s.trim()).filter(Boolean);
	if (!file || !cols || !rows || stems.length !== cols * rows) {
		throw new Error('inspect SHEET.png --cols C --rows R --stems a,b,...');
	}
	const sheet = readPng(file);
	const live = stems.filter((s) => !s.startsWith('_'));
	console.log(`sheet ${path.basename(file)} ${sheet.width}x${sheet.height} cells ${cols}x${rows} figures ${live.length}`);
	const aspects = [];
	const rowsOut = [];
	for (let i = 0; i < stems.length; i++) {
		if (stems[i].startsWith('_')) {
			continue;
		}
		const col = i % cols;
		const row = Math.floor(i / cols);
		const { x, y, w, h } = cellRect(sheet, col, row, cols, rows);
		const m = measureKeyed(copyRect(sheet, x, y, w, h));
		rowsOut.push({ stem: stems[i], m });
		if (!m.empty) {
			aspects.push(m.aspect);
		}
	}
	const med = median(aspects);
	let bad = 0;
	for (const { stem, m } of rowsOut) {
		const fails = [];
		if (m.empty) {
			fails.push('empty');
		} else {
			if (m.aspect < ASPECT_MIN || m.aspect > ASPECT_MAX) {
				fails.push(`bboxA ${m.aspect.toFixed(3)} not in ${ASPECT_MIN}-${ASPECT_MAX}`);
			}
			if (Math.abs(m.aspect - med) > ASPECT_SPREAD) {
				fails.push(`bboxA ${m.aspect.toFixed(3)} vs median ${med.toFixed(3)}`);
			}
			if (m.opaque < MIN_OPAQUE) {
				fails.push(`opaque ${m.opaque}`);
			}
		}
		const a = m.empty ? '-' : m.aspect.toFixed(3);
		if (fails.length) {
			bad += 1;
			console.log(`${stem} bboxA=${a} FAIL ${fails.join('; ')}`);
		} else {
			console.log(`${stem} bboxA=${a} ok`);
		}
	}
	if (rowsOut.length !== live.length) {
		console.log(`FAIL count ${rowsOut.length} measured, ${live.length} stems`);
		bad += 1;
	}
	console.log(bad ? `FAIL ${bad}/${rowsOut.length}` : `OK ${rowsOut.length} figures median bboxA=${med.toFixed(3)}`);
	if (bad) {
		process.exitCode = 1;
	}
}

function checkCmd() {
	const dir = process.argv[3];
	const clip = arg('--clip', 'all');
	const stems = CLIPS[clip];
	if (!dir || !stems) {
		throw new Error('check DIR --clip idle|walk|take|all');
	}
	const missing = [];
	const extra = [];
	const have = new Set();
	if (fs.existsSync(dir)) {
		for (const name of fs.readdirSync(dir)) {
			if (!name.endsWith('.png') || name.startsWith('_')) {
				continue;
			}
			have.add(name.slice(0, -4));
		}
	}
	for (const stem of stems) {
		if (!have.has(stem)) {
			if (OPTIONAL_GUIDES.has(stem)) {
				continue;
			}
			missing.push(stem);
		}
	}
	if (clip === 'all') {
		for (const name of have) {
			if (name.endsWith('_d') || name.endsWith('_n')) {
				continue;
			}
			if (/^walk_(03|08|09|10)_/.test(name)) {
				continue;
			}
			if (!stems.includes(name)) {
				extra.push(name);
			}
		}
	}
	console.log(`check ${dir} clip=${clip} expect ${stems.length} have ${have.size}`);
	if (missing.length) {
		console.log(`FAIL missing (${missing.length}): ${missing.join(', ')}`);
	}
	if (extra.length) {
		console.log(`FAIL extra (${extra.length}): ${extra.join(', ')}`);
	}
	const rows = [];
	for (const stem of stems) {
		const file = path.join(dir, `${stem}.png`);
		if (!fs.existsSync(file)) {
			continue;
		}
		rows.push({ stem, png: readPng(file), m: null });
	}
	for (const row of rows) {
		row.m = measureKeyed(row.png);
	}
	const med = median(rows.filter((r) => !r.m.empty).map((r) => r.m.aspect));
	let bad = missing.length + extra.length;
	for (const { stem, png, m } of rows) {
		const fails = failLine(stem, m, med);
		fails.push(...tiltFails(stem, png));
		const a = m.empty ? '-' : m.aspect.toFixed(3);
		const box = m.box ? `${m.box.w}x${m.box.h}` : '-';
		if (fails.length) {
			bad += 1;
			console.log(`${stem} ${m.canvasW}x${m.canvasH} bbox ${box} A=${a} FAIL ${fails.join('; ')}`);
		} else {
			console.log(`${stem} ${m.canvasW}x${m.canvasH} bbox ${box} A=${a} ok`);
		}
	}
	if (clip === 'walk' || clip === 'take' || clip === 'all') {
		const motion = motionFails(dir);
		for (const line of motion) {
			bad += 1;
			console.log(`MOTION FAIL ${line}`);
		}
		if (motion.length === 0) {
			console.log('motion ok');
		}
	}
	console.log(bad ? `FAIL ${bad} problems` : `OK ${stems.length} frames median bboxA=${med.toFixed(3)}`);
	if (bad) {
		process.exitCode = 1;
	}
	if (clip === 'all') {
		const maps = path.join(here, 'maps-sheet.mjs');
		const r = spawnSync(process.execPath, [maps, 'check', dir], { stdio: 'inherit' });
		if (r.status) {
			process.exitCode = 1;
		}
	}
}

function checkGuidesCmd() {
	const dir = path.resolve(here, '../guides');
	const GUIDE_W = 768;
	const GUIDE_H = 1024;
	const missing = [];
	let bad = 0;
	for (const stem of CLIPS.all) {
		const file = path.join(dir, `${stem}.png`);
		if (!fs.existsSync(file)) {
			if (optionalGuide(stem)) {
				console.log(`skip ${stem} (no mannequin cel)`);
				continue;
			}
			missing.push(stem);
			continue;
		}
		const png = readPng(file);
		if (png.width !== GUIDE_W || png.height !== GUIDE_H) {
			bad += 1;
			console.log(`${stem} ${png.width}x${png.height} FAIL want ${GUIDE_W}x${GUIDE_H}`);
		}
	}
	if (missing.length) {
		bad += missing.length;
		console.log(`FAIL missing (${missing.length}): ${missing.join(', ')}`);
	}
	const required = CLIPS.all.filter((s) => !optionalGuide(s)).length;
	console.log(bad ? `FAIL ${bad} guide problems` : `OK ${required} pose guides ${GUIDE_W}x${GUIDE_H}`);
	if (bad) process.exitCode = 1;
}

const cmd = process.argv[2];
if (cmd === 'slice') {
	sliceCmd();
} else if (cmd === 'fit') {
	fitCmd();
} else if (cmd === 'replace') {
	replaceCmd();
} else if (cmd === 'inspect') {
	inspectCmd();
} else if (cmd === 'check') {
	checkCmd();
} else if (cmd === 'check-guides') {
	checkGuidesCmd();
} else if (cmd === 'lock-head') {
	lockHeadCmd();
} else {
	throw new Error('slice | fit | replace | inspect | check | check-guides | lock-head');
}
