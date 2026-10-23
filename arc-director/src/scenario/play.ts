import { STOCK_TRADE_VERBS, STOCK_VERBS } from '../arc/stock-verbs.js';
import { STOCK_COLLECTIVE_VERBS, STOCK_FORMATION_VERBS } from '../collective/verbs.js';
import type { ArcResult, StepArg } from '../arc/types.js';
import { ArcDirector } from '../director/director.js';
import type { MemoryDraft } from '../memory/store.js';
import type { KnowledgeEntry } from '../mind/knowledge.js';
import { RTS_COMMANDER_VERBS } from '../rts/rts.js';
import { STOCK_ECONOMY_VERBS, STOCK_UNIT_VERBS } from '../rts/verbs.js';
import type { SearchSpec } from '../search/search.js';
import { settleDeal } from '../world/deal.js';
import type { Sound } from '../perception/hearing.js';
import type { Offer } from '../world/offers.js';
import type { Outcome, Vec } from '../world/types.js';
import { nextTurn } from '../turn.js';
import { ABILITIES, abilityHelp, FIGHTERS, FIGHT_VERBS } from './combat.js';
import { SceneRTS } from './rts.js';
import { SceneWorld, type Scene, type SceneRules, type SceneSpot } from './world.js';

/** What a director staging a scene knows of each character: who it is. */
export type SceneCtx = { id:string };

/**
 * A scene with a goal, played in a real director as a game would: its character's mind thinks, the arc plays out in the
 * scene's {@link SceneWorld}, and the mind thinks again on how that went while the goal is not reached, a few times at
 * most. What it is played for (a test, a benchmark, collecting data, a demo) is up to whoever plays it.
 */
export type Scenario = Scene & SceneRules & {
	/** What `me` is, in its persona. */
	role?:string;
	/** What it remembers, as a persona spec's memories. */
	memories?:MemoryDraft[];
	/** What the world knows: `recall` finds these, not the prompt. */
	know?:KnowledgeEntry[];
	/** Lines said to `me` just before it thinks. */
	heard?:{ from:string; text:string }[];
	/** How its last arc ended. */
	last?:ArcResult;
	/** What the others do, every tick while the arc runs. */
	act?:(world:SceneWorld, director:ArcDirector<SceneCtx>)=>void;
	/** Whether the goal was reached, once the arc ended or time ran out. */
	done:(world:SceneWorld)=>boolean;
	/** Thinks it gets. Default {@link THINKS}. */
	thinks?:number;
	/**
	 * Seconds from one think to the next, as a game paces its thinks: the scene plays on that long after each think
	 * however soon its orders finish (an economy's hand-outs finish at once), and on to `seconds` after the last.
	 */
	thinkEvery?:number;
	/** Seconds of play it gets. Default {@link PLAY_SECONDS}. */
	seconds?:number;
	/** A look-ahead tool `me` may call (`addSearch`): {@link sceneSearch}. */
	search?:SceneSearch;
	/** The sound each verb makes, by name (`withHearing`): with it, minds hear sounds, and `act` may make others (`director.emitSound`). */
	noise?:Record<string, Sound>;
	/** Every sound made, as the scene's mindless fighters may hear it: whom it draws, and where. `heardBy` gives how loud it is at a fighter, 0 unheard. */
	onSound?:(world:SceneWorld, from:string | Vec, sound:Sound, heardBy:(id:string)=>number)=>void;
};

/** A scenario's look-ahead tool, made on its world. */
export type SceneSearch = { name:string; add:(director:ArcDirector<SceneCtx>, world:SceneWorld)=>void };

/** A look-ahead tool `name` for a scenario, its game read off the scenario's world (`addSearch`). */
export function sceneSearch<TState>(name:string, spec:(world:SceneWorld)=>SearchSpec<SceneCtx, TState>):SceneSearch {
	return { name, add: (director, world) => director.addSearch(name, spec(world)) };
}

/** For a scenario's `act`: `maker` takes the first offer made to them, near enough to trade, that `fair` approves. */
export function acceptOffer(w:SceneWorld, director:ArcDirector<SceneCtx>, maker:string, fair:(offer:Offer)=>boolean):void {
	const offer = director.offers.all.find((o) => o.to === maker && w.near(maker, o.from, 4) && fair(o));
	const moves = offer && [
		...Object.entries(offer.get).map(([thing, quantity]) => ({ verb: 'offer', thing, from: maker, to: offer.from, quantity })),
		...Object.entries(offer.give).map(([thing, quantity]) => ({ verb: 'offer', thing, from: offer.from, to: maker, quantity })),
	];
	if (offer && moves && settleDeal(w, moves).ok) {
		director.offers.prune((o) => o !== offer);
	}
}

