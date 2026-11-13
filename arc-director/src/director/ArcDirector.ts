import { STOCK_VERB_DEFS } from '../arc/stock-verbs.js';
import { parseArcText } from '../arc/arc-parse.js';
import { withLoneWait } from '../arc/choose.js';
import { arcArg } from '../arc/wire.js';
import { arcSteps, ArcError, BlockedArcError, type Arc, type ArcResult, type Step } from '../arc/arc-types.js';
import { choicePrompt, type ChoicePrompt } from '../character/choice.js';
import { lawGroup } from '../arc/laws.js';
import type { ArcRunner } from '../character/arc-runner.js';
import { Character, type CharacterJSON } from '../character/Character.js';
import type { KitSource } from '../character/character-types.js';
import type { NameTarget } from '../character/NameBook.js';
import { Collective, type CollectiveJSON } from '../collective/Collective.js';
import { hand, internalsOf } from '../internals.js';
import { Mind, mindTools, type MindSettings } from '../mind/mind.js';
import type { MindEvent, Sense, ThinkEvent, ToolSpec } from '../mind/mind-types.js';
import { buildCatalog, type HostKernels } from '../expr/natives.js';
import { evaluate, type EvalResult } from '../expr/eval.js';
import { ABSENT, ExprError, SampleCache, type Catalog } from '../expr/expr-types.js';
import { evaluateWho, lawMatches } from '../collective/who.js';
import { HandoverFeature } from '../collective/HandoverFeature.js';
import { createArcSession, DEFAULT_REARM, firstStartable, pollArcSession, reactionOf, watchIsTrue, type ArcHandler, type ArcPick, type ArcSession, type LastChoice } from '../arc/run.js';
import { PriorityThinkQueue, type MindQueue, type ThinkRow } from '../think/queue.js';
import { callEach, type CharacterSpec, type CollectiveSpec, type DirectorLog, type KernelSource, type SeenName, type VerbCall, type VerbHandler } from './director-types.js';
import { ModelRegistry, type LiveModel } from './model-registry.js';
import type { ModelProvider } from './ModelProvider.js';
import type { Offer } from '../world/offers.js';
import { OffersFeature } from '../world/OffersFeature.js';
import type { HostWorld } from '../world/world-types.js';
import type { Feature, FeatureTick } from './Feature.js';
import { GoalsFeature } from '../character/GoalsFeature.js';
import { Registry } from './Registry.js';
import { Verbs } from './Verbs.js';
import { WorldVerbsFeature } from '../world/WorldVerbsFeature.js';
import { Cast, collectiveOf, ownMindOf, remove } from './Cast.js';
import { Dispatcher } from './Dispatcher.js';
import { fit, Watches } from './Watches.js';

/** Game seconds between the tries `tick` makes to connect while the servers do not answer. */
const RETRY_SECONDS = 3;

/** A save of every character and collective: `ArcDirector.exportCast`. */
export type CastJSON = {
	characters:Record<string, CharacterJSON>;
	collectives:Record<string, CollectiveJSON>;
	/** Every open offer; none when no one offers anything. */
	offers?:Offer[];
	/** The director's `time`, which every time in the cast is on. */
	time?:number;
};

/** What the director hands its parts (`internalsOf`): its features, each other, and what of the core they call back. */
export type DirectorFields<TCtx> = {
	features:readonly Feature<TCtx>[];
	worldVerbs:WorldVerbsFeature<TCtx>;
	cast:Cast<TCtx>;
	watches:Watches<TCtx>;
	dispatcher:Dispatcher<TCtx>;
	/** Thinks ready to start: a mind that leaves the cast leaves them. */
	readyThink:ThinkRow[];
	/** A runner's System One pick, while it has one. */
	pick:(runner:ArcRunner<TCtx>)=>ArcPick | undefined;
	/** What each `on*` added. */
	listeners:Listeners<TCtx>;
	/** Call every listener `on` added, each guarded ({@link callEach}). */
	tell<K extends keyof Listeners<TCtx>>(on:K, ...args:Parameters<Listeners<TCtx>[K][number]>):void;
	/** `law` and `unlaw`, which the core runs. */
	law:(runner:ArcRunner<TCtx>, step:Step)=>ArcResult;
	/** The game time the watches were last asked. */
	watchedAt:()=>number | undefined;
};

/** What each `on*` added, by the method's name, in order: every one is called. */
type Listeners<TCtx> = {
	onLog:((entry:DirectorLog)=>void)[];
	onStep:((call:VerbCall<TCtx>, result:ArcResult)=>void)[];
	onThink:((event:ThinkEvent)=>void)[];
	onAbortArc:((id:string)=>void)[];
	onCommanderVacant:((collective:Collective<TCtx>, character:Character<TCtx>)=>void)[];
};

/** Whether an interval of `every` seconds that last fired at `last` is due at `now` (game time adds up in floating point). */
function due(last:number | undefined, every:number, now:number):boolean {
	return last === undefined || now - last >= every - 1e-6;
}

/**
 * `TCtx`: what the game hands a verb, sense or watch about a character (`withContext`). `TEntity`: the game's own type
 * for things in its world (`withWorld`).
 */
export class ArcDirector<TCtx = unknown, TEntity = unknown> {
	// ---- Lifecycle ----

	/** The cast is built from the specs (`wire`). Every builder works before and after. */
	private _wired = false;
	private _connected = false;
	/** A `connect` under way: one at a time. */
	private _connecting:Promise<void> | undefined;
	/** The game time `tick` next tries to connect at, while not connected. */
	private _retryAt = 0;
	private _disposed = false;
	private _time = 0;
	private readonly _listeners:Listeners<TCtx> = { onLog: [], onStep: [], onThink: [], onAbortArc: [], onCommanderVacant: [] };

