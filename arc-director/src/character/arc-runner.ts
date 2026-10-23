import { CHOOSE_VERB, FOCUS_EDIT_VERBS, MIND_ONLY_VERBS, STOCK_MOVE_VERBS, WATCH_EDIT_VERBS, type VerbRegistry } from '../arc/stock-verbs.js';
import { formatStep } from '../arc/parse.js';
import { isArc, type Arc, type ArcResult, type Step } from '../arc/types.js';
import type { Catalog, ExprEntity } from '../expr/types.js';
import { cloneEntity, prevMeFromJSON } from '../expr/prev.js';
import {
	DEFAULT_MAX_LAWS,
	dropLaw,
	lawFromSpec,
	lawGroup,
	upsertLaw,
	type Law,
	type LawSpec,
} from '../arc/laws.js';
import {
	runArc,
	createArcSession,
	holding,
	DEFAULT_COOLDOWN,
	type ArcHandler,
	type ArcPick,
	type ArcSession,
	type ArcSessionOpts,
} from '../arc/run.js';
import type { Mind } from '../mind/mind.js';
import { ArcRecord } from './record.js';
import type { SayResult, SayTo, TalkNet } from '../mind/talk.js';
import type { Kit, KitSource } from './types.js';
import type { MoveOpts } from '../world/mover.js';

/** What a runner has while its kit cannot be read: a callback kit with no context. */
const NO_KIT:Kit = Object.freeze({ verbs: [] });

/** What a runner needs from its host to run arcs. */
export type RunnerDeps<TCtx = unknown> = {
	verbs:VerbRegistry;
	context:()=>TCtx | undefined;
	/** One host step, acted by this runner itself. */
	execute?:(step:Step, ctx:TCtx | undefined)=>Promise<ArcResult>;
	abortArc?:(id:string)=>void;
	/** Host cooldown in game seconds after a handler pops or aborts. Default 8. */
	cooldown?:number;
	talk?:TalkNet;
	/** Walk this runner up to `target`, as `VerbCall.goTo` does. */
	goTo?:(target:string, opts?:MoveOpts)=>Promise<ArcResult>;
	/** The watch-language view of the world from this runner now, or undefined when it has none. */
	catalog?:()=>Catalog | undefined;
	/** What it may use. Object or callback, fetched every tick, so the host can mutate it in place. */
	kit:KitSource<TCtx>;
	/** Its System One pick now, or undefined while it has none; without one, `choose` is withheld. */
	pick?:()=>ArcPick | undefined;
};

export type RunnerOptions<TCtx = unknown> = RunnerDeps<TCtx> & {
	id:string;
	laws?:LawSpec[];
	maxLaws?:number;
	defaultLawWho?:string;
};

/** A runner's part of a save: its laws and how its last arc went. */
export type ArcRunnerJSON = {
	id:string;
	lastResult?:ArcResult;
	liveArc:boolean;
	laws?:Law[];
	maxLaws?:number;
	cooldown?:number;
	prevMe?:ExprEntity;
};

/**
 * Anything that runs arcs: a {@link Character}, or a `Collective` with no commander. It holds the kit, the laws and
 * the arc running now. A runner never calls the model; the `mind` that thinks for it writes its arcs, and a
 * runner without one is driven by the host.
 */
