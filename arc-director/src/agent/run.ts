import type { ActionPlan, ActionResult, Join, Step } from '../action/types.js';

export const THINK_ABOUT_CAP = 200;

type Row = {
	step:Step;
	join:Join | undefined;
};

export function planSteps(plan:ActionPlan):Step[] {
	const steps:Step[] = [];
	let cur:ActionPlan | undefined = plan;
	while (cur) {
		steps.push(cur.head);
		cur = cur.then?.plan;
	}
	return steps;
}

function flatten(plan:ActionPlan):Row[] {
	const rows:Row[] = [];
	let cur:ActionPlan | undefined = plan;
	while (cur) {
		rows.push({ step: cur.head, join: cur.then?.join });
		cur = cur.then?.plan;
	}
	return rows;
}

function unflatten(rows:Row[]):ActionPlan {
	if (rows.length === 0) {
		return { head: { verb: 'think', args: {} } };
	}
	let plan:ActionPlan = { head: rows[rows.length - 1].step };
	for (let i = rows.length - 2; i >= 0; i--) {
		plan = {
			head: rows[i].step,
			then: { join: rows[i].join ?? 'then', plan },
		};
	}
	return plan;
}

function thinkAbout(step:Step):string {
	return typeof step.args.about === 'string' ? step.args.about.replace(/\s+/g, ' ').trim() : '';
}

function splitTrailingThink(plan:ActionPlan):{ body:ActionPlan | undefined; think:Step | undefined } {
	const rows = flatten(plan);
	const last = rows[rows.length - 1];
	if (!last || last.step.verb !== 'think') {
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
	const rows = flatten(plan);
	const abouts:string[] = [];
	const body:Row[] = [];
	let had = false;
	for (const row of rows) {
		if (row.step.verb === 'think') {
			had = true;
			const about = thinkAbout(row.step);
			if (about) {
				abouts.push(about);
			}
			continue;
		}
		body.push({ step: row.step, join: row.join });
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
	body.push({ step: thinkStep, join: undefined });
	return unflatten(body);
}

export async function runPlan(
	plan:ActionPlan,
	execute:(step:Step)=>Promise<ActionResult>,
):Promise<ActionResult> {
	const ordered = deferThinks(plan);
	const { body, think } = splitTrailingThink(ordered);
	if (!body) {
		const step = think ?? { verb: 'think', args: {} };
		return withVerb(await execute(step), step);
	}
	const result = await runPlanChain(body, execute);
	if (!think || result.interrupted) {
		return result;
	}
	return withVerb(await execute(think), think);
}

async function runPlanChain(
	plan:ActionPlan,
	execute:(step:Step)=>Promise<ActionResult>,
):Promise<ActionResult> {
	const result = await execute(plan.head);
	const tagged:ActionResult = {
		...result,
		verb: result.verb ?? plan.head.verb,
	};
	if (!plan.then || tagged.interrupted) {
		return tagged;
	}
	if (plan.then.join === 'then_if_ok' && !tagged.ok) {
		return tagged;
	}
	if (plan.then.join === 'then_if_err' && tagged.ok) {
		return tagged;
	}
	return runPlanChain(plan.then.plan, execute);
}
