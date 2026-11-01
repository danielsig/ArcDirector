import { argBase, CHOOSE_VERB, type VerbRegistry } from './stock-verbs.js';
import { choicesOf, withLoneWait } from './choose.js';
import {
	firstStep,
	groupArc,
	isArc,
	arcSteps,
	isHoistedWhen,
	type Arc,
	type ArcResult,
	type Join,
	type Step,
} from './types.js';
import { evaluate } from '../expr/eval.js';
import { parse } from '../expr/parse.js';
import { dummyEntity } from '../expr/natives.js';
import { watchScore } from '../expr/score.js';
import { stringifyVal } from '../expr/stringify.js';
import { LIST_CAP, SampleCache, type Ast, type Catalog, type ExprVal } from '../expr/types.js';
import type { Law } from './laws.js';

export const THINK_ABOUT_CAP = 200;
export const DEFAULT_COOLDOWN = 8;

/** How a reaction with an exit has gone: the times it has started, and whether its `until` has held. */
export type ReactionProgress = { runs:number; ended?:boolean };

/** Whether a reaction has run out its `times`, or its `until` has held. It may still be running its last run. */
export function reactionFinished(times:number | undefined, progress:ReactionProgress | undefined):boolean {
	return !!progress && (!!progress.ended || (times !== undefined && progress.runs >= times));
}

/**
 * When a reaction may fire again though its watch still holds. A true watch would otherwise start it again the moment it
 * ended, and whatever the character was doing would never get a turn.
 */
export type ReactionRest = {
	/** It needs no body and has run: it has done what it can until its watch has gone false. */
	spent?:boolean;
	/** It used the body and failed: game time it may try again. */
	restUntil?:number;
};

const rests = new WeakMap<object, Map<string, ReactionRest>>();

/** How `source`, a law or a `when` step, stands for character `id`. Not saved: a loaded game starts every reaction afresh. */
export function reactionRest(source:object, id = ''):ReactionRest {
	let byID = rests.get(source);
	if (!byID) {
		byID = new Map();
		rests.set(source, byID);
	}
	let rest = byID.get(id);
	if (!rest) {
		rest = {};
		byID.set(id, rest);
	}
	return rest;
}

/**
 * A reaction a session may run: a law, or a `when` hoisted out of the arc. `source` is that law or that
 * `when` step itself, so a handler stays recognizable while its law is renamed or edited.
 */
export type ArcHandler = {
	source:Law | Step;
	watch:string;
	arc:Arc;
	rank:number;
	/** Game seconds it runs once started before a dead watch or a higher handler stops it (`Law.hold`). */
	hold?:number;
	/** A watch that ends `hold` early when true (`Law.holdBreak`). */
	holdBreak?:string;
	/** What finishes it for good (`times=`, `until=`), and how far it has got. None: it never finishes. */
	exit?:{ times?:number; until?:string; progress:ReactionProgress };
	rest?:ReactionRest;
};

/** Whether `handler` has finished for good: it fires no more. */
export function handlerFinished(handler:ArcHandler):boolean {
	return !!handler.exit && reactionFinished(handler.exit.times, handler.exit.progress);
}

export type ArcPending =
	| { kind:'preempt'; handler:ArcHandler }
	| { kind:'abort' };

export type ArcSession = {
	token:number;
	running:ArcHandler[];
	/** When each running handler started, by its source: what its `hold` counts from. */
	timestamp:Map<ArcHandler['source'], number>;
	frames:{ handlers:ArcHandler[] }[];
	pending?:ArcPending;
	fail?:{ verb:string; reason:string };
	bindings:Map<string, ExprVal>;
	catalog?:()=>Catalog | undefined;
	now:()=>number;
	/** Resolves once `now` moves on. Without it, a loop of instant iterations yields a turn of the event loop instead. */
	nextTime?:()=>Promise<void>;
	abortHost?:()=>void;
	extraHandlers?:()=>ArcHandler[];
	/** Body finished; hoisted `when` still poll until the program is replaced. */
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
	/** Game seconds a reaction that used the body and failed waits before it tries again. */
	cooldown:number;
	/** How each `when` step with an exit has gone, over every pass of a loop. */
	whens:Map<Step, ReactionProgress>;
};