/** For a scenario's `act`: `who` answers each line `to` said them, once, with `reply` of it; `undefined` stays silent. */
export function answerSpeech(w:SceneWorld, director:ArcDirector<SceneCtx>, who:string, to:string, reply:(text:string)=>string | undefined):void {
	for (const [i, line] of w.said.entries()) {
		const key = `${who} answered ${i}`;
		if (line.speakerID === to && line.heardBy.includes(who) && !w.flags.has(key)) {
			w.flags.add(key);
			const text = reply(line.text);
			if (text) {
				director.talk!.say(who, text, to);
			}
		}
	}
}

/** How far apart two characters may stand and still talk. */
const TALK_RANGE = 12;
/** Seconds of play a scenario gets to reach its goal, over all its thinks. */
const PLAY_SECONDS = 60;
/** Thinks a scenario gets: the first, and one more after an arc that fell short. */
const THINKS = 2;
/** Seconds the others get to answer once the arc ends: a trade it offered, a word it said. */
const SETTLE_SECONDS = 3;
/**
 * Seconds a commander's orders get to play out before it thinks again: issuing them ends its arc at once, and a think
 * then would see nothing new. A battle won sooner needs no other think.
 */
const ORDERS_SECONDS = 15;
/** Seconds a tick. */
export const SCENE_TICK = 0.5;

/** The verbs a fighter of `spot`'s kind can use: its abilities. */
function abilitiesOf(spot:Pick<SceneSpot, 'as'>):string[] {
	return spot.as ? [...FIGHTERS[spot.as].abilities] : [];
}

/** The RTS commander's verbs for an economy, and for fighters: a side without workers or buildings, or without fighters, is not offered them. */
const RTS_ECONOMY:readonly string[] = [...STOCK_ECONOMY_VERBS, 'tribute', 'keep_training', 'supply_ahead', 'share_workers'];
const RTS_TACTICS:readonly string[] = ['keep_distance', 'pull_back', 'spread_out'];

/** What a squad's commander knows of how its squad fights when nobody tells it to. */
const SQUAD_IDLE = 'When my units or I have nothing to do or are only waiting, we strike back at any foe in reach on our own, without moving. An order or reaction takes over from that.';

/** The collective `s`'s character commands, when it has a squad. */
function squadOf(s:Scenario):string {
	return `${s.me.id}Squad`;
}

/**
 * `s` staged in `director`: its world, sight, map, knowledge and characters. Only `me` thinks, and only when asked.
 * With a squad, `me` commands it: the squad is a collective, and `me` its commander and voice. In an RTS each unit's
 * kind gives its verbs, and the commander has the stock RTS commander's.
 */
