import * as THREE from 'three';
import { bevelBox, lathe, tube, type ProfilePoint } from '@arc-director/kindling';
import { PALETTE, thatchMat, toon } from './toon';
import { BROOM_LEAN, type PropID } from '../world/dressingPlan';

/** One instanced piece of a prop, posed in the prop's frame (meters, Y up, +Z its front). */
export type PropPart = {
	key:string;
	geom:THREE.BufferGeometry;
	mat:THREE.Material;
	cast:boolean;
	x:number;
	y:number;
	z:number;
	rx:number;
	ry:number;
	rz:number;
};

function keep(geo:THREE.BufferGeometry):THREE.BufferGeometry {
	geo.userData.shared = true;
	return geo;
}

function paint(color:number, extras:Parameters<typeof toon>[1] = {}):THREE.Material {
	const mat = toon(color, extras);
	mat.userData.shared = true;
	return mat;
}

/** Small boards for furniture: finer than building planks. */
function boards(color:number):THREE.Material {
	return paint(color, { pattern: 'plank', patternScale: 0.08, patternInk: 0.4 });
}

const wood = boards(PALETTE.wood);
const woodLight = boards(PALETTE.woodLight);
const woodDark = paint(PALETTE.woodDark);
const endGrain = paint(0xd9b382);
const iron = paint(PALETTE.iron, { rim: 0.35 });
const brass = paint(0xd8a83a, { rim: 0.4 });
const stone = paint(PALETTE.wall, { pattern: 'stone', patternScale: 0.16, patternInk: 0.5 });
const straw = paint(0xd9b25a);
const linen = paint(PALETTE.linen);
const burlap = paint(0xa77b4f);
const quilt = paint(0x9a3b3b);
const soil = paint(0x5a3a22, { outline: false });
const leaf = paint(PALETTE.leaf, { rim: 0.2 });
const water = paint(0x1d4a6e, { outline: false });
const glow = paint(0xffd27a, { emissive: 0xffa53a, emissiveIntensity: 1.1, outline: false });
const petals = [paint(PALETTE.flower), paint(PALETTE.flowerGold), paint(0xf4efe6), paint(0xe58bb0)];
const glazes = [paint(0xb8643c), paint(PALETTE.linen), paint(0x4f7aa6)];

function box(w:number, h:number, d:number):THREE.BufferGeometry {
	const geo = new THREE.BoxGeometry(w, h, d);
	geo.translate(0, h * 0.5, 0);
	return keep(geo);
}

/** Closed solid of revolution: the profile is capped at both ends on the axis. */
function solid(profile:ProfilePoint[], segments = 12):THREE.BufferGeometry {
	const first = profile[0]!;
	const last = profile[profile.length - 1]!;
	return keep(lathe([{ r: 0, y: first.y }, ...profile, { r: 0, y: last.y }], segments));
}

/** Thin band around Y, from `y` up `h`, at radius `r`. */
function band(r:number, y:number, h:number, segments = 14):THREE.BufferGeometry {
	return keep(lathe([{ r, y }, { r: r + 0.008, y: y + h * 0.5 }, { r, y: y + h }], segments));
}

/** Cylinder lying along X, centered on the origin. */
function rod(length:number, radius:number, segments = 8):THREE.BufferGeometry {
	const geo = new THREE.CylinderGeometry(radius, radius, length, segments);
	geo.rotateZ(Math.PI / 2);
	return keep(geo);
}

function at(
	key:string,
	geom:THREE.BufferGeometry,
	mat:THREE.Material,
	x = 0,
	y = 0,
	z = 0,
	rx = 0,
	ry = 0,
	rz = 0,
	cast = true,
):PropPart {
	return { key, geom, mat, cast, x, y, z, rx, ry, rz };
}

// Broom: straw head bound to a long handle; the whole prop leans on whatever is behind it.

const broomHandle = keep(tube([{ x: 0, y: 0.26, z: 0 }, { x: 0, y: 1.3, z: 0 }], 0.017, 6));
const broomHead = (():THREE.BufferGeometry => {
	const geo = lathe([
		{ r: 0, y: 0 },
		{ r: 0.13, y: 0 },
		{ r: 0.12, y: 0.07 },
		{ r: 0.06, y: 0.24 },
		{ r: 0.024, y: 0.3 },
		{ r: 0, y: 0.3 },
	], 10);
	geo.scale(1, 1, 0.4);
	return keep(geo);
})();
const broomTie = band(0.03, 0.24, 0.035);

// Leans back (-Z), so placed facing away from a wall its handle rests against it.
function broom():PropPart[] {
	return [
		at('broom-handle', broomHandle, woodDark, 0, 0, 0, -BROOM_LEAN),
		at('broom-head', broomHead, straw, 0, 0, 0, -BROOM_LEAN),
		at('broom-tie', broomTie, iron, 0, 0, 0, -BROOM_LEAN),
	];
}

