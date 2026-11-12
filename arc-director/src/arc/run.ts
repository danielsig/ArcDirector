import { argKind, CHOOSE_VERB, IF_VERB, TEST_VERB, type VerbRegistry } from './stock-verbs.js';
import { choicesOf, withLoneWait } from './choose.js';
import {
	firstStep,
	groupArc,
	isArc,
	arcSteps,
	type Arc,
	type ArcResult,
	type Join,
	type Step,
} from './arc-types.js';
import { evaluate } from '../expr/eval.js';
import { parse } from '../expr/expr-parse.js';
import { durationSeconds } from '../expr/lex.js';
import { dummyEntity } from '../expr/natives.js';
import { watchScore } from '../expr/watch-score.js';
import { stringifyVal } from '../expr/stringify.js';
import { isTruthy, LIST_CAP, Names, SampleCache, type Ast, type Catalog, type ExprVal } from '../expr/expr-types.js';
import type { Law } from './laws.js';
import type { StepArg } from './arc-types.js';

export const THINK_ABOUT_CAP = 200;
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
	/** A watch: once it holds, a run under way stops, and the reaction is finished. */
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

/** How a reaction with an exit has gone: the times it has started, and whether its `until` has held. */
export type ReactionProgress = { runs:number; ended?:boolean };

/** Whether a reaction has run out its `times`, or its `until` has held. It may still be running its last run. */
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
	let byID = arms.get(source);
	if (!byID) {
		byID = new Map();
		arms.set(source, byID);
	}
	let arm = byID.get(id);
	if (!arm) {
		arm = {};
		byID.set(id, arm);
	}
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
	fail?:{ verb:string; reason:string };
	bindings:Map<string, ExprVal>;
	catalog?:()=>Catalog | undefined;
	now:()=>number;
	/** Resolves once `now` moves on. Without it, a loop of instant iterations yields a turn of the event loop instead. */
	nextTime?:()=>Promise<void>;
	abortHost?:()=>void;
	/** Called each time a reaction it ran stops, however it ended. */
	onReactionEnd?:()=>void;
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

export type ArcSessionOpts = {
	verbs?:VerbRegistry;
	rearm?:number;
	/** The reaction this session's arc runs within (an alias's arc in a law): its loops and endless verbs follow its trigger. */
	reaction?:ArcHandler;
	catalog?:()=>Catalog | undefined;
	now?:()=>number;
	watchedAt?:()=>number | undefined;
	nextTime?:()=>Promise<void>;
	abortHost?:()=>void;
	onReactionEnd?:()=>void;
	extraHandlers?:()=>ArcHandler[];
	pick?:ArcPick;
};

export function createArcSession(opts:ArcSessionOpts = {}):ArcSession {
	return {
		token: 0,
		running: opts.reaction ? [opts.reaction] : [],
		races: [],
		rearm: opts.rearm ?? DEFAULT_REARM,
		frames: [],
		bindings: new Map(),
		catalog: opts.catalog,
		now: opts.now ?? (() => 0),
		watchedAt: opts.watchedAt,
		nextTime: opts.nextTime,
		abortHost: opts.abortHost,
		onReactionEnd: opts.onReactionEnd,
		extraHandlers: opts.extraHandlers,
		parked: false,
		verbs: opts.verbs,
		pick: opts.pick,
		passes: new Map(),
		whens: new Map(),
		shields: 0,
	};
}

function liveCatalog(session:ArcSession):Catalog | undefined {
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
					reason: { kind: 'string', value: session.fail.reason ?? '' },
				},
			}),
		});
	}
	for (const [k, v] of session.bindings) {
		names.set(k, v);
	}
	if (base) {
		return { ...base, names };
	}
	return {
		names,
		fns: new Map(),
		me: dummyEntity('me'),
		cache: new SampleCache(),
	};
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
 * `until` that holds finishes its reaction for good; a watch false for a reaction's `rearm` arms it again.
 */
function startable(session:ArcSession, handlers:ArcHandler[], catalog:Catalog):ArcHandler[] {
	return handlers.filter((h) => {
		if (h.until && h.progress && !h.progress.ended && watchIsTrue(h.until, catalog)) {
			h.progress.ended = true;
		}
		return !handlerFinished(h) && noteTrigger(session, h, watchIsTrue(h.watch, catalog)) && !h.arm.fired;
	});
}

