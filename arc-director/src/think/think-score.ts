import { clampTrueScore } from '../expr/watch-score.js';
import { DEFAULT_TRUE_SCORE } from '../expr/expr-types.js';

/** Score scale from time since last think. `trueScore` just after a think, 1 after half of `rethinkInterval`. */
export function thinkRecencyScale(
	age:number,
	rethinkInterval:number,
	trueScore = DEFAULT_TRUE_SCORE,
):number {
	if (!Number.isFinite(age) || age < 0) {
		return 1;
	}
	const span = rethinkInterval * 0.5;
	if (!(span > 0) || age >= span) {
		return 1;
	}
	const fresh = clampTrueScore(trueScore);
	const t = age / span;
	return fresh + (1 - fresh) * t;
}
