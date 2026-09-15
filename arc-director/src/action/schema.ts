import type { JsonSchema } from '../json.js';
import type { VerbRegistry } from './registry.js';

const THEN_DEPTH = 4;

function stepSchema(registry:VerbRegistry, depth:number):JsonSchema {
	const properties:Record<string, JsonSchema> = {};
	for (const name of registry.argNames()) {
		const spec = registry.list().find((v) => name in v.args);
		if (!spec) {
			continue;
		}
		const kind = spec.args[name];
		const base = kind.endsWith('?') ? kind.slice(0, -1) : kind;
		properties[name] = base === 'plan'
			? (depth <= 0 ? { type: 'object', additionalProperties: true } : planSchemaAt(registry, depth - 1))
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

function planSchemaAt(registry:VerbRegistry, depth:number):JsonSchema {
	const step = stepSchema(registry, depth);
	const thenJoin:JsonSchema = {
		type: 'object',
		additionalProperties: false,
		required: ['join', 'plan'],
		properties: {
			join: { type: 'string', enum: ['then_if_ok', 'then', 'then_if_err'] },
			plan: depth <= 0
				? { type: 'object', additionalProperties: true }
				: planSchemaAt(registry, depth - 1),
		},
	};
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			head: step,
			group: depth <= 0
				? { type: 'object', additionalProperties: true }
				: planSchemaAt(registry, depth - 1),
			then: thenJoin,
		},
	};
}

export function actionPlanSchema(registry:VerbRegistry):JsonSchema {
	const plan = planSchemaAt(registry, THEN_DEPTH);
	const watchDict:JsonSchema = {
		type: 'object',
		additionalProperties: { type: 'string' },
	};
	return {
		title: 'ActionPlan',
		...plan,
		properties: {
			...(plan.properties ?? {}),
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

export function verbHelp(registry:VerbRegistry):string {
	return registry.list().map((spec) => {
		const parts = Object.entries(spec.args).map(([k, kind]) => {
			return kind.endsWith('?') ? `${k}?` : k;
		});
		const base = parts.length === 0 ? spec.name : `${spec.name}(${parts.join(', ')})`;
		if (spec.name === 'when') {
			return `${base} — who= issues orders immediately; watch= is critical on this job`;
		}
		if (spec.name === 'law' || spec.name === 'unlaw' || spec.name === 'tag' || spec.name === 'untag') {
			return `${base} — assigns only`;
		}
		if (spec.name === 'loop') {
			return `${base} — repeats until fail`;
		}
		return base;
	}).join(', ');
}
