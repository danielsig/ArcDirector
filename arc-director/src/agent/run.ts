import { formatPlan } from '../action/parse.js';
import { isActionPlan } from '../action/validate.js';
import {
	firstStep,
	isHoistedWhen,
	type ActionPlan,
	type ActionResult,
	type Join,
	type Step,
} from '../action/types.js';
import { evaluate } from '../expr/eval.js';
import { parse as parseExpr } from '../expr/parse.js';
import { dummyEntity } from '../expr/natives.js';
import { watchScore } from '../expr/score.js';
import { stringifyVal } from '../expr/stringify.js';
import { LIST_CAP, SampleCache, type Ast, type Catalog, type ExprVal } from '../expr/types.js';

export const THINK_ABOUT_CAP = 200;
export const DEFAULT_COOLDOWN = 8;

export type PlanHandler = {
	key:string;
	watch:string;
	plan:ActionPlan;
	rank:number;
};

export type PlanPending =
	| { kind:'preempt'; handler:PlanHandler }
	| { kind:'abort' };

export type PlanSession = {
	token:number;
	running:PlanHandler[];
	frames:{ handlers:PlanHandler[] }[];
	pending?:PlanPending;
	fail?:{ verb:string; reason:string };
	bindings:Map<string, ExprVal>;
	catalog?:()=>Catalog | undefined;
	now:()=>number;
	abortHost?:()=>void;
	extraHandlers?:()=>PlanHandler[];
	/** Body finished; hoisted `when` still poll until the program is replaced. */
	parked?:boolean;
};

export type PlanSessionOpts = {
	catalog?:()=>Catalog | undefined;
	now?:()=>number;
	abortHost?:()=>void;
	extraHandlers?:()=>PlanHandler[];
};

export function createPlanSession(opts:PlanSessionOpts = {}):PlanSession {
	return {
		token: 0,
		running: [],
		frames: [],
		bindings: new Map(),
		catalog: opts.catalog,
		now: opts.now ?? (() => 0),
		abortHost: opts.abortHost,
		extraHandlers: opts.extraHandlers,
		parked: false,
	};
}

