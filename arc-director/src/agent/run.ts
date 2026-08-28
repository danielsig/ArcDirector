import type { ActionPlan, ActionResult, Step } from '../action/types.js';

export async function runPlan(
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
	return runPlan(plan.then.plan, execute);
}