export abstract class ArcRunner<TCtx = unknown> {
	public readonly id:string;
	public readonly verbs:VerbRegistry;
	public readonly context:()=>TCtx | undefined;
	public readonly execute?:(step:Step, ctx:TCtx | undefined)=>Promise<ArcResult>;
	public readonly abortArc?:(id:string)=>void;
	public readonly pick?:()=>ArcPick | undefined;
	public cooldown:number;
	public laws:Law[] = [];
	public maxLaws:number;
	protected defaultLawWho:string;
	public arcSession:ArcSession | null = null;
	public talk:TalkNet | undefined;
	private readonly _goTo:RunnerDeps['goTo'];
	public catalog?:()=>Catalog | undefined;
	/** Object or callback. Assign a new one any time. Fetched every tick. */
	public kit:KitSource<TCtx>;
	/** The kit as of the last refresh. */
	public currentKit:Kit = NO_KIT;
	public lastResult:ArcResult | undefined;
	/** The law whose arc runs now, by name; none for an arc its mind or host gave it. */
	private _law:string | undefined;
	/** How the current program is going, step by step and pick by pick. A new program clears it. */
	public readonly record = new ArcRecord();
	/** The arc running now, or parked on its `when`s. */
	public arc:Arc | null = null;
	/** The verb of the step running now; `''` between steps. */
	public verb = '';
	/** What it is at, in a kit's words (`gathering Wood`, `holding Ford`): empty when no kit says. `doing(u, …)` reads it. */
	public work = '';
	/** The step `runStep` last ran. The mind reads it when the arc ends. */
	public lastStep:Step | undefined;
	/** Non-movement verbs this runner has finished. A reply wait ends when this changes. */
	public replies = 0;
	/** Index of the step currently running inside `enact` (0-based). */
	public verbIndex = 0;
	/** Self as `prev.me` sees it: at its mind's last think, else as first sampled. */
	public prevMe:ExprEntity | undefined;
	public liveArc = false;
	protected now = 0;
	/** Who waits for game time to move on, woken by the next `stamp` that moves it. */
	private _timeWaiters:(()=>void)[] = [];
	/** Set while a new program waits for the step running now to end: told how it went, or `undefined` if it did not end clean. */
	private _handoff:((out:ArcResult | undefined)=>void) | undefined;
	/** Counts programs begun, so one that waited on a handoff can tell a later one took over. */
	private _programs = 0;

	/** The mind that thinks for this runner, or null when the host drives it. */
	public abstract get mind():Mind<TCtx> | null;

	/** The runner that acts for this one: a character itself, or a collective's commander. */
	public abstract get voice():ArcRunner<TCtx>;

	constructor(opts:RunnerOptions<TCtx>) {
		this.id = opts.id;
		this.verbs = opts.verbs;
		this.context = opts.context;
		this.execute = opts.execute;
		this.abortArc = opts.abortArc;
		this.pick = opts.pick;
		this.cooldown = opts.cooldown ?? DEFAULT_COOLDOWN;
		this.maxLaws = opts.maxLaws ?? DEFAULT_MAX_LAWS;
		this.defaultLawWho = opts.defaultLawWho ?? 'me';
		this.talk = opts.talk;
		this._goTo = opts.goTo;
		this.catalog = opts.catalog;
		this.kit = opts.kit;
		for (const spec of opts.laws ?? []) {
			const group = lawGroup(spec.name ?? '');
			if (!this.addLaw(spec, spec.pinned) && this.laws.filter((law) => lawGroup(law.name) === group).length >= this.maxLaws) {
				throw new Error(`${this.id}: law ${spec.name ?? spec.watch} is past its ${this.maxLaws} laws (maxLaws)`);
			}
		}
	}

	/** Whether it stands in the world itself, so it can speak and walk: a character, not a collective. */
	public abstract get embodied():boolean;

	/** Whether this runner speaks and acts for its mind: the arcs that mind writes run here. */
	public get isVoice():boolean {
		return this.mind?.voice === this;
	}

	/** Running an arc, or parked with a handler that may still fire. */
	public get busy():boolean {
		if (this.liveArc) {
			return true;
		}
		const session = this.arcSession;
		return !!session?.parked && (session.running.length > 0 || session.frames.some((f) => f.handlers.length > 0));
	}

	/** Resolve `kit` (object, getters, or callback). Director calls this each tick. A callback without a context grants nothing. */
	public refreshKit():Kit {
		const src = this.kit;
		if (typeof src !== 'function') {
			this.currentKit = src;
			return src;
		}
		try {
			const ctx = this.context();
			this.currentKit = ctx !== undefined ? src(ctx) : NO_KIT;
		}
		catch {
			this.currentKit = NO_KIT;
		}
		return this.currentKit;
	}

	/** Catalog filtered by the current kit, less `withheldVerbs`. */
	public activeVerbs():VerbRegistry {
		const off = this.withheldVerbs();
		const view = this.verbs.view(this.refreshKit().verbs.filter((name) => !off.includes(name)));
		if (this.lawsTakeWho() || !view.has('law')) {
			return view;
		}
		return view.withoutArg('law', 'who');
	}

