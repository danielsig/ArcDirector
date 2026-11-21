import { formatArc } from '../arc/arc-format.js';
import { parseArcText } from '../arc/arc-parse.js';
import type { Arc, StepArg } from '../arc/arc-types.js';
import { lawGroup, type Law, type LawSpec } from '../arc/laws.js';
import { DEFAULT_COOLDOWN } from '../arc/run.js';
import { CHOOSE_VERB } from '../arc/stock-verbs.js';
import { validateArc } from '../arc/validate.js';
import type { ArcRunner, RunnerOptions } from '../character/arc-runner.js';
import { Character, type CharacterJSON } from '../character/Character.js';
import type { Goal, Kit, KitSource } from '../character/character-types.js';
import { Persona } from '../character/Persona.js';
import { MemoryPool, MemorySharing } from '../memory/store.js';
import { Collective, type CollectiveFields } from '../collective/Collective.js';
import { usesCollective } from '../collective/who.js';
import { parse } from '../expr/expr-parse.js';
import { SampleCache } from '../expr/expr-types.js';
import { trainedOnArcDirector } from '../inference/models.js';
import { internalsOf } from '../internals.js';
import { Mind, type MindDeps, type MindSettings } from '../mind/mind.js';
import type { MindEvent } from '../mind/mind-types.js';
import { TalkFeature } from '../mind/TalkFeature.js';
import { missingPart } from '../world/world-verbs.js';
import type { ArcDirector, CastJSON } from './ArcDirector.js';
import type { Feature } from './Feature.js';
import type { CharacterSpec, CollectiveSpec } from './director-types.js';
import type { ModelRun } from './ModelSlots.js';

/**
 * Verbs a collective takes only from a kit of its own, never from a shared one: `think` is a single character's habit,
 * and who a collective is belongs to the game's design.
 */
const OWN_KIT_ONLY = new Set(['think', 'set_identity']);

/** A character's standing `choose`: its loop, its `until`, and the game time a failed loop rests until. */
export type Standing = { arc:Arc; until?:string; restUntil:number };

/** What the cast keeps per character or collective: the spec it was built from, and its per-tick sample cache. */
export type Row<TCtx> =
	| { spec:CharacterSpec<TCtx>; runner:Character<TCtx>; cache:SampleCache }
	| { spec:CollectiveSpec<TCtx>; runner:Collective<TCtx>; cache:SampleCache };

/** A mind's model while it has not resolved: every lease says so. */
const NO_MODEL:ModelRun = () => Promise.reject(new Error('ArcDirector: no chat model'));

/** The collective `runner` acts in: itself, or the one its character belongs to. */
export function collectiveOf<TCtx>(runner:ArcRunner<TCtx>):Collective<TCtx> | null {
	return runner instanceof Collective ? runner : runner instanceof Character ? runner.collective : null;
}

/** The mind a character thinks for itself with (in a collective too); null while its collective's thinks for it. */
export function ownMindOf<TCtx>(character:Character<TCtx> | undefined):Mind<TCtx> | null {
	return character?.thinksForItself ? character.mind : null;
}

/** Remove the spec with `id` from `specs`, and return it. */
export function remove<TSpec extends { id:string }>(specs:TSpec[], id:string):TSpec | undefined {
	const i = specs.findIndex((spec) => spec.id === id);
	return i < 0 ? undefined : specs.splice(i, 1)[0];
}

/**
 * A character's laws, moved onto `collective` as its own: `flee` becomes `Tom.flee`, reaching only Tom. Each law
 * object moves itself, so an arc it started still counts as its own.
 */
function moveLawsInto<TCtx>(character:Character<TCtx>, collective:CollectiveFields<TCtx>):void {
	for (const law of character.laws) {
		law.name = `${character.id}.${law.name}`;
		law.who = 'me';
		collective.keepLaw(law);
	}
	character.laws = [];
}

/**
 * The cast: the specs added, the character or collective each is wired into, and who belongs where. It checks specs and
 * kits, wires runners and minds into the director's parts, moves characters between collectives and minds, and builds
 * the cast from a save. A part of {@link ArcDirector}, which keeps the public calls.
 */
