/**
 * Pack character clocks and sword views into hashed PNG atlases.
 *
 *   node game/scripts/artCachePack.mjs
 *
 * Writes game/cache/clock/{kind}.{hash}.alb.png (and .nrm.png) plus sword
 * atlases. Stale hashed files are deleted as soon as a kind is rebuilt.
 *
 * Stems idle_02 / walk_02 = 1:30 (45° from 12); idle_04 / walk_04 = 4:30
 * (135° from 12). Optional walk 08 / 10 = 7:30 / 10:30. Not analog 2:00 / 4:00.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { entryForFolder, entryForKind, listCharacterEntries, readCharacterMeta } from './characters.mjs';

export const PACKER_VERSION = 14;
export const CACHE_PUBLIC = 'cache';
/** WebGL1 / many GPUs cap at 4096. Pixel clocks stay on this. */
const MAX_ATLAS = 4096;
/**
 * Cel clocks pack at source cell size. 80× 384×512 needs ~3840×4096.
 * Crushing into 1024² (93×124) then LinearFilter is why close-ups look
 * like a stretched thumbnail next to nearest-filtered grass.
 */
const CEL_MAX_ATLAS = 4096;
/** 0 so 10×8 of 384×512 fills 3840×4096 with no downsample. */
const CEL_GUTTER = 0;

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = [
	'idle_02', 'idle_04', 'idle_06', 'idle_12',
	'walk_02_0', 'walk_02_1', 'walk_02_2', 'walk_02_3',
	'walk_04_0', 'walk_04_1', 'walk_04_2', 'walk_04_3',
	'walk_06_0', 'walk_06_1', 'walk_06_2', 'walk_06_3',
	'walk_12_0', 'walk_12_1', 'walk_12_2', 'walk_12_3',
];
const OPTIONAL_IDLE = ['idle_01', 'idle_03', 'idle_05', 'idle_07', 'idle_08', 'idle_09', 'idle_10', 'idle_11'];
/** Player packs all four. Other kinds FlipX 4 / 3 / 2 at runtime when these are absent. */
const OPTIONAL_WALK_HOURS = [3, 8, 9, 10];
const OPTIONAL_TAKE = [
	'take_06_0', 'take_06_1', 'take_06_2', 'take_06_3',
	'take_06_4', 'take_06_5', 'take_06_6', 'take_06_7',
];
const SWORD_STEMS = ['idle_12', 'idle_02', 'idle_04', 'idle_06'];
const FLAT_N = [128, 128, 255, 255];

function readPng(file) {
	return PNG.sync.read(fs.readFileSync(file));
}

function emptyPng(w, h, rgba = [0, 0, 0, 0]) {
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
			const si = (y * src.width + x) * 4;
			const di = ((dy + y) * dst.width + (dx + x)) * 4;
			dst.data[di] = src.data[si];
			dst.data[di + 1] = src.data[si + 1];
			dst.data[di + 2] = src.data[si + 2];
			dst.data[di + 3] = src.data[si + 3];
		}
	}
}

function scalePng(src, dw, dh) {
	if (src.width === dw && src.height === dh) {
		return src;
	}
	const dst = emptyPng(dw, dh, [0, 0, 0, 0]);
	for (let y = 0; y < dh; y++) {
		for (let x = 0; x < dw; x++) {
			const sx = Math.min(src.width - 1, Math.floor((x + 0.5) * src.width / dw));
			const sy = Math.min(src.height - 1, Math.floor((y + 0.5) * src.height / dh));
			const si = (sy * src.width + sx) * 4;
			const i = (y * dw + x) * 4;
			dst.data[i] = src.data[si];
			dst.data[i + 1] = src.data[si + 1];
			dst.data[i + 2] = src.data[si + 2];
			dst.data[i + 3] = src.data[si + 3];
		}
	}
	return dst;
}

