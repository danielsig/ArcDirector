import { stepDoing } from '../arc/stock-verbs.js';
import type { ArcRunner } from '../character/arc-runner.js';
import { Collective } from '../collective/Collective.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { Feature } from '../director/Feature.js';
import { buildCatalog, dummyEntity } from '../expr/natives.js';
import { evaluate } from '../expr/eval.js';
import { watchScore } from '../expr/watch-score.js';
import { internalsOf } from '../internals.js';
import { isRecord } from '../json.js';
import { mindTools, type Mind } from '../mind/mind.js';
import type { ToolSpec } from '../mind/mind-types.js';
import { distance } from '../world/vec.js';
import { axesOf, blocksLines, clarityOf, inLineOfSight, inReach, poseOf } from '../world/lookup.js';
import { Medium, RESERVED_TAGS, type Vec } from '../world/world-types.js';
import { InventoryFeature } from './carrying.js';
import { BearingMode, type SeenObject, type Sight, type SightClause, type SightOpts } from './perception-types.js';
import { CARRIED_SALIENCE, sightSalience } from './salience.js';
import { asMadeOut, DEFAULT_SIGHT, DEFAULT_SIGHT_RANGE, sightingOf, formatMeasure, formatSightClauses, joinSightClauses, madeOut, mergeHiveClauses, orderSightClauses, quantizeDistance, sightClarityAt, sightTier, type SightRange, type SightTier } from './sight.js';

/** What `withSight` takes. */
export type SightOptions<TCtx = unknown> = {
	/** What a character sees from its context, before what light does not reach is taken out. */
	look?:(ctx:TCtx)=>Sight;
	/** Most things a mind is shown, the closest and most in focus kept, where its persona's `sightLimit` says nothing. */
	limit?:number;
	/** What distances are told in: `m`, `paces` (default). Heard sounds and noisy verbs' help say them so too. */
	unitName?:string;
	/**
	 * How where things are is told, in the world's axes (`geometry.axes`): `BearingMode.Relative` (default), "Mira 12m to
	 * your right"; `Absolute`, "Mira 12m south"; `Both`, "Mira 12m to your right (south)". Heard sounds are told so too.
	 */
	bearing?:BearingMode;
	/**
	 * What a character sees by, from its context: `light` (default), or a medium the game added (`xray`, `thermal`, a
	 * bat's `echo`); `getClarity` and `castRay` answer it. The world's physics stays the same for everyone.
	 */
	medium?:(ctx:TCtx)=>Medium;
	/**
	 * How clearly distance lets a thing be made out, which its row's `clarity` is multiplied by: how far it stays clear,
	 * dim and vague (`sightClarityAt`), or the game's own `(ctx, seen) => 0–1`. Default `{ clear: 20, dim: 35, vague: 50 }`.
	 */
	range?:SightRange | ((ctx:TCtx, seen:SeenObject)=>number);
	/**
	 * How many times sight's `range` the `observe` tool makes things out at, by the same clear, dim and vague tiers.
	 * Default 2.
	 */
	observeRangeFactor?:number;
};

/**
 * What characters see: the host's `look` from a character's context, less what light does not reach (`castRay`, `getClarity`), shown
 * to each mind under its own names as the `sight` sense (`withSight({ look })`). Others ask it who sees whom: offers,
 * picking up, sounds, a collective's roster.
 */
export class SightFeature<TCtx = unknown> extends Feature<TCtx> {
	private readonly _options:SightOptions<TCtx> = {};

	public configure(options:SightOptions<TCtx>):this {
		Object.assign(this._options, options);
		return this;
	}

	/** The unit distances are told in, if the host named one. */
	public get unitName():string | undefined {
		return this._options.unitName;
	}

	/** How bearings are told (`bearing`). */
	public get bearing():BearingMode {
		return this._options.bearing ?? BearingMode.Relative;
	}

	/** How sight text is written: in the host's unit, by the world's axes, bearings as `bearing` says. */
	private get format():SightOpts {
		return { ...this.unitName ? { unitName: this.unitName } : {}, axes: axesOf(this.director.world), bearing: this.bearing };
	}

	public override install():void {
		this.director.withSenses((s) => s.add('sight', (ctx, mind) => (this._options.look ? this.gather(mind, ctx) : undefined)))
			.withTools((t) => t.add('observe', this.observeTool));
	}

	/** What a character with `ctx` sees by (`medium`); light without one. */
	public mediumOf(ctx:TCtx | undefined):Medium {
		return ctx === undefined ? Medium.Light : this._options.medium?.(ctx) ?? Medium.Light;
	}

