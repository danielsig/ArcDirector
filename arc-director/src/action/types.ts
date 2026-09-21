export type Join = 'then_if_ok' | 'then' | 'then_if_err';

export type StepArg = string | number | boolean | string[] | ActionPlan;

export type Step = {
	verb:string;
	args:Record<string, StepArg>;
};

export type ActionPlan = {
	head:Step;
	group?:ActionPlan;
	then?:{ join:Join; plan:ActionPlan };
};

export type ActionResult = {
	ok:boolean;
	interrupted?:boolean;
	/** Handler watch went false or a higher-rank handler stole the step. Not a fail. */
	preempted?:boolean;
	reason?:string;
	verb?:string;
};

export class ActionError extends Error {
	constructor(message:string) {
		super(message);
		this.name = 'ActionError';
	}
}

export const JOINS:readonly Join[] = ['then_if_ok', 'then', 'then_if_err'];

export const JOIN_SYMBOL:Record<Join, string> = {
	'then_if_ok': '&&',
	then: ';',
	'then_if_err': '||',
};

export const SYMBOL_JOIN:Record<string, Join> = {
	'&&': 'then_if_ok',
	';': 'then',
	'||': 'then_if_err',
};

export function firstStep(plan:ActionPlan):Step | undefined {
	if (plan.group) {
		return firstStep(plan.group);
	}
	if (plan.head.verb === 'group') {
		return undefined;
	}
	return plan.head;
}

export function isHoistedWhen(step:Step):boolean {
	const watch = typeof step.args.watch === 'string' ? step.args.watch.trim() : '';
	return step.verb === 'when' && watch.length > 0;
}

export function isIssue(step:Step):boolean {
	return step.verb === 'issue';
}