/** Largest uniform scale of srcW×srcH that still packs `count` cells into MAX_ATLAS. */
function fitInner(count, srcW, srcH, gutter, max = MAX_ATLAS) {
	let best = null;
	for (let cols = 1; cols <= count; cols++) {
		const rows = Math.ceil(count / cols);
		const innerW = Math.floor(max / cols) - gutter * 2;
		const innerH = Math.floor(max / rows) - gutter * 2;
		if (innerW < 8 || innerH < 8) {
			continue;
		}
		const scale = Math.min(1, innerW / srcW, innerH / srcH);
		const dw = Math.max(1, Math.round(srcW * scale));
		const dh = Math.max(1, Math.round(srcH * scale));
		if (dw + gutter * 2 > Math.floor(max / cols) || dh + gutter * 2 > Math.floor(max / rows)) {
			continue;
		}
		if (!best || scale > best.scale) {
			best = { dw, dh, scale, cols, rows };
		}
	}
	if (!best) {
		throw new Error(`atlas ${count} cells ${srcW}x${srcH} g${gutter} over ${max}`);
	}
	return best;
}

function hashInputs(tag, files) {
	const h = crypto.createHash('sha256');
	h.update(`art-cache-v${PACKER_VERSION}`);
	h.update(tag);
	for (const file of files) {
		h.update(file.name);
		h.update(file.buf);
	}
	return h.digest('hex').slice(0, 10);
}

/** Prefer a full 8-frame cycle. Other kinds may still ship 4 cells (0–3 or remapped evens). */
function walkStems(dir, hour) {
	const tag = String(hour).padStart(2, '0');
	const seq = (idxs) => idxs.map((i) => `walk_${tag}_${i}`);
	for (const idxs of [[0, 1, 2, 3, 4, 5, 6, 7], [0, 1, 2, 3], [0, 2, 4, 6]]) {
		const group = seq(idxs);
		if (group.every((stem) => fs.existsSync(path.join(dir, `${stem}.png`)))) {
			return group;
		}
	}
	return null;
}

function appendLongWalk(dir, stems) {
	for (const hour of [2, 3, 4, 6, 8, 9, 10, 12]) {
		const tag = String(hour).padStart(2, '0');
		for (let i = 4; i < 16; i++) {
			const stem = `walk_${tag}_${i}`;
			if (!fs.existsSync(path.join(dir, `${stem}.png`))) {
				break;
			}
			if (!stems.includes(stem)) {
				stems.push(stem);
			}
		}
	}
}

function stemsForKind(dir) {
	const stems = [];
	for (const stem of REQUIRED.filter((s) => s.startsWith('idle_'))) {
		const file = path.join(dir, `${stem}.png`);
		if (!fs.existsSync(file)) {
			throw new Error(`missing ${file}`);
		}
		stems.push(stem);
	}
	for (const hour of [2, 4, 6, 12]) {
		const group = walkStems(dir, hour);
		if (!group) {
			throw new Error(`missing walk_${String(hour).padStart(2, '0')} in ${dir}`);
		}
		stems.push(...group);
	}
	for (const stem of OPTIONAL_IDLE) {
		if (fs.existsSync(path.join(dir, `${stem}.png`))) {
			stems.push(stem);
		}
	}
	for (const hour of OPTIONAL_WALK_HOURS) {
		const group = walkStems(dir, hour);
		if (group) {
			stems.push(...group);
		}
	}
	appendLongWalk(dir, stems);
	for (const stem of OPTIONAL_TAKE) {
		if (!fs.existsSync(path.join(dir, `${stem}.png`))) {
			break;
		}
		stems.push(stem);
	}
	return stems;
}

function loadNrm(dir, stem, alb) {
	// Take albedos were redrawn; leftover take_*_n is the old pose and a
	// full-card opaque map, which lights the pad as a black rectangle.
	if (stem.startsWith('take_')) {
		return emptyPng(alb.width, alb.height, FLAT_N);
	}
	const file = path.join(dir, `${stem}_n.png`);
	if (fs.existsSync(file)) {
		const png = readPng(file);
		const px = png.data;
		for (let i = 0; i < px.length; i += 4) {
			if (magentaDist(px, i) < 40) {
				px[i] = FLAT_N[0];
				px[i + 1] = FLAT_N[1];
				px[i + 2] = FLAT_N[2];
				px[i + 3] = FLAT_N[3];
			}
		}
		return png;
	}
	return emptyPng(alb.width, alb.height, FLAT_N);
}

