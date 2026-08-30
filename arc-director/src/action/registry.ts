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

	remove(name:string):this {
		this.verbs.delete(name);
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

/** Add core verbs to a registry. The core verbs are:
 * - go_to: move to a target by id
 * - follow: follow a target by id
 * - wander: wander randomly
 * - use: use an item on a target
 * - equip: equip an item
 * - unequip: unequip an item
 * - pick_up: pick up an item
 * - drop: drop an item
 * - say: say a message to a target
 * - wait: wait for a number of seconds; for is a one-shot watch until the next think
 * - remember: add a string to one's memory with optional string tags
 * - think: queue a follow-up think; about is optional
 * - set_goal: set a goal
 * - drop_goal: drop a goal
 * - set_identity: set one's own identity
 */
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
		.add('wait', { seconds: 'number?', for: 'string?' })
		.add('remember', { content: 'string', tags: 'string[]?' })
		.add('think', { about: 'string?' })
		.add('set_goal', { goal: 'string', priority: 'number?' })
		.add('drop_goal', { goal: 'string?' })
		.add('set_identity', { name: 'string?', role: 'string?', traits: 'string[]?' });
}