	/** Its servers and models answered: thinks run. Until then laws, programs and moves still run on every tick. */
	public get connected():boolean {
		return this._connected && !this._disposed;
	}

	/**
	 * Wires the cast if it is not yet, then connects every server and model, and resolves once they answer (loaded and
	 * warm). Rejects with the first assembly or connection error, which `onLog` hears too; called again, it tries again.
	 * Optional: `tick` does the same on its own, every 3 game seconds until they answer.
	 */
	public async connect():Promise<this> {
		if (this._disposed) {
			throw new Error('ArcDirector disposed');
		}
		try {
			this.wire();
			if (!this._connected) {
				this._connecting ??= this.connectInference().finally(() => {
					this._connecting = undefined;
				});
				await this._connecting;
			}
		}
		catch (err:unknown) {
			const text = err instanceof Error ? err.message : String(err);
			this.log({ name: 'ArcDirector', message: text });
			throw err instanceof Error ? err : new Error(text);
		}
		return this;
	}

	/**
	 * Build the cast from the specs, once: the first `tick`, and every accessor that hands out cast objects, call it.
	 * Throws, building nothing, when a kit names what nothing registers or a spec does not hold together.
	 */
	private wire():void {
		if (this._wired || this._disposed) {
			return;
		}
		// Set first: a host's context or kernels asked while wiring may ask for the cast again.
		this._wired = true;
		try {
			this.syncVerbSchemas();
			this._cast.reportMissingNames();
			this._cast.wireAll(this._cast.stored);
			this._cast.stored = undefined;
		}
		catch (err) {
			this._cast.clear();
			this._wired = false;
			throw err;
		}
	}

	/** A setting the cast copied when it was wired changed (`Cast.rewire`). A running arc goes on; its next step sees the new kit. */
	private rewire():void {
		if (!this._wired) {
			return;
		}
		this.syncVerbSchemas();
		this._cast.rewire();
	}

	/** Write `entry` to the log `onLog` hears. */
	public log(entry:DirectorLog):void {
		// A listener that throws is not logged: that would only ask it again.
		callEach('onLog', this._listeners.onLog, [entry]);
	}

	/** Hear what the director logs: models, picks, failures. Each call adds a listener. */
	public onLog(fn:(entry:DirectorLog)=>void):this {
		this._listeners.onLog.push(fn);
		return this;
	}

	/** Call every listener `on` added, each guarded: one that throws is logged, and the rest still hear. */
	private tell<K extends keyof Listeners<TCtx>>(on:K, ...args:Parameters<Listeners<TCtx>[K][number]>):void {
		callEach(on, this._listeners[on] as ((...a:typeof args)=>void)[], args, (entry) => this.log(entry));
	}

	/** Game seconds its ticks have added up to: the clock its deadlines, rearms and memories go by. A save keeps it. */
	public get time():number {
		return this._time;
	}

	/**
	 * `dt` game seconds pass: laws, programs, moves, sounds and talk run, and ready minds think once connected. Until
	 * then it connects on its own (wiring the cast first) every 3 game seconds; what goes wrong goes to `onLog`, and
	 * nothing runs while the cast cannot be wired. A `dt` of 0 or less (a paused game) does nothing.
	 */
	public tick(dt:number):void {
		if (this._disposed || !(dt > 0)) {
			return;
		}
		this._time += dt;
		const now = this._time;
		if (!this._connected && !this._connecting && now >= this._retryAt) {
			this._retryAt = now + RETRY_SECONDS;
			void this.connect().catch(() => undefined);
		}
		if (!this._wired) {
			return;
		}
		const watch = due(this._watchedAt, this._intervals.watch, now);
		const think = due(this._thoughtAt ??= now, this._intervals.think, now);
		if (watch) {
			this._watchedAt = now;
		}
		if (think) {
			this._thoughtAt = now;
		}
		const rows = this._cast.ordered();
		for (const row of rows) {
			internalsOf(row.runner).stamp(now, this._watchedAt);
			row.runner.refreshKit();
		}
		for (const mind of this.minds()) {
			internalsOf(mind).stamp(now);
		}
		const step:FeatureTick = { dt, now, watch, think };
		this._features.forEach((feature) => feature.beforeWatches(step));
		// Built only for the minds whose watches are asked this tick: a view per character is not cheap.
		const catalogs = {
			get: (id:string):Catalog | Catalog[] | undefined => {
				try {
					const mind = this.mindByID(id);
					return mind && this._watches.catalogsFor(mind);
				}
				catch {
					return undefined;
				}
			},
		};
		this._readyThink.push(...this._queue.tick(dt, think ? catalogs : undefined));
		this._dispatcher.tickWaits();
		this._features.forEach((feature) => feature.beforeMoves(step));
		this._dispatcher.mover.tick();
		this._features.forEach((feature) => feature.afterMoves(step));
		for (const row of rows) {
			row.cache.commit();
		}
		if (watch) {
			this.tickAllLaws();
		}
		this._features.forEach((feature) => feature.beforeThinks(step));
		this.drain(now);
	}

	// ---- Features ----

	/** Every feature added, lowest `order` first, then in the order they were added. */
	private readonly _features:Feature<TCtx>[] = [];
	private readonly _cast = new Cast<TCtx>(this);
	private readonly _watches = new Watches<TCtx>(this);
	private readonly _dispatcher = new Dispatcher<TCtx>(this);