export class Cast<TCtx> {
	/** `restoreCast` before the cast is wired: it is built from it then. */
	public stored:CastJSON | undefined;
	public defaultKit:KitSource<TCtx> | undefined;
	public cooldown = DEFAULT_COOLDOWN;
	/** Specs from `addCharacter`, in order: the characters on their own when the cast is built or restored. */
	public readonly solo:CharacterSpec<TCtx>[] = [];
	public readonly collectiveSpecs:CollectiveSpec<TCtx>[] = [];
	/** Every character spec by id, on its own or in a collective. One id namespace covers characters and collectives. */
	public readonly specs = new Map<string, CharacterSpec<TCtx>>();
	/** Every character and collective by id, in the order they were wired. */
	public readonly rows = new Map<string, Row<TCtx>>();
	/** Each character's standing `choose`. */
	public readonly standing = new WeakMap<Character<TCtx>, Standing>();
	/** Every memory of the cast, once each: each persona's memory is a view of it. */
	public pool = new MemoryPool();

	constructor(private readonly _director:ArcDirector<TCtx>) {}

	/**
	 * Whose memories `id`'s persona reads, asked when it is read: a collective's, what it and its characters know; a
	 * character of a `Shared` collective's, the same; any other character's, its own.
	 */
	private holdersOf(id:string):readonly string[] {
		const runner = this.rows.get(id)?.runner;
		const home = runner ? collectiveOf(runner) : null;
		return home && (runner === home || home.sharing === MemorySharing.Shared) ? [home.id, ...home.characters.map((c) => c.id)] : [id];
	}

	/** The minds of the cast wired so far: characters' own, then collectives'. */
	public minds():Mind<TCtx>[] {
		const runners = [...this.rows.values()].map((row) => row.runner);
		return [
			...runners.flatMap((runner) => (runner instanceof Character ? ownMindOf(runner) ?? [] : [])),
			...runners.flatMap((runner) => (runner instanceof Collective ? [runner.mind] : [])),
		];
	}

	/** Every row, characters before collectives: steps waiting for the clock wake in that order. */
	public ordered():Row<TCtx>[] {
		return [...this.rows.values()].sort((a, b) => Number(a.runner instanceof Collective) - Number(b.runner instanceof Collective));
	}

	/** A runner's per-tick sample cache. */
	public cacheOf(runner:ArcRunner<TCtx>):SampleCache {
		return this.rows.get(runner.id)?.cache ?? new SampleCache();
	}

	/** Throw when a character or collective already has `id`: they share one namespace. */
	public claimID(id:string):void {
		if (this.specs.has(id) || this.collectiveSpecs.some((spec) => spec.id === id)) {
			throw new Error(`ArcDirector: '${id}' is already a character or a collective`);
		}
	}

	/** Every runner takes its verbs, cooldown, kit and catalog again, and every mind its deps. */
	public rewire():void {
		for (const { spec, runner } of this.rows.values()) {
			const deps = this.runnerDeps(spec, this.kitFor(spec, runner instanceof Collective), () => runner);
			runner.verbs = deps.verbs;
			runner.cooldown = deps.cooldown ?? DEFAULT_COOLDOWN;
			runner.kit = deps.kit;
			runner.catalog = deps.catalog;
			const mind = runner instanceof Collective ? runner.mind : ownMindOf(runner);
			if (mind) {
				internalsOf(mind).attach(runner, this.mindDeps(mind, runner));
			}
		}
	}

	/** Give `mind` its place in the think queue, with its watches. */
	public enqueue(mind:Mind<TCtx>):void {
		const queue = this._director.queue;
		queue.ensure(mind.id, { rethinks: mind.setting('rethinkingThreshold') > 0, skipMajor: mind.setting('skipMajor'), skipStart: mind.setting('skipStart') });
		queue.setWatches(mind.id, mind.persona.watchList());
	}

