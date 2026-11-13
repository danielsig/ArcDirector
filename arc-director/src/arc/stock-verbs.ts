import type { Step, StepArg } from './arc-types.js';
import { STOCK_COLLECTIVE_VERB_DEFS, type StockCollectiveVerb } from '../collective/collective-verbs.js';

/**
 * `id` is a character, thing or place; the host always receives a real id, even when the model wrote its own name for it
 * or an expression that picks one. `text` is prose: unquoted, it runs to the closing `)` or the next `, key=`.
 * `watch` is a watch-language expression; the host reads it through `VerbCall.holds` / `score`.
 * `expr` is any other expression (`units.filter("Archer")`), and `law` a law's name.
 * `bundle` is `{ [item: string]: number }` (how many of each thing). `count` is a whole number, or `true` for no limit.
 * A mind stores every `id`, `watch`, `expr`, `law` and `arc` arg in ids, and shows them to its model in its names. Bundle keys are item ids.
 */
export type VerbArgKind = 'id' | 'id?' | 'string' | 'string?' | 'text' | 'text?' | 'watch' | 'watch?' | 'expr' | 'expr?' | 'law' | 'law?' | 'number' | 'number?' | 'string[]' | 'string[]?' | 'bundle' | 'bundle?' | 'arc' | 'arc?' | 'hold' | 'hold?';

/** One arg of a verb: its kind. */
export type ArgSpec = { kind:VerbArgKind };

/** A kind without its optional mark: `id?` is `id`. */
export function argBase(kind:string | undefined):string {
	return kind?.endsWith('?') ? kind.slice(0, -1) : kind ?? '';
}

/** Whether a step may leave `arg` out. */
export function isOptional(arg:ArgSpec):boolean {
	return arg.kind.endsWith('?');
}

/**
 * Args the runtime gives every verb, so no verb declares them unless it reads them itself (`wander` steers by its
 * `until`): `until` stops the step once its watch holds, `within` once that many game seconds have passed.
 */
export const RUNTIME_ARGS:Readonly<Record<string, ArgSpec>> = { until: { kind: 'watch?' }, within: { kind: 'number?' } };

/** And to an endless verb: `unbreakable=10s` keeps it going that long whatever its reaction's trigger does. */
const ENDLESS_ARGS:Readonly<Record<string, ArgSpec>> = { ...RUNTIME_ARGS, unbreakable: { kind: 'hold?' } };

function runtimeArgs(spec:VerbSpec):Readonly<Record<string, ArgSpec>> {
	return spec.endless ? ENDLESS_ARGS : RUNTIME_ARGS;
}

/** What `key` is to the verb `spec`: one of its own args, or one the runtime gives it. */
export function argOf(spec:VerbSpec | undefined, key:string):ArgSpec | undefined {
	return spec && (spec.args[key] ?? (Object.hasOwn(runtimeArgs(spec), key) ? runtimeArgs(spec)[key] : undefined));
}

/** Every arg `spec` takes by key, in order, as its kind: its own, then the runtime's. */
export function argKinds(spec:VerbSpec):Record<string, VerbArgKind> {
	return Object.fromEntries([...Object.entries(spec.args), ...Object.entries(runtimeArgs(spec)).filter(([key]) => !(key in spec.args))].map(([key, arg]) => [key, arg.kind]));
}

/** The kind base ({@link argBase}) of `key` on `spec`, `''` when it has no such arg. */
export function argKind(spec:VerbSpec | undefined, key:string):string {
	return argBase(argOf(spec, key)?.kind);
}

/**
 * What one seen doing `verb` is doing, by default: `fire` firing, `stab` stabbing, `go_to` going to. A verb whose own
 * words say more gives them (`VerbDef.seen`).
 */
export function doingOf(verb:string):string {
	const [head, ...rest] = verb.split('_');
	const ing = /ie$/.test(head) ? `${head.slice(0, -2)}ying`
		: /[^aeiouy]e$/.test(head) && head.length > 2 ? `${head.slice(0, -1)}ing`
			// One short syllable ending in a lone vowel and a consonant doubles it: stab, stabbing.
			: /^[^aeiou]*[aeiou][^aeiouwxy]$/.test(head) ? `${head}${head.at(-1)}ing`
				: `${head}ing`;
	return [ing, ...rest].join(' ');
}

