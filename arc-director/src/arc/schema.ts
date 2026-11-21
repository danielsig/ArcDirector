import type { JsonSchema } from '../json.js';
import { namesWord } from '../text.js';
import { JOINS } from './arc-types.js';
import { STOCK_COLLECTIVE_VERB_DEFS } from '../collective/collective-verbs.js';
import { argBase, argKinds, CHOOSE_VERB, IF_VERB, isOptional, GROUP_VERB, STOCK_VERB_DEFS, TEST_VERB, type VerbArgKind, type VerbDef, type VerbRegistry, type VerbSpec, WHILE_ARG } from './stock-verbs.js';
import { DEFAULT_EXPLICIT_THINK_ALLOWED_INSIDE, placesHelp } from './validate.js';
import { constraintAt, constraintHelp, insideOf, narrowsAt, within, type ArgConstraint, type ArgPath } from './constraints.js';

function ref(name:string):JsonSchema {
	return { $ref: `#/$defs/${name}` };
}

/** The schema of one arg by its kind and constraint `c` (not its `custom` rules), on an `endless` verb or not. An arc is `arc`, its defs. */
function argSchema(kind:VerbArgKind, c:ArgConstraint, arc:JsonSchema, endless?:boolean):JsonSchema {
	const base = argBase(kind);
	if (base === 'arc') {
		return arc;
	}
	if (base === 'number') {
		return { type: c.integer ? 'integer' : 'number', ...(c.min === undefined ? {} : { minimum: c.min }), ...(c.max === undefined ? {} : { maximum: c.max }) };
	}
	// True, rounds or seconds; an endless verb is unbreakable for seconds only.
	if (base === 'duration') {
		return endless ? { type: 'string' } : { anyOf: [{ const: true }, { type: 'integer', minimum: 0 }, { type: 'string' }] };
	}
	if (base === 'bool') {
		return { type: 'boolean' };
	}
	if (base === 'string[]') {
		return { type: 'array', items: { type: 'string' } };
	}
	if (base === 'bundle') {
		return { type: 'object', additionalProperties: { type: 'number' } };
	}
	return c.names ? { type: 'string', enum: [...c.names] } : { type: 'string' };
}

/**
 * Last in every step, so a grammar writes the step's own args before how it joins the next. By reference, as every
 * step has it: written out in each, it cost the schema a tenth of its length.
 */
const THEN:JsonSchema = ref('then');

/** `let name = step`, first in a step as in Arc text. */
const LET:JsonSchema = { type: 'string' };

/** The schema of the arc held where `path` says (none: the root's), directly in the arc arg `here`, by reference. */
type ArcRef = (path?:ArgPath, here?:ArgPath)=>JsonSchema;

/**
 * One step of one verb written `at` an arc arg: `verb` is that verb's name and comes first, its args follow in the order
 * the verb lists them.
 */
function verbStep(spec:VerbSpec, at:ArgPath | undefined, arcRef:ArcRef):JsonSchema {
	if (spec.name === CHOOSE_VERB) {
		return {
			type: 'object',
			additionalProperties: false,
			required: ['verb', 'goal', 'choices'],
			properties: {
				let: LET,
				verb: { const: CHOOSE_VERB },
				goal: { type: 'string' },
				choices: { type: 'object', additionalProperties: arcRef(`${CHOOSE_VERB}.arc`, `${CHOOSE_VERB}.arc`) },
				then: THEN,
			},
		};
	}
	const kinds = Object.entries(argKinds(spec));
	const argSchemaOf = (key:string, kind:VerbArgKind):JsonSchema => {
		const c = constraintAt(spec, key, at);
		return Object.assign(argSchema(kind, c, arcRef(spec.name === IF_VERB || key === WHILE_ARG ? at : `${spec.name}.${key}`, `${spec.name}.${key}`), spec.endless), ...(c.custom ?? []).map((rule) => rule.schema));
	};
	return {
		type: 'object',
		additionalProperties: false,
		required: ['verb', ...kinds.filter(([, kind]) => !kind.endsWith('?')).map(([key]) => key)],
		properties: {
			let: LET,
			verb: { const: spec.name },
			...Object.fromEntries(kinds.map(([key, kind]) => [key, argSchemaOf(key, kind)])),
			then: THEN,
		},
	};
}

function groupStep(arc:JsonSchema):JsonSchema {
	return {
		type: 'object',
		additionalProperties: false,
		required: ['verb', 'arc'],
		properties: { let: LET, verb: { const: GROUP_VERB }, arc, then: THEN },
	};
}

