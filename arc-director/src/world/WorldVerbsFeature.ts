import type { ArcResult } from '../arc/arc-types.js';
import type { ArcRunner } from '../character/arc-runner.js';
import { Character } from '../character/Character.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { Feature } from '../director/Feature.js';
import type { VerbHandler } from '../director/director-types.js';
import { internalsOf } from '../internals.js';
import { poseOf } from './lookup.js';
import type { CrowdSettings, MoveOpts } from './mover.js';
import { groupGoal, noWayTo, type RouteGoal } from './route.js';
import { missingParts, worldVerbs } from './world-verbs.js';
import type { HostWorld } from './world-types.js';

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

	public configure(options:WorldVerbsOptions<TCtx>):this {
		Object.assign(this._options, options);
		return this;
	}

	public get crowd():CrowdSettings | undefined {
		return this._options.crowd;
	}

	/** The stock handler for `verb`, where the world has the parts it runs on. */
	public handler(verb:string):VerbHandler<TCtx> | undefined {
		const director = this.director;
		const world = director.world;
		if (!world || missingParts(verb, world).length > 0) {
			return undefined;
		}
		if (this._handlers?.world !== world) {
			const verbs = worldVerbs<TCtx>({ director, world, mover: internalsOf(director).dispatcher.mover }) as Record<string, VerbHandler<TCtx>>;
			this._handlers = { world, verbs };
		}
		return this._handlers.verbs[verb];
	}

	/** Those of `ids` still in the world and on their feet, where there is a world to ask. */
	public standing(ids:readonly string[]):string[] {
		const world = this.director.world;
		return ids.filter((id) => !world || (poseOf(world, id) && !world.isDown?.(id)));
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
				? groupGoal(left.map((id) => poseOf(world, id)!.point), world.getReach?.(world.find(runner.id), world.find(left[0])) ?? 1)
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