	/** Wire a character: alone, or `into` a collective. `json` restores a save. */
	public wireCharacter(given:CharacterSpec<TCtx>, json?:CharacterJSON, into?:Collective<TCtx>):Character<TCtx> {
		const director = this._director;
		// A unit tagged with its kind gets that kind's tags too (`Worker`, `Fighter`).
		const kind = this.kindOf(given.tags);
		const spec = kind ? { ...given, tags: kind.tags } : given;
		this.checkNames(spec);
		const standing = this.standingChoice(spec);
		const memory = this.pool.view(spec.id, () => this.holdersOf(spec.id));
		const persona = json ? Persona.fromJSON(json.persona, spec, memory) : new Persona(spec, memory);
		const kit = this.kitFor(spec);
		const character:Character<TCtx> = new Character<TCtx>({
			...this.runnerDeps(spec, kit, () => character),
			pick: () => internalsOf(director).pick(character),
			persona,
			tags: spec.tags,
			mindSettings: spec.mind,
			wiring: { setMind: (target, mind) => this.setMind(target, mind), setCollective: (target, collective) => this.moveCharacter(target, collective) },
		});
		const fields = internalsOf(character);
		if (standing) {
			this.standing.set(character, standing);
		}
		this.rows.set(spec.id, { spec, runner: character, cache: new SampleCache() });
		if (!json) {
			for (const offer of spec.offers ?? []) {
				director.offers.post({ ...offer, from: spec.id });
			}
		}
		if (json) {
			fields.load(json);
			for (const law of spec.laws ?? []) {
				character.addLaw(law, law.pinned);
			}
		}
		if (into) {
			internalsOf(into).setCharacters([...into.characters, character]);
			fields.setCollective(into);
			moveLawsInto(character, internalsOf(into));
			// Saved while it thought for itself in its collective.
			if (json?.mind) {
				this.attachMind(character, Mind.fromJSON(json.mind));
			}
		}
		else if (json?.mind || spec.mind) {
			this.attachMind(character, json?.mind ? Mind.fromJSON(json.mind) : new Mind(spec.mind));
		}
		this.added(character);
		return character;
	}

	/** A new character `spec` in collective `into` (`collective.addCharacter`). */
	public addTo(spec:CharacterSpec<TCtx>, into:Collective<TCtx>):Character<TCtx> {
		this.claimID(spec.id);
		this.specs.set(spec.id, spec);
		this.reportMissingNames(spec.kit ? [spec] : []);
		return this.wireCharacter(spec, undefined, into);
	}

	/** Wire a collective, its characters, and its mind. `cast` restores from a save. */
	public wireCollective(spec:CollectiveSpec<TCtx>, cast?:CastJSON):Collective<TCtx> {
		const director = this._director;
		this.checkNames(spec);
		const json = cast?.collectives[spec.id];
		// What it and its characters know between them, its characters as they are when it is read.
		const memory = this.pool.view(spec.id, () => this.holdersOf(spec.id));
		const persona = json ? Persona.fromJSON(json.persona, spec, memory) : new Persona(spec, memory);
		const mind = json ? Mind.fromJSON<TCtx>(json.mind) : new Mind<TCtx>(spec.mind);
		const collective:Collective<TCtx> = new Collective<TCtx>({
			...this.runnerDeps(spec, this.kitFor(spec, true), () => collective),
			pick: () => internalsOf(director).pick(collective),
			defaultLawWho: 'units',
			persona,
			mind,
			director,
		});
		collective.maxUnitsPerCommand = spec.maxUnitsPerCommand;
		collective.sharing = spec.sharing ?? MemorySharing.PerCharacter;
		collective.leaverKeepsMemory = spec.leaverKeepsMemory;
		this.rows.set(spec.id, { spec, runner: collective, cache: new SampleCache() });
		const ids = json ? json.characters : (spec.characters ?? []).map((c) => c.id);
		const chiefID = json ? json.commander : spec.commander;
		for (const id of ids) {
			const own = this.specs.get(id) ?? { id };
			// The commander runs its mind's orders, so without a kit of its own it has its collective's.
			this.wireCharacter(id === chiefID && !own.kit && spec.kit ? { ...own, kit: spec.kit } : own, cast?.characters[id], collective);
		}
		if (json) {
			internalsOf(collective).load(json);
			for (const law of spec.laws ?? []) {
				collective.addLaw(law, law.pinned);
			}
		}
		if (chiefID) {
			const chief = collective.character(chiefID);
			if (!chief) {
				throw new Error(`ArcDirector: no '${chiefID}' in '${spec.id}' to command it`);
			}
			collective.commander = chief;
		}
		this.attachMind(collective, mind);
		this.added(collective);
		return collective;
	}