/** The args of `spec` whose arcs are a place of their own: none of an `if`'s (they are where it is), a choice as `arc`. */
function arcKeys(spec:VerbSpec):string[] {
	return spec.name === IF_VERB ? [] : spec.name === CHOOSE_VERB ? ['arc'] : Object.keys(spec.args).filter((key) => argBase(spec.args[key].kind) === 'arc');
}

const TEST_STEP:JsonSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['verb', 'watch'],
	properties: { let: LET, verb: { const: TEST_VERB }, watch: { type: 'string' }, then: THEN },
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
 * `$defs`, so any depth costs the same few kilobytes. `command` is a step of the reply's own root only, never of a nested
 * arc, so a grammar cannot write one inside a loop or a law. An arc arg that constraints narrow (`law.arc`) has defs of
 * its own (`arc_in_law`, `step_in_law`). `think` is a step only of the arcs `explicitThinkAllowedInside` lists (`if.arc`): each has a def
 * of its own (`arc_think`, `arc_in_law_think`). It accepts all the validator does, and may accept more
 * (`depth`, `syntax`): a def per level of nesting would cost the steps' def again for each, so how deep an Arc nests
 * (`MAX_ARC_DEPTH`) is the validator's to check, and `replyBreakdown`'s to stop as it is written.
 */
export function replySchema(catalog:VerbRegistry, tools:Record<string, JsonSchema> = {}, explicitThinkAllowedInside = DEFAULT_EXPLICIT_THINK_ALLOWED_INSIDE):JsonSchema {
	const command = catalog.list().find((spec) => spec.name === 'command');
	const places = new Map<ArgPath, ArgConstraint>();
	for (const spec of catalog.list()) {
		for (const key of arcKeys(spec)) {
			const path:ArgPath = `${spec.name}.${key}`;
			const c = constraintAt(spec, key);
			if (c.subverbs || c.not || c.maxSteps !== undefined || narrowsAt(catalog.list(), path)) {
				places.set(path, c);
			}
		}
	}
	const nameOf = (path:ArgPath):string => path.replace(/\.arc$/, '').replace('.', '_');
	const allows = (spec:VerbSpec, { subverbs, not }:ArgConstraint):boolean => (subverbs?.includes(spec.name) ?? true) && !not?.includes(spec.name);
	const defs:Record<string, JsonSchema> = {};
	const think = catalog.get('think');
	const arcRef:ArcRef = (path, here) => {
		const c = (path && places.get(path)) || {};
		const base = path && places.has(path) ? `arc_in_${nameOf(path)}` : 'arc';
		if (!think || !within(explicitThinkAllowedInside, here) || !allows(think, c)) {
			return ref(base);
		}
		defs[`${base}_think`] ??= { type: 'array', minItems: 1, ...(c.maxSteps === undefined ? {} : { maxItems: c.maxSteps }), items: { anyOf: [ref(base.replace(/^arc/, 'step')), verbStep(think, path, arcRef)] } };
		return ref(`${base}_think`);
	};
	const stepAt = (at?:ArgPath, c:ArgConstraint = {}):JsonSchema => ({
		anyOf: [
			...catalog.list().filter((spec) => spec !== command && spec !== think && allows(spec, c)).map((spec) => verbStep(spec, at, arcRef)),
			groupStep(arcRef(at)),
			TEST_STEP,
		],
	});
	const steps:JsonSchema = {
		type: 'object',
		additionalProperties: false,
		required: ['steps'],
		properties: { steps: command ? { type: 'array', minItems: 1, items: { anyOf: [verbStep(command, undefined, arcRef), ref('step')] } } : ref('arc') },
	};
	defs.then = { type: 'string', enum: [...JOINS] };
	defs.arc = { type: 'array', minItems: 1, items: ref('step') };
	defs.step = stepAt();
	for (const [path, c] of places) {
		defs[`arc_in_${nameOf(path)}`] = { type: 'array', minItems: 1, ...(c.maxSteps === undefined ? {} : { maxItems: c.maxSteps }), items: ref(`step_in_${nameOf(path)}`) };
		defs[`step_in_${nameOf(path)}`] = stepAt(path, c);
	}
	const calls = Object.entries(tools).map(([name, parameters]) => toolReply(name, parameters));
	return calls.length === 0 ? { ...steps, $defs: defs } : { anyOf: [...calls, steps], $defs: defs };
}