function stage(director:ArcDirector<SceneCtx>, s:Scenario, world:SceneWorld):ArcDirector<SceneCtx> {
	// Only what `me` and its squad can do, so a unit's arc is offered no ability none of them has.
	for (const name of new Set([s.me, ...Object.values(s.squad ?? {})].flatMap(abilitiesOf))) {
		director.addVerb(name, { ...FIGHT_VERBS[name], help: abilityHelp(ABILITIES[name]), handler: (call) => world.useAbility(call) });
	}
	for (const [name, verb] of Object.entries(s.verbs ?? {})) {
		const { args, help, seen } = verb;
		if ('run' in verb) {
			director.addVerb(name, {
				args,
				help,
				seen,
				handler: (call) => {
					const result = (done:string | Outcome):ArcResult => (typeof done === 'string' ? { ok: true, verb: name, reason: done } : { ...done, verb: name });
					const who = call.character.id;
					const stop = new AbortController();
					const done = verb.run(world, { who, args: call.args as Record<string, StepArg>, signal: stop.signal });
					if (!(done instanceof Promise)) {
						// A verb that ends at once stays in step.
						return result(done);
					}
					// One that waits (a battle move, a held revive) ends when its promise does, or at once when aborted.
					return new Promise<ArcResult>((resolve) => {
						const forget = world.onAbort(who, () => {
							forget();
							stop.abort();
							resolve({ ok: false, interrupted: true, verb: name });
						});
						void done.then((out) => {
							forget();
							resolve(result(out));
						});
					});
				},
			});
		}
		else {
			director.addVerb(name, { args, help, seen, arc: verb.arc, watch: verb.watch, who: verb.who });
		}
	}
	if (s.rts) {
		director.withRTS(new SceneRTS(world, squadOf(s), s.rts));
	}
	if (s.noise) {
		director.withHearing({ noise: s.noise, onSound: (from, sound, heardBy) => s.onSound?.(world, from, sound, heardBy) });
	}
	s.search?.add(director, world);
	for (const [id, spot] of Object.entries(s.others ?? {})) {
		director.addCharacter({ id, offers: spot.offers });
	}
	// Waiting is idle too: nothing to do until then.
	world.idle = (id) => {
		const character = director.character(id);
		return !character?.busy || character.verb === 'wait';
	};
	const verbs = [...STOCK_VERBS, ...STOCK_TRADE_VERBS, ...Object.keys(s.verbs ?? {})];
	const persona = {
		mind: { skipStart: true, skipHeartbeat: true, skipMajor: true, skipStrategic: true },
		identity: s.role || s.me.as ? { role: s.role ?? s.me.as } : undefined,
		goals: [{ text: s.goal }],
		memories: Object.values(s.squad ?? {}).some((spot) => spot.as) ? [...s.memories ?? [], { text: SQUAD_IDLE, pinned: true }] : s.memories,
	};
	director
		.onAbortArc((id) => world.abort(id))
		.addStockVerbs()
		.withCurrency('gold')
		.withPriorityQueue({ mayThink: () => false })
		.withWorld(world)
		.withKernels(({ id }) => ({ ...world.kernels(id), canSee: (a, b) => world.sees(a.id, b.id) }))
		.withSight({ look: ({ id }) => world.sight(id) })
		.withInventory(({ id }) => world.inventory(id))
		.withTalk({
			inRange: (a, b) => world.distance(a, b) <= TALK_RANGE,
			others: (id) => world.characters.filter((other) => other !== id),
		}, (line) => world.said.push(line))
		.withMap(world.map())
		.withKnowledge(s.know ?? [])
		.withContext((id) => (world.find(id) === id ? { id } : undefined))
		.withDefaultKit({ verbs });
	if (!s.squad) {
		return director.addCharacter({ id: s.me.id, ...persona, kit: { verbs: [...verbs, ...abilitiesOf(s.me)] } });
	}
	// The scenario's verbs its squad runs too.
	const unitVerbs = Object.entries(s.verbs ?? {}).filter(([, verb]) => verb.units).map(([name]) => name);
	const unit = (id:string, spot:Pick<SceneSpot, 'as' | 'kind' | 'tags'>) => {
		const kind = spot.kind ?? spot.as;
		return {
			id,
			tags: [...kind ? [kind] : [], ...spot.tags ?? []],
			// In an RTS a unit's kind gives its verbs.
			...s.rts ? {} : { kit: { verbs: [...STOCK_VERBS, ...STOCK_FORMATION_VERBS, ...abilitiesOf(spot), ...unitVerbs] } },
		};
	};
	// The commander runs the orders its mind gives, so its own kit is its collective's; in an RTS a fighter fights as a unit too.
	const fights = [s.me, ...Object.values(s.squad)].some((spot) => spot.as);
	const builds = Object.values(s.squad).some((spot) => spot.kind);
	// A scene nothing in which raises a cap on units has nothing to build ahead of.
	const capped = Object.values(world.kinds).some((k) => (k.provides ?? 0) > 0);
	const rts = RTS_COMMANDER_VERBS.filter((v) => (fights || !RTS_TACTICS.includes(v)) && (builds || !RTS_ECONOMY.includes(v)) && (capped || v !== 'supply_ahead'));
	const command = { verbs: [...new Set([
		...verbs,
		...STOCK_COLLECTIVE_VERBS,
		...s.rts ? [...rts, ...s.me.as ? STOCK_UNIT_VERBS.filter((v) => v !== 'unload') : []] : [],
		...abilitiesOf(s.me),
	])] };
	return director.addStockCollectiveVerbs().addCollective({
		id: squadOf(s),
		...persona,
		kit: command,
		characters: [{ ...unit(s.me.id, s.me), kit: command }, ...Object.entries(s.squad).map(([id, spot]) => unit(id, spot))],
		commander: s.me.id,
	});
}

/**
 * `run` on `s` set up in a fresh director `models` set up: staged and started, its last arc ingested and what it
 * heard said. The director is disposed after.
 */
