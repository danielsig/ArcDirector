#!/usr/bin/env node
/**
 * Deterministic 50° pose guides. Same zoom, chest at canvas center, exact yaws.
 *
 *   node .cursor/skills/anime-clock-character/scripts/dummy.mjs
 *   node .cursor/skills/anime-clock-character/scripts/dummy.mjs --style wood
 *   node .cursor/skills/anime-clock-character/scripts/dummy.mjs --compare
 *
 * Wireframes only: guides/dummy/{stem}.png. Do not attach these when authoring a character.
 * Pose guides attached at GenerateImage time are the anime grayscale mannequin
 * cells in guides/{stem}.png (rebuild with publish-guides.mjs).
 * --compare writes junk/_compare (unused).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const guides = path.resolve(here, '../guides');
const { PNG } = createRequire(path.resolve(here, '../../../../game/package.json'))('pngjs');

const W = 512;
const H = 768;
const MAG = [255, 0, 255, 255];
const BONE = [255, 255, 255, 255];
const WOOD = [198, 150, 96, 255];
const WOOD_JOINT = [158, 112, 68, 255];
const WOOD_HAIR = [62, 42, 28, 255];
const WOOD_EYE = [36, 24, 16, 255];
const PITCH = 50 * Math.PI / 180;
const DIST = 3.55;
const FOV = 32 * Math.PI / 180;
const CX = W / 2;
const CY = H / 2;

const HOUR_YAW = {
	6: 0,
	5: Math.PI / 6,
	4: Math.PI / 3,
	3: Math.PI / 2,
	2: 2 * Math.PI / 3,
	1: 5 * Math.PI / 6,
	12: Math.PI,
};

function v(x, y, z) {
	return { x, y, z };
}
function add(a, b) {
	return v(a.x + b.x, a.y + b.y, a.z + b.z);
}
function scl(a, s) {
	return v(a.x * s, a.y * s, a.z * s);
}
function len(a) {
	return Math.hypot(a.x, a.y, a.z) || 1e-8;
}
function norm(a) {
	return scl(a, 1 / len(a));
}
function cross(a, b) {
	return v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
function rotY(p, yaw) {
	const c = Math.cos(yaw);
	const s = Math.sin(yaw);
	return v(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
}
function rotAround(p, axis, ang) {
	const u = norm(axis);
	const c = Math.cos(ang);
	const s = Math.sin(ang);
	return add(
		add(scl(p, c), scl(cross(u, p), s)),
		scl(u, (u.x * p.x + u.y * p.y + u.z * p.z) * (1 - c)),
	);
}

const eye = v(0, DIST * Math.sin(PITCH), -DIST * Math.cos(PITCH));
const fwd = norm(v(-eye.x, -eye.y, -eye.z));
const right = norm(cross(v(0, 1, 0), fwd));
const up = cross(fwd, right);
const fScale = (H / 2) / Math.tan(FOV / 2);

function project(p) {
	const d = v(p.x - eye.x, p.y - eye.y, p.z - eye.z);
	const cam = v(
		d.x * right.x + d.y * right.y + d.z * right.z,
		d.x * up.x + d.y * up.y + d.z * up.z,
		d.x * fwd.x + d.y * fwd.y + d.z * fwd.z,
	);
	if (cam.z < 0.05) {
		return null;
	}
	return {
		x: CX + (cam.x / cam.z) * fScale,
		y: CY - (cam.y / cam.z) * fScale,
		z: cam.z,
	};
}

function worldToScreen(p) {
	const s = project(p);
	return s ? { x: s.x, y: s.y } : null;
}

function empty() {
	const png = new PNG({ width: W, height: H, colorType: 6 });
	for (let i = 0; i < png.data.length; i += 4) {
		png.data[i] = MAG[0];
		png.data[i + 1] = MAG[1];
		png.data[i + 2] = MAG[2];
		png.data[i + 3] = MAG[3];
	}
	return png;
}

function plot(png, x, y) {
	const ix = Math.round(x);
	const iy = Math.round(y);
	if (ix < 0 || iy < 0 || ix >= W || iy >= H) {
		return;
	}
	const i = (iy * W + ix) * 4;
	png.data[i] = BONE[0];
	png.data[i + 1] = BONE[1];
	png.data[i + 2] = BONE[2];
	png.data[i + 3] = BONE[3];
}

function line(png, a, b, width = 1.6) {
	const sa = worldToScreen(a);
	const sb = worldToScreen(b);
	if (!sa || !sb) {
		return;
	}
	const n = Math.max(Math.abs(sb.x - sa.x), Math.abs(sb.y - sa.y), 1);
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		const x = sa.x + (sb.x - sa.x) * t;
		const y = sa.y + (sb.y - sa.y) * t;
		for (let ox = -width; ox <= width; ox++) {
			for (let oy = -width; oy <= width; oy++) {
				if (ox * ox + oy * oy <= width * width) {
					plot(png, x + ox, y + oy);
				}
			}
		}
	}
}

function joint(png, p, radius = 0.028) {
	const rings = 10;
	const meridians = 8;
	for (let m = 0; m < meridians; m++) {
		const a0 = (m / meridians) * Math.PI * 2;
		const a1 = ((m + 1) / meridians) * Math.PI * 2;
		for (const lat of [0.35, 0.65]) {
			const y = Math.cos(lat * Math.PI);
			const r = Math.sin(lat * Math.PI) * radius;
			line(
				png,
				add(p, v(Math.cos(a0) * r, y * radius, Math.sin(a0) * r)),
				add(p, v(Math.cos(a1) * r, y * radius, Math.sin(a1) * r)),
				1.1,
			);
		}
		const lon = a0;
		const pts = [];
		for (let i = 0; i <= rings; i++) {
			const lat = (i / rings) * Math.PI;
			pts.push(add(p, v(
				Math.sin(lat) * Math.cos(lon) * radius,
				Math.cos(lat) * radius,
				Math.sin(lat) * Math.sin(lon) * radius,
			)));
		}
		for (let i = 0; i < pts.length - 1; i++) {
			line(png, pts[i], pts[i + 1], 1.1);
		}
	}
}

function shade(nx, ny, nz, albedo) {
	const lit = 0.3 + 0.7 * Math.max(0, nx * 0.28 + ny * 0.58 + nz * 0.76);
	const spec = Math.pow(Math.max(0, nz), 20) * 36;
	return [
		Math.min(255, albedo[0] * lit + spec),
		Math.min(255, albedo[1] * lit + spec),
		Math.min(255, albedo[2] * lit + spec),
		255,
	];
}

function plotZ(png, zbuf, x, y, z, rgba) {
	const ix = Math.round(x);
	const iy = Math.round(y);
	if (ix < 0 || iy < 0 || ix >= W || iy >= H) {
		return;
	}
	const i = iy * W + ix;
	if (z >= zbuf[i]) {
		return;
	}
	zbuf[i] = z;
	const p = i * 4;
	png.data[p] = rgba[0];
	png.data[p + 1] = rgba[1];
	png.data[p + 2] = rgba[2];
	png.data[p + 3] = rgba[3];
}

function fillLitBall(png, zbuf, p, radius, albedo) {
	const s = project(p);
	if (!s) {
		return;
	}
	const sr = (radius * fScale) / s.z;
	const r = Math.ceil(sr + 1);
	for (let dy = -r; dy <= r; dy++) {
		for (let dx = -r; dx <= r; dx++) {
			const nx = dx / sr;
			const ny = -dy / sr;
			const d2 = nx * nx + ny * ny;
			if (d2 > 1) {
				continue;
			}
			const nz = Math.sqrt(1 - d2);
			plotZ(png, zbuf, s.x + dx, s.y + dy, s.z - nz * radius * 0.4, shade(nx, ny, nz, albedo));
		}
	}
}

function fillLitCyl(png, zbuf, a, b, radius, albedo, steps = 30) {
	const d = v(b.x - a.x, b.y - a.y, b.z - a.z);
	for (let i = 0; i <= steps; i++) {
		fillLitBall(png, zbuf, add(a, scl(d, i / steps)), radius, albedo);
	}
}

function poseFor(stem) {
	const idle = {
		bob: 0,
		lHip: 0,
		rHip: 0,
		lKnee: 0.05,
		rKnee: 0.05,
		lArm: 0.08,
		rArm: 0.08,
		lElbow: 0.22,
		rElbow: 0.22,
		reach: 0,
	};
	const m = /^(idle|walk|take)_(\d+)(?:_(\d+))?$/.exec(stem);
	if (!m) {
		throw new Error(stem);
	}
	const kind = m[1];
	const hour = Number(m[2]);
	const idx = m[3] === undefined ? 0 : Number(m[3]);
	const yaw = HOUR_YAW[hour];
	if (yaw === undefined) {
		throw new Error(stem);
	}
	if (kind === 'idle') {
		return { yaw, ...idle };
	}
	if (kind === 'walk') {
		const stride = hour === 12 || hour === 6 ? 1.15 : 0.9;
		const t = idx / 4;
		const swing = Math.cos(t * Math.PI * 2);
		const passing = idx === 1 || idx === 3;
		const passLeft = idx === 1;
		return {
			yaw,
			bob: passing ? 0.12 : 0,
			rHip: passing ? (passLeft ? 0.08 : -0.12) : swing * stride,
			lHip: passing ? (passLeft ? -0.12 : 0.08) : -swing * stride,
			rKnee: passing ? (passLeft ? 0.1 : 0.72) : (swing > 0 ? 0.08 : 0.85),
			lKnee: passing ? (passLeft ? 0.72 : 0.1) : (swing < 0 ? 0.08 : 0.85),
			rArm: passing ? (passLeft ? -0.2 : 0.2) : -swing * 0.85,
			lArm: passing ? (passLeft ? 0.2 : -0.2) : swing * 0.85,
			rElbow: passing ? 0.42 : 0.38,
			lElbow: passing ? 0.42 : 0.38,
			reach: 0,
		};
	}
	const reach = [0, 0.14, 0.28, 0.42, 0.58, 0.72, 0.86, 1][idx];
	return {
		yaw,
		...idle,
		rArm: -0.05 - reach * 0.12,
		rElbow: 0.22 + reach * 0.55,
		reach,
	};
}

function jointsFor(pose) {
	const hipY = -0.46 + pose.bob;
	const pelvis = v(0, hipY + 0.08, 0);
	const spine = v(0, -0.12, 0.01);
	const chest = v(0, 0.08, 0);
	const neck = v(0, 0.26, 0);
	const head = v(0, 0.46, 0);
	const crown = v(0, 0.62, 0);
	const look = v(0, 0.46, -0.22);

	function leg(side, hipA, kneeA) {
		const hip = v(side * 0.14, hipY, 0.02);
		const thighDir = rotAround(v(0, -1, 0), v(1, 0, 0), hipA);
		const knee = add(hip, scl(norm(thighDir), 0.4));
		const shinDir = rotAround(thighDir, v(1, 0, 0), kneeA);
		const ankle = add(knee, scl(norm(shinDir), 0.38));
		const toe = add(ankle, v(0, -0.02, -0.18));
		return { hip, knee, ankle, toe };
	}
	function arm(side, swing, elbowA, reach) {
		const sh = v(side * 0.24, 0.16, 0);
		if (side > 0 && reach > 0.02) {
			const elbow = v(0.34, 0.02 + reach * 0.06, -0.04);
			const wrist = v(0.22 - reach * 0.16, -0.38 + reach * 0.54, -0.07 - reach * 0.06);
			return { sh, elbow, wrist };
		}
		let dir = rotAround(v(0, -1, 0), v(0, 0, 1), side * 0.18);
		dir = rotAround(dir, v(1, 0, 0), swing);
		const elbow = add(sh, scl(norm(dir), 0.3));
		const fore = rotAround(dir, v(1, 0, 0), elbowA);
		const wrist = add(elbow, scl(norm(fore), 0.28));
		return { sh, elbow, wrist };
	}

	return {
		pelvis,
		spine,
		chest,
		neck,
		head,
		crown,
		look,
		l: { ...leg(-1, pose.lHip, pose.lKnee), ...arm(-1, pose.lArm, pose.lElbow, 0) },
		r: { ...leg(1, pose.rHip, pose.rKnee), ...arm(1, pose.rArm, pose.rElbow, pose.reach) },
	};
}

function drawSkeleton(png, pose) {
	const wld = (p) => rotY(p, pose.yaw);
	const j = jointsFor(pose);
	const L = j.l;
	const R = j.r;
	const bones = [
		[j.pelvis, j.spine],
		[j.spine, j.chest],
		[j.chest, j.neck],
		[j.neck, j.head],
		[j.head, j.crown],
		[j.head, j.look],
		[j.chest, L.sh],
		[L.sh, L.elbow],
		[L.elbow, L.wrist],
		[j.chest, R.sh],
		[R.sh, R.elbow],
		[R.elbow, R.wrist],
		[j.pelvis, L.hip],
		[L.hip, L.knee],
		[L.knee, L.ankle],
		[L.ankle, L.toe],
		[j.pelvis, R.hip],
		[R.hip, R.knee],
		[R.knee, R.ankle],
		[R.ankle, R.toe],
	];
	for (const [a, b] of bones) {
		line(png, wld(a), wld(b));
	}
	const dots = [
		j.pelvis, j.spine, j.chest, j.neck, j.head, j.crown, j.look,
		L.sh, L.elbow, L.wrist, L.hip, L.knee, L.ankle, L.toe,
		R.sh, R.elbow, R.wrist, R.hip, R.knee, R.ankle, R.toe,
	];
	for (const p of dots) {
		joint(png, wld(p), p === j.look || p === j.head ? 0.022 : 0.026);
	}
}

function drawWood(png, pose) {
	const zbuf = new Float32Array(W * H);
	zbuf.fill(1e9);
	const wld = (p) => rotY(p, pose.yaw);
	const j = jointsFor(pose);
	const L = j.l;
	const R = j.r;
	const bone = (a, b, r, col = WOOD) => fillLitCyl(png, zbuf, wld(a), wld(b), r, col);
	const ball = (p, r, col = WOOD_JOINT) => fillLitBall(png, zbuf, wld(p), r, col);

	bone(j.pelvis, j.spine, 0.15);
	bone(j.spine, j.chest, 0.17);
	bone(j.chest, j.neck, 0.07);
	bone(j.neck, j.head, 0.05);
	bone(j.head, j.crown, 0.12, WOOD);
	ball(j.crown, 0.09, WOOD_HAIR);
	ball(v(0, 0.58, 0.06), 0.1, WOOD_HAIR);
	ball(v(-0.045, 0.5, -0.1), 0.022, WOOD_EYE);
	ball(v(0.045, 0.5, -0.1), 0.022, WOOD_EYE);
	bone(j.head, v(0, 0.45, -0.14), 0.032, WOOD);
	ball(v(0, 0.445, -0.155), 0.036, WOOD);

	bone(j.chest, L.sh, 0.045);
	bone(L.sh, L.elbow, 0.048);
	bone(L.elbow, L.wrist, 0.042);
	bone(j.chest, R.sh, 0.045);
	bone(R.sh, R.elbow, 0.048);
	bone(R.elbow, R.wrist, 0.042);
	ball(L.sh, 0.055);
	ball(R.sh, 0.055);
	ball(L.elbow, 0.048);
	ball(R.elbow, 0.048);
	ball(L.wrist, 0.05);
	ball(R.wrist, 0.05);

	bone(j.pelvis, L.hip, 0.06);
	bone(L.hip, L.knee, 0.07);
	bone(L.knee, L.ankle, 0.058);
	bone(L.ankle, L.toe, 0.048);
	bone(j.pelvis, R.hip, 0.06);
	bone(R.hip, R.knee, 0.07);
	bone(R.knee, R.ankle, 0.058);
	bone(R.ankle, R.toe, 0.048);
	ball(j.pelvis, 0.08);
	ball(L.hip, 0.06);
	ball(R.hip, 0.06);
	ball(L.knee, 0.055);
	ball(R.knee, 0.055);
	ball(L.ankle, 0.048);
	ball(R.ankle, 0.048);
	ball(L.toe, 0.046);
	ball(R.toe, 0.046);
}

function writeStem(stem, style, outDir) {
	const png = empty();
	const pose = poseFor(stem);
	if (style === 'wood') {
		drawWood(png, pose);
	} else {
		drawSkeleton(png, pose);
	}
	const file = path.join(outDir, `${stem}.png`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, PNG.sync.write(png));
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

function emptyPng(w, h) {
	const png = new PNG({ width: w, height: h, colorType: 6 });
	png.data.fill(0);
	return png;
}

function arg(flag, fallback) {
	const i = process.argv.indexOf(flag);
	return i < 0 ? fallback : process.argv[i + 1];
}

const idle = [1, 2, 3, 4, 5, 6, 12].map((hh) => `idle_${String(hh).padStart(2, '0')}`);
const walk = [12, 2, 4, 6].flatMap((hh) => [0, 1, 2, 3].map((i) => `walk_${String(hh).padStart(2, '0')}_${i}`));
const take = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `take_06_${i}`);
const stems = [...idle, ...walk, ...take];
const preview = ['idle_06', 'idle_12', 'idle_03', 'idle_04', 'walk_12_0', 'walk_06_0', 'take_06_0', 'take_06_7'];

function publish(style, outDir, list) {
	const rendered = new Map();
	fs.mkdirSync(outDir, { recursive: true });
	for (const stem of list) {
		rendered.set(stem, writeStem(stem, style, outDir));
		console.log(style, stem);
	}
	return rendered;
}

if (process.argv.includes('--compare')) {
	const root = path.resolve(here, '../junk/_compare');
	const skel = publish('skeleton', path.join(root, 'skeleton'), preview);
	const wood = publish('wood', path.join(root, 'wood'), preview);
	const sheet = emptyPng(W * 2, H * preview.length);
	for (let i = 0; i < preview.length; i++) {
		blit(sheet, skel.get(preview[i]), 0, i * H);
		blit(sheet, wood.get(preview[i]), W, i * H);
	}
	fs.writeFileSync(path.join(root, 'side_by_side.png'), PNG.sync.write(sheet));
	console.log('compare', path.join(root, 'side_by_side.png'));
} else {
	const style = arg('--style', 'skeleton');
	const out = arg('--out', path.join(guides, 'dummy'));
	const list = process.argv.includes('--preview') ? preview : stems;
	publish(style, out, list);
	console.log('guides', list.length, style, out);
}
