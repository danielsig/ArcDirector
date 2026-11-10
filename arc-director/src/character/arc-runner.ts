import { CHOOSE_VERB, FOCUS_EDIT_VERBS, groupTargets, MIND_ONLY_VERBS, STOCK_MOVE_VERBS, WATCH_EDIT_VERBS, type VerbRegistry } from '../arc/stock-verbs.js';
import { formatStep } from '../arc/arc-parse.js';
import { arcSteps, isArc, sameProgram, type Arc, type ArcResult, type Step } from '../arc/arc-types.js';
import type { Catalog, ExprEntity } from '../expr/expr-types.js';
import { cloneEntity, prevMeFromJSON } from '../expr/prev.js';
import {
	DEFAULT_MAX_LAWS,
	dropLaw,
	lawFinished,
	lawFromSpec,
	lawGroup,
	lawHandler,
	upsertLaw,
	type Law,
	type LawSpec,
} from '../arc/laws.js';
import {
	runArc,
	createArcSession,
	handlerFinished,
	holding,
	DEFAULT_COOLDOWN,
	type ArcHandler,
	type ArcPick,
	type ArcSession,
	type ArcSessionOpts,
} from '../arc/run.js';
import type { Mind } from '../mind/mind.js';
import { ArcRecord } from './ArcRecord.js';
import { Persona, type PersonaJSON } from './Persona.js';
import type { SayResult, SayTo, TalkNet } from '../mind/talk.js';
import type { Kit, KitSource } from './character-types.js';
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
	/** Game seconds a law or `when` that used the body and failed waits before it tries again. Default 8. */
	cooldown?:number;
	talk?:TalkNet;
	/** Walk this runner up to `target`, as `VerbCall.goTo` does. */
	goTo?:(target:string, opts?:MoveOpts)=>Promise<ArcResult>;
	/** `step` with its group arg read (`VerbDef.group`): the ids of a list, the id of one, as it was for a name, or why it picks no one. */
	aimGroup?:(step:Step)=>Step | ArcResult;
	/** The walk that takes this runner near the group `ids` for `verb`, or undefined when it is near already or the host says not to. */
	walkToGroup?:(verb:string, ids:readonly string[], opts?:MoveOpts)=>(()=>Promise<ArcResult>) | undefined;
	/** The watch-language view of the world from this runner now, or undefined when it has none. */
	catalog?:()=>Catalog | undefined;
	/** What it may use. Object or callback, fetched every tick, so the host can mutate it in place. */
	kit:KitSource<TCtx>;
	/** Its System One pick now, or undefined while it has none; without one, `choose` is withheld. */
	pick?:()=>ArcPick | undefined;
};

export type RunnerOptions<TCtx = unknown> = RunnerDeps<TCtx> & {
	id:string;
	persona?:Persona;
	laws?:LawSpec[];
	maxLaws?:number;
	defaultLawWho?:string;
};