async function inScene<T>(
	s:Scenario,
	models:(director:ArcDirector<SceneCtx>)=>unknown,
	run:(world:SceneWorld, director:ArcDirector<SceneCtx>)=>Promise<T>,
):Promise<T> {
	const world = new SceneWorld(s, s);
	const director = new ArcDirector<SceneCtx>();
	models(director);
	stage(director, s, world);
	try {
		await director.start();
		if (s.last) {
			director.character(s.me.id)!.mind!.ingestResult(s.last);
		}
		for (const { from, text } of s.heard ?? []) {
			director.talk!.say(from, text, s.me.id);
		}
		return await run(world, director);
	}
	finally {
		director.dispose();
	}
}

/** How a played scenario ended: whether its goal was reached, at what second, and what `judge` read off its world then. */
export type ScenarioEnd<T> = { done:boolean; at:number; judged:T };

/**
 * `s` played as in the game, in a fresh director `models` set up: `me` thinks (each think passed through `time`, as a
 * timer would), its arc plays out, and while the goal is not reached it thinks again on how that went, up to its
 * {@link Scenario.thinks} in its {@link Scenario.seconds}. `judge` reads the world as it ended, before the director
 * goes (its arcs end with it, and a unit sheltering in a building comes out). A think that throws or writes no arc
 * throws.
 */
export async function playScenario<T = undefined>(
	s:Scenario,
	models:(director:ArcDirector<SceneCtx>)=>unknown,
	{ time = (work) => work, judge }:{ time?:<R>(work:Promise<R>)=>Promise<R>; judge?:(world:SceneWorld)=>T } = {},
):Promise<ScenarioEnd<T>> {
	return inScene(s, models, async (world, director) => {
		const mind = director.character(s.me.id)!.mind!;
		const seconds = s.seconds ?? PLAY_SECONDS;
		const ended = ():ScenarioEnd<T> => ({ done: s.done(world), at: world.time, judged: judge?.(world) as T });
		for (let thinks = 0; thinks < (s.thinks ?? THINKS) && world.time < seconds && !world.isDown(s.me.id); thinks++) {
			const thought = world.time;
			const arc = await time(mind.thinkNow({ now: world.time, enact: false }));
			if (!arc) {
				throw new Error('the think wrote no arc');
			}
			// Its voice runs it, as in play: the character, or the commander for its squad.
			await play(director, s, world, mind.voice.enact(arc), seconds);
			if (s.squad) {
				const since = world.time;
				await play(director, s, world, new Promise(() => undefined), seconds, () => s.done(world) || world.time >= since + ORDERS_SECONDS);
			}
			if (s.thinkEvery) {
				await play(director, s, world, new Promise(() => undefined), seconds, () => s.done(world) || world.time >= thought + s.thinkEvery!);
			}
			if (s.done(world)) {
				return ended();
			}
		}
		if (s.squad || s.thinkEvery) {
			// A battle goes on once its commander has said all it will: its units fight on by their orders.
			await play(director, s, world, new Promise(() => undefined), seconds, () => s.done(world));
		}
		return ended();
	});
}

/**
 * `s` played with `me` doing nothing at all, without a model or waits, to its {@link Scenario.seconds}: what `look`
 * reads off the world at the start and after every tick ({@link SCENE_TICK}).
 */
export function idleScenario<T>(s:Scenario, look:(world:SceneWorld)=>T):Promise<T[]> {
	return inScene(s, (director) => director.addFakeInference(), async (world, director) => {
		const seen = [look(world)];
		while (world.time < (s.seconds ?? PLAY_SECONDS)) {
			tick(director, s, world);
			seen.push(look(world));
		}
		return seen;
	});
}

/**
 * Ticks `world` and `director` until `run` ends and the others had {@link SETTLE_SECONDS} to answer, play time is up
 * at `seconds`, or `over` says the scene is decided.
 */
async function play(director:ArcDirector<SceneCtx>, s:Scenario, world:SceneWorld, run:Promise<ArcResult>, seconds:number, over = () => false):Promise<void> {
	let end = seconds;
	void run.catch(() => undefined).finally(() => {
		end = Math.min(end, world.time + SETTLE_SECONDS);
	});
	while (world.time < end && !over()) {
		tick(director, s, world);
		// The steps this tick woke run before the next.
		await nextTurn();
	}
}

/** One tick of play: the world steps, the others act, and the director runs what is due. */
function tick(director:ArcDirector<SceneCtx>, s:Scenario, world:SceneWorld):void {
	world.step(SCENE_TICK);
	s.act?.(world, director);
	director.tick(SCENE_TICK, world.time);
}
