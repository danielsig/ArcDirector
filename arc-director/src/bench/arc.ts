import { ArcDirector } from '../director/director.js';
import { ABILITIES, FIGHTERS } from '../scenario/combat.js';
import { idleScenario, playScenario, SCENE_TICK, type Scenario, type SceneCtx } from '../scenario/play.js';
import { THEM, type SceneWorld } from '../scenario/world.js';
import { runBench, type BenchLevel, type BenchOpts, type BenchOutcome, type BenchScore, type Timer } from './score.js';

/**
 * One moment with a goal to reach, as a {@link Scenario}. The bench plays it as the game would ({@link playScenario}):
 * its character's mind thinks, the arc plays out in the scene's {@link SceneWorld}, and the mind thinks again on how
 * that went while the goal is not reached, a few times at most. Then `done` decides: any arcs that get there are a
 * success. Short of it, the outcome is harmful when the world is worse off than had the character done nothing (see
 * {@link playArcCase}), else neutral. Its level: 1 one obvious deed, 2 a fact in the scene, or how the first try went,
 * decides the deeds, 3 the deeds take several facts at once.
 *
 * Every case carries what proves it fair: a {@link solution} that reaches the goal, and the {@link naive} move a weak
 * model makes first, which must not. Doing nothing, every fighter of `me`'s side attacking the nearest foe, and (with a
 * squad) the commander acting {@link alone} must not either: no case gives points for free.
 */
export type ArcCase = Scenario & {
	skill:string;
	level:BenchLevel;
	/**
	 * Whether a goal not reached did harm the general check misses, as a rule the goal set broken. Default: only the
	 * general check (see {@link playArcCase}).
	 */
	harm?:(world:SceneWorld)=>boolean;
	/**
	 * Arc text that reaches the goal, one per think (the last again for any think after): proof the case can be won.
	 * No model reads it.
	 */
	solution:string | string[];
	/** The obvious-but-wrong first move, as Arc text: it must not reach the goal, even written again every think. */
	naive?:string;
	/** With a squad: its commander doing the job itself, ordering no one. It must not reach the goal either. */
	alone?:string;
};

/** The arc bench's version (`ARC_BENCH`). Raised whenever a case or how cases are played changes, so only scores of one version compare. */
export const ARC_BENCH_VERSION = 2;

/**
 * `c` played as in the game ({@link playScenario}), in a fresh director `models` set up, its thinks timed by `time`.
 * A success when the goal was reached. Short of it, harmful when the scene ended worse off than had `me` done nothing
 * ({@link worse}, or the case's own {@link ArcCase.harm}), else neutral. A think that throws or writes no arc throws.
 */
export async function playArcCase(c:ArcCase, models:(director:ArcDirector<SceneCtx>)=>unknown, time?:Timer):Promise<BenchOutcome> {
	const ended = await playScenario(c, models, { time, judge: (world) => ({ harm: c.harm?.(world) ?? false, standing: standing(c, world) }) });
	if (ended.done) {
		return 'success';
	}
	return ended.judged.harm || worse(ended.judged.standing, await idleStanding(c, ended.at)) ? 'harmful' : 'neutral';
}

/** What harm is weighed by: how many of `me`'s side are down, and what `me` holds. */
type Standing = { lost:number; held:Map<string, number> };

function standing(c:ArcCase, world:SceneWorld):Standing {
	return { lost: world.lost('us'), held: world.holdings(c.me.id) };
}

/**
 * Whether `now` is worse off than `idle`, the same moment had `me` done nothing: more of its side down, or something
 * it held gone with nothing got for it (given away, dropped, paid for nothing). A trade is not harm, however bad;
 * a case that sets a price says so in its {@link ArcCase.harm}.
 */
function worse(now:Standing, idle:Standing):boolean {
	if (now.lost > idle.lost) {
		return true;
	}
	const gained = [...new Set([...now.held.keys(), ...idle.held.keys()])].map((item) => (now.held.get(item) ?? 0) - (idle.held.get(item) ?? 0));
	return gained.some((n) => n < 0) && !gained.some((n) => n > 0);
}

/** Each case played with `me` doing nothing at all, by tick from its start: what harm is measured against. */
const IDLE_RUNS = new WeakMap<ArcCase, Promise<Standing[]>>();