/** Keep figure normals, plus the baker's outside halo so a 1–3px miss still
 *  samples a limb normal. Flattening transparent texels to flat-forward made
 *  the silhouette light as a camera-facing crease (black arm rim). */
function dilateOpaque(alb, radius) {
	const w = alb.width;
	const h = alb.height;
	const src = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) {
		src[i] = alb.data[i * 4 + 3] >= 16 ? 1 : 0;
	}
	if (radius <= 0) {
		return src;
	}
	const out = new Uint8Array(src);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (!src[y * w + x]) {
				continue;
			}
			const y0 = Math.max(0, y - radius);
			const y1 = Math.min(h - 1, y + radius);
			const x0 = Math.max(0, x - radius);
			const x1 = Math.min(w - 1, x + radius);
			for (let yy = y0; yy <= y1; yy++) {
				for (let xx = x0; xx <= x1; xx++) {
					out[yy * w + xx] = 1;
				}
			}
		}
	}
	return out;
}

function stampNrmToAlbedo(alb, nrm) {
	const w = alb.width;
	const h = alb.height;
	const keep = dilateOpaque(alb, 8);
	const n = w * h;
	for (let i = 0; i < n; i++) {
		const p = i * 4;
		if (keep[i]) {
			nrm.data[p + 3] = 255;
			continue;
		}
		nrm.data[p] = FLAT_N[0];
		nrm.data[p + 1] = FLAT_N[1];
		nrm.data[p + 2] = FLAT_N[2];
		nrm.data[p + 3] = 0;
	}
}

function magentaDist(px, i) {
	return Math.abs(px[i] - 255) + Math.abs(px[i + 1] - 0) + Math.abs(px[i + 2] - 255);
}

/** Drop generator-key magenta only. Do not eat interior shade. */
function keyMagenta(png) {
	const px = png.data;
	const hard = 40;
	for (let i = 0; i < px.length; i += 4) {
		const dist = magentaDist(px, i);
		if (dist < hard) {
			px[i + 3] = 0;
			continue;
		}
		if (px[i + 3] > 0 && dist < 90) {
			const r = px[i];
			const g = px[i + 1];
			const b = px[i + 2];
			const mag = (r - g) + (b - g) * 0.35;
			if (mag > 12) {
				px[i] = Math.max(g, r - mag);
				px[i + 2] = Math.min(b, g + 18);
			}
		}
	}
}

function prepareFrames(dir, stems) {
	const items = stems.map((stem) => {
		const alb = readPng(path.join(dir, `${stem}.png`));
		keyMagenta(alb);
		const nrm = loadNrm(dir, stem, alb);
		stampNrmToAlbedo(alb, nrm);
		return { stem, alb, nrm };
	});
	const w = items[0].alb.width;
	const cel = w >= 160;
	return { cel, items };
}

function fitGrid(count, cellW, cellH, max = MAX_ATLAS) {
	let best = null;
	for (let cols = 1; cols <= count; cols++) {
		const rows = Math.ceil(count / cols);
		const w = cols * cellW;
		const h = rows * cellH;
		if (w > max || h > max) {
			continue;
		}
		const area = w * h;
		if (!best || area < best.area) {
			best = { cols, rows, area };
		}
	}
	return best;
}