	/** Every director has every mind's own tools, goals reached, the memory handover, offers and the world verbs. */
	constructor() {
		hand(this, {
			features: this._features,
			worldVerbs: this._worldVerbs,
			cast: this._cast,
			watches: this._watches,
			dispatcher: this._dispatcher,
			readyThink: this._readyThink,
			pick: (runner) => this.pickFor(runner),
			listeners: this._listeners,
			tell: (on, ...args) => this.tell(on, ...args),
			law: (runner, step) => this.handleLaw(runner, step),
			watchedAt: () => this._watchedAt,
		} satisfies DirectorFields<TCtx>);
		Object.entries(mindTools<TCtx>()).forEach(([name, tool]) => this.tools.add(name, tool));
		this.addFeature(new GoalsFeature<TCtx>()).addFeature(new HandoverFeature<TCtx>()).addFeature(this.offers).addFeature(this._worldVerbs);
	}

	/**
	 * Add `feature`, any time: it installs at once (its verbs, tools and senses), and one added to a cast already wired
	 * meets every character, collective and mind in it. Adding it again does nothing.
	 */
	public addFeature(feature:Feature<TCtx>):this {
		if (this._features.includes(feature)) {
			return this;
		}
		internalsOf(feature).attach(this);
		const after = this._features.findIndex((other) => other.order > feature.order);
		this._features.splice(after < 0 ? this._features.length : after, 0, feature);
		feature.install();
		if (this._wired) {
			for (const { runner } of this._cast.rows.values()) {
				feature.runnerAdded(runner);
			}
		}
		return this;
	}

	/**
	 * The feature of `type` on this director, if any: Kindling's `getComponent`, Unity's `GetComponent<T>()`. For a game's
	 * own: a built-in has its `get*` shortcut (`getSight()`), typed with this director's context.
	 */
	public getFeature<F>(type:abstract new (...args:never[])=>F):F | undefined {
		return this._features.find((feature) => feature instanceof type) as F | undefined;
	}

	/**
	 * The feature of `type` here, else `make()`; `configure` it, then add it if it is new, so it installs configured. What
	 * a built-in feature's `with*` shortcut does, so a second call configures the same feature again (`withMap`, `withTalk`, …).
	 */
	public configureFeature<F extends Feature<TCtx>>(type:abstract new (...args:never[])=>F, make:()=>F, configure?:(feature:F)=>void):this {
		const feature = this.getFeature(type) ?? make();
		configure?.(feature);
		return this.addFeature(feature);
	}

	/** Every runner's laws and standing `choose`, and each collective's laws. */
	private tickAllLaws():void {
		for (const { runner } of this._cast.rows.values()) {
			if (!(runner instanceof Character)) {
				continue;
			}
			if (!runner.collective) {
				this.tickLaws(runner);
			}
			this.tickStanding(runner);
		}
		for (const { runner } of this._cast.rows.values()) {
			if (!(runner instanceof Collective)) {
				continue;
			}
			// Whatever brought it down, a mind does not go on thinking through it.
			const commander = runner.commander;
			if (commander && this._world?.isDown?.(commander.id)) {
				internalsOf(runner).vacate(commander);
			}
			this.tickCollectiveLaws(runner);
		}
	}

	public dispose():void {
		this._disposed = true;
		this._cast.clear();
		this.models.dispose();
	}

	// ---- Inference ----

	/** The providers and the one index of model roles on them; every request timed (`infer`) and logged (`onLog`). */
	public readonly models = new ModelRegistry((entry) => this.log(entry));

	/** `provider` under its name, any time, in place of one named alike; each role it holds moves to it. */
	public addProvider(provider:ModelProvider):this {
		this.models.addProvider(provider);
		return this;
	}

	/** Provider `name`; each `get*` shortcut gives its own kind typed (`getLMStudio`). */
	public getProvider(name:string):ModelProvider | undefined {
		return this.models.getProvider(name);
	}

	/** Model `role`, or the default when it is omitted or gone, once its provider answered. */
	public getModel(role?:string):LiveModel | undefined {
		return this.models.live(role);
	}

	/** A chat model, unless every character acts by a standing `choose` on a System One that needs no chat. */
	private needsChat():boolean {
		return this.models.roles.length === 0
			|| this._cast.collectiveSpecs.length > 0
			|| this._cast.solo.some((spec) => spec.mind)
			|| Object.values(this._cast.stored?.characters ?? {}).some((json) => json.mind);
	}

	private async connectInference():Promise<void> {
		await this.models.start();
		if (!this.models.live() && this.needsChat()) {
			throw new Error('ArcDirector: no inference (addLMStudio / addOllama / addWllama / addFake / addProvider)');
		}
		this._connected = true;
	}

	// ---- Choice (System One picking) ----

	/** One pick closure per character, so `withheldVerbs` asking for it every refresh stays cheap. */
	private readonly _picks = new WeakMap<ArcRunner<TCtx>, ArcPick>();

	/**
	 * What `id`'s System One would be asked now to pick among `choices` (arcs, or arc text), as `choose` words it
	 * ({@link choicePrompt}); undefined when none can run. `doing` and `last` stand in for its verb and last choice.
	 */
	public choiceQuestion(id:string, choices:Record<string, Arc | string>, { doing, last }:{ doing?:string; last?:LastChoice } = {}):ChoicePrompt | undefined {
		const runner = this.character(id) ?? this.collective(id);
		if (!runner) {
			throw new Error(`no character or collective ${id}`);
		}
		const arcs = Object.fromEntries(Object.entries(choices).map(([name, arc]) => [name, typeof arc === 'string' ? parseArcText(arc, this.verbs) : arc]));
		return this.choiceQuestionOf(runner, arcs, doing ?? runner.verb, last);
	}

