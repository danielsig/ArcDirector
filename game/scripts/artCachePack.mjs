/**
 * Pack character clocks and sword views into hashed PNG atlases.
 *
 *   node game/scripts/artCachePack.mjs
 *
 * Writes game/cache/clock/{kind}.{hash}.alb.png (and .nrm.png) plus sword
 * atlases. Stale hashed files are deleted as soon as a kind is rebuilt.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

export const PACKER_VERSION = 1;
export const CACHE_PUBLIC = 'cache';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KINDS = ['player', 'guard', 'robe', 'merchant', 'princess', 'sorceress'];
const COLS = 8;
const REQUIRED = [
	'idle_02', 'idle_04', 'idle_06', 'idle_12',
	'walk_02_0', 'walk_02_1', 'walk_02_2', 'walk_02_3',
	'walk_04_0', 'walk_04_1', 'walk_04_2', 'walk_04_3',
	'walk_06_0', 'walk_06_1', 'walk_06_2', 'walk_06_3',
	'walk_12_0', 'walk_12_1', 'walk_12_2', 'walk_12_3',
];
const OPTIONAL_IDLE = ['idle_01', 'idle_03', 'idle_05'];
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

function stemsForKind(dir) {
	const stems = [];
	for (const stem of REQUIRED) {
		const file = path.join(dir, `${stem}.png`);
		if (!fs.existsSync(file)) {
			throw new Error(`missing ${file}`);
		}
		stems.push(stem);
	}
	for (const stem of OPTIONAL_IDLE) {
		if (fs.existsSync(path.join(dir, `${stem}.png`))) {
			stems.push(stem);
		}
	}
	for (const stem of OPTIONAL_TAKE) {
		if (!fs.existsSync(path.join(dir, `${stem}.png`))) {
			break;
		}
		stems.push(stem);
	}
	return stems;
}

function loadNrm(dir, stem, alb) {
	const file = path.join(dir, `${stem}_n.png`);
	if (fs.existsSync(file)) {
		return readPng(file);
	}
	return emptyPng(alb.width, alb.height, FLAT_N);
}

function packSheet(dir, stems, layer) {
	const pngs = stems.map((stem) => {
		const alb = readPng(path.join(dir, `${stem}.png`));
		const png = layer === 'alb' ? alb : loadNrm(dir, stem, alb);
		return { stem, png };
	});
	const cellW = Math.max(...pngs.map((p) => p.png.width));
	const cellH = Math.max(...pngs.map((p) => p.png.height));
	const rows = Math.ceil(pngs.length / COLS);
	const fill = layer === 'nrm' ? FLAT_N : [0, 0, 0, 0];
	const sheet = emptyPng(cellW * COLS, cellH * rows, fill);
	const frames = {};
	for (let i = 0; i < pngs.length; i++) {
		const col = i % COLS;
		const row = Math.floor(i / COLS);
		const { stem, png } = pngs[i];
		const ox = col * cellW + Math.floor((cellW - png.width) / 2);
		const oy = row * cellH + (cellH - png.height);
		blit(sheet, png, ox, oy);
		frames[stem] = [ox, oy, png.width, png.height];
	}
	return { sheet, frames, w: sheet.width, h: sheet.height };
}

function writeHashed(dir, prefix, hash, alb, nrm) {
	fs.mkdirSync(dir, { recursive: true });
	const albName = `${prefix}.${hash}.alb.png`;
	const nrmName = `${prefix}.${hash}.nrm.png`;
	const albPath = path.join(dir, albName);
	const nrmPath = path.join(dir, nrmName);
	let wrote = false;
	if (!fs.existsSync(albPath)) {
		fs.writeFileSync(albPath, PNG.sync.write(alb.sheet));
		wrote = true;
	}
	if (!fs.existsSync(nrmPath)) {
		fs.writeFileSync(nrmPath, PNG.sync.write(nrm.sheet));
		wrote = true;
	}
	return { albName, nrmName, wrote };
}

function relUrl(...parts) {
	return [CACHE_PUBLIC, ...parts].join('/');
}

function pruneDir(dir, keep) {
	if (!fs.existsSync(dir)) {
		return 0;
	}
	let n = 0;
	for (const name of fs.readdirSync(dir)) {
		if (!keep.has(name)) {
			fs.unlinkSync(path.join(dir, name));
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

export function packKind(root, kind) {
	const dir = path.join(root, 'public', 'characters', kind);
	const stems = stemsForKind(dir);
	const files = [];
	for (const stem of stems) {
		files.push({ name: `${stem}.png`, buf: fs.readFileSync(path.join(dir, `${stem}.png`)) });
		const nrm = path.join(dir, `${stem}_n.png`);
		if (fs.existsSync(nrm)) {
			files.push({ name: `${stem}_n.png`, buf: fs.readFileSync(nrm) });
		}
	}
	const hash = hashInputs(kind, files);
	const alb = packSheet(dir, stems, 'alb');
	const nrm = packSheet(dir, stems, 'nrm');
	const clockDir = path.join(cacheDirFor(root), 'clock');
	const written = writeHashed(clockDir, kind, hash, alb, nrm);
	return {
		hash,
		alb: relUrl('clock', written.albName),
		nrm: relUrl('clock', written.nrmName),
		w: alb.w,
		h: alb.h,
		frames: alb.frames,
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
		alb: relUrl('sword', written.albName),
		nrm: relUrl('sword', written.nrmName),
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

	const kinds = only === 'all' ? KINDS : (only === 'sword' ? [] : [only]);
	for (const kind of kinds) {
		const prev = manifest.kinds[kind]?.hash;
		const entry = packKind(root, kind);
		manifest.kinds[kind] = {
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
			console.log(`art-cache ${kind} ${entry.w}x${entry.h} ${entry.hash}`);
		}
	}

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
	const kind = rel.split(path.sep)[0];
	if (KINDS.includes(kind) && rel.endsWith('.png')) {
		return kind;
	}
	return null;
}

const invoked = process.argv[1] && path.basename(process.argv[1]) === 'artCachePack.mjs';
if (invoked) {
	packArtCache();
}
