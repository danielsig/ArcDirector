import type { ArcRunner } from '../character/arc-runner.js';
import { Character } from '../character/Character.js';
import type { KitSource } from '../character/character-types.js';
import { Collective } from '../collective/Collective.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { Feature, type FeatureTick, type WatchKernels } from '../director/Feature.js';
import { RTS } from './rts.js';
import type { RTSHost } from './rts-types.js';
import { STOCK_RTS_VERB_DEFS } from './rts-verbs.js';

/**
 * An RTS (`withRTS(host)`): its kinds as data and a few primitives, each acting once (`RTSHost`). Registers the stock RTS
 * verbs and runs them all: who does the work, routes, queues, supply, target picking, failure reasons. A unit or
 * building whose tags name a kind gets that kind's tags and verbs; a side's commander reads its stock, supply, queues
 * and grouped units in its prompt. Movement needs `withWorld`.
 */
export class RTSFeature<TCtx = unknown> extends Feature<TCtx> {
	private _rts:RTS<TCtx> | undefined;

	constructor(private _host:RTSHost) {
		super();
	}

	/** Run on `host` from now on: added already, a new RTS on it, its verbs registered again. */
	public configure(host:RTSHost):this {
		const was = this._host;
		this._host = host;
		if (host !== was && this.attached) {
			this.install();
		}
		return this;
	}

	public override readonly order = 20;

	public override install():void {
		const director = this.director;
		const rts = new RTS<TCtx>(this._host, director);
		this._rts = rts;
		director.withVerbs((v) => {
			v.addAll(STOCK_RTS_VERB_DEFS);
			for (const [verb, handler] of Object.entries(rts.handlers())) {
				v.add(verb, { handler });
			}
			for (const [name, alias] of Object.entries({ ...rts.aliases(), ...rts.renamed() })) {
				v.addAlias(name, alias);
			}
		});
	}

	/** By the first of its tags that names a kind, as a unit it trains has. */
	public override kindOf(tags:readonly string[] | undefined):{ tags:string[]; kit:KitSource<TCtx> } | undefined {
		const kind = tags?.find((tag) => this._rts?.spec(tag));
		return kind ? { tags: [...new Set([...tags!, ...this._rts!.tagsOf(kind)])], kit: this._rts!.kitOf(kind) } : undefined;
	}

	/** Its kinds, and whatever it describes: units, buildings, sites and nodes, though the world does not place them yet. */
	public override knows(name:string):boolean {
		return !!this._rts?.spec(name) || this._host.describe(name) !== undefined;
	}

	/** A side's commander reads its stock, supply and queues. */
	public override rosterStatus(collective:Collective<TCtx>):string | undefined {
		return this._rts?.status(collective.id);
	}

	/** Its side's numbers as watch bindings: a collective's own, or a character's collective's. */
	public override watchKernels(runner:ArcRunner<TCtx>):WatchKernels {
		const side = runner instanceof Character ? runner.collective?.id ?? runner.id : runner.id;
		return { bindings: this._rts!.bindings(side) };
	}

	public override beforeMoves({ dt }:FeatureTick):void {
		this._rts?.tick(dt);
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link RTSFeature}. */
		withRTS(host:RTSHost):this;
		getRTS():RTSFeature<TCtx> | undefined;
	}
}
export function withRTS<TCtx>(this:ArcDirector<TCtx>, host:RTSHost):ArcDirector<TCtx> {
	return this.configureFeature(RTSFeature<TCtx>, () => new RTSFeature<TCtx>(host), (rts) => rts.configure(host));
}
