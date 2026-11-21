import { showNamingText, type NamingText } from '../character/text-with-ids.js';
import { argKind, TEST_VERB, type VerbRegistry } from './stock-verbs.js';
import { isArc, type Arc, type ArcResult, type Step, type StepArg } from './arc-types.js';
import { evaluate } from '../expr/eval.js';
import { parse } from '../expr/expr-parse.js';
import { durationSeconds } from '../expr/lex.js';
import { dummyEntity } from '../expr/natives.js';
import { watchScore } from '../expr/watch-score.js';
import { stringifyVal } from '../expr/stringify.js';
import { isTruthy, Names, SampleCache, type Ast, type Catalog, type ExprVal } from '../expr/expr-types.js';
import type { Law } from './laws.js';

export const DEFAULT_COOLDOWN = 8;

/** Game seconds a reaction's watch must have been false before it may start again, unless it says (`rearm=`). */
export const DEFAULT_REARM = 1;

/**
 * What `when` and `law` share. It starts when `watch` becomes true, and then runs `arc` to its end, whatever its watch
 * does after; only its `until` cuts it short. It starts again only after its watch has been false for `rearm` seconds.
 */
export type Reaction = {
	watch:string;
	arc:Arc;
	/** It starts at most this many times, and is then finished. */
	times?:number;
	/** A watch: once it is met, a run under way stops, and the reaction is finished. */
	until?:string;
	/** Game seconds its watch must have been false before it may start again. None: the session's (`withRearm`). */
	rearm?:number;
};

/** The reaction a `when` or `law` step's args write: its watch and arc, if given, and the rest as far as they are. */
export function reactionOf(args:Readonly<Record<string, StepArg>>):Partial<Reaction> {
	const watch = typeof args.watch === 'string' ? args.watch.trim() : '';
	const until = typeof args.until === 'string' ? args.until.trim() : '';
	return {
		...watch ? { watch } : {},
		...isArc(args.arc) ? { arc: args.arc } : {},
		...typeof args.times === 'number' ? { times: args.times } : {},
		...until ? { until } : {},
		...typeof args.rearm === 'number' ? { rearm: args.rearm } : {},
	};
}

/** How a reaction with an exit has gone: the times it has started, and whether its `until` has been met. */
export type ReactionProgress = { runs:number; ended?:boolean };

/** Whether a reaction has run out its `times`, or its `until` has been met. It may still be running its last run. */
export function reactionFinished(times:number | undefined, progress:ReactionProgress | undefined):boolean {
	return !!progress && (!!progress.ended || (times !== undefined && progress.runs >= times));
}

/**
 * Whether a reaction may start: `fired` from the moment it starts until its watch has been false for its `rearm`, which
 * it has been since `falseSince`. A watch that stays true starts it once, and a character on the edge of a watch does
 * one thing and finishes it instead of switching back and forth.
 */
export type ReactionArm = { fired?:boolean; falseSince?:number };

const arms = new WeakMap<object, Map<string, ReactionArm>>();

/** How `source`, a law or a `when` step, stands for character `id`. Not saved: a loaded game starts every reaction armed. */
export function reactionArm(source:object, id = ''):ReactionArm {
	const byID = arms.get(source) ?? new Map<string, ReactionArm>();
	const arm = byID.get(id) ?? {};
	arms.set(source, byID.set(id, arm));
	return arm;
}

/**
 * A reaction a session may run: a law, or a `when` from where it is written to the end of its arc. `source` is that law
 * or that `when` step itself, so a handler stays recognizable while its law is renamed or edited.
 */
export type ArcHandler = Reaction & {
	source:Law | Step;
	rank:number;
	/** How far it has got, when it has `times` or `until`; none: it never finishes. */
	progress?:ReactionProgress;
	arm:ReactionArm;
};

/** Whether `handler` has finished for good: it fires no more. */
export function handlerFinished(handler:ArcHandler):boolean {
	return reactionFinished(handler.times, handler.progress);
}

export type ArcPending =
	| { kind:'preempt'; handler:ArcHandler }
	| { kind:'abort' };

