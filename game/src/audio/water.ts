import { MeshRenderer } from '../engine/MeshRenderer';
import type { World } from '../engine/World';
import { SFX } from './sfx';
import { showsWater } from '../world/water';

const RIVER_HEAR = 7;
const FALLS_HEAR = 12;
const FALLS_CLEAR = 2.2;

/** Keep looping river/falls beds in range of the listener. */
export function syncWaterAudio(world:World, px:number, pz:number):void {
	const falls:{ x:number; z:number; id:string }[] = [];
	world.forEachComponent(MeshRenderer, (mesh, go) => {
		if (mesh.meshID !== 'waterfall') {
			return;
		}
		const p = go.transform.position;
		falls.push({ x: p.x, z: p.z, id: go.id });
	});
	const live = new Set<string>();
	for (const fall of falls) {
		const id = `falls:${fall.id}`;
		live.add(id);
		world.audio.playLoop(id, SFX.falls, {
			x: fall.x,
			y: 1.7,
			z: fall.z,
			hear: FALLS_HEAR,
			falloff: 0.32,
		});
	}
	for (const id of world.audio.loopIDs()) {
		if (id.startsWith('falls:') && !live.has(id)) {
			world.audio.stopLoop(id);
		}
	}
	const river = nearestRiver(world, px, pz, falls);
	if (river) {
		world.audio.playLoop('river', SFX.river, {
			x: river.x,
			y: 0.25,
			z: river.z,
			hear: RIVER_HEAR,
			falloff: 0.4,
		});
		return;
	}
	world.audio.stopLoop('river');
}

function nearestRiver(
	world:World,
	px:number,
	pz:number,
	falls:{ x:number; z:number }[],
):{ x:number; z:number } | null {
	let best:{ x:number; z:number } | null = null;
	let bestScore = RIVER_HEAR;
	for (const chunk of world.chunks.values()) {
		chunk.forEachTile((tile, lx, lz) => {
			if (!showsWater(tile.def)) {
				return;
			}
			const c = chunk.worldCellCenter(lx, lz);
			if (falls.some((f) => Math.hypot(f.x - c.x, f.z - c.z) < FALLS_CLEAR)) {
				return;
			}
			const d = Math.hypot(c.x - px, c.z - pz);
			const flow = tile.flow;
			const flowing = !!flow && (flow.x !== 0 || flow.z !== 0);
			const score = flowing ? d : d + 0.85;
			if (score < bestScore) {
				bestScore = score;
				best = c;
			}
		});
	}
	return best;
}
