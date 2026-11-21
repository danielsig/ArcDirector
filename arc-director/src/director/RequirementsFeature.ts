import type { ArcResult } from '../arc/arc-types.js';
import { watchIsTrue } from '../arc/run.js';
import { argKind } from '../arc/stock-verbs.js';
import { namingText, parseTextWithIDs } from '../character/text-with-ids.js';
import { catalogEntities } from '../expr/eval.js';
import { needleMatch } from '../expr/expr-types.js';
import { internalsOf } from '../internals.js';
import type { ArcDirector } from './ArcDirector.js';
import type { Requirement, VerbCall } from './director-types.js';
import { Feature } from './Feature.js';

/** A requirement's fields that are not args of its verb. */
const FIELDS:ReadonlySet<string> = new Set(['verb', 'condition', 'reason']);

/** Requirements (`withRequirements`): a step whose {@link Requirement} is not met is refused before it starts. */
export class RequirementsFeature<TCtx = unknown> extends Feature<TCtx> {
	private _rules:readonly Requirement[] = [];

	/** Replaces the rules in force. One naming a verb, or an arg of it, that there is none of throws. */
	public set(rules:readonly Requirement[]):void {
		for (const rule of rules) {
			const spec = this.director.verbs.get(rule.verb);
			const bad = spec ? Object.keys(rule).find((key) => !FIELDS.has(key) && !argKind(spec, key)) : rule.verb;
			if (bad !== undefined) {
				throw new Error(`a requirement on ${rule.verb}: no ${spec ? `arg ${bad}` : 'such verb'}`);
			}
		}
		this._rules = rules;
	}

	/** The first rule of the verb whose args all name what the step does, by id or tag, unmet: its reason in the doer's names. */
	public override refuses(call:VerbCall<TCtx>):ArcResult | undefined {
		const rules = this._rules.filter((r) => r.verb === call.verb);
		const catalog = rules.length ? internalsOf(this.director).watches.catalog(call.character, call.ctx) : undefined;
		const named = (key:string, want:unknown):boolean => call.args[key] === want
			|| (!!catalog && catalogEntities(catalog).some((e) => e.id === call.args[key] && needleMatch(e, String(want))));
		const rule = rules.find((r) => Object.entries(r).every(([key, want]) => FIELDS.has(key) || named(key, want)) && !(catalog && watchIsTrue(r.condition, catalog)));
		const reason = rule && (rule.reason ?? `needs ${rule.condition}`);
		const world = this.director.world;
		return rule && { status: 'failed', verb: call.verb, reason: typeof reason === 'string' && world ? namingText(parseTextWithIDs(reason, (word) => (world.find(word) === undefined ? undefined : word))) : reason };
	}
}

declare module './ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link RequirementsFeature}, after `withVerbs`: `withRequirements([{ verb: 'use', item: 'Sushi', condition, reason }])`. */
		withRequirements(rules:readonly Requirement[]):this;
		getRequirements():RequirementsFeature<TCtx> | undefined;
	}
}
export function withRequirements<TCtx>(this:ArcDirector<TCtx>, rules:readonly Requirement[]):ArcDirector<TCtx> {
	this.configureFeature(RequirementsFeature<TCtx>, () => new RequirementsFeature<TCtx>());
	this.getFeature(RequirementsFeature<TCtx>)!.set(rules);
	return this;
}
