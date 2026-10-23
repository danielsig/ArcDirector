import type { CountMap } from '../arc/types.js';
import type { KindSpec, RTSHost, WorkDone } from '../rts/types.js';
import { FIGHTERS } from './combat.js';
import { US, type SceneRTSSpec, type SceneWorld } from './world.js';

/** What a worker carries back at once. */
const LOAD = 10;
/** What a worker gathers, and what a repair mends, a second. */
const GATHER_RATE = 5;
const REPAIR_RATE = 4;

/**
 * A scene as an RTS (`withRTS`): each side's stock, workers gathering from resource nodes and carrying it back, sites
 * rising, buildings training, and units hitting with their basic attack. `side` is what the RTS calls `me`'s squad:
 * its collective's id.
 */
export class SceneRTS implements RTSHost {
	public readonly kinds:Readonly<Record<string, KindSpec>>;
	/** Techs researched, by side. */
	public readonly techs = new Map<string, Set<string>>();
	private readonly _world:SceneWorld;
	private readonly _side:string;
	private readonly _allies:readonly string[];
	/** What each worker carries back, by resource. */
	private readonly _carry = new Map<string, CountMap>();
	/** Seconds of work each site still lacks. */
	private readonly _sites = new Map<string, number>();
	private _made = 0;

	constructor(world:SceneWorld, side:string, spec:SceneRTSSpec = {}) {
		this._world = world;
		this._side = side;
		this._allies = spec.allies ?? [];
		this.kinds = world.kinds;
	}

	/** The RTS side of a scene team: `me`'s squad for `us`. */
	private owner(team:string):string {
		return team === US ? this._side : team;
	}

	/** The scene team of an RTS side. */
	private team(side:string):string {
		return side === this._side ? US : side;
	}

	public describe(id:string):{ kind:string; owner?:string } | undefined {
		const kind = this._world.kindOf(id);
		const team = this._world.sideOf(id);
		return kind ? { kind, ...team ? { owner: this.owner(team) } : {} } : undefined;
	}

	public known():readonly string[] {
		return this._world.placed;
	}

	public getStock(side:string):CountMap {
		return this._world.stockOf(this.team(side));
	}

	public addStock(side:string, bundle:CountMap):void {
		this._world.addStock(this.team(side), bundle);
	}

	public placeSite(kind:string, near:string | undefined, builder:string):string | { reason:string } {
		const at = this._world.getPose(near ?? builder)?.point;
		if (!at) {
			return { reason: `no room near ${near ?? builder}` };
		}
		const id = this.next(kind);
		// Sites go up in a row beside where they were asked for, so none stands on another.
		this._world.place(id, [at[0] + 2 + (this._made % 3) * 2, at[1] + 2], { kind, team: US }, true);
		this._sites.set(id, this.kinds[kind]?.seconds ?? 1);
		return id;
	}

	public removeSite(site:string):void {
		this._sites.delete(site);
		this._world.remove(site);
	}

	public work(unit:string, target:string, seconds:number):WorkDone {
		const resource = this.kinds[this._world.kindOf(target) ?? '']?.tags?.find((t) => t.startsWith('Node:'))?.slice(5);
		if (resource) {
			if (this._world.amountOf(target) <= 0) {
				return { stop: `${target} is used up` };
			}
			const load = this._carry.get(unit) ?? {};
			load[resource] = (load[resource] ?? 0) + this._world.draw(target, Math.min(GATHER_RATE * seconds, LOAD - (load[resource] ?? 0)));
			this._carry.set(unit, load);
			return { full: load[resource] >= LOAD };
		}
		const left = this._sites.get(target);
		if (left !== undefined) {
			this._sites.set(target, left - seconds);
			if (left - seconds > 0) {
				return {};
			}
			this._sites.delete(target);
			return { done: true };
		}
		return this._world.mend(target, REPAIR_RATE * seconds) ? { done: true } : {};
	}

	public deposit(unit:string, at:string):CountMap {
		const load = this._carry.get(unit) ?? {};
		this._carry.delete(unit);
		this._world.addStock(this._world.sideOf(at) ?? US, load);
		return load;
	}

	public spawn(building:string, kind:string):string {
		const id = this.next(kind);
		const [x, z] = this._world.getPose(building)?.point ?? [0, 0];
		this._world.place(id, [x + (this._made % 4) - 1.5, z + 2], { kind, team: US, ...kind in FIGHTERS ? { as: kind } : {} }, true);
		return id;
	}

	public applyTech(side:string, tech:string):void {
		this.techs.set(side, new Set([...this.techs.get(side) ?? [], tech]));
	}

	public attack(unit:string, target:string):boolean {
		return this._world.strike(unit, target);
	}

	public enter(unit:string):void {
		this._world.shelter(unit, true);
	}

	public exit(unit:string):void {
		this._world.shelter(unit, false);
	}

	public areAllies(a:string, b:string):boolean {
		return [a, b].includes(this._side) && [a, b].some((side) => this._allies.includes(side));
	}

	/** A fresh id for something of `kind` that comes into the scene: `House1`, `Worker2`. */
	private next(kind:string):string {
		this._made += 1;
		let n = 1;
		while (this._world.getPose(`${kind}${n}`) || this._world.isDown(`${kind}${n}`)) {
			n += 1;
		}
		return `${kind}${n}`;
	}
}
