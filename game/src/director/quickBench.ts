import { reactive } from 'vue';
import { ARC_BENCH, ARC_BENCH_VERSION, benchArcs, benchSystemOne, DECISION_BENCH, DECISION_BENCH_VERSION, type BenchScore } from 'arc-director/bench';
import { gpuMemory } from 'arc-director';
import type { HudModelOption } from '../ui/hudModel';
import { arcThinking, systemOneFor, type BenchKind } from './bench';
import { listLMStudioModels, lmStudio, unloadLMStudio } from './inference';

/**
 * A quick rank of LM Studio's models: each runs three of a bench's cases at once, the three whose scores went most
 * with the whole bench's, so a few seconds a model sort them about as the whole bench would. What a model scored is
 * scaled by how fast it answered: a slow mind decides too late to matter.
 */
export type QuickScore = {
	/** The three cases' mean points, 0 to 1. */
	precision:number;
	/** Mean time per case. */
	ms:number;
	/** What its speed leaves of its precision, 0 to 1. */
	speed:number;
	/** Gigabytes it takes up loaded (its file), when LM Studio says. */
	gb?:number;
	/** What its size leaves of its precision, 0 to 1: a model ten times the memory must be far better to rank above. */
	memory:number;
	/** Precision times speed times memory: what the lists sort by. */
	score:number;
	/** It could not answer: an error, or a model that cannot be asked this. */
	failed:boolean;
};

type QuickBenchDef = {
	/** The bench's version: scores from another version are dropped. */
	version:number;
	/**
	 * The three cases, by index in the bench, whose scores correlated most with the bench's total across the models
	 * measured (skill and level in the comment, so a change to the bench shows).
	 */
	cases:number[];
	/**
	 * One other case, run untimed and waited for before the timed ones: it loads the model and caches the context every
	 * case shares, as play keeps it warm, but not the timed cases' own.
	 */
	warmUp:number;
	/**
	 * Runs with no other model loaded, itself loaded once: everything LM Studio holds is unloaded first. Otherwise it
	 * leaves LM Studio as it found it.
	 */
	alone:boolean;
	/** Who is worth ranking. */
	candidates:(models:HudModelOption[])=>HudModelOption[];
	/** A model's size (billions of parameters, or gigabytes), the size to try first, and the band tried before any other. */
	size:(m:HudModelOption)=>number;
	sweetSpot:number;
	band:[number, number];
	/** What is left of the score at each think time in ms, straight between points: all of it before the first, none after the last. */
	speed:[ms:number, kept:number][];
	/** As {@link speed}, for the gigabytes it takes up loaded. */
	memory:[gb:number, kept:number][];
	/** Runs `cases` (by index) of the bench with model `id`, all at once. */
	run:(id:string, models:HudModelOption[], cases:number[], onTrial:(done:number, total:number)=>void)=>Promise<{ precision:number; ms:number; failed:boolean }>;
};

const QUICK_CASES = 3;

/** A quarter of this device's graphics memory, in gigabytes: the size of main model to try first. */
const THINKER_GB = (gpuMemory()?.gb ?? 8) / 4;

const DEFS:Record<BenchKind, QuickBenchDef> = {
	decision: {
		version: DECISION_BENCH_VERSION,
		// survival/3, tactics/1, survival/1: r = 0.86, 0.79, 0.77 with the rest of the bench over 10 LM Studio models; 0.95 together.
		cases: [10, 0, 1],
		// social/1: the next most telling.
		warmUp: 2,
		alone: false,
		candidates: (models) => models,
		size: (m) => m.params?.total ?? 1,
		sweetSpot: 0.5,
		band: [0.1, 1],
		speed: [[100, 1], [200, 0.85], [400, 0.5], [600, 0.15], [800, 0]],
		// Half a gigabyte is free; bigger costs gently, as a chat model fast enough makes good decisions too.
		memory: [[0.5, 1], [2, 0.95], [4, 0.85], [8, 0.7], [16, 0.55], [32, 0.4]],
		// Each case on its own, all at once.
		run: async (id, models, cases, onTrial) => {
			const progress = cases.map(() => ({ done: 0, total: 0 }));
			const scores = await Promise.all(cases.map((i, n) => benchSystemOne(systemOneFor(id, models), [DECISION_BENCH[i]], {
				onTrial: (done, total) => {
					progress[n] = { done, total };
					onTrial(progress.reduce((a, p) => a + p.done, 0), progress.reduce((a, p) => a + p.total, 0));
				},
			})));
			return { precision: mean(scores.map((s) => s.total.mean)), ms: mean(scores.map((s) => s.msPerTrial)), failed: scores.some(failed) };
		},
	},
	arc: {
		version: ARC_BENCH_VERSION,
		// tactics/1, economy/2, fight/2
		cases: [27, 33, 22],
		// chain/1: easy, so short.
		warmUp: 0,
		alone: true,
		candidates: (models) => models.filter((m) => !m.decision && !m.encoder),
		// Gigabytes loaded, nearest a quarter of this device's graphics memory first (an 8 GB card's when it cannot tell): room
		// left for the decision model and the game. No band: all by nearness.
		size: (m) => m.gb ?? m.params?.total ?? THINKER_GB,
		sweetSpot: THINKER_GB,
		band: [0, Infinity],
		speed: [[5000, 1], [10000, 0.85], [20000, 0.5], [30000, 0.15], [40000, 0]],
		// What most graphics cards hold is free; past it, each doubling costs a little.
		memory: [[8, 1], [16, 0.9], [32, 0.75], [64, 0.55], [128, 0.4]],
		// The three at once: the bench runs as many cases at once as its director thinks at once.
		run: async (id, _models, cases, onTrial) => {
			const s = await benchArcs(arcThinking(id, QUICK_CASES), cases.map((i) => ARC_BENCH[i]), { onTrial });
			return { precision: s.total.mean, ms: s.msPerTrial, failed: failed(s) };
		},
	},
};