	/**
	 * Build every character and collective from the specs added here, or from `cast` under them: then the save
	 * says who belongs to which collective, and who is on their own, and each feature with a `saveKey` loads its part first.
	 */
	public wireAll(cast?:CastJSON):void {
		if (cast) {
			this.loadFeatures(cast.features);
			this.pool = MemoryPool.fromJSON(cast.memories);
		}
		const members = new Set(Object.values(cast?.collectives ?? {}).flatMap((c) => c.characters));
		const solo = new Set(this.solo.map((spec) => spec.id));
		for (const id of Object.keys(cast?.characters ?? {})) {
			if (!members.has(id) && !solo.has(id) && this.specs.has(id)) {
				solo.add(id);
			}
		}
		for (const id of solo) {
			if (!members.has(id)) {
				this.wireCharacter(this.specs.get(id)!, cast?.characters[id]);
			}
		}
		for (const spec of this.collectiveSpecs) {
			this.wireCollective(spec, cast);
		}
	}

	/** Drop every character and collective quietly: no events, no new commanders, no fresh minds. */
	public clear():void {
		for (const { runner } of this.ordered()) {
			this.unwire(runner);
			if (runner instanceof Character) {
				internalsOf(runner).setCollective(null);
			}
			else {
				internalsOf(runner).setCharacters([]);
			}
		}
		this.rows.clear();
		this.pool = new MemoryPool();
		this.loadFeatures(undefined);
	}

	/** Each feature with a `saveKey` loads its part of `saved`: none, its fresh state. */
	private loadFeatures(saved:CastJSON['features']):void {
		for (const feature of internalsOf(this._director).features) {
			if (feature.saveKey !== undefined) {
				feature.load(saved?.[feature.saveKey]);
			}
		}
	}

	/** Take a character off the director: its arc, moves, its own mind, and its place in a collective. */
	public dropCharacter(id:string):void {
		const character = this.rows.get(id)?.runner;
		if (!(character instanceof Character)) {
			return;
		}
		this.rows.delete(id);
		this.unwire(character);
		if (character.collective) {
			this.leave(character, character.collective);
		}
	}

	/** Take a collective off the director. Its characters stay, each on its own: a fresh mind if it had settings for one. */
	public dropCollective(id:string):void {
		const collective = this.rows.get(id)?.runner;
		if (!(collective instanceof Collective)) {
			return;
		}
		for (const character of [...collective.characters]) {
			this.moveCharacter(character, null);
		}
		this.rows.delete(id);
		this.unwire(collective);
	}

	/** Every feature meets a runner that joined. */
	private added(runner:ArcRunner<TCtx>):void {
		internalsOf(this._director).watches.stampPrev(runner);
		internalsOf(this._director).features.forEach((feature) => feature.runnerAdded(runner));
	}

	/** A spec naming a System One or a chat model this director lacks is a typo; caught when it is wired. */
	private checkNames(spec:{ id:string; systemOne?:string | null; mind?:MindSettings; goals?:Goal<TCtx>[] }):void {
		const models = this._director.models;
		if (spec.systemOne && !models.has(spec.systemOne)) {
			throw new Error(`ArcDirector: '${spec.id}' names System One '${spec.systemOne}', which was never added`);
		}
		if (spec.mind?.model !== undefined && !models.has(spec.mind.model)) {
			throw new Error(`ArcDirector: '${spec.id}' names model '${spec.mind.model}', which was never added`);
		}
		// A typo in a goal's watch would leave it open for good: it throws now, as a law's does, not silently in play.
		for (const { until } of spec.goals ?? []) {
			if (typeof until === 'string') {
				parse(until);
			}
		}
	}

