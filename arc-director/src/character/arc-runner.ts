import { CHOOSE_VERB, FOCUS_EDIT_VERBS, MIND_ONLY_VERBS, WATCH_EDIT_VERBS, type VerbRegistry } from '../arc/stock-verbs.js';
import type { Arc, ArcResult, Step } from '../arc/types.js';
import type { Catalog, ExprEntity } from '../expr/types.js';
import { cloneEntity, prevMeFromJSON } from '../expr/prev.js';
import {
	DEFAULT_MAX_LAWS,
	dropLaw,
	lawFromSpec,
	upsertLaw,
	type Law,
	type LawSpec,
} from '../arc/laws.js';
import {
	runArc,
	createArcSession,
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
	public catalog?:()=>Catalog | undefined;
	/** Object or callback. Assign a new one any time. Fetched every tick. */
	public kit:KitSource<TCtx>;
	/** The kit as of the last refresh. */
	public currentKit:Kit = NO_KIT;
	public lastResult:ArcResult | undefined;
	/** How the current program is going, step by step and pick by pick. A new program clears it. */
	public readonly record = new ArcRecord();
	/** The arc running now, or parked on its `when`s. */
	public arc:Arc | null = null;
	/** The verb of the step running now; `''` between steps. */
	public verb = '';
	/** Index of the step currently running inside `enact` (0-based). */
	public verbIndex = 0;
	/** Self as `prev.me` sees it: at its mind's last think, else as first sampled. */
	public prevMe:ExprEntity | undefined;
	public liveArc = false;
	protected now = 0;

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
		this.catalog = opts.catalog;
		this.kit = opts.kit;
		for (const spec of opts.laws ?? []) {
			this.addLaw(spec, spec.pinned);
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
			});
		});
		return out;
	}

	public beginLaw(handler:ArcHandler, sessionOpts?:ArcSessionOpts):void {
		if (this.arcSession && (this.liveArc || this.arcSession.parked)) {
			this.arcSession.pending = { kind: 'preempt', handler };
			this.arcSession.token += 1;
			this.abortArc?.(this.id);
			return;
		}
		void this.enact(handler.arc, handler, sessionOpts);
	}

	public stamp(now:number):void {
		this.now = now;
	}

	/** Run an arc (world verbs via `execute`). A new arc replaces the one running. */
	public async enact(
		arc:Arc,
		handler?:ArcHandler,
		sessionOpts?:ArcSessionOpts,
	):Promise<ArcResult> {
		this.replaceProgram();
		this.record.clear();
		this.liveArc = true;
		this.arc = arc;
		this.verbIndex = 0;
		this.onArcStart(arc);
		const session = createArcSession({
			verbs: this.verbs,
			now: () => this.now,
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

	/** Stop the running arc, if any, and the host's part of it. */
	public replaceProgram():void {
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

	/** One step outside an arc, for hosts that run arcs themselves. */
	public async perform(step:Step, ctx:TCtx | undefined = this.context()):Promise<ArcResult> {
		return this.runStep(step, ctx);
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
			this.laws = json.laws.map((s) => ({ ...s }));
		}
	}

	/** One step of a running arc: mind verbs through the mind, `say` through talk, the rest through the host. */
	protected async runStep(step:Step, ctx:TCtx | undefined):Promise<ArcResult> {
		if (!this.activeVerbs().has(step.verb)) {
			// Its kit grants it, but it has no body to run it with.
			return !this.embodied && this.currentKit.verbs.includes(step.verb)
				? bodiless(step.verb)
				: { ok: false, verb: step.verb, reason: `verb '${step.verb}' is not available` };
		}
		const done = await this.mind?.perform(step, this);
		if (done) {
			return done;
		}
		if (step.verb === 'say' && this.talk) {
			return this.speak(step);
		}
		if (!this.execute) {
			return { ok: false, verb: step.verb, reason: `host has no executor for ${step.verb}` };
		}
		return this.execute(step, ctx);
	}

	/** `say` through talk. Only call with talk attached. */
	public speak(step:Step):SayResult {
		return this.talk!.say(this.id, String(step.args.text ?? ''), sayToOf(step.args), this.now);
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

	/** The arc finished. A voice's mind turns this into an event for its next think. */
	protected onArcResult(result:ArcResult):void {
		this.lastResult = result;
		this.liveArc = false;
		if (this.isVoice) {
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
