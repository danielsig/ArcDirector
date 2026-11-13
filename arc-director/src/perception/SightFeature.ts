import { stepDoing } from '../arc/stock-verbs.js';
import type { ArcRunner } from '../character/arc-runner.js';
import { Collective } from '../collective/Collective.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { Feature } from '../director/Feature.js';
import { buildCatalog, dummyEntity } from '../expr/natives.js';
import { evaluate } from '../expr/eval.js';
import { watchScore } from '../expr/watch-score.js';
import { internalsOf } from '../internals.js';
import type { Mind } from '../mind/mind.js';
import { distance } from '../world/vec.js';
import { RESERVED_TAGS } from '../world/world-types.js';
import { InventoryFeature } from './carrying.js';
import type { SeenObject, Sight, SightClause } from './perception-types.js';
import { CARRIED_SALIENCE, sightSalience } from './salience.js';
import { DEFAULT_SIGHT, formatMeasure, formatSightClauses, joinSightClauses, mergeHiveClauses, orderSightClauses, quantizeDistance } from './sight.js';

/** What `withSight` takes. */
export type SightOptions<TCtx = unknown> = {
	/** What a character sees from its context, before what light does not reach is taken out. */
	look?:(ctx:TCtx)=>Sight;
	/** Most things a mind is shown, the closest and most in focus kept, where its persona's `sightLimit` says nothing. */
	limit?:number;
	/** What distances are told in: `m`, `paces` (default). Heard sounds and noisy verbs' help say them so too. */
	unitName?:string;
};

/**
 * What characters see: the host's `look` from a character's context, less what light does not reach (`canPass`), shown
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

	public override install():void {
		this.director.withSenses((s) => s.add('sight', (ctx, mind) => (this._options.look ? this.gather(mind, ctx) : undefined)));
	}

	/** What a character sees from `ctx`, less what light does not reach but what everyone sees (`always`); none without a look. */
	public seenBy(ctx:TCtx):Sight | undefined {
		if (!this._options.look) {
			return undefined;
		}
		const snap = this._options.look(ctx);
		const world = this.director.world;
		return world?.canPass ? { ...snap, objects: snap.objects.filter((o) => o.always || world.canPass!('light', snap.self.point, o.point) > 0) } : snap;
	}

	/** Whether character `fromID` sees `toID` now, as far as sight reaches; `undefined` when there is no sight to ask. */
	public sees(fromID:string, toID:string):boolean | undefined {
		const ctx = this._options.look ? this.director.contextOf(fromID) : undefined;
		const snap = ctx === undefined ? undefined : this.seenBy(ctx);
		return snap?.objects.some((o) => o.id === toID && (o.always || distance(o.point, snap.self.point) <= DEFAULT_SIGHT.radius));
	}

	/** Characters only, nearest first, as far as sight reaches; whether in reach where the host's sight says. */
	public override othersSeenBy(id:string, collective:Collective<TCtx>, mind:Mind<TCtx>):{ name:string; away:number; text:string }[] {
		const ctx = this._options.look ? this.director.contextOf(id) : undefined;
		const snap = ctx === undefined ? undefined : this.seenBy(ctx);
		if (!snap) {
			return [];
		}
		const members = new Set(collective.characters.map((c) => c.id));
		return snap.objects
			.filter((o) => !members.has(o.id) && (o.tags.includes(RESERVED_TAGS.character) || this.director.character(o.id) !== undefined))
			.map((o) => ({ o, away: distance(o.point, snap.self.point) }))
			.filter(({ o, away }) => o.always || away <= DEFAULT_SIGHT.radius)
			.sort((a, b) => a.away - b.away)
			.map(({ o, away }) => ({ name: o.id, away, text: `${mind.nameOf(o.id) || o.id}${o.hp !== undefined && o.maxHP !== undefined ? ` ${o.hp}/${o.maxHP} hp` : ''} ${formatMeasure(quantizeDistance(away, DEFAULT_SIGHT.closeness), this.unitName ?? DEFAULT_SIGHT.unitName)}${o.inReach === undefined ? '' : o.inReach ? ' (in reach)' : ' (out of reach)'}` }));
	}

	/** What `mind`'s voice sees; for a collective with no commander, what all its characters see, pooled. */
	private gather(mind:Mind<TCtx>, ctx:TCtx):string {
		const focus = mind.persona.effectiveSightFocus();
		const limit = mind.persona.sightLimit ?? this._options.limit;
		const scores = new Map<string, number>();
		const salience = new Map<string, number>();
		const format = this.unitName ? { unitName: this.unitName } : {};
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

	/** What `mind` sees from `ctx`, everything under its name for it, each character with what it is seen doing. */
	private see(mind:Mind<TCtx>, ctx:TCtx):Sight {
		const snap = this.seenBy(ctx)!;
		return {
			...snap,
			objects: snap.objects.map((o) => {
				const doing = o.doing ?? this.seenDoing(o.id, mind);
				return { ...o, id: mind.seen(o), ...doing ? { doing } : {} };
			}),
		};
	}

	/** What character `id` is seen doing, in its verb's own words and `mind`'s names: `going to Cottage`. Nothing while idle or waiting. */
	private seenDoing(id:string, mind:Mind<TCtx>):string | undefined {
		const character = this.director.character(id);
		const step = character?.verb && character.verb !== 'wait' ? character.lastStep : undefined;
		return step && stepDoing(step, this.director.verbs, (name) => mind.nameOf(name) || name);
	}

	/** The sight text `mind` is shown; it remembers each name in it as last seen there, and recalls by what is salient. */
	private shown(mind:Mind<TCtx>, clauses:SightClause[], salience:ReadonlyMap<string, number>):string {
		internalsOf(mind).sighted(clauses, salience);
		return joinSightClauses(clauses);
	}

	/** How well each of `objects` fits the focus `exprs` as `runner` sees it, the first focus counting most, into `into`. */
	private score(objects:SeenObject[], exprs:string[], ctx:TCtx, runner:ArcRunner<TCtx>, into:Map<string, number>):void {
		const kernels = this.director.kernelsOf(runner, ctx);
		if (!kernels) {
			return;
		}
		for (const obj of objects) {
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