	private choiceQuestionOf(runner:ArcRunner<TCtx>, choices:Record<string, Arc>, verb:string, last:LastChoice | undefined):ChoicePrompt | undefined {
		return choicePrompt({ id: runner.id, verb, last, catalog: runner.catalog?.(), choices: withLoneWait(choices), verbs: this.verbs });
	}

	/** Start a character's standing `choose` while it is idle, System One is on, and its `until` does not hold. */
	private tickStanding(character:Character<TCtx>):void {
		const standing = this._cast.standing.get(character);
		if (!standing || character.arcSession || this._time < standing.restUntil || !this.pickFor(character)) {
			return;
		}
		const catalog = standing.until ? character.catalog?.() : undefined;
		if (standing.until && catalog && watchIsTrue(standing.until, catalog)) {
			return;
		}
		void character.enact(standing.arc).then((result) => {
			// A dead endpoint or a bad pick rests like a handler would, instead of asking again every tick.
			if (result.status === 'failed') {
				standing.restUntil = this._time + character.cooldown;
			}
		}, (err:unknown) => {
			standing.restUntil = this._time + character.cooldown;
			this.log({ name: character.id, message: `choose: ${err instanceof Error ? err.message : String(err)}`, error: true });
		});
	}

	/**
	 * The name of a runner's System One: the one its spec names, else its collective's, else the default. A spec's
	 * `null` means none there, whatever the default is.
	 */
	private systemOneOf(runner:ArcRunner<TCtx>):string | null {
		const specs = [
			this._cast.rows.get(runner.id)?.spec,
			runner instanceof Character && runner.collective ? this._cast.rows.get(runner.collective.id)?.spec : undefined,
		];
		const assigned = specs.find((spec) => spec?.systemOne !== undefined)?.systemOne;
		const name = assigned === undefined ? this.models.defaultSystemOne : assigned;
		return name && this.models.has(name) ? name : null;
	}

	/** This runner's pick while it has a System One. */
	private pickFor(runner:ArcRunner<TCtx>):ArcPick | undefined {
		if (!this.systemOneOf(runner)) {
			return undefined;
		}
		let pick = this._picks.get(runner);
		if (!pick) {
			pick = (goal, choices, last) => this.pick(runner, goal, choices, last);
			this._picks.set(runner, pick);
		}
		return pick;
	}

	/**
	 * Ask which of `choices` serves `goal` now, worded by {@link choicePrompt}. A lone choice left is taken unasked;
	 * with none left the pick fails unasked. The runner's own System One answers first; when it fails or names no
	 * choice, every other System One in turn, then the runner's chat model. One that failed rests a while.
	 */
	private async pick(runner:ArcRunner<TCtx>, goal:string, choices:Record<string, Arc>, last:LastChoice | undefined):Promise<string> {
		const own = this.systemOneOf(runner);
		if (!own) {
			throw new Error('System One is off');
		}
		const prompt = this.choiceQuestionOf(runner, choices, runner.verb, last);
		if (!prompt) {
			throw new Error('no choice can run now');
		}
		const { state, criteria } = prompt;
		const shown = Object.keys(criteria);
		const now = performance.now();
		if (shown.length === 1) {
			this.logPick(runner, goal, `${shown[0]}, the only one that can run`, now, [], state, criteria);
			runner.record.picked(shown[0]);
			return shown[0];
		}
		const { name, by, misses } = await this.models.pick(own, state, goal, criteria, runner.mind?.setting('model'));
		this.logPick(runner, goal, name ? `${name} by ${by}` : 'nothing', now, misses, state, criteria);
		if (!name) {
			throw new Error(misses.join('; ') || 'no System One answered');
		}
		runner.record.picked(name);
		return name;
	}

	private logPick(runner:ArcRunner<TCtx>, goal:string, answer:string, started:number, misses:string[], state:string, criteria:Record<string, string>):void {
		const lines = Object.entries(criteria).map(([key, arc]) => `  ${key}: ${arc}`).join('\n');
		this.log({
			name: runner.id,
			message: `choose ${JSON.stringify(goal)} → ${answer} in ${Math.round(performance.now() - started)}ms`
				+ `${misses.length > 0 ? ` (${misses.join('; ')})` : ''}\n${state}\n${lines}`,
			error: answer === 'nothing',
		});
	}

	// ---- Verbs and dispatch ----

	/**
	 * The verbs arcs may name, with the host's handlers, aliases and gate: `withVerbs((v) => v.addStock().add('ring', …))`.
	 * Every character and collective parses and runs with it, so a change reaches them at once.
	 */
	public readonly verbs:Verbs<TCtx> = new Verbs<TCtx>(() => this.syncVerbSchemas());
	private _world:HostWorld<TEntity> | undefined;

	/** The game's world (`withWorld`), if it gave one. */
	public get world():HostWorld<TEntity> | undefined {
		return this._world;
	}
	/** Every open offer (`OffersFeature`), saved with the cast. */
	public readonly offers = new OffersFeature<TCtx>();
	/** The stock world verbs, crowds and group walks (`withWorld`, `withWorldVerbs`). */
	private readonly _worldVerbs = new WorldVerbsFeature<TCtx>();

	/**
	 * The game's world: where things are, how characters move, and how items, uses, looks, and trades work, with the
	 * stock world verbs (`go_to`, `pick_up`, `offer`, …) run on it, and the watch geometry. Its crowds and group walks:
	 * `withWorldVerbs`. Every part but `find` receives a `TEntity`.
	 */
	public withWorld(world:HostWorld<TEntity>):this {
		this._world = world;
		this._dispatcher.moveIn(world);
		return this;
	}