function mean(xs:number[]):number {
	return xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
}

function failed(s:BenchScore):boolean {
	return !!s.error || (s.failed ?? 0) > 0;
}

/** How much of a score is left at `x` (a time, or a size) along `points`; nothing at an unknown time. */
export function kept(x:number, points:[number, number][]):number {
	if (!Number.isFinite(x)) {
		return 0;
	}
	if (x <= points[0][0]) {
		return points[0][1];
	}
	for (let i = 1; i < points.length; i++) {
		const [x0, y0] = points[i - 1];
		const [x1, y1] = points[i];
		if (x <= x1) {
			return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
		}
	}
	return points[points.length - 1][1];
}

/** Trained for ArcDirector: `skaldic-…`, under a publisher or not. */
function skaldic(id:string):boolean {
	return /(^|\/)skaldic-/i.test(id);
}

/**
 * The most promising first: Skaldic models, then inside the band, nearest the sweet spot (by ratio) first; then bigger ones, smallest
 * first; then smaller ones, biggest first.
 */
export function benchOrder(models:HudModelOption[], def:Pick<QuickBenchDef, 'size' | 'sweetSpot' | 'band'>):HudModelOption[] {
	const [lo, hi] = def.band;
	const rank = (m:HudModelOption):[number, number] => {
		const p = def.size(m);
		if (p < lo) {
			return [2, -p];
		}
		if (p > hi) {
			return [1, p];
		}
		return [0, Math.abs(Math.log(p / def.sweetSpot))];
	};
	return [...models].sort((a, b) => {
		const [ga, ka] = rank(a);
		const [gb, kb] = rank(b);
		return Number(skaldic(b.id)) - Number(skaldic(a.id)) || ga - gb || ka - kb;
	});
}

type State = 'idle' | 'running' | 'pausing' | 'paused';

/** Scores kept before size counted are dropped with the old key. */
const STORE = 'arc-director.quickBench.3';

/** Scores kept per kind with the bench version they came from. */
function loadScores():Record<BenchKind, Record<string, QuickScore>> {
	const scores = { decision: {}, arc: {} } as Record<BenchKind, Record<string, QuickScore>>;
	try {
		const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Record<BenchKind, { version:number; scores:Record<string, QuickScore> }>>;
		for (const kind of ['decision', 'arc'] as const) {
			if (saved[kind]?.version === DEFS[kind].version) {
				// Scored with today's size curve, so a change to it needs no re-ranking.
				scores[kind] = Object.fromEntries(Object.entries(saved[kind].scores).map(([id, s]) => {
					const memory = s.gb === undefined ? 1 : kept(s.gb, DEFS[kind].memory);
					return [id, { ...s, memory, score: s.precision * s.speed * memory }];
				}));
			}
		}
	}
	catch {
		// Nothing kept, or storage blocked: start unranked.
	}
	return scores;
}

function saveScores():void {
	try {
		localStorage.setItem(STORE, JSON.stringify({
			decision: { version: DEFS.decision.version, scores: quickBench.scores.decision },
			arc: { version: DEFS.arc.version, scores: quickBench.scores.arc },
		}));
	}
	catch {
		// Kept for this page only.
	}
}

/** One kind's run: where it stands, the models still to bench (the one benching first), and how far it got. */
type Run = {
	state:State;
	queue:string[];
	/** Models benched since it started. */
	done:number;
	/** How far the model benching now is, 0 to 1. */
	trial:number;
	/** The model benching now is warming up, untimed. */
	warming:boolean;
};