export type LastChoice = { name:string; result:ArcResult };

/** The name of the choice to run, given the goal, the choices by name, and the last choice. */
export type ArcPick = (goal:string, choices:Record<string, Arc>, last:LastChoice | undefined)=>Promise<string>;

export type ArcSessionOpts = {
	verbs?:VerbRegistry;
	cooldown?:number;
	catalog?:()=>Catalog | undefined;
	now?:()=>number;
	nextTime?:()=>Promise<void>;
	abortHost?:()=>void;
	extraHandlers?:()=>ArcHandler[];
	pick?:ArcPick;
};

export function createArcSession(opts:ArcSessionOpts = {}):ArcSession {
	return {
		token: 0,
		running: [],
		timestamp: new Map(),
		frames: [],
		bindings: new Map(),
		catalog: opts.catalog,
		now: opts.now ?? (() => 0),
		nextTime: opts.nextTime,
		abortHost: opts.abortHost,
		extraHandlers: opts.extraHandlers,
		parked: false,
		verbs: opts.verbs,
		cooldown: opts.cooldown ?? DEFAULT_COOLDOWN,
		pick: opts.pick,
		passes: new Map(),
		whens: new Map(),
	};
}

function liveCatalog(session:ArcSession):Catalog | undefined {
	const base = session.catalog?.();
	if (!base && !session.fail && session.bindings.size === 0) {
		return undefined;
	}
	const names = new Map(base?.names ?? []);
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

/** Those of `handlers` not yet finished. An `until` is read here, and once it has held the handler stays finished. */
function unfinished(session:ArcSession, handlers:ArcHandler[], catalog:Catalog):ArcHandler[] {
	return handlers.filter((h) => {
		if (h.exit?.until && watchIsTrue(h.exit.until, catalog)) {
			h.exit.progress.ended = true;
		}
		if (h.rest?.spent && !watchIsTrue(h.watch, catalog)) {
			h.rest.spent = false;
		}
		return !handlerFinished(h) && !h.rest?.spent && session.now() >= (h.rest?.restUntil ?? 0);
	});
}

/** `handler` ran to its own end: whether, and when, it may fire again. Stopped by something else, nothing changes. */
function noteRun(session:ArcSession, handler:ArcHandler, result:ArcResult):void {
	if (!handler.rest || result.interrupted || result.preempted) {
		return;
	}
	if (arcSteps(handler.arc).every((step) => session.verbs?.get(step.verb)?.free)) {
		handler.rest.spent = true;
	}
	else if (!result.ok) {
		handler.rest.restUntil = session.now() + session.cooldown;
	}
}

function isRunning(session:ArcSession, handler:ArcHandler):boolean {
	return session.running.some((r) => r.source === handler.source);
}

/** `handler` runs from now on: the start its `hold` counts from, and one of its `times`, however this run ends. */
function startRunning(session:ArcSession, handler:ArcHandler):void {
	session.running.push(handler);
	session.timestamp.set(handler.source, session.now());
	if (handler.exit) {
		handler.exit.progress.runs += 1;
	}
}

function stopRunning(session:ArcSession):void {
	const handler = session.running.pop();
	if (handler) {
		session.timestamp.delete(handler.source);
	}
}

/**
 * Whether the running handler on top is still inside its `hold`: nothing but its own end stops it yet, unless its
 * `holdBreak` holds now.
 */
export function holding(session:ArcSession):boolean {
	const top = session.running.at(-1);
	const since = top?.hold ? session.timestamp.get(top.source) : undefined;
	if (since === undefined || session.now() - since >= top!.hold!) {
		return false;
	}
	const catalog = top!.holdBreak ? liveCatalog(session) : undefined;
	return !(catalog && watchIsTrue(top!.holdBreak!, catalog));
}

/** Director tick: abort a dead watch, or preempt with a higher-rank true handler, once the running one's hold is up. */
export function pollArcSession(session:ArcSession):void {
	const candidates = allHandlers(session);
	// Nothing to watch: no view to build.
	if ((candidates.length === 0 && session.running.length === 0) || holding(session)) {
		return;
	}
	const catalog = liveCatalog(session);
	if (!catalog) {
		return;
	}
	for (const h of unfinished(session, candidates, catalog)) {
		if (!watchIsTrue(h.watch, catalog)) {
			continue;
		}
		if (isRunning(session, h)) {
			return;
		}
		const top = session.running[session.running.length - 1];
		if (top && h.rank >= top.rank) {
			continue;
		}
		session.pending = { kind: 'preempt', handler: h };
		session.token += 1;
		session.abortHost?.();
		return;
	}
	const top = session.running[session.running.length - 1];
	if (top && !watchIsTrue(top.watch, catalog)) {
		session.pending = { kind: 'abort' };
		session.token += 1;
		session.abortHost?.();
	}
}

export function firstStartable(session:ArcSession):ArcHandler | undefined {
	const candidates = allHandlers(session);
	const catalog = candidates.length > 0 ? liveCatalog(session) : undefined;
	if (!catalog) {
		return undefined;
	}
	for (const h of unfinished(session, candidates, catalog)) {
		if (!watchIsTrue(h.watch, catalog)) {
			continue;
		}
		if (isRunning(session, h)) {
			return undefined;
		}
		return h;
	}
	return undefined;
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

/** What finishes a `when` step, kept by the step so it carries over every pass of a loop. */
function whenExit(step:Step, session:ArcSession):ArcHandler['exit'] {
	const times = typeof step.args.times === 'number' ? step.args.times : undefined;
	const until = typeof step.args.until === 'string' ? step.args.until.trim() : '';
	if (times === undefined && !until) {
		return undefined;
	}
	const progress = session.whens.get(step) ?? { runs: 0 };
	session.whens.set(step, progress);
	return { times, until, progress };
}

/** The `when` steps of `arc` as handlers, and the arc without them. A step before a `when` keeps its own join. */
function hoistWhen(arc:Arc, session:ArcSession):{ handlers:ArcHandler[]; body:Arc | undefined } {
	const handlers:ArcHandler[] = [];
	const body:Arc = [];
	for (const step of arc) {
		if (isHoistedWhen(step) && isArc(step.args.arc)) {
			handlers.push({
				source: step,
				watch: String(step.args.watch).trim(),
				arc: step.args.arc,
				rank: 100 + handlers.length,
				exit: whenExit(step, session),
				rest: reactionRest(step),
			});
		}
		else {
			body.push(step);
		}
	}
	return { handlers, body: body.length > 0 ? body : undefined };
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
			const prose = argBase(session.verbs?.get(step.verb)?.args[key]) === 'text';
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
	execute:(step:Step)=>Promise<ArcResult>,
	depth:number,
):Promise<ArcResult | undefined> {
	while (session.pending) {
		const pending = session.pending;
		session.pending = undefined;
		if (pending.kind === 'abort') {
			return { ok: false, preempted: true, verb: session.running.at(-1)?.watch ?? 'when' };
		}
		startRunning(session, pending.handler);
		try {
			const result = await runFrame(pending.handler.arc, execute, session, depth + 1);
			noteRun(session, pending.handler, result);
			if (result.interrupted) {
				return result;
			}
		}
		finally {
			stopRunning(session);
		}
	}
	return undefined;
}

async function pumpHandlers(
	session:ArcSession,
	execute:(step:Step)=>Promise<ArcResult>,
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
	return { ok: false, verb: 'when', reason: 'handler pump cap' };
}

async function execStep(
	step:Step,
	execute:(step:Step)=>Promise<ArcResult>,
	session:ArcSession,
	depth:number,
):Promise<ArcResult> {
	const before = await pumpHandlers(session, execute, depth);
	if (before) {
		return before;
	}
	if (step.verb === 'loop') {
		return runLoop(step, execute, session, depth);
	}
	if (step.verb === CHOOSE_VERB) {
		return runChoose(step, execute, session, depth);
	}
	for (;;) {
		const live = interpolateStep(step, session);
		const token = session.token;
		const result = withVerb(await execute(live), live);
		if (result.interrupted && session.token === token && !session.pending) {
			return result;
		}
		const stolen = await afterSteal(session, execute, depth, token, live.verb, result.reason);
		// A reaction cut the step short and has run its course: the step is not done, so it runs again. A program
		// replaced instead ends it (not ok).
		if (!(stolen?.ok && result.interrupted)) {
			return stolen ?? result;
		}
	}
}

/**
 * What a step returns when, while it ran, its program was replaced or a handler came due; `undefined` when neither
 * happened. A handler that came due runs first.
 */
async function afterSteal(
	session:ArcSession,
	execute:(step:Step)=>Promise<ArcResult>,
	depth:number,
	token:number,
	verb:string,
	reason?:string,
):Promise<ArcResult | undefined> {
	if (session.token === token && !session.pending) {
		return undefined;
	}
	const drained = await drainPending(session, execute, depth);
	if (drained?.interrupted) {
		return drained;
	}
	return { ok: !(drained?.preempted && !drained.ok), preempted: true, verb, reason };
}

/** Ask `session.pick` for a name, then run the choice under it. A choice gone stale while asking does not run. */
async function runChoose(
	step:Step,
	execute:(step:Step)=>Promise<ArcResult>,
	session:ArcSession,
	depth:number,
):Promise<ArcResult> {
	const fail = (reason:string):ArcResult => ({ ok: false, verb: CHOOSE_VERB, reason });
	if (!session.pick) {
		return fail('no System One model');
	}
	const token = session.token;
	// A loop of instant choices waits for game time to move instead of asking again at once.
	while (session.now() === session.lastPickAt) {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 10);
		});
		const stolen = await afterSteal(session, execute, depth, token, CHOOSE_VERB);
		if (stolen) {
			return stolen;
		}
	}
	session.lastPickAt = session.now();
	const choices = withLoneWait(choicesOf(step));
	let name:string;
	try {
		name = await session.pick(typeof step.args.goal === 'string' ? step.args.goal : '', choices, session.lastChoice);
	}
	catch (err) {
		return await afterSteal(session, execute, depth, token, CHOOSE_VERB)
			?? fail(`System One: ${err instanceof Error ? err.message : String(err)}`);
	}
	const stolen = await afterSteal(session, execute, depth, token, CHOOSE_VERB);
	if (stolen) {
		return stolen;
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

async function runLoop(
	step:Step,
	execute:(step:Step)=>Promise<ArcResult>,
	session:ArcSession,
	depth:number,
):Promise<ArcResult> {
	const inner = isArc(step.args.arc) ? step.args.arc : undefined;
	if (!inner) {
		return { ok: false, verb: 'loop', reason: 'loop needs arc' };
	}
	const through = typeof step.args.through === 'string' ? step.args.through : '';
	const until = typeof step.args.until === 'string' ? step.args.until.trim() : '';
	const times = typeof step.args.times === 'number' ? step.args.times : undefined;
	if (through) {
		const parsed = parseThrough(through);
		if (!parsed) {
			return { ok: false, verb: 'loop', reason: 'through needs x in expr' };
		}
		const catalog = liveCatalog(session);
		if (!catalog) {
			return { ok: false, verb: 'loop', reason: 'through needs a catalog' };
		}
		const listed = evaluate(parsed.expr, catalog);
		if (listed.error || listed.value.kind !== 'list') {
			return { ok: false, verb: 'loop', reason: listed.error?.message ?? 'through expr is not a list' };
		}
		const items = listed.value.value;
		const cap = catalog.listCap ?? LIST_CAP;
		if (items.length > cap) {
			return { ok: false, verb: 'loop', reason: 'through list cap' };
		}
		let last:ArcResult = { ok: true, verb: 'loop' };
		for (let i = 0; i < items.length; i++) {
			if (times !== undefined && i >= times) {
				break;
			}
			const cat = liveCatalog(session);
			if (until && cat && watchIsTrue(until, cat)) {
				break;
			}
			session.bindings.set(parsed.name, items[i]);
			try {
				last = await runFrame(inner, execute, session, depth + 1);
			}
			finally {
				session.bindings.delete(parsed.name);
			}
			session.passes.set(step, (session.passes.get(step) ?? 0) + 1);
			if (last.interrupted) {
				return last;
			}
			if (last.preempted && !last.ok) {
				return last;
			}
			if (!last.ok && !last.preempted) {
				return last;
			}
		}
		return { ...last, verb: last.verb ?? 'loop' };
	}
	let i = 0;
	let missed = 0;
	let last:ArcResult = { ok: true, verb: 'loop' };
	while (true) {
		if (times !== undefined && i >= times) {
			return { ...last, verb: last.verb ?? 'loop' };
		}
		const cat = liveCatalog(session);
		if (until && cat && watchIsTrue(until, cat)) {
			return { ok: true, verb: 'loop' };
		}
		const clock = session.now();
		last = await runFrame(inner, execute, session, depth + 1);
		i += 1;
		session.passes.set(step, i);
		if (last.interrupted) {
			return last;
		}
		if (last.preempted && !last.ok) {
			return last;
		}
		if (!last.ok && !last.preempted) {
			missed += 1;
			if (!last.retry || missed > LOOP_RETRIES || !session.nextTime) {
				return last;
			}
			const token = session.token;
			const from = session.now();
			while (session.now() < from + LOOP_RETRY_WAIT) {
				await session.nextTime();
				const stolen = await afterSteal(session, execute, depth, token, 'loop');
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

function shouldContinue(result:ArcResult, join:Join):boolean {
	if (result.interrupted) {
		return false;
	}
	if (result.preempted && !result.ok) {
		return false;
	}
	if (join === 'if_ok') {
		return result.ok || !!result.preempted;
	}
	if (join === 'if_failed') {
		return !result.ok && !result.preempted;
	}
	return true;
}

/** Run `arc` step by step: each step's join says, from how it went, whether the next one runs. */
async function runChain(
	arc:Arc,
	execute:(step:Step)=>Promise<ArcResult>,
	session:ArcSession,
	depth:number,
):Promise<ArcResult> {
	for (let i = 0; ; i++) {
		const step = arc[i];
		const inner = groupArc(step);
		const result = inner
			? await runFrame(inner, execute, session, depth + 1)
			: await execStep(step, execute, session, depth);
		const join = step.then ?? 'if_ok';
		if (i === arc.length - 1 || !shouldContinue(result, join)) {
			return result;
		}
		if (join === 'if_failed') {
			session.fail = { verb: result.verb ?? firstStep([step])?.verb ?? '', reason: result.reason ?? '' };
			try {
				return await runFrame(arc.slice(i + 1), execute, session, depth + 1);
			}
			finally {
				session.fail = undefined;
			}
		}
	}
}

async function runFrame(
	arc:Arc,
	execute:(step:Step)=>Promise<ArcResult>,
	session:ArcSession,
	depth:number,
):Promise<ArcResult> {
	const { handlers, body } = hoistWhen(arc, session);
	session.frames.push({ handlers });
	try {
		const stolen = await pumpHandlers(session, execute, depth);
		if (stolen) {
			return stolen;
		}
		if (!body) {
			if (depth === 0 && handlers.length > 0) {
				session.parked = true;
			}
			return { ok: true, verb: 'when' };
		}
		const result = await runChain(body, execute, session, depth);
		if (depth === 0 && !result.interrupted && handlers.length > 0) {
			session.parked = true;
		}
		return result;
	}
	finally {
		if (!(session.parked && depth === 0)) {
			session.frames.pop();
		}
	}
}

export type RunArcOpts = {
	session?:ArcSession;
	asHandler?:ArcHandler;
	onStep?:(step:Step)=>void;
};

export async function runArc(
	arc:Arc,
	execute:(step:Step)=>Promise<ArcResult>,
	opts:RunArcOpts = {},
):Promise<ArcResult> {
	const session = opts.session ?? createArcSession();
	const run = async (step:Step):Promise<ArcResult> => {
		opts.onStep?.(step);
		return execute(step);
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
		if (opts.asHandler) {
			noteRun(session, opts.asHandler, result);
		}
		if (!trail || result.interrupted || (result.preempted && !result.ok)) {
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
