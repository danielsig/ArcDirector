import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArcText } from './arc/arc-parse.js';
import { formatArc } from './arc/arc-format.js';
import type { ArcResult } from './arc/arc-types.js';
import type { ArgConstraint, ArgPath } from './arc/constraints.js';
import { runArc } from './arc/arc-machine.js';
import { replySchema } from './arc/schema.js';
import { STOCK_VERB_DEFS, VerbRegistry } from './arc/stock-verbs.js';
import { validateArc } from './arc/validate.js';
import { arcJSONText, parseArc } from './arc/wire.js';
import { STOCK_COLLECTIVE_VERB_DEFS } from './collective/collective-verbs.js';
import { buildCatalog, dummyEntity, evaluate, SampleCache, stringifyVal, watchScore, type ExprEntity, type ExprVal } from './expr/index.js';
import type { CatalogInputs } from './expr/natives.js';

/**
 * The conformance corpus: what the arc text, its JSON, the watch language, verb constraints and the runner mean, as
 * JSON files every port (C#, C++) loads and must reproduce exactly. Each file holds its rows' inputs and what they
 * give; a row is added by writing its inputs, and `UPDATE_SNAPSHOTS=1` fills in the rest (after a look at what
 * changed). Prompts are pinned beside it, in `prompt-snapshots/`. The files sit beside this file's source.
 */
const CORPUS = fileURLToPath(new URL('../src/conformance/', import.meta.url));
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

type Rows<TIn, TOut> = { about:string; rows:(TIn & Partial<TOut>)[] } & Record<string, unknown>;

/** Every row of `name` checked against what `give` makes of its inputs now; with `UPDATE_SNAPSHOTS=1`, rewritten. */
async function corpus<TIn extends object, TOut extends object>(name:string, give:(row:TIn, file:Rows<TIn, TOut>)=>Partial<TOut> | Promise<Partial<TOut>>, inputs:(keyof TIn)[]):Promise<void> {
	const path = `${CORPUS}${name}.json`;
	const file = JSON.parse(readFileSync(path, 'utf8')) as Rows<TIn, TOut>;
	const rows = await Promise.all(file.rows.map(async (row) => {
		const input = Object.fromEntries(inputs.filter((key) => key in row).map((key) => [key, row[key]])) as TIn;
		return { ...input, ...JSON.parse(JSON.stringify(await give(input, file))) as Partial<TOut> };
	}));
	if (UPDATE) {
		writeFileSync(path, `${JSON.stringify({ ...file, rows }, null, '\t')}\n`);
		return;
	}
	rows.forEach((row, i) => assert.deepEqual(row, file.rows[i], `${name} row ${i + 1}: ${JSON.stringify(Object.values(row)[0])}`));
}

/** What a corpus file's verbs are: the stock verbs and a collective's, with the row's constraints. */
function verbs(constrain:Constrain = []):VerbRegistry {
	const registry = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);
	for (const [verb, arg, constraint, path] of constrain) {
		registry.constrain(verb, arg, constraint, path);
	}
	return registry;
}

type Constrain = [verb:string, arg:string, constraint:ArgConstraint, path?:ArgPath][];

/** Why `fn` threw, or nothing. */
function problem(fn:()=>void):string | undefined {
	try {
		fn();
		return undefined;
	}
	catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}

/** The watch language's world in `exprs.json`: entities by id, where they stand on `[x, z]`, and what they hold. */
type ExprWorld = {
	me:string;
	others:string[];
	items:string[];
	entities:Record<string, { point?:[number, number]; tags?:string[]; hp?:[number, number]; carries?:string[]; open?:boolean }>;
	bindings:string[];
	events:string[];
	nearRadius:number;
	sightRange:number;
};

