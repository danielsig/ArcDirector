import type { Arc, Step } from '../arc/types.js';
import { clampTrueScore } from '../expr/score.js';
import { DEFAULT_TRUE_SCORE } from '../expr/types.js';

/**
 * Follow-up think scores after an arc. 0 means do not enqueue on success.
 * Stock verbs only; hosts add their own verbs via `verbScores`.
 */
export const VERB_THINK_SCORES:Readonly<Record<string, number>> = {
	go_to: 0.8,
	// Asked to learn something: the answer is only worth anything in the next think.
	examine: 0.8,
	use: 0.65,
	give: 0.6,
	buy: 0.6,
	sell: 0.6,
	pick_up: 0.6,
	drop: 0.55,
	set_goal: 0.45,
	remember: 0.45,
	think: 0.35,
	wander: 0.3,
	say: 0.25,
	drop_goal: 0.2,
	follow: 0,
	flee: 0.5,
};

/** Bare think() (no about). Same as VERB_THINK_SCORES.think. */
export const THINK_BARE_SCORE = VERB_THINK_SCORES.think;
/** think(about=…) */
export const THINK_ABOUT_SCORE = 0.55;

/** Every failed verb re-thinks at least this high. */
const VERB_FAIL_SCORE = 0.3;

export function verbThinkScore(
	verb:string,
	ok = true,
	extra?:Record<string, number>,
):number {
	const raw = extra?.[verb] ?? VERB_THINK_SCORES[verb] ?? 0;
	const base = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
	if (!ok) {
		return Math.min(1, Math.max(base, VERB_FAIL_SCORE));
	}
	return base;
}

export function waitUntilOf(step:Step):string {
	if (step.verb !== 'wait') {
		return '';
	}
	return typeof step.args.until === 'string' ? step.args.until.replace(/\s+/g, ' ').trim() : '';
}

function stepWarrant(step:Step, extra?:Record<string, number>):number {
	if (step.verb === 'think') {
		const about = typeof step.args.about === 'string' ? step.args.about.trim() : '';
		return about ? THINK_ABOUT_SCORE : verbThinkScore('think', true, extra);
	}
	return verbThinkScore(step.verb, true, extra);
}

/** Highest score among verbs after the last wait(until). Failures still floor at 0.3. */
export function arcScore(
	arc:Arc,
	ok = true,
	extra?:Record<string, number>,
):number {
	const steps:Step[] = [];
	let cur:Arc | undefined = arc;
	while (cur) {
		if (cur.head) {
			steps.push(cur.head);
		}
		cur = cur.then?.arc;
	}
	let start = 0;
	for (let i = 0; i < steps.length; i++) {
		if (waitUntilOf(steps[i])) {
			start = i + 1;
		}
	}
	let max = 0;
	for (let i = start; i < steps.length; i++) {
		const s = stepWarrant(steps[i], extra);
		if (s > max) {
			max = s;
		}
	}
	if (!ok) {
		return Math.min(1, Math.max(max, VERB_FAIL_SCORE));
	}
	return max;
}

/** Score scale from time since last think. `trueScore` just after a think, 1 after half of `heartbeatStart`. */
export function thinkRecencyScale(
	age:number,
	heartbeatStart:number,
	trueScore = DEFAULT_TRUE_SCORE,
):number {
	if (!Number.isFinite(age) || age < 0) {
		return 1;
	}
	const span = heartbeatStart * 0.5;
	if (!(span > 0) || age >= span) {
		return 1;
	}
	const fresh = clampTrueScore(trueScore);
	const t = age / span;
	return fresh + (1 - fresh) * t;
}

export function arcVerbs(arc:Arc):string[] {
	const verbs:string[] = [];
	let cur:Arc | undefined = arc;
	while (cur) {
		if (cur.head) {
			verbs.push(cur.head.verb);
		}
		cur = cur.then?.arc;
	}
	return verbs;
}
