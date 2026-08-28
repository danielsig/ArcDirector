/**
 * Pack each character's albedo frames into one 8×4 spritesheet.
 *
 *   node game/scripts/pack_character_sheets.mjs
 *
 * Writes game/public/characters/_sheets/{kind}.png and {kind}.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/characters');
const OUT = path.join(ROOT, '_sheets');
const KINDS = ['player', 'guard', 'robe', 'merchant', 'princess', 'sorceress'];
const COLS = 8;
const ROWS = 4;
const FRAMES = [
	'idle_01', 'idle_02', 'idle_03', 'idle_04', 'idle_05', 'idle_06', 'idle_12',
	'walk_02_0', 'walk_02_1', 'walk_02_2', 'walk_02_3',
	'walk_04_0', 'walk_04_1', 'walk_04_2', 'walk_04_3',
	'walk_06_0', 'walk_06_1', 'walk_06_2', 'walk_06_3',
	'walk_12_0', 'walk_12_1', 'walk_12_2', 'walk_12_3',
	'take_06_0', 'take_06_1', 'take_06_2', 'take_06_3',
	'take_06_4', 'take_06_5', 'take_06_6', 'take_06_7',
];

function readPng(file) {
	return PNG.sync.read(fs.readFileSync(file));
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

function packKind(kind) {
	const dir = path.join(ROOT, kind);
	const pngs = FRAMES.map((stem) => {
		const file = path.join(dir, `${stem}.png`);
		if (!fs.existsSync(file)) {
			throw new Error(`missing ${file}`);
		}
		return { stem, png: readPng(file) };
	});
	const cellW = Math.max(...pngs.map((p) => p.png.width));
	const cellH = Math.max(...pngs.map((p) => p.png.height));
	const sheet = new PNG({ width: cellW * COLS, height: cellH * ROWS, colorType: 6 });
	sheet.data.fill(0);
	const cells = [];
	for (let i = 0; i < pngs.length; i++) {
		const col = i % COLS;
		const row = Math.floor(i / COLS);
		const { stem, png } = pngs[i];
		const ox = col * cellW + Math.floor((cellW - png.width) / 2);
		const oy = row * cellH + (cellH - png.height);
		blit(sheet, png, ox, oy);
		cells.push({
			stem,
			col,
			row,
			x: ox,
			y: oy,
			w: png.width,
			h: png.height,
		});
	}
	fs.mkdirSync(OUT, { recursive: true });
	const pngPath = path.join(OUT, `${kind}.png`);
	fs.writeFileSync(pngPath, PNG.sync.write(sheet));
	const manifest = {
		kind,
		cols: COLS,
		rows: ROWS,
		cellW,
		cellH,
		sheetW: sheet.width,
		sheetH: sheet.height,
		cells,
	};
	fs.writeFileSync(path.join(OUT, `${kind}.json`), `${JSON.stringify(manifest, null, '\t')}\n`);
	console.log(`packed ${kind} ${sheet.width}x${sheet.height} -> ${pngPath}`);
}

for (const kind of KINDS) {
	packKind(kind);
}
