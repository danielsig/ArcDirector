import type { MapMark, MapPrev, MapSnapshot } from 'arc-director';
import {
	Bridge,
	BridgeLever,
	Chest,
	Door,
	HumanBody,
	Named,
} from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { CELL_SIZE } from '../world/constants';
import { tileFill } from '../world/tileFill';
import { markSymbol, YOU_SYMBOL } from './mapMarks';

const VOID = '#141018';
const CLOSE_RADIUS = 12;
const TARGET_PX = 256;
const TILE_PX_MIN = 6;
const TILE_PX_MAX = 16;
const DETAIL_ZOOM = 0.45;
/** Game-time seconds before a new picture is allowed. */
const lookCooldown = 60;
/** Map units; last picture is unchanged if the character moved less than this. */
const samePictureIfCloserThan = 2;

const LANDMARKS:{ [symbol:string]:string } = {
	'🏠': 'Cottage',
	'🚪': 'CottageDoor',
	'🔥': 'CottageHearth',
	'🎚️': 'BridgeLever',
	'🌉': 'Bridge',
	'⚙️': 'BridgeCrank',
	'🍄': 'FireMushroom',
	'⛩️': 'EastGate',
	'🏯': 'WestGate',
	'🧪': 'BrewHearth',
	'🛏️': 'NollCot',
	'🛌': 'LinaCot',
	'🧰': 'ArmoryChest',
	'🧍': 'Player',
};

type Bounds = {
	originX:number;
	originY:number;
	cols:number;
	rows:number;
};

export function snapshotMap(
	world:World,
	npcID:string,
	zoom:number,
	prev?:MapPrev,
	origin?:{ x:number; z:number },
):MapSnapshot | { image:string } | null {
	const go = world.findByID(npcID);
	const p = origin ?? go?.transform.position;
	if (prev && p && holdLastPicture(world.time, prev, zoom, p.x, p.z)) {
		return { image: prev.image };
	}
	const bounds = viewBounds(world, npcID, zoom, origin);
	if (!bounds) {
		return null;
	}
	const span = Math.max(bounds.cols, bounds.rows, 1);
	const px = Math.max(TILE_PX_MIN, Math.min(TILE_PX_MAX, Math.round(TARGET_PX / span)));
	const painted = paintTiles(world, bounds, px);
	if (!painted) {
		return null;
	}
	const marks = collectMarks(world, npcID, zoom >= DETAIL_ZOOM, bounds, origin);
	return {
		image: painted.image,
		width: painted.width,
		height: painted.height,
		toPixel: (x, y) => ({
			u: (x - bounds.originX) * px,
			v: (y - bounds.originY) * px,
		}),
		marks,
		x: p?.x,
		y: p?.z,
	};
}

function holdLastPicture(now:number, prev:MapPrev, zoom:number, x:number, y:number):boolean {
	if (prev.zoom !== zoom) {
		return false;
	}
	if (!(now - prev.timestamp < lookCooldown) || now < prev.timestamp) {
		return false;
	}
	if (prev.x === undefined || prev.y === undefined) {
		return true;
	}
	return Math.hypot(x - prev.x, y - prev.y) < samePictureIfCloserThan;
}

function worldBounds(world:World):Bounds | null {
	const b = world.chunkBounds();
	if (!b) {
		return null;
	}
	return {
		originX: b.minX,
		originY: b.minZ,
		cols: (b.maxX - b.minX) / CELL_SIZE,
		rows: (b.maxZ - b.minZ) / CELL_SIZE,
	};
}

function nearBounds(world:World, npcID:string, origin?:{ x:number; z:number }):Bounds | null {
	const p = origin ?? world.findByID(npcID)?.transform.position;
	if (!p || world.chunks.size === 0) {
		return null;
	}
	const originX = Math.floor(p.x / CELL_SIZE) * CELL_SIZE - CLOSE_RADIUS * CELL_SIZE;
	const originY = Math.floor(p.z / CELL_SIZE) * CELL_SIZE - CLOSE_RADIUS * CELL_SIZE;
	return {
		originX,
		originY,
		cols: CLOSE_RADIUS * 2 + 1,
		rows: CLOSE_RADIUS * 2 + 1,
	};
}

function mix(a:number, b:number, t:number):number {
	return a + (b - a) * t;
}

function viewBounds(world:World, npcID:string, zoom:number, origin?:{ x:number; z:number }):Bounds | null {
	const far = worldBounds(world);
	const close = nearBounds(world, npcID, origin);
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
		originY: Math.floor(mix(far.originY, close.originY, zoom) / CELL_SIZE) * CELL_SIZE,
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
			const y = bounds.originY + (row + 0.5) * CELL_SIZE;
			const tile = world.tileAtWorld(x, y);
			ctx.fillStyle = tile
				? tileFill(tile.def, tile.blocked, tile.height)
				: VOID;
			ctx.fillRect(col * px, row * px, px, px);
		}
	}
	return { image: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

function collectMarks(
	world:World,
	npcID:string,
	detail:boolean,
	bounds:Bounds,
	origin?:{ x:number; z:number },
):MapMark[] {
	const out:MapMark[] = [];
	const seen = new Set<string>();

	const add = (go:GameObject | undefined, id:string, symbol?:string):void => {
		if (!go) {
			return;
		}
		const label = id.trim();
		if (!label || seen.has(label)) {
			return;
		}
		const p = go.transform.position;
		const x = p.x;
		const y = p.z;
		if (!inView(x, y, bounds)) {
			return;
		}
		seen.add(label);
		out.push({
			symbol: symbol ?? symbolFor(label),
			id: label,
			x,
			y,
		});
	};

	const self = world.findByID(npcID);
	add(self, 'you', YOU_SYMBOL);
	if (!self && origin && inView(origin.x, origin.z, bounds)) {
		out.push({
			symbol: YOU_SYMBOL,
			id: 'you',
			x: origin.x,
			y: origin.z,
		});
		seen.add('you');
	}

	world.forEachComponent(HumanBody, (body, go) => {
		if (go.id === npcID || !world.npcCanSee(go)) {
			return;
		}
		add(go, markName(go));
	});

	for (const [symbol, name] of Object.entries(LANDMARKS)) {
		const go = world.findNamed(name);
		if (!go || go.id === npcID) {
			continue;
		}
		if (go.getComponent(HumanBody) && !world.npcCanSee(go)) {
			continue;
		}
		add(go, name, symbol);
	}

	if (detail) {
		world.forEachComponent(Door, (c, go) => {
			add(go, markName(go));
		});
		world.forEachComponent(Chest, (c, go) => {
			add(go, markName(go));
		});
		world.forEachComponent(Bridge, (c, go) => {
			add(go, markName(go));
		});
		world.forEachComponent(BridgeLever, (c, go) => {
			add(go, markName(go));
		});
	}

	return out;
}

function symbolFor(label:string):string {
	for (const [symbol, name] of Object.entries(LANDMARKS)) {
		if (name === label) {
			return symbol;
		}
	}
	return markSymbol(label);
}

function markName(go:GameObject | undefined):string {
	if (!go) {
		return '';
	}
	return go.getComponent(Named)?.id || go.id || go.name;
}

function inView(x:number, y:number, bounds:Bounds):boolean {
	return x >= bounds.originX
		&& y >= bounds.originY
		&& x < bounds.originX + bounds.cols * CELL_SIZE
		&& y < bounds.originY + bounds.rows * CELL_SIZE;
}