function liveCatalog(session:PlanSession):Catalog | undefined {
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

function allHandlers(session:PlanSession):PlanHandler[] {
	const extras = session.extraHandlers?.() ?? [];
	const inner:PlanHandler[] = [];
	for (let f = session.frames.length - 1; f >= 0; f--) {
		inner.push(...session.frames[f].handlers);
	}
	return [...extras, ...inner].sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
}

/** Director tick: abort a dead watch, or preempt with a higher-rank true handler. */
export function pollPlanSession(session:PlanSession):void {
	const catalog = liveCatalog(session);
	if (!catalog) {
		return;
	}
	const candidates = allHandlers(session);
	for (const h of candidates) {
		if (!watchIsTrue(h.watch, catalog)) {
			continue;
		}
		if (session.running.some((r) => r.key === h.key)) {
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

export function firstStartable(session:PlanSession):PlanHandler | undefined {
	const catalog = liveCatalog(session);
	if (!catalog) {
		return undefined;
	}
	for (const h of allHandlers(session)) {
		if (!watchIsTrue(h.watch, catalog)) {
			continue;
		}
		if (session.running.some((r) => r.key === h.key)) {
			return undefined;
		}
		return h;
	}
	return undefined;
}

type Row = {
	kind:'step' | 'group';
	step?:Step;
	group?:ActionPlan;
	join:Join | undefined;
};

export function planSteps(plan:ActionPlan):Step[] {
	const steps:Step[] = [];
	let cur:ActionPlan | undefined = plan;
	while (cur) {
		if (cur.head) {
			steps.push(cur.head);
		}
		else {
			const inner = cur.group ? firstStep(cur.group) : undefined;
			if (inner) {
				steps.push(inner);
			}
		}
		cur = cur.then?.plan;
	}
	return steps;
}

function flatten(plan:ActionPlan):Row[] {
	const rows:Row[] = [];
	let cur:ActionPlan | undefined = plan;
	while (cur) {
		if (cur.group) {
			rows.push({ kind: 'group', group: cur.group, join: cur.then?.join });
		}
		else if (cur.head.verb !== 'group') {
			rows.push({ kind: 'step', step: cur.head, join: cur.then?.join });
		}
		cur = cur.then?.plan;
	}
	return rows;
}

function unflatten(rows:Row[]):ActionPlan {
	if (rows.length === 0) {
		return { head: { verb: 'think', args: {} } };
	}
	const last = rows[rows.length - 1];
	let plan:ActionPlan = last.kind === 'group' && last.group
		? { head: { verb: 'group', args: {} }, group: last.group }
		: { head: last.step ?? { verb: 'think', args: {} } };
	for (let i = rows.length - 2; i >= 0; i--) {
		const row = rows[i];
		const node:ActionPlan = row.kind === 'group' && row.group
			? { head: { verb: 'group', args: {} }, group: row.group }
			: { head: row.step ?? { verb: 'think', args: {} } };
		node.then = { join: row.join ?? 'then', plan };
		plan = node;
	}
	return plan;
}

function thinkAbout(step:Step):string {
	return typeof step.args.about === 'string' ? step.args.about.replace(/\s+/g, ' ').trim() : '';
}

function splitTrailingThink(plan:ActionPlan):{ body:ActionPlan | undefined; think:Step | undefined } {
	const rows = flatten(plan);
	const last = rows[rows.length - 1];
	if (!last || last.kind !== 'step' || last.step?.verb !== 'think') {
		return { body: plan, think: undefined };
	}
	const bodyRows = rows.slice(0, -1);
	if (bodyRows.length === 0) {
		return { body: undefined, think: last.step };
	}
	bodyRows[bodyRows.length - 1] = { ...bodyRows[bodyRows.length - 1], join: undefined };
	return { body: unflatten(bodyRows), think: last.step };
}

function withVerb(result:ActionResult, step:Step):ActionResult {
	return { ...result, verb: result.verb ?? step.verb };
}

/** Pull every think() out, concat abouts, append one think at the end. */
export function deferThinks(plan:ActionPlan):ActionPlan {
	if (plan.group) {
		return {
			head: { verb: 'group', args: {} },
			group: deferThinks(plan.group),
			then: plan.then
				? { join: plan.then.join, plan: deferThinks(plan.then.plan) }
				: undefined,
		};
	}
	const rows = flatten(plan);
	const abouts:string[] = [];
	const body:Row[] = [];
	let had = false;
	for (const row of rows) {
		if (row.kind === 'step' && row.step?.verb === 'think') {
			had = true;
			const about = thinkAbout(row.step);
			if (about) {
				abouts.push(about);
			}
			continue;
		}
		if (row.kind === 'group' && row.group) {
			body.push({ ...row, group: deferThinks(row.group) });
			continue;
		}
		body.push(row);
	}
	if (!had) {
		return plan;
	}
	let about = abouts.join(' ');
	if (about.length > THINK_ABOUT_CAP) {
		about = about.slice(0, THINK_ABOUT_CAP).trim();
	}
	const thinkStep:Step = { verb: 'think', args: about ? { about } : {} };
	if (body.length === 0) {
		return { head: thinkStep };
	}
	body[body.length - 1] = { ...body[body.length - 1], join: 'then' };
	body.push({ kind: 'step', step: thinkStep, join: undefined });
	return unflatten(body);
}

function hoistWhen(plan:ActionPlan, depth:number):{ handlers:PlanHandler[]; body:ActionPlan | undefined } {
	const handlers:PlanHandler[] = [];
	const kept:Row[] = [];
	let i = 0;
	let cur:ActionPlan | undefined = plan;
	while (cur) {
		if (cur.head && isHoistedWhen(cur.head) && isActionPlan(cur.head.args.plan)) {
			const watch = String(cur.head.args.watch).trim();
			const inner = cur.head.args.plan;
			handlers.push({
				key: `when:${watch}:${formatPlan(inner)}`,
				watch,
				plan: inner,
				rank: 100 + i,
			});
			i += 1;
		}
		else if (cur.group) {
			kept.push({ kind: 'group', group: cur.group, join: cur.then?.join });
		}
		else if (cur.head.verb !== 'group') {
			kept.push({ kind: 'step', step: cur.head, join: cur.then?.join });
		}
		cur = cur.then?.plan;
	}
	if (kept.length === 0) {
		return { handlers, body: undefined };
	}
	kept[kept.length - 1] = { ...kept[kept.length - 1], join: undefined };
	return { handlers, body: unflatten(kept) };
}

function rootedAtBinding(ast:Ast, session:PlanSession):boolean {
	if (ast.type === 'ident') {
		return ast.name === 'fail' || session.bindings.has(ast.name);
	}
	if (ast.type === 'member') {
		return rootedAtBinding(ast.recv, session);
	}
	return false;
}

function interpolateStep(step:Step, session:PlanSession):Step {
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
			const { ast } = parseExpr(value);
			if (!rootedAtBinding(ast, session)) {
				continue;
			}
			const r = evaluate(value, catalog);
			if (r.error) {
				continue;
			}
			args[key] = stringifyVal(r.value, catalog);
			changed = true;
		}
		catch {
			continue;
		}
	}
	return changed ? { ...step, args } : step;
}

async function drainPending(
	session:PlanSession,
	execute:(step:Step)=>Promise<ActionResult>,
	depth:number,
):Promise<ActionResult | undefined> {
	while (session.pending) {
		const pending = session.pending;
		session.pending = undefined;
		if (pending.kind === 'abort') {
			return { ok: false, preempted: true, verb: session.running.at(-1)?.watch ?? 'when' };
		}
		session.running.push(pending.handler);
		try {
			const result = await runFrame(pending.handler.plan, execute, session, depth + 1);
			if (result.interrupted) {
				return result;
			}
		}
		finally {
			session.running.pop();
		}
	}
	return undefined;
}

async function pumpHandlers(
	session:PlanSession,
	execute:(step:Step)=>Promise<ActionResult>,
	depth:number,
):Promise<ActionResult | undefined> {
	for (let n = 0; n < 32; n++) {
		pollPlanSession(session);
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
	execute:(step:Step)=>Promise<ActionResult>,
	session:PlanSession,
	depth:number,
):Promise<ActionResult> {
	const before = await pumpHandlers(session, execute, depth);
	if (before) {
		return before;
	}
	if (step.verb === 'loop') {
		return runLoop(step, execute, session, depth);
	}
	const live = interpolateStep(step, session);
	const token = session.token;
	const result = withVerb(await execute(live), live);
	if (result.interrupted && session.token === token && !session.pending) {
		return result;
	}
	if (session.token !== token || session.pending) {
		const drained = await drainPending(session, execute, depth);
		if (drained?.interrupted) {
			return drained;
		}
		if (drained?.preempted && !drained.ok) {
			return { ok: false, preempted: true, verb: live.verb, reason: result.reason };
		}
		return { ok: true, preempted: true, verb: live.verb, reason: result.reason };
	}
	return result;
}

function parseThrough(through:string):{ name:string; expr:string } | undefined {
	const m = /^([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]+)$/.exec(through.trim());
	if (!m) {
		return undefined;
	}
	return { name: m[1], expr: m[2].trim() };
}

async function runLoop(
	step:Step,
	execute:(step:Step)=>Promise<ActionResult>,
	session:PlanSession,
	depth:number,
):Promise<ActionResult> {
	const inner = isActionPlan(step.args.plan) ? step.args.plan : undefined;
	if (!inner) {
		return { ok: false, verb: 'loop', reason: 'loop needs plan' };
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
		let last:ActionResult = { ok: true, verb: 'loop' };
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
	let last:ActionResult = { ok: true, verb: 'loop' };
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
		if (last.interrupted) {
			return last;
		}
		if (last.preempted && !last.ok) {
			return last;
		}
		if (!last.ok && !last.preempted) {
			return last;
		}
		if (session.now() === clock) {
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 0);
			});
		}
	}
}

