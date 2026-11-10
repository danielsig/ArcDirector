import type { Sampling } from '../inference/provider.js';

/** How hard a case is, 1 to 3. Each bench says what makes its cases harder. */
export type BenchLevel = 1 | 2 | 3;

/**
 * How a trial ended: `success` reached what it asked, `neutral` did not but left things no worse than doing nothing
 * would have, and `harmful` left them worse. A trial that throws (no answer, an invalid one) is harmful too.
 */
export type BenchOutcome = 'success' | 'neutral' | 'harmful';

/** A trial's outcome with a rating of how well it did, 0 to 1, for a bench that gives partial credit. */
export type BenchRated = { outcome:BenchOutcome; score:number };

/**
 * Trials tallied: how many reached their goal, how many did harm (failed ones included), of how many. `mean` is the
 * share that reached it (or the mean rating, where trials rate how well they did), and `se` its standard error over the repeats: how far another run of the same model would
 * likely land from it. None with a single repeat, which cannot tell.
 */
export type SkillScore = { right:number; harmful:number; total:number; mean:number; se?:number };

export type BenchScore = {
	/** Outcomes per skill. */
	skills:Record<string, SkillScore>;
	/** Outcomes per {@link BenchLevel}. */
	levels:Record<BenchLevel, SkillScore>;
	/** Every trial: the bench's score. Doing nothing scores 0. */
	total:SkillScore;
	/** Times each case ran. */
	repeats:number;
	/** Mean time the model took per trial, timed with {@link parallel} trials running at once. */
	msPerTrial:number;
	/** The whole run, warm-up included. */
	wallMs:number;
	/** Trials run at once. */
	parallel:number;
	/** Trials that threw: no answer at all. */
	failed:number;
	/** The last failed trial's error. */
	error?:string;
	/** How the model picked its tokens, as the bench ran it: results compare only at the same sampling. */
	sampling?:Sampling;
};

/** Times `work`, the part of a trial the model does, and hands back its result. */
export type Timer = <T>(work:Promise<T>)=>Promise<T>;

/**
 * One scored question. `run` answers how the model did, timing the model's part with `time`; a throw is a failure.
 * Trials of one `name` are repeats of one case.
 */
export type BenchTrial = { name:string; skill:string; level:BenchLevel; run:(time:Timer)=>Promise<BenchOutcome | BenchRated> };

export type BenchOpts = {
	/** Progress: `(0, total)` once the warm-up is over, then after each trial. */
	onTrial?:(done:number, total:number)=>void;
	/** Trials run at once. Default 1. */
	parallel?:number;
	/** Times each trial runs. Default 1. */
	repeats?:number;
	/**
	 * A quick check instead of the whole bench: per skill, its medium trial (level 2), then its easy one after a miss or
	 * its hard one after a success. A skill scores 0, ⅓, ⅔ or 1 by how far up it got: neither, only easy, medium but
	 * not hard, or both. Repeats do not apply. Its scores do not compare with a full run's.
	 */
	quick?:boolean;
	/** Run once before any trial is timed, so a model that must load is timed like one already loaded. */
	warmUp?:()=>Promise<unknown>;
};

/** One trial's run: which trial, how it ended, and its rating (1 for a success, 0 otherwise, unless it rated itself). */
type Ran = { trial:BenchTrial; outcome:BenchOutcome; score:number };

/**
 * Every trial `repeats` times, `parallel` at a time, tallied per skill and level. Repeats run round after round, so a
 * run stopped early still covers every case alike. A `quick` check climbs each skill's levels instead.
 */
