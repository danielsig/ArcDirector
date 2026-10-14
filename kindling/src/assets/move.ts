/** Easings: each takes 0→1 to 0→1. */
export const ease = {
	inOutSine: (x:number):number => -(Math.cos(Math.PI * x) - 1) / 2,
	outExpo: (x:number):number => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
	outCubic: (x:number):number => 1 - (1 - x) ** 3,
	inBack: (x:number):number => 2.70158 * x ** 3 - 1.70158 * x ** 2,
};

/**
 * A move's timing, slow–fast–slow: it anticipates into its ready pose over the wind-up (sinking
 * `sink` past it), strikes in `snap` s as the blow lands, holds there `hold` s (the impact), carries
 * `carry` further over `follow` s, and settles back over `settle` s. `sink` and `carry` are shares
 * of the way from ready to strike.
 */
export type MoveTiming = { sink:number; snap:number; hold:number; carry:number; follow:number; settle:number };

/** The parts of a move, in order. */
export type MovePhase = 'anticipate' | 'strike' | 'impact' | 'follow' | 'settle' | 'done';

/**
 * Where a move is: its `phase`; `u` from its ready pose (0) to its strike pose (1), below 0 while it
 * sinks and above 1 while it carries; and `weight`, how much the move holds the body over whatever
 * plays under it (0 out, 1 all of it).
 */
export type MoveSample = { phase:MovePhase; u:number; weight:number };

/** Samples a move with `timing`, its blow `windUp` s after it starts, at `t` s in. Blend its poses by `u`, laid over the body by `weight`. */
export function move(timing:MoveTiming, windUp:number, t:number):MoveSample {
	const { sink, carry } = timing;
	const snap = Math.min(timing.snap, windUp / 2);
	const snapAt = windUp - snap;
	const followAt = windUp + timing.hold;
	const settleAt = followAt + timing.follow;
	if (t < snapAt) {
		const weight = ease.inOutSine(Math.max(0, t) / snapAt);
		return { phase: 'anticipate', u: -sink * weight, weight };
	}
	if (t < windUp) {
		// The strike, all at once.
		return { phase: 'strike', u: -sink + (1 + sink) * ((t - snapAt) / snap), weight: 1 };
	}
	if (t < followAt) {
		return { phase: 'impact', u: 1, weight: 1 };
	}
	const u = 1 + carry * ease.outExpo(timing.follow > 0 ? (t - followAt) / timing.follow : 1);
	if (t < settleAt) {
		return { phase: 'follow', u, weight: 1 };
	}
	const settled = timing.settle > 0 ? (t - settleAt) / timing.settle : 1;
	return settled < 1
		? { phase: 'settle', u, weight: 1 - ease.inOutSine(settled) }
		: { phase: 'done', u, weight: 0 };
}
