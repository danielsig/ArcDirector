import { formatArc } from '../arc/arc-format.js';
import { parseArcText } from '../arc/arc-parse.js';
import { ArcError, arcSteps, BlockedArcError, eachStep, firstStep, isCountMap, sameProgram, type Arc, type ArcResult, type Step } from '../arc/arc-types.js';
import { lawGroup } from '../arc/laws.js';
import type { ArgPath } from '../arc/constraints.js';
import { createArcSession } from '../arc/run.js';
import { runArc } from '../arc/arc-machine.js';
import { argKind, argOf } from '../arc/stock-verbs.js';
import { arcArg } from '../arc/wire.js';
import { bodiless, type ArcRunner } from '../character/arc-runner.js';
import { Character } from '../character/Character.js';
import type { Collective } from '../collective/Collective.js';
import { isFormationVerb, STOCK_COLLECTIVE_VERBS } from '../collective/collective-verbs.js';
import { evaluateWho, idsInVal, noUnitReason } from '../collective/who.js';
import { catalogEntities, evaluate } from '../expr/eval.js';
import { ABSENT, SampleCache, type Catalog, type ExprEntity, type ExprVal } from '../expr/expr-types.js';
import { lambdaParams, lex } from '../expr/lex.js';
import { internalsOf } from '../internals.js';
import { mapExpr, namesOf } from '../mind/ids.js';
import { seenTag } from '../mind/MindMemory.js';
import { bareName } from '../perception/lod.js';
import { Mover, type Crowd, type MoveOpts } from '../world/mover.js';
import { reachTo } from '../world/lookup.js';
import { distance } from '../world/vec.js';
import type { HostWorld, Vec } from '../world/world-types.js';
import type { ArcDirector } from './ArcDirector.js';
import { collectiveOf } from './Cast.js';
import type { VerbCall, VerbHandler } from './director-types.js';
import { fit, watchProblem } from './Watches.js';

/** A wait under way. `unmet` is why it fails when its time runs out before `met`; without it, running out is how it ends. */
type Wait = { runnerID:string; verb:string; end:number; seconds:number; met?:()=>boolean; unmet?:string; done:(result:ArcResult)=>void };

/** What every entity can be asked, whatever fields it carries. */
const ALWAYS_FIELDS = new Set(['id', 'name', 'tags', 'hp', 'maxHP']);

/** What reads like a name in a watch and is not one. */
const WATCH_WORDS = new Set(['me', 'it']);

/** What a step no race stops is handed: it never aborts. */
const NEVER = new AbortController().signal;

/** Character ids a reply wait is watching. One id, or several. */
function replyTargets(raw:unknown):string[] {
	return (Array.isArray(raw) ? raw : [raw]).filter((id):id is string => typeof id === 'string' && id.trim() !== '');
}

/** What an `id` expression picked: an entity, or the first entity of a list. */
function pickedEntity(value:ExprVal):ExprEntity | undefined {
	const first = value.kind === 'list' ? value.value.find((v) => v.kind === 'entity') : value;
	return first?.kind === 'entity' ? first.value : undefined;
}

/**
 * How steps run: each one a runner acts, to the law handler, an alias's arc, a collective's own verbs, or the host's
 * handler through the gate, with the waits and moves it starts, and how a runner's work is stopped; and what is asked of
 * an Arc a mind wrote before it runs: whether it could ever work as written, and what unfinished work it would cut
 * short. A part of {@link ArcDirector}, which keeps the public calls.
 */
export class Dispatcher<TCtx> {
	/** What runs a verb no one else handles (`onVerb`). */
	public catchAll:VerbHandler<TCtx> | undefined;
	/** How characters move through the world (`withWorld`). */
	public mover = new Mover(undefined, () => this._director.time);
	private readonly _waits = new Set<Wait>();
	/**
	 * How often each runner was stopped. A verb still running for it gives way at its next wait or walk, though the stop
	 * came between two of them, while none was there to cut short.
	 */
	private readonly _stops = new Map<string, number>();

	constructor(private readonly _director:ArcDirector<TCtx>) {}