// Bucket: staved, hooped, with a bail handle.

const bucketBody = keep(lathe([
	{ r: 0, y: 0 },
	{ r: 0.12, y: 0 },
	{ r: 0.15, y: 0.27 },
	{ r: 0.14, y: 0.27 },
	{ r: 0.115, y: 0.04 },
	{ r: 0, y: 0.04 },
], 12));
const bucketBail = (():THREE.BufferGeometry => {
	const geo = new THREE.TorusGeometry(0.15, 0.008, 4, 14, Math.PI);
	geo.translate(0, 0.27, 0);
	return keep(geo);
})();

function bucket(y = 0):PropPart[] {
	return [
		at('bucket', bucketBody, wood, 0, y),
		at('bucket-hoop', band(0.125, 0.04, 0.03), iron, 0, y),
		at('bucket-hoop-top', band(0.143, 0.21, 0.03), iron, 0, y),
		at('bucket-bail', bucketBail, iron, 0, y),
	];
}

// Barrel: bulging staves under three iron hoops.

const barrelBody = solid([
	{ r: 0.17, y: 0 },
	{ r: 0.2, y: 0.1 },
	{ r: 0.215, y: 0.27 },
	{ r: 0.2, y: 0.44 },
	{ r: 0.17, y: 0.54 },
], 14);

// Crate: light boards in a dark frame.

const CRATE = 0.42;
const crateBody = keep(bevelBox(CRATE - 0.02, CRATE - 0.02, CRATE - 0.02, 0.01));
const crateBarX = box(CRATE, 0.05, 0.05);
const crateBarY = box(0.05, CRATE, 0.05);
const crateBarZ = box(0.05, 0.05, CRATE);

function crate():PropPart[] {
	const h = CRATE / 2 - 0.025;
	const parts = [at('crate', crateBody, woodLight, 0, 0.01, 0)];
	for (const s of [-1, 1]) {
		for (const t of [-1, 1]) {
			parts.push(at('crate-bar-y', crateBarY, woodDark, s * h, 0, t * h));
			parts.push(at('crate-bar-x', crateBarX, woodDark, 0, (s + 1) * h, t * h));
			parts.push(at('crate-bar-z', crateBarZ, woodDark, s * h, (t + 1) * h, 0));
		}
	}
	return parts;
}

// Flowerbed: a planter of soil, leafy mounds and bright blooms.

const planter = keep(bevelBox(0.72, 0.2, 0.36, 0.03));
const leafMound = keep(new THREE.IcosahedronGeometry(0.09, 1));
const bloom = keep(new THREE.IcosahedronGeometry(0.045, 0));

function flowerbed():PropPart[] {
	const parts = [
		at('planter', planter, wood),
		at('planter-soil', box(0.64, 0.02, 0.28), soil, 0, 0.18, 0, 0, 0, 0, false),
	];
	const mounds = [[-0.22, 0.02], [-0.06, -0.06], [0.1, 0.05], [0.24, -0.03]] as const;
	mounds.forEach(([x, z], i) => parts.push(at(`flower-leaf${i}`, leafMound, leaf, x, 0.22, z, 0, i, 0)));
	const blooms = [[-0.25, -0.04], [-0.14, 0.07], [-0.02, 0.0], [0.07, -0.08], [0.16, 0.08], [0.27, 0.03], [0.02, 0.1]] as const;
	blooms.forEach(([x, z], i) => parts.push(at(`flower-bloom${i}`, bloom, petals[i % petals.length]!, x, 0.3 + (i % 3) * 0.02, z, i, i * 0.7, 0, false)));
	return parts;
}

// Table, chair, bench.

const tableTop = keep(bevelBox(0.92, 0.06, 0.62, 0.03));
const tableLeg = box(0.07, 0.6, 0.07);
const tableApronX = box(0.76, 0.08, 0.04);
const tableApronZ = box(0.04, 0.08, 0.46);

function table():PropPart[] {
	return [
		at('table-top', tableTop, wood, 0, 0.6, 0),
		...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([s, t]) => at('table-leg', tableLeg, woodDark, s! * 0.38, 0, t! * 0.24)),
		at('table-apron-x', tableApronX, woodDark, 0, 0.5, -0.24),
		at('table-apron-x', tableApronX, woodDark, 0, 0.5, 0.24),
		at('table-apron-z', tableApronZ, woodDark, -0.38, 0.5, 0),
		at('table-apron-z', tableApronZ, woodDark, 0.38, 0.5, 0),
	];
}

