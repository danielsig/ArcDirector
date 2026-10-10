/**
 * `id` is a character, thing or place; the host always receives a real id, even when the model wrote its own name for it
 * or an expression that picks one. `text` is prose: unquoted, it runs to the closing `)` or the next `, key=`.
 * `watch` is a watch-language expression; the host reads it through `VerbCall.holds` / `score`.
 * `expr` is any other expression (`units.filter("Archer")`), and `law` a law's name.
 * A mind stores every `id`, `watch`, `expr`, `law` and `arc` arg in ids, and shows them to its model in its names.
 */
export type VerbArgKind = 'id' | 'id?' | 'string' | 'string?' | 'text' | 'text?' | 'watch' | 'watch?' | 'expr' | 'expr?' | 'law' | 'law?' | 'number' | 'number?' | 'string[]' | 'string[]?' | 'arc' | 'arc?';

/** A kind without its optional mark: `id?` is `id`. */
export function argBase(kind:string | undefined):string {
	return kind?.endsWith('?') ? kind.slice(0, -1) : kind ?? '';
}

export type VerbArgMap = Record<string, VerbArgKind>;

/** A group, `( … )`, is the step `{ verb: 'group', args: { arc } }`. It is not a registered verb. */
export const GROUP_VERB = 'group';

/** In an Arc's JSON a step is `{ verb, …args, then }`, so no arg may be called either. */
const RESERVED_ARGS:readonly string[] = ['verb', 'then'];

export type VerbSpec = {
	name:string;
	args:VerbArgMap;
	/** One line shown after the verb in the prompt's verb list. */
	help?:string;
	/** This verb expects an answer from the character it names. After the arc, the actor waits for them if they are still nearby. Default: do not wait. */
	reply?:boolean;
};

/** What `addVerb` and `VerbRegistry.add` take. */
export type VerbDef = {
	args?:VerbArgMap;
	help?:string;
	/** This verb expects an answer from the character it names. After the arc, the actor waits for them if they are still nearby. Default: do not wait. */
	reply?:boolean;
};

export class VerbRegistry {
	private readonly _verbs = new Map<string, VerbSpec>();

	/** Catalog used to parse nested `arc=` args. Kit views point at the unfiltered registry. */
	private _nestedSource:VerbRegistry | null = null;

	public add(name:string, { args = {}, help, reply }:VerbDef = {}):this {
		if (this._verbs.has(name)) {
			throw new Error(`verb already registered: ${name}`);
		}
		if (name === GROUP_VERB) {
			throw new Error(`verb ${name}: '${GROUP_VERB}' is how an Arc writes ( … ), not a verb`);
		}
		for (const key of Object.keys(args)) {
			if (key === 'x' || key === 'z' || key === 'y') {
				throw new Error(`verb ${name}: coordinate arg '${key}' is not allowed`);
			}
			if (RESERVED_ARGS.includes(key)) {
				throw new Error(`verb ${name}: arg '${key}' is reserved`);
			}
		}
		this._verbs.set(name, { name, args, help, ...(reply ? { reply } : {}) });
		return this;
	}

	/** Full catalog. Nested unit / loop / law arcs may name verbs this kit does not grant the thinker. */
	public nested():VerbRegistry {
		return this._nestedSource ?? this;
	}

	/** Copy with `key` dropped from `verb` (solo `law` has no `who`). */
	public withoutArg(verb:string, key:string):VerbRegistry {
		const next = new VerbRegistry();
		next._nestedSource = this._nestedSource ?? this;
		for (const spec of this.list()) {
			if (spec.name !== verb) {
				next.add(spec.name, spec);
				continue;
			}
			const args = { ...spec.args };
			delete args[key];
			next.add(spec.name, { ...spec, args });
		}
		return next;
	}

	public remove(...names:string[]):this {
		for (const name of names) {
			this._verbs.delete(name);
		}
		return this;
	}

	/** Catalog names in `allow`, in catalog order. `null` / omit = this registry. */
	public view(allow?:readonly string[] | null):VerbRegistry {
		if (allow == null) {
			return this;
		}
		const wanted = new Set(allow);
		const next = new VerbRegistry();
		next._nestedSource = this._nestedSource ?? this;
		for (const spec of this.list()) {
			if (wanted.has(spec.name)) {
				next.add(spec.name, spec);
			}
		}
		return next;
	}

	public get(name:string):VerbSpec | undefined {
		return this._verbs.get(name);
	}

	public has(name:string):boolean {
		return this._verbs.has(name);
	}

	public list():VerbSpec[] {
		return [...this._verbs.values()];
	}
}