	/** Moves through `world` from now on, those under way stopped. */
	public moveIn(world:HostWorld<unknown>):void {
		for (const { runner } of internalsOf(this._director).cast.rows.values()) {
			this.mover.stop(runner.id);
		}
		const { worldVerbs, cast } = internalsOf(this._director);
		this.mover = new Mover(world, () => this._director.time, (verb, target) => this.crowdOf(verb, target), () => worldVerbs.crowd?.spacing ?? 1, (target) => cast.specs.get(target)?.servingSpot);
	}

	/**
	 * One host step, acted by `runner` itself. When `signal` aborts (its `until` was met, its `within` ran out, a reaction
	 * took over, a new program came), what the host does for `runner` stops, as `abortArc` stops it.
	 */
	public async dispatch(runner:ArcRunner<TCtx>, step:Step, ctx:TCtx | undefined, signal:AbortSignal = NEVER):Promise<ArcResult> {
		// Stopped before the host began it.
		if (signal.aborted) {
			return { status: 'stopped', verb: step.verb };
		}
		const stop = ():void => this._director.abortArc(runner.id);
		signal.addEventListener('abort', stop, { once: true });
		try {
			return await this.dispatchStep(runner, step, ctx, signal);
		}
		finally {
			signal.removeEventListener('abort', stop);
		}
	}

	/** Stop whatever runner `id` is doing now: its waits and moves here, the rest through `onAbortArc`. */
	public stop(id:string):void {
		this._stops.set(id, (this._stops.get(id) ?? 0) + 1);
		for (const wait of this._waits) {
			if (wait.runnerID === id) {
				this._waits.delete(wait);
				wait.done({ status: 'stopped', verb: wait.verb });
			}
		}
		this.mover.stop(id);
		internalsOf(this._director).tell('onAbortArc', id);
	}

	/** End each wait that was met or ran out of time. */
	public tickWaits():void {
		for (const wait of this._waits) {
			const met = wait.met?.() ?? false;
			if (met || this._director.time >= wait.end) {
				this._waits.delete(wait);
				wait.done(!met && wait.unmet
					? { status: 'failed', verb: wait.verb, reason: wait.unmet }
					: { status: 'ok', verb: wait.verb, reason: met ? 'until' : `${wait.seconds}s` });
			}
		}
	}

	/**
	 * Move `characterID`, or, in a world where characters do not move, succeed only when already in reach. Already
	 * close enough by `opts.check`, it does not take a step.
	 */
	public goTo(characterID:string, verb:string, dest:{ target:string } | { point:Vec }, moveOpts:MoveOpts = {}):Promise<ArcResult> {
		// It reaches for what the verb does, unless told what it uses.
		const opts = { using: verb, ...moveOpts };
		const met = opts.check?.();
		if (met !== undefined) {
			return Promise.resolve({ status: 'ok', verb, reason: met });
		}
		if (this.mover.canMove) {
			return this.mover.go(characterID, dest, verb, opts);
		}
		const { within } = opts;
		const world = this._director.world;
		const character = world?.find(characterID);
		const target = 'target' in dest ? world?.find(dest.target) : undefined;
		const point = 'target' in dest ? (target === undefined ? undefined : world?.geometry?.getPose(target)?.point) : dest.point;
		const me = character === undefined ? undefined : world?.geometry?.getPose(character)?.point;
		const near = within ?? (world && character !== undefined && target !== undefined ? reachTo(world, character, target, opts.using) : 1);
		const ok = !me || !point || distance(me, point) <= near;
		return Promise.resolve(ok ? { status: 'ok', verb } : { status: 'failed', verb, reason: 'out of reach' });
	}