function shouldContinue(result:ActionResult, join:Join):boolean {
	if (result.interrupted) {
		return false;
	}
	if (result.preempted && !result.ok) {
		return false;
	}
	if (join === 'then_if_ok') {
		return result.ok || !!result.preempted;
	}
	if (join === 'then_if_err') {
		return !result.ok && !result.preempted;
	}
	return true;
}

async function runChain(
	plan:ActionPlan,
	execute:(step:Step)=>Promise<ActionResult>,
	session:PlanSession,
	depth:number,
):Promise<ActionResult> {
	let result:ActionResult;
	if (plan.group) {
		result = await runFrame(plan.group, execute, session, depth + 1);
	}
	else {
		result = await execStep(plan.head, execute, session, depth);
	}
	if (!plan.then || result.interrupted) {
		return result;
	}
	if (result.preempted && !result.ok) {
		return result;
	}
	if (!shouldContinue(result, plan.then.join)) {
		return result;
	}
	if (plan.then.join === 'then_if_err') {
		session.fail = {
			verb: result.verb ?? firstStep(plan)?.verb ?? '',
			reason: result.reason ?? '',
		};
		try {
			return await runFrame(plan.then.plan, execute, session, depth + 1);
		}
		finally {
			session.fail = undefined;
		}
	}
	return runChain(plan.then.plan, execute, session, depth);
}

async function runFrame(
	plan:ActionPlan,
	execute:(step:Step)=>Promise<ActionResult>,
	session:PlanSession,
	depth:number,
):Promise<ActionResult> {
	const { handlers, body } = hoistWhen(plan, depth);
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

export type RunPlanOpts = {
	session?:PlanSession;
	asHandler?:PlanHandler;
	onStep?:(step:Step)=>void;
};

export async function runPlan(
	plan:ActionPlan,
	execute:(step:Step)=>Promise<ActionResult>,
	opts:RunPlanOpts = {},
):Promise<ActionResult> {
	const session = opts.session ?? createPlanSession();
	const run = async (step:Step):Promise<ActionResult> => {
		opts.onStep?.(step);
		return execute(step);
	};
	const ordered = deferThinks(plan);
	const { body, think } = splitTrailingThink(ordered);
	const work = body ?? (think ? { head: think } : { head: { verb: 'think', args: {} } });
	const trail = body ? think : undefined;
	if (opts.asHandler) {
		session.running.push(opts.asHandler);
	}
	try {
		const result = await runFrame(work, run, session, 0);
		if (!trail || result.interrupted || (result.preempted && !result.ok)) {
			return result;
		}
		return withVerb(await run(trail), trail);
	}
	finally {
		if (opts.asHandler) {
			session.running.pop();
		}
	}
}
