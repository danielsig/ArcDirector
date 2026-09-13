#!/usr/bin/env node
/**
 * Kindling tokens → piano-roll SVG (one column per key, time runs down). No packages.
 *
 *   node scripts/roll.mjs INPUT -o OUT.svg [--beats 4] [--title TEXT]
 *
 * INPUT is a .score.txt path, `-` for stdin, or a token string.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STEP = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

const SUFFIX = {
	'': [0, 4, 7],
	m: [0, 3, 7],
	'-': [0, 3, 7],
	min: [0, 3, 7],
	dim: [0, 3, 6],
	aug: [0, 4, 8],
	'+': [0, 4, 8],
	sus2: [0, 2, 7],
	sus4: [0, 5, 7],
	'7': [0, 4, 7, 10],
	maj7: [0, 4, 7, 11],
	m7: [0, 3, 7, 10],
	'-7': [0, 3, 7, 10],
	m7b5: [0, 3, 6, 10],
};

const PC = ['c', 'c#', 'd', 'eb', 'e', 'f', 'f#', 'g', 'ab', 'a', 'bb', 'b'];
const PRETTY = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);

export function pitch(tok) {
	if (/[!>]/.test(tok)) {
		throw new Error(`no accent suffix in ${tok}`);
	}
	const m = /^([a-g])([#b]?)(-?\d+)$/i.exec(tok.trim());
	if (!m?.[1] || m[3] === undefined) {
		throw new Error(`bad pitch ${tok}`);
	}
	const step = STEP[m[1].toLowerCase()];
	if (step === undefined) {
		throw new Error(`bad pitch ${tok}`);
	}
	return (Number(m[3]) + 1) * 12 + step + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function tok(midi) {
	const pc = ((midi % 12) + 12) % 12;
	return `${PC[pc]}${Math.floor(midi / 12) - 1}`;
}

function pretty(midi) {
	const pc = ((midi % 12) + 12) % 12;
	return `${PRETTY[pc]}${Math.floor(midi / 12) - 1}`;
}

function tokens(src) {
	return src.split(/\s+/).filter(Boolean);
}

function atom(raw, dur) {
	if (raw === 'r' || raw === '.') {
		return { pitch: null, dur };
	}
	return { pitch: pitch(raw), dur };
}

function timed(raw) {
	const split = raw.split(':');
	const dur = Number(split[1]);
	if (!Number.isFinite(dur) || dur <= 0) {
		throw new Error(`bad duration in ${raw}`);
	}
	return atom(split[0] ?? '', dur);
}

function parseCell(toks) {
	const colon = toks.some((t) => t.includes(':'));
	const bare = toks.some((t) => !t.includes(':'));
	if (colon && bare) {
		throw new Error(`mix :n and durationless in ${toks.join(' ')}`);
	}
	if (!colon) {
		const d = 1 / toks.length;
		return toks.map((t) => atom(t, d));
	}
	return toks.map(timed);
}

/** `d4:2 e4:1 r:1 | f4:4` — `|` visual when timed. Durationless cells split one beat. */
export function line(src, start = 0) {
	const cells = src.includes('|') ? src.split('|') : [src];
	const ev = [];
	for (const cell of cells) {
		const toks = tokens(cell);
		if (toks.length) {
			ev.push(...parseCell(toks));
		}
	}
	const notes = [];
	let beat = start;
	for (const e of ev) {
		if (e.pitch !== null) {
			notes.push({ pitch: e.pitch, beat, dur: e.dur });
		}
		beat += e.dur;
	}
	return notes;
}

function lineSpan(src) {
	return line(src).reduce((end, n) => Math.max(end, n.beat + n.dur), 0);
}

