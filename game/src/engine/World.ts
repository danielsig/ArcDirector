import { World as KindlingWorld, type Component, type Constructor, type TerrainSample } from '@arc-director/kindling';
import type { GameObject } from './GameObject';
import { InputState } from './InputState';
import { Named } from './components';
import { SOLID_PROPS, type Chunk, type Tile } from '../world/Chunk';
import { CELL_SIZE, CHUNK_SIZE, TILE_HEIGHT } from '../world/constants';
import { waterOpenAt } from '../world/water';

function nameQuery(name:string):{ want:string; compact:string } {
	let s = name.trim().toLowerCase();
	s = s.replace(/^(what seems to be|what looks like|the|a|an)\s+/g, '');
	s = s.replace(/^(what seems to be|what looks like|the|a|an)\s+/g, '');
	return { want: s, compact: s.replace(/[^a-z0-9]/g, '') };
}

export class World extends KindlingWorld {
	declare readonly objects:GameObject[];
	readonly input = new InputState();
	declare readonly chunks:Map<number, Chunk>;
	time = 0;
	hudMessage = '';
	hudMessageTimestamp = 0;
	hudMessageLife = 3.2;
	playerInperceivable = false;
	/** Body ids this player has damaged. A party that owns one treats the player as a rival. */
	playerHits = new Set<string>();
	arcDirectorOn = true;
	sayOpen = false;
	pickedUp:(character:GameObject, name:string)=>void = () => undefined;
	override tileSize = CELL_SIZE;
	override chunkSize = CHUNK_SIZE;

	override sampleTerrain(x:number, z:number):TerrainSample | undefined {
		const chunk = this.chunkAtWorld(x, z);
		const tile = chunk?.tileAtWorld(x, z);
		if (!chunk || !tile) {
			return undefined;
		}
		const water = tile.def === 'water' && waterOpenAt(this, x, z);
		return {
			height: tile.height,
			worldY: tile.height * TILE_HEIGHT,
			blocked: (!!tile.blocked && !water) || SOLID_PROPS.has(chunk.propAtWorld(x, z) ?? ''),
			climbable: tile.def === 'stairs',
		};
	}

	npcCanSee(go:GameObject):boolean {
		return !(this.playerInperceivable && go.id === 'Player' && this.playerHits.size === 0);
	}

	override add(go:GameObject):GameObject {
		return super.add(go) as GameObject;
	}

	override findByID(id:string):GameObject | undefined {
		return super.findByID(id) as GameObject | undefined;
	}

	override objectsInTile(tx:number, tz:number):readonly GameObject[] {
		return super.objectsInTile(tx, tz) as readonly GameObject[];
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

	setMessage(text:string, life = 3.2):void {
		this.hudMessage = text;
		this.hudMessageTimestamp = this.time;
		this.hudMessageLife = life;
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

	override chunkAtWorld(x:number, z:number):Chunk | undefined {
		return super.chunkAtWorld(x, z) as Chunk | undefined;
	}

	override tileAtWorld(x:number, z:number):Tile | undefined {
		return super.tileAtWorld(x, z) as Tile | undefined;
	}
}