	/**
	 * `step` with its group arg read as `runner` sees it (`VerbDef.groupArg`). A name stays, for what names do. An expression
	 * that picks a list becomes its ids, without `runner` or anyone fallen or gone; one that picks one becomes that id.
	 * The result is why it picks no one, when it does not.
	 */
	public aimGroup(runner:ArcRunner<TCtx>, step:Step):Step | ArcResult {
		const director = this._director;
		const key = director.verbs.get(step.verb)?.groupArg;
		const value = key ? step.args[key] : undefined;
		const word = typeof value === 'string' ? value.trim() : '';
		if (!key || (!word && !Array.isArray(value)) || director.character(word) || director.world?.find(word) !== undefined) {
			return step;
		}
		const names = runner.mind?.persona.names;
		const shown = names ? mapExpr(word, namesOf(names)) : word;
		const fail = (reason:string):ArcResult => ({ status: 'failed', verb: step.verb, reason });
		let picked = value as string[];
		if (word) {
			const ctx = runner.context();
			const catalog = ctx === undefined ? undefined : internalsOf(director).watches.catalog(runner, ctx);
			// A bare word the catalog does not bind is a name no one has, and fails as one.
			if (!/[(.]|=>/.test(word) && !catalog?.names.has(word)) {
				return step;
			}
			if (!catalog) {
				return fail(`${shown} picks no one: nothing to pick from`);
			}
			const r = evaluate(word, catalog);
			if (r.error) {
				return fail(`cannot read ${shown} as a group: ${r.error.message}`);
			}
			picked = idsInVal(r.value);
			if (r.value.kind !== 'list') {
				return picked[0] ? { ...step, args: { ...step.args, [key]: picked[0] } } : fail(`${shown} picks no one`);
			}
		}
		const ids = internalsOf(director).worldVerbs.standing(picked).filter((id) => id !== runner.id);
		return ids.length > 0 ? { ...step, args: { ...step.args, [key]: ids } } : fail(`no one left in ${shown || 'the group'}`);
	}

	/** The crowd a move by `verb` to `target` takes when it names none: none to a thing, else the target's, else the game's. */
	private crowdOf(verb:string, target:string):Crowd {
		if (!this._director.character(target)) {
			return 'none';
		}
		const { cast, worldVerbs } = internalsOf(this._director);
		return cast.specs.get(target)?.crowd ?? worldVerbs.crowd?.verbs?.[verb] ?? worldVerbs.crowd?.crowd ?? 'none';
	}

	private dispatchStep(runner:ArcRunner<TCtx>, step:Step, ctx:TCtx | undefined, signal:AbortSignal):Promise<ArcResult> | ArcResult {
		const director = this._director;
		const { features, worldVerbs, law } = internalsOf(director);
		const liveCtx = director.contextOf(runner.id) ?? ctx;
		if (step.verb === 'law' || step.verb === 'unlaw') {
			return law(runner, step);
		}
		if (director.verbs.alias(step.verb)) {
			return this.runAlias(runner, step);
		}
		if ((STOCK_COLLECTIVE_VERBS as readonly string[]).includes(step.verb) && !isFormationVerb(step.verb)) {
			const collective = collectiveOf(runner);
			return collective
				? this.handleCollectiveVerb(collective, runner, step, liveCtx)
				: { status: 'failed', verb: step.verb, reason: `${step.verb} needs a collective` };
		}
		if (!(runner instanceof Character)) {
			// No body to hand a host: only the director's own clock runs for it.
			return step.verb === 'wait' ? this.stockWait(runner.id, step.args) : bodiless(step.verb);
		}
		const handler = director.verbs.handler(step.verb)
			?? worldVerbs.handler(step.verb)
			?? (step.verb === 'wait' ? (call:VerbCall<TCtx>) => this.stockWait(call.character.id, call.args) : this.catchAll);
		if (!handler) {
			return { status: 'failed', verb: step.verb, reason: `unhandled ${step.verb}` };
		}
		if (liveCtx === undefined) {
			return { status: 'failed', verb: step.verb, reason: 'not in this scene' };
		}
		const call = this.verbCall(runner, step, liveCtx, signal);
		if (!('character' in call)) {
			return call;
		}
		const gated = this.unmet(call) ?? director.verbs.gate?.(call);
		if (!gated) {
			features.forEach((feature) => feature.hostVerbStarted(call));
		}
		const out = gated ?? handler(call);
		if (!gated && features.length > 0) {
			const ended = (result:ArcResult):void => {
				features.forEach((feature) => feature.hostVerbEnded(call, result));
			};
			void Promise.resolve(out).then(ended, (err:unknown) => ended({ status: 'failed', verb: step.verb, reason: err instanceof Error ? err.message : String(err) }));
		}
		if (internalsOf(director).listeners.onStep.length === 0) {
			return out;
		}
		return Promise.resolve(out).then((result) => {
			internalsOf(director).tell('onStep', call, result);
			return result;
		});
	}

	/** Why `call` may not run: the first feature's refusal (`Feature.refuses`), such as an unmet requirement. */
	public unmet(call:VerbCall<TCtx>):ArcResult | undefined {
		return internalsOf(this._director).features.reduce<ArcResult | undefined>((refused, feature) => refused ?? feature.refuses(call), undefined);
	}

	/**
	 * The call a handler sees. `id` args are ids already; one written as an expression becomes the character it
	 * picks (`others.filter("enemy").minBy(u => u.hp)`). `watch` args are checked before the host runs.
	 */
	private verbCall(character:Character<TCtx>, step:Step, ctx:TCtx, signal:AbortSignal):VerbCall<TCtx> | ArcResult {
		const fail = (reason:string):ArcResult => ({ status: 'failed', verb: step.verb, reason });
		const catalogAt = (point?:Vec):Catalog | undefined => internalsOf(this._director).watches.catalog(character, ctx, point && new SampleCache(), point);
		const spec = this._director.verbs.get(step.verb);
		const args:Record<string, unknown> = { ...step.args };
		for (const [key, value] of Object.entries(args)) {
			const kind = argKind(spec, key);
			if (typeof value !== 'string' || !value.trim()) {
				continue;
			}
			if (kind === 'id') {
				// The model may echo the name as sight wrote it: `go_to(what seems to be a Lantern)`.
				args[key] = bareName(value);
				const catalog = /[(.]|=>/.test(value) ? catalogAt() : undefined;
				if (!catalog) {
					continue;
				}
				const r = evaluate(value, catalog);
				const picked = r.error ? undefined : pickedEntity(r.value);
				if (!picked) {
					return fail(r.error ? `${value}: ${r.error.message}` : `${value} picks no one`);
				}
				args[key] = picked.id;
			}
			const broken = kind === 'watch' ? watchProblem(value, catalogAt()) : undefined;
			if (broken) {
				return fail(broken);
			}
		}
		// What watch arg `arg` comes to, here or as if at `point`. No catalog, or an expression that does not evaluate: absent.
		const valueOf = (arg:string, point?:Vec):ExprVal => {
			const expr = args[arg];
			const catalog = typeof expr === 'string' && expr.trim() ? catalogAt(point) : undefined;
			const r = catalog && evaluate(expr as string, catalog);
			return r && !r.error ? r.value : ABSENT;
		};
		const score = (arg:string, point?:Vec):number => fit(valueOf(arg, point));
		const stops = this._stops.get(character.id) ?? 0;
		const stopped = ():ArcResult | undefined => ((this._stops.get(character.id) ?? 0) === stops && !signal.aborted ? undefined : { status: 'stopped', verb: step.verb });
		// It reaches with what the step uses: its `with` (`strike(Wolf, with=Sword)`), else the verb (`steal`).
		const using = typeof args.with === 'string' && args.with ? args.with : step.verb;
		return {
			verb: step.verb,
			args,
			character,
			ctx,
			signal,
			score,
			isMet: (arg, point) => score(arg, point) > 0,
			grader: (arg) => (valueOf(arg).kind === 'number' ? (point) => score(arg, point) : undefined),
			goTo: async (target, opts) => stopped() ?? this.goTo(character.id, step.verb, { target }, { using, ...opts }),
			goToPoint: async (point, opts) => stopped() ?? this.goTo(character.id, step.verb, { point }, opts),
			wait: async (seconds) => stopped() ?? this.waitFor(character.id, seconds, step.verb),
		};
	}

	private waitFor(runnerID:string, seconds:number, verb:string, met?:()=>boolean, unmet?:string):Promise<ArcResult> {
		return new Promise((done) => {
			this._waits.add({ runnerID, verb, end: this._director.time + seconds, seconds, met, unmet, done });
		});
	}

	/**
	 * Game time passes for runner `id` for `seconds`, or until someone named by `reply` finishes a non-movement verb.
	 * `reply` is how a mind waits out an answer; it is not a model arg. A wait for its `until` (which the runtime
	 * watches, and which ends it) that runs out of time first fails, so the steps after it never run as if it had come
	 * true. With a `within`, that is all the time it has. A host `wait` handler replaces it for a character.
	 */
	private stockWait(id:string, args:Record<string, unknown>):Promise<ArcResult> {
		const watching = typeof args.until === 'string' && args.until.trim() !== '';
		const replyTo = replyTargets(args.reply);
		const replies = (who:string):number => this._director.character(who)?.replies ?? 0;
		const seen = new Map(replyTo.map((who) => [who, replies(who)]));
		const seconds = typeof args.seconds === 'number' ? args.seconds
			: typeof args.within === 'number' ? Infinity
				: watching || replyTo.length > 0 ? 20 : 1;
		const met = ():boolean => replyTo.some((who) => replies(who) !== seen.get(who));
		const unmet = watching && replyTo.length === 0 ? `until not met after ${seconds}s` : undefined;
		return this.waitFor(id, seconds, 'wait', replyTo.length > 0 ? met : undefined, unmet);
	}

	private handleCollectiveVerb(collective:Collective<TCtx>, runner:ArcRunner<TCtx>, step:Step, ctx:TCtx | undefined):ArcResult | Promise<ArcResult> {
		if (step.verb === 'command') {
			return this.handleIssue(collective, runner, step, ctx);
		}
		if (step.verb === 'tag' || step.verb === 'untag') {
			const who = typeof step.args.who === 'string' ? step.args.who : '';
			const name = typeof step.args.name === 'string' ? step.args.name : '';
			if (!who || !name) {
				return { status: 'failed', verb: step.verb, reason: `${step.verb} needs who and name` };
			}
			const cat = internalsOf(this._director).watches.catalog(runner, ctx);
			const characters = cat ? evaluateWho(who, cat, collective) : [];
			if (step.verb === 'tag') {
				collective.tagCharacters(characters, name);
			}
			else {
				collective.untagCharacters(characters, name);
			}
			return { status: 'ok', verb: step.verb };
		}
		return { status: 'failed', verb: step.verb, reason: `unhandled ${step.verb}` };
	}

	/** An alias step: its arc, filled from its args, run in its place by the same runner. */
	private async runAlias(runner:ArcRunner<TCtx>, step:Step):Promise<ArcResult> {
		const director = this._director;
		const text = director.verbs.aliasPart(step, 'arc') ?? '';
		const hole = /\{([A-Za-z_]\w*)\}/.exec(text)?.[1];
		if (hole) {
			return { status: 'failed', verb: step.verb, reason: `${step.verb} needs ${hole}` };
		}
		let arc:Arc;
		try {
			arc = parseArcText(text, director.verbs);
		}
		catch (err) {
			return { status: 'failed', verb: step.verb, reason: err instanceof Error ? err.message : String(err) };
		}
		// Run inside a reaction, its arc follows that reaction's trigger as the reaction's own steps do.
		const session = createArcSession({ verbs: director.verbs, catalog: () => runner.catalog?.(), now: () => director.time, watchedAt: internalsOf(director).watchedAt, nextTime: () => runner.nextTime(), reaction: runner.arcSession?.running.at(-1) });
		// Granting the alias grants what it runs: a game may offer `advance` and never `attack_move`.
		const result = await runArc(arc, (inner, signal) => runner.perform(inner, runner.context(), true, signal), { session });
		return { ...result, verb: step.verb };
	}

	/** Handles the `command` verb produced by {@link Collective}s. */
	private handleIssue(collective:Collective<TCtx>, issuer:ArcRunner<TCtx>, step:Step, ctx:TCtx | undefined):ArcResult | Promise<ArcResult> {
		// Validation keeps command at an Arc's root; an alias or a host's law can still bring one to a unit, which takes orders.
		if (issuer !== collective.voice) {
			return { status: 'failed', verb: 'command', reason: 'only your commander issues orders' };
		}
		const verbs = this._director.verbs;
		const who = typeof step.args.who === 'string' ? step.args.who.trim() : '';
		const arc = arcArg(step.args.arc, verbs);
		if (!who || !arc) {
			return { status: 'failed', verb: 'command', reason: 'command needs who and arc' };
		}
		const cat = internalsOf(this._director).watches.catalog(issuer, ctx);
		const named = cat ? evaluateWho(who, cat, collective) : [];
		const troops = named.filter((c) => c !== collective.commander);
		if (troops.length === 0) {
			return { status: 'failed', verb: 'command', reason: named.length > 0 ? 'command never lands on the commander' : noUnitReason(who, cat) };
		}
		const maxUnits = collective.maxUnitsPerCommand;
		if (maxUnits !== undefined && troops.length > maxUnits) {
			return { status: 'failed', verb: 'command', reason: `that is ${troops.length} units; a command names ${maxUnits === 1 ? 'one' : `at most ${maxUnits}`}` };
		}
		const group = typeof step.args.group === 'string' ? step.args.group : undefined;
		const taking = troops.filter((c) => !c.runs(arc));
		const name = collective.command(troops, arc, group, step.args.append === true);
		if (taking.length > 0) {
			internalsOf(this._director).tell('onThink', { kind: 'command', who: issuer.voice.id, to: taking.map((c) => c.id), arc, text: formatArc(arc, verbs) });
		}
		// A group ordered without its name gets one, and is told it.
		return name && !group?.trim() ? { status: 'ok', verb: 'command', reason: `no group= given: called them ${name}` } : { status: 'ok', verb: 'command' };
	}

	/**
	 * Why the Arc `owner`'s mind just wrote could never work as written. Only what no change in the world would mend: what
	 * is merely not so right now (nobody near, too far, no gold yet) is for the verb to say as it runs. A
	 * {@link BlockedArcError} when the world changed under the reply instead (a thing it saw went while it thought): no
	 * repair turn mends that, since the prompt still shows the old world, so the mind thinks again from a fresh one.
	 */
	public arcProblem(owner:ArcRunner<TCtx>, arc:Arc):ArcError | undefined {
		const director = this._director;
		const world = director.world;
		const currency = director.mindDefaults.currency;
		const voice = owner.voice;
		const ctx = director.contextOf(voice.id);
		// Its own cache: a look at a reply must not use up the change `hasRisen` is waiting to see.
		const catalog = ctx === undefined ? undefined : internalsOf(director).watches.catalog(voice, ctx, new SampleCache());
		const bound = new Set(['fail']);
		let gone:string | undefined;
		eachStep(arc, director.verbs, (step) => {
			const named = typeof step.args.through === 'string' ? /^\s*(\w+)\s+in\b/.exec(step.args.through)?.[1] : undefined;
			if (named) {
				bound.add(named);
			}
		});
		// A name its mind could not tell (`$Bram`) is a name all the same: who it is, the step finds as it runs.
		const known = (name:string):boolean => (name.startsWith('$') ? known(name.slice(1)) : bound.has(name)) || name === currency || !!catalog?.names.has(name)
			|| !!director.character(name) || !!director.collective(name) || !world || internalsOf(director).features.some((feature) => feature.knows(name)) || world.find(name) !== undefined || !!world.isItem?.(name);
		let problem:string | undefined;
		/** The text of the reply the problem is about. */
		let at:string | undefined;
		/** The arg that holds it. */
		let arg:ArgPath | undefined;
		const fault = (why:string | undefined, where:string, path:ArgPath):void => {
			if (problem === undefined && why) {
				[problem, at, arg] = [why, where, path];
			}
		};
		eachStep(arc, director.verbs, (step, verbs) => {
			const spec = verbs.get(step.verb);
			for (const [key, value] of Object.entries(step.args)) {
				const kind = argKind(spec, key);
				const path:ArgPath = `${step.verb}.${key}`;
				if (typeof value === 'string' && (kind === 'watch' || kind === 'expr' || (kind === 'id' && /[(.]|=>/.test(value)))) {
					fault(this.exprProblem(value, catalog, known), value, path);
				}
				// Only the step that runs next, of a stock verb (`say`, or one the world runs): something can come to be by a later
				// one, and a host's own verb may aim at what only it knows.
				else if (kind === 'id' && typeof value === 'string' && step === firstStep(arc) && (step.verb === 'say' || !!internalsOf(director).worldVerbs.handler(step.verb)) && !argOf(spec, key)?.ignoreUnknown && !known(bareName(value))) {
					gone ??= problem === undefined ? this.goneSince(voice, bareName(value)) : undefined;
					fault(gone ?? `there is no ${bareName(value)}`, bareName(value), path);
				}
				else if (kind === 'bundle' && isCountMap(value)) {
					const notItem = world?.isItem && Object.keys(value).find((name) => name !== currency && !world.isItem!(name));
					fault(notItem ? `'${notItem}' is not an item: the terms of a trade are {"ItemName":count}` : undefined, notItem || '', path);
				}
			}
		});
		const reason = problem ?? this.lawProblem(owner, arc) ?? this.commandProblem(owner, arc);
		return reason === undefined ? undefined : reason === gone ? new BlockedArcError(reason, at, arg) : reason === problem ? new ArcError(reason, at, arg) : new ArcError(reason);
	}

	/**
	 * Why an arc may not aim at `id`, which nothing in the world answers to, when the mind has seen it: it was there when it
	 * looked and went while it thought (burned, picked up). Undefined for a name it never saw.
	 */
	private goneSince(voice:ArcRunner<TCtx>, id:string):string | undefined {
		const name = voice.mind?.nameOf(id) ?? id;
		return voice.persona.memory.all().some((row) => row.tags.includes(seenTag(id))) ? `${name} is gone since you looked` : undefined;
	}

	/** Why `expr` can never work: it does not read, misuses the language, or names what is not in this world. */
	private exprProblem(expr:string, catalog:Catalog | undefined, known:(name:string)=>boolean):string | undefined {
		const broken = watchProblem(expr, catalog);
		if (broken || !catalog) {
			return broken;
		}
		const { error } = evaluate(expr, catalog);
		if (error?.reason === 'fieldCall' || error?.reason === 'misuse') {
			return `${expr}: ${error.message}`;
		}
		const toks = lex(expr);
		const params = lambdaParams(toks);
		if (this._director.mindDefaults.repairUnknownFields) {
			const plain = expr.replace(/"[^"]*"|'[^']*'/g, ' ');
			const entities = [catalog.me, ...catalogEntities(catalog)];
			const read = [...params].flatMap((param) => [...plain.matchAll(new RegExp(`\\b${param}\\.(\\w+)\\b(?!\\s*\\()`, 'g'))].map((m) => m[1]));
			const unread = read.find((field) => !ALWAYS_FIELDS.has(field) && !entities.some((entity) => entity.fields?.[field] !== undefined));
			if (unread) {
				return `${expr}: no one has a field '${unread}'. What something is, its tag: u is "Witch"`;
			}
		}
		const words = toks
			.filter((tok, n) => tok.kind === 'ident' && !['dot', 'qdot'].includes(toks[n - 1]?.kind) && toks[n + 1]?.kind !== 'lp' && !params.has(tok.raw) && !WATCH_WORDS.has(tok.raw))
			.map((tok) => tok.raw);
		const unknown = words.find((word) => !known(word) && evaluate(word, catalog).value.kind === 'absent');
		return unknown ? `${expr}: there is no ${unknown}` : undefined;
	}

	/** A law past the cap, or one it has already under another name. */
	private lawProblem(owner:ArcRunner<TCtx>, arc:Arc):string | undefined {
		const own = owner.laws.filter((law) => lawGroup(law.name) === '');
		let count = own.length;
		for (const step of arcSteps(arc)) {
			const name = typeof step.args.name === 'string' ? step.args.name : undefined;
			if (step.verb === 'unlaw') {
				count -= own.some((law) => law.name === name) ? 1 : 0;
			}
			if (step.verb !== 'law') {
				continue;
			}
			const body = arcArg(step.args.arc, this._director.verbs);
			const twin = owner.laws.find((law) => law.name !== name && law.watch === String(step.args.watch ?? '').trim()
				&& (step.args.who ?? law.who) === law.who && !!body && sameProgram(law.arc, body));
			if (twin) {
				return `that is your law ${twin.name} already`;
			}
			count += own.some((law) => law.name === name) ? 0 : 1;
			if (count > owner.maxLaws) {
				return `you have ${own.length} laws, the most you can (${own.map((law) => law.name).join(', ')}): unlaw one first`;
			}
		}
		return undefined;
	}

	/** An order that reaches no one right now, whom it asks for being a matter of who stands. Its own earlier groups count. */
	private commandProblem(owner:ArcRunner<TCtx>, arc:Arc):string | undefined {
		const collective = collectiveOf(owner);
		const catalog = collective && internalsOf(this._director).watches.catalog(owner.voice);
		if (!collective || !catalog) {
			return undefined;
		}
		const groups:string[] = [];
		for (const step of arc) {
			if (step.verb !== 'command' || typeof step.args.who !== 'string') {
				continue;
			}
			const who = step.args.who;
			const named = evaluateWho(who, catalog, collective);
			if (named.length === 0 && !groups.some((group) => who.includes(group))) {
				return noUnitReason(who, catalog);
			}
			if (named.length > 0 && named.every((character) => character === collective.commander)) {
				return 'command never lands on the commander';
			}
			if (typeof step.args.group === 'string') {
				groups.push(step.args.group);
			}
		}
		return undefined;
	}
}
