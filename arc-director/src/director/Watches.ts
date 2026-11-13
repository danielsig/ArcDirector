import type { ArcRunner } from '../character/arc-runner.js';
import { Character } from '../character/Character.js';
import type { NameTarget } from '../character/NameBook.js';
import { Collective } from '../collective/Collective.js';
import { buildCollectiveCatalog, doingFields } from '../collective/who.js';
import { catalogEntities, unboundCalls } from '../expr/eval.js';
import { parse } from '../expr/expr-parse.js';
import { leftoverFilterHint, type Catalog, type ExprEntity, type ExprVal, type SampleCache } from '../expr/expr-types.js';
import { buildCatalog, dummyEntity, type HostKernels } from '../expr/natives.js';
import { freezeMe } from '../expr/prev.js';
import { watchScore } from '../expr/watch-score.js';
import { internalsOf } from '../internals.js';
import type { Mind } from '../mind/mind.js';
import { geometryKernels } from '../world/geometry-kernels.js';
import { inLineOfSight, poseOf } from '../world/lookup.js';
import { centroid } from '../world/vec.js';
import { RESERVED_TAGS, type Pose, type Vec } from '../world/world-types.js';
import type { ArcDirector } from './ArcDirector.js';
import { collectiveOf } from './Cast.js';
import type { KernelSource, SeenName } from './director-types.js';

/** Watch value as a 0–1 fit. A non-empty list or an entity counts as true. */
export function fit(value:ExprVal):number {
	if (value.kind === 'list') {
		return value.value.length > 0 ? 1 : 0;
	}
	return value.kind === 'entity' ? 1 : watchScore(value).score;
}

/** Why a watch expression can never hold (bad syntax, leftover English, a function there is none of), as opposed to false right now. */
export function watchProblem(expr:string, catalog:Catalog | undefined):string | undefined {
	try {
		parse(expr);
	}
	catch (err) {
		return `${expr}: ${err instanceof Error ? err.message : String(err)}`;
	}
	const unbound = catalog ? unboundCalls(expr, catalog) : [];
	if (unbound.length > 0) {
		return `${expr}: ${unbound.map((name) => `${name}()`).join(', ')} is not a function`;
	}
	return catalog ? leftoverFilterHint(expr, catalogEntities(catalog)) : undefined;
}

/**
 * How the cast sees the world in the watch language: each runner's kernels from the host's, under its mind's names, and
 * the catalogs its laws, steps, watches and replies are read against. A part of {@link ArcDirector}.
 */
export class Watches<TCtx> {
	/** Each character's or collective's context, from the host (`withContext`). */
	public context:((id:string)=>TCtx | undefined) | undefined;
	/** The host's kernels (`withKernels`): without them no one sees, and every view here is none. */
	public kernels:KernelSource<TCtx> | undefined;
	/** The host's naming policy (`withNames`). */
	public names:SeenName<TCtx> | undefined;

	constructor(private readonly _director:ArcDirector<TCtx>) {}

	/**
	 * The watch-language view `runner` has from `ctx` (its voice's, unless given), its collective's roster (`units`) too;
	 * a collective's with no one there to see from, pooled from its characters. `point`: as if it stood there.
	 */
	public catalog(runner:ArcRunner<TCtx>, ctx = runner.context(), cache?:SampleCache, point?:Vec):Catalog | undefined {
		const collective = collectiveOf(runner);
		const kernels = ctx !== undefined ? this.kernelsFor(runner, ctx, cache, point) : collective ? this.pooled(collective) : undefined;
		return kernels && (collective ? buildCollectiveCatalog(kernels, collective) : buildCatalog(kernels));
	}