	/**
	 * What a character sees from `ctx`, each row's `clarity` the host's times distance's (`range`) times what its
	 * medium lets through (`castRay`, `getClarity`), less what is too dim to make out at all but what everyone sees
	 * (`always`), with what features add to what it sees (`Feature.seen`); none without a look.
	 */
	public seenBy(ctx:TCtx):Sight | undefined {
		if (!this._options.look) {
			return undefined;
		}
		const snap = this._options.look(ctx);
		const objects = snap.objects.map((o) => (o.always ? o : { ...o, clarity: this.clarity(ctx, snap.self.point, o) }));
		const seen = objects.filter((o) => o.always || sightTier(o.clarity) !== 'none');
		return { ...snap, objects: internalsOf(this.director).features.reduce((list, feature) => feature.seen(ctx, snap.self.id, list), seen) };
	}

	/**
	 * How clearly a thing is made out from `from`: the host's clarity, times distance's at `reach` times sight's `range`
	 * (as if `reach` times nearer), times what its medium lets through.
	 */
	private clarity(ctx:TCtx, from:Vec, o:SeenObject, reach = 1):number {
		const range = this._options.range ?? DEFAULT_SIGHT_RANGE;
		const world = this.director.world;
		const far = typeof range === 'function'
			? range(ctx, reach === 1 ? o : { ...o, point: o.point.map((v, i) => from[i] + (v - from[i]) / reach) })
			: sightClarityAt(distance(o.point, from) / reach, range);
		const pass = blocksLines(world) ? clarityOf(world, this.mediumOf(ctx), from, o.point) : 1;
		return (o.clarity ?? 1) * far * pass;
	}

	/** Whether character `fromID` sees `toID` now, as far as sight reaches; `undefined` when there is no sight to ask. */
	public sees(fromID:string, toID:string):boolean | undefined {
		const ctx = this._options.look ? this.director.contextOf(fromID) : undefined;
		const snap = ctx === undefined ? undefined : this.seenBy(ctx);
		return snap?.objects.some((o) => o.id === toID && madeOut(o));
	}

	/** Whether `o` is a character: tagged one, or one the director runs. */
	private isCharacter(o:Pick<SeenObject, 'id' | 'tags'>):boolean {
		return o.tags.includes(RESERVED_TAGS.character) || this.director.character(o.id) !== undefined;
	}

	/**
	 * Characters only, nearest first, as far as sight reaches; where the world has geometry, whether in its reach
	 * (`getReach`), and for those in reach only, whether light passes between them (`castRay`, `getClarity`; clear
	 * without either): `(in reach)`, `(in reach, no clear shot)` or `(out of reach)`.
	 */
	public override othersSeenBy(id:string, collective:Collective<TCtx>, mind:Mind<TCtx>):{ name:string; away:number; text:string }[] {
		const ctx = this._options.look ? this.director.contextOf(id) : undefined;
		const snap = ctx === undefined ? undefined : this.seenBy(ctx);
		if (!snap) {
			return [];
		}
		const members = new Set(collective.characters.map((c) => c.id));
		const world = this.director.world;
		const reach = (to:string):string => {
			const near = world && inReach(world, id, to);
			return near === undefined ? '' : !near ? ' (out of reach)' : inLineOfSight(world, id, to) ? ' (in reach)' : ' (in reach, no clear shot)';
		};
		return snap.objects
			.filter((o) => !members.has(o.id) && this.isCharacter(o) && madeOut(o))
			.map((o) => ({ o, away: distance(o.point, snap.self.point) }))
			.sort((a, b) => a.away - b.away)
			.map(({ o: seen, away }) => ({ seen, o: asMadeOut(seen, true), away }))
			.map(({ seen, o, away }) => ({ name: seen.id, away, text: `${mind.nameOf(seen.id) || seen.id}${o.hp !== undefined && o.maxHP !== undefined ? ` ${o.hp}/${o.maxHP} hp` : ''} ${formatMeasure(quantizeDistance(away, DEFAULT_SIGHT.closeness), this.unitName ?? DEFAULT_SIGHT.unitName)}${reach(seen.id)}` }));
	}