function packPrepared(items, layer, gutter = 0, max = MAX_ATLAS, padSquare = false) {
	const pngs = items.map((it) => ({ stem: it.stem, png: layer === 'alb' ? it.alb : it.nrm }));
	const innerW = Math.max(...pngs.map((p) => p.png.width));
	const innerH = Math.max(...pngs.map((p) => p.png.height));
	let usedGutter = gutter;
	let cellW = innerW + usedGutter * 2;
	let cellH = innerH + usedGutter * 2;
	let grid = fitGrid(pngs.length, cellW, cellH, max);
	if (!grid && usedGutter > 0) {
		usedGutter = 0;
		cellW = innerW;
		cellH = innerH;
		grid = fitGrid(pngs.length, cellW, cellH, max);
	}
	if (!grid) {
		throw new Error(`atlas ${pngs.length} cells ${innerW}x${innerH} g${gutter} over ${max}`);
	}
	const fill = layer === 'nrm' ? FLAT_N : [0, 0, 0, 0];
	const gridW = cellW * grid.cols;
	const gridH = cellH * grid.rows;
	const sheetW = padSquare ? Math.max(gridW, max) : gridW;
	const sheetH = padSquare ? Math.max(gridH, max) : gridH;
	const sheet = emptyPng(sheetW, sheetH, fill);
	const frames = {};
	for (let i = 0; i < pngs.length; i++) {
		const col = i % grid.cols;
		const row = Math.floor(i / grid.cols);
		const { stem, png } = pngs[i];
		const ox = col * cellW + usedGutter + Math.floor((innerW - png.width) / 2);
		const oy = row * cellH + usedGutter + (innerH - png.height);
		blit(sheet, png, ox, oy);
		frames[stem] = [ox, oy, png.width, png.height];
	}
	return { sheet, frames, w: sheet.width, h: sheet.height, gutter: usedGutter };
}

function packSheet(dir, stems, layer) {
	const items = stems.map((stem) => {
		const alb = readPng(path.join(dir, `${stem}.png`));
		return { stem, alb, nrm: loadNrm(dir, stem, alb) };
	});
	return packPrepared(items, layer);
}

function writeHashed(dir, prefix, hash, alb, nrm) {
	fs.mkdirSync(dir, { recursive: true });
	const albName = `${prefix}.${hash}.alb.png`;
	const nrmName = `${prefix}.${hash}.nrm.png`;
	const albPath = path.join(dir, albName);
	const nrmPath = path.join(dir, nrmName);
	fs.writeFileSync(albPath, PNG.sync.write(alb.sheet));
	fs.writeFileSync(nrmPath, PNG.sync.write(nrm.sheet));
	return { albName, nrmName, wrote: true };
}

function relURL(...parts) {
	return [CACHE_PUBLIC, ...parts].join('/');
}

function pruneDir(dir, keep) {
	if (!fs.existsSync(dir)) {
		return 0;
	}
	let n = 0;
	for (const name of fs.readdirSync(dir)) {
		if (!keep.has(name)) {
			try {
				fs.unlinkSync(path.join(dir, name));
			}
			catch (err) {
				if (err && err.code !== 'ENOENT') {
					throw err;
				}
			}
			n += 1;
		}
	}
	return n;
}

function readManifest(cacheDir) {
	const file = path.join(cacheDir, 'manifest.json');
	if (!fs.existsSync(file)) {
		return { v: PACKER_VERSION, kinds: {}, sword: null };
	}
	try {
		const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
		if (!raw || typeof raw !== 'object') {
			return { v: PACKER_VERSION, kinds: {}, sword: null };
		}
		return {
			v: PACKER_VERSION,
			kinds: raw.kinds && typeof raw.kinds === 'object' ? raw.kinds : {},
			sword: raw.sword ?? null,
		};
	}
	catch {
		return { v: PACKER_VERSION, kinds: {}, sword: null };
	}
}

function keepFromManifest(manifest) {
	const clock = new Set();
	const sword = new Set();
	for (const entry of Object.values(manifest.kinds ?? {})) {
		if (entry?.alb) {
			clock.add(path.basename(entry.alb));
		}
		if (entry?.nrm) {
			clock.add(path.basename(entry.nrm));
		}
	}
	if (manifest.sword?.alb) {
		sword.add(path.basename(manifest.sword.alb));
	}
	if (manifest.sword?.nrm) {
		sword.add(path.basename(manifest.sword.nrm));
	}
	return { clock, sword };
}