/** How `c` stands `at` seconds in had `me` done nothing. Played once per case ({@link idleScenario}). */
function idleStanding(c:ArcCase, at:number):Promise<Standing> {
	let run = IDLE_RUNS.get(c);
	if (!run) {
		run = idleScenario(c, (world) => standing(c, world));
		IDLE_RUNS.set(c, run);
	}
	return run.then((standings) => standings[Math.min(Math.round(at / SCENE_TICK), standings.length - 1)]);
}

/**
 * What a model that knows only one trick writes for `c`, every think: nothing at all (`idle`), every fighter of `me`'s
 * side on the nearest foe (`attack`), the commander doing it all itself (`alone`), or the case's obvious-but-wrong
 * move (`naive`). `undefined` where the trick has nothing to do: no foes to attack, no squad to leave idle.
 */
export type Baseline = 'idle' | 'attack' | 'alone' | 'naive';

export const BASELINES:readonly Baseline[] = ['idle', 'attack', 'alone', 'naive'];

/** {@link Baseline} `baseline`'s arc for `c`, as Arc text. */
export function baselineArc(c:ArcCase, baseline:Baseline):string | undefined {
	switch (baseline) {
		case 'idle':
			return 'wait(seconds=1)';
		case 'attack':
			return attackNearest(c);
		case 'alone':
			return c.alone;
		case 'naive':
			return c.naive;
	}
}

/** The nearest foe, as an arc picks it. */
const NEAREST_FOE = 'others.filter(u => u.foe).minBy(u => distance(me, u))';

function basicAttack(kind:string | undefined):string | undefined {
	return kind && FIGHTERS[kind] ? FIGHTERS[kind].abilities.find((a) => ABILITIES[a].repeat) : undefined;
}

/** Every fighter of `me`'s side on the nearest foe, then the next, until none is left. */
function attackNearest(c:ArcCase):string | undefined {
	if (!Object.values(c.others ?? {}).some((spot) => spot.as && (spot.team ?? THEM) === THEM)) {
		return undefined;
	}
	const strike = (verb:string):string => `loop(arc=${verb}(target=${NEAREST_FOE}))`;
	const own = c.rts ? (c.me.as ? 'attack' : undefined) : basicAttack(c.me.as);
	const kinds = [...new Set(Object.values(c.squad ?? {}).map((spot) => spot.as))];
	const orders = c.rts
		? kinds.some((kind) => kind) ? [`issue(who=units, arc=${strike('attack')})`] : []
		: kinds.flatMap((kind) => {
			const verb = basicAttack(kind);
			return verb ? [`issue(who=units.filter("${kind}"), arc=${strike(verb)})`] : [];
		});
	const steps = [...orders, ...own ? [strike(own)] : []];
	return steps.length > 0 ? steps.join(' ; ') : undefined;
}

/**
 * How well a model writes arcs that reach their goals: each case `repeats` times, played in a fresh director, and
 * timed by the model's thinks alone. `models` adds the model to bench to that director, as a host adds it for play
 * (`addModel`, `withArcFormat`, `withRepair`, …); the bench adds the scene. Each case is a success, neutral or harmful,
 * as {@link playArcCase} says; a think that throws or writes no arc fails, which counts as harmful. The score records
 * how the model sampled. `onTrial` reports progress as {@link runBench} does.
 *
 * The model is looked up and loaded once, before anything is timed, and every case thinks over that one connection.
 * Cases run `parallel` at a time, by default as many as the model thinks at once (its `maxParallel`), each in its own
 * director; a think is then timed while the others run.
 */
export async function benchArcs(
	models:(director:ArcDirector<SceneCtx>)=>unknown,
	cases:ArcCase[],
	{ onTrial, parallel, repeats, quick }:Omit<BenchOpts, 'warmUp'> = {},
):Promise<BenchScore> {
	const inference = new ArcDirector<SceneCtx>();
	models(inference);
	try {
		// A server that cannot be reached fails each case, as it would on its own.
		const shared = await inference.start().then(() => true, () => false);
		const setUp = shared ? (director:ArcDirector<SceneCtx>) => {
			models(director);
			director.shareInference(inference);
		} : models;
		const trials = cases.map((c) => ({ name: c.me.id, skill: c.skill, level: c.level, run: (time:Timer) => playArcCase(c, setUp, time) }));
		const score = await runBench(trials, {
			onTrial,
			repeats,
			quick,
			parallel: parallel ?? Math.max(1, inference.modelParallel()),
			warmUp: shared ? () => inference.warmUp() : undefined,
		});
		const sampling = inference.modelSampling();
		return sampling ? { ...score, sampling } : score;
	}
	finally {
		inference.dispose();
	}
}