	/**
	 * Verbs this runner never gets, whatever its kit says: every mind verb without a mind, the edits its persona
	 * forbids, and `choose` without a System One pick.
	 */
	protected withheldVerbs():readonly string[] {
		const choose = this.pick?.() ? [] : [CHOOSE_VERB];
		const persona = this.mind?.persona;
		if (!persona) {
			return [...MIND_ONLY_VERBS, ...choose];
		}
		return [
			...(persona.watchesWritable ? [] : WATCH_EDIT_VERBS),
			...(persona.sightFocusWritable ? [] : FOCUS_EDIT_VERBS),
			...choose,
		];
	}

	/** Whether `law` takes a `who`: only a collective's laws pick whom they reach. */
	public lawsTakeWho():boolean {
		return false;
	}

	public addLaw(spec:LawSpec, pinned = false):Law | undefined {
		const law = lawFromSpec(
			{ ...spec, pinned: pinned || spec.pinned },
			this.verbs,
			spec.name ?? `law_${this.laws.length + 1}`,
			this.defaultLawWho,
		);
		if (!law || !this.lawNameOK(law.name)) {
			return undefined;
		}
		this.laws = upsertLaw(this.laws, law, this.maxLaws);
		return this.laws.find((s) => s.name === law.name);
	}

	/**
	 * Keep `law` itself, not a copy, so an arc it started still counts as its own after a transfer.
	 * False when its name does not fit here or its group is full.
	 */
	protected keepLaw(law:Law):boolean {
		if (!this.lawNameOK(law.name)) {
			return false;
		}
		this.laws = upsertLaw(this.laws, law, this.maxLaws);
		return this.laws.includes(law);
	}

	/** Law names hold no `.`; a collective's member laws are the exception. */
	protected lawNameOK(name:string):boolean {
		return !name.includes('.');
	}

	public removeLaw(name:string):void {
		this.laws = dropLaw(this.laws, name);
	}

	public lawHandlers(matches?:(law:Law)=>boolean):ArcHandler[] {
		const out:ArcHandler[] = [];
		this.laws.forEach((law, i) => {
			if (matches && !matches(law)) {
				return;
			}
			out.push({
				source: law,
				watch: law.watch,
				arc: law.arc,
				rank: i,
				hold: law.hold,
				holdBreak: law.holdBreak,
			});
		});
		return out;
	}

	public beginLaw(handler:ArcHandler, sessionOpts?:ArcSessionOpts):void {
		if (this.arcSession && (this.liveArc || this.arcSession.parked)) {
			const finishing = this.finishStepOf(handler.arc);
			if (finishing) {
				void finishing.then((first) => {
					const rest = handler.arc.slice(1);
					if (first && rest.length > 0) {
						void this.enact(rest, handler, sessionOpts);
					}
				});
				return;
			}
			this.arcSession.pending = { kind: 'preempt', handler };
			this.arcSession.token += 1;
			this.abortArc?.(this.id);
			return;
		}
		void this.enact(handler.arc, handler, sessionOpts);
	}

	public stamp(now:number):void {
		if (now === this.now) {
			return;
		}
		this.now = now;
		const waiters = this._timeWaiters;
		this._timeWaiters = [];
		for (const wake of waiters) {
			wake();
		}
	}

