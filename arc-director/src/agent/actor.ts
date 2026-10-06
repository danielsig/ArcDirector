import { MIND_ONLY_VERBS, type VerbRegistry } from '../arc/stock-verbs.js';
import type { Arc, ArcResult, Step } from '../arc/types.js';
import type { Catalog, ExprEntity } from '../expr/types.js';
import { cloneEntity, prevMeFromJSON } from '../expr/prev.js';
import {
	DEFAULT_MAX_LAWS,
	dropLaw,
	lawFromSpec,
	upsertLaw,
	type CrowdLaw,
	type CrowdLawSpec,
} from '../conductor/laws.js';
import type { NameTarget } from './names.js';
import {
	runArc,
	createArcSession,
	DEFAULT_COOLDOWN,
	type ArcHandler,
	type ArcSession,
	type ArcSessionOpts,
} from './run.js';
import type { SayResult, SayTo, TalkNet } from './talk.js';
import type { Kit, KitSource } from './types.js';

/** What a body needs from its host to run arcs. */
export type ActorDeps<TAgentCtx = unknown> = {
	verbs:VerbRegistry;
	context:()=>TAgentCtx | undefined;
	execute?:(step:Step, ctx:TAgentCtx | undefined, actorID?:string)=>Promise<ArcResult>;
	abortArc?:(id:string)=>void;
	/** Host cooldown in game seconds after a handler pops or aborts. Default 8. */
	cooldown?:number;
	talk?:TalkNet;
	catalog?:(ctx:TAgentCtx)=>Catalog;
	/**
	 * Omit = all catalog verbs and all registered senses / tools (tests).
	 * Director always passes a kit (`{}` if the spec omitted it).
	 */
	kit?:KitSource<TAgentCtx>;
};

export type ActorOptions<TAgentCtx = unknown> = ActorDeps<TAgentCtx> & {
	id:string;
	laws?:CrowdLawSpec[];
	maxLaws?:number;
	defaultLawWho?:string;
};

/** The body's part of a save: its laws and the arc it was running. */
export type ActorJSON = {
	id:string;
	lastResult?:ArcResult;
	liveArc:boolean;
	laws?:CrowdLaw[];
	maxLaws?:number;
	cooldown?:number;
	prevMe?:ExprEntity;
};

/**
 * A body that runs arcs: its kit, its laws, and the arc it is running now. It never calls the model;
 * `Agent` adds a mind that picks the arcs. A host drives a plain `Actor` itself (`ArcDirector.addActor`).
 */
export class Actor<TAgentCtx = unknown> {
	readonly id:string;
	readonly verbs:VerbRegistry;
	readonly context:()=>TAgentCtx | undefined;
	readonly execute?:(step:Step, ctx:TAgentCtx | undefined, actorID?:string)=>Promise<ArcResult>;
	readonly abortArc?:(id:string)=>void;
	cooldown:number;
	laws:CrowdLaw[] = [];
	maxLaws:number;
	protected defaultLawWho:string;
	arcSession:ArcSession | null = null;
	talk:TalkNet | undefined;
	catalog?:(ctx:TAgentCtx)=>Catalog;
	/** Object or callback. Assign a new one any time. Fetched every tick. */
	kit:KitSource<TAgentCtx> | undefined;
	protected currentKit:Kit = {};
	lastResult:ArcResult | undefined;
	/** Index of the step currently running inside `enact` (0-based). */
	verbIndex = 0;
	/** Self as `prev.me` sees it: at an agent's last think, else as first sampled. */
	prevMe:ExprEntity | undefined;
	liveArc = false;
	protected now = 0;

	constructor(opts:ActorOptions<TAgentCtx>) {
		this.id = opts.id;
		this.verbs = opts.verbs;
		this.context = opts.context;
		this.execute = opts.execute;
		this.abortArc = opts.abortArc;
		this.cooldown = opts.cooldown ?? DEFAULT_COOLDOWN;
		this.maxLaws = opts.maxLaws ?? DEFAULT_MAX_LAWS;
		this.defaultLawWho = opts.defaultLawWho ?? 'me';
		this.talk = opts.talk;
		this.catalog = opts.catalog;
		this.kit = opts.kit;
		for (const spec of opts.laws ?? []) {
			this.addLaw(spec, spec.pinned);
		}
	}

