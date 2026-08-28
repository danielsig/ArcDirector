export type Join = 'then_if_ok' | 'then' | 'then_if_err';

export type Step = {
	verb:string;
	args:Record<string, string | number | boolean | string[]>;
};

export type ActionPlan = {
	head:Step;
	then?:{ join:Join; plan:ActionPlan };
};

export type ActionResult = {
	ok:boolean;
	interrupted?:boolean;
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