/** Runs one step through the host, which ends it early, as best it can, once `signal` aborts. */
export type StepExecutor = (step:Step, signal?:AbortSignal)=>Promise<ArcResult>;

export type ArcSession = {
	token:number;
	/** Its program was replaced: nothing of it runs on. */
	ended?:boolean;
	/** Aborts once the innermost step running now with an `until` or a `within` is stopped by it. */
	signal?:AbortSignal;
	/** The steps running now with an `until` or a `within`, outermost first: each step that starts asks them first. */
	races:Race[];
	/** Stops the host step running now, or the one about to start: when a reaction takes over, or the program is replaced. */
	stepStop?:AbortController;
	/** Who holds each channel (`VerbDef.channel`) now, shared by the parts of `A while B`: a step waits for its own. */
	lanes:Map<string, unknown>;
	/** The channels a step holds beside its verb's (`channel`): a line said far off walks first, so the body too. */
	extraLanes?:(step:Step, channel:string)=>string[];
	/** The reactions running now, outermost first. */
	running:ArcHandler[];
	/** Game time a reaction last started: one start per moment. */
	lastStartAt?:number;
	/** Game seconds a reaction's watch must have been false before it may start again, unless it says. */
	rearm:number;
	/**
	 * Game time its director last asked watches at (`withIntervals` `watch`): its races' `until`s and its parked `when`s
	 * are asked when it moves. None without a director: they are asked on every tick.
	 */
	watchedAt?:()=>number | undefined;
	frames:{ handlers:ArcHandler[] }[];
	pending?:ArcPending;
	fail?:{ verb:string; reason:NamingText };
	/** How whoever runs it names `id` in what its arc reads (`fail.reason`): its mind's name for it. Default: the id. */
	nameOf?:(id:string)=>string;
	bindings:Map<string, ExprVal>;
	catalog?:()=>Catalog | undefined;
	now:()=>number;
	/** Resolves once `now` moves on. Without it, a loop of instant iterations yields a turn of the event loop instead. */
	nextTime?:()=>Promise<void>;
	abortHost?:()=>void;
	/** Called each time a reaction it ran stops, however it ended. */
	onReactionEnd?:()=>void;
	/** Called as each step of its arc runs, once its race and the reactions due let it: a control step (`if`, `loop`, a group) too, and only the branch taken. */
	onStepRun?:(step:Step)=>void;
	extraHandlers?:()=>ArcHandler[];
	/** Body finished; its `when`s still poll until the program is replaced. */
	parked?:boolean;
	/** The arg kinds, so a bound body fills a `text` arg with its name and every other arg with its id. */
	verbs?:VerbRegistry;
	/** Asks a System One model which choice a `choose` runs. None: every `choose` fails. */
	pick?:ArcPick;
	/** The last choice this session ran and how it went, so a looped `choose` can see it. */
	lastChoice?:LastChoice;
	/** Game time of the last pick. A `choose` never picks twice at one time. */
	lastPickAt?:number;
	/** How many times each `loop` step has gone all the way round. */
	passes:Map<Step, number>;
	/** Unbreakable loop rounds running now: what runs in them goes on whatever the trigger does. */
	shields:number;
	/** How each `when` step with an exit has gone, over every pass of a loop. */
	whens:Map<Step, ReactionProgress>;
};

export type LastChoice = { name:string; result:ArcResult };

/** The name of the choice to run, given the goal, the choices by name, and the last choice. */
export type ArcPick = (goal:string, choices:Record<string, Arc>, last:LastChoice | undefined)=>Promise<string>;

/** What a new session is given: its hooks into the world and clock. */
export type ArcSessionOpts = Partial<Pick<ArcSession, 'verbs' | 'rearm' | 'catalog' | 'now' | 'watchedAt' | 'nextTime' | 'abortHost' | 'onReactionEnd' | 'onStepRun' | 'extraHandlers' | 'pick' | 'extraLanes' | 'nameOf'>> & {
	/** The reaction this session's arc runs within (an alias's arc in a law): its loops and endless verbs follow its trigger. */
	reaction?:ArcHandler;
};