const chairLeg = box(0.05, 0.42, 0.05);
const chairPost = box(0.05, 0.48, 0.05);
const chairSlat = box(0.32, 0.06, 0.03);

function chair():PropPart[] {
	return [
		at('chair-seat', keep(bevelBox(0.4, 0.05, 0.38, 0.02)), wood, 0, 0.42, 0),
		...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([s, t]) => at('chair-leg', chairLeg, woodDark, s! * 0.16, 0, t! * 0.15)),
		at('chair-post', chairPost, woodDark, -0.16, 0.47, -0.16),
		at('chair-post', chairPost, woodDark, 0.16, 0.47, -0.16),
		at('chair-slat', chairSlat, wood, 0, 0.66, -0.16),
		at('chair-slat', chairSlat, wood, 0, 0.84, -0.16),
	];
}

const benchBoard = keep(bevelBox(1.1, 0.045, 0.16, 0.015));
const benchLeg = box(0.07, 0.4, 0.3);
const benchStretcher = box(0.86, 0.05, 0.05);

function bench():PropPart[] {
	return [
		at('bench-board', benchBoard, wood, 0, 0.4, -0.085),
		at('bench-board', benchBoard, wood, 0, 0.4, 0.085),
		at('bench-leg', benchLeg, woodDark, -0.42, 0, 0),
		at('bench-leg', benchLeg, woodDark, 0.42, 0, 0),
		at('bench-stretcher', benchStretcher, woodDark, 0, 0.14, 0),
	];
}

// Well: a stone ring with a thatched gable roof, a windlass and a hanging bucket.

// Outside up, over the lip, inside down: lathe faces point left of travel, so out then in.
const wellRing = keep(lathe([
	{ r: 0.57, y: 0 },
	{ r: 0.56, y: 0.7 },
	{ r: 0.62, y: 0.74 },
	{ r: 0.62, y: 0.82 },
	{ r: 0.44, y: 0.82 },
	{ r: 0.42, y: 0.76 },
	{ r: 0.42, y: 0.42 },
], 18));
const wellWater = (():THREE.BufferGeometry => {
	const geo = new THREE.CircleGeometry(0.42, 18);
	geo.rotateX(-Math.PI / 2);
	geo.translate(0, 0.42, 0);
	return keep(geo);
})();
const wellPost = box(0.09, 1.25, 0.09);
const WELL_ROOF_W = 0.62;
const wellRoof = box(1.08, 0.05, WELL_ROOF_W);
const wellRidge = box(1.14, 0.06, 0.06);
const windlass = rod(1.0, 0.055);
const crankArm = box(0.04, 0.22, 0.04);
const crankGrip = rod(0.12, 0.016, 6);
const wellRope = keep(tube([{ x: 0, y: 1.42, z: 0.06 }, { x: 0, y: 1.0, z: 0.06 }], 0.012, 4));

function well():PropPart[] {
	const tilt = 0.62;
	const eave = 2.0;
	const half = (WELL_ROOF_W / 2) * Math.cos(tilt);
	return [
		at('well-ring', wellRing, stone),
		at('well-water', wellWater, water, 0, 0, 0, 0, 0, 0, false),
		at('well-post', wellPost, woodDark, -0.5, 0.78, 0),
		at('well-post', wellPost, woodDark, 0.5, 0.78, 0),
		// Three.js +X rotation lowers +Z, so the north half tilts negative to rise toward the ridge.
		at('well-roof', wellRoof, thatchMat(), 0, eave - 0.02, -half, -tilt),
		at('well-roof', wellRoof, thatchMat(), 0, eave - 0.02, half, tilt),
		at('well-ridge', wellRidge, woodDark, 0, eave + (WELL_ROOF_W / 2) * Math.sin(tilt) - 0.04, 0),
		at('well-windlass', windlass, wood, 0, 1.45, 0),
		at('well-crank', crankArm, iron, 0.53, 1.34, 0),
		at('well-crank-grip', crankGrip, wood, 0.6, 1.34, 0),
		at('well-rope', wellRope, straw),
		...bucket(0.73).map((p) => ({ ...p, z: 0.06 })),
	];
}

// Woodpile: split logs stacked three, two, one, end grain out.

const log = rod(0.62, 0.075, 9);
const logEnd = (():THREE.BufferGeometry => {
	const geo = new THREE.CircleGeometry(0.074, 9);
	geo.rotateY(Math.PI / 2);
	return keep(geo);
})();

function woodpile():PropPart[] {
	const parts:PropPart[] = [];
	const rows = [[-0.15, 0, 0.15], [-0.075, 0.075], [0]];
	rows.forEach((row, level) => {
		for (const z of row) {
			const y = 0.075 + level * 0.13;
			const shift = (z * 7) % 0.06;
			parts.push(at('log', log, wood, shift, y, z));
			parts.push(at('log-end', logEnd, endGrain, shift + 0.311, y, z));
			parts.push(at('log-end', logEnd, endGrain, shift - 0.311, y, z, 0, Math.PI, 0));
		}
	});
	return parts;
}

