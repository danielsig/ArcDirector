import * as THREE from 'three';
import { ChunkBound, GameObject, distanceXZ, mergeParts, spotThrough, tube, type PosedPart, type XZ } from '@arc-director/kindling';
import { Light } from '../../engine/components';
import { DemoMeshRenderer } from '../../engine/demo-mesh-renderer';
import type { DemoWorld } from '../../engine/demo-world';
import { moonlitStoneMat } from '../../render/toon';
import { CELL_SIZE, MOON_BLUE, MOON_WINDOW, TILE_HEIGHT, WALL_HEIGHT } from '../../world/constants';
import type { ChunkEntity, DemoChunk } from '../../world/demo-chunk';
import { entityPoint, thingAt, type Thing } from '../thing';
import { wallFaceInset, wallOffset } from '../walls/thin-wall';

/**
 * How far off the moon stands from what it shines through: down a stairwell far, so its rays come near parallel; at a
 * window near, so they spread and light a patch some times the window's size. And how far behind a window's face it
 * is framed: just past the bars, so they cast their shadows.
 */
const MOON_BACK = 30;
const MOON_WINDOW_BACK = 2.5;
const MOON_FRAME_DEPTH = 0.12;
/** A `moonbeam`'s stairwell: how far under the wall tops (the ceiling) its light comes in, and how wide its flight is. */
const MOONBEAM_DROP = 0.45;
const MOONBEAM_WIDTH = 4;
/** How fast moonlight fades with distance, and how far past the moonlight cell it reaches. */
const MOON_DECAY = 1.2;
const MOON_REACH = 6;

/** What of its light a spot or point light gives at `d` meters with `range` (three.js's falloff). */
function falloff(d:number, range:number):number {
	return Math.max(0, 1 - (d / range) ** 4) ** 2 / Math.max(d ** MOON_DECAY, 0.01);
}

type Point = { x:number; y:number; z:number };

/**
 * Calls `fn` with the `moonlight` cell nearest `p`, on the ground, once every chunk is in (it may lie in the next
 * one); never without one.
 */
function withNearestMoonlight(world:DemoWorld, p:Point, fn:(to:Point)=>void):void {
	world.after(0, () => {
		let to:Point | undefined;
		for (const chunk of world.terrain.chunks) {
			for (const lit of chunk.entities) {
				const at = lit.def === 'moonlight' || lit.def === 'moonbeam_target' ? entityPoint(chunk, lit) : undefined;
				if (at && (!to || distanceXZ(at, p) < distanceXZ(to, p))) {
					to = at;
				}
			}
		}
		if (to) {
			fn(to);
		}
	});
}

/** `meters` on from `p`, away from `from` (level, when `level`). */
function beyond(p:Point, from:Point, meters:number, level = false):Point {
	const d = { x: p.x - from.x, y: level ? 0 : p.y - from.y, z: p.z - from.z };
	const k = meters / (Math.hypot(d.x, d.y, d.z) || 1);
	return { x: p.x + d.x * k, y: p.y + d.y * k, z: p.z + d.z * k };
}

/**
 * Moonlight from `lamp`, far off, shining through an opening (its corners `through`) onto the moonlight cell at `to`:
 * it lights only through the opening (`spotThrough`), as brightly there as a lamp 3 m off would, and every body in it
 * casts its shadow.
 */
function spawnMoonbeam(world:DemoWorld, chunk:DemoChunk, id:string, lamp:Point, through:Point[], to:Point):void {
	const aim = spotThrough(lamp, through);
	const beam = new GameObject(id, 'Moonbeam');
	beam.transform.localPosition = lamp;
	beam.transform.yaw = aim.yaw;
	beam.transform.pitch = aim.pitch;
	const far = Math.hypot(to.x - lamp.x, to.y - lamp.y, to.z - lamp.z);
	const range = far + MOON_REACH;
	beam.addComponent(Light, {
		kind: 'spot',
		color: MOON_BLUE,
		intensity: 40 * falloff(3, 9) / falloff(far, range),
		range,
		decay: MOON_DECAY,
		angle: aim.angle,
		penumbra: 0,
		cookie: aim.cookie,
		shadowNear: aim.shadowNear,
		castShadow: true,
		intensityFlicker: 0,
	});
	beam.addComponent(ChunkBound, { chunkID: chunk.id });
	world.add(beam);
}

/** A rectangle's corners: `width` along `across` (level) and `height` up, about `c`. */
function rectCorners(c:Point, across:XZ, width:number, height:number):Point[] {
	return [-1, 1].flatMap((s) => [-1, 1].map((t) => ({ x: c.x + across.x * s * width / 2, y: c.y + t * height / 2, z: c.z + across.z * s * width / 2 })));
}

/** The moonlight down a stairwell, from its top (`from`): level with it, under the ceiling, so it never lights the rock over. */
function spawnStairwellMoonbeam(world:DemoWorld, chunk:DemoChunk, id:string, from:Point):void {
	withNearestMoonlight(world, from, (to) => {
		const reach = distanceXZ(from, to) || 1;
		const across = { x: -(from.z - to.z) / reach, z: (from.x - to.x) / reach };
		// The band from where it comes in, under the ceiling, down to the moonlight at the stairs' foot.
		const through = [...rectCorners(from, across, MOONBEAM_WIDTH, 0), ...rectCorners(to, across, MOONBEAM_WIDTH, 0)];
		spawnMoonbeam(world, chunk, id, beyond(from, to, MOON_BACK, true), through, to);
	});
}

