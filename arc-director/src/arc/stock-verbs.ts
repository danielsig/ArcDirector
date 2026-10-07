import type { JsonSchema } from '../json.js';

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

export type VerbSpec = {
	name:string;
	args:VerbArgMap;
	/** One line shown after the verb in the prompt's verb list. */
	help?:string;
};

/** What `addVerb` and `VerbRegistry.add` take. */
export type VerbDef = {
	args?:VerbArgMap;
	help?:string;
};

export class VerbRegistry {
	private readonly verbs = new Map<string, VerbSpec>();

	/** Catalog used to parse nested `arc=` args. Kit views point at the unfiltered registry. */
	private nestedSource:VerbRegistry | null = null;

	add(name:string, { args = {}, help }:VerbDef = {}):this {
		if (this.verbs.has(name)) {
			throw new Error(`verb already registered: ${name}`);
		}
		for (const key of Object.keys(args)) {
			if (key === 'x' || key === 'z' || key === 'y') {
				throw new Error(`verb ${name}: coordinate arg '${key}' is not allowed`);
			}
		}
		this.verbs.set(name, { name, args, help });
		return this;
	}

	/** Full catalog. Nested unit / loop / law arcs may name verbs this kit does not grant the thinker. */
	nested():VerbRegistry {
		return this.nestedSource ?? this;
	}

	/** Copy with `key` dropped from `verb` (solo `law` has no `who`). */
	withoutArg(verb:string, key:string):VerbRegistry {
		const next = new VerbRegistry();
		next.nestedSource = this.nestedSource ?? this;
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

	remove(...names:string[]):this {
		for (const name of names) {
			this.verbs.delete(name);
		}
		return this;
	}

	/** Catalog names in `allow`, in catalog order. `null` / omit = this registry. */
	view(allow?:readonly string[] | null):VerbRegistry {
		if (allow == null) {
			return this;
		}
		const wanted = new Set(allow);
		const next = new VerbRegistry();
		next.nestedSource = this.nestedSource ?? this;
		for (const spec of this.list()) {
			if (wanted.has(spec.name)) {
				next.add(spec.name, spec);
			}
		}
		return next;
	}

	get(name:string):VerbSpec | undefined {
		return this.verbs.get(name);
	}

	has(name:string):boolean {
		return this.verbs.has(name);
	}

	list():VerbSpec[] {
		return [...this.verbs.values()];
	}

	argNames():string[] {
		const names = new Set<string>();
		for (const spec of this.verbs.values()) {
			for (const key of Object.keys(spec.args)) {
				names.add(key);
			}
		}
		return [...names].sort();
	}

	argSchema(kind:VerbArgKind):JsonSchema {
		const base = argBase(kind);
		if (base === 'number') {
			return { type: 'number' };
		}
		if (base === 'string[]') {
			return { type: 'array', items: { type: 'string' } };
		}
		if (base === 'arc') {
			return { type: 'object' };
		}
		return { type: 'string' };
	}

	requiredArgs(spec:VerbSpec):string[] {
		return Object.entries(spec.args)
			.filter(([, kind]) => !kind.endsWith('?'))
			.map(([key]) => key);
	}

	firstRequiredArg(spec:VerbSpec):string | undefined {
		return this.requiredArgs(spec)[0] ?? Object.keys(spec.args)[0];
	}
}

export const STOCK_MOVE_VERBS = ['go_to', 'follow', 'wander'] as const;
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
export const STOCK_VERBS = [...STOCK_MOVE_VERBS, ...STOCK_ITEM_VERBS, ...STOCK_MIND_VERBS, ...STOCK_ARC_VERBS] as const;
export type StockVerb = (typeof STOCK_VERBS)[number] | (typeof STOCK_TRADE_VERBS)[number];

export const STOCK_VERB_DEFS = {
	go_to: { args: { target: 'id' } },
	follow: { args: { target: 'id' }, help: 'keeps following until your next arc' },
	wander: { args: { until: 'watch?', seconds: 'number?' } },
	use: { args: { item: 'id', target: 'id?' }, help: 'goes to the target first' },
	pick_up: { args: { item: 'id' }, help: 'goes to it first; never from what others carry' },
	drop: { args: { item: 'id' } },
	give: { args: { item: 'id', to: 'id' }, help: 'goes to them first; how you pay or hand anything over, saying so does not' },
	examine: { args: { target: 'id' } },
	buy: { args: { item: 'id', from: 'id', offer: 'number?', quantity: 'number?' }, help: 'goes to the seller first; offer is for all of them' },
	sell: { args: { item: 'id', to: 'id', ask: 'number?', quantity: 'number?' }, help: 'goes to the buyer first; ask is for all of them' },
	say: { args: { text: 'text', to: 'id?' } },
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
