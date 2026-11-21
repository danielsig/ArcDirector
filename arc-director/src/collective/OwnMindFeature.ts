import type { Step } from '../arc/arc-types.js';
import type { ArcRunner } from '../character/arc-runner.js';
import type { Character } from '../character/Character.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { Feature, type FeatureTick } from '../director/Feature.js';
import { internalsOf } from '../internals.js';
import type { MindSettings } from '../mind/mind.js';

/** What `withOwnMind`'s `when` is asked, as `by` starts `verb` on `character`, one of a collective's characters. */
export type OwnMindCase<TCtx = unknown> = { by:ArcRunner<TCtx>; character:Character<TCtx>; verb:string; step:Step };

export type OwnMindOptions<TCtx = unknown> = {
	/** Which arg of which verb names the character: `{ say: 'to', offer: 'to', give: 'to', kidnap: 'victim' }`. */
	on?:Readonly<Record<string, string>>;
	/** Whether it gets a mind of its own, as `by` starts `verb` on it. With no `when`, never. */
	when?:(named:OwnMindCase<TCtx>)=>boolean;
	/** The mind it thinks with on its own, where its spec gives none (a crowd extra's gives none). */
	mind?:MindSettings;
	/** Seconds no such verb named it before its own mind goes, once no think of it is under way or due. Default 30. */
	quiet?:number;
};

/**
 * A character of a collective thinks with a mind of its own while verbs the game picked name it (`say`'s `to`) and
 * the game agrees (`when`), still one of its collective's characters (`Cast.giveOwnMind`): the player talks to one of a
 * street of a hundred. Its mind goes once no such verb named it for `quiet` seconds and no think of it is under way or
 * due (a rethink aside), and what it held moves back (`Cast.takeOwnMind`). Install with `withOwnMind`.
 */
export class OwnMindFeature<TCtx = unknown> extends Feature<TCtx> {
	private _options:OwnMindOptions<TCtx> & { on:Readonly<Record<string, string>>; quiet:number } = { on: {}, quiet: 30 };
	/** When a verb last named each character that thinks for itself in its collective; one it has no time for (a loaded save's), when it first saw it. */
	private readonly _named = new Map<string, number>();

	public override readonly order = 50;

	public configure(options:OwnMindOptions<TCtx>):this {
		this._options = { ...this._options, ...options };
		return this;
	}

	public override stepStarts(by:ArcRunner<TCtx>, step:Step):void {
		const key = this._options.on[step.verb];
		const value = key === undefined ? undefined : step.args[key];
		for (const id of typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []) {
			const character = this.director.character(id);
			if (!character?.collective || id === by.id) {
				continue;
			}
			if (!character.thinksForItself && this._options.when?.({ by, character, verb: step.verb, step })) {
				internalsOf(this.director).cast.giveOwnMind(character, character.mindSettings ?? this._options.mind);
			}
			if (character.thinksForItself) {
				this._named.set(id, this.director.time);
			}
		}
	}

	public override afterMoves({ now }:FeatureTick):void {
		const own = this.director.characters().filter((character) => character.collective && character.thinksForItself);
		// Its reply to whoever named it may wait for a model slot: it stays for that.
		const thinking = (id:string):boolean => this.director.queue.isThinking(id) || internalsOf(this.director).thinkDue(id, 'rethink');
		const named = new Map(own.map((character) => [character.id, this._named.get(character.id) ?? now]));
		this._named.clear();
		for (const character of own) {
			if (now - named.get(character.id)! >= this._options.quiet && !thinking(character.id)) {
				internalsOf(this.director).cast.takeOwnMind(character);
			}
			else {
				this._named.set(character.id, named.get(character.id)!);
			}
		}
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/**
		 * {@link OwnMindFeature}: a character of a collective thinks for itself while a verb names it, as `when` says:
		 * `withOwnMind({ on: { say: 'to' }, when: ({ by }) => by.id === 'Player', quiet: 30 })`.
		 */
		withOwnMind(options:OwnMindOptions<TCtx>):this;
		getOwnMind():OwnMindFeature<TCtx> | undefined;
	}
}
export function withOwnMind<TCtx>(this:ArcDirector<TCtx>, options:OwnMindOptions<TCtx>):ArcDirector<TCtx> {
	return this.configureFeature(OwnMindFeature<TCtx>, () => new OwnMindFeature<TCtx>(), (feature) => feature.configure(options));
}
