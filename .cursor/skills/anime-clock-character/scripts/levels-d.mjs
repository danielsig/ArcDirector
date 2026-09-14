#!/usr/bin/env node
/**
 * Normalize fitted shape maps (`*_d.png`) that came out too bright, too dark,
 * or too flat for Sobel normals. Percentile-stretches figure luma into a
 * facing range (rims darker, fronts still light). Black background stays black.
 *
 *   node levels-d.mjs DIR
 *   node levels-d.mjs FILE_d.png [FILE_d.png ...]
 *   node levels-d.mjs DIR --force
 *   node levels-d.mjs DIR --dry
 *   node levels-d.mjs --selftest
 *
 * Default skips cells already in range. --force always stretches.
 * Run after fit-d, before depth_to_normal.mjs. Then rebake _n.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { PNG } = createRequire(path.resolve(here, '../../../../game/package.json'))('pngjs');

const BLACK = 12;
const OUT_LO = 48;
const OUT_HI = 210;
const P_LO = 0.08;
const P_HI = 0.98;
const MEAN_BRIGHT = 185;
const P10_BRIGHT = 165;
const MEAN_DARK = 90;
const P90_DARK = 140;
const SPAN_FLAT = 40;
const MEAN_OK_LO = 110;
const MEAN_OK_HI = 170;
const SPAN_OK = 50;

function hasFlag(name) {
	return process.argv.includes(name);
}

function readPng(file) {
	return PNG.sync.read(fs.readFileSync(file));
}

function writePng(file, png) {
	fs.writeFileSync(file, PNG.sync.write(png));
}

function lumaAt(png, i) {
	return (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
}

function figureStats(png) {
	const vals = [];
	for (let i = 0; i < png.data.length; i += 4) {
		const r = png.data[i];
		const g = png.data[i + 1];
		const b = png.data[i + 2];
		if (r + g + b <= BLACK) {
			continue;
		}
		vals.push(Math.round((r + g + b) / 3));
	}
	vals.sort((a, b) => a - b);
	if (vals.length < 40) {
		return null;
	}
	const at = (p) => vals[Math.min(vals.length - 1, Math.floor((vals.length - 1) * p))];
	const sum = vals.reduce((s, v) => s + v, 0);
	return {
		n: vals.length,
		min: vals[0],
		max: vals[vals.length - 1],
		mean: Math.round(sum / vals.length),
		p10: at(0.1),
		p90: at(0.9),
		lo: at(P_LO),
		hi: at(P_HI),
	};
}

function whyAdjust(st) {
	if (st.mean >= MEAN_BRIGHT || st.p10 >= P10_BRIGHT) {
		return 'bright';
	}
	if (st.mean <= MEAN_DARK || st.p90 <= P90_DARK) {
		return 'dark';
	}
	if (st.p90 - st.p10 < SPAN_FLAT) {
		return 'flat';
	}
	return null;
}

function inRange(st) {
	return st.mean >= MEAN_OK_LO && st.mean <= MEAN_OK_HI && st.p90 - st.p10 >= SPAN_OK;
}

function stretch(png, st) {
	let lo = st.lo;
	let hi = st.hi;
	if (hi <= lo) {
		hi = lo + 1;
	}
	const src = hi - lo;
	const span = OUT_HI - OUT_LO;
	for (let i = 0; i < png.data.length; i += 4) {
		const r = png.data[i];
		const g = png.data[i + 1];
		const b = png.data[i + 2];
		if (r + g + b <= BLACK) {
			png.data[i] = 0;
			png.data[i + 1] = 0;
			png.data[i + 2] = 0;
			png.data[i + 3] = 255;
			continue;
		}
		let t = (lumaAt(png, i) - lo) / src;
		if (t < 0) {
			t = 0;
		} else if (t > 1) {
			t = 1;
		}
		const o = Math.round(OUT_LO + t * span);
		png.data[i] = o;
		png.data[i + 1] = o;
		png.data[i + 2] = o;
		png.data[i + 3] = 255;
	}
}

function collect(args) {
	const files = [];
	for (const a of args) {
		if (a.startsWith('--')) {
			continue;
		}
		if (!fs.existsSync(a)) {
			throw new Error(`missing ${a}`);
		}
		const st = fs.statSync(a);
		if (st.isDirectory()) {
			for (const name of fs.readdirSync(a).sort()) {
				if (name.endsWith('_d.png')) {
					files.push(path.join(a, name));
				}
			}
			continue;
		}
		if (!a.endsWith('_d.png')) {
			throw new Error(`not a *_d.png: ${a}`);
		}
		files.push(a);
	}
	return files;
}

function processFile(file, force, dry) {
	const png = readPng(file);
	const before = figureStats(png);
	if (!before) {
		console.log(`${path.basename(file)} skip (no figure)`);
		return 'skip';
	}
	const reason = whyAdjust(before);
	const ok = inRange(before);
	if (!force && (ok || !reason)) {
		console.log(
			`${path.basename(file)} ok mean=${before.mean} p10=${before.p10} p90=${before.p90} skip`,
		);
		return 'skip';
	}
	const tag = force && !reason ? 'force' : reason;
	if (dry) {
		console.log(
			`${path.basename(file)} ${tag} mean=${before.mean} p10=${before.p10} p90=${before.p90} dry`,
		);
		return 'dry';
	}
	stretch(png, before);
	writePng(file, png);
	const after = figureStats(png);
	console.log(
		`${path.basename(file)} ${tag} mean=${before.mean}→${after?.mean ?? '?'} p10=${before.p10}→${after?.p10 ?? '?'}`,
	);
	return 'adjusted';
}

function fillBlob(png, cx, cy, radius, grayFn) {
	const r2 = radius * radius;
	for (let y = 0; y < png.height; y++) {
		for (let x = 0; x < png.width; x++) {
			const dx = x - cx;
			const dy = y - cy;
			const d2 = dx * dx + dy * dy;
			if (d2 > r2) {
				continue;
			}
			const t = Math.sqrt(d2) / radius;
			const gray = grayFn(t);
			const i = (y * png.width + x) * 4;
			png.data[i] = gray;
			png.data[i + 1] = gray;
			png.data[i + 2] = gray;
			png.data[i + 3] = 255;
		}
	}
}

function selftest() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'levels-d-'));
	const mk = (name, grayFn) => {
		const png = new PNG({ width: 64, height: 64 });
		png.data.fill(0);
		for (let i = 3; i < png.data.length; i += 4) {
			png.data[i] = 255;
		}
		fillBlob(png, 32, 32, 18, grayFn);
		const file = path.join(dir, name);
		writePng(file, png);
		return file;
	};
	const bright = mk('bright_d.png', (t) => Math.round(252 - t * 55));
	const dark = mk('dark_d.png', (t) => Math.round(88 - t * 40));
	const mid = mk('mid_d.png', (t) => Math.round(185 - t * 90));
	const b = processFile(bright, false, false);
	const d = processFile(dark, false, false);
	const m = processFile(mid, false, false);
	const bs = figureStats(readPng(bright));
	const ds = figureStats(readPng(dark));
	fs.rmSync(dir, { recursive: true, force: true });
	if (b !== 'adjusted' || d !== 'adjusted' || m !== 'skip') {
		throw new Error(`selftest status bright=${b} dark=${d} mid=${m}`);
	}
	if (!bs || bs.mean < 90 || bs.mean > 180) {
		throw new Error(`selftest bright mean ${bs?.mean}`);
	}
	if (!ds || ds.mean < 90 || ds.mean > 180) {
		throw new Error(`selftest dark mean ${ds?.mean}`);
	}
	console.log('selftest ok');
}

const force = hasFlag('--force');
const dry = hasFlag('--dry');
if (hasFlag('--selftest')) {
	selftest();
	process.exit(0);
}
const files = collect(process.argv.slice(2));
if (!files.length) {
	console.error('usage: levels-d.mjs DIR|FILE_d.png [--force] [--dry] [--selftest]');
	process.exit(1);
}
let adjusted = 0;
for (const file of files) {
	if (processFile(file, force, dry) === 'adjusted') {
		adjusted += 1;
	}
}
console.log(`levels-d ${adjusted}/${files.length} adjusted`);