	/** Configure the verbs: `withVerbs((v) => v.addStock().add('ring', { args, help, handler }).withGate(…))`. */
	public withVerbs(configure:(verbs:Verbs<TCtx>)=>void):this {
		configure(this.verbs);
		return this;
	}

	/**
	 * What the registry says that other settings decide, kept in step with them; run again whenever one changes. A law
	 * whose whole arc is an alias with a watch may leave its own out; every feature says what it adds to help lines again.
	 */
	private syncVerbSchemas():void {
		if (this.verbs.list().some((spec) => this.verbs.alias(spec.name)?.watch !== undefined) && this.verbs.get('law')?.args.watch?.kind === 'watch') {
			this.verbs.redefine('law', { ...STOCK_VERB_DEFS.law, args: { ...STOCK_VERB_DEFS.law.args, watch: 'watch?' } });
		}
		this._features.forEach((feature) => feature.verbsChanged());
	}

	/** What runs a verb that nothing else handles: one handler, since it answers how the step went. */
	public onVerb(fn:VerbHandler<TCtx>):this {
		this._dispatcher.catchAll = fn;
		return this;
	}

	/** Whenever a character is stopped: end what the host runs for it. Each call adds a listener. */
	public onAbortArc(fn:(id:string)=>void):this {
		this._listeners.onAbortArc.push(fn);
		return this;
	}

	/** After a host verb resolves. `say` does not come through here. Each call adds a listener. */
	public onStep(fn:(call:VerbCall<TCtx>, result:ArcResult)=>void):this {
		this._listeners.onStep.push(fn);
		return this;
	}

	/** Stop whatever character `id` is doing now: its waits and moves here, the rest through `onAbortArc`. */
	public abortArc(id:string):void {
		this._dispatcher.stop(id);
	}

	/**
	 * `law` / `unlaw` from `runner`. The voice of a collective writes the collective's own laws; anyone else
	 * writes its own, which a character in a collective keeps there (`Tom.flee`).
	 */
	private handleLaw(runner:ArcRunner<TCtx>, step:Step):ArcResult {
		const home = runner.isVoice ? collectiveOf(runner) ?? runner : runner;
		const name = typeof step.args.name === 'string' && step.args.name ? step.args.name : undefined;
		if (step.verb === 'unlaw') {
			if (!name) {
				return { status: 'failed', verb: 'unlaw', reason: 'unlaw needs name' };
			}
			home.removeLaw(name);
			return { status: 'ok', verb: 'unlaw' };
		}
		const who = typeof step.args.who === 'string' ? step.args.who : undefined;
		if (who && !home.lawsTakeWho()) {
			const reason = collectiveOf(runner) ? 'your own law reaches only you; it has no who' : 'solo law has no who';
			return { status: 'failed', verb: 'law', reason };
		}
		const arc = arcArg(step.args.arc, this.verbs);
		// A law whose whole arc is one alias takes the alias's watch, who, rearm and name when it gives none.
		const alias = arc?.length === 1 ? this.verbs.aliasPart(arc[0], 'watch') : undefined;
		const watch = typeof step.args.watch === 'string' && step.args.watch ? step.args.watch : alias ?? '';
		if (!watch || !arc) {
			return { status: 'failed', verb: 'law', reason: 'law needs watch and arc' };
		}
		const aliasWho = arc.length === 1 && home.lawsTakeWho() ? this.verbs.aliasPart(arc[0], 'who') : undefined;
		const aliasName = arc.length === 1 && this.verbs.alias(arc[0].verb) ? arc[0].verb : undefined;
		const aliasRearm = aliasName ? this.verbs.alias(aliasName)!.rearm : undefined;
		// All units shouting one line is never what is meant: it is the commander's own.
		const speaks = home.lawsTakeWho() && home.voice !== home && arcSteps(arc).every((part) => part.verb === 'say');
		if (!home.addLaw({ rearm: aliasRearm, ...reactionOf(step.args), name: name ?? aliasName, who: who ?? aliasWho ?? (speaks ? 'me' : undefined), watch, arc })) {
			return { status: 'failed', verb: 'law', reason: `no law${name ? ` ${name}` : ''}: too many laws, or a bad name; unlaw one first` };
		}
		return { status: 'ok', verb: 'law' };
	}

	/** `then(this)` when `condition` holds, else `otherwise(this)`, so a condition need not break the chain. */
	public if(condition:unknown, then:(director:this)=>void, otherwise?:(director:this)=>void):this {
		(condition ? then : otherwise)?.(this);
		return this;
	}

	// ---- Arc checks ----

	/**
	 * Before an Arc cuts short work not finished (a program with its steps still to do, or that has not gone once round
	 * its loop), ask the model, in a short follow-up to that same think, what to do with each, told where it has got to:
	 * replace it, append the new work to it, or keep it and drop the new work. Off by default.
	 */
	public withReplaceCheck(on = true):this {
		this._dispatcher.replaceCheck = on;
		return this;
	}

	/**
	 * What each mind is doing as it thinks, down to its reply as it is written, and the orders it gives: for a host to
	 * show. Each call adds a listener.
	 */
	public onThink(fn:(event:ThinkEvent)=>void):this {
		this._listeners.onThink.push(fn);
		return this;
	}

	// ---- Perception (sight, hearing, kernels, catalogs) ----

	/** What minds sense, by name, in prompt order: `withSenses((s) => s.add('weather', (ctx, mind) => …))`. */
	public readonly senses = new Registry<Sense<TCtx>>(() => this.rewire());

	/** Configure the senses: `withSenses((s) => s.add('weather', (ctx, mind) => …).remove('carrying'))`. */
	public withSenses(configure:(senses:Registry<Sense<TCtx>>)=>void):this {
		configure(this.senses);
		return this;
	}

