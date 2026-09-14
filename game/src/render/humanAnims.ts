import type * as THREE from 'three';
import { POCKET_FRAMES, type HumanKind } from '../engine/components';
import artCache from 'virtual:art-cache';
import { cropBitmap, loadBitmap, pixelArtImage, celArtImage } from './spritesheet';
import { isPackedKind, packedKinds, type AtlasRect } from './artCache';

export const NPC_ANIM_IDS = packedKinds();

/** Twelve clock hours. 12 is back, 6 is face-on. */
export type ClockHour = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
/** Authored idle hours on a sheet. Camera facing uses 45° octants, not 1/5/7/11. */
export type IdleHour = 1 | 2 | 3 | 4 | 5 | 6 | 12;
/**
 * Eight facing hours. 2/4/8/10 are 45° diagonals (1:30 / 4:30 / 7:30 / 10:30),
 * not analog 2:00 / 4:00. Degrees below are clockwise from 12 (back).
 *
 * 12 = 12:00 = 0°. 2 = 1:30 = 45°. 3 = 90°. 4 = 4:30 = 135°.
 * 6 = 180°. 8 = 7:30 = 225°. 9 = 270°. 10 = 10:30 = 315°.
 */
export type WalkHour = 2 | 3 | 4 | 6 | 8 | 9 | 10 | 12;

export type ClockMaps = {
	map:THREE.Texture;
	nrm:THREE.Texture;
	met:THREE.Texture;
};

export type ClockAnims = {
	idle:Partial<Record<ClockHour, ClockMaps>>;
	walk:Partial<Record<ClockHour, ClockMaps[]>>;
	take?:ClockMaps[];
	/** Idle_06 figure fraction of the card. Idle and walk share this so a padded cel does not shrink. */
	lockFillH?:number;
};

export type HumanAnims = {
	clock:ClockAnims;
	// --- old spritesheet player (spritesheet.jpg). Restore with playerAnims() if clock set is reverted.
	walk?:THREE.Texture[];
	walkFwd?:THREE.Texture[];
	idleFront?:THREE.Texture;
	idleFwd?:THREE.Texture;
	idleSide?:THREE.Texture;
	walkN?:THREE.Texture[];
	walkFwdN?:THREE.Texture[];
	idleFrontN?:THREE.Texture;
	idleFwdN?:THREE.Texture;
	idleSideN?:THREE.Texture;
	walkM?:THREE.Texture[];
	walkFwdM?:THREE.Texture[];
	idleFrontM?:THREE.Texture;
	idleFwdM?:THREE.Texture;
	idleSideM?:THREE.Texture;
};

const WALK_HOURS:WalkHour[] = [2, 4, 6, 12];
/** Packed on player (guide stems). Other kinds FlipX 4/3/2 when these are missing. */
const EXTRA_WALK:WalkHour[] = [3, 8, 9, 10];
const WALK_FRAME_CAP = 16;
const WALK_MIN_FRAMES = 4;
const PLAYER_WALK_FRAMES = 8;
const REQUIRED_IDLE:WalkHour[] = [2, 4, 6, 12];
const PLAYER_IDLE_LEFT:ClockHour[] = [8, 9, 10];
/** Clockwise from 12: 2=1:30/45°, 4=4:30/135°, 8=7:30/225°, 10=10:30/315°. */
const FACE_HOURS:readonly WalkHour[] = [12, 2, 3, 4, 6, 8, 9, 10];
const INBETWEEN_IDLE:Array<1 | 3 | 5> = [1, 3, 5];
const OPTIONAL_IDLE_LEFT:ClockHour[] = [7, 8, 9, 10, 11];
const FALLBACK_HOURS:ClockHour[] = [6, 5, 4, 3, 2, 1, 12, 8, 9, 10, 7, 11];
const IDLE_NEIGHBOR:Record<1 | 3 | 5, WalkHour> = { 1: 2, 3: 4, 5: 6 };

const npcAnims = new Map<string, HumanAnims>();
const loading = new Map<string, Promise<HumanAnims>>();

function padHour(hour:number):string {
	return hour.toString().padStart(2, '0');
}

/** Opaque bbox in bitmap pixels (y=0 at top). Ignores 1px specks so padding does not shrink the person. */
export type ContentBox = { x:number; y:number; w:number; h:number };