export function cacheDirFor(root = GAME_ROOT) {
	return path.join(root, 'cache');
}

export function packKind(root, kind, prev) {
	const entry = entryForKind(kind, root);
	if (!entry) {
		throw new Error(`no character folder for kind ${kind}`);
	}
	const folder = entry.folder;
	const dir = entry.dir;
	const meta = readCharacterMeta(dir);
	const stems = stemsForKind(dir);
	const files = [];
	for (const stem of stems) {
		files.push({ name: `${stem}.png`, buf: fs.readFileSync(path.join(dir, `${stem}.png`)) });
		const nrm = path.join(dir, `${stem}_n.png`);
		if (fs.existsSync(nrm)) {
			files.push({ name: `${stem}_n.png`, buf: fs.readFileSync(nrm) });
		}
	}
	const samplePng = PNG.sync.read(files[0].buf);
	const cel = samplePng.width >= 160;
	const gutter = cel ? CEL_GUTTER : 0;
	const maxAtlas = cel ? CEL_MAX_ATLAS : MAX_ATLAS;
	const inner = fitInner(stems.length, samplePng.width, samplePng.height, gutter, maxAtlas);
	const hash = hashInputs(`${kind}:${folder}:g${gutter}:${inner.dw}x${inner.dh}:m${maxAtlas}:sq`, files);
	const clockDir = path.join(cacheDirFor(root), 'clock');
	const albName = `${kind}.${hash}.alb.png`;
	const nrmName = `${kind}.${hash}.nrm.png`;
	if (
		prev?.hash === hash
		&& prev.frames
		&& fs.existsSync(path.join(clockDir, albName))
		&& fs.existsSync(path.join(clockDir, nrmName))
	) {
		return {
			hash,
			alb: relURL('clock', albName),
			nrm: relURL('clock', nrmName),
			w: prev.w,
			h: prev.h,
			frames: prev.frames,
			cel: prev.cel === true,
			height: meta.height,
			folder,
			takeFps: meta.takeFps,
			walkFps: meta.walkFps,
			left: meta.left,
			right: meta.right,
			wrote: false,
		};
	}
	const prepared = prepareFrames(dir, stems);
	const items = inner.scale < 1
		? prepared.items.map((it) => ({
			stem: it.stem,
			alb: scalePng(it.alb, inner.dw, inner.dh),
			nrm: scalePng(it.nrm, inner.dw, inner.dh),
		}))
		: prepared.items;
	if (inner.scale < 1) {
		console.log(`art-cache ${kind} scale ${samplePng.width}x${samplePng.height} → ${inner.dw}x${inner.dh}`);
	}
	const alb = packPrepared(items, 'alb', gutter, maxAtlas, cel);
	const nrm = packPrepared(items, 'nrm', gutter, maxAtlas, cel);
	const written = writeHashed(clockDir, kind, hash, alb, nrm);
	return {
		hash,
		alb: relURL('clock', written.albName),
		nrm: relURL('clock', written.nrmName),
		w: alb.w,
		h: alb.h,
		frames: alb.frames,
		cel: prepared.cel,
		height: meta.height,
		folder,
		takeFps: meta.takeFps,
		walkFps: meta.walkFps,
		left: meta.left,
		right: meta.right,
		wrote: written.wrote,
	};
}