/** A runner's part of a save: its persona, its laws and how its last arc went. */
export type ArcRunnerJSON = {
	id:string;
	persona:PersonaJSON;
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
	/** Who it is: identity, goals, memory, watches. Its mind thinks as this persona. */
	public readonly persona:Persona;
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
	private readonly _aimGroup:RunnerDeps['aimGroup'];
	private readonly _walkToGroup:RunnerDeps['walkToGroup'];
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
	/** The program its commander issued it, while that runs. */
	public orders:Promise<ArcResult> | undefined;
	protected now = 0;
	/** Who waits for game time to move on, woken by the next `stamp` that moves it. */
	private _timeWaiters:(()=>void)[] = [];
	/** Set while a new program waits for the step running now to end: told how it went, or `undefined` if it did not end clean. */
	private _handoff:((out:ArcResult | undefined)=>void) | undefined;
	/** Counts programs begun, so one that waited on a handoff can tell a later one took over. */
	private _programs = 0;
	/** What was appended to the program under way, for after its end. */
	private _appended:Arc = [];

	/** The mind that thinks for this runner, or null when the host drives it. */
	public abstract get mind():Mind<TCtx> | null;

	/** The runner that acts for this one: a character itself, or a collective's commander. */
	public abstract get voice():ArcRunner<TCtx>;

	constructor(opts:RunnerOptions<TCtx>) {
		this.id = opts.id;
		this.persona = opts.persona ?? new Persona();
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
		this._aimGroup = opts.aimGroup;
		this._walkToGroup = opts.walkToGroup;
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
		return !!session?.parked && (session.running.length > 0 || session.frames.some((f) => f.handlers.some((h) => !handlerFinished(h))));
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

	/** Drops each law finished for all `reached` says it reaches now. Pinned ones too: it ended by its own terms. */
	public dropFinishedLaws(reached:(law:Law)=>readonly string[]):void {
		this.laws = this.laws.filter((law) => !lawFinished(law, () => reached(law)));
	}

	public lawHandlers(matches?:(law:Law)=>boolean):ArcHandler[] {
		const out:ArcHandler[] = [];
		this.laws.forEach((law, i) => {
			if (matches && !matches(law)) {
				return;
			}
			out.push(lawHandler(law, i, this.id));
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
		if (!handler && !forceReplace && this.runs(arc)) {
			return { ok: true, verb: arc[0]?.verb ?? '' };
		}
		if (!handler && !forceReplace && this.liveArc && this.takesNoBody(arc)) {
			return this.runBeside(arc);
		}
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
			cooldown: this.cooldown,
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
			const run = async (step:Step):Promise<ArcResult> => {
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
			};
			let result = await runArc(arc, run, { session, asHandler: handler });
			while (result.ok && this._appended.length > 0 && this.arcSession === session) {
				result = await runArc(this._appended.splice(0), run, { session });
			}
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

	/** Whether `arc` is the program it runs already, for all its wording: a law's arc is not its program. */
	public runs(arc:Arc):boolean {
		return this.liveArc && !this._law && !!this.arc && sameProgram(this.arc, arc);
	}

	/** Whether every step of `arc` can run without the body the program under way is using. */
	public takesNoBody(arc:Arc):boolean {
		return arcSteps(arc).every((step) => {
			if (!this.verbs.get(step.verb)?.free) {
				return false;
			}
			// A bare wait says nothing needs to change; a wait for something stands still until then.
			if (step.verb === 'wait' && Object.keys(step.args).length > 0) {
				return false;
			}
			const aimed = this.aimGroup(step);
			// It picks no one: it fails where it stands.
			if ('ok' in aimed) {
				return true;
			}
			const group = groupTargets(aimed, this.verbs);
			if (group) {
				return !this.groupWalk(aimed.verb, group);
			}
			// Said to someone out of earshot, it walks over first.
			return aimed.verb !== 'say' || [sayToOf(aimed.args) ?? []].flat().every((id) => this.inEarshot(id));
		});
	}

	/** `step` with its group arg read (`VerbDef.group`): ids for a list, or why it picks no one. Any other step comes back as it is. */
	public aimGroup(step:Step):Step | ArcResult {
		return this._aimGroup?.(step) ?? step;
	}

	/** Whether `id` makes out every word it says from here. */
	private inEarshot(id:string):boolean {
		return !!this.talk?.canSay(this.id, id).ok && this.talk.clear(this.id, id);
	}

	/** The walk it takes before `verb` acts on the group `ids`, if any. A line everyone already makes out takes none. */
	private groupWalk(verb:string, ids:readonly string[]):(()=>Promise<ArcResult>) | undefined {
		const heard = verb === 'say' ? ():string | undefined => (ids.every((id) => this.inEarshot(id)) ? 'in earshot' : undefined) : undefined;
		return heard?.() ? undefined : this._walkToGroup?.(verb, ids, heard && { check: heard });
	}

	/** `arc` beside the program under way, which it neither stops nor counts as its own. There is nothing to wait for: the program goes on. */
	private async runBeside(arc:Arc):Promise<ArcResult> {
		const session = createArcSession({
			verbs: this.verbs,
			now: () => this.now,
			nextTime: () => new Promise((resolve) => {
				this._timeWaiters.push(resolve);
			}),
			catalog: () => this.catalog?.(),
		});
		const result = await runArc(arc, (step) => (step.verb === 'wait' ? Promise.resolve({ ok: true, verb: 'wait' }) : this.doStep(step, this.context(), !!step.granted)), { session });
		if (this.isVoice) {
			this.mind!.ingestBeside(result);
		}
		return result;
	}

	/**
	 * Adds `steps` to the program under way, which goes on: inside the loop it would never leave, else after its end.
	 * False when it runs no program of its own to add to, as when one has just ended or a law has its body.
	 */
	public append(steps:Arc):boolean {
		if (!this.liveArc || !this.arc || this._law) {
			return false;
		}
		const inside = endlessBody(this.arc);
		if (inside) {
			inside.push(...structuredClone(steps));
			return true;
		}
		// The very steps that run: what they have done so far is kept by step.
		const copy = structuredClone(steps);
		this._appended.push(...copy);
		this.arc = [...this.arc, ...copy];
		return true;
	}

	/** Whether the program under way loops. */
	public inLoop():boolean {
		return !!this.arc && arcSteps(this.arc).some((step) => step.verb === 'loop');
	}

	/**
	 * What its program still owes, in words, if it is one a think or a commander gave it that has not finished, nor gone
	 * once round its loops: where it is, and how many times round each loop.
	 */
	public unfinished():string | undefined {
		const session = this.arcSession;
		if (!this.liveArc || !session || !this.arc || this._law || !(this.orders || this.isVoice)) {
			return undefined;
		}
		const loops = arcSteps(this.arc).filter((step) => step.verb === 'loop').map((step) => session.passes.get(step) ?? 0);
		if (loops.length > 0 && loops.every((passes) => passes > 0)) {
			return undefined;
		}
		const at = this.lastStep ? formatStep(this.lastStep, this.verbs) : 'starting';
		return loops.length > 0
			? `at ${at}, its loop${endlessBody(this.arc) ? ', which has no exit,' : ''} round ${loops.join(' and ')} times`
			: `at ${at}, step ${Math.min(this.verbIndex + 1, this.arc.length)} of ${this.arc.length}`;
	}

	/** Stop the running arc, if any, and the host's part of it. */
	public replaceProgram():void {
		const handoff = this._handoff;
		this._handoff = undefined;
		handoff?.(undefined);
		this._appended = [];
		if (this.arcSession?.parked) {
			this.orders = undefined;
		}
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
			persona: this.persona.toJSON(),
			lastResult: this.lastResult ? { ...this.lastResult } : undefined,
			liveArc: this.liveArc,
			laws: this.laws.map((law) => structuredClone(law)),
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
			this.laws = json.laws.filter((law) => isArc(law.arc)).map((law) => structuredClone(law));
		}
	}

	/** One step of a running arc: mind verbs through the mind, `say` through talk, the rest through the host. */
	protected async runStep(step:Step, ctx:TCtx | undefined, granted = false):Promise<ArcResult> {
		this.lastStep = step;
		return this.doStep(step, ctx, granted);
	}

	private async doStep(step:Step, ctx:TCtx | undefined, granted:boolean):Promise<ArcResult> {
		if (!granted && !step.granted && !this.activeVerbs().has(step.verb)) {
			// Its kit grants it, but it has no body to run it with.
			return !this.embodied && this.currentKit.verbs.includes(step.verb)
				? bodiless(step.verb)
				: { ok: false, verb: step.verb, reason: `verb '${step.verb}' is not available` };
		}
		const aimed = this.aimGroup(step);
		if ('ok' in aimed) {
			return aimed;
		}
		const done = await this.mind?.perform(aimed, this);
		const out = done ?? (aimed.verb === 'say' && this.talk ? await this.speak(aimed) : await this.hostStep(aimed, ctx));
		if (!(STOCK_MOVE_VERBS as readonly string[]).includes(aimed.verb)) {
			this.replies += 1;
		}
		if (out.ok && this.isVoice) {
			this.mind!.noteReply(aimed, out, this);
		}
		return out;
	}

	/** A step through the host, once it has walked near the group it is aimed at, if it is. */
	private async hostStep(step:Step, ctx:TCtx | undefined):Promise<ArcResult> {
		if (!this.execute) {
			return { ok: false, verb: step.verb, reason: `host has no executor for ${step.verb}` };
		}
		const group = groupTargets(step, this.verbs);
		const near = group && await this.groupWalk(step.verb, group)?.();
		return near && !near.ok ? { ...near, verb: step.verb } : this.execute(step, ctx);
	}

	/** `say` through talk, walking up to whoever it is said to first. Only call with talk attached. */
	public async speak(step:Step):Promise<SayResult> {
		const group = groupTargets(step, this.verbs);
		if (group) {
			return this.speakToGroup(step, group);
		}
		const to = sayToOf(step.args);
		// Close enough to talk is where they make out every word, wherever that is for the host.
		for (const id of [to ?? []].flat()) {
			const near = await this._goTo?.(id, { check: () => (this.inEarshot(id) ? 'in earshot' : undefined) });
			if (near && !near.ok) {
				return { ...near, verb: 'say' };
			}
		}
		return this.talk!.say(this.id, String(step.args.text ?? ''), to, this.now);
	}

	/** One line to `ids`, from near them if it may walk. It reaches whoever of them is in earshot, and says who was not. */
	private async speakToGroup(step:Step, ids:readonly string[]):Promise<SayResult> {
		const talk = this.talk!;
		const near = await this.groupWalk('say', ids)?.();
		if (near?.interrupted) {
			return { ...near, verb: 'say' };
		}
		const reached = ids.filter((id) => talk.canSay(this.id, id).ok);
		if (reached.length === 0) {
			return near && !near.ok ? { ...near, verb: 'say' } : { ok: false, verb: 'say', reason: 'none of them is in earshot' };
		}
		const said = talk.say(this.id, String(step.args.text ?? ''), reached, this.now);
		const missed = ids.filter((id) => !reached.includes(id)).map((id) => this.mind?.nameOf(id) ?? id);
		return said.ok && missed.length > 0 ? { ...said, reason: `${said.reason}; out of earshot: ${missed.join(', ')}` } : said;
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

/** The steps of the loop `arc` would never leave, the innermost if one is the next: nothing after it ever runs. */
function endlessBody(arc:Arc):Arc | undefined {
	const loop = arcSteps(arc).find((step) => step.verb === 'loop' && isArc(step.args.arc) && !step.args.until && !step.args.through && step.args.times === undefined);
	return loop && (endlessBody(loop.args.arc as Arc) ?? loop.args.arc as Arc);
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
