import type * as THREE from 'three';
import artCache from 'virtual:art-cache';
import { cropBitmap, loadBitmap, pixelArtImage } from './spritesheet';
import type { ClockMaps, WalkHour } from './humanAnims';

const SWORD_HOURS:WalkHour[] = [12, 2, 4, 6];

let swordMaps:Record<WalkHour, ClockMaps> | null = null;
let pending:Promise<void> | null = null;

export async function loadSwordAnims():Promise<void> {
	if (swordMaps) {
		return;
	}
	if (pending) {
		return pending;
	}
	pending = (async () => {
		const entry = artCache.sword;
		if (!entry) {
			throw new Error('art cache missing sword');
		}
		const base = import.meta.env.BASE_URL;
		const [alb, nrm] = await Promise.all([
			loadBitmap(`${base}${entry.alb}`, true),
			loadBitmap(`${base}${entry.nrm}`, false),
		]);
		const next = {} as Record<WalkHour, ClockMaps>;
		await Promise.all(SWORD_HOURS.map(async (hour) => {
			const tag = hour.toString().padStart(2, '0');
			const rect = entry.frames[`idle_${tag}`];
			if (!rect) {
				throw new Error(`art cache missing sword idle_${tag}`);
			}
			const [x, y, w, h] = rect;
			const [mapBmp, nrmBmp] = await Promise.all([
				cropBitmap(alb, x, y, w, h),
				cropBitmap(nrm, x, y, w, h),
			]);
			const nrmTex = pixelArtImage(nrmBmp, false);
			next[hour] = {
				map: pixelArtImage(mapBmp, true),
				nrm: nrmTex,
				met: nrmTex,
			};
		}));
		alb.close();
		nrm.close();
		swordMaps = next;
	})().catch((err:unknown) => {
		pending = null;
		throw err;
	});
	return pending;
}

export function swordsReady():boolean {
	return swordMaps !== null;
}

export function disposeSwordAnims():void {
	swordMaps = null;
	pending = null;
}

export function getSwordMaps(hour:WalkHour):ClockMaps | null {
	return swordMaps?.[hour] ?? swordMaps?.[6] ?? null;
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		swordMaps = null;
		pending = null;
	});
}