/** `text` with its `{arg}` holes filled from `args`, each shown by `show`; a hole with no such arg stays. */
export function fillHoles(text:string, args:Readonly<Record<string, StepArg>>, show:(value:string | number)=>string = String):string {
	return text.replace(/\{([A-Za-z_]\w*)\}/g, (hole, key:string) => {
		const value = args[key];
		return value === undefined ? hole : typeof value === 'string' || typeof value === 'number' ? show(value) : JSON.stringify(value);
	});
}

/** What one running `step` is doing, in its verb's own words from `verbs` (`going to Cottage`), names shown by `show`. */
export function stepDoing(step:Step, verbs:VerbRegistry, show:(id:string)=>string = String):string {
	const seen = verbs.get(step.verb)?.seen;
	return seen ? fillHoles(seen, step.args, (value) => (typeof value === 'string' ? show(value) : String(value))) : doingOf(step.verb);
}

/** The ids `step` is aimed at when its group arg ({@link VerbDef.group}) holds a list; none for a single name. */
export function groupTargets(step:Step, verbs:VerbRegistry):string[] | undefined {
	const key = verbs.get(step.verb)?.group;
	const value = key ? step.args[key] : undefined;
	return Array.isArray(value) ? value as string[] : undefined;
}

/** Kinds whose value is text, as a base ({@link argBase}): what `code=417` stays when written for one. */
export const TEXT_ARG_KINDS:readonly string[] = ['id', 'string', 'text', 'watch', 'expr', 'law'];

/** A verb's args as declared: each a kind, or an {@link ArgSpec}. */
export type VerbArgMap = Record<string, VerbArgKind | ArgSpec>;

/** A group, `( … )`, is the step `{ verb: 'group', args: { arc } }`. It is not a registered verb. */
export const GROUP_VERB = 'group';

/**
 * A statement that asks instead of acting, `isHurt(Mira)` or a name a `let` gave, is the step
 * `{ verb: 'test', args: { watch } }`: it succeeds while its watch holds. Every registry reads it; none lists it.
 */
export const TEST_VERB = 'test';

const TEST_SPEC:VerbSpec = { name: TEST_VERB, args: { watch: { kind: 'watch' } }, free: true };

/** `if (cond) { arc } else { else }`: its arcs are part of the program it is in, as a group's are. */
export const IF_VERB = 'if';

/** In an Arc's JSON a step is `{ let, verb, …args, then }`, so no arg may be called any of these. */
const RESERVED_ARGS:readonly string[] = ['verb', 'then', 'let'];

export type VerbSpec = {
	name:string;
	args:Record<string, ArgSpec>;
	/** One line shown after the verb in the prompt's verb list. */
	help?:string;
	/** This verb expects an answer from the character it names. After the arc, the actor waits for them if they are still nearby. Default: do not wait. */
	reply?:boolean;
	/** What one seen running it is doing, with `{arg}` holes: `going to {target}`. Default: the verb with `-ing` (`firing`). */
	seen?:string;
	/** It needs no body: an Arc of only such verbs runs beside the program under way, instead of replacing it. */
	free?:boolean;
	/** The `id` arg that may take several at once. See {@link VerbDef.group}. */
	group?:string;
	/** It has no end of its own. See {@link VerbDef.endless}. */
	endless?:boolean;
};

/** What `VerbRegistry.add` takes. */
export type VerbDef = {
	args?:VerbArgMap;
	help?:string;
	/** This verb expects an answer from the character it names. After the arc, the actor waits for them if they are still nearby. Default: do not wait. */
	reply?:boolean;
	/** What one seen running it is doing, with `{arg}` holes: `going to {target}`. Default: the verb with `-ing` (`firing`). */
	seen?:string;
	/** It needs no body: an Arc of only such verbs runs beside the program under way, instead of replacing it. */
	free?:boolean;
	/**
	 * The `id` arg that may take several at once: a name as ever, or an expression that picks a list (`units`,
	 * `others.nearby()`). For a list, the character first walks near the group (`withWorldVerbs` `groupWalk`) and then acts once, and the
	 * handler receives the ids as `string[]`, without the character itself or anyone down.
	 */
	group?:string;
	/**
	 * It has no end of its own (`follow`, `hold`): it runs until stopped. In a `when` or a law it is a loop's equal, and
	 * stops once the trigger is no longer true.
	 */
	endless?:boolean;
};