	/**
	 * How each mind names other characters: `seen` returns a base name from what the mind holds about the target, which
	 * its owner's book keeps stable and numbers (`EnemyWitch2`). Arcs, laws and watches stay in ids.
	 */
	public withNames(seen:SeenName<TCtx>):this {
		this._watches.names = seen;
		this.rewire();
		return this;
	}

	/** What the mind of character or collective `observerID` calls a character, for host-built text such as a sight `note`. */
	public seen(observerID:string, target:NameTarget):string {
		return (this.character(observerID) ?? this.collective(observerID))?.mind?.seen(target) ?? target.id;
	}

	/**
	 * `expr` (watch syntax) as character or collective `id` sees the world now, for host tools such as a camera that
	 * follows `others.filter(u => doing(u, "cleave"))`. Every character in `others` carries its `busy` and `verb`. A
	 * collective sees as its laws do: through its commander, else through all its characters.
	 */
	public evaluate(id:string, expr:string):EvalResult {
		const runner = this.character(id);
		const ctx = runner?.context();
		const kernels = runner && ctx !== undefined ? this._watches.kernelsFor(runner, ctx) : undefined;
		const collective = runner ? undefined : this.collective(id);
		const catalog = kernels ? buildCatalog(kernels) : collective && this._watches.catalog(collective.voice);
		return catalog ? evaluate(expr, catalog) : { value: ABSENT, error: new ExprError(`${id} has no view of the world`) };
	}

	/** Whether watch `watch` holds for character or collective `id`, as it sees the world now: false where it does not evaluate. */
	public holds(id:string, watch:string):boolean {
		const r = this.evaluate(id, watch);
		return !r.error && fit(r.value) > 0;
	}

	public withContext(fn:(id:string)=>TCtx | undefined):this {
		this._watches.context = fn;
		return this;
	}

	public withKernels(fn:KernelSource<TCtx>):this {
		this._watches.kernels = fn;
		this.rewire();
		return this;
	}

	/** The watch-language view `runner` has from `ctx` now, its collective's `units` too; none without `withKernels`. */
	public catalogOf(runner:ArcRunner<TCtx>, ctx:TCtx):Catalog | undefined {
		return this._watches.catalog(runner, ctx, new SampleCache());
	}

	/** What the cast's minds see from, in this director's words: `kernelsFor` for a host feature, none without `withKernels`. */
	public kernelsOf(runner:ArcRunner<TCtx>, ctx:TCtx):HostKernels | undefined {
		return this._watches.kernelsFor(runner, ctx);
	}

	/** Character or collective `id`'s context (`withContext`); none when it has none, or asking threw. */
	public contextOf(id:string):TCtx | undefined {
		try {
			return this._watches.context?.(id);
		}
		catch {
			return undefined;
		}
	}

	// ---- Mind configuration ----

	private readonly _mindDefaults:MindSettings = {};

	/** The director's layer of every mind's settings, as `withMind` set it: what features read the currency from. */
	public get mindDefaults():Readonly<MindSettings> {
		return this._mindDefaults;
	}
	/** What minds may look up as they think, by name: `withTools((t) => t.add('sniff', { description, parameters, handler }))`. */
	public readonly tools = new Registry<ToolSpec<TCtx>>();

	/**
	 * The director's layer of every mind's settings, under each mind's own: `withMind({ currency: 'gold' })`, merged into
	 * what earlier calls set (`undefined` unsets one). A change reaches every mind on its next think.
	 */
	public withMind(settings:MindSettings):this {
		Object.assign(this._mindDefaults, settings);
		// The queue keeps its own copy of what wakes a mind.
		for (const mind of this._cast.minds()) {
			this._cast.enqueue(mind);
		}
		return this;
	}

	/** Configure the tools: `withTools((t) => t.add(name, spec))`; a look-ahead in a game is `t.add('chess_move', searchTool(spec))`. */
	public withTools(configure:(tools:Registry<ToolSpec<TCtx>>)=>void):this {
		configure(this.tools);
		return this;
	}

	// ---- Cast (specs, rows, wiring, membership, handover, save) ----

	/** Game seconds a standing `choose` rests after a failed pick, for every runner without its own. Default 8. */
	public withCooldown(seconds:number):this {
		this._cast.cooldown = seconds;
		this.rewire();
		return this;
	}

	/** What a character or collective spec without a `kit` gets (`withDefaultKit`), if the host or a genre said. */
	public get defaultKit():KitSource<TCtx> | undefined {
		return this._cast.defaultKit;
	}

	/** Used when a character or collective spec omits `kit`, a collective's characters too. */
	public withDefaultKit(kit:KitSource<TCtx>):this {
		this._cast.defaultKit = kit;
		this.rewire();
		return this;
	}

	/** A collective's commander left or died. Name a new one with `collective.commander = …`. Each call adds a listener. */
	public onCommanderVacant(fn:(collective:Collective<TCtx>, character:Character<TCtx>)=>void):this {
		this._listeners.onCommanderVacant.push(fn);
		return this;
	}

	/**
	 * A character on its own: an NPC with `mind` settings, or one the host drives (the Player) without them.
	 * Its id must be new among characters and collectives.
	 */
	public addCharacter(spec:CharacterSpec<TCtx>):this {
		const cast = this._cast;
		cast.claimID(spec.id);
		cast.solo.push(spec);
		cast.specs.set(spec.id, spec);
		if (this._wired) {
			cast.reportMissingNames([spec]);
			cast.wireCharacter(spec);
		}
		return this;
	}

