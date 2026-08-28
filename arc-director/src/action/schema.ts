import type { JsonSchema } from '../json.js';
import type { VerbRegistry } from './registry.js';

const THEN_DEPTH = 4;

function stepSchema(registry:VerbRegistry):JsonSchema {
	const properties:Record<string, JsonSchema> = {};
	for (const name of registry.argNames()) {
		const spec = registry.list().find((v) => name in v.args);
		if (!spec) {
			continue;
		}
		properties[name] = registry.argSchema(spec.args[name]);
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
	const step = stepSchema(registry);
	if (depth <= 0) {
		return {
			type: 'object',
			additionalProperties: false,
			required: ['head'],
			properties: { head: step },
		};
	}
	return {
		type: 'object',
		additionalProperties: false,
		required: ['head'],
		properties: {
			head: step,
			then: {
				type: 'object',
				additionalProperties: false,
				required: ['join', 'plan'],
				properties: {
					join: { type: 'string', enum: ['then_if_ok', 'then', 'then_if_err'] },
					plan: planSchemaAt(registry, depth - 1),
				},
			},
		},
	};
}

export function actionPlanSchema(registry:VerbRegistry):JsonSchema {
	return {
		title: 'ActionPlan',
		...planSchemaAt(registry, THEN_DEPTH),
	};
}

export function verbHelp(registry:VerbRegistry):string {
	return registry.list().map((spec) => {
		const parts = Object.entries(spec.args).map(([k, kind]) => {
			return kind.endsWith('?') ? `${k}?` : k;
		});
		return parts.length === 0 ? spec.name : `${spec.name}(${parts.join(', ')})`;
	}).join(', ');
}