/** The verbs arcs may name: each one's args, help, and how others see it run. A director's own adds what runs each one. */
export class VerbRegistry {
	private readonly _verbs = new Map<string, VerbSpec>();

	/** Catalog used to parse nested `arc=` args. Kit views point at the unfiltered registry. */
	private _nestedSource:VerbRegistry | null = null;

	/**
	 * Verb `name`, unless it is here already: then only its `seen` changes, so a stock verb may say how others see it.
	 * `help` is the one line shown after the verb in the prompt's verb list.
	 */
	public add(name:string, def:VerbDef = {}):this {
		if (!this._verbs.has(name)) {
			this.define(name, def);
		}
		else if (def.seen) {
			this._verbs.set(name, { ...this._verbs.get(name)!, seen: def.seen });
		}
		this.changed();
		return this;
	}

	/** Schema only: the stock verbs `verbs` names, or all of them. Already-registered names are skipped. */
	public addStock(...verbs:StockVerb[]):this {
		return this.addAll(STOCK_VERB_DEFS, ...verbs);
	}

	/** Schema only: collective verbs (`command`, `tag`, formations); a kit still has to grant them. `when` / `law` / `unlaw` are stock arc verbs. */
	public addStockCollective(...verbs:StockCollectiveVerb[]):this {
		return this.addAll(STOCK_COLLECTIVE_VERB_DEFS, ...verbs);
	}

	/** Told after each change but a {@link redefine}. */
	protected changed():void {}

	private define(name:string, { args = {}, help, reply, seen, free, group, endless }:VerbDef):void {
		const specs = Object.fromEntries(Object.entries(args).map(([key, arg]) => [key, typeof arg === 'string' ? { kind: arg } : arg]));
		if (group && argBase(specs[group]?.kind) !== 'id') {
			throw new Error(`verb ${name}: group arg '${group}' is not an id arg`);
		}
		if (name === GROUP_VERB || name === TEST_VERB) {
			throw new Error(`verb ${name}: '${name}' is how an Arc writes ${name === GROUP_VERB ? '( … )' : 'a query as a step'}, not a verb`);
		}
		for (const key of Object.keys(args)) {
			if (key === 'x' || key === 'z' || key === 'y') {
				throw new Error(`verb ${name}: coordinate arg '${key}' is not allowed`);
			}
			if (RESERVED_ARGS.includes(key)) {
				throw new Error(`verb ${name}: arg '${key}' is reserved`);
			}
			const runtime = Object.hasOwn(RUNTIME_ARGS, key) ? RUNTIME_ARGS[key] : undefined;
			if (runtime && argBase(specs[key].kind) !== argBase(runtime.kind)) {
				throw new Error(`verb ${name}: arg '${key}' is the runtime's, a ${argBase(runtime.kind)}`);
			}
		}
		this._verbs.set(name, { name, args: specs, help, ...(reply ? { reply } : {}), ...(seen ? { seen } : {}), ...(free ? { free } : {}), ...(group ? { group } : {}), ...(endless ? { endless } : {}) });
	}

	/** Full catalog. Nested unit / loop / law arcs may name verbs this kit does not grant the thinker. */
	public nested():VerbRegistry {
		return this._nestedSource ?? this;
	}

	/**
	 * This view, its nested arcs limited to `allow`: what a collective's units can run, so its prompt lists those and
	 * its arcs name no verb none of them has.
	 */
	public nestedTo(allow:readonly string[]):VerbRegistry {
		const next = this.view(this.list().map((spec) => spec.name));
		next._nestedSource = this.nested().view(allow);
		return next;
	}