	/**
	 * Run an arc (world verbs via `execute`). A new arc replaces the one running; a program (no `handler`) first waits
	 * out a law still inside its `hold`, since nothing but the law's own end stops it before then.
	 * `forceReplace` false: when the step running now is the arc's first step (same verb, same args), it is
	 * not restarted. It ends, and the arc goes on from its second step. A later program that takes over meanwhile wins.
	 */
	public async enact(
		arc:Arc,
		handler?:ArcHandler,
		sessionOpts?:ArcSessionOpts,
		forceReplace = false,
	):Promise<ArcResult> {
		const program = ++this._programs;
		if (!forceReplace) {
			const finishing = this.finishStepOf(arc);
			if (finishing) {
				const first = await finishing;
				if (program !== this._programs) {
					return { ok: false, preempted: true, verb: arc[0]?.verb ?? '' };
				}
				if (first) {
					arc = arc.slice(1);
				}
			}
		}
		while (!handler && this.arcSession && holding(this.arcSession)) {
			await new Promise<void>((resolve) => {
				this._timeWaiters.push(resolve);
			});
		}
		this.replaceProgram();
		this.record.clear();
		this.liveArc = true;
		this.arc = arc;
		// Busy is at its first step from the start, before that step runs: `doing(me, …)` never reads busy at nothing.
		this.verb = arc[0]?.verb ?? '';
		// A law's handler has a law as its source; a hoisted `when`'s is its step.
		this._law = handler && !('verb' in handler.source) ? handler.source.name : undefined;
		this.verbIndex = 0;
		this.onArcStart(arc);
		const session = createArcSession({
			verbs: this.verbs,
			now: () => this.now,
			nextTime: () => new Promise((resolve) => {
				this._timeWaiters.push(resolve);
			}),
			catalog: () => this.catalog?.(),
			abortHost: () => this.abortArc?.(this.id),
			pick: this.pick?.(),
			...sessionOpts,
		});
		this.arcSession = session;
		try {
			let i = 0;
			const result = await runArc(arc, async (step) => {
				this.verbIndex = i;
				this.verb = step.verb;
				i += 1;
				const out = await this.runStep(step, this.context());
				this.lastResult = out;
				// A step of a program already replaced is not the new program's.
				if (this.arcSession === session) {
					this.record.note(out);
				}
				const handoff = this._handoff;
				if (handoff) {
					this._handoff = undefined;
					// The step ended clean: the waiting program takes over now, before this one's next step starts.
					if (this.arcSession === session && out.ok && !session.pending) {
						this.replaceProgram();
						handoff(out);
					}
					else {
						handoff(undefined);
					}
				}
				return out;
			}, { session, asHandler: handler });
			if (this.arcSession !== session) {
				return result;
			}
			this.verb = '';
			if (session.parked) {
				this.liveArc = false;
				this.onArcEnd();
				return result;
			}
			await this.afterArc(result);
			if (this.arcSession !== session) {
				return result;
			}
			this.onArcResult(result);
			return result;
		}
		finally {
			if (this.arcSession === session && !session.parked) {
				this.liveArc = false;
				this.arcSession = null;
				this.arc = null;
				this.verb = '';
				this.onArcEnd();
			}
		}
	}

	/**
	 * When the step running now is `arc`'s first: the result of that step once it ended and this program was stopped
	 * there (`undefined` if it did not end clean, so `arc` runs whole). `undefined` when there is nothing to wait for.
	 */
	private finishStepOf(arc:Arc):Promise<ArcResult | undefined> | undefined {
		const session = this.arcSession;
		const running = this.verb ? this.lastStep : undefined;
		if (!session || !this.liveArc || session.parked || !running || !arc[0] || formatStep(running) !== formatStep(arc[0])) {
			return undefined;
		}
		this._handoff?.(undefined);
		return new Promise((resolve) => {
			this._handoff = resolve;
		});
	}

	/** Stop the running arc, if any, and the host's part of it. */
	public replaceProgram():void {
		const handoff = this._handoff;
		this._handoff = undefined;
		handoff?.(undefined);
		if (this.arcSession) {
			this.arcSession.token += 1;
			this.arcSession.pending = { kind: 'abort' };
			this.arcSession.abortHost?.();
		}
		this.abortArc?.(this.id);
		this.arcSession = null;
		this.arc = null;
		this.verb = '';
		this.liveArc = false;
		this.onArcEnd();
	}

	/**
	 * One step outside an arc, for hosts that run arcs themselves. `granted`: run it though the kit lacks it, as an
	 * alias's own step does (granting the alias grants what it runs).
	 */
	public async perform(step:Step, ctx:TCtx | undefined = this.context(), granted = false):Promise<ArcResult> {
		return this.runStep(step, ctx, granted);
	}

	public toJSON():ArcRunnerJSON {
		return {
			id: this.id,
			lastResult: this.lastResult ? { ...this.lastResult } : undefined,
			liveArc: this.liveArc,
			laws: this.laws.map((s) => ({ ...s, arc: s.arc })),
			maxLaws: this.maxLaws,
			cooldown: this.cooldown,
			prevMe: this.prevMe ? cloneEntity(this.prevMe) : undefined,
		};
	}

