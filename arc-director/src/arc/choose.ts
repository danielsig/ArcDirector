import { firstStep, isArc, type Arc, type Step } from './types.js';

/**
 * `choose(goal, name=arc, …)`: a System One model picks one arc by name. Every arg but `goal` is a choice;
 * a bare arc is named after its verb and first word arg (`follow(Raider)` is `follow_Raider`).
 */

/** Names no choice may take. `until` is reserved so a spec's `choose` and the verb read alike. */
export const CHOICE_RESERVED:readonly string[] = ['goal', 'until'];

/** Jev's cap on criteria in one question. */
export const MAX_CHOICES = 255;

const CHOICE_NAME = /^[A-Za-z_]\w*$/;

export function isChoiceName(name:string):boolean {
	return CHOICE_NAME.test(name) && !CHOICE_RESERVED.includes(name);
}

/** Its choices by name, in the order written. */
export function choicesOf(step:Step):Record<string, Arc> {
	const out:Record<string, Arc> = {};
	for (const [key, value] of Object.entries(step.args)) {
		if (!CHOICE_RESERVED.includes(key) && isArc(value)) {
			out[key] = value;
		}
	}
	return out;
}

/** `go_to(EastGate) && wait()` is `go_to_EastGate`; `wait()` is `wait`. */
export function deriveChoiceName(arc:Arc):string {
	const step = firstStep(arc);
	if (!step) {
		return 'choice';
	}
	const word = Object.values(step.args).find((v):v is string => typeof v === 'string');
	const tail = word?.replace(/\W+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
	return tail ? `${step.verb}_${tail}` : step.verb;
}

/** `base`, or `base_2`, `base_3`, … when `taken` already holds it. */
export function freeChoiceName(base:string, taken:ReadonlySet<string>):string {
	let name = base;
	for (let n = 2; taken.has(name) || CHOICE_RESERVED.includes(name); n++) {
		name = `${base}_${n}`;
	}
	return name;
}