export function createArcSession(opts:ArcSessionOpts = {}):ArcSession {
	const { reaction, rearm = DEFAULT_REARM, now = () => 0, ...hooks } = opts;
	return {
		...hooks,
		token: 0,
		running: reaction ? [reaction] : [],
		races: [],
		lanes: new Map(),
		rearm,
		frames: [],
		bindings: new Map(),
		now,
		parked: false,
		passes: new Map(),
		whens: new Map(),
		shields: 0,
	};
}

export function liveCatalog(session:ArcSession):Catalog | undefined {
	const base = session.catalog?.();
	if (!base && !session.fail && session.bindings.size === 0) {
		return undefined;
	}
	const names = new Names(base?.names);
	if (session.fail) {
		names.set('fail', {
			kind: 'entity',
			value: dummyEntity('fail', {
				fields: {
					verb: { kind: 'string', value: session.fail.verb },
					reason: { kind: 'string', value: showNamingText(session.fail.reason, session.nameOf) },
				},
			}),
		});
	}
	for (const [k, v] of session.bindings) {
		names.set(k, v);
	}
	return { ...base ?? { fns: new Map(), me: dummyEntity('me'), cache: new SampleCache() }, names };
}

export function watchIsTrue(watch:string, catalog:Catalog):boolean {
	const r = evaluate(watch, catalog);
	if (r.error) {
		return false;
	}
	return watchScore(r.value).score > 0;
}

function allHandlers(session:ArcSession):ArcHandler[] {
	const extras = session.extraHandlers?.() ?? [];
	const inner:ArcHandler[] = [];
	for (let f = session.frames.length - 1; f >= 0; f--) {
		inner.push(...session.frames[f].handlers);
	}
	return [...extras, ...inner].sort((a, b) => a.rank - b.rank);
}

/**
 * Notes how each of `handlers` stands now, and returns those that may start: unfinished, armed, and watch true. An
 * `until` that is met finishes its reaction for good; a watch false for a reaction's `rearm` arms it again.
 */
function startable(session:ArcSession, handlers:ArcHandler[], catalog:Catalog):ArcHandler[] {
	return handlers.filter((h) => {
		if (h.until && h.progress && !h.progress.ended && watchIsTrue(h.until, catalog)) {
			h.progress.ended = true;
		}
		return !handlerFinished(h) && noteTrigger(session, h, watchIsTrue(h.watch, catalog)) && !h.arm.fired;
	});
}

/** Notes whether `h`'s watch is true now, so it re-arms once it has been false for its `rearm`; gives it back. */
function noteTrigger(session:ArcSession, h:ArcHandler, isTrue:boolean):boolean {
	if (isTrue) {
		h.arm.falseSince = undefined;
		return true;
	}
	h.arm.falseSince ??= session.now();
	if (h.arm.fired && session.now() - h.arm.falseSince >= (h.rearm ?? session.rearm)) {
		h.arm.fired = false;
	}
	return false;
}

/** `handler` runs from now on: it is fired, and it has started one of its `times`, however this run ends. */
export function startRunning(session:ArcSession, handler:ArcHandler):void {
	session.running.push(handler);
	session.lastStartAt = session.now();
	handler.arm.fired = true;
	handler.arm.falseSince = undefined;
	if (handler.progress) {
		handler.progress.runs += 1;
	}
}

/** The reaction on top has ended. Its watch is asked now too: one that ended as its watch went false may re-arm at once. */
export function stopRunning(session:ArcSession):void {
	const ended = session.running.pop();
	const catalog = ended && liveCatalog(session);
	if (ended && catalog) {
		noteTrigger(session, ended, watchIsTrue(ended.watch, catalog));
	}
	session.onReactionEnd?.();
}

/**
 * Director tick: stop the running reaction once its own `until` is met, or let a reaction that may start take over from
 * one of strictly lower rank (the program counts as lowest). One reaction starts per moment.
 */