	/** What `mind`'s watches score against: its voice's view, or one view per character of a collective. */
	public catalogsFor(mind:Mind<TCtx>):Catalog | Catalog[] | undefined {
		const owner = mind.owner;
		const voiceCtx = this._director.contextOf(mind.thinkThread());
		const kernels = voiceCtx ? this.kernelsFor(mind.voice, voiceCtx) : owner instanceof Collective ? this.pooled(owner) : undefined;
		if (!kernels || !(owner instanceof Collective)) {
			return kernels && buildCatalog(kernels);
		}
		const views = owner.characters.flatMap((character) => {
			const ctx = this._director.contextOf(character.id);
			const seen = ctx && this.kernelsFor(character, ctx);
			return seen ? [buildCollectiveCatalog(seen, owner, owner.commander ?? undefined)] : [];
		});
		return views.length > 0 ? views : buildCatalog(kernels);
	}

	/**
	 * What `runner` sees from `ctx` in the watch language, under its mind's names, with the world's geometry, every
	 * feature's kernels, what happened since its mind last thought, and its last result. `point`: measure as if it stood there.
	 */
	public kernelsFor(runner:ArcRunner<TCtx>, ctx:TCtx, cache = internalsOf(this._director).cast.cacheOf(runner), point?:Vec):HostKernels | undefined {
		if (!this.kernels) {
			return undefined;
		}
		const director = this._director;
		const world = director.world;
		const mind = runner.mind;
		const kernels = this.namedKernels(mind, this.kernels(ctx, point));
		const here = point && world && poseOf(world, kernels.me.id);
		const geometry = world
			? geometryKernels(world, kernels.me.id, here ? new Map([[kernels.me.id, { ...here, point }]]) : undefined)
			: {};
		const lastTimestamp = mind?.lastTacticalTimestamp;
		const last = runner.lastResult;
		const ago = lastTimestamp !== undefined && Number.isFinite(lastTimestamp)
			? Math.max(0, director.time - lastTimestamp)
			: undefined;
		const added = Object.assign({}, ...internalsOf(director).features.map((feature) => feature.watchKernels(runner))) as Partial<HostKernels>;
		// What happened since its mind last thought, as `events`: `events.filter("sound")`. A unit reads its collective's.
		const listener = mind ?? (runner instanceof Character ? runner.collective?.mind : undefined);
		const events:ExprVal = { kind: 'list', value: (listener?.events() ?? []).map((e, i):ExprVal => ({
			kind: 'entity',
			value: dummyEntity(`event${i + 1}`, { tags: [e.kind, ...e.tags ?? []], fields: { secondsAgo: { kind: 'number', value: Math.max(0, director.time - (e.timestamp ?? director.time)) } } }),
		})) };
		return {
			...kernels,
			...geometry,
			...added,
			// Each character among them with what it is at, so `doing(u, "go_to")` and `isBusy(u)` read it.
			others: kernels.others.map((e) => {
				const character = director.character(e.id);
				return character ? { ...e, fields: { ...e.fields, ...doingFields(character) } } : e;
			}),
			// Who sees whom, where the host's kernels say; else where light passes.
			canSee: kernels.canSee ?? (world?.canPass ? (a, b) => inLineOfSight(world, a.id, b.id) : undefined),
			bindings: { events, ...kernels.bindings, ...added.bindings },
			// Its watches by name, so `wait(until=fallen || idle)` reads them.
			watches: listener?.persona.watchList(),
			cache,
			hasHeard: mind?.hasHeard() ?? false,
			prev: {
				secondsAgo: ago,
				// Its spawn snapshot, so the first think can see a change.
				me: runner.prevMe ??= freezeMe(kernels),
				verbs: last ? [{ secondsAgo: ago ?? 0, isOk: last.status === 'ok', reason: last.reason ?? '', verb: last.verb ?? '' }] : [],
			},
		} as HostKernels;
	}

	/** Spawn snapshot so the first think can see a change. A saved prev is left alone. */
	public stampPrev(runner:ArcRunner<TCtx>):void {
		const ctx = runner.prevMe ? undefined : this._director.contextOf(runner.id);
		try {
			if (ctx) {
				this.kernelsFor(runner, ctx);
			}
		}
		catch {
			// A host's kernels that cannot answer this early stamp nothing.
		}
	}

