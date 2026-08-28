/**
 * Slice a clay depth spritesheet into per-frame `_d.png` using the pack manifest.
 *
 *   node game/scripts/unpack_sheet_depth.mjs
 *   node game/scripts/unpack_sheet_depth.mjs player
 *
 * Expects game/public/characters/_sheets/{kind}_d.png next to {kind}.json.
 * Writes {stem}_d.png beside each albedo frame.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/characters');
const SHEETS = path.join(ROOT, '_sheets');
const only = process.argv[2];

function readPng(file) {
	return PNG.sync.read(fs.readFileSync(file));
}

function writePng(file, png) {
	fs.writeFileSync(file, PNG.sync.write(png));
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
			const a = data[i + 3];
			const lum = data[i] + data[i + 1] + data[i + 2];
			if (a < 8 || lum < 12) {
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

function resizeTo(src, box, dw, dh) {
	const dst = new PNG({ width: dw, height: dh, colorType: 6 });
	const bw = box.x1 - box.x0;
	const bh = box.y1 - box.y0;
	for (let y = 0; y < dh; y++) {
		for (let x = 0; x < dw; x++) {
			const fx = box.x0 + ((x + 0.5) * bw) / dw - 0.5;
			const fy = box.y0 + ((y + 0.5) * bh) / dh - 0.5;
			const [r, g, b, a] = sampleBilinear(src, fx, fy);
			const i = (y * dw + x) * 4;
			dst.data[i] = r;
			dst.data[i + 1] = g;
			dst.data[i + 2] = b;
			dst.data[i + 3] = a;
		}
	}
	return dst;
}

function crop(src, x, y, w, h) {
	const dst = new PNG({ width: w, height: h, colorType: 6 });
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

const kinds = fs
	.readdirSync(SHEETS)
	.filter((name) => name.endsWith('.json'))
	.map((name) => name.replace(/\.json$/, ''))
	.filter((kind) => !only || kind === only);

if (kinds.length === 0) {
	console.error(only ? `no manifest for ${only}` : `no manifests in ${SHEETS}`);
	process.exit(1);
}

for (const kind of kinds) {
	const depthPath = path.join(SHEETS, `${kind}_d.png`);
	if (!fs.existsSync(depthPath)) {
		console.log(`skip (no ${kind}_d.png)`);
		continue;
	}
	const manifest = JSON.parse(fs.readFileSync(path.join(SHEETS, `${kind}.json`), 'utf8'));
	const src = readPng(depthPath);
	const fitted = resizeTo(src, contentBox(src), manifest.sheetW, manifest.sheetH);
	const outDir = path.join(ROOT, kind);
	for (const cell of manifest.cells) {
		const slice = crop(fitted, cell.x, cell.y, cell.w, cell.h);
		const dest = path.join(outDir, `${cell.stem}_d.png`);
		writePng(dest, slice);
	}
	console.log(`unpacked ${manifest.cells.length} ${kind} depths -> ${outDir}`);
}