	/** Characters sharing one mind. Its id and its characters' ids must be new. */
	public addCollective(spec:CollectiveSpec<TCtx>):this {
		// Its own list: `removeCharacter` trims it, and the host's spec stays whole for the next director.
		const own = { ...spec, characters: [...(spec.characters ?? [])] };
		const cast = this._cast;
		cast.claimID(own.id);
		for (const character of own.characters) {
			cast.claimID(character.id);
			cast.specs.set(character.id, character);
		}
		cast.collectiveSpecs.push(own);
		if (this._wired) {
			cast.reportMissingNames([own, ...own.characters.filter((c) => c.kit)]);
			cast.wireCollective(own);
		}
		return this;
	}

	/** Remove a character for good, on its own or from its collective. A commander's leaving tells `onCommanderVacant`. */
	public removeCharacter(id:string):this {
		const cast = this._cast;
		cast.specs.delete(id);
		remove(cast.solo, id);
		for (const spec of cast.collectiveSpecs) {
			remove(spec.characters ?? [], id);
		}
		cast.dropCharacter(id);
		return this;
	}

	/** Remove a collective. Its characters stay, each on its own: with a fresh mind if their spec gave one settings. */
	public removeCollective(id:string):this {
		const cast = this._cast;
		const spec = remove(cast.collectiveSpecs, id);
		const runner = cast.rows.get(id)?.runner;
		const members = (runner instanceof Collective ? runner.characters : spec?.characters ?? []).map((c) => c.id);
		for (const member of members) {
			const memberSpec = cast.specs.get(member);
			if (memberSpec) {
				cast.solo.push(memberSpec);
			}
		}
		cast.dropCollective(id);
		return this;
	}

	/** Character `id`, on its own or in a collective. Like every accessor of the cast, it wires the cast first. */
	public character(id:string):Character<TCtx> | undefined {
		this.wire();
		const runner = this._cast.rows.get(id)?.runner;
		return runner instanceof Character ? runner : undefined;
	}

	/** Every character: on its own or in a collective. */
	public characters():Character<TCtx>[] {
		this.wire();
		return [...this._cast.rows.values()].flatMap(({ runner }) => (runner instanceof Character ? [runner] : []));
	}

	public collective(id:string):Collective<TCtx> | undefined {
		this.wire();
		const runner = this._cast.rows.get(id)?.runner;
		return runner instanceof Collective ? runner : undefined;
	}

	public collectives():Collective<TCtx>[] {
		this.wire();
		return [...this._cast.rows.values()].flatMap(({ runner }) => (runner instanceof Collective ? [runner] : []));
	}

	/** Every mind that thinks: characters' own, then collectives'. */
	public minds():Mind<TCtx>[] {
		this.wire();
		return this._cast.minds();
	}

	/** Every character and collective, as a save. Restore it with `restoreCast`. */
	public exportCast():CastJSON {
		const characters:Record<string, CharacterJSON> = {};
		for (const character of this.characters()) {
			characters[character.id] = character.toJSON();
		}
		const collectives:Record<string, CollectiveJSON> = {};
		for (const collective of this.collectives()) {
			collectives[collective.id] = collective.toJSON();
		}
		return { characters, collectives, offers: this.offers.toJSON(), time: this._time };
	}

	/**
	 * Rebuild the cast from `exportCast`, under the specs added here. Before the cast is wired it is kept, and the cast
	 * is built from it then. A collective's characters come from the save, so ones that joined or died stay that way.
	 */
	public restoreCast(cast:CastJSON):void {
		this._time = cast.time ?? this._time;
		if (!this._wired) {
			this._cast.stored = cast;
			return;
		}
		this._cast.clear();
		this._cast.wireAll(cast);
	}

	/** Tell every mind once. */
	public pushEvent(event:MindEvent):void {
		for (const mind of this.minds()) {
			mind.pushEvent(event);
		}
	}

	// ---- Thinking (queue, drain, laws tick) ----

	private _queue:MindQueue = new PriorityThinkQueue();
	private _rearm = DEFAULT_REARM;
	private _intervals = { watch: 0.05, think: 0.25 };
	/** Game time the `watch` interval and the `think` interval last fired at. */
	private _watchedAt:number | undefined;
	private _thoughtAt:number | undefined;
	/** Minds whose think in flight came of their heartbeat alone: their laws need not wait for it. */
	private readonly _beatThinks = new Set<string>();
	private readonly _readyThink:ThinkRow[] = [];

	/** Your own queue minds wait in to think; `withPriorityThinkQueue` (the default) and `withSimpleThinkQueue` set the stock ones. */
	public withQueue(queue:MindQueue):this {
		this._queue = queue;
		for (const mind of this._cast.minds()) {
			this._cast.enqueue(mind);
		}
		this.rewire();
		return this;
	}

	/** Game seconds a `when`'s or a law's watch must have been false before it starts again, unless it sets its own `rearm`. Default 1. */
	public withRearm(seconds:number):this {
		this._rearm = Math.max(0, seconds);
		return this;
	}

	/**
	 * Game seconds between asks of the watches: every `watch` (default 0.05) laws, parked `when`s and steps' `until`s; every
	 * `think` (default 0.25) the minds' own watches and goals' `until`s. `watch` fires on the first tick, `think` an interval after.
	 */
	public withIntervals(intervals:{ watch?:number; think?:number }):this {
		this._intervals = { ...this._intervals, ...intervals };
		return this;
	}

	/** The queue minds wait in to think (`withQueue`). */
	public get queue():MindQueue {
		return this._queue;
	}

