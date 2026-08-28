import type { MapAsk, MapMark, MapSnapshot } from 'arc-director';
import {
	Bridge,
	Chest,
	Door,
	HumanBody,
	MillLever,
	Named,
} from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { CELL_SIZE, CHUNK_SIZE } from '../world/constants';
import { tileFill } from '../world/tileFill';
import { markSymbol } from './mapMarks';

const VOID = '#141018';
const CLOSE_RADIUS = 12;
const TARGET_PX = 256;
const TILE_PX_MIN = 6;
const TILE_PX_MAX = 16;
const DETAIL_ZOOM = 0.45;

const LANDMARKS = [
	'Cottage',
	'CottageDoor',
	'CottageHearth',
	'MillLever',
	'MillBridge',
	'MillCrank',
	'FireMushroom',
	'EastGate',
	'WestGate',
	'BrewHearth',
	'NollCot',
	'LinaCot',
	'ArmoryChest',
	'Player',
];

type Bounds = {
	originX:number;
	originZ:number;
	cols:number;
	rows:number;
};

export function snapshotMap(world:World, zoom:number, ask:MapAsk):MapSnapshot | null {
	const bounds = viewBounds(world, ask.id, zoom);
	if (!bounds) {
		return null;
	}
	const span = Math.max(bounds.cols, bounds.rows, 1);
	const px = Math.max(TILE_PX_MIN, Math.min(TILE_PX_MAX, Math.round(TARGET_PX / span)));
	const painted = paintTiles(world, bounds, px);
	if (!painted) {
		return null;
	}
	const marks = collectMarks(world, ask, zoom >= DETAIL_ZOOM, bounds);
	return {
		image: painted.image,
		width: painted.width,
		height: painted.height,
		toPixel: (x, y) => ({
			u: (x - bounds.originX) * px,
			v: (y - bounds.originZ) * px,
		}),
		marks,
	};
}

function worldBounds(world:World):Bounds | null {
	let minCX = 0;
	let minCZ = 0;
	let maxCX = 0;
	let maxCZ = 0;
	let first = true;
	for (const chunk of world.chunks.values()) {
		if (first) {
			minCX = maxCX = chunk.origin.cx;
			minCZ = maxCZ = chunk.origin.cz;
			first = false;
		}
		else {
			minCX = Math.min(minCX, chunk.origin.cx);
			minCZ = Math.min(minCZ, chunk.origin.cz);
			maxCX = Math.max(maxCX, chunk.origin.cx);
			maxCZ = Math.max(maxCZ, chunk.origin.cz);
		}
	}
	if (first) {
		return null;
	}
	return {
		originX: minCX * CHUNK_SIZE * CELL_SIZE,
		originZ: minCZ * CHUNK_SIZE * CELL_SIZE,
		cols: (maxCX - minCX + 1) * CHUNK_SIZE,
		rows: (maxCZ - minCZ + 1) * CHUNK_SIZE,
	};
}

function nearBounds(world:World, id:string):Bounds | null {
	const body = world.findByID(id);
	if (!body || world.chunks.size === 0) {
		return null;
	}
	const p = body.transform.position;
	const originX = Math.floor(p.x / CELL_SIZE) * CELL_SIZE - CLOSE_RADIUS * CELL_SIZE;
	const originZ = Math.floor(p.z / CELL_SIZE) * CELL_SIZE - CLOSE_RADIUS * CELL_SIZE;
	return {
		originX,
		originZ,
		cols: CLOSE_RADIUS * 2 + 1,
		rows: CLOSE_RADIUS * 2 + 1,
	};
}

function mix(a:number, b:number, t:number):number {
	return a + (b - a) * t;
}

