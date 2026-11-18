import type { ArcRunner } from './arc-runner.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { callEach } from '../director/director-types.js';
import { Feature, type FeatureTick, type WatchKernels } from '../director/Feature.js';
import { isRecord, type JsonValue } from '../json.js';
import type { SeenObject } from '../perception/perception-types.js';
import type { Manner } from '../mind/mind-types.js';
import { FEELINGS, type Feeling, type FeelingDef } from './feeling.js';

/** Game seconds a feeling shows before it fades, by default. */
const FEELING_SECONDS = 120;

/** What `withFeelings` takes. */
export type FeelingsOptions = {
	/** Every feeling there is, by name. Replaces the stock ones ({@link FEELINGS}), so a game names only those it can show. */
	feelings?:Readonly<Record<string, FeelingDef>>;
	/** Game seconds a feeling shows before it fades. Default 120. */
	seconds?:number;
	/** Each feeling a character starts to show, for its face, body and sound, and `undefined` once it fades. Adds a listener. */
	onFeeling?:(id:string, feeling:Feeling | undefined)=>void;
};

/**
 * What characters feel (`withFeelings({ onFeeling })`): the `express(feeling)` verb, or the host's own word
 * (`getFeelings()?.express(id, Feeling.Afraid)` on a hit), shows one until it fades or another replaces it. Onlookers see
 * it (`Angler (looking angry)`), its lines carry it (`Ann says angrily to you`), and watches read it (`feeling(u) == "angry"`).
 * A save keeps each one shown with the time it has left.
 */
export class FeelingFeature<TCtx = unknown> extends Feature<TCtx> {
	private _feelings = new Map<string, FeelingDef>(Object.entries(FEELINGS));
	private _seconds = FEELING_SECONDS;
	private readonly _onFeeling:((id:string, feeling:Feeling | undefined)=>void)[] = [];
	/** What each character shows, and the game time it fades at. */
	private readonly _shown = new Map<string, { feeling:Feeling; until:number }>();

	public override readonly order = 45;
	public override readonly saveKey = 'feelings';

	public configure({ feelings, seconds = this._seconds, onFeeling }:FeelingsOptions):this {
		this._seconds = seconds;
		if (onFeeling && !this._onFeeling.includes(onFeeling)) {
			this._onFeeling.push(onFeeling);
		}
		if (feelings) {
			this._feelings = new Map(Object.entries(feelings));
			if (this.attached) {
				this.verbsChanged();
			}
		}
		return this;
	}

	/** Onlookers see the feeling each character shows (`Angler (looking angry)`), where the host's own `looks` says nothing. */
	public override seen(ctx:TCtx, selfID:string, objects:SeenObject[]):SeenObject[] {
		return objects.map((o) => {
			const looks = o.looks === undefined ? this.looks(o.id) : undefined;
			return looks ? { ...o, looks } : o;
		});
	}

	public override install():void {
		this.director.withVerbs((v) => v.add('express', {
			args: { feeling: 'string' },
			help: 'shows on your face and body until it fades',
			channel: '',
			handler: ({ character, args }) => (this.express(character.id, args.feeling)
				? { status: 'ok', verb: 'express' }
				: { status: 'failed', verb: 'express', reason: `no feeling called ${args.feeling}` }),
		}));
	}

	/** `express`'s `feeling` is one of the feelings there are, in its help and its reply schema alike. */
	public override verbsChanged():void {
		this.director.verbs.argNames('express', 'feeling', [...this._feelings.keys()]);
	}

	/** Character `id` shows `feeling` for `seconds` (default `withFeelings`' `seconds`), in place of any it showed; false for a feeling there is not. */
	public express(id:string, feeling:Feeling, seconds = this._seconds):boolean {
		if (!this._feelings.has(feeling)) {
			return false;
		}
		this._shown.set(id, { feeling, until: this.director.time + seconds });
		this.tell(id, feeling);
		return true;
	}

	/** The feeling character `id` shows now, if any. */
	public of(id:string):Feeling | undefined {
		const shown = this._shown.get(id);
		return shown && shown.until > this.director.time ? shown.feeling : undefined;
	}

	/** What `feeling` is in words, if there is such a feeling. */
	public def(feeling:Feeling | undefined):FeelingDef | undefined {
		return feeling === undefined ? undefined : this._feelings.get(feeling);
	}

	/** How character `id` looks to onlookers: `looking angry`, or nothing while it shows no feeling. */
	public looks(id:string):string | undefined {
		const def = this.def(this.of(id));
		return def && `looking ${def.looking}`;
	}

	public override beforeWatches({ now }:FeatureTick):void {
		for (const [id, { until }] of this._shown) {
			if (until <= now) {
				this._shown.delete(id);
				this.tell(id, undefined);
			}
		}
	}

	/** Each feeling shown, by character, with the game seconds it has left. */
	public override toJSON():JsonValue {
		const now = this.director.time;
		const saved:Record<string, JsonValue> = {};
		for (const [id, { feeling, until }] of this._shown) {
			if (until > now) {
				saved[id] = { feeling, left: until - now };
			}
		}
		return saved;
	}

	/** Each saved feeling shows again for the time it had left, and `onFeeling` hears it; one the save lacks fades. */
	public override load(json:JsonValue | undefined):void {
		const before = [...this._shown.keys()];
		this._shown.clear();
		for (const [id, shown] of Object.entries(isRecord(json) ? json : {})) {
			if (isRecord(shown) && typeof shown.feeling === 'string' && typeof shown.left === 'number') {
				this.express(id, shown.feeling, shown.left);
			}
		}
		for (const id of before.filter((gone) => !this._shown.has(gone))) {
			this.tell(id, undefined);
		}
	}

	public override runnerRemoved(runner:ArcRunner<TCtx>):void {
		this._shown.delete(runner.id);
	}

	/** `feeling(u)`: the feeling `u` shows, `""` for none. */
	public override watchKernels():WatchKernels {
		return { functions: { feeling: ([who]) => {
			const one = who?.kind === 'list' ? who.value[0] : who;
			return { kind: 'string', value: (one?.kind === 'entity' && this.of(one.value.id)) || '' };
		} } };
	}

	/** A line said with a feeling, said so: `Ann says angrily to you`, `Ann (says angrily, to you): …`; in a tone, after the tone's word (`growls angrily`). */
	public override manner(turn:Manner):string | undefined {
		const adverb = this.def(turn.feeling)?.adverb;
		return adverb && (turn.as ? adverb : `says ${adverb}`);
	}

	private tell(id:string, feeling:Feeling | undefined):void {
		callEach('onFeeling', this._onFeeling, [id, feeling], (entry) => this.director.log(entry));
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link FeelingFeature}: `withFeelings({ feelings, seconds: 60, onFeeling: (id, feeling) => face(id, feeling) })`. */
		withFeelings(options?:FeelingsOptions):this;
		getFeelings():FeelingFeature<TCtx> | undefined;
	}
}
export function withFeelings<TCtx>(this:ArcDirector<TCtx>, options:FeelingsOptions = {}):ArcDirector<TCtx> {
	return this.configureFeature(FeelingFeature<TCtx>, () => new FeelingFeature<TCtx>(), (feelings) => feelings.configure(options));
}
