import { DEFAULT_TRUE_SCORE, type ExprVal, type ScoldReason } from './types.js';

export function clampTrueScore(n:number | undefined):number {
	if (n === undefined || !Number.isFinite(n) || n <= 0 || n > 1) {
		return DEFAULT_TRUE_SCORE;
	}
	return n;
}

export function watchScore(value:ExprVal, trueScore = DEFAULT_TRUE_SCORE):{ score:number; scold?:ScoldReason } {
	const ts = clampTrueScore(trueScore);
	if (value.kind === 'absent') {
		return { score: 0 };
	}
	if (value.kind === 'bool') {
		return { score: value.value ? ts : 0 };
	}
	if (value.kind === 'number') {
		if (!Number.isFinite(value.value)) {
			return { score: 0, scold: 'typeError' };
		}
		if (value.value > 1) {
			return { score: 1, scold: 'rawOverOne' };
		}
		return { score: Math.min(1, Math.max(0, value.value)) };
	}
	return { score: 0, scold: 'typeError' };
}