export const STOCK_MOVE_VERBS = ['go_to', 'follow', 'flee', 'wander'] as const;
export const STOCK_ITEM_VERBS = ['use', 'pick_up', 'drop', 'give', 'examine'] as const;
/** Registered with the rest; not in `STOCK_VERBS`, so a kit grants them only where there is trade. */
export const STOCK_TRADE_VERBS = ['buy', 'sell'] as const;
export const STOCK_MIND_VERBS = [
	'say', 'wait', 'remember', 'think', 'set_goal', 'drop_goal', 'set_identity',
	'watch', 'unwatch', 'focus', 'unfocus',
] as const;
/** Withheld when the mind's persona has `watchesWritable` / `sightFocusWritable` off, whatever the kit says. */
export const WATCH_EDIT_VERBS:readonly string[] = ['watch', 'unwatch'];
export const FOCUS_EDIT_VERBS:readonly string[] = ['focus', 'unfocus'];
/** Verbs only a mind can run: they call the model or shape its later prompts. A character without a mind never has them. */
export const MIND_ONLY_VERBS:readonly string[] = [
	'think', 'remember', 'set_goal', 'drop_goal', 'set_identity', ...WATCH_EDIT_VERBS, ...FOCUS_EDIT_VERBS,
];
export const STOCK_ARC_VERBS = ['when', 'loop', 'law', 'unlaw'] as const;
/** A System One model picks one of its arcs. Withheld from any runner without a System One, whatever its kit says. */
export const CHOOSE_VERB = 'choose';
export const STOCK_VERBS = [...STOCK_MOVE_VERBS, ...STOCK_ITEM_VERBS, ...STOCK_MIND_VERBS, ...STOCK_ARC_VERBS, CHOOSE_VERB] as const;
export type StockVerb = (typeof STOCK_VERBS)[number] | (typeof STOCK_TRADE_VERBS)[number];

export const STOCK_VERB_DEFS = {
	go_to: { args: { target: 'id' } },
	follow: { args: { target: 'id' }, help: 'keeps following until your next arc' },
	flee: { args: { from: 'id', distance: 'number?' }, help: 'runs until clear of them for a few seconds; distance is how far counts as clear' },
	wander: { args: { until: 'watch?', seconds: 'number?' } },
	use: { args: { item: 'id', target: 'id?' }, help: 'goes to the target first' },
	pick_up: { args: { item: 'id' }, help: 'goes to it first; never from what others carry' },
	drop: { args: { item: 'id' } },
	give: { args: { item: 'id', to: 'id' }, help: 'goes to them first; how you pay or hand anything over, saying so does not', reply: true },
	examine: { args: { target: 'id' } },
	buy: { args: { item: 'id', from: 'id', offer: 'number?', quantity: 'number?' }, help: 'goes to the seller first; offer is for all of them', reply: true },
	sell: { args: { item: 'id', to: 'id', ask: 'number?', quantity: 'number?' }, help: 'goes to the buyer first; ask is for all of them', reply: true },
	say: { args: { text: 'text', to: 'id?' }, help: 'one short sentence', reply: true },
	wait: { args: { seconds: 'number?', until: 'watch?' } },
	remember: { args: { content: 'text', tags: 'string[]?' } },
	think: { args: { about: 'text?' } },
	set_goal: { args: { goal: 'text', priority: 'number?' } },
	drop_goal: { args: { goal: 'text?' } },
	set_identity: { args: { role: 'string?', traits: 'string[]?' } },
	watch: { args: { name: 'string', expr: 'expr' } },
	unwatch: { args: { name: 'string' } },
	focus: { args: { expr: 'expr' } },
	unfocus: { args: { expr: 'expr' } },
	when: { args: { watch: 'watch', arc: 'arc' }, help: `this job's interrupt; no extra think` },
	loop: { args: { arc: 'arc', through: 'watch?', until: 'watch?', times: 'number?' }, help: 'repeats until fail' },
	law: { args: { who: 'expr?', watch: 'watch', arc: 'arc', name: 'law?' }, help: 'standing reaction until unlaw; no extra think' },
	unlaw: { args: { name: 'law' }, help: 'drops that law' },
	// Its choices are named args of their own; `arc/choose.ts` reads them.
	choose: { args: { goal: 'text' }, help: 'a fast model picks one by name each run; loop it to keep picking' },
} as const satisfies Record<StockVerb, VerbDef>;

/** Schema-only. Omit `verbs` to register the full stock set. Already-registered names are skipped. */
export function registerStockVerbs(registry:VerbRegistry, ...verbs:StockVerb[]):VerbRegistry {
	const list = verbs.length > 0 ? verbs : [...STOCK_VERBS, ...STOCK_TRADE_VERBS];
	for (const name of list) {
		if (!(name in STOCK_VERB_DEFS)) {
			throw new Error(`ArcDirector: '${name}' is not a stock verb`);
		}
		if (!registry.has(name)) {
			registry.add(name, STOCK_VERB_DEFS[name]);
		}
	}
	return registry;
}