	protected loadJSON(json:ArcRunnerJSON):void {
		this.lastResult = json.lastResult;
		this.liveArc = json.liveArc;
		if (json.maxLaws !== undefined) {
			this.maxLaws = json.maxLaws;
		}
		if (json.cooldown !== undefined) {
			this.cooldown = json.cooldown;
		}
		this.prevMe = prevMeFromJSON(json.prevMe);
		if (json.laws) {
			this.laws = json.laws.filter((law) => isArc(law.arc)).map((law) => ({ ...law }));
		}
	}

	/** One step of a running arc: mind verbs through the mind, `say` through talk, the rest through the host. */
	protected async runStep(step:Step, ctx:TCtx | undefined, granted = false):Promise<ArcResult> {
		this.lastStep = step;
		if (!granted && !step.granted && !this.activeVerbs().has(step.verb)) {
			// Its kit grants it, but it has no body to run it with.
			return !this.embodied && this.currentKit.verbs.includes(step.verb)
				? bodiless(step.verb)
				: { ok: false, verb: step.verb, reason: `verb '${step.verb}' is not available` };
		}
		const done = await this.mind?.perform(step, this);
		const out = done
			?? (step.verb === 'say' && this.talk
				? await this.speak(step)
				: this.execute
					? await this.execute(step, ctx)
					: { ok: false, verb: step.verb, reason: `host has no executor for ${step.verb}` });
		if (!(STOCK_MOVE_VERBS as readonly string[]).includes(step.verb)) {
			this.replies += 1;
		}
		if (out.ok && this.isVoice) {
			this.mind!.noteReply(step, out, this);
		}
		return out;
	}

	/** `say` through talk, walking up to whoever it is said to first. Only call with talk attached. */
	public async speak(step:Step):Promise<SayResult> {
		const to = sayToOf(step.args);
		const talk = this.talk!;
		// Close enough to talk is where they make out every word, wherever that is for the host.
		for (const id of [to ?? []].flat()) {
			const near = await this._goTo?.(id, { check: () => (talk.canSay(this.id, id).ok && talk.clear(this.id, id) ? 'in earshot' : undefined) });
			if (near && !near.ok) {
				return { ...near, verb: 'say' };
			}
		}
		return this.talk!.say(this.id, String(step.args.text ?? ''), to, this.now);
	}

	/** An arc began. A voice tells its mind. */
	protected onArcStart(arc:Arc):void {
		if (this.isVoice) {
			this.mind!.arcStarted(arc);
		}
	}

	/** The running arc stopped or parked. A voice tells its mind. */
	protected onArcEnd():void {
		if (this.isVoice) {
			this.mind!.arcEnded();
		}
	}

	/** After the last step, while the arc is still live (a new think can still abort it). */
	protected async afterArc(result:ArcResult):Promise<void> {
		if (this.isVoice) {
			await this.mind!.afterArc(result, this);
		}
	}

	/**
	 * The arc finished. A voice's mind turns this into an event for its next think; an arc one of its laws started
	 * goes to the mind as that law's result instead.
	 */
	protected onArcResult(result:ArcResult):void {
		this.lastResult = result;
		this.liveArc = false;
		if (!this.isVoice) {
			return;
		}
		if (this._law) {
			this.mind!.ingestLawResult(this._law, result);
		}
		else {
			this.mind!.ingestResult(result);
		}
	}
}

/** Why a runner with no body of its own (a collective with no commander) cannot run `verb` itself. */
export function bodiless(verb:string):ArcResult {
	return { ok: false, verb, reason: `you are not a character in this scene; issue ${verb} to one of your characters` };
}

/** Addressee ids of a `say`. */
export function sayToOf(args:Step['args']):SayTo | undefined {
	const to = args.to;
	if (Array.isArray(to)) {
		const ids = to.filter((x):x is string => typeof x === 'string' && x.trim().length > 0);
		return ids.length > 0 ? ids : undefined;
	}
	return typeof to === 'string' && to.trim() ? to : undefined;
}
