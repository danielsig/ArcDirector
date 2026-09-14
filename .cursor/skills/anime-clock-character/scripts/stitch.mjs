#!/usr/bin/env node
/**
 * Magenta-key walk helpers: XOR silhouettes, stitch by figure height, FlipX per cell.
 *
 *   node .cursor/skills/anime-clock-character/scripts/stitch.mjs split STRIP.png --cells 4 --out prefix
 *   node .cursor/skills/anime-clock-character/scripts/stitch.mjs split STRIP.png --grid 2x4 --out prefix
 *   node .cursor/skills/anime-clock-character/scripts/stitch.mjs grid-pack c0.png … c7.png --grid 2x4 --out sheet.png
 *   node .cursor/skills/anime-clock-character/scripts/stitch.mjs xor-cells a.png b.png
 *   node .cursor/skills/anime-clock-character/scripts/stitch.mjs stitch4 c0.png c1.png c2.png c3.png --out walk_04.png
 *   node .cursor/skills/anime-clock-character/scripts/stitch.mjs flipx-cells walk_04.png --out walk_08.png
 *   node .cursor/skills/anime-clock-character/scripts/stitch.mjs cycle contact.png passing.png --out walk_06.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { PNG } = createRequire(path.resolve(here, '../../../../game/package.json'))('pngjs');
const MAG = [255, 0, 255];

function read(p) {
	return PNG.sync.read(fs.readFileSync(path.isAbsolute(p) ? p : path.join(here, p)));
}

function write(p, png) {
	const abs = path.isAbsolute(p) ? p : path.join(here, p);
	fs.writeFileSync(abs, PNG.sync.write(png));
	return abs;
}

function empty(w, h) {
	const p = new PNG({ width: w, height: h, colorType: 6 });
	for (let i = 0; i < p.data.length; i += 4) {
		p.data[i] = MAG[0];
		p.data[i + 1] = MAG[1];
		p.data[i + 2] = MAG[2];
		p.data[i + 3] = 255;
	}
	return p;
}

function isMag(d, i) {
	const r = d[i];
	const g = d[i + 1];
	const b = d[i + 2];
	return g < 70 && r > 160 && b > 140 && g < r * 0.45;
}

function crop(src, x0, y0, w, h) {
	const dst = new PNG({ width: w, height: h, colorType: 6 });
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const si = ((y0 + y) * src.width + (x0 + x)) * 4;
			const di = (y * w + x) * 4;
			dst.data[di] = src.data[si];
			dst.data[di + 1] = src.data[si + 1];
			dst.data[di + 2] = src.data[si + 2];
			dst.data[di + 3] = src.data[si + 3] ?? 255;
		}
	}
	return dst;
}

function scale(src, dw, dh) {
	const dst = new PNG({ width: dw, height: dh, colorType: 6 });
	for (let y = 0; y < dh; y++) {
		for (let x = 0; x < dw; x++) {
			const sx = Math.min(src.width - 1, Math.floor((x + 0.5) * src.width / dw));
			const sy = Math.min(src.height - 1, Math.floor((y + 0.5) * src.height / dh));
			const si = (sy * src.width + sx) * 4;
			const di = (y * dw + x) * 4;
			dst.data[di] = src.data[si];
			dst.data[di + 1] = src.data[si + 1];
			dst.data[di + 2] = src.data[si + 2];
			dst.data[di + 3] = src.data[si + 3] ?? 255;
		}
	}
	return dst;
}

function bbox(png) {
	let minX = png.width;
	let minY = png.height;
	let maxX = 0;
	let maxY = 0;
	for (let y = 0; y < png.height; y++) {
		for (let x = 0; x < png.width; x++) {
			const i = (y * png.width + x) * 4;
			if (isMag(png.data, i)) continue;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
	}
	if (maxX < minX) return null;
	return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function blitCopy(dst, src, dx, dy) {
	for (let y = 0; y < src.height; y++) {
		for (let x = 0; x < src.width; x++) {
			const tx = dx + x;
			const ty = dy + y;
			if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
			const si = (y * src.width + x) * 4;
			const di = (ty * dst.width + tx) * 4;
			dst.data[di] = src.data[si];
			dst.data[di + 1] = src.data[si + 1];
			dst.data[di + 2] = src.data[si + 2];
			dst.data[di + 3] = src.data[si + 3] ?? 255;
		}
	}
}

function parseGrid(s) {
	const m = /^(\d+)x(\d+)$/i.exec(String(s || '').trim());
	if (!m) throw new Error(`bad --grid ${s} (want e.g. 2x4)`);
	const rows = Number(m[1]);
	const cols = Number(m[2]);
	if (rows < 1 || cols < 1) throw new Error(`bad --grid ${s}`);
	return { rows, cols };
}

function gridCells(src, rows, cols) {
	const cw = Math.floor(src.width / cols);
	const ch = Math.floor(src.height / rows);
	const cells = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			cells.push(crop(src, c * cw, r * ch, cw, ch));
		}
	}
	return cells;
}

function blitOpaque(dst, src, dx, dy) {
	for (let y = 0; y < src.height; y++) {
		for (let x = 0; x < src.width; x++) {
			const tx = dx + x;
			const ty = dy + y;
			if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
			const si = (y * src.width + x) * 4;
			if (isMag(src.data, si)) continue;
			const di = (ty * dst.width + tx) * 4;
			dst.data[di] = src.data[si];
			dst.data[di + 1] = src.data[si + 1];
			dst.data[di + 2] = src.data[si + 2];
			dst.data[di + 3] = 255;
		}
	}
}

function opaqueAt(png, x, y) {
	if (x < 0 || y < 0 || x >= png.width || y >= png.height) return false;
	return !isMag(png.data, (y * png.width + x) * 4);
}

function xorFrac(a, b, y0frac = 0.4, y1frac = 1) {
	const ba = bbox(a);
	const bb = bbox(b);
	if (!ba || !bb) return { xor: 0, reason: 'empty' };
	const w = Math.max(ba.w, bb.w);
	const h = Math.max(ba.h, bb.h);
	const ca = crop(a, ba.x, ba.y, ba.w, ba.h);
	const cb = crop(b, bb.x, bb.y, bb.w, bb.h);
	const sa = scale(ca, w, h);
	const sb = scale(cb, w, h);
	const y0 = Math.floor(h * y0frac);
	const y1 = Math.floor(h * y1frac);
	let n = 0;
	let d = 0;
	for (let y = y0; y < y1; y++) {
		for (let x = 0; x < w; x++) {
			n += 1;
			if (opaqueAt(sa, x, y) !== opaqueAt(sb, x, y)) d += 1;
		}
	}
	return { xor: n ? d / n : 0, w, h, ba, bb };
}

function splitPair(src) {
	const mid = Math.floor(src.width / 2);
	return [crop(src, 0, 0, mid, src.height), crop(src, mid, 0, src.width - mid, src.height)];
}

function stripCells(src, nHint) {
	let n = nHint;
	if (!n) {
		if (src.width === 4096 && src.height === 1536) n = 4;
		else if (src.width === 1536 && src.height === 1024) n = 4;
		else if (src.width > src.height * 1.8) n = 4;
		else if (src.width > src.height * 1.2) n = 2;
		else n = 1;
	}
	const cw = Math.floor(src.width / n);
	return Array.from({ length: n }, (_, i) => crop(src, i * cw, 0, cw, src.height));
}

function fitIntoCell(src, cw, ch, figH, headY) {
	const rb = bbox(src);
	if (!rb) throw new Error('no figure');
	const cropped = crop(src, rb.x, rb.y, rb.w, rb.h);
	const s = Math.min((cw - 8) / cropped.width, figH / cropped.height);
	const dw = Math.max(1, Math.round(cropped.width * s));
	const dh = Math.max(1, Math.round(cropped.height * s));
	const scaled = scale(cropped, dw, dh);
	const cell = empty(cw, ch);
	blitOpaque(cell, scaled, Math.floor((cw - dw) / 2), headY);
	return { cell, dw, dh, rb, s };
}

function flipX(src) {
	const dst = empty(src.width, src.height);
	for (let y = 0; y < src.height; y++) {
		for (let x = 0; x < src.width; x++) {
			const si = (y * src.width + x) * 4;
			const di = (y * src.width + (src.width - 1 - x)) * 4;
			dst.data[di] = src.data[si];
			dst.data[di + 1] = src.data[si + 1];
			dst.data[di + 2] = src.data[si + 2];
			dst.data[di + 3] = src.data[si + 3];
		}
	}
	return dst;
}

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'xor') {
	const src = read(args[1]);
	const cells = src.width >= src.height ? stripCells(src) : [src];
	const pairs = [];
	if (cells.length >= 2) pairs.push(['0vs1', xorFrac(cells[0], cells[1])]);
	if (cells.length >= 4) {
		pairs.push(['0vs2', xorFrac(cells[0], cells[2])]);
		pairs.push(['1vs3', xorFrac(cells[1], cells[3])]);
	}
	console.log(JSON.stringify({
		file: args[1],
		size: [src.width, src.height],
		n: cells.length,
		pairs: Object.fromEntries(pairs.map(([k, v]) => [k, { xor: Number(v.xor.toFixed(3)), ba: v.ba, bb: v.bb }])),
	}, null, 2));
} else if (cmd === 'xor-cells') {
	const a = read(args[1]);
	const b = read(args[2]);
	const v = xorFrac(a, b);
	console.log(JSON.stringify({ a: args[1], b: args[2], xor: Number(v.xor.toFixed(3)), ba: v.ba, bb: v.bb }, null, 2));
} else if (cmd === 'split') {
	const src = read(args[1]);
	const outI = args.indexOf('--out');
	const prefix = outI >= 0 ? args[outI + 1] : 'split';
	const gridI = args.indexOf('--grid');
	const cellsI = args.indexOf('--cells');
	const nHint = cellsI >= 0 ? Number(args[cellsI + 1]) : undefined;
	let cells;
	if (gridI >= 0) {
		const { rows, cols } = parseGrid(args[gridI + 1]);
		cells = gridCells(src, rows, cols);
	} else {
		cells = nHint
			? stripCells(src, nHint)
			: (src.width > src.height * 1.5 ? stripCells(src) : splitPair(src));
	}
	cells.forEach((c, i) => write(`${prefix}_${i}.png`, c));
	console.log('split', cells.length, prefix, cells[0] ? cells[0].width + 'x' + cells[0].height : '');
} else if (cmd === 'grid-pack') {
	const outI = args.indexOf('--out');
	const gridI = args.indexOf('--grid');
	const { rows, cols } = parseGrid(gridI >= 0 ? args[gridI + 1] : '2x4');
	const n = rows * cols;
	const files = args.slice(1).filter((a, i, arr) => a !== '--out' && arr[i - 1] !== '--out' && a !== '--grid' && arr[i - 1] !== '--grid');
	if (files.length !== n) throw new Error(`grid-pack wants ${n} pngs, got ${files.length}`);
	const raw = files.map(read);
	const cw = raw[0].width;
	const ch = raw[0].height;
	for (const p of raw) {
		if (p.width !== cw || p.height !== ch) throw new Error(`grid-pack cell size mismatch ${p.width}x${p.height} vs ${cw}x${ch}`);
	}
	const out = empty(cw * cols, ch * rows);
	raw.forEach((src, i) => {
		const c = i % cols;
		const r = Math.floor(i / cols);
		blitCopy(out, src, c * cw, r * ch);
	});
	const outName = outI >= 0 ? args[outI + 1] : 'grid.png';
	write(outName, out);
	console.log('grid-pack', outName, out.width + 'x' + out.height, `${rows}x${cols}`, cw + 'x' + ch);
} else if (cmd === 'stitch') {
	const files = args.slice(1, 5);
	const outI = args.indexOf('--out');
	const outName = outI >= 0 ? args[outI + 1] : 'walk_stitched.png';
	const raw = files.map(read);
	const ref = bbox(raw[0]);
	if (!ref) throw new Error('no figure in cell 0');
	const cw = raw[0].width;
	const ch = raw[0].height;
	const figH = ref.h;
	const headY = ref.y;
	const fitted = raw.map((src, i) => {
		if (i === 0 && src.width === cw && src.height === ch) {
			return { cell: src, dw: bbox(src).w, dh: bbox(src).h, rb: bbox(src), s: 1 };
		}
		return fitIntoCell(src, cw, ch, figH, headY);
	});
	const out = empty(cw * 4, ch);
	fitted.forEach((f, i) => blitOpaque(out, f.cell, i * cw, 0));
	write(outName, out);
	fitted.forEach((f, i) => write(outName.replace(/\.png$/, `_cell_${i}.png`), f.cell));
	const x02 = xorFrac(fitted[0].cell, fitted[2].cell);
	const x13 = xorFrac(fitted[1].cell, fitted[3].cell);
	console.log(JSON.stringify({
		out: outName,
		headY,
		figH,
		cells: fitted.map((f) => ({ dw: f.dw, dh: f.dh, rb: f.rb, s: Number(f.s.toFixed(3)) })),
		xor02: Number(x02.xor.toFixed(3)),
		xor13: Number(x13.xor.toFixed(3)),
	}, null, 2));
} else if (cmd === 'flipx') {
	const src = read(args[1]);
	const outI = args.indexOf('--out');
	const outName = outI >= 0 ? args[outI + 1] : args[1].replace(/\.png$/, '_flipx.png');
	write(outName, flipX(src));
	console.log('flipx', outName);
} else if (cmd === 'cycle') {
	const contact = read(args[1]);
	const passing = read(args[2]);
	const outI = args.indexOf('--out');
	const outName = outI >= 0 ? args[outI + 1] : 'walk_cycle.png';
	const cw = 1024;
	const ch = 1536;
	const figH = Math.round(ch * 0.88);
	const headY = Math.round(ch * 0.06);
	const c0 = fitIntoCell(contact, cw, ch, figH, headY);
	const c1 = fitIntoCell(passing, cw, ch, figH, headY);
	const c2 = { cell: flipX(c0.cell) };
	const c3 = { cell: flipX(c1.cell) };
	const fitted = [c0, c1, c2, c3];
	const out = empty(cw * 4, ch);
	fitted.forEach((f, i) => blitOpaque(out, f.cell, i * cw, 0));
	write(outName, out);
	fitted.forEach((f, i) => write(outName.replace(/\.png$/, `_cell_${i}.png`), f.cell));
	console.log(JSON.stringify({
		out: outName,
		xor02: Number(xorFrac(c0.cell, c2.cell).xor.toFixed(3)),
		xor13: Number(xorFrac(c1.cell, c3.cell).xor.toFixed(3)),
		xor01: Number(xorFrac(c0.cell, c1.cell).xor.toFixed(3)),
	}, null, 2));
} else if (cmd === 'diff') {
	const a = read(args[1]);
	const b = read(args[2]);
	const ba = bbox(a);
	const bb = bbox(b);
	const w = Math.max(ba.w, bb.w);
	const h = Math.max(ba.h, bb.h);
	const sa = scale(crop(a, ba.x, ba.y, ba.w, ba.h), w, h);
	const sb = scale(crop(b, bb.x, bb.y, bb.w, bb.h), w, h);
	const out = empty(w, h);
	let d = 0;
	let n = 0;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			n += 1;
			const oa = opaqueAt(sa, x, y);
			const ob = opaqueAt(sb, x, y);
			const i = (y * w + x) * 4;
			if (oa && ob) {
				out.data[i] = 80;
				out.data[i + 1] = 80;
				out.data[i + 2] = 80;
			} else if (oa) {
				d += 1;
				out.data[i] = 255;
				out.data[i + 1] = 40;
				out.data[i + 2] = 40;
			} else if (ob) {
				d += 1;
				out.data[i] = 40;
				out.data[i + 1] = 80;
				out.data[i + 2] = 255;
			}
		}
	}
	const outName = args[3] || 'diff.png';
	write(outName, out);
	console.log(JSON.stringify({ xor: Number((d / n).toFixed(3)), w, h, out: outName }));
} else if (cmd === 'audit') {
	const dir = args[1] ? (path.isAbsolute(args[1]) ? args[1] : path.join(here, args[1])) : here;
	const files = fs.readdirSync(dir).filter((f) => /^walk_\d+_anime\.png$/i.test(f)).sort();
	for (const f of files) {
		const src = read(path.join(dir, f));
		const cells = src.width >= src.height ? stripCells(src) : [src];
		const row = { file: f, n: cells.length, size: [src.width, src.height] };
		if (cells.length >= 2) row['0vs1'] = Number(xorFrac(cells[0], cells[1]).xor.toFixed(3));
		if (cells.length >= 4) {
			row['0vs2'] = Number(xorFrac(cells[0], cells[2]).xor.toFixed(3));
			row['1vs3'] = Number(xorFrac(cells[1], cells[3]).xor.toFixed(3));
		}
		console.log(JSON.stringify(row));
	}
} else if (cmd === 'stitch4') {
	const files = args.slice(1, 5);
	const outI = args.indexOf('--out');
	const outName = outI >= 0 ? args[outI + 1] : 'walk_stitched.png';
	const cw = 1024;
	const ch = 1536;
	const figH = Math.round(ch * 0.88);
	const headY = Math.round(ch * 0.06);
	const fitted = files.map((f) => fitIntoCell(read(f), cw, ch, figH, headY));
	const out = empty(cw * 4, ch);
	fitted.forEach((f, i) => blitOpaque(out, f.cell, i * cw, 0));
	write(outName, out);
	fitted.forEach((f, i) => write(outName.replace(/\.png$/, `_cell_${i}.png`), f.cell));
	console.log(JSON.stringify({
		out: outName,
		xor02: Number(xorFrac(fitted[0].cell, fitted[2].cell).xor.toFixed(3)),
		xor13: Number(xorFrac(fitted[1].cell, fitted[3].cell).xor.toFixed(3)),
		xor01: Number(xorFrac(fitted[0].cell, fitted[1].cell).xor.toFixed(3)),
		xor23: Number(xorFrac(fitted[2].cell, fitted[3].cell).xor.toFixed(3)),
	}, null, 2));
} else if (cmd === 'flipx-cells') {
	const src = read(args[1]);
	const cells = stripCells(src, 4);
	const outI = args.indexOf('--out');
	const outName = outI >= 0 ? args[outI + 1] : args[1].replace(/\.png$/, '_flipx.png');
	const out = empty(src.width, src.height);
	cells.forEach((c, i) => blitOpaque(out, flipX(c), i * c.width, 0));
	write(outName, out);
	console.log('flipx-cells', outName, { xor02: Number(xorFrac(flipX(cells[0]), flipX(cells[2])).xor.toFixed(3)), xor13: Number(xorFrac(flipX(cells[1]), flipX(cells[3])).xor.toFixed(3)) });
} else {
	console.error('usage: xor|xor-cells|split|grid-pack|stitch|stitch4|flipx|flipx-cells|cycle|diff|audit');
	process.exit(1);
}
