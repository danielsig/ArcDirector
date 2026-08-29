import type * as THREE from 'three';
import { HUMAN_KINDS, POCKET_FRAMES, type HumanKind } from '../engine/components';
import artCache from 'virtual:art-cache';
import { cropBitmap, loadBitmap, pixelArtImage } from './spritesheet';
import type { AtlasRect } from './artCache';

export const NPC_ANIM_IDS = HUMAN_KINDS;

/** Authored idle hours. Left-hand 7/8/9/10/11 are FlipX of 5/4/3/2/1. */
export type IdleHour = 1 | 2 | 3 | 4 | 5 | 6 | 12;
/** Walk stays six views: 12/2/4/6 authored, 8/10 as FlipX of 4/2. */
export type WalkHour = 2 | 4 | 6 | 12;
export type ClockHour = IdleHour;

export type ClockMaps = {
	map:THREE.Texture;
	nrm:THREE.Texture;
	met:THREE.Texture;
};

export type ClockAnims = {
	idle:Record<IdleHour, ClockMaps>;
	walk:Record<WalkHour, ClockMaps[]>;
	take?:ClockMaps[];
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
const REQUIRED_IDLE:WalkHour[] = [2, 4, 6, 12];
const INBETWEEN_IDLE:Array<1 | 3 | 5> = [1, 3, 5];
const FALLBACK_HOURS:IdleHour[] = [6, 5, 4, 3, 2, 1, 12];
const IDLE_NEIGHBOR:Record<1 | 3 | 5, WalkHour> = { 1: 2, 3: 4, 5: 6 };

const npcAnims = new Map<string, HumanAnims>();
const loading = new Map<string, Promise<HumanAnims>>();

function padHour(hour:number):string {
	return hour.toString().padStart(2, '0');
}

async function cropMaps(
	alb:ImageBitmap,
	nrm:ImageBitmap,
	rect:AtlasRect | undefined,
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
	const nrmTex = pixelArtImage(nrmBmp, false);
	return {
		map: pixelArtImage(mapBmp, true),
		nrm: nrmTex,
		met: nrmTex,
	};
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
	const idle = {} as Record<IdleHour, ClockMaps>;
	const walk = {} as Record<WalkHour, ClockMaps[]>;
	const required = await Promise.all(REQUIRED_IDLE.map((hour) => {
		return cropMaps(alb, nrm, entry.frames[`idle_${padHour(hour)}`]);
	}));
	for (let i = 0; i < REQUIRED_IDLE.length; i++) {
		const maps = required[i];
		if (!maps) {
			throw new Error(`art cache missing idle ${id} ${REQUIRED_IDLE[i]}`);
		}
		idle[REQUIRED_IDLE[i]] = maps;
	}
	const walkLoaded = await Promise.all(WALK_HOURS.map(async (hour) => {
		const tag = padHour(hour);
		const frames = await Promise.all(
			[0, 1, 2, 3].map((i) => cropMaps(alb, nrm, entry.frames[`walk_${tag}_${i}`])),
		);
		if (frames.some((f) => !f)) {
			throw new Error(`art cache missing walk ${id} ${hour}`);
		}
		return [hour, frames as ClockMaps[]] as const;
	}));
	for (const [hour, frames] of walkLoaded) {
		walk[hour] = frames;
	}
	for (const hour of INBETWEEN_IDLE) {
		const extra = await cropMaps(alb, nrm, entry.frames[`idle_${padHour(hour)}`]);
		idle[hour] = extra ?? idle[IDLE_NEIGHBOR[hour]];
	}
	const take:ClockMaps[] = [];
	for (let i = 0; i < POCKET_FRAMES; i++) {
		const extra = await cropMaps(alb, nrm, entry.frames[`take_06_${i}`]);
		if (!extra) {
			break;
		}
		take.push(extra);
	}
	alb.close();
	nrm.close();
	return {
		clock: {
			idle,
			walk,
			take: take.length === POCKET_FRAMES ? take : undefined,
		},
	};
}

export async function loadNPCAnims(kinds:readonly HumanKind[] = HUMAN_KINDS):Promise<void> {
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

export function snapWalkHour(hour:number):WalkHour {
	if (hour === 1 || hour === 2) {
		return 2;
	}
	if (hour === 3 || hour === 4) {
		return 4;
	}
	if (hour === 12) {
		return 12;
	}
	return 6;
}

function walkFrames(clock:ClockAnims, hour:WalkHour):ClockMaps[] {
	const raw:unknown = clock.walk[hour] ?? clock.walk[6] ?? clock.walk[4];
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
	hour:IdleHour,
	walking:boolean,
	t:number,
	fps:number,
	offset = 0,
):ClockMaps {
	const idle = clock.idle[hour] ?? firstIdle(clock);
	if (!walking) {
		return idle;
	}
	const frames = walkFrames(clock, snapWalkHour(hour));
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

export function animIDFromMeshID(meshID:string):HumanKind {
	if (meshID === 'human') {
		return 'player';
	}
	if (meshID.startsWith('human_')) {
		const kind = meshID.slice('human_'.length);
		if ((HUMAN_KINDS as readonly string[]).includes(kind)) {
			return kind as HumanKind;
		}
	}
	return 'player';
}
