import type { JsonSchema } from '../json.js';

export type VerbArgKind = 'id' | 'id?' | 'string' | 'string?' | 'number' | 'number?' | 'string[]' | 'string[]?' | 'plan' | 'plan?';

export type VerbArgMap = Record<string, VerbArgKind>;

export type VerbSpec = {
	name:string;
	args:VerbArgMap;
};

export class VerbRegistry {
	private readonly verbs = new Map<string, VerbSpec>();

	add(name:string, args:VerbArgMap = {}):this {
		if (this.verbs.has(name)) {
			throw new Error(`verb already registered: ${name}`);
		}
		for (const key of Object.keys(args)) {
			if (key === 'x' || key === 'z' || key === 'y') {
				throw new Error(`verb ${name}: coordinate arg '${key}' is not allowed`);
			}
		}
		this.verbs.set(name, { name, args });
		return this;
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
		for (const spec of this.list()) {
			if (wanted.has(spec.name)) {
				next.add(spec.name, spec.args);
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
		const optional = kind.endsWith('?');
		const base = optional ? kind.slice(0, -1) : kind;
		if (base === 'number') {
			return { type: 'number' };
		}
		if (base === 'string[]') {
			return { type: 'array', items: { type: 'string' } };
		}
		if (base === 'plan') {
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
export const STOCK_ITEM_VERBS = ['use', 'equip', 'unequip', 'pick_up', 'drop', 'give', 'examine'] as const;
export const STOCK_MIND_VERBS = [
	'say', 'wait', 'remember', 'think', 'set_goal', 'drop_goal', 'set_identity', 'when', 'loop',
] as const;
export const STOCK_VERBS = [...STOCK_MOVE_VERBS, ...STOCK_ITEM_VERBS, ...STOCK_MIND_VERBS] as const;
export type StockVerb = (typeof STOCK_VERBS)[number];

export const STOCK_VERB_ARGS:Record<StockVerb, VerbArgMap> = {
	go_to: { name: 'id' },
	follow: { name: 'id' },
	wander: { until: 'string?', seconds: 'number?' },
	use: { item: 'id', target: 'id?' },
	equip: { item: 'id', slot: 'string?' },
	unequip: { slot: 'string' },
	pick_up: { name: 'id' },
	drop: { name: 'id' },
	give: { item: 'id', to: 'id' },
	examine: { name: 'id' },
	say: { text: 'string', to: 'id?' },
	wait: { seconds: 'number?', until: 'string?' },
	remember: { content: 'string', tags: 'string[]?' },
	think: { about: 'string?' },
	set_goal: { goal: 'string', priority: 'number?' },
	drop_goal: { goal: 'string?' },
	set_identity: { name: 'string?', role: 'string?', traits: 'string[]?' },
	when: { who: 'string?', watch: 'string?', plan: 'plan', name: 'string?' },
	loop: { plan: 'plan', through: 'string?', until: 'string?', times: 'number?' },
};

/** Schema-only. Omit `verbs` to register the full stock set. Already-registered names are skipped. */
export function registerStockVerbs(registry:VerbRegistry, ...verbs:StockVerb[]):VerbRegistry {
	const list = verbs.length > 0 ? verbs : STOCK_VERBS;
	for (const name of list) {
		if (!(name in STOCK_VERB_ARGS)) {
			throw new Error(`ArcDirector: '${name}' is not a stock verb`);
		}
		if (!registry.has(name)) {
			registry.add(name, STOCK_VERB_ARGS[name]);
		}
	}
	return registry;
}
