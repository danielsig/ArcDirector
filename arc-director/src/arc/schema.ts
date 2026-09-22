import type { JsonSchema } from '../json.js';
import type { VerbRegistry, VerbSpec } from './stock-verbs.js';

const THEN_DEPTH = 8;

function stepSchema(registry:VerbRegistry, depth:number):JsonSchema {
	const properties:Record<string, JsonSchema> = {};
	for (const name of registry.argNames()) {
		const spec = registry.list().find((v) => name in v.args);
		if (!spec) {
			continue;
		}
		const kind = spec.args[name];
		const base = kind.endsWith('?') ? kind.slice(0, -1) : kind;
		properties[name] = base === 'arc'
			? (depth <= 0 ? { type: 'object', additionalProperties: true } : arcSchemaAt(registry.nested(), depth - 1))
			: registry.argSchema(kind);
	}
	return {
		type: 'object',
		additionalProperties: false,
		required: ['verb', 'args'],
		properties: {
			verb: {
				type: 'string',
				enum: registry.list().map((v) => v.name),
			},
			args: {
				type: 'object',
				additionalProperties: false,
				properties,
			},
		},
	};
}

function arcSchemaAt(registry:VerbRegistry, depth:number):JsonSchema {
	const step = stepSchema(registry, depth);
	const thenJoin:JsonSchema = {
		type: 'object',
		additionalProperties: false,
		required: ['join', 'arc'],
		properties: {
			join: { type: 'string', enum: ['then_if_ok', 'then', 'then_if_err'] },
			arc: depth <= 0
				? { type: 'object', additionalProperties: true }
				: arcSchemaAt(registry, depth - 1),
		},
	};
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			head: step,
			group: depth <= 0
				? { type: 'object', additionalProperties: true }
				: arcSchemaAt(registry, depth - 1),
			then: thenJoin,
		},
	};
}

export function arcSchema(registry:VerbRegistry):JsonSchema {
	const arc = arcSchemaAt(registry, THEN_DEPTH);
	const watchDict:JsonSchema = {
		type: 'object',
		additionalProperties: { type: 'string' },
	};
	return {
		title: 'Arc',
		...arc,
		properties: {
			...(arc.properties ?? {}),
			addWatches: watchDict,
			editWatches: watchDict,
			removeWatches: {
				type: 'array',
				items: { type: 'string' },
			},
			watches: watchDict,
			sightFocus: {
				type: 'array',
				items: { type: 'string' },
			},
		},
	};
}

function formatVerbHelp(spec:VerbSpec):string {
	const parts = Object.entries(spec.args).map(([k, kind]) => {
		return kind.endsWith('?') ? `${k}?` : k;
	});
	const base = parts.length === 0 ? spec.name : `${spec.name}(${parts.join(', ')})`;
	if (spec.name === 'when') {
		return `${base} — this job's interrupt; no extra think`;
	}
	if (spec.name === 'issue') {
		return `${base} — assigns a sticky program to matching units, never the commander`;
	}
	if (spec.name === 'law') {
		return `${base} — standing reaction until unlaw; no extra think`;
	}
	if (spec.name === 'unlaw' || spec.name === 'tag' || spec.name === 'untag') {
		return `${base} — assigns only`;
	}
	if (spec.name === 'loop') {
		return `${base} — repeats until fail`;
	}
	return base;
}

export function verbHelp(registry:VerbRegistry):string {
	const kit = registry.list().map(formatVerbHelp).join(', ');
	if (!registry.has('issue')) {
		return kit;
	}
	const nested = registry.nested();
	if (nested === registry) {
		return kit;
	}
	const extras = nested.list().filter((spec) => !registry.has(spec.name)).map(formatVerbHelp);
	if (extras.length === 0) {
		return kit;
	}
	return `${kit}. Nested arc verbs: ${extras.join(', ')}`;
}
