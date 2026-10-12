import type { JsonSchema } from '../json.js';
import { JOINS } from './types.js';
import { argBase, CHOOSE_VERB, GROUP_VERB, type VerbArgKind, type VerbRegistry, type VerbSpec } from './stock-verbs.js';

function ref(name:string):JsonSchema {
	return { $ref: `#/$defs/${name}` };
}

/** The schema of one arg by its kind. An arc is the shared `$defs.arc`. */
function argSchema(kind:VerbArgKind):JsonSchema {
	const base = argBase(kind);
	if (base === 'arc') {
		return ref('arc');
	}
	if (base === 'number') {
		return { type: 'number' };
	}
	if (base === 'string[]') {
		return { type: 'array', items: { type: 'string' } };
	}
	if (base === 'bundle') {
		return { type: 'object', additionalProperties: { type: 'number' } };
	}
	return { type: 'string' };
}

/** Last in every step, so a grammar writes the step's own args before how it joins the next. */
const THEN:JsonSchema = { type: 'string', enum: [...JOINS] };

/** One step of one verb: `verb` is that verb's name and comes first, its args follow in the order the verb lists them. */
function verbStep(spec:VerbSpec):JsonSchema {
	if (spec.name === CHOOSE_VERB) {
		return {
			type: 'object',
			additionalProperties: false,
			required: ['verb', 'goal', 'choices'],
			properties: {
				verb: { const: CHOOSE_VERB },
				goal: { type: 'string' },
				choices: { type: 'object', additionalProperties: ref('arc') },
				then: THEN,
			},
		};
	}
	return {
		type: 'object',
		additionalProperties: false,
		required: ['verb', ...Object.entries(spec.args).filter(([, kind]) => !kind.endsWith('?')).map(([key]) => key)],
		properties: {
			verb: { const: spec.name },
			...Object.fromEntries(Object.entries(spec.args).map(([key, kind]) => [key, argSchema(kind)])),
			then: THEN,
		},
	};
}

const GROUP_STEP:JsonSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['verb', 'arc'],
	properties: { verb: { const: GROUP_VERB }, arc: ref('arc'), then: THEN },
};

/** One tool call: `{"tool":"recall","query":"Bread"}`. The tool's own parameters sit beside `tool`. */
function toolReply(name:string, parameters:JsonSchema):JsonSchema {
	const properties = parameters.properties ?? {};
	if ('tool' in properties) {
		throw new Error(`tool ${name}: a parameter called 'tool' cannot sit beside the reply's own`);
	}
	return {
		type: 'object',
		additionalProperties: false,
		required: ['tool', ...(parameters.required ?? [])],
		properties: { tool: { const: name }, ...properties },
	};
}

/**
 * What a reply must be: a call to one of the `tools` (by name, with its parameters), or `{"steps":[…]}`. One branch
 * per tool and per verb of the whole `catalog`, never of one mind's kit or tools, so the schema is the same bytes
 * for every mind and think; the kit and the mind's own tools are checked once the reply is read. An arc nests through
 * `$defs`, so any depth costs the same few kilobytes.
 */
export function replySchema(catalog:VerbRegistry, tools:Record<string, JsonSchema> = {}):JsonSchema {
	const steps:JsonSchema = {
		type: 'object',
		additionalProperties: false,
		required: ['steps'],
		properties: { steps: ref('arc') },
	};
	const defs:Record<string, JsonSchema> = {
		arc: { type: 'array', minItems: 1, items: ref('step') },
		step: { anyOf: [...catalog.list().map(verbStep), GROUP_STEP] },
	};
	const calls = Object.entries(tools).map(([name, parameters]) => toolReply(name, parameters));
	return calls.length === 0 ? { ...steps, $defs: defs } : { anyOf: [...calls, steps], $defs: defs };
}

/** Built-in tools a help line might name. A line may name one only when this think offers it. */
const DOC_TOOLS = ['recall', 'observe', 'earshot', 'see_map'];

function escapeRegExp(name:string):string {
	return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether `piece` names a verb or tool other than `self` that `allowed` does not grant. */
function mentionsUnavailable(piece:string, self:string, allowed:ReadonlySet<string>, names:readonly string[]):boolean {
	for (const name of names) {
		if (name === self || allowed.has(name)) {
			continue;
		}
		const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(name)}(?![A-Za-z0-9_])`);
		if (re.test(piece)) {
			return true;
		}
	}
	return false;
}

/**
 * Documentation of `self` (a verb help line or a tool description). Sentences and `;` clauses that name some other
 * registered verb or tool are dropped unless that name is available: registered, and in this persona's kit or offered
 * this think.
 */
export function docsFor(text:string, self:string, allowed:ReadonlySet<string>, catalog:readonly string[]):string {
	const names = [...new Set([...catalog, ...DOC_TOOLS])];
	const kept = text.split(/(?<=[.;])\s+/).filter((piece) => piece.trim() !== '' && !mentionsUnavailable(piece, self, allowed, names));
	return kept.join(' ').replace(/\s+/g, ' ').trim();
}

function formatVerbHelp(spec:VerbSpec, allowed:ReadonlySet<string>, catalog:readonly string[]):string {
	const help = spec.help ? docsFor(spec.help, spec.name, allowed, catalog) : '';
	if (spec.name === CHOOSE_VERB) {
		return help ? `${spec.name}(goal, name=arc, …) — ${help}` : `${spec.name}(goal, name=arc, …)`;
	}
	const parts = Object.entries(spec.args).map(([k, kind]) => {
		return kind.endsWith('?') ? `${k}?` : k;
	});
	const base = parts.length === 0 ? spec.name : `${spec.name}(${parts.join(', ')})`;
	return help ? `${base} — ${help}` : base;
}

export function verbHelp(registry:VerbRegistry, tools:readonly string[] = []):string {
	const catalog = [...registry.nested().list().map((spec) => spec.name), ...tools];
	const own = new Set([...registry.list().map((spec) => spec.name), ...tools]);
	const kit = registry.list().map((spec) => formatVerbHelp(spec, own, catalog)).join(', ');
	if (!registry.has('issue')) {
		return kit;
	}
	const nested = registry.nested();
	if (nested === registry) {
		return kit;
	}
	// Nested arcs may use the catalog. Their help may name those verbs, not a tool this think does not offer.
	const nestedAllowed = new Set([...nested.list().map((spec) => spec.name), ...tools]);
	// `choose` reaches a collective's characters only when its own kit grants it, so it is never a nested extra.
	const extras = nested.list()
		.filter((spec) => !registry.has(spec.name) && spec.name !== CHOOSE_VERB)
		.map((spec) => formatVerbHelp(spec, nestedAllowed, catalog));
	if (extras.length === 0) {
		return kit;
	}
	return `${kit}. Nested arc verbs: ${extras.join(', ')}`;
}
