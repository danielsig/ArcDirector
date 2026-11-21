import { boundsOf, inBounds, type XZ } from '@arc-director/kindling';
import { TILE_HEIGHT } from '../world/constants';
import type { Tile } from '../world/demo-chunk';
import type { GlyphTerrain } from '../world/GlyphTerrain';
import { GRASS_Y, WATER_UPPER_Y, TERRAIN } from '../world/terrain-kinds';
import { wallFloors } from '../kit/walls/thin-wall';

/** The top of a floor tile. A wall has none. The river is its surface, so a deck skirts down to it. */
function tileTop(tile:Tile | undefined):number | undefined {
	if (!tile || (tile.blocked && !TERRAIN[tile.def].water) || TERRAIN[tile.def].thin) {
		return undefined;
	}
	return tile.height * TILE_HEIGHT + (TERRAIN[tile.def].water ? WATER_UPPER_Y : tile.deck ?? GRASS_Y);
}
/** The floor tile under `x, z`. A thin wall is the floor laid on that side of it. A solid wall has none. */
function floorTile(terrain:GlyphTerrain, x:number, z:number):Tile | undefined {
	const tile = terrain.tileNear(x, z);
	if (!tile) {
		return undefined;
	}
	if (TERRAIN[tile.def].thin) {
		return wallFloors(terrain, terrain.tileCoordAt(x, z)).find((q) => inBounds(q.bounds, x, z))?.tile;
	}
	if (tile.blocked && !TERRAIN[tile.def].water) {
		return undefined;
	}
	return tile;
}

/** Surfaces piled on a tile after its earth and its own floor, such as a road. */
export function makeCovers():{ add(ring:XZ[], y:number):void; at(x:number, z:number):number[] } {
	const cells = new Map<string, { ring:XZ[]; y:number }[]>();
	const holds = (ring:XZ[], x:number, z:number):boolean => {
		let inside = false;
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const a = ring[i]!;
			const b = ring[j]!;
			if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
				inside = !inside;
			}
		}
		return inside;
	};
	return {
		add(ring, y) {
			if (ring.length < 3) {
				return;
			}
			const { minX, maxX, minZ, maxZ } = boundsOf(ring);
			const cover = { ring, y };
			for (let x = Math.floor(minX); x <= Math.floor(maxX); x++) {
				for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++) {
					const key = `${x},${z}`;
					const list = cells.get(key);
					if (list) {
						list.push(cover);
					}
					else {
						cells.set(key, [cover]);
					}
				}
			}
		},
		at(x, z) {
			const list = cells.get(`${Math.floor(x)},${Math.floor(z)}`);
			if (!list) {
				return [];
			}
			const out:number[] = [];
			for (const cover of list) {
				if (holds(cover.ring, x, z)) {
					out.push(cover.y);
				}
			}
			return out;
		},
	};
}

/** Surfaces piled on tiles after their own floors, such as a road. */
export type Covers = ReturnType<typeof makeCovers>;

/**
 * Earth, then this tile's own floor, then anything piled on after (a road). Water is only its surface: that is the
 * ground there. A square skirt stops on the highest of these under it; a road skirt goes to the lowest.
 */
export function levelsAt(terrain:GlyphTerrain, covers:Covers, x:number, z:number):number[] {
	const extra = covers.at(x, z);
	const tile = floorTile(terrain, x, z);
	if (!tile) {
		return extra;
	}
	if (TERRAIN[tile.def].water) {
		return [tile.height * TILE_HEIGHT + WATER_UPPER_Y, ...extra];
	}
	const base = tile.height * TILE_HEIGHT;
	const top = tileTop(tile);
	const levels = [base];
	if (top !== undefined && top > base + 0.004) {
		levels.push(top);
	}
	levels.push(...extra);
	return levels;
}
