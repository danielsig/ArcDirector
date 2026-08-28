import type { JsonSchema } from '../json.js';

export type VerbArgKind = 'id' | 'id?' | 'string' | 'string?' | 'number' | 'number?' | 'string[]' | 'string[]?';

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

/** Host dungeon verbs. Not baked into the library loop. */
export function registerCoreVerbs(registry:VerbRegistry):VerbRegistry {
	return registry
		.add('go_to', { name: 'id' })
		.add('follow', { name: 'id' })
		.add('wander', {})
		.add('use', { item: 'id', target: 'id?' })
		.add('equip', { item: 'id', slot: 'string?' })
		.add('unequip', { slot: 'string' })
		.add('pick_up', { name: 'id' })
		.add('drop', { name: 'id' })
		.add('say', { text: 'string', to: 'id?' })
		.add('wait', { seconds: 'number?' })
		.add('remember', { content: 'string', tags: 'string[]?' })
		.add('set_goal', { goal: 'string', priority: 'number?' })
		.add('drop_goal', { goal: 'string?' })
		.add('set_identity', { name: 'string?', role: 'string?', traits: 'string[]?' });
}
