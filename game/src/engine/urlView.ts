/** Testing-only URL flags (`observer` `ai`) and optional agent `view` shot. */
import type { DevFlags } from './devFlags';
import type { ViewPose } from './viewPersist';

export type UrlView = {
	x:number;
	y:number;
	z:number;
	yaw:number;
};

export type UrlFlags = {
	observer?:boolean;
	ai?:boolean;
};

const VIEW_KEYS = ['view', 'x', 'y', 'z', 'yaw'] as const;

function finiteNum(raw:string):number | undefined {
	if (raw === '') {
		return undefined;
	}
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

/** Present key: empty/`1`/`true`/`yes`/`on` → true; `0`/`false`/`no`/`off` → false. */
export function parseUrlBool(raw:string | null):boolean | undefined {
	if (raw === null) {
		return undefined;
	}
	const v = raw.trim().toLowerCase();
	if (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on') {
		return true;
	}
	if (v === '0' || v === 'false' || v === 'no' || v === 'off') {
		return false;
	}
	return undefined;
}

function compact(n:number):string {
	return String(Math.round(n * 10000) / 10000);
}

/** `view=x,y,z,yaw` — all four or nothing. */
export function parseUrlView(raw:string | null):UrlView | null {
	if (raw === null || raw === '') {
		return null;
	}
	const parts = raw.split(',').map((p) => p.trim());
	if (parts.length !== 4) {
		return null;
	}
	const x = finiteNum(parts[0] ?? '');
	const y = finiteNum(parts[1] ?? '');
	const z = finiteNum(parts[2] ?? '');
	const yaw = finiteNum(parts[3] ?? '');
	if (x === undefined || y === undefined || z === undefined || yaw === undefined) {
		return null;
	}
	return { x, y, z, yaw };
}

export function packUrlView(pose:ViewPose):string {
	return `${compact(pose.x)},${compact(pose.y)},${compact(pose.z)},${compact(pose.camYaw)}`;
}

export function readUrlView(search = window.location.search):UrlView | null {
	return parseUrlView(new URLSearchParams(search).get('view'));
}

export function readUrlFlags(search = window.location.search):UrlFlags {
	const q = new URLSearchParams(search);
	return {
		observer: parseUrlBool(q.has('observer') ? (q.get('observer') ?? '') : null),
		ai: parseUrlBool(q.has('ai') ? (q.get('ai') ?? '') : null),
	};
}

/** Apply a full URL shot. `yaw` sets both player facing and camera yaw. */
export function applyUrlView(pose:ViewPose, view:UrlView):ViewPose {
	return {
		...pose,
		x: view.x,
		y: view.y,
		z: view.z,
		yaw: view.yaw,
		camYaw: view.yaw,
	};
}

/**
 * Keep `?scene=` plus `observer`/`ai` in the bar (no history entries).
 * `view` is agent-only: never add it; if already present, keep it in sync.
 */
export function writeUrlView(pose:ViewPose, flags:DevFlags):void {
	if (!window.location.search.includes('scene=')) {
		return;
	}
	const url = new URL(window.location.href);
	for (const key of ['x', 'y', 'z', 'yaw']) {
		url.searchParams.delete(key);
	}
	if (url.searchParams.has('view')) {
		url.searchParams.set('view', packUrlView(pose));
	}
	url.searchParams.set('observer', flags.observer ? '1' : '0');
	url.searchParams.set('ai', flags.ai ? '1' : '0');
	if (url.href === window.location.href) {
		return;
	}
	window.history.replaceState({}, '', url);
}

export function clearUrlView():void {
	const url = new URL(window.location.href);
	for (const key of [...VIEW_KEYS, 'observer', 'ai']) {
		url.searchParams.delete(key);
	}
	window.history.replaceState({}, '', url);
}