	/** Resolve `kit` (object, getters, or callback). Director calls this each tick. */
	refreshKit():Kit {
		const src = this.kit;
		if (src === undefined) {
			this.currentKit = {};
			return this.currentKit;
		}
		if (typeof src === 'function') {
			try {
				const ctx = this.context();
				this.currentKit = ctx !== undefined ? (src(ctx) ?? {}) : {};
			}
			catch {
				this.currentKit = {};
			}
			return this.currentKit;
		}
		this.currentKit = src;
		return this.currentKit;
	}

	/** Catalog filtered by the current kit, less `withheldVerbs`. Unset `kit` = whole catalog. */
	activeVerbs():VerbRegistry {
		this.refreshKit();
		const off = this.withheldVerbs();
		const granted = this.kit === undefined
			? this.verbs.list().map((spec) => spec.name)
			: this.currentKit.verbs ?? [];
		const view = this.kit === undefined && off.length === 0
			? this.verbs
			: this.verbs.view(granted.filter((name) => !off.includes(name)));
		if (this.crowdLawWho() || !view.has('law')) {
			return view;
		}
		return view.withoutArg('law', 'who');
	}

	/** Verbs this body never gets, whatever its kit says. Without a mind, that is every mind-only verb. */
	protected withheldVerbs():readonly string[] {
		return MIND_ONLY_VERBS;
	}

	protected crowdLawWho():boolean {
		return false;
	}

	addLaw(spec:CrowdLawSpec, pinned = false):CrowdLaw | undefined {
		const law = lawFromSpec(
			{ ...spec, pinned: pinned || spec.pinned },
			this.verbs,
			spec.name ?? `law_${this.laws.length + 1}`,
			this.defaultLawWho,
		);
		if (!law) {
			return undefined;
		}
		this.laws = upsertLaw(this.laws, law, this.maxLaws);
		return this.laws.find((s) => s.name === law.name);
	}

	removeLaw(name:string):void {
		this.laws = dropLaw(this.laws, name);
	}

	lawHandlers(matches?:(law:CrowdLaw)=>boolean):ArcHandler[] {
		const out:ArcHandler[] = [];
		this.laws.forEach((law, i) => {
			if (matches && !matches(law)) {
				return;
			}
			out.push({
				key: `law:${law.name}`,
				watch: law.watch,
				arc: law.arc,
				rank: i,
			});
		});
		return out;
	}

	beginLaw(handler:ArcHandler, sessionOpts?:ArcSessionOpts):void {
		if (this.arcSession && (this.liveArc || this.arcSession.parked)) {
			this.arcSession.pending = { kind: 'preempt', handler };
			this.arcSession.token += 1;
			this.abortArc?.(this.id);
			return;
		}
		void this.enact(handler.arc, handler, sessionOpts);
	}

	/** This body's name for something it samples now. A plain actor uses ids. */
	seen(target:NameTarget):string {
		return target.id;
	}

	/** This body's name for `id`. */
	nameOf(id:string):string {
		return id;
	}

	/** The id a name in an arc arg stands for. A plain actor's names are ids. */
	resolveName(name:string):string {
		return name;
	}

	stamp(now:number):void {
		this.now = now;
	}

