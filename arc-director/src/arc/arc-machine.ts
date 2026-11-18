import { channelOf, CHOOSE_VERB, IF_VERB, TEST_VERB, WHILE_ARG } from './stock-verbs.js';
import { neverEnds } from './validate.js';
import { choicesOf, withLoneWait } from './choose.js';
import { firstStep, groupArc, isArc, resultFromJSON, resultToJSON, type Arc, type ArcResult, type ArcResultJSON, type Join, type Step, type StepArg } from './arc-types.js';
import { namedText, namingText, readTextWithIDs } from '../character/text-with-ids.js';
import type { JsonValue } from '../json.js';
import { evaluate } from '../expr/eval.js';
import { durationSeconds } from '../expr/lex.js';
import { LIST_CAP, type ExprVal } from '../expr/expr-types.js';
import {
	createArcSession,
	handlerFinished,
	interruptArc,
	interpolateStep,
	liveCatalog,
	pollArcSession,
	raceOf,
	raceOver,
	raceResult,
	reactionArm,
	reactionOf,
	registerWhen,
	runTest,
	startRunning,
	stopRunning,
	triggerHolds,
	type ArcHandler,
	type ArcSession,
	type Race,
	type ReactionProgress,
	type StepExecutor,
} from './run.js';

/** Failures in a row a `loop` goes on through when each says going round again may help, and how long it waits between (s). */
const LOOP_RETRIES = 5;
const LOOP_RETRY_WAIT = 1;

/** How often a race asks its `until` without a game clock to wait on (ms). */
const RACE_POLL_MS = 10;

