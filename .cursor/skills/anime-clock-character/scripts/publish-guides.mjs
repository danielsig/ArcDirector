#!/usr/bin/env node
/**
 * Install pose guides from the player character folder (`PLAYER_FOLDER` in characters.mjs).
 * Fitted cels are 384×512; guides are a 2× nearest-neighbor copy (768×1024).
 * Guide (and albedo) cards are opaque magenta `#FF00FF`, never alpha holes.
 *
 *   node .cursor/skills/anime-clock-character/scripts/publish-guides.mjs
 *
 * Do not GenerateImage new guides. Do not pull strips from junk/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { entryForKind, PLAYER_KIND } from '../../../../game/scripts/characters.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skill = path.resolve(here, '..');
const man = entryForKind(PLAYER_KIND)?.dir;
if (!man) {
	throw new Error(`no character folder for ${PLAYER_KIND}`);
}
const guides = path.join(skill, 'guides');
const { PNG } = createRequire(path.resolve(here, '../../../../game/package.json'))('pngjs');

const GUIDE_W = 768;
const GUIDE_H = 1024;
const KEEP_EXTRA = new Set(['idle_01.png', 'idle_05.png']);

function readPng(file) {
	return PNG.sync.read(fs.readFileSync(file));
}

function writePng(file, png) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, PNG.sync.write(png));
}

/** Composite transparent pixels onto #FF00FF so the card is an opaque chroma key. */
function fillMagentaCard(png) {
	let n = 0;
	for (let i = 0; i < png.data.length; i += 4) {
		const a = png.data[i + 3] ?? 255;
		if (a >= 255) continue;
		const t = a / 255;
		png.data[i] = Math.round(png.data[i] * t + 255 * (1 - t));
		png.data[i + 1] = Math.round(png.data[i + 1] * t);
		png.data[i + 2] = Math.round(png.data[i + 2] * t + 255 * (1 - t));
		png.data[i + 3] = 255;
		n += 1;
	}
	return n;
}

function nn2x(src) {
	if (src.width === GUIDE_W && src.height === GUIDE_H) return src;
	if (src.width * 2 !== GUIDE_W || src.height * 2 !== GUIDE_H) {
		throw new Error(`want ${src.width}x${src.height} → ${GUIDE_W}x${GUIDE_H} (2×), got ${src.width}x${src.height}`);
	}
	const dst = new PNG({ width: GUIDE_W, height: GUIDE_H, colorType: 6 });
	for (let y = 0; y < GUIDE_H; y++) {
		for (let x = 0; x < GUIDE_W; x++) {
			const si = ((y >> 1) * src.width + (x >> 1)) * 4;
			const di = (y * GUIDE_W + x) * 4;
			dst.data[di] = src.data[si];
			dst.data[di + 1] = src.data[si + 1];
			dst.data[di + 2] = src.data[si + 2];
			dst.data[di + 3] = src.data[si + 3] ?? 255;
		}
	}
	return dst;
}

function isAlbedo(name) {
	return /^(idle|walk|take)_.*\.png$/i.test(name) && !/_[dn]\.png$/i.test(name);
}

if (!fs.existsSync(man)) throw new Error(`missing ${man}`);

const srcNames = fs.readdirSync(man).filter(isAlbedo).sort();
if (!srcNames.length) throw new Error(`no albedo pngs in ${man}`);

const published = new Set();
for (const name of srcNames) {
	const srcPath = path.join(man, name);
	const src = readPng(srcPath);
	const filled = fillMagentaCard(src);
	if (filled) writePng(srcPath, src);
	const guide = nn2x(src);
	fillMagentaCard(guide);
	writePng(path.join(guides, name), guide);
	published.add(name);
	console.log(name.replace(/\.png$/, ''), `${GUIDE_W}x${GUIDE_H}${filled ? ` (magenta-filled ${filled})` : ''}`);
}

let removed = 0;
for (const name of fs.readdirSync(guides)) {
	if (!isAlbedo(name) || KEEP_EXTRA.has(name) || published.has(name)) continue;
	fs.unlinkSync(path.join(guides, name));
	removed += 1;
	console.log('removed', name, '(not in character folder)');
}

console.log('OK', published.size, 'guides from', man, removed ? `(removed ${removed} extras)` : '');
