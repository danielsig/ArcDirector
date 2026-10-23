import { chunkBounds } from '@arc-director/kindling';
import type { Chunk, Tile } from './Chunk';
import { CELL_SIZE } from './constants';
import { showsWater } from './water';

/**
 * Landforms and the land beyond the map. A map has no walls at the end of the world: past each edge tile the
 * land goes on to the horizon as that tile does (a cliff as the meadow on top of it, water as its river, a
 * forest as more forest), at its height or one the scene sets per edge tile.
 */

/**
 * Tiles drawn as land, not as blocks: a cliff (meadow on top), a cliff with a river on top, a forest too thick to
 * walk into, and a trail: a dark road into the forest, which a road on the map leads up to.
 */
export const LANDFORMS = new Set(['cliff', 'cliff_water', 'forest', 'trail']);

/** What the top of some land is. `void` is none: nothing is drawn, so the background shows (a dungeon's solid rock). */
export type Surface = 'meadow' | 'floor' | 'water' | 'forest' | 'trail' | 'void';

/** Land as the outskirts continue it: its surface, its height in tiles, and a river's current. */
export type Land = { surface:Surface; height:number; flow?:{ x:number; z:number }; /** Meters the surface sits above the tile height. Unset land sits on the grass line. */ deck?:number };

export type Side = 'north' | 'east' | 'south' | 'west';

/**
 * Height in tiles of the land beyond each edge tile, per side: north and south west to east, east and west north
 * to south. A missing entry keeps the edge tile's own height.
 */
export type OutskirtHeights = Partial<Record<Side, (number | undefined)[]>>;

/** World XZ box, meters. */
export type Rect = { minX:number; maxX:number; minZ:number; maxZ:number };

/** A stretch of the outskirts: one land over a box, and which way is away from the map. */
export type LandRect = Land & Rect & { out:{ x:number; z:number } };

/** The land `tile` is, as the outskirts carry it on; `ground` is the scene's land behind its walls. */
export function landOf(tile:Tile | undefined, ground:Surface):Land {
	if (!tile) {
		return { surface: ground, height: 0 };
	}
	if (tile.def === 'cliff' || tile.def === 'grass') {
		return { surface: 'meadow', height: tile.height };
	}
	if (tile.def === 'cliff_water' || showsWater(tile.def)) {
		return { surface: 'water', height: tile.height, flow: tile.flow };
	}
	if (tile.def === 'forest' || tile.def === 'trail') {
		return { surface: tile.def, height: tile.height };
	}
	// A stone floor continues as the scene's ground, level with the floor rather than up on the grass line.
	if (!tile.blocked && tile.def === 'floor') {
		return { surface: ground, height: tile.height, deck: 0.002 };
	}
	return { surface: ground, height: tile.blocked ? 0 : tile.height };
}

function sameLand(a:Land, b:Land):boolean {
	return a.surface === b.surface && a.height === b.height && a.deck === b.deck && a.flow?.x === b.flow?.x && a.flow?.z === b.flow?.z;
}

export type Outskirts = {
	/** The map's box. */
	map:Rect;
	/** The land beyond it, out to `reach` meters: strips off each side (runs of equal edge tiles merged) and the four corners. */
	land:LandRect[];
	/** The map's edge cells, each with its tile, for where the outskirts meet them. */
	edge:(Rect & { tile:Tile | undefined })[];
};

/** The outskirts of the map made of `chunks`, `reach` meters out. */
export function planOutskirts(chunks:Iterable<Chunk>, ground:Surface, heights:OutskirtHeights = {}, reach = 100):Outskirts {
	const list = [...chunks];
	const map = chunkBounds(list) ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
	const cols = Math.round((map.maxX - map.minX) / CELL_SIZE);
	const rows = Math.round((map.maxZ - map.minZ) / CELL_SIZE);
	const tileAt = (i:number, j:number):Tile | undefined => {
		const x = map.minX + (i + 0.5) * CELL_SIZE;
		const z = map.minZ + (j + 0.5) * CELL_SIZE;
		return list.find((c) => c.tileAtWorld(x, z))?.tileAtWorld(x, z);
	};
	const landAt = (i:number, j:number, override:number | undefined):Land => {
		const land = landOf(tileAt(i, j), ground);
		return override === undefined ? land : { ...land, height: override };
	};
	const land:LandRect[] = [];
	const edge:Outskirts['edge'] = [];
	const cell = (i:number, j:number):Rect => ({
		minX: map.minX + i * CELL_SIZE,
		maxX: map.minX + (i + 1) * CELL_SIZE,
		minZ: map.minZ + j * CELL_SIZE,
		maxZ: map.minZ + (j + 1) * CELL_SIZE,
	});
	/** One side: its edge cells in order, each strip running from the cell's outer edge `reach` meters out. */
	const side = (name:Side, count:number, at:(k:number)=>[number, number], out:{ x:number; z:number }):void => {
		let run:LandRect | undefined;
		for (let k = 0; k < count; k++) {
			const [i, j] = at(k);
			const c = cell(i, j);
			if (!edge.some((e) => e.minX === c.minX && e.minZ === c.minZ)) {
				edge.push({ ...c, tile: tileAt(i, j) });
			}
			const here = landAt(i, j, heights[name]?.[k]);
			const strip:LandRect = {
				...here,
				out,
				minX: out.x < 0 ? map.minX - reach : out.x > 0 ? map.maxX : c.minX,
				maxX: out.x < 0 ? map.minX : out.x > 0 ? map.maxX + reach : c.maxX,
				minZ: out.z < 0 ? map.minZ - reach : out.z > 0 ? map.maxZ : c.minZ,
				maxZ: out.z < 0 ? map.minZ : out.z > 0 ? map.maxZ + reach : c.maxZ,
			};
			if (run && sameLand(run, here)) {
				run.maxX = Math.max(run.maxX, strip.maxX);
				run.maxZ = Math.max(run.maxZ, strip.maxZ);
				continue;
			}
			run = strip;
			land.push(run);
		}
	};
	side('north', cols, (k) => [k, 0], { x: 0, z: -1 });
	side('south', cols, (k) => [k, rows - 1], { x: 0, z: 1 });
	side('west', rows, (k) => [0, k], { x: -1, z: 0 });
	side('east', rows, (k) => [cols - 1, k], { x: 1, z: 0 });
	const corner = (i:number, j:number, out:{ x:number; z:number }, override:number | undefined):void => {
		land.push({
			...landAt(i, j, override),
			out,
			minX: out.x < 0 ? map.minX - reach : map.maxX,
			maxX: out.x < 0 ? map.minX : map.maxX + reach,
			minZ: out.z < 0 ? map.minZ - reach : map.maxZ,
			maxZ: out.z < 0 ? map.minZ : map.maxZ + reach,
		});
	};
	corner(0, 0, { x: -1, z: -1 }, heights.north?.[0] ?? heights.west?.[0]);
	corner(cols - 1, 0, { x: 1, z: -1 }, heights.north?.[cols - 1] ?? heights.east?.[0]);
	corner(0, rows - 1, { x: -1, z: 1 }, heights.south?.[0] ?? heights.west?.[rows - 1]);
	corner(cols - 1, rows - 1, { x: 1, z: 1 }, heights.south?.[cols - 1] ?? heights.east?.[rows - 1]);
	return { map, land, edge };
}