/** `world` as the watch language's kernels: distance on the ground, sight within its range, facing everyone. */
function kernelsOf(world:ExprWorld):CatalogInputs {
	const made = new Map<string, ExprEntity>();
	const entity = (id:string):ExprEntity => made.get(id) ?? made.set(id, dummyEntity(id, { tags: world.entities[id]?.tags ?? [] })).get(id)!;
	const at = (e:ExprEntity):[number, number] => world.entities[e.id]?.point ?? [0, 0];
	const distance = (a:ExprEntity, b:ExprEntity):number => Math.hypot(at(a)[0] - at(b)[0], at(a)[1] - at(b)[1]);
	const rows = world.entities;
	return {
		me: entity(world.me),
		others: world.others.map(entity),
		items: world.items.map(entity),
		cache: new SampleCache(),
		nearRadius: world.nearRadius,
		distance,
		canSee: (a, b) => distance(a, b) < world.sightRange,
		facing: () => 1,
		inventory: (who) => (rows[who.id]?.carries ?? []).map(entity),
		hp: (who) => (rows[who.id]?.hp ? { hp: rows[who.id].hp![0], maxHP: rows[who.id].hp![1] } : undefined),
		isOpen: (who) => !!rows[who.id]?.open,
		hasHeard: false,
		bindings: {
			...Object.fromEntries(world.bindings.map((id) => [id, { kind: 'entity', value: entity(id) } satisfies ExprVal])),
			events: { kind: 'list', value: world.events.map((id) => ({ kind: 'entity', value: entity(id) })) },
		},
	};
}

describe('conformance corpus', () => {
	it('arcs: what arc text parses to, prints back as, and writes as JSON, or why it is refused', async () => {
		const registry = verbs();
		await corpus<{ text:string }, { arc:unknown; back:string; json:string; error:string }>('arcs', ({ text }) => {
			try {
				const arc = parseArcText(text, registry);
				const json = arcJSONText(arc, registry);
				assert.deepEqual(parseArc(json, registry), arc, `${text}: its JSON reads back as itself`);
				return { arc, back: formatArc(arc, registry), json };
			}
			catch (err) {
				return { error: err instanceof Error ? err.message : String(err) };
			}
		}, ['text']);
	});

	it('constraints: what a narrowed verb refuses in an arc', async () => {
		await corpus<{ constrain:Constrain; text:string }, { problem:string }>('constraints', ({ constrain, text }) => {
			const registry = verbs(constrain);
			const why = problem(() => validateArc(parseArcText(text, registry), registry));
			return why ? { problem: why } : {};
		}, ['constrain', 'text']);
	});

	it('schemas: the reply schema for the stock verbs, with each row\'s constraints', async () => {
		await corpus<{ constrain:Constrain }, { schema:unknown }>('schemas', ({ constrain }) => ({ schema: replySchema(verbs(constrain)) }), ['constrain']);
	});

	it('exprs: what a watch expression is worth in a fixed world, and its truth score, or why it is refused', async () => {
		await corpus<{ expr:string }, { value:string; score:number; error:string }>('exprs', ({ expr }, file) => {
			const catalog = buildCatalog(kernelsOf(file.world as ExprWorld));
			const result = evaluate(expr, catalog);
			return result.error
				? { error: result.error.message }
				: { value: stringifyVal(result.value, catalog), score: Math.round(watchScore(result.value).score * 1000) / 1000 };
		}, ['expr']);
	});

	it('runs: which steps an arc runs, and how it ends, when the verbs listed fail and every other one works', async () => {
		const registry = verbs();
		await corpus<{ text:string; failing?:string[] }, { ran:string[]; status:ArcResult['status'] }>('runs', async ({ text, failing = [] }) => {
			const ran:string[] = [];
			const result = await runArc(parseArcText(text, registry), async (step) => {
				ran.push(step.verb);
				return failing.includes(step.verb) ? { status: 'failed', verb: step.verb, reason: 'no' } : { status: 'ok', verb: step.verb };
			});
			return { ran, status: result.status };
		}, ['text', 'failing']);
	});
});