export function pollArcSession(session:ArcSession):void {
	const candidates = allHandlers(session);
	// Nothing to watch: no view to build.
	if (candidates.length === 0 && session.running.length === 0) {
		return;
	}
	const catalog = liveCatalog(session);
	if (!catalog || session.pending) {
		return;
	}
	const ready = startable(session, candidates, catalog);
	const top = session.running.at(-1);
	if (top?.until && top.progress && !top.progress.ended && watchIsTrue(top.until, catalog)) {
		top.progress.ended = true;
	}
	const next = top?.progress?.ended || session.lastStartAt === session.now() ? undefined : ready.find((h) => !top || h.rank < top.rank);
	if (top?.progress?.ended || next) {
		interruptArc(session, next ? { kind: 'preempt', handler: next } : { kind: 'abort' });
	}
}

/** Stops the step running now, and the host's part of it, for `pending`: a reaction taking over, or an abort. */
export function interruptArc(session:ArcSession, pending:ArcPending):void {
	session.pending = pending;
	session.token += 1;
	session.stepStop?.abort('stopped');
	session.abortHost?.();
}

/** The reaction that may start first, with no program running: for a runner that is idle. */
export function firstStartable(session:ArcSession):ArcHandler | undefined {
	const candidates = allHandlers(session);
	const catalog = candidates.length > 0 ? liveCatalog(session) : undefined;
	return catalog && startable(session, candidates, catalog)[0];
}

/**
 * A `when` step: its reaction guards the rest of the arc it is written in from here, so it joins that arc's frame and
 * goes with it. Its count and its `until` are kept by the step, over every pass of a loop.
 */
export function registerWhen(step:Step, session:ArcSession):ArcResult {
	const { watch, arc, ...rest } = reactionOf(step.args);
	if (!watch || !arc) {
		return { status: 'failed', verb: 'when', reason: 'when needs watch and arc' };
	}
	let progress:ReactionProgress | undefined;
	if (rest.times !== undefined || rest.until) {
		progress = session.whens.get(step) ?? { runs: 0 };
		session.whens.set(step, progress);
	}
	const frame = session.frames.at(-1)!;
	frame.handlers.push({ source: step, watch, arc, ...rest, rank: 100 + frame.handlers.length, progress, arm: reactionArm(step) });
	return { status: 'ok', verb: 'when' };
}

/** The name an expression reads through (`fail` in `fail.reason`), when it is a name or a field of one. */
function rootName(ast:Ast):string | undefined {
	return ast.type === 'ident' ? ast.name : ast.type === 'member' ? rootName(ast.recv) : undefined;
}

/** Each step's string args by the name each reads through, if it is one: parsed once per step, not on every run. */
const roots = new WeakMap<Step, [key:string, root:string][]>();

function rootsOf(step:Step):[key:string, root:string][] {
	let found = roots.get(step);
	if (!found) {
		found = Object.entries(step.args).flatMap(([key, value]):[string, string][] => {
			try {
				const root = typeof value === 'string' ? rootName(parse(value).ast) : undefined;
				return root ? [[key, root]] : [];
			}
			catch {
				return [];
			}
		});
		roots.set(step, found);
	}
	return found;
}

export function interpolateStep(step:Step, session:ArcSession):Step {
	if (!session.fail && session.bindings.size === 0) {
		return step;
	}
	const catalog = liveCatalog(session);
	if (!catalog) {
		return step;
	}
	const args = { ...step.args };
	let changed = false;
	for (const [key, root] of rootsOf(step)) {
		const r = root === 'fail' || session.bindings.has(root) ? evaluate(String(args[key]), catalog) : undefined;
		if (r && !r.error) {
			const prose = argKind(session.verbs?.get(step.verb), key) === 'text';
			args[key] = r.value.kind === 'entity' && !prose ? r.value.value.id : stringifyVal(r.value, catalog);
			changed = true;
		}
	}
	return changed ? { ...step, args } : step;
}

/** Verbs whose `until` is their reaction's, not a race of the step: the step itself ends at once. */
const REACTION_VERBS:ReadonlySet<string> = new Set(['when', 'law']);

/**
 * A step racing the args the runtime gives every verb: `until`, a watch that stops it once it is met, and `within`,
 * game seconds after which it stops; and, for an endless verb in a reaction, that `reaction`'s trigger, which stops it
 * once it is no longer true. `cause` is what stopped it; `stop` aborts the signal its verb was handed.
 */
