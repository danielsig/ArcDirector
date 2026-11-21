import { showNamingText } from '../character/text-with-ids.js';
import type { ArcRunner } from '../character/arc-runner.js';
import { Character } from '../character/Character.js';
import type { NameTarget } from '../character/NameBook.js';
import { Collective } from '../collective/Collective.js';
import { buildCollectiveCatalog, doingFields } from '../collective/who.js';
import { catalogEntities, unboundCalls } from '../expr/eval.js';
import { parse } from '../expr/expr-parse.js';
import { leftoverFilterHint, type Catalog, type ExprEntity, type ExprVal, type NativeFn, type SampleCache, type Stringifiers } from '../expr/expr-types.js';
import { buildCatalog, dummyEntity, type CatalogInputs } from '../expr/natives.js';
import { freezeMe } from '../expr/prev.js';
import { watchScore } from '../expr/watch-score.js';
import { internalsOf } from '../internals.js';
import type { Mind } from '../mind/mind.js';
import { SightFeature } from '../perception/SightFeature.js';
import { geometryKernels } from '../world/geometry-kernels.js';
import { blocksLines, inLineOfSight, poseOf } from '../world/lookup.js';
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

/** Why a watch expression can never be true (bad syntax, leftover English, a function there is none of), as opposed to false right now. */
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
	/** The host's own watch functions (`withFunctions`), over every feature's. */
	public functions:Record<string, NativeFn> = {};
	/** How the host writes values in the watch language (`withStringifiers`). */
	public stringifiers:Stringifiers | undefined;

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

	/**
	 * {@link catalog} with each character and thing in it as `seen` makes it out (`observe`): whole, stripped, or gone,
	 * so a name it cannot make out does not resolve. Places and the rest stay.
	 */
	public catalogSeen(runner:ArcRunner<TCtx>, seen:(entity:ExprEntity)=>ExprEntity | undefined):Catalog | undefined {
		const collective = collectiveOf(runner);
		const ctx = runner.context();
		const all = ctx !== undefined ? this.kernelsFor(runner, ctx) : collective ? this.pooled(collective) : undefined;
		if (!all) {
			return undefined;
		}
		const tiered = new Set([...all.others, ...all.items].map((e) => e.id));
		const see = (val:ExprVal | undefined):ExprVal | undefined => {
			if (val?.kind !== 'entity' || !(tiered.has(val.value.id) || this._director.character(val.value.id))) {
				return val;
			}
			const shown = seen(val.value);
			return shown && { kind: 'entity', value: shown };
		};
		const { lookup } = all;
		const kernels:CatalogInputs = {
			...all,
			others: all.others.flatMap((e) => seen(e) ?? []),
			items: all.items.flatMap((e) => seen(e) ?? []),
			bindings: Object.fromEntries(Object.entries(all.bindings ?? {}).flatMap(([key, val]) => {
				const shown = see(val);
				return shown ? [[key, shown]] : [];
			})),
			...lookup ? { lookup: (name:string) => see(lookup(name)) } : {},
		};
		return collective ? buildCollectiveCatalog(kernels, collective) : buildCatalog(kernels);
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
	public kernelsFor(runner:ArcRunner<TCtx>, ctx:TCtx, cache = internalsOf(this._director).cast.cacheOf(runner), point?:Vec):CatalogInputs | undefined {
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
		const parts = internalsOf(director).features.map((feature) => feature.watchKernels(runner));
		const sight = director.getFeature(SightFeature);
		const added = Object.assign({}, ...parts) as Partial<CatalogInputs>;
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
			// Who sees whom: where what each sees by passes, where the world says what stands between; else by sight.
			canSee: blocksLines(world) ? (a, b) => inLineOfSight(world, a.id, b.id, sight?.mediumOf(director.contextOf(a.id)))
				: sight && ((a, b) => sight.sees(a.id, b.id) ?? true),
			bindings: { events, ...kernels.bindings, ...added.bindings },
			// Ready once its cooldown is over: the library's count (`VerbDef.cooldown`, a kit's `cooldowns`) and the host's.
			isReady: (who, verb) => (director.character(who.id)?.readyIn(verb) ?? 0) <= 0 && (kernels.isReady?.(who, verb) ?? true),
			// Every feature's natives (`feeling(u)`), the host's own over them.
			functions: Object.assign({}, ...parts.map((part) => part?.functions), this.functions),
			stringifiers: this.stringifiers,
			// Its watches by name, so `wait(until=fallen || idle)` reads them.
			watches: listener?.persona.watchList(),
			// A name its mind wrote of one it could not tell finds them once it can.
			unmark: (word) => ((runner.owner ?? runner).mind?.persona.names ?? runner.persona.names).unmark(word),
			cache,
			hasHeard: mind?.hasHeard() ?? false,
			prev: {
				secondsAgo: ago,
				// Its spawn snapshot, so the first think can see a change.
				me: runner.prevMe ??= freezeMe(kernels),
				verbs: last ? [{ secondsAgo: ago ?? 0, isOk: last.status === 'ok', reason: showNamingText(last.reason ?? '', (id) => mind?.nameOf(id) ?? id), verb: last.verb ?? '' }] : [],
			},
		} as CatalogInputs;
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
		return this.namesAs(mind, () => this._director.contextOf(mind.thinkThread()));
	}

	/** The host naming policy as `viewer` sees it, from the context `ctx` gives: both read when it is asked. */
	public namesAs(viewer:{ readonly id:string }, ctx:()=>TCtx | undefined):((target:NameTarget)=>string) | undefined {
		const seen = this.names;
		// Its context only when the policy reads it: a kernel set names every entity in it, many times a frame.
		return seen && ((target) => seen({ id: viewer.id, get ctx() {
			return ctx();
		} }, target));
	}

	/** The view of a collective with no commander: its first living character's kernels, measured from the middle of them all. */
	private pooled(collective:Collective<TCtx>):CatalogInputs | undefined {
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
	private namedKernels<TKernels extends Pick<CatalogInputs, 'others' | 'items' | 'bindings' | 'lookup'>>(mind:Mind<TCtx> | null, kernels:TKernels):TKernels {
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
