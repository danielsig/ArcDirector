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
	public declare readonly objects:GameObject[];
	public readonly input = new InputState();
	public declare readonly chunks:Map<number, Chunk>;
	public time = 0;
	public hudMessage = '';
	public hudMessageTimestamp = 0;
	public hudMessageLife = 3.2;
	public playerInperceivable = false;
	/** Body ids this player has damaged. A party that owns one treats the player as a rival. */
	public playerHits = new Set<string>();
	public arcDirectorOn = true;
	public sayOpen = false;
	public pickedUp:(character:GameObject, name:string)=>void = () => undefined;
	public override tileSize = CELL_SIZE;
	public override chunkSize = CHUNK_SIZE;

	public override sampleTerrain(x:number, z:number):TerrainSample | undefined {
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

	public npcCanSee(go:GameObject):boolean {
		return !(this.playerInperceivable && go.id === 'Player' && this.playerHits.size === 0);
	}

	public override add(go:GameObject):GameObject {
		return super.add(go) as GameObject;
	}

	public override findByID(id:string):GameObject | undefined {
		return super.findByID(id) as GameObject | undefined;
	}

	public override objectsInTile(tx:number, tz:number):readonly GameObject[] {
		return super.objectsInTile(tx, tz) as readonly GameObject[];
	}

	public override forEachComponent<T extends Component>(
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

	public setMessage(text:string, life = 3.2):void {
		this.hudMessage = text;
		this.hudMessageTimestamp = this.time;
		this.hudMessageLife = life;
	}

	public findNamed(name:string):GameObject | undefined {
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

	public override chunkAtWorld(x:number, z:number):Chunk | undefined {
		return super.chunkAtWorld(x, z) as Chunk | undefined;
	}

	public override tileAtWorld(x:number, z:number):Tile | undefined {
		return super.tileAtWorld(x, z) as Tile | undefined;
	}
}