/**
 * A barred window through the wall beside its cell (the chunk mesh cuts the opening), with moonlight falling through
 * it onto the chunk's `moonlight` cell: bars on the wall face, and a spot light on them, shining down into the room.
 */
function spawnMoonWindow(world:DemoWorld, chunk:DemoChunk, ent:ChunkEntity):void {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const off = wallOffset(world.terrain, chunk.tileCoord(ent.localX, ent.localZ));
	const floor = (chunk.tile(ent.localX, ent.localZ)?.height ?? 0) * TILE_HEIGHT;
	const reach = Math.hypot(off.x, off.z) || 1;
	const out = { x: off.x / reach, z: off.z / reach };
	const face = CELL_SIZE / 2 + wallFaceInset(chunk.tile(ent.localX + Math.round(out.x), ent.localZ + Math.round(out.z)));
	const pane = new GameObject(`moon_window_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Window');
	pane.transform.localPosition = { x: center.x + out.x * face, y: floor + MOON_WINDOW.y, z: center.z + out.z * face };
	pane.transform.yaw = off.yaw + Math.PI;
	pane.addComponent(DemoMeshRenderer, { meshID: 'moon_window' });
	pane.addComponent(ChunkBound, { chunkID: chunk.id });
	world.add(pane);
	const frame = { x: pane.transform.position.x + out.x * MOON_FRAME_DEPTH, y: floor + MOON_WINDOW.y, z: pane.transform.position.z + out.z * MOON_FRAME_DEPTH };
	const through = rectCorners(frame, { x: -out.z, z: out.x }, MOON_WINDOW.width, MOON_WINDOW.height);
	withNearestMoonlight(world, frame, (to) => {
		spawnMoonbeam(world, chunk, `moonbeam_${chunk.id}_${ent.localX}_${ent.localZ}`, beyond(frame, to, MOON_WINDOW_BACK), through, to);
	});
}

/** Where moonlight lands: a very faint blue glow about it, as if the moonlight spilled into the room. */
function spawnMoonlight(world:DemoWorld, chunk:DemoChunk, ent:ChunkEntity):void {
	const go = thingAt(chunk, { ...ent, name: undefined }, `moonlight_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Moonlight');
	go.transform.position.y += 0.1;
	go.addComponent(Light, { color: 0x6f8fff, intensity: 5, range: 4.5, decay: 0.05, castShadow: false, intensityFlicker: 0 });
	world.add(go);
}

/**
 * A barred window cut through its wall (the chunk mesh cuts the opening), its face toward +Z: iron bars across the
 * opening on the wall face, casting the moonlight's shadow, the opening's stone aglow with it, and a wall's thickness
 * back, night sky. Bars and sky unlit: the moonlight behind the bars would leave their faces dark. Centered on the opening; it sits on the wall face.
 */
function createMoonWindowMesh():THREE.Group {
	const g = new THREE.Group();
	const { width, height } = MOON_WINDOW;
	const sky = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: MOON_BLUE }));
	sky.position.z = 0.01 - CELL_SIZE;
	g.add(sky);
	// Lining the cut stone a hair in, so it glows where no light can be kept to: a lamp would light the wall round it.
	const lining = moonlitStoneMat();
	const inset = 0.004;
	for (const [across, along, x, y, rx, ry] of [
		[width, CELL_SIZE, 0, -height / 2 + inset, -Math.PI / 2, 0],
		[width, CELL_SIZE, 0, height / 2 - inset, Math.PI / 2, 0],
		[CELL_SIZE, height, -width / 2 + inset, 0, 0, Math.PI / 2],
		[CELL_SIZE, height, width / 2 - inset, 0, 0, -Math.PI / 2],
	] as const) {
		const face = new THREE.Mesh(new THREE.PlaneGeometry(across, along), lining);
		face.position.set(x, y, -CELL_SIZE / 2);
		face.rotation.set(rx, ry, 0);
		// The bars' shadows fall on it.
		face.receiveShadow = true;
		g.add(face);
	}
	// Set a little into the opening, their ends sunk in the stone above and below.
	const bars = 5;
	const end = height / 2 + 0.04;
	const parts:PosedPart[] = Array.from({ length: bars }, (element, i) => {
		const x = -width / 2 + ((i + 1) * width) / (bars + 1);
		return { geo: tube([{ x, y: -end, z: -0.08 }, { x, y: end, z: -0.08 }], 0.018, 6) };
	});
	const iron = new THREE.Mesh(mergeParts(parts), new THREE.MeshBasicMaterial({ color: 0x2a2622 }));
	iron.castShadow = true;
	g.add(iron);
	return g;
}

const PLACE:Record<string, (world:DemoWorld, chunk:DemoChunk, ent:ChunkEntity)=>void> = {
	moon_window: spawnMoonWindow,
	moonlight: spawnMoonlight,
	// From above, as down a stairwell from the night outside.
	moonbeam: (world, chunk, ent) => spawnStairwellMoonbeam(world, chunk, `moonbeam_${chunk.id}_${ent.localX}_${ent.localZ}`, { ...entityPoint(chunk, ent), y: WALL_HEIGHT - MOONBEAM_DROP }),
};

/** Moonlight in the dark: the barred windows it falls through, where it lands, and its light down a stairwell. */
export const moonlight:Thing = {
	defs: Object.keys(PLACE),
	spawn: (world, chunk, ents) => ents.forEach((ent) => PLACE[ent.def]!(world, chunk, ent)),
	meshes: { moon_window: createMoonWindowMesh },
};
