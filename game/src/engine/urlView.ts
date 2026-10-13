/** Testing-only URL flags (`player` `ai` `stats`) and the agent camera: a `view` shot, a `focus` expression, a `zoom`. */
import { PLAYER_MODES, type PlayerMode, type Prefs } from '../prefs';
import type { ViewPose } from './viewPersist';

export type URLView = {
	x:number;
	y:number;
	z:number;
	yaw:number;
};

export type URLFlags = {
	player?:PlayerMode;
	ai?:boolean;
};

const VIEW_KEYS = ['view', 'x', 'y', 'z', 'yaw', 'focus', 'zoom'] as const;

function finiteNum(raw:string):number | undefined {
	if (raw === '') {
		return undefined;
	}
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

/** Present key: empty/`1`/`true`/`yes`/`on` → true; `0`/`false`/`no`/`off` → false. */
export function parseURLBool(raw:string | null):boolean | undefined {
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
export function parseURLView(raw:string | null):URLView | null {
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

export function packURLView(pose:ViewPose):string {
	return `${compact(pose.x)},${compact(pose.y)},${compact(pose.z)},${compact(pose.camYaw)}`;
}

export function readURLView(search = window.location.search):URLView | null {
	return parseURLView(new URLSearchParams(search).get('view'));
}

export function readURLFlags(search = window.location.search):URLFlags {
	const q = new URLSearchParams(search);
	return {
		player: PLAYER_MODES.find((mode) => mode === q.get('player')),
		ai: parseURLBool(q.has('ai') ? (q.get('ai') ?? '') : null),
	};
}

/** Testing-only client id for the control hub. Empty or omitted → no socket. */
export function readURLSession(search = window.location.search):string {
	return (new URLSearchParams(search).get('session') ?? '').trim();
}

/** Agent-only camera: `focus` follows whom a watch expression picks, `zoom` is the camera distance in meters. */
export function readURLCamera(search = window.location.search):{ focus:string; zoom?:number } {
	const q = new URLSearchParams(search);
	return { focus: (q.get('focus') ?? '').trim(), zoom: finiteNum(q.get('zoom') ?? '') };
}

/** Testing-only `stats=1`: the render stats overlay. */
export function readURLStats(search = window.location.search):boolean {
	const q = new URLSearchParams(search);
	return parseURLBool(q.has('stats') ? (q.get('stats') ?? '') : null) ?? false;
}

export function writeURLSession(session:string):void {
	replaceURL((url) => {
		const id = session.trim();
		if (id) {
			url.searchParams.set('session', id);
		}
		else {
			url.searchParams.delete('session');
		}
	});
}

/** Apply a full URL shot. `yaw` sets both player facing and camera yaw. */
export function applyURLView(pose:ViewPose, view:URLView):ViewPose {
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
 * Keep `?scene=` plus `player`/`ai` in the bar (no history entries).
 * `view` is agent-only: never add it; if already present, keep it in sync.
 */
export function writeURLView(pose:ViewPose, flags:Pick<Prefs, 'player' | 'ai'>):void {
	if (!window.location.search.includes('scene=')) {
		return;
	}
	replaceURL((url) => {
		for (const key of ['x', 'y', 'z', 'yaw']) {
			url.searchParams.delete(key);
		}
		if (url.searchParams.has('view')) {
			url.searchParams.set('view', packURLView(pose));
		}
		url.searchParams.set('player', flags.player);
		url.searchParams.set('ai', flags.ai ? '1' : '0');
	});
}

export function clearURLView():void {
	replaceURL((url) => {
		for (const key of [...VIEW_KEYS, 'player', 'ai']) {
			url.searchParams.delete(key);
		}
	});
}

function replaceURL(edit:(url:URL)=>void):void {
	const url = new URL(window.location.href);
	edit(url);
	if (url.href === window.location.href) {
		return;
	}
	window.history.replaceState({}, '', url);
}
