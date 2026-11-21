import { gridKey, inBounds, Terrain, type Bounds, type Cover, type TerrainSample, type TileCoord } from '@arc-director/kindling';
import type { Surface } from '../kit/land/land';
import { syncFurniture } from '../kit/furniture/furniture';
import { roadCover, roadLines, type RoadLine } from '../kit/houses/roads';
import { syncDressingColliders, syncDressingFlies } from '../kit/props/dressing-colliders';
import { planProps, type DressingProp } from '../kit/props/dressing-plan';
import { thinWallBoxes } from '../kit/walls/thin-wall';
import { CELL_SIZE, CHUNK_SIZE, TILE_HEIGHT, WALL_HEIGHT } from './constants';
import { SOLID_PROPS, type ChunkEntity, type DemoChunk, type Tile } from './demo-chunk';
import { spawnChunkEntities } from './spawn';
import { TERRAIN } from './terrain-kinds';

/** The scene's roads (center lines, and the cover feet rest on) and dressing props, as of terrain revision `revision`. */
export type ScenePlan = { revision:number; roads:RoadLine[]; road:Cover | undefined; props:DressingProp[] };

/** The game's ground: glyph maps decoded to `Tile`s, thin walls, the scene's plan (its road a cover), and the cells props stand on. */
export class GlyphTerrain extends Terrain<Surface> {
	public override tileSize = CELL_SIZE;
	public override chunkSize = CHUNK_SIZE;
	public override tileHeight = TILE_HEIGHT;
	public override blockHeight = WALL_HEIGHT;
	/** Cells a tree, boulder or pillar stands on: blocked to bodies and routes. */
	private readonly _props = new Set<number>();
	private _plan:ScenePlan | undefined;

	/** Also notes the chunk's prop cells. */
	public override register(chunk:DemoChunk):void {
		super.register(chunk);
		for (const ent of chunk.entities.filter((e) => SOLID_PROPS.has(e.def))) {
			const { tx, tz } = chunk.tileCoord(ent.localX, ent.localZ);
			this._props.add(gridKey(tx, tz));
		}
	}

	/** A prop's cell is blocked. */
	public override sample(x:number, z:number):TerrainSample<Surface> | undefined {
		const s = super.sample(x, z);
		if (s) {
			const { tx, tz } = this.tileCoordAt(x, z);
			s.blocked ||= this._props.has(gridKey(tx, tz));
		}
		return s;
	}

	/** Roads and props over the whole scene, planned again after a tile changes. */
	public get plan():ScenePlan {
		const revision = this.revision();
		if (this._plan?.revision !== revision) {
			const roads = roadLines(this);
			this._plan = { revision, roads, road: roadCover(this, roads), props: planProps(this) };
		}
		return this._plan;
	}

	/** The cobbled road is a cover too, under any other that answers. */
	protected override coverAt(x:number, z:number):number | undefined {
		const road = this.plan.road;
		return super.coverAt(x, z) ?? (road && inBounds(road.bounds, x, z) ? road.sample(x, z) : undefined);
	}

	/** A change replans the scene, and the dressing's colliders, flies and furniture follow the plan. */
	public override invalidate(area:Bounds, reach?:number):void {
		super.invalidate(area, reach);
		if (this.loaded.size > 0) {
			this.syncDressing();
		}
	}

	/** The map's entities on a tile (a door, a prop), across chunk borders. */
	public entitiesAt(at:TileCoord):ChunkEntity[] {
		const { x, z } = this.tileCenter(at);
		const chunk = this.chunkAtWorld(x, z);
		const local = chunk?.worldToLocal(x, z);
		return chunk?.entities.filter((e) => e.localX === local!.localX && e.localZ === local!.localZ) ?? [];
	}

	/** A thin wall is solid only along its boards; everything else as Kindling has it (a stair along its sides). */
	protected override solidsOf(tile:Tile, at:TileCoord):readonly Bounds[] | undefined {
		return TERRAIN[tile.def].thin ? thinWallBoxes(this, at) : super.solidsOf(tile, at);
	}

	/** The chunk's things, then the dressing's. */
	protected override spawn(chunk:DemoChunk):void {
		spawnChunkEntities(this.world, chunk);
		this.syncDressing();
	}

	private syncDressing():void {
		syncDressingColliders(this.world);
		syncDressingFlies(this.world);
		syncFurniture(this.world);
	}
}
