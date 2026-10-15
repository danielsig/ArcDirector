import { World as KindlingWorld, Time, type Component, type Constructor, type GameObject, type TerrainSample } from '@arc-director/kindling';
import { BRIDGE_DECK_Y, Named } from './components';
import { SOLID_PROPS, type Chunk } from '../world/Chunk';
import { CELL_SIZE, CHUNK_SIZE, TILE_HEIGHT } from '../world/constants';
import { onLoweredBridge } from '../world/water';

/** Kindling hands back this game's World and Chunk (`go.world`, `world.chunks`, `tileAtWorld`). */
declare module '@arc-director/kindling' {
	interface KindlingTypes {
		world:World;
		chunk:Chunk;
	}
}

/** ArcDirector hands verbs bare names (`bareName`), so only case and spacing are left to forgive. */
function nameQuery(name:string):{ want:string; compact:string } {
	const s = name.trim().toLowerCase();
	return { want: s, compact: s.replace(/[^a-z0-9]/g, '') };
}

type NameIndex = {
	time:number;
	objects:GameObject[];
	/** Exact id, name or alias → first object's place. */
	exact:Map<string, number>;
	/** Lowercase alias → first object's place. */
	alias:Map<string, number>;
	/** Every name, lowercase and as bare letters and digits, in world order. */
	loose:{ go:GameObject; lower:string; key:string }[];
};

export class World extends KindlingWorld {
	/** Where the mouse points on the ground (the crosshair while the pointer is locked). Set by `GroundPick`. */
	public groundHit:{ x:number; z:number } | null = null;
	public hudMessage = '';
	public hudMessageTimestamp = 0;
	public hudMessageLife = 3.2;
	public playerInperceivable = false;
	/** Body ids this player has damaged. A party that owns one treats the player as a rival. */
	public playerHits = new Set<string>();
	public arcDirectorOn = true;
	/** The scene is sunlit: fires light nothing. Set from its look before its chunks spawn. */
	public daylight = false;
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
		const deck = tile.def === 'water' && onLoweredBridge(this, x, z);
		return {
			height: tile.height,
			worldY: deck ? BRIDGE_DECK_Y : tile.height * TILE_HEIGHT,
			blocked: (!!tile.blocked && !deck) || SOLID_PROPS.has(chunk.propAtWorld(x, z) ?? ''),
			climbable: tile.def === 'stairs',
		};
	}

	public npcCanSee(go:GameObject):boolean {
		return !(this.playerInperceivable && go.id === 'Player' && this.playerHits.size === 0);
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
		this.hudMessageTimestamp = Time.time;
		this.hudMessageLife = life;
	}

	/**
	 * The object called `name`: an exact id, name or alias first (aliases also in any case), else
	 * the first whose name loosely matches (same letters and digits, or a long one inside the query).
	 * Earlier objects win. Looked up in {@link nameIndex}, not by scanning the world.
	 */
	public findNamed(name:string):GameObject | undefined {
		const found = this.lookUpName(name);
		if (found && found.world !== this) {
			// Swapped out since the index was built (as many removed as added this frame).
			this._names = null;
			return this.lookUpName(name);
		}
		return found;
	}

	private lookUpName(name:string):GameObject | undefined {
		const { want, compact } = nameQuery(name);
		const index = this.nameIndex();
		const hit = Math.min(index.exact.get(name) ?? Infinity, index.alias.get(want) ?? Infinity);
		if (hit < Infinity) {
			return index.objects[hit];
		}
		for (const entry of index.loose) {
			if (entry.lower === want || entry.key === compact || (entry.key.length >= 5 && compact.includes(entry.key))) {
				return entry.go;
			}
		}
		return undefined;
	}

	/** Every name each object answers to, by its place in the world; built once a frame and again when objects come or go. */
	private _names:NameIndex | null = null;

	private nameIndex():NameIndex {
		const old = this._names;
		if (old && old.time === Time.time && old.objects.length === this.objects.length) {
			return old;
		}
		const index:NameIndex = { time: Time.time, objects: [...this.objects], exact: new Map(), alias: new Map(), loose: [] };
		index.objects.forEach((go, i) => {
			const named = go.getComponent(Named);
			const aliases = named?.aliases ?? [];
			for (const id of [named?.id, go.id, go.name, ...aliases]) {
				if (!id) {
					continue;
				}
				if (!index.exact.has(id)) {
					index.exact.set(id, i);
				}
				const lower = id.toLowerCase();
				index.loose.push({ go, lower, key: lower.replace(/[^a-z0-9]/g, '') });
			}
			for (const alias of aliases) {
				const lower = alias.toLowerCase();
				if (!index.alias.has(lower)) {
					index.alias.set(lower, i);
				}
			}
		});
		this._names = index;
		return index;
	}
}
