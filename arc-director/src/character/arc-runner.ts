import { showNamingText } from './text-with-ids.js';
import { channelOf, CHOOSE_VERB, impactOf, FOCUS_EDIT_VERBS, groupTargets, INSTEAD_VERB, isFree, MIND_ONLY_VERBS, PASS_VERB, STOCK_MOVE_VERBS, WATCH_EDIT_VERBS, WHILE_ARG, type VerbRegistry } from '../arc/stock-verbs.js';
import { formatStep } from '../arc/arc-format.js';
import { arcSteps, insteadOf, isArc, resultFromJSON, resultToJSON, sameProgram, type Arc, type ArcResult, type ArcResultJSON, type Step } from '../arc/arc-types.js';
import { hand, internalsOf } from '../internals.js';
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
	interruptArc,
	createArcSession,
	handlerFinished,
	DEFAULT_COOLDOWN,
	type ArcHandler,
	type ArcPick,
	type ArcSession,
	type ArcSessionOpts,
} from '../arc/run.js';
import { drive, restoreArc, runArc, startArc, type ArcMachine, type ArcMachineJSON, type Program } from '../arc/arc-machine.js';
import type { Mind } from '../mind/mind.js';
import type { MindEvent } from '../mind/mind-types.js';
import { ArcRecord } from './ArcRecord.js';
import { Persona, type PersonaJSON } from './Persona.js';
import type { SayResult, SayTo, SayTone } from '../mind/talk.js';
import type { TalkFeature } from '../mind/TalkFeature.js';
import type { Kit, KitSource } from './character-types.js';
import type { MoveOpts } from '../world/mover.js';

/**
 * How a new program meets the one running (`ArcRunner.enact`): `merge`d where it aligns with it, else replacing it;
 * merged, else added after it (`append`), as a mind's reply is; or replacing it whatever it says.
 */
export type Meet = 'merge' | 'append' | 'replace';

/** A program's own steps as they run: what is added to it goes there. */
type Chain = NonNullable<ReturnType<ArcMachine['root']>>;

/** What a runner has while its kit cannot be read: a callback kit with no context. */
const NO_KIT:Kit = Object.freeze({ verbs: [] });