	/** What `mind`'s voice sees; for a collective with no commander, what all its characters see, pooled. */
	private gather(mind:Mind<TCtx>, ctx:TCtx):string {
		const focus = mind.persona.effectiveSightFocus();
		const limit = mind.persona.sightLimit ?? this._options.limit;
		const scores = new Map<string, number>();
		const salience = new Map<string, number>();
		const format = this.format;
		const owner = mind.owner;
		if (owner instanceof Collective && owner.characters.length > 0 && !this.director.contextOf(mind.thinkThread())) {
			const groups:{ unitID:string; clauses:ReturnType<typeof formatSightClauses> }[] = [];
			for (const character of owner.characters) {
				const memberCtx = this.director.contextOf(character.id);
				if (!memberCtx) {
					continue;
				}
				const snap = this.see(mind, memberCtx);
				sightSalience(snap, salience);
				groups.push({ unitID: character.id, clauses: formatSightClauses(snap, { ...format, fromName: character.id, skipAmbient: groups.length > 0 }) });
				if (focus.length > 0) {
					this.score(snap.objects, focus, memberCtx, character, scores);
				}
			}
			const merged = mergeHiveClauses(groups, focus.length > 0 ? scores : undefined);
			return this.shown(mind, orderSightClauses(merged, scores, limit, focus.length > 0), salience);
		}
		const snap = this.see(mind, ctx);
		sightSalience(snap, salience);
		const bag = this.director.getFeature(InventoryFeature)?.inventoryOf(ctx);
		for (const item of [...bag?.pockets ?? [], ...bag?.pack?.items ?? [], ...Object.values(bag?.worn ?? {})]) {
			salience.set(item, CARRIED_SALIENCE);
		}
		const clauses = formatSightClauses(snap, format);
		if (focus.length > 0) {
			this.score(snap.objects, focus, ctx, mind.voice, scores);
		}
		return this.shown(mind, orderSightClauses(clauses, scores, limit, focus.length > 0), salience);
	}

	/**
	 * What `mind` sees from `ctx`, each thing as clearly as it is made out: under its name for it, each character with
	 * what it is seen doing and how it looks; dim, without health, doing or looks; vague, by its kind only, under the
	 * mind's label for it (`FigureA`, its {@link NameBook.vague}), which tells no one's name and is never remembered (its
	 * clause claims no id).
	 */
	private see(mind:Mind<TCtx>, ctx:TCtx):Sight {
		const seen = this.seenBy(ctx)!;
		const world = this.director.world;
		const up = seen.self.up ?? (world && poseOf(world, seen.self.id)?.up);
		const snap = up ? { ...seen, self: { ...seen.self, up } } : seen;
		const axes = axesOf(world);
		return {
			...snap,
			objects: snap.objects.map((seen) => {
				const character = this.isCharacter(seen);
				const o = asMadeOut(seen, character);
				if (!madeOut(o)) {
					const label = mind.persona.names.vague(o.id, o.label!, character);
					return { ...o, id: label, label };
				}
				const doing = o === seen ? o.doing ?? this.seenDoing(o.id, mind) : undefined;
				return { ...o, id: mind.seen({ ...o, sighting: sightingOf(snap.self, o, axes, this.bearing) }), ...doing ? { doing } : {} };
			}),
		};
	}

	/** What character `id` is seen doing, in its verb's own words and `mind`'s names: `going to Cottage`. Nothing while idle or waiting. */
	private seenDoing(id:string, mind:Mind<TCtx>):string | undefined {
		const character = this.director.character(id);
		const step = character?.verb && character.verb !== 'wait' ? character.lastStep : undefined;
		return step && stepDoing(step, this.director.verbs, (name) => mind.nameOf(name) || name);
	}

	/**
	 * The sight text `mind` is shown, in its names; it remembers each one in it by id as last seen there, and recalls by
	 * what is salient.
	 */
	private shown(mind:Mind<TCtx>, clauses:SightClause[], salience:ReadonlyMap<string, number>):string {
		const id = (name:string):string => mind.persona.names.resolve(name);
		internalsOf(mind).sighted(clauses.map((c) => ({ ...c, claimedIDs: c.claimedIDs.map(id) })), new Map([...salience].map(([name, weight]) => [id(name), weight])));
		return joinSightClauses(clauses);
	}

	/** `observe` on what a mind makes out ({@link observe}): what `install` registers. */
	private get observeTool():ToolSpec<TCtx> {
		return {
			...mindTools<TCtx>().observe,
			description: 'Evaluate a watch expression on what you can make out now, farther off than you see. Standing conditions belong in watches; a one-off question about now uses observe. Names only, no coordinates. Whoever is too far to make out answers to no name: get closer.',
			handler: (ctx, args, mind) => this.observe(mind, args),
		};
	}