export async function runBench(trials:BenchTrial[], { onTrial, parallel = 1, repeats = 1, warmUp, quick = false }:BenchOpts = {}):Promise<BenchScore> {
	const t0 = performance.now();
	const rounds = quick ? 1 : Math.max(1, Math.round(repeats));
	// Skills listed in trial order, however the trials finish.
	const names = [...new Set(trials.map((t) => t.skill))];
	const total = quick ? names.length * 2 : trials.length * rounds;
	let failed = 0;
	let error:string | undefined;
	let ms = 0;
	const time:Timer = async (work) => {
		const start = performance.now();
		try {
			return await work;
		}
		finally {
			ms += performance.now() - start;
		}
	};
	await warmUp?.().catch(() => undefined);
	onTrial?.(0, total);
	const ran:Ran[] = [];
	const attempt = async (trial:BenchTrial):Promise<BenchOutcome> => {
		let outcome:BenchOutcome = 'harmful';
		let score = 0;
		try {
			const ended = await trial.run(time);
			outcome = typeof ended === 'string' ? ended : ended.outcome;
			score = typeof ended === 'string' ? (ended === 'success' ? 1 : 0) : ended.score;
		}
		catch (err) {
			failed += 1;
			error = err instanceof Error ? err.message : String(err);
		}
		ran.push({ trial, outcome, score });
		onTrial?.(ran.length, total);
		return outcome;
	};
	// How far up each skill got in a quick check, 0 to 1.
	const climbed = new Map<string, number>();
	const climb = async (skill:string):Promise<void> => {
		const at = (level:BenchLevel) => trials.find((t) => t.skill === skill && t.level === level);
		const medium = at(2) ?? trials.find((t) => t.skill === skill)!;
		const passed = await attempt(medium) === 'success';
		const next = at(passed ? 3 : 1);
		const passedNext = next !== undefined && next !== medium && await attempt(next) === 'success';
		climbed.set(skill, ((passed ? 2 : 0) + (passedNext ? 1 : 0)) / 3);
	};
	const jobs = quick
		? names.map((skill) => () => climb(skill))
		: Array.from({ length: rounds }, () => trials).flat().map((trial) => () => attempt(trial));
	let next = 0;
	const worker = async ():Promise<void> => {
		while (next < jobs.length) {
			await jobs[next++]();
		}
	};
	const workers = Math.max(1, Math.min(parallel, jobs.length));
	await Promise.all(Array.from({ length: workers }, worker));
	const skills = Object.fromEntries(names.map((skill) => {
		const score = tally(ran.filter((r) => r.trial.skill === skill));
		return [skill, quick ? { ...score, mean: climbed.get(skill) ?? 0 } : score];
	}));
	const levels = { 1: tally([]), 2: tally([]), 3: tally([]) } as Record<BenchLevel, SkillScore>;
	for (const level of [1, 2, 3] as const) {
		levels[level] = tally(ran.filter((r) => r.trial.level === level));
	}
	const all = tally(ran);
	return {
		skills,
		levels,
		total: quick ? { ...all, mean: names.length > 0 ? names.reduce((sum, skill) => sum + skills[skill].mean, 0) / names.length : 0 } : all,
		repeats: rounds,
		msPerTrial: ran.length > 0 ? ms / ran.length : 0,
		wallMs: performance.now() - t0,
		parallel: workers,
		failed,
		...error ? { error } : {},
	};
}

/**
 * `ran` tallied. The standard error comes from how much each case's own outcome varied over its repeats: the noise
 * between runs of one model, not the spread between easy and hard cases, which every run shares.
 */
function tally(ran:Ran[]):SkillScore {
	const right = ran.filter((r) => r.outcome === 'success').length;
	const harmful = ran.filter((r) => r.outcome === 'harmful').length;
	const total = ran.length;
	const byCase = new Map<string, number[]>();
	for (const { trial, score } of ran) {
		byCase.set(trial.name, [...byCase.get(trial.name) ?? [], score]);
	}
	const runs = [...byCase.values()];
	// The variance of a mean of case means: each case's sample variance over its own runs, averaged in.
	const se = runs.length > 0 && runs.every((xs) => xs.length > 1)
		? Math.sqrt(runs.reduce((sum, xs) => sum + variance(xs) / xs.length, 0)) / runs.length
		: undefined;
	const mean = total > 0 ? ran.reduce((sum, r) => sum + r.score, 0) / total : 0;
	return { right, harmful, total, mean, ...se === undefined ? {} : { se } };
}

/** Sample variance (n − 1). */
function variance(xs:number[]):number {
	const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
	return xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (xs.length - 1);
}