/** Built-in tools a help line might name. A line may name one only when this think offers it. */
const DOC_TOOLS = ['recall', 'observe', 'earshot', 'see_map'];

/** Whether `piece` names a verb or tool other than `self` that `allowed` does not grant. */
function mentionsUnavailable(piece:string, self:string, allowed:ReadonlySet<string>, names:readonly string[]):boolean {
	for (const name of names) {
		if (name === self || allowed.has(name)) {
			continue;
		}
		if (namesWord(piece, name)) {
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

/** What constraints say of `spec`'s args, in its help line: `seconds at most 10 inside a law`. Only verbs in `allowed` are named. */
function constraintsHelp(spec:VerbSpec, allowed:ReadonlySet<string>):string {
	const shown = (verbs:readonly string[]):string[] => verbs.filter((verb) => allowed.has(verb));
	const inside = Object.entries(spec.whenInside ?? {}).filter(([path]) => path.startsWith('*.') || allowed.has(path.slice(0, path.indexOf('.'))));
	return [
		...Object.entries(spec.args).map(([key, c]) => constraintHelp(key, c, shown)),
		...inside.flatMap(([path, args]) => Object.entries(args).map(([key, c]) => constraintHelp(key, c, shown)).filter(Boolean).map((text) => `${text} ${insideOf(path)}`)),
	].filter(Boolean).join('; ');
}

/** `spec`'s line in the verb list; `think`'s says where it goes, `explicitThinkAllowedInside`. */
function formatVerbHelp(spec:VerbSpec, allowed:ReadonlySet<string>, catalog:readonly string[], stockHelp:boolean, explicitThinkAllowedInside:readonly ArgPath[]):string {
	const docs = spec.help && (stockHelp || !isStockHelp(spec)) ? docsFor(spec.help, spec.name, allowed, catalog) : '';
	const help = [spec.name === 'think' && placesHelp(explicitThinkAllowedInside, allowed), docs, constraintsHelp(spec, allowed)].filter(Boolean).join('; ');
	if (spec.name === CHOOSE_VERB) {
		return help ? `${spec.name}(goal, name=arc, …) — ${help}` : `${spec.name}(goal, name=arc, …)`;
	}
	const parts = Object.entries(spec.args).map(([k, arg]) => (isOptional(arg) ? `${k}?` : k));
	const base = parts.length === 0 ? spec.name : `${spec.name}(${parts.join(', ')})`;
	return help ? `${base} — ${help}` : base;
}

/** Whether `spec`'s help is the library's own for that verb, which a model trained on ArcDirector's prompts knows. */
function isStockHelp(spec:VerbSpec):boolean {
	const stock:Record<string, VerbDef> = { ...STOCK_VERB_DEFS, ...STOCK_COLLECTIVE_VERB_DEFS };
	return spec.help === stock[spec.name]?.help;
}

/**
 * Every verb of `registry` with its args and help, and in a collective the verbs its nested arcs may use. Without
 * `stockHelp`, a stock verb's own help is left out: a compact prompt keeps only what this game says.
 */
export function verbHelp(registry:VerbRegistry, tools:readonly string[] = [], { stockHelp = true, explicitThinkAllowedInside = DEFAULT_EXPLICIT_THINK_ALLOWED_INSIDE }:{ stockHelp?:boolean; explicitThinkAllowedInside?:readonly ArgPath[] } = {}):string {
	const catalog = [...registry.nested().list().map((spec) => spec.name), ...tools];
	const own = new Set([...registry.list().map((spec) => spec.name), ...tools]);
	const kit = registry.list().map((spec) => formatVerbHelp(spec, own, catalog, stockHelp, explicitThinkAllowedInside)).join(', ');
	if (!registry.has('command')) {
		return kit;
	}
	const nested = registry.nested();
	if (nested === registry) {
		return kit;
	}
	// Nested arcs may use the catalog. Their help may name those verbs, not a tool this think does not offer.
	const nestedAllowed = new Set([...nested.list().map((spec) => spec.name).filter((name) => name !== CHOOSE_VERB), ...tools]);
	// `choose` reaches a collective's characters only when its own kit grants it, so it is never a nested extra.
	const extras = nested.list()
		.filter((spec) => !registry.has(spec.name) && spec.name !== CHOOSE_VERB)
		.map((spec) => formatVerbHelp(spec, nestedAllowed, catalog, stockHelp, explicitThinkAllowedInside));
	if (extras.length === 0) {
		return kit;
	}
	return `${kit}. Nested arc verbs: ${extras.join(', ')}`;
}