// Wheelbarrow: a splayed wooden tub on one spoked wheel, handles and legs behind.

const barrowTub = (():THREE.BufferGeometry => {
	// Bottom and rim corners: x half-widths, z from back to front, y heights.
	const b = { x: 0.22, z0: -0.3, z1: 0.28, y: 0.32 };
	const t = { x: 0.34, z0: -0.42, z1: 0.52, y: 0.6 };
	const v = (x:number, y:number, z:number):number[] => [x, y, z];
	const quads = [
		[v(-b.x, b.y, b.z0), v(b.x, b.y, b.z0), v(b.x, b.y, b.z1), v(-b.x, b.y, b.z1)],
		[v(-b.x, b.y, b.z0), v(-t.x, t.y, t.z0), v(t.x, t.y, t.z0), v(b.x, b.y, b.z0)],
		[v(b.x, b.y, b.z1), v(t.x, t.y, t.z1), v(-t.x, t.y, t.z1), v(-b.x, b.y, b.z1)],
		[v(-b.x, b.y, b.z1), v(-t.x, t.y, t.z1), v(-t.x, t.y, t.z0), v(-b.x, b.y, b.z0)],
		[v(b.x, b.y, b.z0), v(t.x, t.y, t.z0), v(t.x, t.y, t.z1), v(b.x, b.y, b.z1)],
	];
	const pos:number[] = [];
	for (const [p0, p1, p2, p3] of quads) {
		pos.push(...p0!, ...p1!, ...p2!, ...p0!, ...p2!, ...p3!);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.computeVertexNormals();
	return keep(geo);
})();
const barrowTubMat = paint(PALETTE.wood, { pattern: 'plank', patternScale: 0.08, patternInk: 0.4, side: THREE.DoubleSide });
const WHEEL_R = 0.19;
const wheelRim = (():THREE.BufferGeometry => {
	const geo = new THREE.TorusGeometry(WHEEL_R, 0.028, 6, 18);
	geo.rotateY(Math.PI / 2);
	return keep(geo);
})();
const wheelHub = rod(0.1, 0.035, 8);
const wheelSpoke = box(0.022, WHEEL_R, 0.022);
// Each rail holds the axle just beside the hub, runs under the tub floor (bottom at y 0.32),
// then rises behind the tub to a grip at hand height, widening toward the back.
const RAIL_R = 0.022;
const UNDER_TUB = 0.32 - RAIL_R;
const barrowRail = (side:number):THREE.BufferGeometry => keep(tube([
	{ x: side * 0.08, y: WHEEL_R, z: 0.62 },
	{ x: side * 0.17, y: UNDER_TUB, z: 0.3 },
	{ x: side * 0.23, y: UNDER_TUB, z: -0.36 },
	{ x: side * 0.28, y: 0.5, z: -0.86 },
], RAIL_R, 6));
const barrowGrip = (side:number):THREE.BufferGeometry => keep(tube([
	{ x: side * 0.28, y: 0.5, z: -0.86 },
	{ x: side * 0.29, y: 0.53, z: -1.0 },
], RAIL_R * 1.4, 6));
/** Where the legs meet the rails, under the back of the tub. */
const LEG_Z = -0.3;
const barrowLeg = box(0.045, UNDER_TUB, 0.045);

function wheelbarrow():PropPart[] {
	const spokes = Array.from({ length: 6 }, (_, i) => at('barrow-spoke', wheelSpoke, woodDark, 0, WHEEL_R, 0.62, (i / 6) * Math.PI * 2));
	return [
		at('barrow-tub', barrowTub, barrowTubMat),
		at('barrow-rim', wheelRim, iron, 0, WHEEL_R, 0.62),
		at('barrow-hub', wheelHub, woodDark, 0, WHEEL_R, 0.62),
		...spokes,
		at('barrow-rail-l', barrowRail(-1), woodDark),
		at('barrow-rail-r', barrowRail(1), woodDark),
		at('barrow-grip-l', barrowGrip(-1), woodDark),
		at('barrow-grip-r', barrowGrip(1), woodDark),
		at('barrow-leg', barrowLeg, woodDark, -0.225, 0, LEG_Z),
		at('barrow-leg', barrowLeg, woodDark, 0.225, 0, LEG_Z),
	];
}

// Sacks: plump, tied at the neck, one slumped against the others.

const sack = solid([
	{ r: 0.15, y: 0 },
	{ r: 0.18, y: 0.08 },
	{ r: 0.17, y: 0.2 },
	{ r: 0.11, y: 0.3 },
	{ r: 0.05, y: 0.35 },
	{ r: 0.045, y: 0.37 },
	{ r: 0.075, y: 0.42 },
], 10);
const sackTie = band(0.048, 0.34, 0.03, 8);

function sacks():PropPart[] {
	return [
		at('sack', sack, burlap, -0.12, 0, 0),
		at('sack-tie', sackTie, straw, -0.12, 0, 0),
		at('sack', sack, linen, 0.16, 0, 0.05, 0, 0.6, 0),
		at('sack-tie', sackTie, straw, 0.16, 0, 0.05, 0, 0.6, 0),
		at('sack', sack, burlap, 0.02, 0.02, 0.24, 1.1, 0.3, 0),
	];
}

// Lantern: an iron cage around a warm glow, under a peaked cap.

const lanternBase = box(0.15, 0.025, 0.15);
const lanternBar = box(0.018, 0.17, 0.018);
const lanternGlass = box(0.1, 0.15, 0.1);
const lanternCap = keep(lathe([{ r: 0.11, y: 0 }, { r: 0.002, y: 0.09 }], 4));
const lanternRing = (():THREE.BufferGeometry => {
	const geo = new THREE.TorusGeometry(0.035, 0.007, 4, 10);
	geo.translate(0, 0.3, 0);
	return keep(geo);
})();

function lantern():PropPart[] {
	return [
		at('lantern-base', lanternBase, iron),
		at('lantern-glass', lanternGlass, glow, 0, 0.025, 0, 0, 0, 0, false),
		...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([s, t]) => at('lantern-bar', lanternBar, iron, s! * 0.06, 0.025, t! * 0.06)),
		at('lantern-cap', lanternCap, iron, 0, 0.195, 0, 0, Math.PI / 4),
		at('lantern-ring', lanternRing, iron),
	];
}