	/** Copy with `key` dropped from `verb` (solo `law` has no `who`). */
	public withoutArg(verb:string, key:string):VerbRegistry {
		const next = new VerbRegistry();
		next._nestedSource = this._nestedSource ?? this;
		for (const spec of this.list()) {
			if (spec.name !== verb) {
				next.define(spec.name, spec);
				continue;
			}
			const args = { ...spec.args };
			delete args[key];
			next.define(spec.name, { ...spec, args });
		}
		return next;
	}

	/** Change `name`'s definition where it stands in the list, so the prompt's verb order stays. */
	public redefine(name:string, def:VerbDef):this {
		if (!this._verbs.has(name)) {
			throw new Error(`verb not registered: ${name}`);
		}
		// Checked as a new verb would be; a Map keeps a key it sets again where it was.
		this._verbs.set(name, new VerbRegistry().add(name, def).get(name)!);
		return this;
	}

	/** Drop verbs. */
	public remove(...names:string[]):this {
		for (const name of names) {
			this._verbs.delete(name);
		}
		this.changed();
		return this;
	}

	/** Catalog names in `allow`, in catalog order. `null` / omit = this registry. */
	public view(allow?:readonly string[] | null):VerbRegistry {
		if (allow == null) {
			return this;
		}
		const wanted = new Set(allow);
		const next = new VerbRegistry();
		next._nestedSource = this._nestedSource ?? this;
		for (const spec of this.list()) {
			if (wanted.has(spec.name)) {
				next.define(spec.name, spec);
			}
		}
		return next;
	}

	public get(name:string):VerbSpec | undefined {
		return this._verbs.get(name) ?? (name === TEST_VERB ? TEST_SPEC : undefined);
	}

	public has(name:string):boolean {
		return this._verbs.has(name);
	}

	/**
	 * Schema only: adds each of `names` from a table of verbs (`STOCK_VERB_DEFS`, `STOCK_RTS_VERB_DEFS`, …), or the whole
	 * table when `names` is empty, in its order. Names already registered are skipped.
	 */
	public addAll<TDefs extends Readonly<Record<string, VerbDef>>>(defs:TDefs, ...names:(keyof TDefs & string)[]):this {
		for (const name of names.length > 0 ? names : Object.keys(defs)) {
			if (!Object.hasOwn(defs, name)) {
				throw new Error(`ArcDirector: '${name}' is not in that verb table`);
			}
			if (!this.has(name)) {
				this.define(name, defs[name]);
			}
		}
		this.changed();
		return this;
	}

	public list():VerbSpec[] {
		return [...this._verbs.values()];
	}
}

export const STOCK_MOVE_VERBS = ['go_to', 'follow', 'flee', 'wander'] as const;
export const STOCK_ITEM_VERBS = ['use', 'pick_up', 'drop', 'give', 'examine'] as const;
/** Registered with the rest; not in `STOCK_VERBS`, so a kit grants them only where there is trade. */
export const STOCK_TRADE_VERBS = ['offer'] as const;
/** Does nothing, and needs no body: the reply that keeps the program under way as it is. */
export const PASS_VERB = 'pass';
export const STOCK_MIND_VERBS = [
	'say', 'wait', PASS_VERB, 'remember', 'think', 'set_goal', 'drop_goal', 'finish_goal', 'set_identity',
	'watch', 'unwatch', 'focus', 'unfocus',
] as const;
/** Withheld when the mind's persona has `watchesWritable` / `sightFocusWritable` off, whatever the kit says. */
export const WATCH_EDIT_VERBS:readonly string[] = ['watch', 'unwatch'];
export const FOCUS_EDIT_VERBS:readonly string[] = ['focus', 'unfocus'];
/** Verbs only a mind can run: they call the model or shape its later prompts. A character without a mind never has them. */
export const MIND_ONLY_VERBS:readonly string[] = [
	PASS_VERB, 'think', 'remember', 'set_goal', 'drop_goal', 'finish_goal', 'set_identity', ...WATCH_EDIT_VERBS, ...FOCUS_EDIT_VERBS,
];
export const STOCK_ARC_VERBS = ['if', 'when', 'loop', 'law', 'unlaw'] as const;
/** A System One model picks one of its arcs. Withheld from any runner without a System One, whatever its kit says. */
export const CHOOSE_VERB = 'choose';
export const STOCK_VERBS = [...STOCK_MOVE_VERBS, ...STOCK_ITEM_VERBS, ...STOCK_MIND_VERBS, ...STOCK_ARC_VERBS, CHOOSE_VERB] as const;
export type StockVerb = (typeof STOCK_VERBS)[number] | (typeof STOCK_TRADE_VERBS)[number];

