import * as THREE from 'three';
import type { DemoChunk } from '../world/demo-chunk';
import type { GlyphTerrain } from '../world/GlyphTerrain';
import { attachChunkAo } from './bake-ao';
import { getNature, natureReady, type NatureMaps } from './nature';
import { levelsAt, makeCovers, type Covers } from './ground-levels';
import type { GroundAt } from './ground-mesh';
import { footbridgeLayer } from '../kit/bridge/footbridge-layer';
import { plankFloorLayer, raisedFloorLayer, stoneFloorLayer } from '../kit/floors/floor-layers';
import { roadLayer } from '../kit/houses/road-layer';
import { landformLayer } from '../kit/land/land-mesh';
import { lawnLayer } from '../kit/land/lawn-layer';
import { waterLayer } from '../kit/land/water-layer';
import { dressingLayer } from '../kit/props/dressing';
import { stairLayer } from '../kit/stairs/stair-layer';
import { thinWallLayer } from '../kit/walls/thin-wall-layer';
import { wallLayer } from '../kit/walls/wall-layer';

/**
 * What a layer draws one chunk with. Geometry and materials made once at module level keep `userData.shared = true`,
 * or releasing the first chunk disposes them; `underInk(mat)` marks a material the toon outline must not ink.
 */
export type ChunkDraw = {
	chunk:DemoChunk;
	terrain:GlyphTerrain;
	group:THREE.Group;
	/** Everything already drawn under a point, earth included, for skirts. A road adds its covers. */
	levels:GroundAt;
	covers:Covers;
	/** The nature art, once it has loaded. */
	nature:NatureMaps | undefined;
};

export type ChunkLayer = (d:ChunkDraw)=>void;

/** In draw order: floors before what stands on them, the road after the lawn it covers, landforms and props last. */
const LAYERS:ChunkLayer[] = [
	stoneFloorLayer,
	raisedFloorLayer,
	wallLayer,
	thinWallLayer,
	plankFloorLayer,
	footbridgeLayer,
	stairLayer,
	lawnLayer,
	waterLayer,
	roadLayer,
	landformLayer,
	dressingLayer,
];

/** One chunk's ground, walls and dressing, layer by layer, shaded by its AO. */
export function buildChunkMesh(chunk:DemoChunk, terrain:GlyphTerrain):THREE.Group {
	const group = new THREE.Group();
	group.name = `chunk_${chunk.id}`;
	group.userData.revision = terrain.revision(chunk);
	const covers = makeCovers();
	const d:ChunkDraw = { chunk, terrain, group, covers, levels: (x, z) => levelsAt(terrain, covers, x, z), nature: natureReady() ? getNature() : undefined };
	LAYERS.forEach((layer) => layer(d));
	attachChunkAo(group, chunk, terrain);
	return group;
}
