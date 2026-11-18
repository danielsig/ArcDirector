import type { ArcResult } from '../arc/arc-types.js';
import type { ArcRunner } from '../character/arc-runner.js';
import { Character } from '../character/Character.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { Feature } from '../director/Feature.js';
import type { KernelSource, VerbHandler } from '../director/director-types.js';
import { dummyEntity } from '../expr/natives.js';
import { internalsOf } from '../internals.js';
import type { SeenObject } from '../perception/perception-types.js';
import { madeOut } from '../perception/sight.js';
import { SightFeature } from '../perception/SightFeature.js';
import { edgeDistance, inLineOfSight, poseOf, reachOf, reachTo } from './lookup.js';
import type { CrowdSettings, MoveOpts } from './mover.js';
import { groupGoal, noWayTo, type RouteGoal } from './route.js';
import { missingPart, worldVerbs, type WorldVerbTools } from './world-verbs.js';
import { RESERVED_TAGS, type HostWorld } from './world-types.js';

type Kernels = ReturnType<KernelSource<unknown>> | undefined;

/** What `withWorldVerbs` takes. */
export type WorldVerbsOptions<TCtx = unknown> = {
	/**
	 * How characters bound for the same character share it: a `line` to be served one at a time, a `ring` round it,
	 * or `none`, each going straight in. `withRPG` gives `ring`, with `line` for `offer` and `give`; without it,
	 * `none`. A character spec's `crowd` wins over this, and a move's own `crowd` over both.
	 */
	crowd?:CrowdSettings;
	/**
	 * Whether `character` walks near a group before `verb` acts on it (`VerbDef.group`), given the ids of `targets`. Default:
	 * it walks. If not, it acts from where it stands, and `say` reaches whoever of them is in earshot. Asked on the fly, and
	 * more than once a step, so a program knows whether a line would take its body: keep it cheap and free of side effects.
	 */
	groupWalk?:(character:Character<TCtx>, verb:string, targets:readonly string[])=>boolean;
};

/**
 * What characters do in the game's world (`withWorld`), which every director has: the stock world verbs (`go_to`,
 * `pick_up`, `offer`, …) for the parts the world has, a host handler of the same name winning; how characters bound for
 * the same one share it; and the walk near a group that a verb aims at (`VerbDef.group`). `withWorldVerbs({ crowd })`.
 */
export class WorldVerbsFeature<TCtx = unknown> extends Feature<TCtx> {
	private readonly _options:WorldVerbsOptions<TCtx> = {};
	/** The stock handlers, and the world they were made for. */
	private _handlers:{ world:HostWorld<unknown>; verbs:Record<string, VerbHandler<TCtx>> } | undefined;
	private readonly _more = new Map<string, (tools:WorldVerbTools<TCtx>)=>VerbHandler<TCtx>>();

	public configure(options:WorldVerbsOptions<TCtx>):this {
		Object.assign(this._options, options);
		return this;
	}

	public get crowd():CrowdSettings | undefined {
		return this._options.crowd;
	}

	/** A world verb of a feature's own, made of the stock ones' steps (`steal`), run as they are. */
	public add(verb:string, make:(tools:WorldVerbTools<TCtx>)=>VerbHandler<TCtx>):this {
		this._more.set(verb, make);
		this._handlers = undefined;
		return this;
	}

	/** The stock handler for `verb`, where the world has the parts it runs on. */
	public handler(verb:string):VerbHandler<TCtx> | undefined {
		const director = this.director;
		const world = director.world;
		if (!world || missingPart(verb, world)) {
			return undefined;
		}
		if (this._handlers?.world !== world) {
			const verbs = worldVerbs<TCtx>({ director, world, mover: internalsOf(director).dispatcher.mover, more: this._more }) as Record<string, VerbHandler<TCtx>>;
			this._handlers = { world, verbs };
		}
		return this._handlers.verbs[verb];
	}

	/**
	 * What character `viewerID` knows `holderID` carries, by id: what the watch kernels' `inventory` says it holds, where
	 * {@link canSeeInventoryOf} says it knows; else nothing. `inSight`: it is made out in the viewer's sight now.
	 */
	public inventorySeenBy(viewerID:string, holderID:string, inSight?:boolean, kernels:Kernels = this.kernelsOf(viewerID)):string[] {
		const items = kernels?.inventory?.(dummyEntity(holderID)).map((item) => item.id) ?? [];
		return items.length > 0 && this.canSeeInventoryOf(viewerID, holderID, inSight, kernels) ? items : [];
	}

