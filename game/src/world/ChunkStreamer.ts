import type { ChunkFile } from './decodeGlyphChunk';
import { ChunkBound, StreamingAnchor } from '../engine/components';
import type { World } from '../engine/World';
import { chunkKey, worldToChunk } from '../engine/World';
import { decodeGlyphChunk } from './decodeGlyphChunk';
import { spawnChunkEntities } from './spawn';
import { CELL_SIZE, CHUNK_SIZE } from './constants';

function distToAabb(
	x:number,
	z:number,
	minX:number,
	maxX:number,
	minZ:number,
	maxZ:number,
):number {
	const cx = Math.min(Math.max(x, minX), maxX);
	const cz = Math.min(Math.max(z, minZ), maxZ);
	return Math.hypot(x - cx, z - cz);
}

function chunkDist(x:number, z:number, cx:number, cz:number):number {
	const minX = cx * CHUNK_SIZE * CELL_SIZE;
	const minZ = cz * CHUNK_SIZE * CELL_SIZE;
	return distToAabb(x, z, minX, minX + CHUNK_SIZE * CELL_SIZE, minZ, minZ + CHUNK_SIZE * CELL_SIZE);
}

export class ChunkStreamer {
	constructor(private readonly files:ChunkFile[]) {}

	tick(world:World):void {
		const anchors:{ x:number; z:number; view:number; hyst:number }[] = [];
		world.forEachComponent(StreamingAnchor, (anchor, go) => {
			anchors.push({
				x: go.transform.position.x,
				z: go.transform.position.z,
				view: anchor.viewRadius,
				hyst: anchor.hysteresis,
			});
		});
		if (anchors.length === 0) {
			const player = world.findByID('Player');
			if (player) {
				anchors.push({
					x: player.transform.position.x,
					z: player.transform.position.z,
					view: 20,
					hyst: 8,
				});
			}
		}

		const want = new Set<string>();
		for (const file of this.files) {
			const key = chunkKey(file.origin.cx, file.origin.cz);
			const d = Math.min(
				...anchors.map((a) => chunkDist(a.x, a.z, file.origin.cx, file.origin.cz)),
			);
			const loaded = world.chunks.has(key);
			const view = anchors[0]?.view ?? 20;
			const hyst = anchors[0]?.hyst ?? 8;
			if (loaded) {
				if (d <= view + hyst) {
					want.add(key);
				}
			}
			else if (d <= view) {
				want.add(key);
			}
		}

		for (const key of want) {
			if (!world.chunks.has(key)) {
				this.load(world, key);
			}
		}
		for (const [key, chunk] of [...world.chunks]) {
			if (!want.has(key)) {
				this.unload(world, chunk.id, key);
			}
		}

		const player = world.findByID('Player');
		if (player) {
			const { cx, cz } = worldToChunk(player.transform.position.x, player.transform.position.z);
			world.chunk = world.chunks.get(chunkKey(cx, cz)) ?? world.chunk;
		}
	}

	private load(world:World, key:string):void {
		const file = this.files.find((f) => chunkKey(f.origin.cx, f.origin.cz) === key);
		if (!file) {
			return;
		}
		const decoded = decodeGlyphChunk(file);
		world.addChunk(decoded.chunk);
		spawnChunkEntities(world, decoded);
	}

	private unload(world:World, chunkID:string, key:string):void {
		const doomed:typeof world.objects = [];
		for (const go of world.objects) {
			const bound = go.getComponent(ChunkBound);
			if (bound?.chunkID === chunkID) {
				doomed.push(go);
			}
		}
		for (const go of doomed) {
			world.remove(go);
		}
		const chunk = world.chunks.get(key);
		if (chunk) {
			world.removeChunk(chunk);
		}
	}
}
