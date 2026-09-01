import type { ActionPlan, Step } from '../action/types.js';
import { clampTrueScore } from '../expr/score.js';
import { DEFAULT_TRUE_SCORE } from '../expr/types.js';

/**
 * Follow-up think scores after a plan. 0 means do not enqueue on success.
 * Hosts merge extras via `actionScores`.
 */
export const ACTION_THINK_SCORES:Readonly<Record<string, number>> = {
	steal: 0.95,
	go_to: 0.8,
	use: 0.65,
	give: 0.6,
	buy: 0.6,
	sell: 0.6,
	pick_up: 0.6,
	drop: 0.55,
	equip: 0.5,
	unequip: 0.5,
	set_goal: 0.45,
	remember: 0.45,
	think: 0.35,
	wander: 0.3,
	say: 0.25,
	drop_goal: 0.2,
	follow: 0,
};

/** Bare think() (no about). Same as ACTION_THINK_SCORES.think. */
export const THINK_BARE_SCORE = ACTION_THINK_SCORES.think;
/** think(about=…) */
export const THINK_ABOUT_SCORE = 0.55;

/** Every failed verb re-thinks at least this high. */
const ACTION_FAIL_SCORE = 0.3;

export function actionThinkScore(
	verb:string,
	ok = true,
	extra?:Record<string, number>,
):number {
	const raw = extra?.[verb] ?? ACTION_THINK_SCORES[verb] ?? 0;
	const base = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
	if (!ok) {
		return Math.min(1, Math.max(base, ACTION_FAIL_SCORE));
	}
	return base;
}

export function waitForOf(step:Step):string {
	if (step.verb !== 'wait') {
		return '';
	}
	return typeof step.args.for === 'string' ? step.args.for.replace(/\s+/g, ' ').trim() : '';
}

function stepWarrant(step:Step, extra?:Record<string, number>):number {
	if (step.verb === 'think') {
		const about = typeof step.args.about === 'string' ? step.args.about.trim() : '';
		return about ? THINK_ABOUT_SCORE : actionThinkScore('think', true, extra);
	}
	return actionThinkScore(step.verb, true, extra);
}

/** Highest score among verbs after the last wait(for). Failures still floor at 0.3. */
export function planActionScore(
	plan:ActionPlan,
	ok = true,
	extra?:Record<string, number>,
):number {
	const steps:Step[] = [];
	let cur:ActionPlan | undefined = plan;
	while (cur) {
		steps.push(cur.head);
		cur = cur.then?.plan;
	}
	let start = 0;
	for (let i = 0; i < steps.length; i++) {
		if (waitForOf(steps[i])) {
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
		return Math.min(1, Math.max(max, ACTION_FAIL_SCORE));
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

export function planActionVerbs(plan:ActionPlan):string[] {
	const verbs:string[] = [];
	let cur:ActionPlan | undefined = plan;
	while (cur) {
		verbs.push(cur.head.verb);
		cur = cur.then?.plan;
	}
	return verbs;
}