export function packSword(root) {
	const dir = path.join(root, 'public', 'items', 'sword');
	const files = [];
	for (const stem of SWORD_STEMS) {
		files.push({ name: `${stem}.png`, buf: fs.readFileSync(path.join(dir, `${stem}.png`)) });
		const nrm = path.join(dir, `${stem}_n.png`);
		if (fs.existsSync(nrm)) {
			files.push({ name: `${stem}_n.png`, buf: fs.readFileSync(nrm) });
		}
	}
	const hash = hashInputs('sword', files);
	const alb = packSheet(dir, SWORD_STEMS, 'alb');
	const nrm = packSheet(dir, SWORD_STEMS, 'nrm');
	const out = path.join(cacheDirFor(root), 'sword');
	const written = writeHashed(out, 'sword', hash, alb, nrm);
	return {
		hash,
		alb: relURL('sword', written.albName),
		nrm: relURL('sword', written.nrmName),
		w: alb.w,
		h: alb.h,
		frames: alb.frames,
		wrote: written.wrote,
	};
}

export function packArtCache(opts = {}) {
	const root = opts.root ?? GAME_ROOT;
	const cacheDir = cacheDirFor(root);
	fs.mkdirSync(path.join(cacheDir, 'clock'), { recursive: true });
	fs.mkdirSync(path.join(cacheDir, 'sword'), { recursive: true });
	const manifest = readManifest(cacheDir);
	const only = opts.only ?? 'all';
	let changed = false;

	const catalog = listCharacterEntries(root).filter((e) => {
		try {
			stemsForKind(e.dir);
			return true;
		} catch {
			return false;
		}
	});
	const kinds = only === 'all' ? catalog.map((e) => e.kind) : (only === 'sword' ? [] : [only]);
	const nextKinds = only === 'all' ? {} : { ...manifest.kinds };
	for (const kind of kinds) {
		const prev = manifest.kinds[kind]?.hash;
		const packed = packKind(root, kind, manifest.kinds[kind]);
		nextKinds[kind] = {
			hash: packed.hash,
			alb: packed.alb,
			nrm: packed.nrm,
			w: packed.w,
			h: packed.h,
			frames: packed.frames,
			cel: packed.cel === true,
			height: packed.height,
			folder: packed.folder,
			takeFps: packed.takeFps,
			walkFps: packed.walkFps,
			left: packed.left,
			right: packed.right,
		};
		if (packed.wrote || prev !== packed.hash) {
			changed = true;
		}
		if (!opts.silent) {
			console.log(`art-cache ${kind} ${packed.w}x${packed.h} ${packed.hash}`);
		}
	}
	manifest.kinds = nextKinds;

	if (only === 'all' || only === 'sword') {
		const prev = manifest.sword?.hash;
		const entry = packSword(root);
		manifest.sword = {
			hash: entry.hash,
			alb: entry.alb,
			nrm: entry.nrm,
			w: entry.w,
			h: entry.h,
			frames: entry.frames,
		};
		if (entry.wrote || prev !== entry.hash) {
			changed = true;
		}
		if (!opts.silent) {
			console.log(`art-cache sword ${entry.w}x${entry.h} ${entry.hash}`);
		}
	}

	manifest.v = PACKER_VERSION;
	const keep = keepFromManifest(manifest);
	pruneDir(path.join(cacheDir, 'clock'), keep.clock);
	pruneDir(path.join(cacheDir, 'sword'), keep.sword);
	fs.writeFileSync(path.join(cacheDir, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
	return { manifest, changed, cacheDir };
}

export function kindFromSource(file, root = GAME_ROOT) {
	const abs = path.resolve(file);
	const characters = path.join(root, 'public', 'characters');
	const swordDir = path.join(root, 'public', 'items', 'sword');
	if (abs.startsWith(swordDir + path.sep) || abs === swordDir) {
		return abs.endsWith('.png') || abs === swordDir ? 'sword' : null;
	}
	if (!abs.startsWith(characters + path.sep)) {
		return null;
	}
	const rel = abs.slice(characters.length + 1);
	const parts = rel.split(path.sep);
	if (parts.length !== 2) {
		return null;
	}
	const [folder, name] = parts;
	if (!name.endsWith('.png') && name !== 'character.json') {
		return null;
	}
	return entryForFolder(folder, root)?.kind ?? null;
}

const invoked = process.argv[1] && path.basename(process.argv[1]) === 'artCachePack.mjs';
if (invoked) {
	packArtCache();
}