function opaqueBox(bmp:ImageBitmap):ContentBox {
	const full = { x: 0, y: 0, w: bmp.width, h: bmp.height };
	const canvas = document.createElement('canvas');
	canvas.width = bmp.width;
	canvas.height = bmp.height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		return full;
	}
	ctx.drawImage(bmp, 0, 0);
	const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height);
	const row = new Uint16Array(height);
	const col = new Uint16Array(width);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (data[(y * width + x) * 4 + 3] < 16) {
				continue;
			}
			row[y] += 1;
			col[x] += 1;
		}
	}
	const minRow = Math.max(2, Math.round(width * 0.02));
	const minCol = Math.max(2, Math.round(height * 0.02));
	let x0 = width;
	let y0 = height;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < height; y++) {
		if (row[y] >= minRow) {
			if (y < y0) {
				y0 = y;
			}
			y1 = y;
		}
	}
	for (let x = 0; x < width; x++) {
		if (col[x] >= minCol) {
			if (x < x0) {
				x0 = x;
			}
			x1 = x;
		}
	}
	if (x1 < x0 || y1 < y0) {
		return full;
	}
	return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Figure height / card height. Every clip of a kind shares idle_06's scale. */
export function mapsFillH(maps:ClockMaps):number {
	const img = maps.map.image as { width?:number; height?:number } | undefined;
	const ih = img?.height ?? 0;
	const box = maps.map.userData.content as ContentBox | undefined;
	const contentH = box && box.h > 0 ? box.h : ih;
	if (ih <= 0) {
		return 1;
	}
	return Math.min(1, Math.max(0.4, contentH / ih));
}

async function cropMaps(
	alb:ImageBitmap,
	nrm:ImageBitmap,
	rect:AtlasRect | undefined,
	cel:boolean,
):Promise<ClockMaps | null> {
	if (!rect) {
		return null;
	}
	const [x, y, w, h] = rect;
	if (w <= 0 || h <= 0) {
		return null;
	}
	const [mapBmp, nrmBmp] = await Promise.all([
		cropBitmap(alb, x, y, w, h),
		cropBitmap(nrm, x, y, w, h),
	]);
	const image = cel ? celArtImage : pixelArtImage;
	const nrmTex = image(nrmBmp, false);
	const map = image(mapBmp, true);
	map.userData.content = opaqueBox(mapBmp);
	return {
		map,
		nrm: nrmTex,
		met: nrmTex,
	};
}

async function loadWalkCells(
	alb:ImageBitmap,
	nrm:ImageBitmap,
	frames:Record<string, AtlasRect>,
	tag:string,
	cel:boolean,
):Promise<ClockMaps[]> {
	const out:ClockMaps[] = [];
	for (let i = 0; i < WALK_FRAME_CAP; i++) {
		const maps = await cropMaps(alb, nrm, frames[`walk_${tag}_${i}`], cel);
		if (!maps) {
			break;
		}
		out.push(maps);
	}
	return out;
}