// Shelf and jars.

function shelf():PropPart[] {
	return [
		at('shelf-board', keep(bevelBox(0.74, 0.04, 0.2, 0.015)), wood, 0, 1.28, 0),
		at('shelf-bracket', box(0.04, 0.16, 0.16), woodDark, -0.28, 1.12, 0),
		at('shelf-bracket', box(0.04, 0.16, 0.16), woodDark, 0.28, 1.12, 0),
	];
}

const jarTall = solid([{ r: 0.055, y: 0 }, { r: 0.08, y: 0.06 }, { r: 0.075, y: 0.15 }, { r: 0.04, y: 0.19 }, { r: 0.05, y: 0.22 }], 10);
const jarSquat = solid([{ r: 0.07, y: 0 }, { r: 0.09, y: 0.05 }, { r: 0.07, y: 0.11 }, { r: 0.05, y: 0.12 }], 10);
const jarLid = solid([{ r: 0.052, y: 0 }, { r: 0.05, y: 0.02 }, { r: 0.012, y: 0.04 }], 8);

function jars():PropPart[] {
	return [
		at('jar-tall', jarTall, glazes[0]!, -0.2, 0, 0),
		at('jar-squat', jarSquat, glazes[1]!, 0, 0, 0.02),
		at('jar-lid', jarLid, woodDark, 0, 0.12, 0.02),
		at('jar-tall', jarTall, glazes[2]!, 0.19, 0, -0.01, 0, 0, 0),
	];
}

// Weapon rack: footed posts, two bars, swords and a spear leaning in.

const rackPost = box(0.07, 1.1, 0.07);
const rackFoot = box(0.08, 0.06, 0.34);
const rackBar = box(0.78, 0.05, 0.05);
const swordBlade = box(0.04, 0.68, 0.012);
const swordGuard = box(0.16, 0.025, 0.03);
const swordGrip = box(0.025, 0.12, 0.025);
const spear = keep(tube([{ x: 0, y: 0, z: 0 }, { x: 0, y: 1.25, z: 0 }], 0.016, 5));
const spearHead = keep(lathe([{ r: 0.035, y: 0 }, { r: 0.001, y: 0.16 }], 4));

function sword(x:number):PropPart[] {
	return [
		at('sword-blade', swordBlade, iron, x, 0.06, 0.05, -0.08),
		at('sword-guard', swordGuard, brass, x, 0.74, 0.0),
		at('sword-grip', swordGrip, woodDark, x, 0.765, -0.005),
	];
}

