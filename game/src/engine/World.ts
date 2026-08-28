import { World as KindlingWorld, type Component, type Constructor, type TerrainSample } from '@arc-director/kindling';
import type { GameObject } from './GameObject';
import { InputState } from './InputState';
import { Named } from './components';
import type { Chunk, Tile } from '../world/Chunk';
import { CELL_SIZE, CHUNK_SIZE, TILE_HEIGHT } from '../world/constants';
import { waterOpenAt } from '../world/water';

export function chunkKey(cx:number, cz:number):string {
	return `${cx}:${cz}`;
}

function nameQuery(name:string):{ want:string; compact:string } {
	let s = name.trim().toLowerCase();
	s = s.replace(/^(what seems to be|what looks like|the|a|an)\s+/g, '');
	s = s.replace(/^(what seems to be|what looks like|the|a|an)\s+/g, '');
	return { want: s, compact: s.replace(/[^a-z0-9]/g, '') };
}

export function worldToChunk(x:number, z:number):{ cx:number; cz:number } {
	return {
		cx: Math.floor(x / (CHUNK_SIZE * CELL_SIZE)),
		cz: Math.floor(z / (CHUNK_SIZE * CELL_SIZE)),
	};
}

export class World extends KindlingWorld {
	declare readonly objects:GameObject[];
	readonly input = new InputState();
	readonly chunks = new Map<string, Chunk>();
	chunk:Chunk | null = null;
	time = 0;
	hudMessage = '';
	hudMessageAt = 0;
	playerInperceivable = false;
	arcDirectorOn = true;
	sayOpen = false;
	pickedUp:(actor:GameObject, name:string)=>void = () => undefined;
	override tileSize = CELL_SIZE;

	override sampleTerrain(x:number, z:number):TerrainSample | undefined {
		const tile = this.tileAtWorld(x, z);
		if (!tile) {
			return undefined;
		}
		const water = tile.def === 'water' && waterOpenAt(this, x, z);
		return {
			height: tile.height,
			worldY: tile.height * TILE_HEIGHT,
			blocked: !!tile.blocked && !water,
			climbable: tile.def === 'stairs',
		};
	}

	npcCanSee(go:GameObject):boolean {
		return !(this.playerInperceivable && go.id === 'Player');
	}

	override add(go:GameObject):GameObject {
		return super.add(go) as GameObject;
	}

	override findByID(id:string):GameObject | undefined {
		return super.findByID(id) as GameObject | undefined;
	}

	override forEachComponent<T extends Component>(
		ctor:Constructor<T>,
		fn:(c:T, go:GameObject)=>void,
	):void {
		for (const go of this.objects) {
			const c = go.getComponent(ctor);
			if (c && c.enabled) {
				fn(c, go);
			}
		}
	}

	setMessage(text:string):void {
		this.hudMessage = text;
		this.hudMessageAt = this.time;
	}

	findNamed(name:string):GameObject | undefined {
		const raw = nameQuery(name);
		const want = raw.want;
		const compact = raw.compact;
		let loose:GameObject | undefined;
		for (const go of this.objects) {
			const named = go.getComponent(Named);
			if (named?.id === name || go.id === name || go.name === name) {
				return go;
			}
			if (named?.aliases?.includes(name) || named?.aliases?.some((a) => a.toLowerCase() === want)) {
				return go;
			}
			const ids = [named?.id, go.id, go.name, ...(named?.aliases ?? [])];
			if (
				!loose
				&& ids.some((id) => {
					if (!id) {
						return false;
					}
					const lower = id.toLowerCase();
					const key = lower.replace(/[^a-z0-9]/g, '');
					if (lower === want || key === compact) {
						return true;
					}
					return key.length >= 5 && compact.includes(key);
				})
			) {
				loose = go;
			}
		}
		return loose;
	}

	chunkAtWorld(x:number, z:number):Chunk | undefined {
		const { cx, cz } = worldToChunk(x, z);
		return this.chunks.get(chunkKey(cx, cz));
	}

	tileAtWorld(x:number, z:number):Tile | undefined {
		return this.chunkAtWorld(x, z)?.tileAtWorld(x, z);
	}

	addChunk(chunk:Chunk):void {
		const key = chunkKey(chunk.origin.cx, chunk.origin.cz);
		this.chunks.set(key, chunk);
		if (!this.chunk) {
			this.chunk = chunk;
		}
	}

	removeChunk(chunk:Chunk):void {
		this.chunks.delete(chunkKey(chunk.origin.cx, chunk.origin.cz));
		if (this.chunk === chunk) {
			const next = this.chunks.values().next();
			this.chunk = next.done ? null : next.value;
		}
	}
}
