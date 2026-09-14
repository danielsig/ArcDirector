/**
 * Character folders are `public/characters/{folder}/` with a `character.json`.
 * Kind id is the folder name, except the player kind which is a code string.
 *
 * Do not list folder names in scripts. Scan this directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_HEIGHT = 1.52;
export const DEFAULT_WALK_FPS = 8;
export const DEFAULT_TAKE_FPS = 5;

function asPositiveFps(value) {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

function readHandMap(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return undefined;
	}
	const out = {};
	for (const [key, value] of Object.entries(raw)) {
		if (!Array.isArray(value)) {
			continue;
		}
		const poses = [];
		for (const p of value) {
			if (!p || typeof p !== 'object') {
				continue;
			}
			const x = Number(p.x);
			const y = Number(p.y);
			const r = Number(p.r);
			if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r)) {
				continue;
			}
			poses.push({ x, y, r });
		}
		if (poses.length > 0) {
			out[key] = poses;
		}
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function readWalkFps(raw) {
	if (raw == null) {
		return undefined;
	}
	const n = asPositiveFps(raw);
	if (n !== undefined) {
		return n;
	}
	if (typeof raw !== 'object' || Array.isArray(raw)) {
		return undefined;
	}
	const out = {};
	for (const [key, value] of Object.entries(raw)) {
		const fps = asPositiveFps(value);
		if (fps !== undefined) {
			out[key] = fps;
		}
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/** Kind id used in game code for the player. */
export const PLAYER_KIND = 'player';
/** `public/characters/{folder}` that holds player art. */
export const PLAYER_FOLDER = 'hero';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function charactersDir(root = GAME_ROOT) {
	return path.join(root, 'public', 'characters');
}

export function kindForFolder(folder) {
	return folder === PLAYER_FOLDER ? PLAYER_KIND : folder;
}

export function folderForKind(kind) {
	return kind === PLAYER_KIND ? PLAYER_FOLDER : kind;
}

export function readCharacterMeta(dir) {
	const file = path.join(dir, 'character.json');
	if (!fs.existsSync(file)) {
		return { height: DEFAULT_HEIGHT };
	}
	const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
	const height = Number(raw.height);
	return {
		height: Number.isFinite(height) && height > 0 ? height : DEFAULT_HEIGHT,
		takeFps: asPositiveFps(raw.takeFps),
		walkFps: readWalkFps(raw.walkFps),
		left: readHandMap(raw.left),
		right: readHandMap(raw.right),
	};
}

/** `{ kind, folder, dir, height }` for every character folder. */
export function listCharacterEntries(root = GAME_ROOT) {
	const base = charactersDir(root);
	if (!fs.existsSync(base)) {
		return [];
	}
	const out = [];
	const claimed = new Map();
	for (const name of fs.readdirSync(base)) {
		if (name.startsWith('_')) {
			continue;
		}
		const dir = path.join(base, name);
		if (!fs.statSync(dir).isDirectory()) {
			continue;
		}
		if (!fs.existsSync(path.join(dir, 'character.json'))) {
			continue;
		}
		const kind = kindForFolder(name);
		const prev = claimed.get(kind);
		if (prev) {
			throw new Error(`kind ${kind} claimed by ${prev} and ${name}`);
		}
		claimed.set(kind, name);
		const meta = readCharacterMeta(dir);
		out.push({ kind, folder: name, dir, height: meta.height });
	}
	return out;
}

export function entryForKind(kind, root = GAME_ROOT) {
	return listCharacterEntries(root).find((e) => e.kind === kind) ?? null;
}

export function entryForFolder(folder, root = GAME_ROOT) {
	return listCharacterEntries(root).find((e) => e.folder === folder) ?? null;
}

export function isWorkDir(name) {
	return name.startsWith('_');
}