	/**
	 * Whether character `viewerID` knows what `holderID` carries: the world's `transfers.canSeeInventoryOf` where it
	 * answers, else by default, of a container (what the watch kernels' `isOpen` answers for), that it is open and in
	 * sight (`inSight`, else sight says, else light passes); of a character, that the viewer's kit (or its collective's)
	 * has `steal` and it is within its `getReach(me, 'steal')`, edge to edge. Cheap: the watch kernels are made
	 * (`kernels`, unless handed in) only to ask whether a holder that is no character is open.
	 */
	public canSeeInventoryOf(viewerID:string, holderID:string, inSight?:boolean, kernels?:Kernels):boolean {
		const { director } = this;
		const world = director.world;
		const [viewer, holder] = [world?.find(viewerID), world?.find(holderID)];
		if (!world || viewer === undefined || holder === undefined) {
			return false;
		}
		const [from, to] = [world.geometry?.getPose(viewer), world.geometry?.getPose(holder, viewer)];
		const distance = from && to ? edgeDistance(from, to) : undefined;
		const known = world.transfers?.canSeeInventoryOf?.(viewer, holder, distance);
		if (known !== undefined) {
			return known;
		}
		const open = director.character(holderID) ? undefined : (kernels ?? this.kernelsOf(viewerID))?.isOpen?.(dummyEntity(holderID));
		if (open !== undefined) {
			return open && (inSight ?? director.getFeature(SightFeature)?.sees(viewerID, holderID) ?? inLineOfSight(world, viewerID, holderID));
		}
		const thief = director.character(viewerID);
		const steals = !!thief && [thief, thief.collective].some((runner) => runner?.activeVerbs().has('steal'));
		return steals && distance !== undefined && distance <= reachOf(world, viewer, 'steal');
	}

	/** The host's watch kernels from character `id`'s context, unnamed; none without either. */
	private kernelsOf(id:string):Kernels {
		const ctx = this.director.contextOf(id);
		return ctx === undefined ? undefined : internalsOf(this.director).watches.kernels?.(ctx);
	}

	/**
	 * Each character and container `selfID` makes out with what it knows they carry ({@link inventorySeenBy}): a character
	 * as `carrying` (`Bram (carrying: Purse, Bread)`), a container's as the items in it, which it may take.
	 */
	public override seen(ctx:TCtx, selfID:string, objects:SeenObject[]):SeenObject[] {
		const holders = objects.filter((o) => o.id !== selfID && !o.tags.includes(RESERVED_TAGS.item) && madeOut(o));
		const kernels = holders.length > 0 && this.director.world ? internalsOf(this.director).watches.kernels?.(ctx) : undefined;
		if (!kernels?.inventory) {
			return objects;
		}
		return objects.flatMap((o) => {
			const items = holders.includes(o) ? this.inventorySeenBy(selfID, o.id, true, kernels) : [];
			return items.length === 0 ? [o]
				: kernels.isOpen?.(dummyEntity(o.id)) === undefined ? [{ ...o, carrying: items }]
					: [o, ...items.map((id):SeenObject => ({ id, point: o.point, tags: [RESERVED_TAGS.item], interesting: 1, interactable: true, movable: true, attachedTo: o.id, attachMode: 'in', clarity: o.clarity }))];
		});
	}

	/** Those of `ids` still in the world and on their feet, where there is a world to ask. */
	public standing(ids:readonly string[]):string[] {
		const world = this.director.world;
		return ids.filter((id) => !world || (poseOf(world, id) && !world.hasFallen?.(id)));
	}

	/**
	 * The walk that takes `runner` near the group `ids`, following it as it moves, ready to run. None when it is near
	 * already, when it has no body or the world has no routes, or when the host says not to (`groupWalk`).
	 */
	public walkToGroup(runner:ArcRunner<TCtx>, verb:string, ids:readonly string[], opts?:MoveOpts):(()=>Promise<ArcResult>) | undefined {
		const world = this.director.world;
		const me = world && poseOf(world, runner.id)?.point;
		const { mover } = internalsOf(this.director).dispatcher;
		if (!world || !me || !(runner instanceof Character) || !mover.canMove) {
			return undefined;
		}
		const goal = ():RouteGoal | undefined => {
			const left = this.standing(ids);
			return left.length > 0
				? groupGoal(left.map((id) => poseOf(world, id)!.point), reachTo(world, world.find(runner.id), world.find(left[0])))
				: undefined;
		};
		if (goal()?.reached(me) !== false || this._options.groupWalk?.(runner, verb, ids) === false) {
			return undefined;
		}
		return async () => {
			const out = await mover.go(runner.id, { goal, noWay: (why) => noWayTo('them', why) }, verb, opts);
			return out.reason === 'gone' ? { ...out, reason: 'no one left in the group' } : out;
		};
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link WorldVerbsFeature}, which every director has: `withWorldVerbs({ crowd, groupWalk })`. */
		withWorldVerbs(options:WorldVerbsOptions<TCtx>):this;
		getWorldVerbs():WorldVerbsFeature<TCtx> | undefined;
	}
}
export function withWorldVerbs<TCtx>(this:ArcDirector<TCtx>, options:WorldVerbsOptions<TCtx>):ArcDirector<TCtx> {
	return this.configureFeature(WorldVerbsFeature<TCtx>, () => new WorldVerbsFeature<TCtx>(), (world) => world.configure(options));
}
