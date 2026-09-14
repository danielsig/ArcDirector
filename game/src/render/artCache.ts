/** Layout written by the Vite art-cache plugin (`game/cache`). */

import artCache from 'virtual:art-cache';

export const DEFAULT_CHARACTER_HEIGHT = 1.52;
export const DEFAULT_WALK_FPS = 8;
export const DEFAULT_TAKE_FPS = 5;
export const PLAYER_WALK_FPS = 16;
export const PLAYER_KIND = 'player';

function positiveFps(value:unknown):number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function walkFpsFromSpec(spec:unknown, hour?:number):number | undefined {
	const asNumber = positiveFps(spec);
	if (asNumber !== undefined) {
		return asNumber;
	}
	if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
		return undefined;
	}
	const map = spec as Record<string, unknown>;
	if (hour !== undefined) {
		const padded = String(hour).padStart(2, '0');
		const keyed = positiveFps(map[String(hour)]) ?? positiveFps(map[padded]);
		if (keyed !== undefined) {
			return keyed;
		}
	}
	return positiveFps(map.default);
}

export function packedKinds():string[] {
	return Object.keys(artCache.kinds);
}

export function isPackedKind(kind:string):boolean {
	return Object.prototype.hasOwnProperty.call(artCache.kinds, kind);
}

export function characterHeight(kind:string):number {
	const h = artCache.kinds[kind]?.height;
	return typeof h === 'number' && h > 0 ? h : DEFAULT_CHARACTER_HEIGHT;
}

export function characterTakeFps(kind:string):number {
	return positiveFps(artCache.kinds[kind]?.takeFps) ?? DEFAULT_TAKE_FPS;
}

/** Walk cells/sec for this kind. `hour` selects a per-direction override from `character.json`. */
export function characterWalkFps(kind:string, hour?:number):number {
	const fallback = kind === PLAYER_KIND ? PLAYER_WALK_FPS : DEFAULT_WALK_FPS;
	return walkFpsFromSpec(artCache.kinds[kind]?.walkFps, hour) ?? fallback;
}

/** Folder name from the art cache (`witch` for the player kind). */
export function characterLabel(kind:string):string {
	const folder = artCache.kinds[kind]?.folder;
	if (typeof folder === 'string' && folder.length > 0) {
		return folder;
	}
	return kind;
}

export type CharacterOption = {
	id:string;
	label:string;
};

export function characterOptions():CharacterOption[] {
	return packedKinds()
		.map((id) => ({ id, label: characterLabel(id) }))
		.sort((a, b) => a.label.localeCompare(b.label));
}

export function resolvePlayerKind(kind:string | null | undefined):string {
	const id = kind?.trim() ?? '';
	if (id && isPackedKind(id)) {
		return id;
	}
	return isPackedKind(PLAYER_KIND) ? PLAYER_KIND : (packedKinds()[0] ?? PLAYER_KIND);
}

export type AtlasRect = [x:number, y:number, w:number, h:number];

export type KindAtlas = {
	hash:string;
	alb:string;
	nrm:string;
	w:number;
	h:number;
	frames:Record<string, AtlasRect>;
	/** Painted clocks: linear filter, no pixel snap. */
	cel?:boolean;
	/** Standing height in meters from `characters/{folder}/character.json`. */
	height?:number;
	/** Source folder under `public/characters`. Player kind is still `player`. */
	folder?:string;
	/** Take/give cells per second from `character.json`. */
	takeFps?:number;
	/** Walk cells per second, or per-hour map (`default` + `"12"` / `"03"` / …). */
	walkFps?:number | Record<string, number>;
	/** Body-left fist per hour: `[idle, walk_0, … walk_7]`. Card pixels, `r` radians. */
	left?:Record<string, HandPose[]>;
	/** Body-right fist per hour. Same layout as `left`. */
	right?:Record<string, HandPose[]>;
};

export type HandPose = {
	x:number;
	y:number;
	r:number;
};

export type ArtCacheManifest = {
	v:number;
	kinds:Record<string, KindAtlas>;
	sword:KindAtlas;
};

function hourPoses(map:Record<string, HandPose[]> | undefined, hour:number):HandPose[] | undefined {
	if (!map) {
		return undefined;
	}
	return map[String(hour)] ?? map[String(hour).padStart(2, '0')];
}

/** Card-pixel fist poses for one side. `[idle, walk_0, …]` when authored. */
export function characterHandPoses(kind:string, side:'left' | 'right', hour:number):HandPose[] | undefined {
	const entry = artCache.kinds[kind];
	return hourPoses(side === 'left' ? entry?.left : entry?.right, hour);
}