function weaponRack():PropPart[] {
	return [
		at('rack-post', rackPost, woodDark, -0.38, 0, 0),
		at('rack-post', rackPost, woodDark, 0.38, 0, 0),
		at('rack-foot', rackFoot, woodDark, -0.38, 0, 0),
		at('rack-foot', rackFoot, woodDark, 0.38, 0, 0),
		at('rack-bar', rackBar, wood, 0, 0.78, 0),
		at('rack-bar', rackBar, wood, 0, 0.3, 0.04),
		...sword(-0.18),
		...sword(0.02),
		at('spear', spear, woodDark, 0.22, 0, 0.06, -0.06),
		at('spear-head', spearHead, iron, 0.22, 1.25, -0.015, -0.06),
	];
}

// Bed and chest.

const bedPost = box(0.07, 0.62, 0.07);
const bedBoard = box(0.72, 0.3, 0.04);

function bed():PropPart[] {
	return [
		at('bed-frame', keep(bevelBox(0.8, 0.2, 1.4, 0.03)), wood, 0, 0.06, 0),
		at('bed-post', bedPost, woodDark, -0.38, 0, -0.68),
		at('bed-post', bedPost, woodDark, 0.38, 0, -0.68),
		at('bed-post', box(0.07, 0.42, 0.07), woodDark, -0.38, 0, 0.68),
		at('bed-post', box(0.07, 0.42, 0.07), woodDark, 0.38, 0, 0.68),
		at('bed-head', bedBoard, wood, 0, 0.28, -0.68),
		at('bed-tick', keep(bevelBox(0.7, 0.1, 1.28, 0.04)), linen, 0, 0.26, 0),
		at('bed-quilt', keep(bevelBox(0.74, 0.07, 0.86, 0.03)), quilt, 0, 0.32, 0.2),
		at('bed-pillow', keep(bevelBox(0.44, 0.09, 0.24, 0.05)), linen, 0, 0.34, -0.48),
	];
}

const chestLid = (():THREE.BufferGeometry => {
	const geo = new THREE.CylinderGeometry(0.17, 0.17, 0.52, 12, 1, false, 0, Math.PI);
	geo.rotateZ(Math.PI / 2);
	geo.scale(1, 0.55, 1);
	return keep(geo);
})();
const chestStrap = box(0.04, 0.3, 0.355);

function chest():PropPart[] {
	return [
		at('chest-body', keep(bevelBox(0.52, 0.28, 0.34, 0.02)), wood, 0, 0, 0),
		at('chest-lid', chestLid, woodDark, 0, 0.28, 0),
		at('chest-strap', chestStrap, iron, -0.16, 0, 0),
		at('chest-strap', chestStrap, iron, 0.16, 0, 0),
		at('chest-lock', box(0.07, 0.08, 0.02), brass, 0, 0.2, 0.175),
	];
}

// Pottery: a big pot, a jug, a stack of bowls and one small pot on its side.

const terracotta = glazes[0]!;
const cream = glazes[1]!;
const blueGlaze = glazes[2]!;
const bigPot = solid([{ r: 0.12, y: 0 }, { r: 0.2, y: 0.1 }, { r: 0.22, y: 0.2 }, { r: 0.16, y: 0.33 }, { r: 0.11, y: 0.36 }, { r: 0.13, y: 0.4 }], 12);
const jug = solid([{ r: 0.08, y: 0 }, { r: 0.12, y: 0.08 }, { r: 0.11, y: 0.18 }, { r: 0.05, y: 0.26 }, { r: 0.045, y: 0.33 }, { r: 0.06, y: 0.36 }], 10);
const bowl = solid([{ r: 0.06, y: 0 }, { r: 0.14, y: 0.05 }, { r: 0.15, y: 0.07 }], 12);
const smallPot = solid([{ r: 0.06, y: -0.1 }, { r: 0.1, y: -0.04 }, { r: 0.09, y: 0.04 }, { r: 0.06, y: 0.07 }, { r: 0.07, y: 0.09 }], 10);

function pots():PropPart[] {
	return [
		at('pot-big', bigPot, terracotta, -0.18, 0, 0),
		at('pot-band', band(0.215, 0.17, 0.04), woodDark, -0.18, 0, 0),
		at('pot-jug', jug, cream, 0.18, 0, 0.08),
		...[0, 1, 2].map((i) => at('pot-bowl', bowl, blueGlaze, 0.14, i * 0.05, -0.17, 0, i * 0.7)),
		at('pot-small', smallPot, terracotta, -0.02, 0.1, 0.24, Math.PI / 2, 0.5),
	];
}

// Urn: a tall two-handled amphora with a dark band round its belly.

const urnBody = solid([{ r: 0.07, y: 0 }, { r: 0.12, y: 0.05 }, { r: 0.19, y: 0.3 }, { r: 0.16, y: 0.5 }, { r: 0.07, y: 0.6 }, { r: 0.06, y: 0.68 }, { r: 0.09, y: 0.72 }], 12);
const urnHandle = keep(new THREE.TorusGeometry(0.075, 0.016, 5, 10, Math.PI));

