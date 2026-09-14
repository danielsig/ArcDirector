/**
 * Downscale environment PNG/JPEG in public/ (not characters/) for VRAM.
 *   node scripts/downscale_env.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/nature');
/** Tall cutouts (trees, fall) half to 768; square tiles cap at 512. Wide strips keep more width. */
const MAX_TALL = 768;
const MAX_SQUARE = 512;
const MAX_WIDE = 1024;

function pngSize(buf) {
	if (buf.length < 24 || buf[0] !== 0x89) {
		return null;
	}
	return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function jpegSize(buf) {
	if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
		return null;
	}
	let i = 2;
	while (i + 9 < buf.length) {
		if (buf[i] !== 0xff) {
			i += 1;
			continue;
		}
		const marker = buf[i + 1];
		if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
			return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
		}
		const len = buf.readUInt16BE(i + 2);
		i += 2 + len;
	}
	return null;
}

function isMagenta(r, g, b) {
	return r > 120 && b > 120 && g < 130 && (r + b) > g * 2.15;
}

function maxSide(w, h) {
	const ratio = w / h;
	if (ratio > 2 || ratio < 0.5) {
		return MAX_WIDE;
	}
	if (h / w >= 1.4) {
		return MAX_TALL;
	}
	return MAX_SQUARE;
}

function targetSize(w, h) {
	const cap = maxSide(w, h);
	if (Math.max(w, h) <= cap) {
		return null;
	}
	const scale = cap / Math.max(w, h);
	return {
		w: Math.max(1, Math.round(w * scale)),
		h: Math.max(1, Math.round(h * scale)),
	};
}

function resizePng(src, nw, nh) {
	const out = new PNG({ width: nw, height: nh });
	const xRatio = src.width / nw;
	const yRatio = src.height / nh;
	for (let y = 0; y < nh; y++) {
		const sy0 = Math.floor(y * yRatio);
		const sy1 = Math.max(sy0 + 1, Math.min(src.height, Math.ceil((y + 1) * yRatio)));
		for (let x = 0; x < nw; x++) {
			const sx0 = Math.floor(x * xRatio);
			const sx1 = Math.max(sx0 + 1, Math.min(src.width, Math.ceil((x + 1) * xRatio)));
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			let n = 0;
			let keys = 0;
			for (let sy = sy0; sy < sy1; sy++) {
				for (let sx = sx0; sx < sx1; sx++) {
					const i = (sy * src.width + sx) << 2;
					const sr = src.data[i];
					const sg = src.data[i + 1];
					const sb = src.data[i + 2];
					if (isMagenta(sr, sg, sb)) {
						keys += 1;
						continue;
					}
					r += sr;
					g += sg;
					b += sb;
					a += src.data[i + 3];
					n += 1;
				}
			}
			const o = (y * nw + x) << 2;
			if (n === 0) {
				out.data[o] = 255;
				out.data[o + 1] = 0;
				out.data[o + 2] = 255;
				out.data[o + 3] = 255;
				continue;
			}
			out.data[o] = Math.round(r / n);
			out.data[o + 1] = Math.round(g / n);
			out.data[o + 2] = Math.round(b / n);
			out.data[o + 3] = Math.round(a / n);
			if (keys > n && isMagenta(out.data[o], out.data[o + 1], out.data[o + 2])) {
				out.data[o] = 255;
				out.data[o + 1] = 0;
				out.data[o + 2] = 255;
			}
		}
	}
	return out;
}

function walk(dir, acc) {
	for (const name of fs.readdirSync(dir)) {
		if (name.startsWith('.')) {
			continue;
		}
		const full = path.join(dir, name);
		const st = fs.statSync(full);
		if (st.isDirectory()) {
			walk(full, acc);
			continue;
		}
		const ext = path.extname(name).toLowerCase();
		if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') {
			continue;
		}
		acc.push(full);
	}
	return acc;
}

const files = walk(ROOT, []);
const rows = [];
for (const file of files) {
	const buf = fs.readFileSync(file);
	const size = pngSize(buf) ?? jpegSize(buf);
	if (!size) {
		continue;
	}
	const rel = path.relative(ROOT, file).replaceAll('\\', '/');
	const px = size.w * size.h;
	rows.push({ file, rel, ...size, px, bytes: buf.length, png: buf[0] === 0x89 });
}
rows.sort((a, b) => b.px - a.px);
for (const r of rows) {
	const next = r.png ? targetSize(r.w, r.h) : null;
	const mark = next ? ` → ${next.w}×${next.h}` : '';
	console.log(`${String(r.w).padStart(5)}×${String(r.h).padStart(5)}  ${(r.bytes / 1024).toFixed(0).padStart(6)}KB  ${r.rel}${mark}`);
}

const dry = process.argv.includes('--dry');
let wrote = 0;
for (const r of rows) {
	if (!r.png) {
		continue;
	}
	const next = targetSize(r.w, r.h);
	if (!next || dry) {
		continue;
	}
	const src = PNG.sync.read(fs.readFileSync(r.file));
	const out = resizePng(src, next.w, next.h);
	fs.writeFileSync(r.file, PNG.sync.write(out));
	wrote += 1;
	console.log(`wrote ${r.rel} ${r.w}×${r.h} → ${next.w}×${next.h}`);
}
if (!dry) {
	console.log(`downscaled ${wrote} pngs`);
}