	/** Run an arc (world verbs via `execute`). A new arc replaces the one running. */
	async enact(
		arc:Arc,
		handler?:ArcHandler,
		sessionOpts?:ArcSessionOpts,
	):Promise<ArcResult> {
		this.replaceProgram();
		this.liveArc = true;
		this.verbIndex = 0;
		this.onArcStart(arc);
		const session = createArcSession({
			now: () => this.now,
			catalog: () => {
				const ctx = this.context();
				return ctx && this.catalog ? this.catalog(ctx) : undefined;
			},
			abortHost: () => this.abortArc?.(this.id),
			...sessionOpts,
		});
		this.arcSession = session;
		try {
			let i = 0;
			const result = await runArc(arc, async (step) => {
				this.verbIndex = i;
				i += 1;
				const out = await this.runStep(step, this.context());
				this.lastResult = out;
				return out;
			}, { session, asHandler: handler });
			if (this.arcSession !== session) {
				return result;
			}
			if (session.parked) {
				this.liveArc = false;
				this.onArcEnd();
				return result;
			}
			await this.afterArc(result);
			if (this.arcSession !== session) {
				return result;
			}
			this.onArcResult(result);
			return result;
		}
		finally {
			if (this.arcSession === session && !session.parked) {
				this.liveArc = false;
				this.arcSession = null;
				this.onArcEnd();
			}
		}
	}

	/** Stop the running arc, if any, and the host's part of it. */
	replaceProgram():void {
		if (this.arcSession) {
			this.arcSession.token += 1;
			this.arcSession.pending = { kind: 'abort' };
			this.arcSession.abortHost?.();
		}
		this.abortArc?.(this.id);
		this.arcSession = null;
		this.liveArc = false;
		this.onArcEnd();
	}

	toJSON():ActorJSON {
		return {
			id: this.id,
			lastResult: this.lastResult ? { ...this.lastResult } : undefined,
			liveArc: this.liveArc,
			laws: this.laws.map((s) => ({ ...s, arc: s.arc })),
			maxLaws: this.maxLaws,
			cooldown: this.cooldown,
			prevMe: this.prevMe ? cloneEntity(this.prevMe) : undefined,
		};
	}

	protected loadJSON(json:ActorJSON):void {
		this.lastResult = json.lastResult;
		this.liveArc = json.liveArc;
		if (json.maxLaws !== undefined) {
			this.maxLaws = json.maxLaws;
		}
		if (json.cooldown !== undefined) {
			this.cooldown = json.cooldown;
		}
		this.prevMe = prevMeFromJSON(json.prevMe);
		if (json.laws) {
			this.laws = json.laws.map((s) => ({ ...s }));
		}
	}

	/** One step of a running arc: `say` through talk, the rest through the host. */
	protected async runStep(step:Step, ctx:TAgentCtx | undefined):Promise<ArcResult> {
		if (!this.activeVerbs().has(step.verb)) {
			return { ok: false, verb: step.verb, reason: `verb '${step.verb}' is not available` };
		}
		if (step.verb === 'say' && this.talk) {
			return this.speak(step);
		}
		if (!this.execute) {
			return { ok: false, verb: step.verb, reason: `host has no executor for ${step.verb}` };
		}
		return this.execute(step, ctx);
	}

	/** `say` through talk. Only call with talk attached. */
	protected speak(step:Step):SayResult {
		return this.talk!.say(this.id, String(step.args.text ?? ''), this.sayToOf(step.args), this.now);
	}

	/** Addressee ids, from this body's names for them. */
	protected sayToOf(args:Step['args']):SayTo | undefined {
		const to = args.to;
		if (Array.isArray(to)) {
			const ids = to
				.filter((x):x is string => typeof x === 'string' && x.trim().length > 0)
				.map((name) => this.resolveName(name));
			return ids.length > 0 ? ids : undefined;
		}
		if (typeof to === 'string' && to.trim()) {
			return this.resolveName(to);
		}
		return undefined;
	}

	/** An arc began. A mind tells its scheduler. */
	protected onArcStart(_arc:Arc):void {}

	/** The running arc stopped or parked. A mind tells its scheduler. */
	protected onArcEnd():void {}

	/** After the last step, while the arc is still live (a new think can still abort it). */
	protected async afterArc(result:ArcResult):Promise<void> {}

	/** The arc finished. A mind also turns this into an event for its next think. */
	protected onArcResult(result:ArcResult):void {
		this.lastResult = result;
		this.liveArc = false;
	}
}