function viewBounds(world:World, id:string, zoom:number):Bounds | null {
	const far = worldBounds(world);
	const close = nearBounds(world, id);
	if (!far) {
		return null;
	}
	if (!close || zoom <= 0) {
		return far;
	}
	if (zoom >= 1) {
		return close;
	}
	return {
		originX: Math.floor(mix(far.originX, close.originX, zoom) / CELL_SIZE) * CELL_SIZE,
		originZ: Math.floor(mix(far.originZ, close.originZ, zoom) / CELL_SIZE) * CELL_SIZE,
		cols: Math.max(1, Math.round(mix(far.cols, close.cols, zoom))),
		rows: Math.max(1, Math.round(mix(far.rows, close.rows, zoom))),
	};
}

function paintTiles(world:World, bounds:Bounds, px:number):{ image:string; width:number; height:number } | null {
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, bounds.cols) * px;
	canvas.height = Math.max(1, bounds.rows) * px;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		return null;
	}
	ctx.fillStyle = VOID;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	for (let row = 0; row < bounds.rows; row++) {
		for (let col = 0; col < bounds.cols; col++) {
			const x = bounds.originX + (col + 0.5) * CELL_SIZE;
			const z = bounds.originZ + (row + 0.5) * CELL_SIZE;
			const tile = world.tileAtWorld(x, z);
			ctx.fillStyle = tile
				? tileFill(tile.def, tile.blocked, tile.height)
				: VOID;
			ctx.fillRect(col * px, row * px, px, px);
		}
	}
	return { image: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

function collectMarks(world:World, ask:MapAsk, detail:boolean, bounds:Bounds):MapMark[] {
	const out:MapMark[] = [];
	const seen = new Set<string>();

	const add = (go:GameObject | undefined, description:string):void => {
		if (!go) {
			return;
		}
		const label = description.trim();
		if (!label || seen.has(label)) {
			return;
		}
		const p = go.transform.position;
		if (!inView(p.x, p.z, bounds)) {
			return;
		}
		seen.add(label);
		out.push({ symbol: markSymbol(label), description: label, x: p.x, y: p.z });
	};

	const self = world.findByID(ask.id);
	add(self, 'you');

	world.forEachComponent(HumanBody, (_body, go) => {
		if (go.id === ask.id || !world.npcCanSee(go)) {
			return;
		}
		add(go, markName(go));
	});

	for (const id of LANDMARKS) {
		const go = world.findNamed(id);
		if (!go || go.id === ask.id) {
			continue;
		}
		if (go.getComponent(HumanBody) && !world.npcCanSee(go)) {
			continue;
		}
		add(go, markName(go));
	}

	if (detail) {
		world.forEachComponent(Door, (_c, go) => {
			add(go, markName(go));
		});
		world.forEachComponent(Chest, (_c, go) => {
			add(go, markName(go));
		});
		world.forEachComponent(Bridge, (_c, go) => {
			add(go, markName(go));
		});
		world.forEachComponent(MillLever, (_c, go) => {
			add(go, markName(go));
		});
	}

	for (const name of goalNames(ask.goals)) {
		if (name === ask.id || name === 'you') {
			continue;
		}
		add(world.findNamed(name), name);
	}

	return out;
}

function markName(go:GameObject | undefined):string {
	if (!go) {
		return '';
	}
	return go.getComponent(Named)?.id || go.id || go.name;
}

function inView(x:number, z:number, bounds:Bounds):boolean {
	return x >= bounds.originX
		&& z >= bounds.originZ
		&& x < bounds.originX + bounds.cols * CELL_SIZE
		&& z < bounds.originZ + bounds.rows * CELL_SIZE;
}

function goalNames(goals:{ text:string }[]):string[] {
	const out:string[] = [];
	const seen = new Set<string>();
	for (const g of goals) {
		const words = g.text.match(/\b[A-Z][A-Za-z0-9]+\b/g) ?? [];
		for (const w of words) {
			if (w.length < 3 || seen.has(w)) {
				continue;
			}
			seen.add(w);
			out.push(w);
		}
	}
	return out;
}