function withVerb(result:ArcResult, step:Step):ArcResult {
	return { ...result, verb: result.verb ?? step.verb };
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

/** What a waiting frame needs before it goes on: `ready` says so; `wake` is what an async driver awaits before asking again. */
type Wait = { ready:()=>boolean; wake:()=>Promise<'time' | 'task'> };

/** A frame's turn: run a frame over it, end with a result, or wait. */
type Turn = { push:Frame } | { done:ArcResult } | { wait:Wait };

/** A host call in flight. It settles in its own time; the machine notices on its next turn. */
type Task<T> = { settled:boolean; value?:T; error?:unknown; promise:Promise<'task'> };

function task<T>(running:Promise<T>):Task<T> {
	const held:Task<T> = { settled: false, promise: Promise.resolve('task') };
	held.promise = running.then((value) => {
		Object.assign(held, { settled: true, value });
		return 'task';
	}, (error:unknown) => {
		Object.assign(held, { settled: true, error });
		return 'task';
	});
	return held;
}

/** Resolves once game time moves on, or after a moment without a game clock. */
function nextTick(session:ArcSession):Promise<'time'> {
	return (session.nextTime?.() ?? sleep(RACE_POLL_MS)).then(() => 'time');
}

/** `stop` aborts once `outer` does, at once if it has. Gives back `outer`. */
function follow(stop:AbortController, outer:AbortSignal | undefined):AbortSignal | undefined {
	outer?.addEventListener('abort', () => stop.abort(outer.reason), { once: true });
	if (outer?.aborted) {
		stop.abort(outer.reason);
	}
	return outer;
}

function sleep(ms:number):Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/** A wait for game time to move on: a later tick, in a director; one clock step, in an async driver. */
function timeWait(m:ArcMachine, ready:()=>boolean, wake:()=>Promise<unknown> = () => nextTick(m.session)):Wait {
	let woke = false;
	const from = m.ticks;
	return { ready: () => woke || m.ticks > from || ready(), wake: () => wake().then(() => {
		woke = true;
		return 'time';
	}) };
}

/**
 * One node of a running program, with its state as plain data: where it is, what it carries, what it waits for. Each
 * is resumed with its child's result, or with nothing to go on from where it is. Each saves itself (`toJSON`, one
 * {@link FrameJSON} kind each) and is rebuilt by its class's static `load` ({@link LOADERS}).
 */
abstract class Frame {
	/** Set while a reaction it let in runs over it. */
	protected draining = false;

	constructor(protected readonly m:ArcMachine, public readonly depth:number) {}

	/**
	 * It goes on with its child's result. After a reaction it let in, it goes on from where it was (`afterReaction`),
	 * unless that reaction ended stopped by its program being replaced: then it ends so too.
	 */
	public enter(child?:ArcResult):Turn {
		if (!this.draining) {
			return this.resume(child);
		}
		this.draining = false;
		return child!.status === 'stopped' && this.m.session.ended ? { done: child! } : this.resume(undefined, true);
	}

	/** Its save: its kind, its {@link head} and its own state, what it shares named through `refs`. */
	public abstract toJSON(refs:Refs):FrameJSON;

	/** Back on top of a loaded machine's stack, as `head` saved it: what it holds goes back on the session. */
	public reload(head:FrameHead):void {
		this.draining = head.draining;
		this.reenter();
	}

	/** On top of the stack again, at its start or on load: what it holds goes back on the session. */
	protected reenter():void {}

	/** What every frame's save holds. */
	protected head():FrameHead {
		return { depth: this.depth, draining: this.draining };
	}

	protected abstract resume(child?:ArcResult, afterReaction?:boolean):Turn;

	/** It ends done, as soon as it can, if it runs `step` itself: what comes after it goes on (`ArcMachine.wrapUp`). */
	public wrapUp?(step:Step):void;

	/** What is pending runs first: a reaction over this frame (it resumes after it), or an abort that ends it. */
	protected drain():Turn | undefined {
		const s = this.m.session;
		const pending = s.pending;
		if (!pending) {
			return undefined;
		}
		s.pending = undefined;
		if (pending.kind === 'abort') {
			return { done: { status: 'stopped', verb: s.running.at(-1) ? 'when' : '' } };
		}
		this.draining = true;
		return { push: new ReactionFrame(this.m, this.depth + 1, pending.handler) };
	}
}

/** A reaction run over what it cut short: its arc, outside the races of the step it stopped. */
class ReactionFrame extends Frame {
	private _saved:{ signal?:AbortSignal; races:Race[] } | undefined;

	constructor(m:ArcMachine, depth:number, private readonly _handler:ArcHandler) {
		super(m, depth);
	}

	public static load(json:FrameJSON<'reaction'>, m:ArcMachine, refs:Refs):ReactionFrame {
		return new ReactionFrame(m, json.depth, refs.handlers[json.handler]);
	}

	public toJSON(refs:Refs):FrameJSON<'reaction'> {
		return { kind: 'reaction', ...this.head(), handler: refs.handlerAt(this._handler) };
	}

	protected override reenter():void {
		const s = this.m.session;
		this._saved = { signal: s.signal, races: s.races };
		s.signal = undefined;
		s.races = [];
	}

	protected resume(child?:ArcResult):Turn {
		const s = this.m.session;
		if (!this._saved) {
			startRunning(s, this._handler);
			this.reenter();
			return { push: new ChainFrame(this.m, this.depth, this._handler.arc) };
		}
		s.signal = this._saved.signal;
		s.races = this._saved.races;
		stopRunning(s);
		return { done: child! };
	}
}

/**
 * An arc run step by step, each join read as in JavaScript ({@link nextStep}). Its result is the last step's. `fail` is
 * the latest failure in it, kept to its end; a step's `let` name holds its result from then to the chain's end. A root
 * whose `when`s can still fire parks: they outlive its body until the program is replaced.
 */
class ChainFrame extends Frame {
	private readonly _arc:Arc;
	private _i = 0;
	private _result:ArcResult = { status: 'ok' };
	private readonly _named:string[] = [];
	/** The `when`s written in it so far. */
	private readonly _handlers:ArcHandler[] = [];
	private _outerFail:ArcSession['fail'];
	private _started = false;
	/** How the step it is on went, kept until the step after it is known: its join decides where it goes next. */
	private _pending:ArcResult | undefined;
	/** Wakes an async driver waiting at its open tail. */
	private _grew:(()=>void) | undefined;

	/** `open`: its steps are still being written (a reply streaming in): it waits at its end until `close`. */
	constructor(m:ArcMachine, depth:number, arc:Arc, private _open = false) {
		super(m, depth);
		// As written when it starts: steps appended to it meanwhile run from its next time round.
		this._arc = [...arc];
	}

	/** Its steps, and the one it is on. */
	public get at():{ arc:Arc; i:number } {
		return { arc: this._arc, i: this._i };
	}

	/** Its steps after the one it is on become `rest`. */
	public replaceRest(rest:Arc):void {
		this._arc.splice(this._i + 1, Infinity, ...rest);
	}

	/** More of its steps, as they are written. */
	public append(steps:Arc):void {
		this._arc.push(...steps);
		this._grew?.();
	}

	/** Its last step is written: it ends once that one has. */
	public close():void {
		this._open = false;
		this._grew?.();
	}

	public static load(json:FrameJSON<'chain'>, m:ArcMachine, refs:Refs):ChainFrame {
		const frame = new ChainFrame(m, json.depth, json.arc.map((path) => refs.step(path)), json.open);
		({ started: frame._started, i: frame._i } = json);
		frame._result = resultFromJSON(json.result);
		frame._pending = json.pending && resultFromJSON(json.pending);
		frame._named.push(...json.named);
		frame._handlers.push(...json.handlers.map((at) => refs.handlers[at]));
		frame._outerFail = failFromJSON(json.outerFail);
		return frame;
	}

	public toJSON(refs:Refs):FrameJSON<'chain'> {
		return {
			kind: 'chain', ...this.head(), arc: this._arc.map((step) => refs.path(step)), open: this._open, started: this._started, i: this._i,
			result: resultToJSON(this._result), pending: this._pending && resultToJSON(this._pending), named: [...this._named],
			handlers: this._handlers.map((handler) => refs.handlerAt(handler)), outerFail: failToJSON(this._outerFail),
		};
	}

	protected override reenter():void {
		this.m.session.frames.push({ handlers: this._handlers });
	}

	protected resume(child?:ArcResult):Turn {
		const s = this.m.session;
		if (!this._started) {
			this._started = true;
			this.reenter();
			this._outerFail = s.fail;
		}
		else if (child) {
			const end = this.take(this._arc[this._i], child);
			if (end) {
				return end;
			}
		}
		for (;;) {
			const pending = this._pending;
			if (pending || this._i >= this._arc.length) {
				// At its open end: the next step, or what joins this one to it, is still being written.
				if (this._open && this._arc.length <= this._i + Number(!!pending)) {
					return { wait: { ready: () => !this._open || this._arc.length > this._i + Number(!!pending), wake: () => new Promise((wake) => {
						this._grew = () => wake('task');
					}) } };
				}
				if (!pending) {
					return this.finish(this._result);
				}
				this._pending = undefined;
				this._i = nextStep(this._arc, this._i, pending.status === 'ok');
				continue;
			}
			const step = this._arc[this._i];
			const turn = stepTurn(this.m, this.depth, step);
			if ('push' in turn) {
				return turn;
			}
			const end = this.take(step, turn.done);
			if (end) {
				return end;
			}
		}
	}

	/**
	 * `step` went as `result`: the chain's end if it stopped (its program was replaced, or a reaction cut it short), else
	 * on to the step it leads to.
	 */
	private take(step:Step, result:ArcResult):Turn | undefined {
		const s = this.m.session;
		this._result = result;
		if (result.status === 'stopped') {
			return this.finish(result);
		}
		if (step.let) {
			this._named.push(step.let);
			if (step.verb !== TEST_VERB) {
				s.bindings.set(step.let, { kind: 'bool', value: result.status === 'ok' });
			}
		}
		if (result.status === 'failed') {
			s.fail = { verb: result.verb ?? firstStep([step])?.verb ?? '', reason: result.reason ?? '' };
		}
		this._pending = result;
		return undefined;
	}

	private finish(result:ArcResult):Turn {
		const s = this.m.session;
		s.fail = this._outerFail;
		for (const name of this._named) {
			s.bindings.delete(name);
		}
		if (this.depth === 0 && result.status !== 'stopped' && this._handlers.length > 0) {
			s.parked = true;
			this.m.park(this._handlers);
		}
		if (!(s.parked && this.depth === 0)) {
			s.frames.pop();
		}
		return { done: result };
	}
}

/** How a chain runs `step`: a frame over it, or its result at once (a query, a `when` set up). One with a `while` runs through an {@link ExecFrame}. */
function stepTurn(m:ArcMachine, depth:number, step:Step):{ push:Frame } | { done:ArcResult } {
	return isArc(step.args[WHILE_ARG]) || !(groupArc(step) || step.verb === TEST_VERB || step.verb === 'when') ? { push: new ExecFrame(m, depth, step) } : bodyTurn(m, depth, step);
}

/** How `step` itself runs, its race on: its group's chain, a control frame (loop, choose, if) or the host; a query or a `when` at once. */
function bodyTurn(m:ArcMachine, depth:number, step:Step, race?:Race):{ push:Frame } | { done:ArcResult } {
	m.session.onStepRun?.(step);
	const inner = groupArc(step);
	if (inner) {
		return { push: new ChainFrame(m, depth + 1, inner) };
	}
	if (step.verb === TEST_VERB || step.verb === 'when') {
		return { done: step.verb === TEST_VERB ? runTest(step, m.session) : registerWhen(step, m.session) };
	}
	const Control = ({ loop: LoopFrame, [CHOOSE_VERB]: ChooseFrame, [IF_VERB]: IfFrame } as Record<string, new (m:ArcMachine, depth:number, step:Step)=>Frame>)[step.verb];
	return { push: Control ? new Control(m, depth, step) : new HostFrame(m, depth, step, race) };
}

/**
 * `A while B while C`: step A and the parts of its {@link WHILE_ARG} ({@link partsOf}) start at once, each part in a
 * machine of its own on the same world, clock, names and channels, where a step waits while another part holds a channel
 * it needs (`HostFrame`). It ends once all have, ok only if all are, else as the first to fail; a stopped A stops the
 * rest. A's `until` and `within` end them all (its race is on the {@link ExecFrame} under it), and a reaction over it
 * holds them all.
 */
class ParallelFrame extends Frame {
	/** The parts' machines, each while it runs: saved with this frame, each as a save of its own. */
	private _parts:(ArcMachine | undefined)[] = [];
	private _tasks:(Task<ArcResult> | undefined)[] = [];
	private _begun = false;
	/** The reactions running when it began: one more runs over it. */
	private _above = 0;
	/** How A went, once it has. */
	private _result:ArcResult | undefined;
	/** The first part to fail. */
	private _failed:ArcResult | undefined;

	constructor(m:ArcMachine, depth:number, private readonly _step:Step, private readonly _race:Race | undefined) {
		super(m, depth);
	}

	public static load(json:FrameJSON<'parallel'>, m:ArcMachine, refs:Refs):ParallelFrame {
		const frame = new ParallelFrame(m, json.depth, refs.step(json.step), refs.race(json.race));
		({ begun: frame._begun, above: frame._above } = json);
		frame._result = json.result && resultFromJSON(json.result);
		frame._failed = json.failed && resultFromJSON(json.failed);
		frame._parts = json.parts.map((saved) => {
			const part:ArcMachine | undefined = saved ? restoreArc(saved, m.program, (step, signal) => frame.run(part!, step, signal), partSession(m.session), refs.laws, refs.law) : undefined;
			return part;
		});
		return frame;
	}

	public toJSON(refs:Refs):FrameJSON<'parallel'> {
		return {
			kind: 'parallel', ...this.head(), step: refs.path(this._step), race: refs.raceAt(this._race), begun: this._begun, above: this._above,
			result: this._result && resultToJSON(this._result), failed: this._failed && resultToJSON(this._failed),
			parts: this._parts.map((part) => part?.toJSON(refs.laws) ?? null),
		};
	}

	/** The parts start, or loaded go on from where they were, once A has had its turn: A's step takes its channels first. */
	protected override reenter():void {
		this._tasks = this._parts.map((part, i) => part && task(Promise.resolve().then(() => drive(part)).then((result) => this.ended(result)).finally(() => {
			this._parts[i] = undefined;
		})));
	}

	protected resume(child?:ArcResult):Turn {
		const s = this.m.session;
		if (!this._begun) {
			this._begun = true;
			this._above = s.running.length;
			this._parts = partsOf(this._step.args[WHILE_ARG] as Arc).map((part) => {
				const machine:ArcMachine = new ArcMachine(partSession(s), (step, signal) => this.run(machine, step, signal), this.m.program, (b) => (part.alone ? new ExecFrame(b, 1, part.alone, true) : new ChainFrame(b, 1, part.arc!)));
				return machine;
			});
			this.reenter();
			const turn = bodyTurn(this.m, this.depth, this._step, this._race);
			if ('push' in turn) {
				return turn;
			}
			child = turn.done;
		}
		if (child) {
			this._result = this.ended(child);
		}
		const result = this._result!;
		const running = this._tasks.filter((part):part is Task<ArcResult> => !!part && !part.settled);
		if (running.length === 0 || result.status === 'stopped' || s.signal?.aborted) {
			this.stopParts();
			return { done: result.status === 'stopped' ? result : this._failed ?? result };
		}
		const drain = this.drain();
		if (drain) {
			if ('done' in drain) {
				this.stopParts();
			}
			return drain;
		}
		return { wait: { ready: () => running.every((part) => part.settled) || !!s.pending || !!s.signal?.aborted, wake: () => Promise.race([...running.map((part) => part.promise), nextTick(s)]) } };
	}

	/** A part ended as `result`: the first to fail is the whole's. */
	private ended(result:ArcResult):ArcResult {
		this._failed ??= result.status === 'failed' ? result : undefined;
		return result;
	}

	/**
	 * How `part` runs a step: as the program does, and none once the program has ended. While a reaction runs over A,
	 * every part is held: a step of it under way is cut short, and runs again once the reaction is done.
	 */
	public async run(part:ArcMachine, step:Step, signal?:AbortSignal):Promise<ArcResult> {
		const s = this.m.session;
		while (this.held()) {
			await nextTick(s);
		}
		if (s.ended) {
			return { status: 'stopped', verb: step.verb };
		}
		const stop = new AbortController();
		follow(stop, signal);
		const call = task(this.m.execute(step, stop.signal));
		while (!call.settled) {
			await Promise.race([call.promise, nextTick(s)]);
			if (!call.settled && !stop.signal.aborted && this.held()) {
				// A new token makes the part's host frame run it again (`HostFrame.decide`), and it waits here first.
				part.session.token += 1;
				stop.abort('stopped');
			}
		}
		if (call.error !== undefined) {
			throw call.error;
		}
		return call.value!;
	}

	/** Whether a reaction runs over it, while the program goes on. */
	private held():boolean {
		const s = this.m.session;
		return !s.ended && s.running.length > this._above;
	}

	private stopParts():void {
		this._parts.forEach((part, i) => {
			this._parts[i] = undefined;
			if (part && !this._tasks[i]?.settled) {
				part.session.ended = true;
				interruptArc(part.session, { kind: 'abort' });
			}
		});
	}
}

/**
 * The parts of a `while` arc, each run at once: the arc; or, where it is one step with a `while` of its own and no
 * `until` or `within` that would end that one alone, that step without it and its own parts. So `A while B while C`
 * runs A, B and C side by side.
 */
function partsOf(arc:Arc):{ alone?:Step; arc?:Arc }[] {
	const [only] = arc;
	return arc.length === 1 && isArc(only.args[WHILE_ARG]) && only.args.until === undefined && only.args.within === undefined
		? [{ alone: only }, ...partsOf(only.args[WHILE_ARG])]
		: [{ arc }];
}

/** The channels `step` holds while it runs: its verb's, and any the session's `extraLanes` adds; none without verbs to ask. */
function lanesOf(s:ArcSession, step:Step):string[] {
	if (!s.verbs) {
		return [];
	}
	const channel = channelOf(s.verbs.find(step.verb));
	return [channel, ...s.extraLanes?.(step, channel) ?? []].filter(Boolean);
}

/** The session B of `A while B` runs on: `s`'s world, clock and channels, and the names its arc gave so far. */
function partSession(s:ArcSession):ArcSession {
	const part = createArcSession({ verbs: s.verbs, catalog: s.catalog, now: s.now, watchedAt: s.watchedAt, nextTime: s.nextTime, pick: s.pick, onStepRun: s.onStepRun });
	part.bindings = new Map(s.bindings);
	part.fail = s.fail;
	part.lanes = s.lanes;
	part.extraLanes = s.extraLanes;
	return part;
}

/**
 * One step: reactions that came due run first, then the step, raced against its `until` and `within` when it has them
 * (an endless verb in a reaction also against that reaction's trigger).
 */
class ExecFrame extends Frame {
	private _rounds = 0;
	private _race:Race | undefined;
	private _outer:AbortSignal | undefined;
	/** The reactions running when its race began: one over it holds the race. */
	public above = 0;
	private _running = false;

	/** `alone`: a part of a {@link ParallelFrame} that runs its step without the `while` it holds, which runs beside. */
	constructor(m:ArcMachine, depth:number, private readonly _step:Step, private readonly _alone = false) {
		super(m, depth);
	}

	public static load(json:FrameJSON<'exec'>, m:ArcMachine, refs:Refs):ExecFrame {
		const frame = new ExecFrame(m, json.depth, refs.step(json.step), json.alone);
		({ rounds: frame._rounds, above: frame.above, running: frame._running } = json);
		frame._race = refs.race(json.race);
		return frame;
	}

	public get race():Race | undefined {
		return this._running ? this._race : undefined;
	}

	public toJSON(refs:Refs):FrameJSON<'exec'> {
		return { kind: 'exec', ...this.head(), step: refs.path(this._step), alone: this._alone, rounds: this._rounds, race: refs.raceAt(this._race), above: this.above, running: this._running };
	}

	/** Its race on the session, the one its steps are asked against first; the race stops when the one outside it does. */
	protected override reenter():void {
		const s = this.m.session;
		const race = this.race;
		if (race) {
			this._outer = follow(race.stop, s.signal);
			s.signal = race.stop.signal;
			s.races.push(race);
		}
	}

	protected resume(child?:ArcResult):Turn {
		const s = this.m.session;
		const step = this._step;
		if (this._running) {
			this._running = false;
			if (!this._race) {
				return { done: child! };
			}
			s.signal = this._outer;
			s.races.pop();
			return { done: this._race.cause && !s.ended ? raceResult(this._race, step, child) : child! };
		}
		if (this._rounds++ >= HANDLER_ROUNDS) {
			return { done: { status: 'failed', verb: 'when', reason: 'handler pump cap' } };
		}
		pollArcSession(s);
		const drain = this.drain();
		if (drain) {
			return drain;
		}
		// A step inside one whose race is over runs no more: steps that end at once would otherwise go on and on.
		const over = s.races.find((race) => raceOver(race, s));
		over?.stop.abort(over.cause);
		if (s.signal?.aborted) {
			return { done: { status: 'stopped', verb: step.verb } };
		}
		const race = raceOf(step, s);
		if (race && raceOver(race, s)) {
			return { done: raceResult(race, step) };
		}
		this._race = race;
		this._running = true;
		this.above = s.running.length;
		this.reenter();
		const turn = isArc(step.args[WHILE_ARG]) && !this._alone ? { push: new ParallelFrame(this.m, this.depth, step, race) } : bodyTurn(this.m, this.depth, step, race);
		return 'push' in turn ? turn : this.resume(turn.done);
	}
}

/**
 * A step the host runs. One a reaction cut short is suspended, and runs again once the reaction is over, unless its race
 * ended meanwhile; a program replaced instead ends it.
 */
class HostFrame extends Frame {
	private _task:Task<ArcResult> | undefined;
	private _live:Step | undefined;
	private _token = 0;
	private _stop:AbortController | undefined;
	private _result:ArcResult | undefined;
	/** Game time its host call began, and whether a load found it under way: a `wait` then waits only what was left. */
	private _since:number | undefined;
	private _loaded = false;
	/** Set once it is to end done, now (`wrapUp`). */
	private _wrapped = false;

	constructor(m:ArcMachine, depth:number, private readonly _step:Step, private readonly _race:Race | undefined) {
		super(m, depth);
	}

	public static load(json:FrameJSON<'host'>, m:ArcMachine, refs:Refs):HostFrame {
		const frame = new HostFrame(m, json.depth, refs.step(json.step), refs.race(json.race));
		({ token: frame._token, since: frame._since } = json);
		frame._result = json.result && resultFromJSON(json.result);
		return frame;
	}

	/** Whether its host call has come back: what an async driver waits on gives way to it. */
	public get settled():boolean {
		return !!this._task?.settled;
	}

	/** Its host call under way is not saved: loaded, it runs again (a `wait` only what was left). */
	public toJSON(refs:Refs):FrameJSON<'host'> {
		return { kind: 'host', ...this.head(), step: refs.path(this._step), race: refs.raceAt(this._race), token: this._token, result: this._result && resultToJSON(this._result), since: this._since };
	}

	protected override reenter():void {
		this._loaded = true;
	}

	public override wrapUp(step:Step):void {
		if (step === this._step) {
			this._wrapped = true;
			this._stop?.abort('wrapped up');
		}
	}

	protected resume(child?:ArcResult, afterReaction = false):Turn {
		const s = this.m.session;
		if (afterReaction && !this._result && this._race && raceOver(this._race, s)) {
			return { done: { status: 'stopped', verb: this._step.verb } };
		}
		if (this._result) {
			return this.decide();
		}
		if (!this._task) {
			if (this._wrapped) {
				return { done: { status: 'ok', verb: this._step.verb } };
			}
			// A reaction that came due since the step was asked for goes first.
			const drain = this.drain();
			if (drain) {
				return drain;
			}
			// Its channel held by a step running at once with it (`A while B`): it waits its turn.
			const held = ():boolean => lanesOf(s, this._step).some((lane) => s.lanes.has(lane));
			if (held()) {
				return s.signal?.aborted ? { done: { status: 'stopped', verb: this._step.verb } } : { wait: timeWait(this.m, () => !held() || !!s.pending || !!s.signal?.aborted) };
			}
			this.launch();
		}
		const running = this._task!;
		if (!running.settled) {
			// Stopped, it settles at once: no clock to wait on.
			const timed = s.races.length > 0 && !this._stop?.signal.aborted;
			return { wait: { ready: () => running.settled, wake: () => (timed ? Promise.race([running.promise, nextTick(s)]) : running.promise) } };
		}
		if (running.error !== undefined) {
			throw running.error;
		}
		this._result = this._wrapped ? { status: 'ok', verb: this._step.verb } : withVerb(running.value!, this._live!);
		if (s.stepStop === this._stop) {
			s.stepStop = undefined;
		}
		return this.decide();
	}

	private launch():void {
		const s = this.m.session;
		const live = interpolateStep(this._step, s);
		const left = this._loaded && live.verb === 'wait' && typeof live.args.seconds === 'number' && this._since !== undefined
			? Math.max(0, live.args.seconds - (s.now() - this._since))
			: undefined;
		this._loaded = false;
		this._since = left === undefined ? s.now() : this._since;
		this._live = left === undefined ? live : { ...live, args: { ...live.args, seconds: left } };
		this._token = s.token;
		// Its own signal, so a reaction or a new program that comes before the host has even begun it still stops it.
		this._stop = new AbortController();
		follow(this._stop, s.signal);
		s.stepStop = this._stop;
		const lanes = lanesOf(s, this._step);
		lanes.forEach((lane) => s.lanes.set(lane, this));
		this._task = task(this.m.execute(this._live, this._stop.signal).finally(() => {
			lanes.filter((lane) => s.lanes.get(lane) === this).forEach((lane) => s.lanes.delete(lane));
		}));
	}

	/** After the host call, a reaction that came due meanwhile runs first; then it ends, or runs again. */
	private decide():Turn {
		const s = this.m.session;
		const drain = this.drain();
		if (drain) {
			return drain;
		}
		const result = this._result!;
		if (result.status !== 'stopped' || s.token === this._token || (this._race && raceOver(this._race, s))) {
			return { done: result };
		}
		this._task = undefined;
		this._result = undefined;
		return this.resume();
	}
}

/**
 * `if (cond) { arc } else { else }`: `cond` runs as steps, and whether it worked picks the branch. Without an `else`, a
 * `cond` that failed ends the `if` as done; in an `else`, `fail` is why `cond` failed.
 */
class IfFrame extends Frame {
	private _phase:'cond' | 'branch' | 'else' | undefined;
	private _outerFail:ArcSession['fail'];

	constructor(m:ArcMachine, depth:number, private readonly _step:Step) {
		super(m, depth);
	}

	public static load(json:FrameJSON<'if'>, m:ArcMachine, refs:Refs):IfFrame {
		const frame = new IfFrame(m, json.depth, refs.step(json.step));
		frame._phase = json.phase;
		frame._outerFail = failFromJSON(json.outerFail);
		return frame;
	}

	public toJSON(refs:Refs):FrameJSON<'if'> {
		return { kind: 'if', ...this.head(), step: refs.path(this._step), phase: this._phase, outerFail: failToJSON(this._outerFail) };
	}

	protected resume(child?:ArcResult):Turn {
		const s = this.m.session;
		const { cond, arc, else: otherwise } = this._step.args;
		if (!this._phase) {
			if (!isArc(cond) || !isArc(arc)) {
				return { done: { status: 'failed', verb: IF_VERB, reason: 'if needs cond and arc' } };
			}
			this._phase = 'cond';
			return { push: new ChainFrame(this.m, this.depth + 1, cond) };
		}
		if (this._phase !== 'cond') {
			if (this._phase === 'else') {
				s.fail = this._outerFail;
			}
			return { done: child! };
		}
		if (child!.status === 'stopped') {
			return { done: child! };
		}
		if (child!.status === 'ok') {
			this._phase = 'branch';
			return { push: new ChainFrame(this.m, this.depth + 1, arc as Arc) };
		}
		if (!isArc(otherwise)) {
			return { done: { status: 'ok', verb: IF_VERB } };
		}
		this._phase = 'else';
		this._outerFail = s.fail;
		s.fail = { verb: child!.verb ?? '', reason: child!.reason ?? '' };
		return { push: new ChainFrame(this.m, this.depth + 1, otherwise) };
	}
}

/** Ask `session.pick` for a name, then run the choice under it. A pick a reaction ran through is stale: it is asked again. */
class ChooseFrame extends Frame {
	private _pick:Task<string> | undefined;
	private _token = 0;
	private _name:string | undefined;
	private _choices:Record<string, Arc> | undefined;

	constructor(m:ArcMachine, depth:number, private readonly _step:Step) {
		super(m, depth);
	}

	public static load(json:FrameJSON<'choose'>, m:ArcMachine, refs:Refs):ChooseFrame {
		const frame = new ChooseFrame(m, json.depth, refs.step(json.step));
		({ token: frame._token, name: frame._name } = json);
		return frame;
	}

	/** A pick under way is not saved: loaded, it asks again. */
	public toJSON(refs:Refs):FrameJSON<'choose'> {
		return { kind: 'choose', ...this.head(), step: refs.path(this._step), token: this._token, name: this._name };
	}

	protected resume(child?:ArcResult):Turn {
		const s = this.m.session;
		const fail = (reason:string):Turn => ({ done: { status: 'failed', verb: CHOOSE_VERB, reason } });
		if (this._name !== undefined) {
			s.lastChoice = { name: this._name, result: child! };
			return { done: child! };
		}
		if (!s.pick) {
			return fail('no System One model');
		}
		this._choices ??= withLoneWait(choicesOf(this._step));
		if (!this._pick) {
			// A loop of instant choices waits for game time to move instead of asking again at once.
			if (s.now() === s.lastPickAt) {
				const drain = this.drain();
				return drain ?? { wait: { ready: () => s.now() !== s.lastPickAt || !!s.pending, wake: () => sleep(RACE_POLL_MS).then(() => 'time' as const) } };
			}
			s.lastPickAt = s.now();
			this._token = s.token;
			this._pick = task(s.pick(typeof this._step.args.goal === 'string' ? this._step.args.goal : '', this._choices, s.lastChoice));
		}
		const picking = this._pick;
		if (!picking.settled) {
			return { wait: { ready: () => picking.settled, wake: () => picking.promise } };
		}
		const drain = this.drain();
		if (drain) {
			return drain;
		}
		if (picking.error !== undefined) {
			return fail(`System One: ${picking.error instanceof Error ? picking.error.message : String(picking.error)}`);
		}
		if (s.token !== this._token) {
			this._pick = undefined;
			return this.resume();
		}
		const name = picking.value!;
		if (!Object.hasOwn(this._choices, name)) {
			return fail(`unknown choice '${name}'`);
		}
		this._name = name;
		return { push: new ChainFrame(this.m, this.depth + 1, this._choices[name]) };
	}
}

/**
 * `loop`: its arc round and round, `times` at most, or once per item `through` names; in a reaction only while the
 * reaction's trigger holds, unless a round is unbreakable. A failed round ends it, unless it says going round again may
 * help (`retry`): then up to {@link LOOP_RETRIES} more, a second apart. A round that took no game time waits for it to move.
 */
class LoopFrame extends Frame {
	private _round = 0;
	private _missed = 0;
	private _since = 0;
	private _last:ArcResult = { status: 'ok', verb: 'loop' };
	private _items:ExprVal[] | undefined;
	private _name = '';
	private _hold = false;
	private _clock = 0;
	private _wait:Wait | undefined;
	private _started = false;
	/** Set once it is to end done after the round it is on (`wrapUp`). */
	private _wrapped = false;

	constructor(m:ArcMachine, depth:number, private readonly _step:Step) {
		super(m, depth);
	}

	public static load(json:FrameJSON<'loop'>, m:ArcMachine, refs:Refs):LoopFrame {
		const frame = new LoopFrame(m, json.depth, refs.step(json.step));
		({ started: frame._started, round: frame._round, missed: frame._missed, since: frame._since, clock: frame._clock, hold: frame._hold, items: frame._items, name: frame._name } = json);
		frame._last = resultFromJSON(json.last);
		return frame;
	}

	/** A wait between rounds is not saved: loaded, it goes round at once. */
	public toJSON(refs:Refs):FrameJSON<'loop'> {
		return {
			kind: 'loop', ...this.head(), step: refs.path(this._step), started: this._started, round: this._round, missed: this._missed, since: this._since,
			clock: this._clock, hold: this._hold, last: resultToJSON(this._last), items: this._items, name: this._name,
		};
	}

	protected resume(child?:ArcResult):Turn {
		const s = this.m.session;
		const step = this._step;
		if (!this._started) {
			this._started = true;
			const start = this.start();
			if (start) {
				return start;
			}
		}
		else if (child && !this._wait) {
			const end = this.roundEnded(child);
			if (end) {
				return end;
			}
		}
		if (this._wait) {
			if (!this._wait.ready()) {
				return { wait: this._wait };
			}
			const drain = this.drain();
			if (drain) {
				return drain;
			}
			// Going round again after a failure waits a second of game time, asking anew each step.
			if (this._missed > 0 && s.now() < this._clock + LOOP_RETRY_WAIT) {
				this._wait = timeWait(this.m, () => !!s.pending, () => s.nextTime!());
				return { wait: this._wait };
			}
			this._wait = undefined;
		}
		if (this._wrapped) {
			return { done: { status: 'ok', verb: 'loop' } };
		}
		const done = { ...this._last, verb: this._last.verb ?? 'loop' };
		this._hold = held(s, step.args.unbreakable, this._round, this._since);
		const times = typeof step.args.times === 'number' ? step.args.times : undefined;
		if ((times !== undefined && this._round >= times) || (this._items && this._round >= this._items.length) || !goesRound(s, this._hold)) {
			return { done };
		}
		if (this._items) {
			s.bindings.set(this._name, this._items[this._round]);
		}
		s.shields += Number(this._hold);
		this._clock = s.now();
		return { push: new ChainFrame(this.m, this.depth + 1, step.args.arc as Arc) };
	}

	public override wrapUp(step:Step):void {
		this._wrapped ||= step === this._step;
	}

	/** Its arc, and the list it goes through; a result when it cannot start. */
	private start():Turn | undefined {
		const s = this.m.session;
		const fail = (reason:string):Turn => ({ done: { status: 'failed', verb: 'loop', reason } });
		if (!isArc(this._step.args.arc)) {
			return fail('loop needs arc');
		}
		this._since = s.now();
		const through = typeof this._step.args.through === 'string' ? this._step.args.through : '';
		if (!through) {
			return undefined;
		}
		const [, name, expr] = /^([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]+)$/.exec(through.trim()) ?? [];
		if (!name) {
			return fail('through needs x in expr');
		}
		const catalog = liveCatalog(s);
		if (!catalog) {
			return fail('through needs a catalog');
		}
		const listed = evaluate(expr.trim(), catalog);
		if (listed.error || listed.value.kind !== 'list') {
			return fail(listed.error?.message ?? 'through expr is not a list');
		}
		if (listed.value.value.length > (catalog.listCap ?? LIST_CAP)) {
			return fail('through list cap');
		}
		this._items = listed.value.value;
		this._name = name;
		return undefined;
	}

	/** A round ended as `result`: the loop's end, or how it waits before the next. */
	private roundEnded(result:ArcResult):Turn | undefined {
		const s = this.m.session;
		s.shields -= Number(this._hold);
		if (this._items) {
			s.bindings.delete(this._name);
		}
		this._round += 1;
		s.passes.set(this._step, this._items ? (s.passes.get(this._step) ?? 0) + 1 : this._round);
		this._last = result;
		if (result.status === 'stopped' || (this._items && result.status !== 'ok')) {
			return { done: result };
		}
		if (result.status !== 'ok') {
			this._missed += 1;
			if (!result.retry || this._missed > LOOP_RETRIES || !s.nextTime) {
				return { done: result };
			}
			this._clock = s.now();
			this._wait = timeWait(this.m, () => !!s.pending, () => s.nextTime!());
			return undefined;
		}
		this._missed = 0;
		if (s.now() === this._clock && !this._items) {
			// A round that took no game time: the next waits for game time to move.
			const clock = this._clock;
			this._wait = timeWait(this.m, () => s.now() !== clock, () => s.nextTime?.() ?? sleep(0));
		}
		return undefined;
	}
}

/** A parked program's `when`s, run as they come due, until the program is replaced or none of them can fire again. */
class ParkFrame extends Frame {
	private _asked:number | undefined;
	private _rounds = 0;

	constructor(m:ArcMachine, private readonly _handlers:ArcHandler[]) {
		super(m, 0);
	}

	public static load(json:FrameJSON<'park'>, m:ArcMachine, refs:Refs):ParkFrame {
		const frame = new ParkFrame(m, json.handlers.map((at) => refs.handlers[at]));
		({ asked: frame._asked, rounds: frame._rounds } = json);
		return frame;
	}

	public toJSON(refs:Refs):FrameJSON<'park'> {
		return { kind: 'park', ...this.head(), handlers: this._handlers.map((handler) => refs.handlerAt(handler)), asked: this._asked, rounds: this._rounds };
	}

	protected override reenter():void {
		this.m.session.frames.push({ handlers: this._handlers });
	}

	/** `afterReaction`: one just ended, so it asks again at once whether another is due. */
	protected resume(child?:ArcResult, afterReaction = false):Turn {
		const s = this.m.session;
		if (s.ended || !this._handlers.some((h) => !handlerFinished(h))) {
			return { done: { status: 'ok' } };
		}
		const watchedAt = s.watchedAt?.();
		if (afterReaction || s.pending || watchedAt === undefined || watchedAt !== this._asked) {
			if (!afterReaction) {
				this._rounds = 0;
			}
			this._asked = watchedAt;
			if (this._rounds++ < HANDLER_ROUNDS) {
				pollArcSession(s);
				const drain = this.drain();
				if (drain) {
					return drain;
				}
			}
		}
		if (!s.nextTime) {
			return { done: { status: 'ok' } };
		}
		return { wait: timeWait(this.m, () => !!s.pending, () => s.nextTime!()) };
	}
}

/** The arc a session runs, its program's; as a reaction's own arc, that reaction runs for its length. */
class RootFrame extends Frame {
	private _started = false;

	constructor(m:ArcMachine, private readonly _as:ArcHandler | undefined, private readonly _open = false) {
		super(m, 0);
	}

	public static load(json:FrameJSON<'root'>, m:ArcMachine, refs:Refs):RootFrame {
		const frame = new RootFrame(m, json.as === undefined ? undefined : refs.handlers[json.as], json.open);
		frame._started = json.started;
		return frame;
	}

	public toJSON(refs:Refs):FrameJSON<'root'> {
		return { kind: 'root', ...this.head(), as: this._as && refs.handlerAt(this._as), open: this._open, started: this._started };
	}

	protected resume(child?:ArcResult):Turn {
		if (!this._started) {
			this._started = true;
			if (this._as) {
				startRunning(this.m.session, this._as);
			}
			return { push: new ChainFrame(this.m, 0, this.m.program.work, this._open) };
		}
		if (this._as) {
			stopRunning(this.m.session);
		}
		return { done: child! };
	}
}

/** Reactions run before a step at most this many times in a row, as a guard against two that keep handing over. */
const HANDLER_ROUNDS = 32;

/**
 * A running program as data: a stack of frames, each the node it runs and where it is. {@link advance} takes it as far
 * as it can go now and says what it waits for; nothing runs between calls.
 */
export class ArcMachine {
	private readonly _stack:Frame[] = [];
	private _carry:ArcResult | undefined;
	private _parked:ArcHandler[] | undefined;
	/** Times game time has moved under it: a wait for time is over once it has. */
	public ticks = 0;

	constructor(
		public readonly session:ArcSession,
		public readonly execute:StepExecutor,
		/** The program its steps are in: what a save names them by. */
		public readonly program:Program,
		root?:(m:ArcMachine)=>Frame,
	) {
		if (root) {
			this._stack.push(root(this));
		}
	}

	/** The program's own steps (its root's) and the one it is on, while its root runs; none once it has ended or parked. */
	public root():ChainFrame | undefined {
		return this._stack.find((frame):frame is ChainFrame => frame instanceof ChainFrame && frame.depth === 0);
	}

	/**
	 * The root's step under way ends done if it never ends of its own ({@link neverEnds}), so steps added after it run:
	 * an endless verb at once, a loop once its round is over. A later such step goes on as written.
	 */
	public wrapUp():void {
		const root = this.root();
		const step = root?.at.arc[root.at.i];
		if (step && neverEnds(step, this.session.verbs)) {
			this._stack.forEach((frame) => frame.wrapUp?.(step));
		}
	}

	/** `frame` on top again, as a load finds it (`head` as saved): its races and `when`s back on the session. */
	public restore(frame:Frame, head:FrameHead):void {
		this._stack.push(frame);
		frame.reload(head);
	}

	/** Its root ended with its `when`s still able to fire: they go on in a machine of their own. */
	public park(handlers:ArcHandler[]):void {
		this._parked = handlers;
	}

	/** A machine that keeps watching the `when`s its root left parked, once they are: for its driver to run beside it. */
	public takeParked():ArcMachine | undefined {
		const parked = this._parked;
		this._parked = undefined;
		return parked && new ArcMachine(this.session, this.execute, this.program, (m) => new ParkFrame(m, parked));
	}

	/**
	 * As far as it goes now: its result once done, else what it waits for. `byTime`: game time moved, so the races of the
	 * steps under way are asked whether they are over.
	 */
	public advance(byTime = false):ArcResult | Wait {
		if (byTime) {
			this.ticks += 1;
			this.askRaces();
		}
		for (;;) {
			const top = this._stack.at(-1)!;
			const carry = this._carry;
			this._carry = undefined;
			const turn = top.enter(carry);
			if ('push' in turn) {
				this._stack.push(turn.push);
				continue;
			}
			if ('done' in turn) {
				this._stack.pop();
				if (this._stack.length === 0) {
					return turn.done;
				}
				this._carry = turn.done;
				continue;
			}
			if (!turn.wait.ready()) {
				return turn.wait;
			}
		}
	}

	/**
	 * Where it is, as data ({@link ArcMachineJSON}): its frames, each as it saves itself, and its session, each step
	 * named by its path in the program or in `laws` (each law's arc by its name). A host call under way is not saved: it
	 * runs again once loaded, as one a reaction cut short. The `while` parts of a step under way are saved with its frame.
	 */
	public toJSON(laws:Readonly<Record<string, Arc>> = {}):ArcMachineJSON {
		const refs = new Refs(this.program, laws);
		const s = this.session;
		const frames = this._stack.map((frame) => frame.toJSON(refs));
		const session:SessionJSON = {
			token: s.token, fail: failToJSON(s.fail), shields: s.shields, parked: s.parked, lastPickAt: s.lastPickAt, lastStartAt: s.lastStartAt,
			lastChoice: s.lastChoice && { name: s.lastChoice.name, result: resultToJSON(s.lastChoice.result) },
			running: s.running.map((handler) => refs.handlerAt(handler)), bindings: [...s.bindings],
			passes: [...s.passes].map(([step, n]) => [refs.path(step), n]), whens: [...s.whens].map(([step, progress]) => [refs.path(step), { ...progress }]),
		};
		// In this order: a race names its reaction, and a `when` its step.
		const races = refs.races.map((race):RaceJSON => ({
			until: race.until, within: race.within, deadline: race.deadline === Infinity ? undefined : race.deadline, endless: race.endless,
			holdUntil: race.holdUntil, watchedAt: race.watchedAt, cause: race.cause, reaction: race.reaction && refs.handlerAt(race.reaction),
		}));
		const handlers = refs.handlers.map((handler):HandlerJSON => ('verb' in handler.source
			? { when: refs.path(handler.source), rank: handler.rank }
			: { law: handler.source.name, progress: handler.progress && { ...handler.progress } }));
		return { frames, session, races, handlers, steps: refs.steps };
	}

	/** Each race of a step under way that is over, while nothing holds it, stops its step. */
	private askRaces():void {
		const s = this.session;
		const top = this._stack.at(-1);
		if (s.ended || s.pending || (top instanceof HostFrame && top.settled)) {
			return;
		}
		for (const frame of [...this._stack].reverse()) {
			const race = frame instanceof ExecFrame ? frame.race : undefined;
			if (race && !race.stop.signal.aborted && s.running.length <= (frame as ExecFrame).above && raceOver(race, s)) {
				race.stop.abort(race.cause);
			}
		}
	}
}

/**
 * Runs `machine` to its end: each host call awaited, the session's clock for what takes time. The machine that watches
 * a parked root's `when`s runs beside it, handed to `onPark` first.
 */
export async function drive(machine:ArcMachine, onPark?:(parked:ArcMachine)=>void):Promise<ArcResult> {
	let byTime = false;
	for (;;) {
		const out = machine.advance(byTime);
		const parked = machine.takeParked();
		if (parked) {
			onPark?.(parked);
			void drive(parked);
		}
		if (!('wake' in out)) {
			return out;
		}
		byTime = await out.wake() === 'time';
	}
}

export type RunArcOpts = {
	session?:ArcSession;
	asHandler?:ArcHandler;
	onStep?:(step:Step)=>void;
	/** Its steps are still being written: it waits at its end for more (`ChainFrame.append`) until closed. */
	open?:boolean;
};

/** `arc` run with no director: each host call awaited, the session's clock for what takes time. */
export async function runArc(arc:Arc, execute:StepExecutor, opts:RunArcOpts = {}):Promise<ArcResult> {
	return drive(startArc(arc, execute, opts));
}

/**
 * `arc` as a machine on `opts.session` (a new one by default), for a director to advance each tick; as a
 * reaction's own arc (`asHandler`), that reaction runs for its length.
 */
export function startArc(arc:Arc, execute:StepExecutor, opts:RunArcOpts = {}):ArcMachine {
	const session = opts.session ?? createArcSession();
	const run:StepExecutor = (step, signal) => {
		opts.onStep?.(step);
		return execute(step, signal);
	};
	return new ArcMachine(session, run, { work: arc }, (m) => new RootFrame(m, opts.asHandler, opts.open));
}

/** The arc a machine runs. */
export type Program = { work:Arc };

/**
 * A saved running program (`ArcMachine.toJSON`): its frames, bottom first, and its session. What frames share is saved
 * once and named by its place: reactions in `handlers`, races in `races` (each with a new signal on load), and steps
 * by path ({@link StepPath}), the few outside the program and its laws in `steps`.
 */
export type ArcMachineJSON = { frames:FrameJSON[]; session:SessionJSON; races:RaceJSON[]; handlers:HandlerJSON[]; steps:Step[] };

/** A step by its path: in the program ("work.2.arc.0"), in a law ("law:flee.1"), or in the save's `steps` ("steps.0.0"). */
type StepPath = string;

/** What every frame's save holds beside its kind: how deep it is, and whether a reaction it let in runs over it. */
type FrameHead = { depth:number; draining:boolean };

/**
 * Each kind of frame's own state as its save holds it, by its `kind`: only what says where it is. What is under way (a
 * host call, a pick, a wait, a signal) starts again on load; reactions and races are by their place in the save.
 */
type FrameStates = {
	root:{ as?:number; open:boolean; started:boolean };
	reaction:{ handler:number };
	chain:{ arc:StepPath[]; open:boolean; started:boolean; i:number; result:ArcResultJSON; pending?:ArcResultJSON; named:string[]; handlers:number[]; outerFail?:FailJSON };
	/** `parts`: each part's machine while it runs, a save of its own. */
	parallel:{ step:StepPath; race?:number; begun:boolean; above:number; result?:ArcResultJSON; failed?:ArcResultJSON; parts:(ArcMachineJSON | null)[] };
	exec:{ step:StepPath; alone:boolean; rounds:number; race?:number; above:number; running:boolean };
	host:{ step:StepPath; race?:number; token:number; result?:ArcResultJSON; since?:number };
	if:{ step:StepPath; phase?:'cond' | 'branch' | 'else'; outerFail?:FailJSON };
	choose:{ step:StepPath; token:number; name?:string };
	loop:{ step:StepPath; started:boolean; round:number; missed:number; since:number; clock:number; hold:boolean; last:ArcResultJSON; items?:ExprVal[]; name:string };
	park:{ handlers:number[]; asked?:number; rounds:number };
};

/** A saved frame of kind `K` (any by default): its kind, its {@link FrameHead} and its own state. */
export type FrameJSON<K extends keyof FrameStates = keyof FrameStates> = { [P in K]:{ kind:P } & FrameHead & FrameStates[P] }[K];

/** Each kind of frame rebuilt from its save. */
const LOADERS:{ [K in keyof FrameStates]:(json:FrameJSON<K>, m:ArcMachine, refs:Refs)=>Frame } = {
	root: RootFrame.load, reaction: ReactionFrame.load, chain: ChainFrame.load, parallel: ParallelFrame.load, exec: ExecFrame.load,
	host: HostFrame.load, if: IfFrame.load, choose: ChooseFrame.load, loop: LoopFrame.load, park: ParkFrame.load,
};

function loadFrame<K extends keyof FrameStates>(json:FrameJSON<K>, m:ArcMachine, refs:Refs):Frame {
	return LOADERS[json.kind](json, m, refs);
}

/** A session's state as its save holds it: who runs by place in `handlers`, a loop's passes and a `when`'s runs by step. */
type SessionJSON = Pick<ArcSession, 'token' | 'shields' | 'parked' | 'lastPickAt' | 'lastStartAt'> & {
	fail?:FailJSON;
	lastChoice?:{ name:string; result:ArcResultJSON };
	running:number[];
	bindings:[string, ExprVal][];
	passes:[StepPath, number][];
	whens:[StepPath, ReactionProgress][];
};

/** A race without its signal; no `deadline` for none. */
type RaceJSON = Omit<Race, 'stop' | 'deadline' | 'reaction'> & { deadline?:number; reaction?:number };

/** A reaction: a law's by its name, a `when`'s by its step (its progress is the session's, in `whens`). */
type HandlerJSON = { law:string; progress?:ReactionProgress } | { when:StepPath; rank:number };

/** A session's `fail`, its reason's ids kept as ids. */
type FailJSON = { verb:string; reason:JsonValue };

function failToJSON(fail:ArcSession['fail']):FailJSON | undefined {
	return fail && { verb: fail.verb, reason: namedText(fail.reason) };
}

function failFromJSON(json:FailJSON | undefined):ArcSession['fail'] {
	return json && { verb: json.verb, reason: namingText(readTextWithIDs(json.reason)) };
}

/** `item`'s place in `list`, added at its end the first time. */
function placeIn<T>(list:T[], item:T):number {
	const at = list.indexOf(item);
	return at >= 0 ? at : list.push(item) - 1;
}

/**
 * How a save names what frames share, and finds it again on load: a step by its path ({@link StepPath}), one outside
 * the program and its laws (streamed or merged in) saved once in `steps`; a reaction by its place in `handlers`; a race
 * by its place in `races`.
 */
class Refs {
	public readonly handlers:ArcHandler[] = [];
	public readonly races:Race[] = [];
	public readonly steps:Step[] = [];
	private readonly _paths = new Map<Step, StepPath>();
	private readonly _steps = new Map<StepPath, Step>();

	/** `law` gives a law's reaction by name, on load; `steps`, a save's own. */
	constructor(program:Program, public readonly laws:Readonly<Record<string, Arc>>, public readonly law?:(name:string)=>ArcHandler | undefined, steps:Step[] = []) {
		this.walk(program.work, 'work');
		Object.entries(laws).forEach(([name, arc]) => this.walk(arc, `law:${name}`));
		steps.forEach((step) => this.path(step));
	}

	public path(step:Step):StepPath {
		if (!this._paths.has(step)) {
			this.walk([step], `steps.${this.steps.push(step) - 1}`);
		}
		return this._paths.get(step)!;
	}

	public step(path:StepPath):Step {
		return this._steps.get(path) ?? fail(`no step at ${path}`);
	}

	public handlerAt(handler:ArcHandler):number {
		return placeIn(this.handlers, handler);
	}

	public raceAt(race:Race | undefined):number | undefined {
		return race && placeIn(this.races, race);
	}

	public race(at:number | undefined):Race | undefined {
		return at === undefined ? undefined : this.races[at];
	}

	/** A saved reaction again: a law's from `law`, a `when`'s from its step, with its progress in `whens`. */
	public handler(json:HandlerJSON, whens:ArcSession['whens']):ArcHandler {
		if ('law' in json) {
			const handler = this.law?.(json.law) ?? fail(`no law ${json.law}`);
			return { ...handler, progress: json.progress ?? handler.progress };
		}
		const source = this.step(json.when);
		const { watch = '', arc = [], ...rest } = reactionOf(source.args);
		return { source, watch, arc, ...rest, rank: json.rank, progress: whens.get(source), arm: reactionArm(source) };
	}

	private walk(arc:Arc, at:string):void {
		arc.forEach((step, i) => {
			const path = `${at}.${i}`;
			this._paths.set(step, path);
			this._steps.set(path, step);
			Object.entries(step.args).forEach(([key, value]) => isArc(value) && this.walk(value, `${path}.${key}`));
		});
	}
}

function fail(why:string):never {
	throw new Error(`ArcDirector: a saved program does not fit: ${why}`);
}

/**
 * A program saved with `ArcMachine.toJSON`, going on from where it was on `session`. `program` and `laws` are what its
 * steps were in when saved; `law` gives a law's reaction by name. Throws when the save does not fit them.
 */
export function restoreArc(json:ArcMachineJSON, program:Program, execute:StepExecutor, session:ArcSession, laws:Readonly<Record<string, Arc>> = {}, law?:(name:string)=>ArcHandler | undefined):ArcMachine {
	const refs = new Refs(program, laws, law, json.steps);
	const s = json.session;
	const whens = new Map(s.whens.map(([path, progress]):[Step, ReactionProgress] => [refs.step(path), { ...progress }]));
	refs.handlers.push(...json.handlers.map((saved) => refs.handler(saved, whens)));
	refs.races.push(...json.races.map((race):Race => ({
		until: race.until, within: race.within, deadline: race.deadline ?? Infinity, endless: race.endless, holdUntil: race.holdUntil,
		watchedAt: race.watchedAt, cause: race.cause, reaction: race.reaction === undefined ? undefined : refs.handlers[race.reaction], stop: new AbortController(),
	})));
	Object.assign(session, {
		token: s.token, fail: failFromJSON(s.fail), shields: s.shields, parked: s.parked, lastPickAt: s.lastPickAt, lastStartAt: s.lastStartAt,
		lastChoice: s.lastChoice && { name: s.lastChoice.name, result: resultFromJSON(s.lastChoice.result) },
		running: s.running.map((at) => refs.handlers[at]), bindings: new Map(s.bindings), whens,
		passes: new Map(s.passes.map(([path, n]):[Step, number] => [refs.step(path), n])),
		frames: [], races: [], signal: undefined,
	} satisfies Partial<ArcSession>);
	const machine = new ArcMachine(session, execute, program);
	for (const frame of json.frames) {
		machine.restore(loadFrame(frame, machine, refs), frame);
	}
	return machine;
}