function parseChord(symbol) {
	const m = /^([A-G])([#b]?)(.*)$/.exec(symbol.trim());
	if (!m?.[1]) {
		throw new Error(`bad chord ${symbol}`);
	}
	let rest = m[3] ?? '';
	let oct = 3;
	const octHit = rest.match(/^(.*)(\d)$/);
	if (SUFFIX[rest] === undefined && octHit && SUFFIX[octHit[1]] !== undefined) {
		rest = octHit[1] ?? '';
		oct = Number(octHit[2]);
	}
	const iv = SUFFIX[rest];
	if (!iv) {
		throw new Error(`bad chord suffix ${symbol}`);
	}
	const root = pitch(`${m[1].toLowerCase()}${m[2] ?? ''}${oct}`);
	return iv.map((s) => root + s);
}

function stripComments(src) {
	return src.replace(/^[ \t]*#.*$/gm, '');
}

function parseBarHead(raw) {
	const s = raw.trim();
	const m = /^(?:bar\s*\(\s*([\d.]+)|bar\s+([\d.]+))/i.exec(s);
	if (!m) {
		return null;
	}
	const beats = Number(m[1] ?? m[2]);
	if (!(beats > 0)) {
		throw new Error('bar beats');
	}
	let rest = s.slice(m[0].length).replace(/^[\s,]+/, '');
	if (/^bar\s*\(/i.test(s) && rest.endsWith(')')) {
		rest = rest.slice(0, -1).trim();
	}
	return { beats, rest: rest.trim() };
}

function extractMatters(s) {
	const matters = [];
	let rest = s.trim();
	if (!rest) {
		return matters;
	}

	const consume = (re, fn) => {
		rest = rest.replace(re, (...args) => {
			const m = fn(...args);
			if (m) {
				matters.push(m);
			}
			return ' ';
		});
	};

	consume(/stack\(\s*\[([^\]]*)\]\s*(?:,\s*([\d.]+))?\s*\)/gi, (_full, inner, beats) => {
		const notes = inner.split(/[,\s]+/).map((t) => t.replace(/['"]/g, '').trim()).filter(Boolean);
		return { kind: 'block', pitches: notes.map(pitch), beats: beats ? Number(beats) : undefined };
	});
	consume(/chord\(\s*['"]([^'"]+)['"]\s*(?:,\s*([\d.]+))?\s*\)/gi, (_full, sym, beats) => {
		return { kind: 'block', pitches: parseChord(sym), beats: beats ? Number(beats) : undefined };
	});
	consume(/'([^']+)'|"([^"]+)"/g, (_full, a, b) => {
		const src = (a ?? b ?? '').trim();
		return src ? { kind: 'line', src } : null;
	});
	consume(/\bstack\b((?:\s+[a-g][#b]?-?\d+)+)(?:\s*[,:]?\s*([\d.]+))?/gi, (_full, body, beats) => {
		const notes = body.trim().split(/\s+/);
		return { kind: 'block', pitches: notes.map(pitch), beats: beats ? Number(beats) : undefined };
	});
	consume(/\bchord\b\s+([A-G][#b]?[A-Za-z0-9+-]*)(?:\s+([\d.]+))?/g, (_full, sym, beats) => {
		return { kind: 'block', pitches: parseChord(sym), beats: beats ? Number(beats) : undefined };
	});

	rest = rest.replace(/[(),;]/g, ' ').replace(/\s+/g, ' ').trim();
	if (rest) {
		matters.push({ kind: 'line', src: rest });
	}
	return matters;
}

function parseScore(src, defaultBeats) {
	const lines = stripComments(src).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	const bars = [];
	let current = null;
	let sawBar = false;

	const flush = () => {
		if (current) {
			bars.push(current);
		}
		current = null;
	};

	for (const lineText of lines) {
		const head = parseBarHead(lineText);
		if (head) {
			flush();
			sawBar = true;
			current = { beats: head.beats, matters: [] };
			if (head.rest) {
				current.matters.push(...extractMatters(head.rest));
			}
			continue;
		}
		if (!current) {
			current = { beats: defaultBeats, matters: [] };
		}
		current.matters.push(...extractMatters(lineText));
	}
	flush();
	return { bars, sawBar };
}

function emitMatter(m, barBeats, at) {
	if (m.kind === 'line') {
		return line(m.src, at);
	}
	const dur = m.beats ?? barBeats;
	return m.pitches.map((p) => ({ pitch: p, beat: at, dur }));
}

function compile(src, defaultBeats) {
	const { bars, sawBar } = parseScore(src, defaultBeats);
	if (!bars.length) {
		throw new Error('no score');
	}
	const notes = [];
	const barlines = [0];
	let origin = 0;
	for (const b of bars) {
		let local = 0;
		for (const m of b.matters) {
			const chunk = emitMatter(m, b.beats, origin);
			for (const n of chunk) {
				local = Math.max(local, n.beat + n.dur - origin);
				notes.push(n);
			}
			if (m.kind === 'line') {
				local = Math.max(local, lineSpan(m.src));
			}
			else {
				local = Math.max(local, m.beats ?? b.beats);
			}
		}
		if (sawBar && local > b.beats + 1e-6) {
			throw new Error(`part longer than bar (${local} > ${b.beats})`);
		}
		origin += sawBar ? b.beats : Math.max(b.beats, local);
		barlines.push(origin);
	}
	if (!notes.length) {
		throw new Error('no notes');
	}
	const total = barlines[barlines.length - 1] ?? origin;
	if (!sawBar) {
		const ticks = [0];
		for (let b = defaultBeats; b < total - 1e-9; b += defaultBeats) {
			ticks.push(b);
		}
		ticks.push(total);
		return { notes, barlines: ticks, total, sawBar };
	}
	return { notes, barlines, total, sawBar };
}

function esc(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function metrics(model) {
	const { notes, total } = model;
	const cell = 13;
	const beatH = 56;
	const keyH = 42;
	const padL = 52;
	const padR = 16;
	const titleH = 28;
	const padB = 16;
	let lo = Math.min(...notes.map((n) => n.pitch)) - 1;
	let hi = Math.max(...notes.map((n) => n.pitch)) + 1;
	const cols = hi - lo + 1;
	const innerW = cols * cell;
	const innerH = Math.max(total, 1) * beatH;
	const w = padL + innerW + padR;
	const xOf = (p) => padL + (p - lo) * cell;
	const yOf = (beat) => beat * beatH;
	return { cell, beatH, keyH, padL, padR, titleH, padB, lo, hi, cols, innerW, innerH, w, xOf, yOf };
}

function svgOpen(w, h) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="ui-sans-serif, system-ui, sans-serif">`;
}

function drawTitle(parts, m, opts) {
	parts.push(`<rect width="${m.w}" height="${m.titleH}" fill="#f3efe6"/>`);
	parts.push(`<text x="${m.padL}" y="18" font-size="13" font-weight="700" fill="#2a241c">${esc(opts.title)}</text>`);
	parts.push(`<text x="${m.w - m.padR}" y="18" font-size="10" fill="#6a6358" text-anchor="end">column = key · length = beats</text>`);
}

function drawKeys(parts, m, y0) {
	parts.push(`<rect x="0" y="${y0}" width="${m.w}" height="${m.keyH}" fill="#f3efe6"/>`);
	for (let p = m.lo; p <= m.hi; p += 1) {
		const x = m.xOf(p);
		const pc = ((p % 12) + 12) % 12;
		if (BLACK.has(pc)) {
			continue;
		}
		parts.push(`<rect x="${x}" y="${y0}" width="${m.cell}" height="${m.keyH}" fill="#fffcf7" stroke="#c9c2b4" stroke-width="0.6"/>`);
		if (pc === 0) {
			const weight = p === 60 ? 700 : 600;
			const size = p === 60 ? 11 : 10;
			parts.push(`<text x="${x + m.cell / 2}" y="${y0 + 12}" font-size="${size}" font-weight="${weight}" fill="#2a241c" text-anchor="middle">${esc(pretty(p))}</text>`);
		}
	}
	for (let p = m.lo; p <= m.hi; p += 1) {
		const pc = ((p % 12) + 12) % 12;
		if (!BLACK.has(pc)) {
			continue;
		}
		const x = m.xOf(p);
		parts.push(`<rect x="${x + 1}" y="${y0}" width="${m.cell - 2}" height="${m.keyH - 8}" fill="#2c2a28" rx="1"/>`);
	}
}

function drawRoll(parts, model, m, y0) {
	const { notes, barlines, total } = model;
	parts.push(`<rect x="0" y="${y0}" width="${m.w}" height="${m.innerH + m.padB}" fill="#f3efe6"/>`);
	for (let p = m.lo; p <= m.hi; p += 1) {
		const x = m.xOf(p);
		const pc = ((p % 12) + 12) % 12;
		let fill = BLACK.has(pc) ? '#e6e1d6' : '#faf7f0';
		if (pc === 0) {
			fill = p === 60 ? '#f0d48a' : '#efe3c0';
		}
		parts.push(`<rect x="${x}" y="${y0}" width="${m.cell}" height="${m.innerH}" fill="${fill}"/>`);
	}

	for (let b = 0; b <= total + 1e-9; b += 1) {
		const y = y0 + m.yOf(b);
		const bar = barlines.some((v) => Math.abs(v - b) < 1e-6);
		parts.push(`<line x1="${m.padL}" y1="${y}" x2="${m.padL + m.innerW}" y2="${y}" stroke="${bar ? '#2a241c' : '#cfc6b6'}" stroke-width="${bar ? 1.4 : 0.6}" ${bar ? '' : 'stroke-dasharray="2 3"'}/>`);
	}

	let barN = 1;
	for (let i = 0; i < barlines.length - 1; i += 1) {
		const a = barlines[i];
		const b = barlines[i + 1];
		if (b - a < 1e-6) {
			continue;
		}
		const y = y0 + m.yOf(a);
		parts.push(`<text x="6" y="${y + 12}" font-size="10" fill="#6a6358">bar ${barN}</text>`);
		for (let k = 0; k < b - a - 1e-9; k += 1) {
			parts.push(`<text x="6" y="${y + m.yOf(k) + 28}" font-size="9" fill="#8a8274">${k + 1}</text>`);
		}
		barN += 1;
	}

	for (const n of notes) {
		const x = m.xOf(n.pitch) + 1.75;
		const y = y0 + m.yOf(n.beat) + 1.5;
		const nw = m.cell - 3.5;
		const nh = Math.max(3, n.dur * m.beatH - 3);
		const label = `${pretty(n.pitch)}  ${tok(n.pitch)}:${+n.dur.toFixed(3)}  @${+n.beat.toFixed(3)}`;
		parts.push(`<rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="2" fill="#2f5f86" stroke="#1c3d5c" stroke-width="0.8"><title>${esc(label)}</title></rect>`);
		if (nh >= 28) {
			const tx = x + nw * 0.78;
			const ty = y + 4;
			parts.push(`<text transform="rotate(90 ${tx} ${ty})" x="${tx}" y="${ty}" font-size="9" fill="#f7fbff">${esc(pretty(n.pitch))}</text>`);
		}
	}

	parts.push(`<rect x="${m.padL}" y="${y0}" width="${m.innerW}" height="${m.innerH}" fill="none" stroke="#2a241c" stroke-width="1.2"/>`);
}

function renderSvg(model, opts) {
	const m = metrics(model);
	const h = m.titleH + m.keyH + m.innerH + m.padB;
	const parts = [svgOpen(m.w, h)];
	drawTitle(parts, m, opts);
	drawKeys(parts, m, m.titleH);
	drawRoll(parts, model, m, m.titleH + m.keyH);
	parts.push('</svg>');
	return { svg: parts.join('\n'), m };
}

function renderKeysSvg(model, opts, m) {
	const h = m.titleH + m.keyH;
	const parts = [svgOpen(m.w, h)];
	drawTitle(parts, m, opts);
	drawKeys(parts, m, m.titleH);
	parts.push('</svg>');
	return parts.join('\n');
}

function renderRollSvg(model, opts, m) {
	const h = m.innerH + m.padB;
	const parts = [svgOpen(m.w, h)];
	drawRoll(parts, model, m, 0);
	parts.push('</svg>');
	return parts.join('\n');
}

function wrapHtml(keysSvg, rollSvg, title) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
html,body{margin:0;background:#1c1b19;}
body{padding:16px 16px 48px;}
.frame{width:max-content;margin:0 auto;background:#f3efe6;box-shadow:0 10px 40px #0008;}
.keys{position:sticky;top:0;z-index:3;background:#f3efe6;box-shadow:0 6px 14px #0005;}
.keys svg,.roll svg{display:block;}
</style>
</head>
<body>
<div class="frame">
<div class="keys">${keysSvg}</div>
<div class="roll">${rollSvg}</div>
</div>
</body>
</html>
`;
}

function usage() {
	return `Usage:
  node scripts/roll.mjs INPUT -o OUT.svg [--beats 4] [--title TEXT]

INPUT is a .score.txt path, - for stdin, or a Kindling token string.
Writes OUT.svg and a sibling OUT.html.`;
}

function parseArgv(argv) {
	const args = argv.slice(2);
	const out = { beats: 4, title: 'Kindling piano roll', input: '', dest: '' };
	const rest = [];
	for (let i = 0; i < args.length; i += 1) {
		const a = args[i];
		if (a === '-h' || a === '--help') {
			out.help = true;
		}
		else if (a === '-o' || a === '--out') {
			out.dest = args[++i] ?? '';
		}
		else if (a === '--beats') {
			out.beats = Number(args[++i]);
		}
		else if (a === '--title') {
			out.title = args[++i] ?? out.title;
		}
		else {
			rest.push(a);
		}
	}
	out.input = rest.join(' ');
	return out;
}

function readInput(input) {
	if (!input) {
		throw new Error(usage());
	}
	if (input === '-') {
		return fs.readFileSync(0, 'utf8');
	}
	if (fs.existsSync(input) && fs.statSync(input).isFile()) {
		return fs.readFileSync(input, 'utf8');
	}
	return input;
}

function defaultDest(input) {
	if (input && input !== '-' && fs.existsSync(input) && fs.statSync(input).isFile()) {
		return input.replace(/\.[^.]+$/, '') + '.svg';
	}
	return 'roll.svg';
}

function main() {
	const args = parseArgv(process.argv);
	if (args.help) {
		console.log(usage());
		return;
	}
	if (!(args.beats > 0)) {
		throw new Error('--beats must be > 0');
	}
	const src = readInput(args.input);
	const model = compile(src, args.beats);
	const dest = args.dest || defaultDest(args.input);
	const opts = { title: args.title };
	const { svg, m } = renderSvg(model, opts);
	if (dest === '-') {
		process.stdout.write(svg);
		return;
	}
	fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
	fs.writeFileSync(dest, `${svg}\n`);
	const html = dest.replace(/\.svg$/i, '.html');
	fs.writeFileSync(html, wrapHtml(renderKeysSvg(model, opts, m), renderRollSvg(model, opts, m), args.title));
	console.log(`wrote ${dest}`);
	console.log(`wrote ${html}`);
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	try {
		main();
	}
	catch (err) {
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	}
}