function urn():PropPart[] {
	return [
		at('urn', urnBody, terracotta),
		at('urn-band', band(0.19, 0.27, 0.05), woodDark),
		at('urn-handle', urnHandle, terracotta, -0.1, 0.53, 0, 0, 0, Math.PI / 2 + 0.3),
		at('urn-handle', urnHandle, terracotta, 0.1, 0.53, 0, 0, 0, -Math.PI / 2 - 0.3),
	];
}

// Basket: woven, heaped with fruit, a bail handle over the top.

const wicker = paint(0xb5874a, { pattern: 'thatch', patternScale: 0.05, patternInk: 0.4 });
const basketBody = solid([{ r: 0.15, y: 0 }, { r: 0.2, y: 0.18 }, { r: 0.21, y: 0.2 }], 12);
const basketBail = (():THREE.BufferGeometry => {
	const geo = new THREE.TorusGeometry(0.19, 0.012, 4, 14, Math.PI);
	geo.translate(0, 0.2, 0);
	return keep(geo);
})();
const fruit = keep(new THREE.IcosahedronGeometry(0.065, 1));
const fruits = [paint(0xc23b3a), paint(0xe08a2e), paint(0x9cb84a)];

function basket():PropPart[] {
	const heap = [[-0.08, -0.05], [0.07, -0.06], [0, 0.07], [-0.1, 0.08], [0.1, 0.06], [0, -0.01]] as const;
	return [
		at('basket', basketBody, wicker),
		at('basket-bail', basketBail, wicker, 0, 0, 0, 0, 0.4),
		...heap.map(([x, z], i) => at(`basket-fruit${i}`, fruit, fruits[i % fruits.length]!, x, 0.21 + (i === 5 ? 0.06 : 0), z, i, i)),
	];
}

// Ruins: columns standing, broken, fallen and in drums, and rubble. Pale weathered stone with moss.

const marble = paint(0xc9c0ae, { pattern: 'stone', patternScale: 0.3, patternInk: 0.3, rim: 0.15 });
const moss = paint(0x4f7a32);
const COLUMN_R = 0.23;
const plinth = keep(bevelBox(0.66, 0.18, 0.66, 0.03));
const capital = keep(bevelBox(0.62, 0.16, 0.62, 0.03));
const shaft = (h:number):THREE.BufferGeometry => keep(lathe([
	{ r: 0, y: 0 },
	{ r: COLUMN_R, y: 0 },
	{ r: COLUMN_R * 0.88, y: h },
	{ r: 0, y: h },
], 10));
const mossClump = keep(new THREE.IcosahedronGeometry(0.12, 1));
const shard = (():THREE.BufferGeometry => {
	const geo = new THREE.CylinderGeometry(COLUMN_R * 0.86, COLUMN_R * 0.88, 0.32, 10);
	geo.translate(0, 0.16, 0);
	return keep(geo);
})();

/** A standing column, whole or snapped off: not dressing but a pillar, which stands in the world as cover. */
export function columnParts(broken:boolean):PropPart[] {
	return broken ? brokenColumn() : column();
}

function column():PropPart[] {
	return [
		at('column-plinth', plinth, marble),
		at('column-shaft', shaft(2.3), marble, 0, 0.18, 0),
		at('column-capital', capital, marble, 0, 2.46, 0),
		at('column-moss', mossClump, moss, 0.18, 0.12, 0.2),
	];
}

function brokenColumn():PropPart[] {
	return [
		at('column-plinth', plinth, marble),
		at('column-stump', shaft(1.05), marble, 0, 0.18, 0),
		// The snapped-off top, tipped over on the stump.
		at('column-shard', shard, marble, 0.06, 1.18, 0, 0.1, 0, -0.32),
		at('column-moss', mossClump, moss, -0.14, 1.2, 0.08),
		at('column-moss', mossClump, moss, 0.2, 0.14, -0.16),
	];
}

const drumGeo = rod(0.44, COLUMN_R, 10);
const fallenShaft = (length:number):THREE.BufferGeometry => rod(length, COLUMN_R, 10);

function drums():PropPart[] {
	return [
		at('drum', drumGeo, marble, 0, COLUMN_R, 0, 0, 0.4),
		at('drum-up', shard, marble, 0.45, 0, -0.18, 0, 0.3),
		at('drum-moss', mossClump, moss, 0.05, 0.4, 0.05),
	];
}

// Along +X: two lengths of shaft cracked apart, the capital lying where it fell.
function fallenColumn():PropPart[] {
	return [
		at('fallen-shaft', fallenShaft(1.3), marble, -0.55, COLUMN_R, 0),
		at('fallen-shaft', fallenShaft(0.95), marble, 0.68, COLUMN_R, 0.06, 0, -0.14),
		at('fallen-capital', capital, marble, -1.3, 0, 0.05, 0, 0.3),
		at('fallen-moss', mossClump, moss, -0.2, 0.4, 0.12),
	];
}