	/**
	 * What `observe` answers `mind`: its expression on what its voice makes out at `observeRangeFactor` times sight's
	 * ranges, by sight's tiers: clear, whole; dim, by name only; vague or farther, under no name. Whoever it names or
	 * answers with but makes out only dim, it is told it must get closer to see; one it names but cannot make out at all,
	 * vague or farther alike (so it never learns who a vague figure is), that no one it makes out goes by that name; and
	 * one it names by a vague label (`FigureA`), that it is too far to make out. Unmeasured without a world.
	 */
	public observe(mind:Mind<TCtx>, args:unknown):string | { error:string } {
		const tierOf = this.observedBy(mind);
		if (!tierOf) {
			return mind.observe(args);
		}
		const dim = new Set<string>();
		const hidden = new Set<string>();
		const vague = new Set<string>();
		const catalog = internalsOf(this.director).watches.catalogSeen(mind.voice, (e) => {
			const tier = tierOf(e.id);
			if (tier !== 'clear') {
				(tier === 'dim' ? dim : hidden).add(e.name ?? e.id);
			}
			const label = mind.persona.names.peek(e.id);
			if (label !== mind.persona.names.peek(e.id, false)) {
				vague.add(label!);
			}
			return tier === 'clear' ? e : tier === 'dim' ? { id: e.id, name: e.name, tags: e.tags } : undefined;
		});
		const answer = mind.observe(args, catalog);
		const words = `${isRecord(args) ? String(args.expr) : ''} ${typeof answer === 'string' ? answer : ''}`.split(/[^A-Za-z0-9_]+/);
		const said = (names:Set<string>, why:string):string[] => [...names].filter((name) => words.includes(name)).map((name) => `${name}: ${why}; get closer to see`);
		// One it names but cannot make out answers nothing: what it is asked of them is not known.
		const unnamed = [...said(hidden, 'you make out no one by that name from here'), ...said(vague, 'too far to make out')];
		const dimmed = said(dim, 'too far to make out clearly');
		return unnamed.length > 0 ? { error: unnamed.join('\n') }
			: dimmed.length === 0 ? answer
				: typeof answer === 'string' ? [answer, ...dimmed].join('\n') : { error: [answer.error, ...dimmed].join('\n') };
	}

	/**
	 * How clearly `mind` makes out each thing for `observe`, by id: from its voice, else the best any of its characters
	 * does; its own always clear. Undefined where there is no world to measure in.
	 */
	private observedBy(mind:Mind<TCtx>):((id:string)=>SightTier) | undefined {
		const owner = mind.owner;
		const voice = mind.thinkThread();
		const ours = owner instanceof Collective ? owner.characters.map((c) => c.id) : [];
		const from = this.director.contextOf(voice) !== undefined ? [voice] : ours;
		const reach = this._options.observeRangeFactor ?? 2;
		const views = from.flatMap((id) => this.madeOutBy(id, reach) ?? []);
		const rank:SightTier[] = ['none', 'vague', 'dim', 'clear'];
		return views.length === 0 ? undefined : (id) => (id === voice || ours.includes(id)
			? 'clear'
			: views.map((view) => view(id)).reduce((a, b) => (rank.indexOf(a) >= rank.indexOf(b) ? a : b)));
	}

	/** How clearly character `fromID` makes out each thing, by id, at `reach` times sight's ranges, where the world says both stand. */
	private madeOutBy(fromID:string, reach:number):((id:string)=>SightTier) | undefined {
		const world = this.director.world;
		const ctx = this.director.contextOf(fromID);
		const from = world && poseOf(world, fromID)?.point;
		if (!world || !from || ctx === undefined) {
			return undefined;
		}
		const rows = new Map((this._options.look?.(ctx).objects ?? []).map((o) => [o.id, o]));
		return (id) => {
			const row = rows.get(id);
			const point = row?.point ?? poseOf(world, id)?.point;
			return row?.always || !point ? 'clear' : sightTier(this.clarity(ctx, from, { tags: [], ...row, id, point }, reach));
		};
	}

	/** How well each of `objects` fits the focus `exprs` as `runner` sees it, the first focus counting most, into `into`. */
	private score(objects:SeenObject[], exprs:string[], ctx:TCtx, runner:ArcRunner<TCtx>, into:Map<string, number>):void {
		const kernels = internalsOf(this.director).watches.kernelsFor(runner, ctx);
		if (!kernels) {
			return;
		}
		for (const obj of objects.filter(madeOut)) {
			const fields = obj.hp !== undefined && obj.maxHP !== undefined ? { hp: { kind: 'number', value: obj.hp }, maxHP: { kind: 'number', value: obj.maxHP } } as const : undefined;
			const it = dummyEntity(runner.mind?.persona.names.resolve(obj.id) ?? obj.id, { name: obj.id, tags: obj.tags, fields });
			const cat = buildCatalog({ ...kernels, bindings: { ...kernels.bindings, it: { kind: 'entity', value: it } } });
			let best = 0;
			for (let i = 0; i < exprs.length; i++) {
				const r = evaluate(exprs[i], cat);
				const s = watchScore(r.error ? { kind: 'absent' } : r.value).score * (0.8 ** i);
				if (s > best) {
					best = s;
				}
			}
			if (best > (into.get(obj.id) ?? 0)) {
				into.set(obj.id, best);
			}
		}
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link SightFeature}: `withSight({ look, limit: 8, unitName: 'm' })`. */
		withSight(options:SightOptions<TCtx>):this;
		getSight():SightFeature<TCtx> | undefined;
	}
}
export function withSight<TCtx>(this:ArcDirector<TCtx>, options:SightOptions<TCtx>):ArcDirector<TCtx> {
	return this.configureFeature(SightFeature<TCtx>, () => new SightFeature<TCtx>(), (sight) => sight.configure(options));
}