export type Race = {
	until:string;
	within?:number;
	deadline:number;
	reaction?:ArcHandler;
	/** Its verb is endless: running out of `within` is how it ends. */
	endless:boolean;
	/** Game time its `unbreakable` holds it until, whatever its reaction's trigger does. */
	holdUntil:number;
	/** The session's `watchedAt` its watches were last asked at. */
	watchedAt?:number;
	stop:AbortController;
	cause?:'until' | 'within' | 'trigger';
};

export function raceOf(step:Step, session:ArcSession):Race | undefined {
	const until = typeof step.args.until === 'string' ? step.args.until.trim() : '';
	const within = typeof step.args.within === 'number' ? step.args.within : undefined;
	const endless = !!session.verbs?.get(step.verb)?.endless;
	const reaction = endless ? session.running.at(-1) : undefined;
	if (REACTION_VERBS.has(step.verb) || (!until && within === undefined && !reaction)) {
		return undefined;
	}
	const now = session.now();
	const hold = typeof step.args.unbreakable === 'string' ? durationSeconds(step.args.unbreakable) ?? 0 : 0;
	return { until, within, deadline: within === undefined ? Infinity : now + within, reaction, endless, holdUntil: now + hold, stop: new AbortController() };
}

/** Whether `race` is over now: its time is up, its `until` is met, or its reaction's trigger is not true. It notes which. */
export function raceOver(race:Race, session:ArcSession):boolean {
	if (!race.cause && session.now() >= race.deadline) {
		race.cause = 'within';
	}
	// Its watches at its start, then each time its director asks watches (every tick without one).
	const watchedAt = session.watchedAt?.();
	if (race.cause || (watchedAt !== undefined && race.watchedAt === watchedAt)) {
		return !!race.cause;
	}
	race.watchedAt = watchedAt;
	if (race.reaction && session.shields === 0 && session.now() >= race.holdUntil && !triggerIsTrue(race.reaction, session)) {
		race.cause = 'trigger';
	}
	if (!race.cause && race.until) {
		const catalog = liveCatalog(session);
		if (catalog && watchIsTrue(race.until, catalog)) {
			race.cause = 'until';
		}
	}
	return !!race.cause;
}

/**
 * How a step its race stopped ends: as its verb ended it, when that still worked (`wander` with what it saw); else
 * done when its `until` was met or its trigger went, failed when its time ran out, unless it is endless: then that is
 * how it ends.
 */
export function raceResult(race:Race, step:Step, result?:ArcResult):ArcResult {
	if (result?.status === 'ok') {
		return result;
	}
	if (race.cause === 'until' || race.cause === 'trigger' || (race.cause === 'within' && race.endless && !race.until)) {
		return { status: 'ok', verb: step.verb, reason: race.cause === 'within' ? `${race.within}s` : race.cause };
	}
	return { status: 'failed', verb: step.verb, reason: race.until ? `until not met after ${race.within}s` : `not done after ${race.within}s` };
}

/** A query as a step: it worked while its watch is true. A `let` on it names the value, not only whether it was true. */
export function runTest(step:Step, session:ArcSession):ArcResult {
	const watch = String(step.args.watch ?? '');
	const catalog = liveCatalog(session);
	const r = catalog ? evaluate(watch, catalog) : undefined;
	if (!r || r.error) {
		return { status: 'failed', verb: TEST_VERB, reason: `${watch}: ${r?.error?.message ?? 'there is nothing to ask'}` };
	}
	if (step.let) {
		session.bindings.set(step.let, r.value);
	}
	return isTruthy(r.value) ? { status: 'ok', verb: TEST_VERB } : { status: 'failed', verb: TEST_VERB, reason: `${watch} is false` };
}

/**
 * Whether the trigger of `reaction` is still true. In a reaction's arc, at any depth, what would otherwise go on and on
 * goes on only while it does: a loop asks before each round, and an endless verb (`VerbDef.endless`) stops once it no
 * longer true.
 */
export function triggerIsTrue(reaction:ArcHandler, session:ArcSession):boolean {
	const catalog = liveCatalog(session);
	return !catalog || watchIsTrue(reaction.watch, catalog);
}