/** What a runner needs from its host to run arcs. */
export type RunnerDeps<TCtx = unknown> = {
	verbs:VerbRegistry;
	context:()=>TCtx | undefined;
	/** One host step, acted by this runner itself; `signal` aborts when its `until` or `within` stops it. */
	execute?:(step:Step, ctx:TCtx | undefined, signal?:AbortSignal)=>Promise<ArcResult>;
	abortArc?:(id:string)=>void;
	/** Game seconds a standing `choose` that failed waits before it picks again. Default 8. */
	cooldown?:number;
	/** Talk, while there is any: `say` goes through it. Asked each time, so talk added later is heard. */
	talk?:()=>TalkFeature<TCtx> | undefined;
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

/** What a runner's constructor hands the director (`internalsOf`): what only its ticks call. */
export type RunnerFields<TCtx> = {
	/** Game time now, and when the watches were last asked: what its waits and laws go by. */
	stamp(now:number, watchedAt?:number):void;
	/** A handler for each of its own laws, by rank. */
	lawHandlers():ArcHandler[];
	/** Start what `handler` holds, with no arc running: a running one's session lets its laws in itself. */
	beginLaw(handler:ArcHandler, sessionOpts?:ArcSessionOpts):void;
	/** Drop each law finished for all `reached` says it reaches now. Pinned ones too: it ended by its own terms. */
	dropFinishedLaws(reached:(law:Law)=>readonly string[]):void;
};

/** A runner's part of a save: its persona, its laws and how its last arc went. */
export type ArcRunnerJSON = {
	id:string;
	persona:PersonaJSON;
	lastResult?:ArcResultJSON;
	liveArc:boolean;
	laws?:Law[];
	maxLaws?:number;
	cooldown?:number;
	prevMe?:ExprEntity;
	/** The program it ran when saved, and where in it: it goes on from there once loaded. */
	program?:SavedProgram;
};

/** A program saved as it ran: its arc, and its machine's state. */
export type SavedProgram = Program & { machine:ArcMachineJSON };

/** What holds a program's step while a reaction runs over it: a law by its name, or a `when` by its watch. */
export type Holder = { law:string } | { when:string };

/**
 * A step a runner is on now and for how many seconds: its program's, held while a reaction runs over it (`heldBy`),
 * or a `when`'s, inside that program. A list, so a runner doing several things at once can show each.
 */
export type ProgramMark = { step:Step; seconds:number; heldBy?:Holder; channel?:string };

/**
 * The program a runner runs now, or ran last: how long it has run, the steps it is on, a law running over it, or how
 * it ended. Prompts show it, so a mind can see a program still works and leave it be.
 */
export type ProgramState = {
	arc:Arc;
	running:boolean;
	seconds:number;
	marks:ProgramMark[];
	/** A law running now, over the program or with none, and the step it is on. */
	law?:{ name:string; step?:Step };
	result?:ArcResult;
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
	/** The verbs it parses and runs; its kit picks the ones it may use. The director swaps it on `withVerbs`. */
	public verbs:VerbRegistry;
	public readonly context:()=>TCtx | undefined;
	public readonly execute?:(step:Step, ctx:TCtx | undefined, signal?:AbortSignal)=>Promise<ArcResult>;
	public readonly abortArc?:(id:string)=>void;
	public readonly pick?:()=>ArcPick | undefined;
	public cooldown:number;
	public laws:Law[] = [];
	public maxLaws:number;
	protected defaultLawWho:string;
	public arcSession:ArcSession | null = null;
	private readonly _talk:RunnerDeps<TCtx>['talk'];
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
	/** Game time its director last asked watches at: its programs' races and parked `when`s are asked then. */
	protected watchedAt:number | undefined;
	/** Who waits for game time to move on, woken by the next `stamp` that moves it. */
	private readonly _timeWaiters:(()=>void)[] = [];
	/** Programs waiting for a law to end, woken whenever a reaction stops. */
	private readonly _lawWaiters:(()=>void)[] = [];
	/** The program it last began, and the game second it began: kept once it ends, for {@link programState}. */
	private _program:{ arc:Arc; since:number } | undefined;
	/** The step of its program it was last on per channel, and since when: held there while a reaction runs. */
	private readonly _programSteps = new Map<string, { step:Step; since:number }>();
	/** The steps of its program that ran, each once: what {@link ranImpact} counts. */
	private readonly _ran = new Set<Step>();
	/** The step a reaction running over its program is on, and since when. */
	private _reactionStep:{ step:Step; since:number } | undefined;
	/** Set while a new program waits for the step running now to end: told how it went, or `undefined` if it did not end clean. */
	private _handoff:{ step:Step; done:(out:ArcResult | undefined)=>void } | undefined;
	/** Counts programs begun, so one that waited on a handoff can tell a later one took over. */
	private _programs = 0;
	/** What runs its program now, or watches the `when`s it left parked. */
	private _machine:ArcMachine | undefined;
	/** A program loaded with it, to go on with at its next tick. */
	private _resume:SavedProgram | undefined;
	/** The game second it last ran each verb well: its cooldowns count from there. */
	private readonly _ranAt = new Map<string, number>();

	/** The mind that thinks for this runner, or null when the host drives it. */
	public abstract get mind():Mind<TCtx> | null;

	/** The runner that acts for this one: a character itself, or a collective's commander. */
	public abstract get voice():ArcRunner<TCtx>;

	/** The runner whose mind thinks for this one: a character's collective, else itself when it has a mind; none when the host drives it. */
	public abstract get owner():ArcRunner<TCtx> | undefined;

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
		this._talk = opts.talk;
		this._goTo = opts.goTo;
		this._aimGroup = opts.aimGroup;
		this._walkToGroup = opts.walkToGroup;
		this.catalog = opts.catalog;
		this.kit = opts.kit;
		hand(this, {
			stamp: (now, watchedAt) => this.stamp(now, watchedAt),
			lawHandlers: () => this.lawHandlers(),
			beginLaw: (handler, sessionOpts) => void this.enact(handler.arc, handler, sessionOpts),
			dropFinishedLaws: (reached) => {
				this.laws = this.laws.filter((law) => !lawFinished(law, () => reached(law)));
			},
		} satisfies RunnerFields<TCtx>);
		for (const spec of opts.laws ?? []) {
			const group = lawGroup(spec.name ?? '');
			if (!this.addLaw(spec, spec.pinned) && this.laws.filter((law) => lawGroup(law.name) === group).length >= this.maxLaws) {
				throw new Error(`${this.id}: law ${spec.name ?? spec.watch} is past its ${this.maxLaws} laws (maxLaws)`);
			}
		}
	}

	private talk():TalkFeature<TCtx> | undefined {
		return this._talk?.();
	}

	/** Whether it stands in the world itself, so it can speak and walk: a character, not a collective. */
	public abstract get embodied():boolean;

	/** Tell the mind that thinks for this runner. A major event wakes it. */
	public tell(event:MindEvent):void {
		this.mind?.pushEvent(event);
	}

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
		const laws = this.lawsTakeWho() || !view.has('law') ? view : view.withoutArg('law', 'who');
		return this.mind?.setting('offerAppendedCommands') || !laws.has('command') ? laws : laws.withoutArg('command', 'append');
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

	/** A handler for each of its own laws, by rank. */
	private lawHandlers():ArcHandler[] {
		return this.laws.map((law, i) => lawHandler(law, i, this.id));
	}

	/** Resolves once game time moves on: at the next `stamp` that moves it. */
	public nextTime():Promise<void> {
		return new Promise((resolve) => {
			this._timeWaiters.push(resolve);
		});
	}

	private stamp(now:number, watchedAt?:number):void {
		this.watchedAt = watchedAt;
		const moved = now !== this.now;
		this.now = now;
		const resume = this._resume;
		this._resume = undefined;
		if (resume) {
			void this.enact(resume.work, undefined, undefined, 'replace', resume).catch(() => {
				this.liveArc = false;
			});
		}
		if (moved) {
			this._timeWaiters.splice(0).forEach((wake) => wake());
		}
	}

	/**
	 * Run an arc (world verbs via `execute`). A program (no `handler`) meets the one running as `meet` says: by default
	 * it is merged into it where it aligns with it (`merge`), else replaces it; it first waits for a law running now to
	 * end, since a law outranks any program. Unless it replaces it whatever it says, when the step running now is the
	 * arc's first step (same verb, same args), it is not restarted. It ends, and the arc goes on from its second step. A
	 * later program that takes over meanwhile wins.
	 * `resume`: a saved program, which goes on from where it was saved.
	 */
	public async enact(
		arc:Arc,
		handler?:ArcHandler,
		sessionOpts?:ArcSessionOpts,
		meet:Meet = 'merge',
		resume?:SavedProgram,
		open = false,
	):Promise<ArcResult> {
		// Nothing runs to merge into: it starts at once, before this call returns.
		if (!handler && meet !== 'replace' && !resume && this.liveArc) {
			const merged = await this.merge(arc, meet === 'append');
			if (!Array.isArray(merged)) {
				return merged;
			}
			arc = merged;
		}
		const program = ++this._programs;
		if (meet !== 'replace') {
			const finishing = this.finishStepOf(arc);
			if (finishing) {
				const first = await finishing;
				if (program !== this._programs) {
					return { status: 'stopped', verb: arc[0]?.verb ?? '' };
				}
				if (first) {
					arc = arc.slice(1);
				}
			}
		}
		while (!handler && this.lawRunning()) {
			await new Promise<void>((resolve) => {
				this._lawWaiters.push(resolve);
			});
			if (program !== this._programs) {
				return { status: 'stopped', verb: arc[0]?.verb ?? '' };
			}
		}
		this.replaceProgram();
		this.record.clear();
		this.liveArc = true;
		this.arc = arc;
		if (!handler) {
			this._program = { arc, since: this.now };
			this._programSteps.clear();
			this._ran.clear();
		}
		// Busy is at its first step from the start, before that step runs: `doing(me, …)` never reads busy at nothing.
		this.verb = arc[0]?.verb ?? '';
		// A law's handler has a law as its source; a hoisted `when`'s is its step.
		this._law = handler && !('verb' in handler.source) ? handler.source.name : undefined;
		this.verbIndex = 0;
		if (this.isVoice) {
			this.talk()?.forgetReplies(this);
			internalsOf(this.mind!).arcStarted(arc);
		}
		const session = this.session({
			abortHost: () => this.abortArc?.(this.id),
			onReactionEnd: () => {
				this._lawWaiters.splice(0).forEach((wake) => wake());
			},
			onStepRun: (step) => {
				if (this.arcSession === session && !this._law && !this.lawRunning()) {
					this._ran.add(step);
				}
			},
			pick: this.pick?.(),
			...sessionOpts,
		});
		this.arcSession = session;
		try {
			let i = 0;
			const run = async (step:Step, signal?:AbortSignal):Promise<ArcResult> => {
				this.verbIndex = i;
				this.verb = step.verb;
				i += 1;
				const out = await this.runStep(step, this.context(), false, signal);
				this.lastResult = out;
				// A step of a program already replaced is not the new program's.
				if (this.arcSession === session) {
					this.record.note(out);
				}
				// The step it waited on ended: of `A while B`, A's own.
				const handoff = this._handoff?.step === step ? this._handoff.done : undefined;
				this._handoff = handoff ? undefined : this._handoff;
				// The step ended clean: the waiting program takes over now, before this one's next step starts.
				const clean = !!handoff && this.arcSession === session && out.status === 'ok' && !session.pending;
				if (clean) {
					this.replaceProgram();
				}
				handoff?.(clean ? out : undefined);
				return out;
			};
			this._machine = resume
				? restoreArc(resume.machine, resume, run, session, Object.fromEntries(this.laws.map((law) => [law.name, law.arc])), (name) => this.lawHandlers().find((h) => !('verb' in h.source) && h.source.name === name))
				: startArc(arc, run, { session, asHandler: handler, open });
			const result = await drive(this._machine, (parked) => {
				this._machine = parked;
			});
			if (this.arcSession !== session) {
				return result;
			}
			this.verb = '';
			if (session.parked) {
				this.liveArc = false;
				this.onArcEnd();
				return result;
			}
			// While the arc is still live (a new think can still abort it), a voice waits for the answers it asked for.
			if (this.isVoice) {
				await this.talk()?.awaitReplies(this, result);
			}
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
	 * A reply's root steps, handed over as they are written (16 step 3): `update` with every finished step so far,
	 * `finish` with the whole reply. The first step that needs the body decides, as a merge does: one that restates the
	 * step running now or a later one, or the program's first, leaves the program be, and the reply's end merges it, as
	 * it does while a law holds the body; any other is added after the program under way (`append`), or begins a program
	 * at once that waits at its end for the rest, and the steps after it follow it there as they come. A free step before
	 * it runs beside at once. An `instead` replaces the program at once with the reply's steps from the first that needs
	 * the body, as written so far, `instead` opened (`insteadOf`); the steps after it follow them. `finish` gives back what the reply's end still has to enact, or, when the stream began
	 * the program, how that program ends.
	 */
	public stream():{ update(steps:Arc):void; finish(arc:Arc):Arc | Promise<ArcResult> } {
		let mode:'deciding' | 'atEnd' | 'adding' = 'deciding';
		let work:Arc | undefined;
		let added:Chain | undefined;
		let running:Promise<ArcResult> | undefined;
		const sent:Step[] = [];
		/** How many of its first steps ran beside the program under way. */
		let beside = 0;
		/** What it ran so far, in order: the free steps beside, then the steps it handed a program. */
		const ran:Step[] = [];
		/** The steps it adds to, while they still run: the program it began, or the one it added to. */
		const into = ():Chain | undefined => {
			const root = this._machine?.root();
			return root && (root === added || (work && this._machine!.program.work === work)) ? root : undefined;
		};
		return {
			update: (steps) => {
				steps.forEach((step, j) => {
					if (j < sent.length) {
						// What joins it to the next is written after it.
						sent[j].then = step.then;
						return;
					}
					sent.push(step);
					const live = this.liveArc && !this._law && !this.arcSession?.parked;
					const root = live ? this._machine?.root() : undefined;
					if (step.verb === INSTEAD_VERB) {
						// Its own program is dropped, what was added to it too: the reply's steps from its first that needs the body run instead.
						mode = 'adding';
						added = undefined;
						ran.splice(0, ran.length, ...sent);
						work = insteadOf(sent.slice(beside));
						running = this.enact(work!, undefined, undefined, 'replace', undefined, true);
					}
					else if (mode === 'adding') {
						const chain = ran.at(-1) === sent[j - 1] ? into() : undefined;
						if (chain) {
							this.extend(chain, [step]);
							ran.push(step);
						}
					}
					else if (mode === 'deciding' && live && this.takesNoBody([step])) {
						beside += 1;
						ran.push(step);
						void this.runBeside([step]);
					}
					else if (mode === 'deciding' && ((root && [root.at.arc.slice(0, 1), ...this.remains()].some((rest) => rest.some((had) => this.sameStep(step, had)))) || this.lawRunning())) {
						mode = 'atEnd';
					}
					else if (mode === 'deciding') {
						mode = 'adding';
						ran.push(step);
						if (this.append([step])) {
							added = root;
						}
						else {
							work = [step];
							running = this.enact(work, undefined, undefined, 'replace', undefined, true);
						}
					}
				});
			},
			finish: (arc) => {
				let k = 0;
				const rest = arc.filter((step) => !(k < ran.length && this.sameStep(step, ran[k]) && ++k));
				const chain = mode === 'adding' ? into() : undefined;
				if (chain) {
					this.extend(chain, rest);
				}
				if (running) {
					chain?.close();
					return running;
				}
				return chain ? [] : rest;
			},
		};
	}

	/**
	 * `arc`, a reply, merged into the program under way (12 step 7, 16 step 3). Free steps run beside it at once where
	 * they lead: the reply's first ones, and, when it restates the step it is on, that step's new `while` part that needs
	 * no body (if it says something new) and the ones right after it. The rest, aligned with the program (restating it
	 * from its first step through the one it is on, or starting at that step or a later one), changes only what comes
	 * after that step: the same rest changes nothing, a different one is asked of the System One where there is one
	 * (keep, new, both, new first). A rest not aligned is added after the program (`append`) when `appends`, else
	 * replaces it. How it went, or the arc that replaces it.
	 */
	private async merge(arc:Arc, appends:boolean):Promise<ArcResult | Arc> {
		const root = !this._law && !this.arcSession?.parked ? this._machine?.root() : undefined;
		const done:ArcResult = { status: 'ok', verb: arc[0]?.verb ?? '' };
		const lead = this.freeLead(arc);
		if (lead < arc.length && this.runs(arc.slice(lead))) {
			return lead > 0 ? this.runBeside(arc.slice(0, lead)) : done;
		}
		const at = root && lead < arc.length ? this.meetAt(arc, lead, root.at) : undefined;
		if (!root || !at) {
			const beside = lead > 0 ? this.runBeside(arc.slice(0, lead)) : undefined;
			const body = arc.slice(lead);
			return body.length === 0 ? beside ?? done : appends && this.append(body) ? done : body;
		}
		const { arc: program, i } = root.at;
		const { from, k, fresh } = at;
		const after = arc.slice(from + 1);
		const said = k === i ? this.chatter(arc[from]) : undefined;
		const was = this.chatter(program[i]);
		const free = k === i ? this.freeLead(after) : 0;
		const now = [...fresh, ...said && !(was && sameProgram(said, was)) ? said : [], ...after.slice(0, free)];
		if (now.length > 0) {
			void this.runBeside(now);
		}
		const rest = after.slice(free);
		const old = program.slice(k + 1);
		if (k > i || rest.length !== old.length || !rest.every((step, j) => this.sameStep(step, old[j]))) {
			const merged = await this.mergeRest(old, rest);
			// The steps before the later one it starts at still run; that one takes its wording.
			root.replaceRest([...program.slice(root.at.i + 1, k), ...k > i ? [arc[from]] : [], ...merged]);
			this.setArc([...program]);
		}
		return done;
	}

	/** How many of `arc`'s first steps need no body: those of a reply run beside the program under way at once. */
	private freeLead(arc:Arc):number {
		const n = arc.findIndex((step) => !this.takesNoBody([step]));
		return n < 0 ? arc.length : n;
	}

	/**
	 * Where reply `arc`, whose steps from `lead` need the body, meets the program under way, on its step `i`: its step
	 * `from` restates the program's `k`. It restates the program from its first step through the one it is on, or its
	 * first step that needs the body restates the one it is on or a later one, and its free steps before it (`fresh`)
	 * are new.
	 */
	private meetAt(arc:Arc, lead:number, { arc: program, i }:{ arc:Arc; i:number }):{ from:number; k:number; fresh:Arc } | undefined {
		if (arc.length > i && arc.slice(0, i + 1).every((step, j) => this.sameStep(step, program[j]))) {
			return { from: i, k: i, fresh: [] };
		}
		const k = program.findIndex((step, j) => j >= i && this.sameStep(arc[lead], step));
		return k < 0 ? undefined : { from: lead, k, fresh: arc.slice(0, lead) };
	}

	/**
	 * What follows the step it is on once `rest` meets `old`: past what they end alike in, one hunk, asked of the System
	 * One (`choose`'s) when there is one and both sides have steps; else the new steps.
	 */
	private async mergeRest(old:Arc, rest:Arc):Promise<Arc> {
		let tail = 0;
		while (tail < Math.min(old.length, rest.length) && this.sameStep(old[old.length - 1 - tail], rest[rest.length - 1 - tail])) {
			tail += 1;
		}
		const was = old.slice(0, old.length - tail);
		const now = rest.slice(0, rest.length - tail);
		const pick = this.pick?.();
		if (!pick || was.length === 0 || now.length === 0) {
			return rest;
		}
		const choices:Record<string, Arc> = { keep: was, new: now, both: [...was, ...now], new_first: [...now, ...was] };
		const name = await pick('Merge your new plan into the one you are running: keep the old steps, take the new, or both in either order', choices, undefined).catch(() => 'new');
		return [...choices[name] ?? now, ...rest.slice(rest.length - tail)];
	}

	/**
	 * When the step running now is `arc`'s first: the result of that step once it ended and this program was stopped
	 * there (`undefined` if it did not end clean, so `arc` runs whole). `undefined` when there is nothing to wait for.
	 */
	private finishStepOf(arc:Arc):Promise<ArcResult | undefined> | undefined {
		const session = this.arcSession;
		const running = this.verb ? this.lastStep : undefined;
		// A step with no end of its own never hands over: the reply starts it again instead (the endless-step hang, 16).
		if (!session || !this.liveArc || session.parked || !running || !arc[0] || formatStep(running) !== formatStep(arc[0]) || this.verbs.get(running.verb)?.endless) {
			return undefined;
		}
		this._handoff?.done(undefined);
		return new Promise((resolve) => {
			this._handoff = { step: running, done: resolve };
		});
	}

	/** Whether one of its laws runs now, as its program or over it. */
	private lawRunning():boolean {
		return !!this.arcSession?.running.some((h) => !('verb' in h.source));
	}

	/**
	 * Whether `arc` is the program it runs already, or what remains of it ({@link remains}), for all its wording: a reply
	 * that changes nothing. A law's arc is not its program.
	 */
	public runs(arc:Arc):boolean {
		return this.liveArc && !this._law && !!this.arc && [this.arc, ...this.remains()].some((rest) => sameProgram(rest, arc));
	}

	/**
	 * What remains of its program under way from each step it is on, every channel's at any depth (`A while B`, a loop's
	 * round): that step and the rest of the steps it is among, then each step holding it and the rest of its own.
	 */
	private remains():Arc[] {
		const root = this._machine?.root();
		const program = this.arc;
		return root && program ? [root.at.arc.slice(root.at.i), ...[...this._programSteps.values()].flatMap(({ step }) => remainders(program, step))] : [];
	}

	/**
	 * How much what remains of its program under way changes the world, 0–1 ({@link impactOfSteps}): how unsafe it is to
	 * replace it now. Every step that remains of it ({@link remains}); 1 while a law runs, 0 with no program.
	 */
	public impact():number {
		return this.lawRunning() ? 1 : impactOfSteps(this.liveArc ? this.remains().flat() : [], this.verbs);
	}

	/**
	 * How much its program, the one under way or the last, has changed the world so far, 0–1 ({@link impactOfSteps}):
	 * every step of it that ran, a control step too, and only the branch taken. A law's steps and those run beside it do
	 * not count.
	 */
	public ranImpact():number {
		return impactOfSteps(this._ran, this.verbs);
	}

	/**
	 * Whether every step of `arc` can run without the body the program under way is using. Its `when` and `wait` cases
	 * decide whether a reply replaces the program, not who waits for a channel (`extraLanes`).
	 */
	public takesNoBody(arc:Arc):boolean {
		return arcSteps(arc).every((step) => {
			if (step.verb === 'when' || !isFree(this.verbs, step.verb)) {
				return false;
			}
			// A bare wait says nothing needs to change; a wait for something stands still until then.
			return !(step.verb === 'wait' && Object.keys(step.args).length > 0) && !this.walksFirst(step);
		});
	}

	/** Whether `step` walks before it acts: over to a group (`VerbDef.group`), or to someone out of earshot of a line. */
	public walksFirst(step:Step):boolean {
		const aimed = this.aimGroup(step);
		// It picks no one: it fails where it stands.
		if ('status' in aimed) {
			return false;
		}
		const group = groupTargets(aimed, this.verbs);
		if (group) {
			return !!this.groupWalk(aimed, group);
		}
		return aimed.verb === 'say' && ![sayToOf(aimed.args) ?? []].flat().every((id) => this.inEarshot(id, toneOf(aimed.args)));
	}

	/** The channels `step` holds beside its verb's `channel`: the body too while a free one walks first (`A while B`'s lanes). */
	private extraLanes(step:Step, channel:string):string[] {
		return channel !== 'body' && this.walksFirst(step) ? ['body'] : [];
	}

	/** `step` with its group arg read (`VerbDef.group`): ids for a list, or why it picks no one. Any other step comes back as it is. */
	public aimGroup(step:Step):Step | ArcResult {
		return this._aimGroup?.(step) ?? step;
	}

	/** Whether `id` makes out every word it says from here. */
	private inEarshot(id:string, as?:SayTone):boolean {
		const talk = this.talk();
		return !!talk?.canSay(this.id, id).ok && talk.clear(this.id, id, as);
	}

	/** The walk it takes before `step` acts on the group `ids`, if any. A line everyone already makes out, in the tone it is said in, takes none. */
	private groupWalk(step:Step, ids:readonly string[]):(()=>Promise<ArcResult>) | undefined {
		const heard = step.verb === 'say' ? ():string | undefined => (ids.every((id) => this.inEarshot(id, toneOf(step.args))) ? 'in earshot' : undefined) : undefined;
		return heard?.() ? undefined : this._walkToGroup?.(step.verb, ids, heard && { check: heard });
	}

	/** A session on its own world and clock, with `opts`. */
	private session(opts:ArcSessionOpts = {}):ArcSession {
		return createArcSession({
			verbs: this.verbs,
			now: () => this.now,
			watchedAt: () => this.watchedAt,
			nextTime: () => this.nextTime(),
			catalog: () => this.catalog?.(),
			extraLanes: (step, channel) => this.extraLanes(step, channel),
			nameOf: (id) => this.mind?.nameOf(id) ?? id,
			...opts,
		});
	}

	/** `arc` beside the program under way, which it neither stops nor counts as its own. There is nothing to wait for: the program goes on. */
	private async runBeside(arc:Arc):Promise<ArcResult> {
		const result = await runArc(arc, (step, signal) => (step.verb === 'wait' ? Promise.resolve({ status: 'ok', verb: 'wait' }) : this.doStep(step, this.context(), !!step.granted, signal)), { session: this.session() });
		if (this.isVoice) {
			this.talk()?.forgetReplies(this);
			this.mind!.ingestResult(result, result.status !== 'ok');
		}
		return result;
	}

	/**
	 * Adds `steps` to the program under way, to run after its end however that went. The step it is on, if it never
	 * ends of its own, ends first: an endless verb at once, a loop once its round is over (`ArcMachine.wrapUp`). False
	 * when it runs no program of its own to add to, as when one has just ended or a law has its body.
	 */
	public append(steps:Arc):boolean {
		const root = this.liveArc && !this._law && !this.arcSession?.parked ? this._machine?.root() : undefined;
		if (!root) {
			return false;
		}
		const last = root.at.arc.at(-1);
		if (last) {
			last.then = 'always';
		}
		this._machine!.wrapUp();
		this.extend(root, steps);
		return true;
	}

	/** `steps` at the end of its program's own, `root`: they run there, and prompts show them. */
	private extend(root:Chain, steps:Arc):void {
		root.append(steps);
		this.setArc([...root.at.arc]);
	}

	/** Whether `a` and `b` are both there and the same step, for all their wording and their `while` parts that need no body: their work, not their chatter. */
	private sameStep(a:Step | undefined, b:Step | undefined):boolean {
		const work = (step:Step):Step => (this.chatter(step) ? { ...step, args: Object.fromEntries(Object.entries(step.args).filter(([key]) => key !== WHILE_ARG)) } : step);
		return !!a && !!b && sameProgram([work(a)], [work(b)]);
	}

	/** The `while` part of `step` that needs no body (a `say` during it), if it has one. */
	private chatter(step:Step):Arc | undefined {
		const during = step.args[WHILE_ARG];
		return isArc(during) && this.takesNoBody(during) ? during : undefined;
	}

	/** Its program under way, changed while it runs: what prompts show of it. */
	private setArc(arc:Arc):void {
		this.arc = arc;
		if (this._program) {
			this._program.arc = arc;
		}
	}

	/** Its program now, or the last one it began, and a law running now; undefined when it never had a program. */
	public programState():ProgramState | undefined {
		const program = this._program;
		if (!program) {
			return undefined;
		}
		const seconds = (since:number):number => Math.max(0, Math.round(this.now - since));
		const running = this.liveArc && !this._law && !!this.arc;
		const reaction = this.arcSession?.running.at(-1);
		const heldBy:Holder | undefined = reaction && ('verb' in reaction.source ? { when: reaction.watch } : { law: reaction.source.name });
		const marks:ProgramMark[] = [];
		// Steps running at once (`A while B`) each show their channel.
		const steps = running ? [...this._programSteps] : [];
		for (const [channel, { step, since }] of steps) {
			marks.push({ step, seconds: seconds(since), heldBy, ...steps.length > 1 ? { channel } : {} });
		}
		// A `when`'s steps are the program's own, so they are marked in it; a law's are not.
		if (running && heldBy && 'when' in heldBy && this._reactionStep) {
			marks.push({ step: this._reactionStep.step, seconds: seconds(this._reactionStep.since) });
		}
		const law = this._law ?? (heldBy && 'law' in heldBy ? heldBy.law : undefined);
		return {
			arc: running ? this.arc! : program.arc,
			running,
			seconds: seconds(program.since),
			marks,
			...law ? { law: { name: law, step: this._law ? this.lastStep : this._reactionStep?.step } } : {},
			...running ? {} : { result: this.lastResult },
		};
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
		handoff?.done(undefined);
		if (this.arcSession?.parked) {
			this.orders = undefined;
		}
		if (this.arcSession) {
			this.arcSession.ended = true;
			interruptArc(this.arcSession, { kind: 'abort' });
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
	public async perform(step:Step, ctx:TCtx | undefined = this.context(), granted = false, signal?:AbortSignal):Promise<ArcResult> {
		return this.runStep(step, ctx, granted, signal);
	}

	public toJSON():ArcRunnerJSON {
		return {
			id: this.id,
			persona: this.persona.toJSON(),
			lastResult: this.lastResult && resultToJSON(this.lastResult),
			liveArc: this.liveArc,
			program: this.savedProgram(),
			laws: this.laws.map((law) => structuredClone(law)),
			maxLaws: this.maxLaws,
			cooldown: this.cooldown,
			prevMe: this.prevMe ? cloneEntity(this.prevMe) : undefined,
		};
	}

	/** The program it runs, its own (not a law's), saved as it stands; none between programs. */
	private savedProgram():SavedProgram | undefined {
		const machine = this.arcSession && this._machine?.session === this.arcSession && !this._law ? this._machine : undefined;
		return machine && { ...structuredClone(machine.program), machine: machine.toJSON(Object.fromEntries(this.laws.map((law) => [law.name, law.arc]))) };
	}

	protected loadJSON(json:ArcRunnerJSON):void {
		this.lastResult = json.lastResult && resultFromJSON(json.lastResult);
		this.liveArc = json.liveArc;
		this._resume = json.liveArc ? json.program : undefined;
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
	protected async runStep(step:Step, ctx:TCtx | undefined, granted = false, signal?:AbortSignal):Promise<ArcResult> {
		this.lastStep = step;
		if (this.arcSession?.running.length) {
			this._reactionStep = { step, since: this.now };
		}
		else if (!this._law) {
			const channel = channelOf(this.verbs.get(step.verb));
			this._programSteps.set(channel, { step, since: this.now });
			this._reactionStep = undefined;
			const out = await this.doStep(step, ctx, granted, signal);
			// One a reaction cut short stays marked: it runs again once the reaction is over.
			if (out.status !== 'stopped' && this._programSteps.get(channel)?.step === step) {
				this._programSteps.delete(channel);
			}
			return out;
		}
		return this.doStep(step, ctx, granted, signal);
	}

	private async doStep(step:Step, ctx:TCtx | undefined, granted:boolean, signal?:AbortSignal):Promise<ArcResult> {
		// Nothing to do, wherever a model wrote it: a commander puts it in a unit's program too.
		if (step.verb === PASS_VERB) {
			return { status: 'ok', verb: PASS_VERB };
		}
		if (!granted && !step.granted && !this.activeVerbs().has(step.verb)) {
			// Its kit grants it, but it has no body to run it with.
			return !this.embodied && this.currentKit.verbs.includes(step.verb)
				? bodiless(step.verb)
				: { status: 'failed', verb: step.verb, reason: `verb '${step.verb}' is not available` };
		}
		// Failed, not waited out: a program goes on to what it can do, as `choose` passes over it.
		const wait = this.readyIn(step.verb);
		if (wait > 0) {
			return { status: 'failed', verb: step.verb, reason: `ready again in ${Math.ceil(wait)}s` };
		}
		const aimed = this.aimGroup(step);
		if ('status' in aimed) {
			return aimed;
		}
		const done = await this.mind?.perform(aimed, this);
		const talk = aimed.verb === 'say' ? this.talk() : undefined;
		const out = done ?? (talk ? await talk.speak(this, aimed) : await this.hostStep(aimed, ctx, signal));
		if (!(STOCK_MOVE_VERBS as readonly string[]).includes(aimed.verb)) {
			this.replies += 1;
		}
		if (out.status === 'ok') {
			this._ranAt.set(aimed.verb, this.now);
		}
		if (out.status === 'ok' && this.isVoice) {
			this.talk()?.noteReply(this, aimed);
		}
		return out;
	}

	/** Game seconds before it may run `verb` again, from when it last did: its kit's cooldown for it, else the verb's (`VerbDef.cooldown`). */
	public readyIn(verb:string):number {
		const cooldown = this.currentKit.cooldowns?.[verb] ?? this.verbs.find(verb)?.cooldown ?? 0;
		return Math.max(0, (this._ranAt.get(verb) ?? -Infinity) + cooldown - this.now);
	}

	/** A step through the host, once it has walked near the group it is aimed at, if it is. */
	private async hostStep(step:Step, ctx:TCtx | undefined, signal?:AbortSignal):Promise<ArcResult> {
		if (!this.execute) {
			return { status: 'failed', verb: step.verb, reason: `host has no executor for ${step.verb}` };
		}
		const group = groupTargets(step, this.verbs);
		const near = group && await this.groupWalk(step, group)?.();
		return near && near.status !== 'ok' ? { ...near, verb: step.verb } : this.execute(step, ctx, signal);
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
			const near = await this._goTo?.(id, { check: () => (this.inEarshot(id, toneOf(step.args)) ? 'in earshot' : undefined) });
			if (near && near.status !== 'ok') {
				return { ...near, verb: 'say' };
			}
		}
		return this.talk()!.say(this.id, String(step.args.text ?? ''), to, this.now, toneOf(step.args));
	}

	/** One line to `ids`, from near them if it may walk. It reaches whoever of them is in earshot, and says who was not. */
	private async speakToGroup(step:Step, ids:readonly string[]):Promise<SayResult> {
		const talk = this.talk()!;
		const near = await this.groupWalk(step, ids)?.();
		if (near?.status === 'stopped') {
			return { ...near, verb: 'say' };
		}
		const reached = ids.filter((id) => talk.canSay(this.id, id).ok);
		if (reached.length === 0) {
			return near && near.status !== 'ok' ? { ...near, verb: 'say' } : { status: 'failed', verb: 'say', reason: 'none of them is in earshot' };
		}
		const said = talk.say(this.id, String(step.args.text ?? ''), reached, this.now, toneOf(step.args));
		const missed = ids.filter((id) => !reached.includes(id));
		return said.status === 'ok' && missed.length > 0 ? { ...said, reason: (name) => `${showNamingText(said.reason ?? '', name)}; out of earshot: ${missed.map(name).join(', ')}` } : said;
	}

	/** The running arc stopped or parked. A voice tells its mind. */
	protected onArcEnd():void {
		if (this.isVoice) {
			internalsOf(this.mind!).arcEnded();
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
			internalsOf(this.mind!).ingestLawResult(this._law, result);
		}
		else {
			this.mind!.ingestResult(result);
		}
	}
}

/**
 * How much `steps` change the world together, 0–1: 1 − ∏(1 − c) over each step once, by its verb's {@link impactOf}. A
 * loop's round comes again anyway, so each verb in its body counts once: a patrol of four stops has no more impact than
 * one of two.
 */
function impactOfSteps(steps:Iterable<Step>, verbs:VerbRegistry):number {
	const all = [...new Set(steps)];
	const loopOf = new Map(all.filter((step) => step.verb === 'loop' && isArc(step.args.arc)).flatMap((loop) => (loop.args.arc as Arc).map((step) => [step, loop] as const)));
	const counted = new Map(all.map((step) => [loopOf.has(step) ? `${all.indexOf(loopOf.get(step)!)} ${step.verb}` : step, step]));
	return 1 - [...counted.values()].reduce((rest, step) => rest * (1 - impactOf(verbs.find(step.verb))), 1);
}

/** The steps of the loop `arc` would never leave, the innermost if one is the next: nothing after it ever runs. */
function endlessBody(arc:Arc):Arc | undefined {
	const loop = arcSteps(arc).find((step) => step.verb === 'loop' && isArc(step.args.arc) && !step.args.until && !step.args.through && step.args.times === undefined);
	return loop && (endlessBody(loop.args.arc as Arc) ?? loop.args.arc as Arc);
}

/**
 * What remains of `arc` from `step`, the very object at any depth: it and the rest of the steps it is among, then each
 * step holding it and the rest of its own, outermost last. None when `step` is not in it.
 */
function remainders(arc:Arc, step:Step):Arc[] {
	for (const [i, had] of arc.entries()) {
		const inner = had === step ? [] : Object.values(had.args).flatMap((value) => (isArc(value) ? remainders(value, step) : []));
		if (had === step || inner.length > 0) {
			return [...inner, arc.slice(i)];
		}
	}
	return [];
}

/** Why a runner with no body of its own (a collective with no commander) cannot run `verb` itself. */
export function bodiless(verb:string):ArcResult {
	return { status: 'failed', verb, reason: `you are not a character in this scene; command one of your characters to ${verb}` };
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

/** The tone a `say` is said in (`as`), or plainly. */
function toneOf(args:Step['args']):SayTone | undefined {
	return typeof args.as === 'string' ? args.as : undefined;
}