	/** Laws and the live arc session of a character on its own. */
	private tickLaws(character:Character<TCtx>):void {
		if (character.laws.length === 0 && !character.arcSession) {
			return;
		}
		const watches = this._watches;
		const catalog = character.arcSession?.catalog ?? (watches.kernels && watches.context ? () => watches.catalog(character) : undefined);
		this.pollRunner(character, () => internalsOf(character).lawHandlers(), catalog);
		internalsOf(character).dropFinishedLaws(() => [character.id]);
	}

	/** A collective's laws on each of its characters, their sessions, and its own session while it has no commander. */
	private tickCollectiveLaws(collective:Collective<TCtx>):void {
		const voice = collective.voice;
		const whoCat = this._watches.catalog(voice);
		if (!whoCat) {
			return;
		}
		for (const character of collective.characters) {
			const ctx = this.contextOf(character.id);
			if (!ctx) {
				if (character !== collective.commander && character.busy) {
					character.replaceProgram();
				}
				continue;
			}
			const extras = ():ArcHandler[] => internalsOf(collective).lawHandlersFor(character, (law) => lawMatches(law, character, whoCat, collective));
			const catalog = ():Catalog | undefined => this._watches.catalog(character, this.contextOf(character.id) ?? ctx);
			this.pollRunner(character, extras, catalog);
		}
		if (voice === collective) {
			this.pollRunner(collective, () => [], () => whoCat);
		}
		internalsOf(collective).dropFinishedLaws((law) => (lawGroup(law.name) === '' ? evaluateWho(law.who, whoCat, collective).map((c) => c.id) : [lawGroup(law.name)]));
	}

	/**
	 * A think something called for is in flight or already queued, so a law must not walk the character out from under
	 * it. Not a heartbeat's: a mind that thinks on a beat always has one coming, and its laws would never act. Not
	 * before the mind's first think ends either: laws act from the start, not after the opening think.
	 */
	private thinkWaiting(mindID:string):boolean {
		if (!this._queue.hasThought(mindID)) {
			return false;
		}
		return (this._queue.isThinking(mindID) && !this._beatThinks.has(mindID))
			|| this._queue.hasPending(mindID, 'heartbeat')
			|| this._readyThink.some((row) => row.mindID === mindID && row.reason !== 'heartbeat');
	}

	/**
	 * Poll `runner`'s live session, or start the first law that holds. A voice waits for its mind's think, except a
	 * party's commander: that think is mostly orders for others, and its own laws (heal, keep back) cannot wait.
	 */
	private pollRunner(runner:ArcRunner<TCtx>, lawHandlers:()=>ArcHandler[], catalog:ArcSession['catalog']):void {
		const session = runner.arcSession;
		const opts = { catalog: catalog ?? session?.catalog, now: () => this._time, rearm: this._rearm, extraHandlers: lawHandlers, abortHost: () => this.abortArc(runner.id) };
		if (session) {
			pollArcSession(Object.assign(session, opts));
			return;
		}
		const first = firstStartable(createArcSession(opts));
		const commander = runner instanceof Character && !!runner.collective;
		const mind = runner.isVoice && !commander ? runner.mind : null;
		if (first && !(mind && this.thinkWaiting(mind.id))) {
			internalsOf(runner).beginLaw(first, opts);
		}
	}

	/** The mind the queue knows as `id`: a character's own, or a collective's. */
	private mindByID(id:string):Mind<TCtx> | undefined {
		return ownMindOf(this.character(id)) ?? this.collective(id)?.mind;
	}

	/** Start every ready think, best first: each waits for a slot of its model, ranked there by its score. */
	private drain(now:number):void {
		const queue = this._queue;
		if (!this._connected) {
			return;
		}
		const score = (row:ThinkRow):number => queue.rankScore(row.mindID, row.score);
		this._readyThink.sort((a, b) => score(b) - score(a) || (this.mindByID(b.mindID)?.setting('rank') ?? 0) - (this.mindByID(a.mindID)?.setting('rank') ?? 0));
		const held:ThinkRow[] = [];
		for (const row of this._readyThink) {
			const mind = this.mindByID(row.mindID);
			if (!mind) {
				continue;
			}
			if (queue.isThinking(row.mindID) || !queue.allowThink(row)) {
				held.push(row);
				continue;
			}
			queue.drop(row.mindID);
			this._beatThinks[row.reason === 'heartbeat' ? 'add' : 'delete'](row.mindID);
			this.fireThink(mind, now, score(row));
		}
		this._readyThink.length = 0;
		this._readyThink.push(...held);
	}

	private fireThink(mind:Mind<TCtx>, now:number, priority:number):void {
		void mind.tick(now, priority)
			.then((arc) => {
				if (!mind.attached) {
					return;
				}
				this._queue.setWatches(mind.id, mind.persona.effectiveWatches());
				if (!arc) {
					this._queue.noteResult(mind.id, true);
				}
			})
			.catch((err:unknown) => {
				if (!mind.attached) {
					return;
				}
				const text = err instanceof Error ? err.message : String(err);
				this.log({ name: mind.thinkThread(), message: `stalled: ${text}` });
				this._queue.noteResult(mind.id, true);
				// An invalid reply ends no arc, so nothing would wake this mind: think again once, told why.
				// Aborts and inference errors are not the mind's doing.
				if (err instanceof ArcError) {
					const again = mind.lastResult?.verb !== 'think' || mind.lastResult.status === 'ok';
					const why = err instanceof BlockedArcError ? 'your plan cannot run' : 'your reply was not a valid Arc';
					mind.ingestResult({ status: 'failed', verb: 'think', reason: `${why}: ${text}` });
					if (again) {
						this._queue.enqueueVerb(mind.id, 'think', false);
					}
				}
			});
	}
}
