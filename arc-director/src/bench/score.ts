/** How hard a case is, 1 to 3. Each bench says what makes its cases harder. */
export type BenchLevel = 1 | 2 | 3;

export type SkillScore = { right:number; total:number };

export type BenchScore = {
	/** Right answers per skill. */
	skills:Record<string, SkillScore>;
	/** Right answers per {@link BenchLevel}. */
	levels:Record<BenchLevel, SkillScore>;
	/** Mean time the model took per trial. */
	msPerTrial:number;
	/** Trials that threw: no answer at all. */
	failed:number;
	/** The last failed trial's error. */
	error?:string;
};

/** Times `work`, the part of a trial the model does, and hands back its result. */
export type Timer = <T>(work:Promise<T>)=>Promise<T>;

/** One scored question. `run` answers whether the model got it right, timing the model's part with `time`; a throw is a failure. */
export type BenchTrial = { skill:string; level:BenchLevel; run:(time:Timer)=>Promise<boolean> };

/**
 * Every trial in turn, tallied per skill and level. The first trial runs once untimed first, so a model that must
 * load is timed like one already loaded. `onTrial` reports `(0, total)` once that warm-up is over, then progress
 * after each scored trial.
 */
export async function runBench(trials:BenchTrial[], onTrial?:(done:number, total:number)=>void):Promise<BenchScore> {
	const skills:Record<string, SkillScore> = {};
	const levels:Record<BenchLevel, SkillScore> = { 1: { right: 0, total: 0 }, 2: { right: 0, total: 0 }, 3: { right: 0, total: 0 } };
	let failed = 0;
	let error:string | undefined;
	let ms = 0;
	const time:Timer = async (work) => {
		const t0 = performance.now();
		try {
			return await work;
		}
		finally {
			ms += performance.now() - t0;
		}
	};
	await trials[0]?.run((work) => work).catch(() => undefined);
	onTrial?.(0, trials.length);
	for (const [i, { skill, level, run }] of trials.entries()) {
		let right = 0;
		try {
			right = await run(time) ? 1 : 0;
		}
		catch (err) {
			failed += 1;
			error = err instanceof Error ? err.message : String(err);
		}
		for (const tally of [skills[skill] ??= { right: 0, total: 0 }, levels[level]]) {
			tally.right += right;
			tally.total += 1;
		}
		onTrial?.(i + 1, trials.length);
	}
	return { skills, levels, msPerTrial: trials.length > 0 ? ms / trials.length : 0, failed, ...(error ? { error } : {}) };
}