/** Notes whether `h`'s watch holds now, so it re-arms once it has been false for its `rearm`; gives it back. */
function noteTrigger(session:ArcSession, h:ArcHandler, holds:boolean):boolean {
	if (holds) {
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
function startRunning(session:ArcSession, handler:ArcHandler):void {
	session.running.push(handler);
	session.lastStartAt = session.now();
	handler.arm.fired = true;
	handler.arm.falseSince = undefined;
	if (handler.progress) {
		handler.progress.runs += 1;
	}
}

/** The reaction on top has ended. Its watch is asked now too: one that ended as its watch went false may re-arm at once. */
function stopRunning(session:ArcSession):void {
	const ended = session.running.pop();
	const catalog = ended && liveCatalog(session);
	if (ended && catalog) {
		noteTrigger(session, ended, watchIsTrue(ended.watch, catalog));
	}
	session.onReactionEnd?.();
}

/**
 * Director tick: stop the running reaction once its own `until` holds, or let a reaction that may start take over from
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
	if (top?.progress?.ended) {
		session.pending = { kind: 'abort' };
	}
	else {
		const next = session.lastStartAt === session.now() ? undefined : ready.find((h) => !top || h.rank < top.rank);
		if (!next) {
			return;
		}
		session.pending = { kind: 'preempt', handler: next };
	}
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

function thinkAbout(step:Step):string {
	return typeof step.args.about === 'string' ? step.args.about.replace(/\s+/g, ' ').trim() : '';
}

function withVerb(result:ArcResult, step:Step):ArcResult {
	return { ...result, verb: result.verb ?? step.verb };
}

/**
 * Pull every think() out of the arc (and out of each group in it), concat abouts, append one think at the end. The
 * same array comes back when nothing moves; only a group that changes, and the step before the appended think,
 * are copied.
 */
export function deferThinks(arc:Arc):Arc {
	const abouts:string[] = [];
	const body:Step[] = [];
	let thought = false;
	let moved = false;
	for (const step of arc) {
		if (step.verb === 'think') {
			thought = true;
			const about = thinkAbout(step);
			if (about) {
				abouts.push(about);
			}
			continue;
		}
		const inner = groupArc(step);
		const deferred = inner && deferThinks(inner);
		if (deferred && deferred !== inner) {
			moved = true;
			body.push({ ...step, args: { ...step.args, arc: deferred } });
			continue;
		}
		body.push(step);
	}
	if (!thought && !moved) {
		return arc;
	}
	if (!thought) {
		return body;
	}
	let about = abouts.join(' ');
	if (about.length > THINK_ABOUT_CAP) {
		about = about.slice(0, THINK_ABOUT_CAP).trim();
	}
	const think:Step = { verb: 'think', args: about ? { about } : {} };
	if (body.length === 0) {
		return [think];
	}
	body[body.length - 1] = { ...body[body.length - 1], then: 'always' };
	return [...body, think];
}

/**
 * A `when` step: its reaction guards the rest of the arc it is written in from here, so it joins that arc's frame and
 * goes with it. Its count and its `until` are kept by the step, over every pass of a loop.
 */
function registerWhen(step:Step, session:ArcSession):ArcResult {
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

function rootedAtBinding(ast:Ast, session:ArcSession):boolean {
	if (ast.type === 'ident') {
		return ast.name === 'fail' || session.bindings.has(ast.name);
	}
	if (ast.type === 'member') {
		return rootedAtBinding(ast.recv, session);
	}
	return false;
}

function interpolateStep(step:Step, session:ArcSession):Step {
	if (!session.fail && session.bindings.size === 0) {
		return step;
	}
	const catalog = liveCatalog(session);
	if (!catalog) {
		return step;
	}
	const args = { ...step.args };
	let changed = false;
	for (const [key, value] of Object.entries(args)) {
		if (typeof value !== 'string') {
			continue;
		}
		try {
			const { ast } = parse(value);
			if (!rootedAtBinding(ast, session)) {
				continue;
			}
			const r = evaluate(value, catalog);
			if (r.error) {
				continue;
			}
			const prose = argKind(session.verbs?.get(step.verb), key) === 'text';
			args[key] = r.value.kind === 'entity' && !prose ? r.value.value.id : stringifyVal(r.value, catalog);
			changed = true;
		}
		catch {
			continue;
		}
	}
	return changed ? { ...step, args } : step;
}

async function drainPending(
	session:ArcSession,
	execute:StepExecutor,
	depth:number,
):Promise<ArcResult | undefined> {
	while (session.pending) {
		const pending = session.pending;
		session.pending = undefined;
		if (pending.kind === 'abort') {
			return { status: 'stopped', verb: session.running.at(-1) ? 'when' : '' };
		}
		startRunning(session, pending.handler);
		// What the reaction runs is its own: a race of the step it cut short does not stop it.
		const signal = session.signal;
		const races = session.races;
		session.signal = undefined;
		session.races = [];
		try {
			const result = await runFrame(pending.handler.arc, execute, session, depth + 1);
			// Stopped, the reaction ends here; what it cut short goes on, unless its program was replaced.
			if (result.status === 'stopped' && session.ended) {
				return result;
			}
		}
		finally {
			session.signal = signal;
			session.races = races;
			stopRunning(session);
		}
	}
	return undefined;
}

async function pumpHandlers(
	session:ArcSession,
	execute:StepExecutor,
	depth:number,
):Promise<ArcResult | undefined> {
	for (let n = 0; n < 32; n++) {
		pollArcSession(session);
		if (!session.pending) {
			return undefined;
		}
		const before = await drainPending(session, execute, depth);
		if (before) {
			return before;
		}
	}
	return { status: 'failed', verb: 'when', reason: 'handler pump cap' };
}

/** Verbs whose `until` is their reaction's, not a race of the step: the step itself ends at once. */
const REACTION_VERBS:ReadonlySet<string> = new Set(['when', 'law']);

/** How often a race asks its `until` without a game clock to wait on (ms). */
const RACE_POLL_MS = 10;

/**
 * A step racing the args the runtime gives every verb: `until`, a watch that stops it once it holds, and `within`,
 * game seconds after which it stops; and, for an endless verb in a reaction, that `reaction`'s trigger, which stops it
 * once it no longer holds. `cause` is what stopped it; `stop` aborts the signal its verb was handed.
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

function raceOf(step:Step, session:ArcSession):Race | undefined {
	const until = typeof step.args.until === 'string' ? step.args.until.trim() : '';
	const within = typeof step.args.within === 'number' ? step.args.within : undefined;
	const endless = !!session.verbs?.get(step.verb)?.endless;
	const reaction = endless ? session.running.at(-1) : undefined;
	if (REACTION_VERBS.has(step.verb) || (!until && within === undefined && !reaction)) {
		return undefined;
	}
	const stop = new AbortController();
	const outer = session.signal;
	outer?.addEventListener('abort', () => stop.abort(outer.reason), { once: true });
	const now = session.now();
	const hold = typeof step.args.unbreakable === 'string' ? durationSeconds(step.args.unbreakable) ?? 0 : 0;
	return { until, within, deadline: within === undefined ? Infinity : now + within, reaction, endless, holdUntil: now + hold, stop };
}

/** Whether `race` is over now: its time is up, its `until` holds, or its reaction's trigger does not. It notes which. */
function raceOver(race:Race, session:ArcSession):boolean {
	if (!race.cause && session.now() >= race.deadline) {
		race.cause = 'within';
	}
	// Its watches at its start, then each time its director asks watches (every tick without one).
	const watchedAt = session.watchedAt?.();
	if (race.cause || (watchedAt !== undefined && race.watchedAt === watchedAt)) {
		return !!race.cause;
	}
	race.watchedAt = watchedAt;
	if (race.reaction && session.shields === 0 && session.now() >= race.holdUntil && !triggerHolds(race.reaction, session)) {
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
 * done when its `until` held or its trigger went, failed when its time ran out, unless it is endless: then that is
 * how it ends.
 */
function raceResult(race:Race, step:Step, result?:ArcResult):ArcResult {
	if (result?.status === 'ok') {
		return result;
	}
	if (race.cause === 'until' || race.cause === 'trigger' || (race.cause === 'within' && race.endless && !race.until)) {
		return { status: 'ok', verb: step.verb, reason: race.cause === 'within' ? `${race.within}s` : race.cause };
	}
	return { status: 'failed', verb: step.verb, reason: race.until ? `until not met after ${race.within}s` : `not done after ${race.within}s` };
}

/** Resolves once game time moves on, or after a moment without a game clock. */
function nextTick(session:ArcSession):Promise<void> {
	return session.nextTime?.() ?? new Promise<void>((resolve) => {
		setTimeout(resolve, RACE_POLL_MS);
	});
}

/**
 * `running`, stopped once `race` is over: the signal its verbs were handed aborts, which stops the host's part. While a
 * reaction has the step, or one is due, the race waits: what stops the step does not stop the reaction.
 */
async function raced(race:Race, running:Promise<ArcResult>, session:ArcSession):Promise<ArcResult> {
	let settled = false;
	void running.then(() => {
		settled = true;
	}, () => {
		settled = true;
	});
	const above = session.running.length;
	while (!settled && !session.ended) {
		await Promise.race([running, nextTick(session)]);
		if (settled || session.ended || session.pending || session.running.length > above) {
			continue;
		}
		if (raceOver(race, session)) {
			race.stop.abort(race.cause);
			break;
		}
	}
	return running;
}

/** One step, raced against its `until` and `within` when it has them. */
async function execStep(
	step:Step,
	execute:StepExecutor,
	session:ArcSession,
	depth:number,
):Promise<ArcResult> {
	const before = await pumpHandlers(session, execute, depth);
	if (before) {
		return before;
	}
	// A step inside one whose race is over runs no more: steps that end at once would otherwise go on and on.
	const over = session.races.find((race) => raceOver(race, session));
	over?.stop.abort(over.cause);
	if (session.signal?.aborted) {
		return { status: 'stopped', verb: step.verb };
	}
	const race = raceOf(step, session);
	if (!race) {
		return runStep(step, execute, session, depth);
	}
	if (raceOver(race, session)) {
		return raceResult(race, step);
	}
	const outer = session.signal;
	session.signal = race.stop.signal;
	session.races.push(race);
	try {
		const result = await raced(race, runStep(step, execute, session, depth, race), session);
		return race.cause && !session.ended ? raceResult(race, step, result) : result;
	}
	finally {
		session.signal = outer;
		session.races.pop();
	}
}

async function runStep(
	step:Step,
	execute:StepExecutor,
	session:ArcSession,
	depth:number,
	race?:Race,
):Promise<ArcResult> {
	if (step.verb === 'loop') {
		return runLoop(step, execute, session, depth);
	}
	if (step.verb === CHOOSE_VERB) {
		return runChoose(step, execute, session, depth);
	}
	if (step.verb === IF_VERB) {
		return runIf(step, execute, session, depth);
	}
	for (;;) {
		// A reaction that came due since the step was asked for goes first.
		if (session.pending) {
			const stolen = await drainPending(session, execute, depth);
			if (stolen) {
				return stolen;
			}
			if (race && raceOver(race, session)) {
				return { status: 'stopped', verb: step.verb };
			}
			continue;
		}
		const live = interpolateStep(step, session);
		const token = session.token;
		// Its own signal, so a reaction or a new program that comes before the host has even begun it still stops it.
		const stop = new AbortController();
		const outer = session.signal;
		outer?.addEventListener('abort', () => stop.abort(outer.reason), { once: true });
		if (outer?.aborted) {
			stop.abort(outer.reason);
		}
		session.stepStop = stop;
		const result = withVerb(await execute(live, stop.signal), live);
		if (session.stepStop === stop) {
			session.stepStop = undefined;
		}
		const stolen = await afterSteal(session, execute, depth, token);
		// A step that had done what it does is done. One a reaction cut short is suspended, and goes on now the reaction is
		// over, unless its race ended meanwhile. A program replaced instead ends it.
		if (stolen || result.status !== 'stopped' || session.token === token || (race && raceOver(race, session))) {
			return stolen ?? result;
		}
	}
}

/**
 * After a wait in which a reaction may have come due (the session's token moved from `token`): it runs first. A
 * `stopped` result when the program was replaced or the reaction under way was stopped; else `undefined`, and the
 * step that waited goes on.
 */
async function afterSteal(session:ArcSession, execute:StepExecutor, depth:number, token:number):Promise<ArcResult | undefined> {
	return session.token === token && !session.pending ? undefined : drainPending(session, execute, depth);
}

/** A query as a step: it worked while its watch holds. A `let` on it names the value, not only whether it held. */
function runTest(step:Step, session:ArcSession):ArcResult {
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
 * `if (cond) { arc } else { else }`: `cond` runs as steps, and whether it worked picks the branch. Without an `else`, a
 * `cond` that failed ends the `if` as done; in an `else`, `fail` is why `cond` failed.
 */
async function runIf(
	step:Step,
	execute:StepExecutor,
	session:ArcSession,
	depth:number,
):Promise<ArcResult> {
	const { cond, arc, else: otherwise } = step.args;
	if (!isArc(cond) || !isArc(arc)) {
		return { status: 'failed', verb: IF_VERB, reason: 'if needs cond and arc' };
	}
	const asked = await runFrame(cond, execute, session, depth + 1);
	if (endsChain(asked)) {
		return asked;
	}
	if (asked.status === 'ok') {
		return runFrame(arc, execute, session, depth + 1);
	}
	if (!isArc(otherwise)) {
		return { status: 'ok', verb: IF_VERB };
	}
	const outer = session.fail;
	session.fail = { verb: asked.verb ?? '', reason: asked.reason ?? '' };
	try {
		return await runFrame(otherwise, execute, session, depth + 1);
	}
	finally {
		session.fail = outer;
	}
}

/** Ask `session.pick` for a name, then run the choice under it. A choice gone stale while asking does not run. */
async function runChoose(
	step:Step,
	execute:StepExecutor,
	session:ArcSession,
	depth:number,
):Promise<ArcResult> {
	const fail = (reason:string):ArcResult => ({ status: 'failed', verb: CHOOSE_VERB, reason });
	if (!session.pick) {
		return fail('no System One model');
	}
	const choices = withLoneWait(choicesOf(step));
	let name:string;
	// A pick a reaction ran through is stale: it is asked again.
	for (;;) {
		const token = session.token;
		// A loop of instant choices waits for game time to move instead of asking again at once.
		while (session.now() === session.lastPickAt) {
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 10);
			});
			const stolen = await afterSteal(session, execute, depth, token);
			if (stolen) {
				return stolen;
			}
		}
		session.lastPickAt = session.now();
		try {
			name = await session.pick(typeof step.args.goal === 'string' ? step.args.goal : '', choices, session.lastChoice);
		}
		catch (err) {
			return await afterSteal(session, execute, depth, token)
				?? fail(`System One: ${err instanceof Error ? err.message : String(err)}`);
		}
		const stolen = await afterSteal(session, execute, depth, token);
		if (stolen) {
			return stolen;
		}
		if (session.token === token) {
			break;
		}
	}
	if (!Object.hasOwn(choices, name)) {
		return fail(`unknown choice '${name}'`);
	}
	const result = await runFrame(choices[name], execute, session, depth + 1);
	session.lastChoice = { name, result };
	return result;
}

function parseThrough(through:string):{ name:string; expr:string } | undefined {
	const m = /^([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]+)$/.exec(through.trim());
	if (!m) {
		return undefined;
	}
	return { name: m[1], expr: m[2].trim() };
}

/** Failures in a row a `loop` goes on through when each says going round again may help, and how long it waits between (s). */
const LOOP_RETRIES = 5;
const LOOP_RETRY_WAIT = 1;

/**
 * Whether the trigger of `reaction` still holds. In a reaction's arc, at any depth, what would otherwise go on and on
 * goes on only while it does: a loop asks before each round, and an endless verb (`VerbDef.endless`) stops once it no
 * longer holds.
 */
function triggerHolds(reaction:ArcHandler, session:ArcSession):boolean {
	const catalog = liveCatalog(session);
	return !catalog || watchIsTrue(reaction.watch, catalog);
}

/**
 * Whether round `round` (from 0) of a loop that began at `since` is unbreakable: inside one, or by its own
 * `unbreakable` (`true`, a number of rounds first, or seconds first).
 */
function held(session:ArcSession, unbreakable:StepArg | undefined, round:number, since:number):boolean {
	return session.shields > 0 || unbreakable === true || (typeof unbreakable === 'number' && round < unbreakable)
		|| (typeof unbreakable === 'string' && session.now() < since + (durationSeconds(unbreakable) ?? 0));
}

/** Whether a loop goes round: outside a reaction always; in one when the round is `held`, or its trigger holds. */
function goesRound(session:ArcSession, hold:boolean):boolean {
	const reaction = session.running.at(-1);
	return !reaction || hold || triggerHolds(reaction, session);
}

/** A loop round: a `held` one shields what runs in it, loops and endless verbs, from the trigger. */
async function round(session:ArcSession, hold:boolean, run:()=>Promise<ArcResult>):Promise<ArcResult> {
	session.shields += Number(hold);
	try {
		return await run();
	}
	finally {
		session.shields -= Number(hold);
	}
}

async function runLoop(
	step:Step,
	execute:StepExecutor,
	session:ArcSession,
	depth:number,
):Promise<ArcResult> {
	const inner = isArc(step.args.arc) ? step.args.arc : undefined;
	if (!inner) {
		return { status: 'failed', verb: 'loop', reason: 'loop needs arc' };
	}
	const through = typeof step.args.through === 'string' ? step.args.through : '';
	const times = typeof step.args.times === 'number' ? step.args.times : undefined;
	const since = session.now();
	if (through) {
		const parsed = parseThrough(through);
		if (!parsed) {
			return { status: 'failed', verb: 'loop', reason: 'through needs x in expr' };
		}
		const catalog = liveCatalog(session);
		if (!catalog) {
			return { status: 'failed', verb: 'loop', reason: 'through needs a catalog' };
		}
		const listed = evaluate(parsed.expr, catalog);
		if (listed.error || listed.value.kind !== 'list') {
			return { status: 'failed', verb: 'loop', reason: listed.error?.message ?? 'through expr is not a list' };
		}
		const items = listed.value.value;
		const cap = catalog.listCap ?? LIST_CAP;
		if (items.length > cap) {
			return { status: 'failed', verb: 'loop', reason: 'through list cap' };
		}
		let last:ArcResult = { status: 'ok', verb: 'loop' };
		for (let i = 0; i < items.length; i++) {
			const hold = held(session, step.args.unbreakable, i, since);
			if ((times !== undefined && i >= times) || !goesRound(session, hold)) {
				break;
			}
			session.bindings.set(parsed.name, items[i]);
			try {
				last = await round(session, hold, () => runFrame(inner, execute, session, depth + 1));
			}
			finally {
				session.bindings.delete(parsed.name);
			}
			session.passes.set(step, (session.passes.get(step) ?? 0) + 1);
			if (last.status === 'stopped') {
				return last;
			}
			if (last.status !== 'ok') {
				return last;
			}
		}
		return { ...last, verb: last.verb ?? 'loop' };
	}
	let i = 0;
	let missed = 0;
	let last:ArcResult = { status: 'ok', verb: 'loop' };
	while (true) {
		const hold = held(session, step.args.unbreakable, i, since);
		if ((times !== undefined && i >= times) || !goesRound(session, hold)) {
			return { ...last, verb: last.verb ?? 'loop' };
		}
		const clock = session.now();
		last = await round(session, hold, () => runFrame(inner, execute, session, depth + 1));
		i += 1;
		session.passes.set(step, i);
		if (last.status === 'stopped') {
			return last;
		}
		if (last.status !== 'ok') {
			missed += 1;
			if (!last.retry || missed > LOOP_RETRIES || !session.nextTime) {
				return last;
			}
			const token = session.token;
			const from = session.now();
			while (session.now() < from + LOOP_RETRY_WAIT) {
				await session.nextTime();
				const stolen = await afterSteal(session, execute, depth, token);
				if (stolen) {
					return stolen;
				}
			}
			continue;
		}
		missed = 0;
		if (session.now() === clock) {
			// An iteration that took no game time: the next waits for game time to move.
			await (session.nextTime?.() ?? new Promise<void>((resolve) => {
				setTimeout(resolve, 0);
			}));
		}
	}
}

/** Whether a step that went this way ends every chain it is in: its program was replaced, or a reaction cut it short. */
function endsChain(result:ArcResult):boolean {
	return result.status === 'stopped';
}

/**
 * The step a chain runs after step `i`, by standard short-circuit precedence over the flat list: `&&` binds tighter
 * than `||`, and `;` is lowest. A step that worked skips its `||` alternatives, to the step after the next `;`; one that
 * failed skips the rest of its `&&` run, to the step after the next `||` or `;`. `arc.length` when none is left.
 */
function nextStep(arc:Arc, i:number, ok:boolean):number {
	const join = arc[i].then ?? 'if_ok';
	if (join === 'always' || (join === 'if_ok') === ok) {
		return i + 1;
	}
	const stops:Join[] = ok ? ['always'] : ['always', 'if_failed'];
	for (let j = i + 1; j < arc.length - 1; j++) {
		if (stops.includes(arc[j].then ?? 'if_ok')) {
			return j + 1;
		}
	}
	return arc.length;
}

/**
 * Run `arc` step by step, each join read as in JavaScript ({@link nextStep}). The chain's result is the last step's.
 * `fail` is the latest failure in it, kept to its end, and what it was outside the chain once the chain is done. A
 * step's `let` name holds its result from then to the chain's end.
 */
async function runChain(
	arc:Arc,
	execute:StepExecutor,
	session:ArcSession,
	depth:number,
):Promise<ArcResult> {
	const outer = session.fail;
	const named:string[] = [];
	let result:ArcResult = { status: 'ok' };
	try {
		for (let i = 0; i < arc.length; i = nextStep(arc, i, result.status === 'ok')) {
			const step = arc[i];
			const inner = groupArc(step);
			result = inner ? await runFrame(inner, execute, session, depth + 1)
				: step.verb === TEST_VERB ? runTest(step, session)
					: step.verb === 'when' ? registerWhen(step, session)
						: await execStep(step, execute, session, depth);
			if (endsChain(result)) {
				return result;
			}
			if (step.let) {
				named.push(step.let);
				if (step.verb !== TEST_VERB) {
					session.bindings.set(step.let, { kind: 'bool', value: result.status === 'ok' });
				}
			}
			if (result.status === 'failed') {
				session.fail = { verb: result.verb ?? firstStep([step])?.verb ?? '', reason: result.reason ?? '' };
			}
		}
		return result;
	}
	finally {
		session.fail = outer;
		for (const name of named) {
			session.bindings.delete(name);
		}
	}
}

async function runFrame(
	arc:Arc,
	execute:StepExecutor,
	session:ArcSession,
	depth:number,
):Promise<ArcResult> {
	const frame:{ handlers:ArcHandler[] } = { handlers: [] };
	session.frames.push(frame);
	try {
		// As written when it starts: steps appended to it meanwhile run from its next time round.
		const result = await runChain([...arc], execute, session, depth);
		// Its `when`s outlive a program's own body, until the program is replaced.
		if (depth === 0 && result.status !== 'stopped' && frame.handlers.length > 0) {
			session.parked = true;
			void keepWatching(session, execute, frame);
		}
		return result;
	}
	finally {
		if (!(session.parked && depth === 0)) {
			session.frames.pop();
		}
	}
}

/**
 * A parked program's `when`s, run as they come due, until the program is replaced or none of them can fire again: asked
 * each time its director asks watches (`watchedAt`), every tick without one, and at once when a reaction is due
 * already. Only by a game clock (`nextTime`): without one a session is polled by hand.
 */
async function keepWatching(session:ArcSession, execute:StepExecutor, frame:{ handlers:ArcHandler[] }):Promise<void> {
	let asked:number | undefined;
	while (!session.ended && frame.handlers.some((h) => !handlerFinished(h))) {
		const watchedAt = session.watchedAt?.();
		if (session.pending || watchedAt === undefined || watchedAt !== asked) {
			asked = watchedAt;
			const stopped = await pumpHandlers(session, execute, 0);
			if (stopped?.status === 'stopped') {
				return;
			}
		}
		if (!session.nextTime) {
			return;
		}
		await session.nextTime();
	}
}

export type RunArcOpts = {
	session?:ArcSession;
	asHandler?:ArcHandler;
	onStep?:(step:Step)=>void;
};

export async function runArc(
	arc:Arc,
	execute:StepExecutor,
	opts:RunArcOpts = {},
):Promise<ArcResult> {
	const session = opts.session ?? createArcSession();
	const run = async (step:Step, signal?:AbortSignal):Promise<ArcResult> => {
		opts.onStep?.(step);
		return execute(step, signal);
	};
	const ordered = deferThinks(arc);
	const last = ordered.at(-1);
	// A trailing think runs after the rest, unless nothing else is left to run.
	const trail = ordered.length > 1 && last?.verb === 'think' ? last : undefined;
	const work = trail ? ordered.slice(0, -1) : ordered.length > 0 ? ordered : [{ verb: 'think', args: {} }];
	if (opts.asHandler) {
		startRunning(session, opts.asHandler);
	}
	try {
		const result = await runFrame(work, run, session, 0);
		if (!trail || result.status === 'stopped') {
			return result;
		}
		return withVerb(await run(trail), trail);
	}
	finally {
		if (opts.asHandler) {
			stopRunning(session);
		}
	}
}