/** Every stock verb, in the order `VerbRegistry.addAll` registers them. */
export const STOCK_VERB_DEFS = {
	go_to: { args: { target: 'id' }, seen: 'going to {target}' },
	follow: { args: { target: 'id', distance: 'number?' }, help: 'stays within distance until your next arc', seen: 'following {target}', endless: true },
	flee: { args: { from: 'id', distance: 'number?' }, help: 'runs until clear of them for a few seconds; distance is how far counts as clear', seen: 'fleeing {from}' },
	wander: { args: { until: 'watch?', seconds: 'number?' } },
	use: { args: { item: 'id', target: 'id?' }, help: 'goes to the target first' },
	pick_up: { args: { item: 'id', from: 'id?' }, help: 'goes to it first; from: its container', seen: 'picking up {item}' },
	drop: { args: { item: 'id', to: 'id?' } },
	give: { args: { item: 'id', to: 'id', quantity: 'number?' }, help: 'goes to them first. to buy or sell, use offer', reply: true, seen: 'giving {item} to {to}' },
	examine: { args: { target: 'id' } },
	say: { args: { text: 'text', to: 'id?' }, help: 'one short sentence', reply: true, free: true, group: 'to' },
	wait: { args: { seconds: 'number?', until: 'watch?' }, help: 'until fails if not met within seconds (default 20)', free: true },
	pass: { args: {}, help: 'keeps your current program; reply pass() when nothing needs to change', free: true },
	remember: { args: { content: 'text', tags: 'string[]?' }, free: true },
	think: { args: { about: 'text?' }, free: true },
	set_goal: { args: { goal: 'text', priority: 'number?' }, seen: 'thinking', free: true },
	drop_goal: { args: { goal: 'text?' }, seen: 'thinking', free: true },
	finish_goal: { args: { goal: 'text?' }, help: 'it is done', seen: 'thinking', free: true },
	set_identity: { args: { role: 'string?', traits: 'string[]?' }, seen: 'thinking', free: true },
	watch: { args: { name: 'string', expr: 'expr' }, free: true },
	unwatch: { args: { name: 'string' }, free: true },
	focus: { args: { expr: 'expr' }, free: true },
	unfocus: { args: { expr: 'expr' }, free: true },
	if: { args: { cond: 'arc', arc: 'arc', else: 'arc?' } },
	when: { args: { watch: 'watch', arc: 'arc', times: 'number?', until: 'watch?', rearm: 'number?' }, help: `this job's interrupt from where it is written; no extra think` },
	loop: { args: { arc: 'arc', through: 'watch?', until: 'watch?', times: 'number?', unbreakable: 'hold?' }, help: 'repeats until a round fails. In a when or law, it stops once the trigger is false; unbreakable=true goes on to its end, unbreakable=N for N rounds first, unbreakable=10s for 10s (on follow too)' },
	law: { args: { who: 'expr?', watch: 'watch', arc: 'arc', name: 'law?', times: 'number?', until: 'watch?', rearm: 'number?' }, help: 'standing reaction until unlaw; no extra think', free: true },
	unlaw: { args: { name: 'law' }, help: 'drops that law', free: true },
	// Its choices are named args of their own; `arc/choose.ts` reads them.
	choose: { args: { goal: 'text' }, help: 'a fast model picks one by name each run; loop it to keep picking' },
	offer: { args: { to: 'id?', give: 'bundle?', get: 'bundle?' }, help: 'goes to them first if out of earshot. each side as {"Egg":12, "Milk":3}, items and gold only. if they offer that or better, both move at once; else it waits for their answer. no to: offered to anyone', reply: true },
} as const satisfies Record<StockVerb, VerbDef>;