async function loadKind(id:HumanKind):Promise<HumanAnims> {
	const entry = artCache.kinds[id];
	if (!entry) {
		throw new Error(`art cache missing kind ${id}`);
	}
	const base = import.meta.env.BASE_URL;
	const [alb, nrm] = await Promise.all([
		loadBitmap(`${base}${entry.alb}`, true),
		loadBitmap(`${base}${entry.nrm}`, false),
	]);
	const sample = Object.values(entry.frames)[0];
	const cel = entry.cel === true || (!!sample && sample[2] >= 160);
	const idle = {} as Partial<Record<ClockHour, ClockMaps>>;
	const walk = {} as Partial<Record<ClockHour, ClockMaps[]>>;
	const required = await Promise.all(REQUIRED_IDLE.map((hour) => {
		return cropMaps(alb, nrm, entry.frames[`idle_${padHour(hour)}`], cel);
	}));
	for (let i = 0; i < REQUIRED_IDLE.length; i++) {
		const maps = required[i];
		if (!maps) {
			throw new Error(`art cache missing idle ${id} ${REQUIRED_IDLE[i]}`);
		}
		idle[REQUIRED_IDLE[i]] = maps;
	}
	const walkLoaded = await Promise.all(WALK_HOURS.map(async (hour) => {
		const frames = await loadWalkCells(alb, nrm, entry.frames, padHour(hour), cel);
		const need = id === 'player' ? PLAYER_WALK_FRAMES : WALK_MIN_FRAMES;
		if (frames.length < need) {
			throw new Error(`art cache missing walk ${id} ${hour}`);
		}
		return [hour, frames] as const;
	}));
	for (const [hour, frames] of walkLoaded) {
		walk[hour] = frames;
	}
	await Promise.all(EXTRA_WALK.map(async (hour) => {
		const frames = await loadWalkCells(alb, nrm, entry.frames, padHour(hour), cel);
		if (id === 'player') {
			if (frames.length < PLAYER_WALK_FRAMES) {
				throw new Error(`art cache missing walk ${id} ${hour}`);
			}
			walk[hour] = frames;
			return;
		}
		if (frames.length >= WALK_MIN_FRAMES) {
			walk[hour] = frames;
		}
	}));
	if (!walk[3] && walk[4]) {
		walk[3] = walk[4];
	}
	for (const hour of INBETWEEN_IDLE) {
		const extra = await cropMaps(alb, nrm, entry.frames[`idle_${padHour(hour)}`], cel);
		idle[hour] = extra ?? idle[IDLE_NEIGHBOR[hour]];
	}
	for (const hour of OPTIONAL_IDLE_LEFT) {
		const extra = await cropMaps(alb, nrm, entry.frames[`idle_${padHour(hour)}`], cel);
		if (extra) {
			idle[hour] = extra;
		}
	}
	if (id === 'player') {
		for (const hour of PLAYER_IDLE_LEFT) {
			if (!idle[hour]) {
				throw new Error(`art cache missing idle ${id} ${hour}`);
			}
		}
	}
	const take:ClockMaps[] = [];
	for (let i = 0; i < POCKET_FRAMES; i++) {
		const extra = await cropMaps(alb, nrm, entry.frames[`take_06_${i}`], cel);
		if (!extra) {
			break;
		}
		take.push(extra);
	}
	alb.close();
	nrm.close();
	const lock = idle[6];
	return {
		clock: {
			idle,
			walk,
			take: take.length === POCKET_FRAMES ? take : undefined,
			lockFillH: lock ? mapsFillH(lock) : undefined,
		},
	};
}

export async function loadNPCAnims(kinds:readonly HumanKind[] = packedKinds()):Promise<void> {
	await Promise.all(kinds.map((id) => {
		const have = npcAnims.get(id);
		if (have) {
			return Promise.resolve(have);
		}
		let pending = loading.get(id);
		if (!pending) {
			pending = loadKind(id).then((anims) => {
				npcAnims.set(id, anims);
				loading.delete(id);
				return anims;
			}).catch((err:unknown) => {
				loading.delete(id);
				throw err;
			});
			loading.set(id, pending);
		}
		return pending;
	}));
}

export function hasHumanAnims(id:string):boolean {
	return npcAnims.has(id);
}

function firstIdle(clock:ClockAnims):ClockMaps {
	for (const hour of FALLBACK_HOURS) {
		const maps = clock.idle[hour];
		if (maps) {
			return maps;
		}
	}
	throw new Error('human clock idle missing');
}

export function wrapHour(h:number):ClockHour {
	const n = ((h % 12) + 12) % 12;
	return (n === 0 ? 12 : n) as ClockHour;
}

/** FlipX pair across 6–12: 4↔8, 3↔9, 2↔10. */
export function flipPairHour(h:number):ClockHour {
	return wrapHour(-h);
}

/**
 * 0° is hour 6 (face-on). 45° octants: 4 = 4:30 at +45°, 2 = 1:30 at +135°,
 * 8 = 7:30 at −45°, 10 = 10:30 at −135° (from camera; + = screen-right).
 */
export function hourFromViewDeg(deg:number):WalkHour {
	let d = deg;
	while (d > 180) {
		d -= 360;
	}
	while (d < -180) {
		d += 360;
	}
	const fromTwelve = (180 - d + 360) % 360;
	const octant = Math.round(fromTwelve / 45) % 8;
	return FACE_HOURS[octant] ?? 12;
}

export function hasClockView(clock:ClockAnims, hour:ClockHour, walking:boolean):boolean {
	if (walking) {
		return (clock.walk[hour]?.length ?? 0) > 0;
	}
	return !!clock.idle[hour];
}