	/**
	 * `spec.choose` as `loop(choose(goal, …choices), until)`, checked as the cast is wired so a typo throws then, not
	 * mid-game. Its choices may use any registered verb.
	 */
	private standingChoice(spec:CharacterSpec<TCtx>):Standing | undefined {
		if (!spec.choose) {
			return undefined;
		}
		if (spec.mind) {
			throw new Error(`ArcDirector: '${spec.id}' has both choose and mind; give it one`);
		}
		const verbs = this._director.verbs;
		const { goal, until, choices } = spec.choose;
		try {
			const args:Record<string, StepArg> = { goal };
			for (const [name, text] of Object.entries(choices)) {
				args[name] = parseArcText(text, verbs);
			}
			const arc:Arc = [{ verb: 'loop', args: { arc: [{ verb: CHOOSE_VERB, args }], ...(until ? { until } : {}) } }];
			validateArc(arc, verbs);
			if (until) {
				parse(until);
			}
			return { arc, until, restUntil: 0 };
		}
		catch (err) {
			throw new Error(`ArcDirector: '${spec.id}' choose: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/**
	 * A spec's kit, else the default one. Something that can run no verb is a mistake, so it throws. A collective
	 * gets `OWN_KIT_ONLY` only from a kit of its own.
	 */
	private kitFor(spec:{ id:string; kit?:KitSource<TCtx>; tags?:readonly string[] }, collective = false):KitSource<TCtx> {
		const kit = spec.kit ?? this.kindOf(spec.tags)?.kit ?? this.defaultKit;
		if (!kit) {
			throw new Error(`ArcDirector: '${spec.id}' has no kit; give it one, or call withDefaultKit`);
		}
		if (typeof kit !== 'function' && kit.verbs.length === 0) {
			throw new Error(`ArcDirector: '${spec.id}' has a kit with no verbs`);
		}
		if (!collective || spec.kit) {
			return kit;
		}
		const shared = (k:Kit):Kit => ({ ...k, verbs: k.verbs.filter((verb) => !OWN_KIT_ONLY.has(verb)) });
		return typeof kit === 'function' ? (ctx) => shared(kit(ctx)) : shared(kit);
	}

	/** The kind `tags` name, by the first feature that knows one (`Feature.kindOf`). */
	private kindOf(tags:readonly string[] | undefined):ReturnType<Feature<TCtx>['kindOf']> {
		return internalsOf(this._director).features.map((feature) => feature.kindOf(tags)).find(Boolean);
	}

	/** What a kit names, read for spec `id`: a function kit from that character's context. */
	private readKit(src:KitSource<TCtx>, id:string):{ kit?:Kit; error?:string } {
		if (typeof src !== 'function') {
			return { kit: src };
		}
		const context = internalsOf(this._director).watches.context;
		if (!context) {
			return { error: `withContext required to resolve kit (${id})` };
		}
		try {
			const ctx = context(id);
			if (ctx === undefined) {
				return { error: `withContext returned undefined (${id})` };
			}
			return { kit: src(ctx) ?? {} };
		}
		catch (err:unknown) {
			const text = err instanceof Error ? err.message : String(err);
			return { error: `could not resolve kit (${id}): ${text}` };
		}
	}

	private scanKit(kit:Kit, where:string, out:string[]):void {
		const director = this._director;
		for (const name of kit.verbs) {
			if (name && !director.verbs.has(name)) {
				out.push(`verb '${name}' is not registered (${where})`);
				continue;
			}
			const missing = director.verbs.handler(name) || internalsOf(director).dispatcher.catchAll ? undefined : missingPart(name, director.world);
			if (missing) {
				out.push(`verb '${name}' needs withWorld ${missing} (${where})`);
			}
		}
		for (const name of kit.senses ?? []) {
			if (name && !director.senses.has(name)) {
				out.push(`sense '${name}' is not registered (${where})`);
			}
		}
		for (const name of kit.tools ?? []) {
			if (name && !director.tools.has(name)) {
				out.push(`tool '${name}' is not registered (${where})`);
			}
		}
	}

	/** Throw for kit names nothing registers: in `specs`, or in the default kit and every spec waiting to be wired. */
	public reportMissingNames(specs?:{ id:string; kit?:KitSource<TCtx> }[]):void {
		const out:string[] = [];
		if (!specs && this.defaultKit && typeof this.defaultKit !== 'function') {
			this.scanKit(this.defaultKit, 'default kit', out);
		}
		const list = specs ?? [...this.solo, ...this.collectiveSpecs.flatMap((spec) => [spec, ...(spec.characters ?? []).filter((c) => c.kit)])];
		for (const spec of list) {
			const src = spec.kit ?? (typeof this.defaultKit === 'function' || specs ? this.defaultKit : undefined);
			if (!src) {
				continue;
			}
			const read = this.readKit(src, spec.id);
			if (read.error) {
				out.push(read.error);
			}
			else if (read.kit) {
				this.scanKit(read.kit, spec.id, out);
			}
		}
		if (out.length > 0) {
			throw new Error(`ArcDirector: ${out.join('; ')}`);
		}
	}

	/** The deps every runner gets: dispatch through the director, its catalog, its kit. `runner` is the one built from them. */
	private runnerDeps(spec:{ id:string; laws?:LawSpec[]; maxLaws?:number; cooldown?:number }, kit:KitSource<TCtx>, runner:()=>ArcRunner<TCtx>):RunnerOptions<TCtx> {
		const director = this._director;
		const { dispatcher, watches, worldVerbs } = internalsOf(director);
		return {
			id: spec.id,
			verbs: director.verbs,
			context: () => director.contextOf(runner().voice.id),
			execute: async (step, ctx, signal) => dispatcher.dispatch(runner(), step, ctx, signal),
			abortArc: (id) => director.abortArc(id),
			cooldown: spec.cooldown ?? this.cooldown,
			goTo: (target, opts) => dispatcher.goTo(runner().id, 'go_to', { target }, opts),
			aimGroup: (step) => dispatcher.aimGroup(runner(), step),
			walkToGroup: (verb, ids, opts) => worldVerbs.walkToGroup(runner(), verb, ids, opts),
			talk: () => director.getFeature(TalkFeature<TCtx>),
			catalog: watches.kernels ? () => watches.catalog(runner()) : undefined,
			stepStarts: (step) => internalsOf(director).features.forEach((feature) => feature.stepStarts(runner(), step)),
			kit,
			laws: spec.laws,
			maxLaws: spec.maxLaws,
		};
	}

	/** What `mind` needs from the director to think for `owner`, wired when it attaches. */
	private mindDeps(mind:Mind<TCtx>, owner:ArcRunner<TCtx>):MindDeps<TCtx> {
		const director = this._director;
		const { dispatcher, features, watches, listeners, tell } = internalsOf(director);
		return {
			thinksWith: () => {
				// The one its settings name, else the default; none until its server answered.
				const live = director.getModel(mind.setting('model'));
				return {
					run: live?.run ?? NO_MODEL,
					vision: live?.vision ?? false,
					contextTokens: live?.slotContext,
					thinking: live?.thinking ?? false,
					promptStyle: live?.prompt ?? 'full',
					jsonOnly: trainedOnArcDirector(live?.id ?? ''),
				};
			},
			defaults: director.mindDefaults,
			senses: director.senses.all,
			tools: director.tools.all,
			autoEnact: true,
			onChoose: (arc) => director.log({ name: mind.thinkThread(), message: formatArc(arc, director.verbs) }),
			thinkWatch: () => (listeners.onThink.length > 0 ? (event) => tell('onThink', event) : undefined),
			arcProblem: (arc) => dispatcher.arcProblem(owner, arc),
			queue: director.queue,
			embed: (texts) => director.models.embed(texts),
			mood: () => director.getFeelings()?.moodOf(owner.voice.id),
			features,
			seenAs: watches.seenAs(mind),
			worldContext: () => director.contextOf(owner.voice.id) ?? (owner instanceof Collective ? watches.present(owner)?.ctx : undefined),
			hasFallen: (id) => director.world?.hasFallen?.(id) ?? false,
		};
	}

	/** `character.mind = mind`: its own mind from now on, out of any collective, or the host's hands for `null`. */
	private setMind(character:Character<TCtx>, mind:Mind<TCtx> | null):void {
		if (mind === character.mind) {
			return;
		}
		const shared = mind && this._director.collectives().find((c) => c.mind === mind);
		if (shared) {
			this.moveCharacter(character, shared);
			return;
		}
		if (mind?.attached && mind.owner !== character) {
			throw new Error(`ArcDirector: that mind thinks for '${mind.id}', not '${character.id}'`);
		}
		const from = character.collective;
		const had = character.mind;
		const { dropped } = from ? this.leave(character, from) : { dropped: [] };
		this.dropOwnMind(character);
		character.mindSettings = mind ? { ...mind.settings } : undefined;
		if (mind) {
			this.attachMind(character, mind);
		}
		this.handOver(character, had);
		if (from) {
			this.moved(character, from, null, dropped);
		}
	}

	/** `character.collective = to`: straight from any collective to `to`, or out to its own mind (or the host's hands). */
	private moveCharacter(character:Character<TCtx>, to:Collective<TCtx> | null):void {
		const from = character.collective;
		if (from === to) {
			return;
		}
		if (to && this.rows.get(to.id)?.runner !== to) {
			throw new Error(`ArcDirector: '${to.id}' is not a collective here`);
		}
		const had = character.mind;
		const { kept, dropped } = from ? this.leave(character, from, to) : { kept: [], dropped: [] };
		if (to) {
			this.join(character, to, kept);
		}
		else if (!character.thinksForItself && character.mindSettings) {
			// On its own now: a fresh mind. One that thought for itself in `from` goes on with that mind.
			this.attachMind(character, new Mind<TCtx>(character.mindSettings));
		}
		this.handOver(character, had);
		this.moved(character, from, to, dropped);
	}

	/** The mind that thinks for `character` now takes what `had`, the one that did, held for it for the moment (`MindFields.adopt`). */
	private handOver(character:Character<TCtx>, had:Mind<TCtx> | null):void {
		const has = character.mind;
		if (had && has && has !== had) {
			internalsOf(has).adopt(had, character.id);
		}
	}

	/**
	 * `character` thinks with a mind of its own for now (`settings`, else its own), still one of its collective's
	 * characters: what its collective's mind held for it moves to that mind. Returns that mind, or the one it has already.
	 */
	public giveOwnMind(character:Character<TCtx>, settings = character.mindSettings):Mind<TCtx> | null {
		const home = character.collective;
		if (!home || character.thinksForItself) {
			return ownMindOf(character);
		}
		const mind = new Mind<TCtx>(settings);
		if (home.sharing === MemorySharing.Shared) {
			character.persona.names.takeNames(home.persona.names);
		}
		this.attachMind(character, mind);
		this.handOver(character, home.mind);
		return mind;
	}

	/** `character` gives up the mind it thought with on its own in its collective, whose mind takes what that one held for it. */
	public takeOwnMind(character:Character<TCtx>):void {
		const own = ownMindOf(character);
		const home = character.collective;
		if (own && home) {
			this.dropOwnMind(character);
			this.handOver(character, own);
		}
	}

	/**
	 * Take `character` out of `from`: the commander post if it held it, `from`'s own tags on it, and its own laws
	 * there. Moving on to `to`, those laws are `kept` as they are. Leaving for good, they lose their `Tom.`
	 * prefix and come home, but laws that only work in a collective (`units`, `allUnits`) are `dropped`.
	 */
	private leave(character:Character<TCtx>, from:Collective<TCtx>, to:Collective<TCtx> | null = null):{ kept:Law[]; dropped:Law[] } {
		this.takeAlong(character, from);
		internalsOf(from).setCharacters(from.characters.filter((c) => c !== character));
		internalsOf(character).setCollective(null);
		character.tags = character.tags.filter((t) => !from.ownsTag(t));
		const own = from.laws.filter((law) => lawGroup(law.name) === character.id);
		from.laws = from.laws.filter((law) => !own.includes(law));
		internalsOf(from).vacate(character);
		if (to) {
			return { kept: own, dropped: [] };
		}
		const dropped = own.filter((law) => usesCollective(law, this._director.verbs));
		for (const law of own.filter((l) => !dropped.includes(l))) {
			law.name = law.name.slice(character.id.length + 1);
			internalsOf(character).keepLaw(law);
		}
		return { kept: [], dropped };
	}

	/**
	 * What `character` takes from a `Shared` collective it leaves, beside what it witnessed, which is its own anyway:
	 * the collective's names, and what `leaverKeepsMemory` picks of the rest.
	 */
	private takeAlong(character:Character<TCtx>, from:Collective<TCtx>):void {
		// A street never asks: there a character only ever has what it witnessed (owner, proposal 18).
		const keeps = from.sharing === MemorySharing.Shared ? from.leaverKeepsMemory : undefined;
		if (from.sharing === MemorySharing.Shared) {
			character.persona.names.takeNames(from.persona.names);
		}
		for (const record of keeps ? from.persona.memory.all() : []) {
			if (!record.knownBy.includes(character.id) && keeps!(record, character)) {
				record.knownBy.push(character.id);
			}
		}
	}

	/**
	 * Put `character` in `to`: its own mind goes (its settings are kept), and its laws move in as its own there.
	 */
	private join(character:Character<TCtx>, to:Collective<TCtx>, carried:Law[]):void {
		const own = ownMindOf(character);
		if (own) {
			character.mindSettings = { ...own.settings };
		}
		this.dropOwnMind(character);
		internalsOf(to).setCharacters([...to.characters, character]);
		internalsOf(character).setCollective(to);
		moveLawsInto(character, internalsOf(to));
		for (const law of carried) {
			internalsOf(to).keepLaw(law);
		}
	}

	/** Tell each mind involved what changed (a collective who left or joined it, a character what it left), and every feature. */
	private moved(character:Character<TCtx>, from:Collective<TCtx> | null, to:Collective<TCtx> | null, dropped:Law[]):void {
		const tell = (mind:Mind<TCtx>, event:MindEvent):void => {
			mind.pushEvent(event);
			// A major event wakes a mind; this one wakes even a mind that skips them.
			this._director.queue.enqueueMajor(mind.id, true, event.kind);
		};
		if (from) {
			// The name it went by there: once gone, the policy may call it something else (an enemy, say).
			const name = from.mind.nameOf(character.id);
			tell(from.mind, { kind: 'Left', text: `${name} left`, tags: [name], major: true, remember: true });
		}
		if (to) {
			tell(to.mind, { kind: 'Joined', text: (who) => `${who(character.id)} joined`, major: true, remember: true });
		}
		const own = ownMindOf(character);
		if (from && own) {
			// Kept by id, as it is remembered: its own mind reads "You left …".
			const me = (who:(id:string)=>string):string => who(character.id);
			const doing = (who:(id:string)=>string):string => (character.arc ? ` ${me(who)} is still doing what ${who(from.id)} gave ${me(who)}: ${own.namedArc(character.arc)}.` : '');
			const gone = (who:(id:string)=>string):string => (dropped.length === 0 ? ''
				: ` ${me(who)}'s laws that only work in a group are gone: ${dropped.map((law) => law.name.slice(character.id.length + 1)).join(', ')}.`);
			tell(own, { kind: 'Left', text: (who) => `${me(who)} left ${who(from.id)}.${doing(who)}${gone(who)}`, major: true, remember: true });
		}
		internalsOf(this._director).features.forEach((feature) => feature.characterMoved(character, from, to));
	}

	/** Drop a character's own mind, if it has one: its think stops, and it leaves the queue. */
	private dropOwnMind(character:Character<TCtx>):void {
		const own = ownMindOf(character);
		if (own) {
			this.detachMind(own);
			internalsOf(character).setMind(null);
		}
	}

	/** Let `mind` think for `owner`: wire it, and give it a place in the think queue. */
	private attachMind(owner:Character<TCtx> | Collective<TCtx>, mind:Mind<TCtx>):void {
		if (owner instanceof Character) {
			internalsOf(owner).setMind(mind);
		}
		internalsOf(mind).attach(owner, this.mindDeps(mind, owner));
		internalsOf(mind).stamp(this._director.time);
		this.enqueue(mind);
		this._director.queue.setAiOn(mind.id, true);
	}

	/** Stop `mind` thinking: its think in flight, and its place in the queue. It thinks for no one after. */
	private detachMind(mind:Mind<TCtx>):void {
		mind.abortThink();
		this._director.queue.setAiOn(mind.id, false);
		this._director.queue.drop(mind.id);
		const ready = internalsOf(this._director).readyThink;
		ready.splice(0, ready.length, ...ready.filter((row) => row.mindID !== mind.id));
		internalsOf(mind).detach();
	}

	/** Take `runner` off the director: its arc, its moves, what it hears, its own mind. Membership is the caller's. */
	private unwire(runner:Character<TCtx> | Collective<TCtx>):void {
		runner.replaceProgram();
		internalsOf(this._director).dispatcher.mover.stop(runner.id);
		if (runner instanceof Character) {
			this.dropOwnMind(runner);
		}
		else {
			this.detachMind(runner.mind);
		}
		internalsOf(this._director).features.forEach((feature) => feature.runnerRemoved(runner));
	}
}
