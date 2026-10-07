export type Join = 'then_if_ok' | 'then' | 'then_if_err';

export type StepArg = string | number | boolean | string[] | Arc;

export type Step = {
	verb:string;
	args:Record<string, StepArg>;
};

export type Arc = {
	head:Step;
	group?:Arc;
	then?:{ join:Join; arc:Arc };
};

export type ArcResult = {
	ok:boolean;
	interrupted?:boolean;
	/** Handler watch went false or a higher-rank handler stole the step. Not a fail. */
	preempted?:boolean;
	reason?:string;
	verb?:string;
	/** The character, thing or place this step found no way to reach. */
	unreachable?:string;
};

export class ArcError extends Error {
	constructor(message:string) {
		super(message);
		this.name = 'ArcError';
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

export function firstStep(arc:Arc):Step | undefined {
	if (arc.group) {
		return firstStep(arc.group);
	}
	if (arc.head.verb === 'group') {
		return undefined;
	}
	return arc.head;
}

export function isHoistedWhen(step:Step):boolean {
	const watch = typeof step.args.watch === 'string' ? step.args.watch.trim() : '';
	return step.verb === 'when' && watch.length > 0;
}

export function isIssue(step:Step):boolean {
	return step.verb === 'issue';
}