/** Native hour if packed; else FlipX the pair. Missing 8 uses 4, missing 4 uses 8. */
export function resolveClockHour(
	clock:ClockAnims,
	hour:ClockHour,
	walking:boolean,
):{ hour:ClockHour; flip:number } {
	if (hasClockView(clock, hour, walking)) {
		return { hour, flip: 1 };
	}
	const pair = flipPairHour(hour);
	if (pair !== hour && hasClockView(clock, pair, walking)) {
		return { hour: pair, flip: -1 };
	}
	const snapped = walking ? snapWalkHour(hour) : hour;
	if (hasClockView(clock, snapped, walking)) {
		return { hour: snapped, flip: 1 };
	}
	const snapPair = flipPairHour(snapped);
	if (snapPair !== snapped && hasClockView(clock, snapPair, walking)) {
		return { hour: snapPair, flip: -1 };
	}
	return { hour: 6, flip: 1 };
}

export function snapWalkHour(hour:number):WalkHour {
	const h = wrapHour(hour);
	if (h === 2 || h === 3 || h === 4 || h === 6 || h === 8 || h === 9 || h === 10 || h === 12) {
		return h;
	}
	if (h === 1) {
		return 2;
	}
	if (h === 11) {
		return 12;
	}
	return 6;
}

function walkFrames(clock:ClockAnims, hour:ClockHour):ClockMaps[] {
	const raw:unknown = clock.walk[hour] ?? clock.walk[snapWalkHour(hour)] ?? clock.walk[6] ?? clock.walk[4];
	if (Array.isArray(raw)) {
		return raw as ClockMaps[];
	}
	if (raw && typeof raw === 'object' && 'map' in raw) {
		return [raw as ClockMaps];
	}
	return [];
}

export function walkFrameIndex(t:number, fps:number, frameCount:number, offset = 0):number {
	if (frameCount <= 0) {
		return 0;
	}
	return ((Math.floor((t + offset) * fps) % frameCount) + frameCount) % frameCount;
}

export function pickClockMaps(
	clock:ClockAnims,
	hour:ClockHour,
	walking:boolean,
	t:number,
	fps:number,
	offset = 0,
):ClockMaps {
	const idle = clock.idle[hour] ?? firstIdle(clock);
	if (!walking) {
		return idle;
	}
	const frames = walkFrames(clock, hour);
	if (frames.length === 0) {
		return idle;
	}
	return frames[walkFrameIndex(t, fps, frames.length, offset)] ?? idle;
}

export function pickPocketMaps(
	clock:ClockAnims,
	clip:'take' | 'give',
	t0:number,
	t:number,
	fps:number,
):ClockMaps | null {
	const frames = clock.take;
	if (!frames || frames.length === 0) {
		return null;
	}
	const n = frames.length;
	const elapsed = Math.max(0, t - t0);
	let i = Math.min(n - 1, Math.floor(elapsed * fps));
	if (clip === 'give') {
		i = n - 1 - i;
	}
	return frames[i] ?? null;
}

export function disposeNPCAnims():void {
	npcAnims.clear();
	loading.clear();
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		npcAnims.clear();
		loading.clear();
	});
}

export function getHumanAnims(id:string):HumanAnims {
	const npc = npcAnims.get(id);
	if (npc?.clock) {
		return npc;
	}
	throw new Error(`human anims not loaded: ${id}`);
	// Old spritesheet player — idle/walk crops from spritesheet.jpg + _normal/_metallic.
	// if (id === 'player') {
	// 	return playerAnims();
	// }
}

/*
function playerAnims():HumanAnims {
	const sheet = getSheet();
	return {
		clock: undefined as never,
		walk: sheet.walk,
		walkFwd: sheet.walkFwd,
		idleFront: sheet.idleFront,
		idleFwd: sheet.idleFwd,
		idleSide: sheet.idleSide,
		walkN: sheet.walkN,
		walkFwdN: sheet.walkFwdN,
		idleFrontN: sheet.idleFrontN,
		idleFwdN: sheet.idleFwdN,
		idleSideN: sheet.idleSideN,
		walkM: sheet.walkM,
		walkFwdM: sheet.walkFwdM,
		idleFrontM: sheet.idleFrontM,
		idleFwdM: sheet.idleFwdM,
		idleSideM: sheet.idleSideM,
	};
}
*/

/** Player spawn uses `human`. NPCs must use `human_<folder>` — never `human`. */
export function animIDFromMeshID(meshID:string):HumanKind {
	if (meshID === 'human') {
		return 'player';
	}
	if (meshID.startsWith('human_')) {
		const kind = meshID.slice('human_'.length);
		if (kind === 'player' || isPackedKind(kind)) {
			return kind;
		}
		throw new Error(`unknown human kind '${kind}' from meshID ${meshID}`);
	}
	throw new Error(`not a human meshID: ${meshID}`);
}
