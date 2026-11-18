import type { Step } from '../arc/arc-types.js';
import { fillHoles, VerbRegistry, type VerbArgMap, type VerbDef } from '../arc/stock-verbs.js';
import type { StockVerbArgs, StockVerbName, VerbAlias, VerbArgs, VerbGate, VerbHandler } from './director-types.js';

/**
 * A director's verbs: the registry every character and collective parses and runs with, and what runs each verb, the
 * host's handler or an alias's arc, with the gate every host verb passes. `withVerbs((v) => v.addStock().add(…))`.
 */
export class Verbs<TCtx = unknown> extends VerbRegistry {
	private readonly _handlers = new Map<string, VerbHandler<TCtx>>();
	private readonly _aliases = new Map<string, VerbAlias>();
	private _gate:VerbGate<TCtx> | undefined;

	/** `changed` hears every change but a `redefine`: its director keeps what other settings say about verbs in step. */
	constructor(private readonly _changed:()=>void) {
		super();
	}

	/**
	 * Verb `name` with its schema and, optionally, the host's handler, its `args` typed from `args`. A verb here already
	 * keeps its schema (a stock verb takes only a handler, typed from its stock args); its handler is bound or replaced,
	 * and its `seen` and `impact` change when given.
	 */
	public override add<TVerb extends StockVerbName>(name:TVerb, verb:{ help?:string; reply?:boolean; seen?:string; impact?:number; handler:VerbHandler<TCtx, VerbArgs<StockVerbArgs<TVerb>>> }):this;
	public override add<const TArgMap extends VerbArgMap = Record<never, never>>(name:string, verb?:Omit<VerbDef, 'args'> & { args?:TArgMap; handler?:VerbHandler<TCtx, VerbArgs<TArgMap>> }):this;
	public override add(name:string, { handler, ...def }:VerbDef & { handler?:VerbHandler<TCtx, never> } = {}):this {
		if (handler) {
			// The schema is checked before dispatch, so the args match what this handler was typed with.
			this._handlers.set(name, handler as VerbHandler<TCtx>);
		}
		return super.add(name, def);
	}

	/**
	 * An alias: a verb that runs `arc`, its `{arg}` holes filled from its args (or `arc` made from them). Usable wherever
	 * a verb is. As a law's whole arc it brings `watch`, `who` and `rearm` when the law gives none:
	 * `law(name=archers, arc=keep_distance(keep=4), who=units.filter("Archer"))`.
	 */
	public addAlias(name:string, { arc, watch, who, rearm, ...def }:Pick<VerbDef, 'args' | 'help' | 'seen'> & VerbAlias):this {
		this._aliases.set(name, { arc, watch, who, rearm });
		return super.add(name, def);
	}

	/** Drop verbs, with their handlers and aliases. */
	public override remove(...names:string[]):this {
		for (const name of names) {
			this._handlers.delete(name);
			this._aliases.delete(name);
		}
		return super.remove(...names);
	}

	/** Runs before every host verb. Return a result to refuse the step (a fallen character, a cutscene); `undefined` lets it run. */
	public withGate(gate:VerbGate<TCtx>):this {
		this._gate = gate;
		return this;
	}

	/** What every host verb passes first, if anything. */
	public get gate():VerbGate<TCtx> | undefined {
		return this._gate;
	}

	/** The host's handler for `name`, if it gave one. */
	public handler(name:string):VerbHandler<TCtx> | undefined {
		return this._handlers.get(name);
	}

	/** `name`'s alias, if it is one. */
	public alias(name:string):VerbAlias | undefined {
		return this._aliases.get(name);
	}

	/** `step`'s alias `part` with its `{arg}` holes filled; none when `step` is no alias or its alias has none. */
	public aliasPart(step:Step, part:'arc' | 'watch' | 'who'):string | undefined {
		const src = this._aliases.get(step.verb)?.[part];
		return typeof src === 'function' ? src(step.args) : src === undefined ? undefined : fillHoles(src, step.args);
	}

	protected override changed():void {
		this._changed();
	}
}
