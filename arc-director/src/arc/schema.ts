import type { JsonSchema } from '../json.js';
import { argBase, CHOOSE_VERB, type VerbRegistry, type VerbSpec } from './stock-verbs.js';

/** `$defs` names: the thinker's own verbs, and the full catalog its nested arc args may use. */
type Defs = { arc:string; step:string };

function ref(name:string):JsonSchema {
	return { $ref: `#/$defs/${name}` };
}

/** One step. Arc args, and `choose`'s named choices, point at the nested arc. */
function stepSchema(registry:VerbRegistry, nested:Defs):JsonSchema {
	const properties:Record<string, JsonSchema> = {};
	for (const name of registry.argNames()) {
		const spec = registry.list().find((v) => name in v.args);
		if (!spec) {
			continue;
		}
		const kind = spec.args[name];
		properties[name] = argBase(kind) === 'arc' ? ref(nested.arc) : registry.argSchema(kind);
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
				additionalProperties: registry.has(CHOOSE_VERB) ? ref(nested.arc) : false,
				properties,
			},
		},
	};
}

function arcNode(own:Defs):JsonSchema {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			head: ref(own.step),
			group: ref(own.arc),
			then: {
				type: 'object',
				additionalProperties: false,
				required: ['join', 'arc'],
				properties: {
					join: { type: 'string', enum: ['then_if_ok', 'then', 'then_if_err'] },
					arc: ref(own.arc),
				},
			},
		},
	};
}

/** Recursive through `$defs`, so any depth of joins, groups and nested arcs costs the same few kilobytes. */
export function arcSchema(registry:VerbRegistry):JsonSchema {
	const own:Defs = { arc: 'arc', step: 'step' };
	const catalog = registry.nested();
	const nested:Defs = catalog === registry ? own : { arc: 'nestedArc', step: 'nestedStep' };
	const $defs:Record<string, JsonSchema> = {
		[own.arc]: arcNode(own),
		[own.step]: stepSchema(registry, nested),
	};
	if (nested !== own) {
		$defs[nested.arc] = arcNode(nested);
		$defs[nested.step] = stepSchema(catalog, nested);
	}
	return { title: 'Arc', ...arcNode(own), $defs };
}

function formatVerbHelp(spec:VerbSpec):string {
	if (spec.name === CHOOSE_VERB) {
		return `${spec.name}(goal, name=arc, …) — ${spec.help}`;
	}
	const parts = Object.entries(spec.args).map(([k, kind]) => {
		return kind.endsWith('?') ? `${k}?` : k;
	});
	const base = parts.length === 0 ? spec.name : `${spec.name}(${parts.join(', ')})`;
	return spec.help ? `${base} — ${spec.help}` : base;
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
	// `choose` reaches a collective's characters only when its own kit grants it, so it is never a nested extra.
	const extras = nested.list()
		.filter((spec) => !registry.has(spec.name) && spec.name !== CHOOSE_VERB)
		.map(formatVerbHelp);
	if (extras.length === 0) {
		return kit;
	}
	return `${kit}. Nested arc verbs: ${extras.join(', ')}`;
}