function idleRun():Run {
	return { state: 'idle', queue: [], done: 0, trial: 0, warming: false };
}

/**
 * Each kind's run and every model's score so far. A paused run keeps its place while the other kind runs; only one
 * runs at a time, as they share LM Studio.
 */
export const quickBench = reactive({
	runs: { decision: idleRun(), arc: idleRun() } as Record<BenchKind, Run>,
	scores: loadScores(),
});

function busy(run:Run):boolean {
	return run.state === 'running' || run.state === 'pausing';
}

/** A quick bench holds LM Studio: NPCs wait while one runs. */
export function quickBenchRunning():boolean {
	return busy(quickBench.runs.decision) || busy(quickBench.runs.arc);
}

/** The other kind is running, so `kind` must wait for it to finish or pause. */
export function quickBenchBlocked(kind:BenchKind):boolean {
	return busy(quickBench.runs[kind === 'decision' ? 'arc' : 'decision']);
}

/** How far `kind`'s run is, 0 to 1. */
export function quickBenchProgress(kind:BenchKind):number {
	const run = quickBench.runs[kind];
	const total = run.done + run.queue.length;
	return total ? (run.done + run.trial) / total : 0;
}

/** The model `kind` benches now, if any. */
export function quickBenchCurrent(kind:BenchKind):string {
	const run = quickBench.runs[kind];
	return busy(run) ? run.queue[0] ?? '' : '';
}

/**
 * Ranks every model of `kind` not ranked yet, most promising first; with all ranked, ranks them all again. One model
 * at a time: the next loads only once the last is done and unloaded.
 */
export async function startQuickBench(kind:BenchKind):Promise<void> {
	const run = quickBench.runs[kind];
	if (run.state !== 'idle' || quickBenchBlocked(kind)) {
		return;
	}
	await listLMStudioModels();
	const def = DEFS[kind];
	const candidates = def.candidates(lmStudio.models);
	if (candidates.every((m) => quickBench.scores[kind][m.id])) {
		quickBench.scores[kind] = {};
	}
	Object.assign(run, idleRun(), {
		state: 'running',
		queue: benchOrder(candidates.filter((m) => !quickBench.scores[kind][m.id]), def).map((m) => m.id),
	});
	await drain(kind);
}

/** Stops once the model benching now is done. */
export function pauseQuickBench(kind:BenchKind):void {
	const run = quickBench.runs[kind];
	if (run.state === 'running') {
		run.state = 'pausing';
	}
}

export function resumeQuickBench(kind:BenchKind):void {
	const run = quickBench.runs[kind];
	if (run.state === 'pausing') {
		run.state = 'running';
	}
	else if (run.state === 'paused' && !quickBenchBlocked(kind)) {
		run.state = 'running';
		void drain(kind);
	}
}

/** Drops `kind`'s scores, and a paused run of it. */
export function clearQuickBench(kind:BenchKind):void {
	if (busy(quickBench.runs[kind])) {
		return;
	}
	quickBench.scores[kind] = {};
	quickBench.runs[kind] = idleRun();
	saveScores();
}

async function drain(kind:BenchKind):Promise<void> {
	const def = DEFS[kind];
	const run = quickBench.runs[kind];
	while (run.queue.length && run.state === 'running') {
		const id = run.queue[0];
		const wasLoaded = !def.alone && (lmStudio.models.find((m) => m.id === id)?.loaded ?? false);
		if (def.alone) {
			await unloadLMStudio(() => true);
		}
		run.trial = 0;
		// One case of four: the first quarter of the model's share of the bar.
		run.warming = true;
		await def.run(id, lmStudio.models, [def.warmUp], (done, total) => {
			run.trial = total ? done / total / 4 : 0;
		}).catch(() => undefined);
		run.warming = false;
		const result = await def.run(id, lmStudio.models, def.cases, (done, total) => {
			run.trial = 0.25 + (total ? done / total * 0.75 : 0);
		}).catch(() => ({ precision: 0, ms: NaN, failed: true }));
		const speed = kept(result.ms, def.speed);
		const gb = lmStudio.models.find((m) => m.id === id)?.gb;
		// A size LM Studio did not give costs nothing: unknown is not big.
		const memory = gb === undefined ? 1 : kept(gb, def.memory);
		quickBench.scores[kind][id] = { ...result, speed, gb, memory, score: result.precision * speed * memory };
		saveScores();
		// What was loaded before stays loaded, unless it had to run alone.
		if (!wasLoaded) {
			await unloadLMStudio((m) => m === id);
		}
		run.queue.shift();
		run.done++;
		run.trial = 0;
	}
	if (run.queue.length) {
		run.state = 'paused';
	}
	else {
		quickBench.runs[kind] = idleRun();
		void listLMStudioModels();
	}
}