	/** Character `id`'s health by the host's `hp` kernel; nothing without one. */
	public healthOf(id:string):{ hp:number; maxHP:number } | undefined {
		const ctx = this.kernels && this._director.contextOf(id);
		const kernels = ctx === undefined ? undefined : this.kernels?.(ctx);
		return kernels?.hp?.(kernels.me);
	}

	/** `collective`'s first character in this scene, with its context: where a collective with no commander looks from. */
	public present(collective:Collective<TCtx>):{ character:Character<TCtx>; ctx:TCtx } | undefined {
		for (const character of collective.characters) {
			const ctx = this._director.contextOf(character.id);
			if (ctx !== undefined) {
				return { character, ctx };
			}
		}
		return undefined;
	}

	/** The host naming policy as one mind sees it: by its owner's id, from its voice's context. */
	public seenAs(mind:Mind<TCtx>):((target:NameTarget)=>string) | undefined {
		const seen = this.names;
		if (!seen) {
			return undefined;
		}
		// Its context only when the policy reads it: a kernel set names every entity in it, many times a frame.
		const tryCtx = ():TCtx | undefined => this._director.contextOf(mind.thinkThread());
		return (target) => seen({ id: mind.id, get ctx() {
			return tryCtx();
		} }, target);
	}

	/** The view of a collective with no commander: its first living character's kernels, measured from the middle of them all. */
	private pooled(collective:Collective<TCtx>):HostKernels | undefined {
		const first = this.present(collective);
		const sample = first && this.kernelsFor(first.character, first.ctx);
		if (!first || !sample) {
			return undefined;
		}
		const world = this._director.world;
		const center = centroid(collective.characters.flatMap((character) => {
			const point = world && poseOf(world, character.id)?.point;
			return point ? [point] : [];
		}));
		const poses = new Map<string, Pose>(center ? [[collective.id, { point: center }]] : []);
		return {
			...sample,
			...(world ? geometryKernels(world, first.character.id, poses) : {}),
			me: dummyEntity(collective.id, { tags: [RESERVED_TAGS.character] }),
			inventory: undefined,
		};
	}

	/**
	 * Host entities under `mind`'s names for them, so its model's own words still evaluate (`observe`).
	 * A binding keyed by a character's id is bound under its id and under the name.
	 */
	private namedKernels<TKernels extends Pick<HostKernels, 'others' | 'items' | 'bindings' | 'lookup'>>(mind:Mind<TCtx> | null, kernels:TKernels):TKernels {
		if (!mind || !this.names) {
			return kernels;
		}
		const named = (e:ExprEntity):ExprEntity => ({ ...e, name: mind.seen(e) });
		const bindings:Record<string, ExprVal> = {};
		for (const [key, val] of Object.entries(kernels.bindings ?? {})) {
			if (val.kind !== 'entity') {
				bindings[key] = val;
				continue;
			}
			const name = mind.seen(val.value);
			const value:ExprVal = { kind: 'entity', value: { ...val.value, name } };
			bindings[key] = value;
			if (key === val.value.id) {
				bindings[name] = value;
			}
		}
		const lookup = kernels.lookup && this.namedLookup(mind, kernels.lookup);
		return { ...kernels, others: kernels.others.map(named), items: kernels.items.map(named), bindings, ...lookup ? { lookup } : {} };
	}

	/**
	 * The host's `lookup` in `mind`'s names, as `namedKernels` names a binding: an entity under the name the mind gives it,
	 * and also found by that name.
	 */
	private namedLookup(mind:Mind<TCtx>, lookup:(name:string)=>ExprVal | undefined):(name:string)=>ExprVal | undefined {
		const named = (val:ExprVal | undefined):ExprVal | undefined => (val?.kind === 'entity' ? { kind: 'entity', value: { ...val.value, name: mind.seen(val.value) } } : val);
		return (name) => {
			const found = lookup(name);
			if (found) {
				return named(found);
			}
			const id = mind.persona.names.resolve(name);
			const known = id === name ? undefined : named(lookup(id));
			return known?.kind === 'entity' && known.value.id === id && known.value.name === name ? known : undefined;
		};
	}
}