const rocks = [0.2, 0.16, 0.13, 0.1].map((r) => keep(new THREE.IcosahedronGeometry(r, 0)));
const slab = keep(bevelBox(0.5, 0.12, 0.34, 0.02));

function rubble():PropPart[] {
	return [
		at('rubble-slab', slab, marble, 0.05, 0, 0.05, 0.12, 0.6, 0.1),
		at('rubble-rock', rocks[0]!, stone, -0.2, 0.12, -0.12, 0.3, 0.2),
		at('rubble-rock', rocks[1]!, marble, 0.24, 0.1, -0.16, 0.8, 1.1),
		at('rubble-rock', rocks[2]!, stone, -0.06, 0.08, 0.28, 1.3, 0.5),
		at('rubble-rock', rocks[3]!, marble, 0.3, 0.06, 0.24, 0.5, 2.1),
		at('rubble-rock', rocks[3]!, stone, -0.32, 0.06, 0.16, 2.2, 0.9),
	];
}

// Dungeon: a heap of bones, and a brazier of live coals.

const boneMat = paint(0xe6dcc2);
const skull = (():THREE.BufferGeometry => {
	const geo = new THREE.IcosahedronGeometry(0.09, 1);
	geo.scale(1, 0.9, 1.15);
	return keep(geo);
})();
const longBone = rod(0.42, 0.022, 6);
const rib = keep(new THREE.TorusGeometry(0.11, 0.012, 4, 10, Math.PI));

function bones():PropPart[] {
	return [
		at('skull', skull, boneMat, 0.12, 0.08, 0.05, 0.2, 0.7),
		at('bone', longBone, boneMat, -0.08, 0.025, -0.06, 0, 0.5),
		at('bone', longBone, boneMat, -0.02, 0.05, 0.08, 0, -0.4, 0.1),
		at('rib', rib, boneMat, -0.2, 0.01, 0.12, -Math.PI / 2, 0.3),
		at('rib', rib, boneMat, -0.16, 0.01, 0.2, -Math.PI / 2, 0.5),
	];
}

const brazierBowl = keep(lathe([
	{ r: 0, y: 0.62 },
	{ r: 0.12, y: 0.62 },
	{ r: 0.28, y: 0.78 },
	{ r: 0.26, y: 0.8 },
	{ r: 0.1, y: 0.66 },
	{ r: 0, y: 0.66 },
], 12));
const brazierLeg = keep(tube([{ x: 0, y: 0, z: 0.24 }, { x: 0, y: 0.7, z: 0.1 }], 0.018, 5));
const coal = keep(new THREE.IcosahedronGeometry(0.07, 0));
const ember = paint(0xff7a2a, { emissive: 0xff5a1a, emissiveIntensity: 1.4, outline: false });

function brazier():PropPart[] {
	const legs = [0, 1, 2].map((i) => at('brazier-leg', brazierLeg, iron, 0, 0, 0, 0, (i / 3) * Math.PI * 2));
	const coals = [[-0.08, 0.02], [0.07, -0.05], [0.02, 0.08], [0.1, 0.06], [-0.05, -0.09]] as const;
	return [
		at('brazier-bowl', brazierBowl, iron),
		...legs,
		...coals.map(([x, z], i) => at('brazier-coal', coal, ember, x, 0.72 + (i % 2) * 0.03, z, i, i, 0, false)),
	];
}

const catalog:Record<PropID, PropPart[]> = {
	broom: broom(),
	bucket: bucket(),
	barrel: [
		at('barrel', barrelBody, wood),
		at('barrel-hoop', band(0.19, 0.05, 0.035), iron),
		at('barrel-hoop', band(0.214, 0.25, 0.035), iron),
		at('barrel-hoop', band(0.19, 0.46, 0.035), iron),
	],
	crate: crate(),
	flowerbed: flowerbed(),
	table: table(),
	chair: chair(),
	bench: bench(),
	well: well(),
	woodpile: woodpile(),
	wheelbarrow: wheelbarrow(),
	sacks: sacks(),
	lantern: lantern(),
	shelf: shelf(),
	jars: jars(),
	weaponRack: weaponRack(),
	bed: bed(),
	chest: chest(),
	pots: pots(),
	urn: urn(),
	basket: basket(),
	drums: drums(),
	fallenColumn: fallenColumn(),
	rubble: rubble(),
	bones: bones(),
	brazier: brazier(),
};

export function propParts(id:PropID):PropPart[] {
	return catalog[id];
}
