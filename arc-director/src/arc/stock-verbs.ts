import type { Step, StepArg } from './arc-types.js';
import { STOCK_COLLECTIVE_VERB_DEFS, type StockCollectiveVerb } from '../collective/collective-verbs.js';
import { meet, type ArgConstraint, type ArgPath } from './constraints.js';
import { SayTone } from '../mind/talk.js';

/**
 * `id` is a character, thing or place; the host always receives a real id, even when the model wrote its own name for it
 * or an expression that picks one. `text` is prose: unquoted, it runs to the closing `)` or the next `, key=`.
 * `watch` is a watch-language expression; the host reads it through `VerbCall.holds` / `score`.
 * `expr` is any other expression (`units.filter("Archer")`), and `law` a law's name.
 * `bundle` is `{ [item: string]: number }` (how many of each thing). `count` is a whole number, or `true` for no limit.
 * `bool` is `true` or `false`.
 * A mind stores every `id`, `watch`, `expr`, `law` and `arc` arg in ids, and shows them to its model in its names. Bundle keys are item ids.
 */
export type VerbArgKind = 'id' | 'id?' | 'string' | 'string?' | 'text' | 'text?' | 'watch' | 'watch?' | 'expr' | 'expr?' | 'law' | 'law?' | 'number' | 'number?' | 'string[]' | 'string[]?' | 'bundle' | 'bundle?' | 'arc' | 'arc?' | 'hold' | 'hold?' | 'bool' | 'bool?';

/**
 * One arg of a verb: its kind, and what it may hold beyond that. `ignoreUnknown`: an `id` that names nothing is no fault
 * of the reply; the verb does without it and says so (`pick_up`'s `from`).
 */
export type ArgSpec = { kind:VerbArgKind; ignoreUnknown?:boolean } & ArgConstraint;

/** Each arg of a verb, narrowed where the verb is written inside another verb's arc: `{ 'law.arc': { seconds: { max: 10 } } }`. */
export type WhenInside = Readonly<Record<ArgPath, Readonly<Record<string, ArgConstraint>>>>;

/** A kind without its optional mark: `id?` is `id`. */
export function argBase(kind:string | undefined):string {
	return kind?.endsWith('?') ? kind.slice(0, -1) : kind ?? '';
}

/** Whether a step may leave `arg` out. */
export function isOptional(arg:ArgSpec):boolean {
	return arg.kind.endsWith('?');
}

/**
 * The arc arg every verb takes for what runs during it, `go_to(Well) while say("Follow me")`: its steps start with the
 * verb's, and the step ends once both have (`arc-machine.ts` `ParallelFrame`).
 */
export const WHILE_ARG = 'while';

/**
 * Args the runtime gives every verb, so no verb declares them unless it reads them itself (`wander` steers by its
 * `until`): `until` stops the step once its watch holds, `within` once that many game seconds have passed, and
 * {@link WHILE_ARG} runs during it.
 */
export const RUNTIME_ARGS:Readonly<Record<string, ArgSpec>> = { until: { kind: 'watch?' }, within: { kind: 'number?' }, [WHILE_ARG]: { kind: 'arc?' } };

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

/** The channel `spec` holds while it runs: `body` unless it says. */
export function channelOf(spec:Pick<VerbDef, 'channel'> | undefined):string {
	return spec?.channel ?? 'body';
}

/** How much a step of `spec` changes the world ({@link VerbDef.impact}). A step no registry lists (a group) adds none. */
export function impactOf(spec:VerbSpec | undefined):number {
	return !spec ? 0 : spec.impact ?? (spec.endless ? 0.1 : channelOf(spec) === '' ? 0 : 0.5);
}

/** Whether `verb` runs without the body: free, beside a program under way. `when` only sets a reaction. */
export function isFree(verbs:VerbRegistry, verb:string):boolean {
	return verb === 'when' || (!!verbs.get(verb) && channelOf(verbs.get(verb)) !== 'body');
}

const TEST_SPEC:VerbSpec = { name: TEST_VERB, args: { watch: { kind: 'watch' } }, channel: '' };

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
	/** The channel it holds while it runs. See {@link VerbDef.channel}. */
	channel?:string;
	/** The `id` arg that may take several at once. See {@link VerbDef.group}. */
	group?:string;
	/** It has no end of its own. See {@link VerbDef.endless}. */
	endless?:boolean;
	/** See {@link VerbDef.impact}. */
	impact?:number;
	/** See {@link VerbDef.whenInside}. */
	whenInside?:WhenInside;
	/** See {@link VerbDef.cooldown}. */
	cooldown?:number;
};

/** What `VerbRegistry.add` takes. */
export type VerbDef = {
	args?:VerbArgMap;
	help?:string;
	/** This verb expects an answer from the character it names. After the arc, the actor waits for them if they are still nearby. Default: do not wait. */
	reply?:boolean;
	/** What one seen running it is doing, with `{arg}` holes: `going to {target}`. Default: the verb with `-ing` (`firing`). */
	seen?:string;
	/**
	 * The channel it holds while it runs: `body` (default: moving, fighting, using things), `voice` (`say`), one the game
	 * adds (`hands`, to drink while walking), or `''` for none (it ends at once: `remember`, `law`). A verb that
	 * holds no body is free: an Arc of only such verbs runs beside the program under way, instead of replacing it. Steps
	 * that run at once (`A while B`) take turns on a channel: one waits while another holds it.
	 */
	channel?:string;
	/**
	 * The `id` arg that may take several at once: a name as ever, or an expression that picks a list (`units`,
	 * `others.nearby()`). For a list, the character first walks near the group (`withWorldVerbs` `groupWalk`) and then acts once, and the
	 * handler receives the ids as `string[]`, without the character itself or anyone fallen.
	 */
	group?:string;
	/**
	 * It has no end of its own (`follow`, `hold`): it runs until stopped. In a `when` or a law it is a loop's equal, and
	 * stops once the trigger is no longer true.
	 */
	endless?:boolean;
	/**
	 * How much a step of it changes the world, 0–1: how unsafe it is to replace that step mid-run. A rethink may wake a
	 * mind only while what remains of its program has little impact (`rethinkingThreshold`), and an Arc whose steps had
	 * much brings a think at once (`retrospectThreshold`). Default ({@link impactOf}): 0.1 for an endless verb, 0 for one
	 * that ends at once (`channel: ''`), else 0.5.
	 */
	impact?:number;
	/** Its args, narrowed further where it is written inside the arc arg a key names (the nearest enclosing one; `*.arc`, any). */
	whenInside?:WhenInside;
	/**
	 * Game seconds each character waits after it ran this verb before it may again; a kit's `cooldowns` wins. A step on
	 * it sooner fails, saying how long is left; `isReady(me, verb)` reads it, and `choose` leaves out a choice it begins.
	 */
	cooldown?:number;
};

/** The verbs arcs may name: each one's args, help, and how others see it run. A director's own adds what runs each one. */
export class VerbRegistry {
	private readonly _verbs = new Map<string, VerbSpec>();

	/** Catalog used to parse nested `arc=` args. Kit views point at the unfiltered registry. */
	private _nestedSource:VerbRegistry | null = null;

	/**
	 * Verb `name`, unless it is here already: then only its `seen` and `impact` change, so a stock verb may say how
	 * others see it and how much it changes the world. `help` is the one line shown after the verb in the prompt's verb list.
	 */
	public add(name:string, def:VerbDef = {}):this {
		if (!this._verbs.has(name)) {
			this.define(name, def);
		}
		else {
			const { seen, impact } = def;
			this._verbs.set(name, { ...this._verbs.get(name)!, ...(seen ? { seen } : {}), ...(impact !== undefined ? { impact } : {}) });
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

	/**
	 * Narrows what `verb`'s `arg` may hold, everywhere, or with `path` only where the verb is written inside that arc:
	 * `constrain('wait', 'seconds', { max: 10 }, 'law.arc')`. Constraints only narrow, so no call loosens another.
	 */
	public constrain(verb:string, arg:string, constraint:ArgConstraint, path?:ArgPath):this {
		const spec = this._verbs.get(verb);
		const own = spec?.args[arg];
		if (!spec || !(own ?? (path && argOf(spec, arg)))) {
			throw new Error(`verb ${verb}: no arg '${arg}' to constrain`);
		}
		const inside = path && spec.whenInside?.[path];
		this._verbs.set(verb, path
			? { ...spec, whenInside: { ...spec.whenInside, [path]: { ...inside, [arg]: meet(inside?.[arg] ?? {}, constraint) } } }
			: { ...spec, args: { ...spec.args, [arg]: meet(own!, constraint) } });
		this.changed();
		return this;
	}

	private define(name:string, { args = {}, help, reply, seen, channel, group, endless, impact, whenInside, cooldown }:VerbDef):void {
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
		this._verbs.set(name, { name, args: specs, help, ...(reply ? { reply } : {}), ...(seen ? { seen } : {}), ...(channel !== undefined ? { channel } : {}), ...(group ? { group } : {}), ...(endless ? { endless } : {}), ...(impact !== undefined ? { impact } : {}), ...(whenInside ? { whenInside } : {}), ...(cooldown ? { cooldown } : {}) });
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

	/** Each character waits `seconds` after it ran `name` before it may again ({@link VerbDef.cooldown}); 0 for no wait. */
	public cooldown(name:string, seconds:number):this {
		return this.redefine(name, { ...this.get(name), cooldown: seconds });
	}

	/** `name`'s `arg` takes only `names`, in its help and reply schema alike, where it has that arg. */
	public argNames(name:string, arg:string, names:readonly string[]):this {
		const def = this.get(name);
		return def?.args[arg] ? this.redefine(name, { ...def, args: { ...def.args, [arg]: { ...def.args[arg], names: [...names] } } }) : this;
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

	/** `name`'s spec in this view, else in its nested catalog ({@link nested}): any verb an arc it writes may name. */
	public find(name:string):VerbSpec | undefined {
		return this.get(name) ?? this.nested().get(name);
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
/** `instead { … }` at a reply's root: its steps replace the writer's own program under way (`insteadOf`). */
export const INSTEAD_VERB = 'instead';
export const STOCK_MIND_VERBS = [
	'say', 'wait', PASS_VERB, INSTEAD_VERB, 'remember', 'think', 'set_goal', 'drop_goal', 'finish_goal', 'set_identity',
	'watch', 'unwatch', 'focus', 'unfocus',
] as const;
/** Withheld when the mind's persona has `watchesWritable` / `sightFocusWritable` off, whatever the kit says. */
export const WATCH_EDIT_VERBS:readonly string[] = ['watch', 'unwatch'];
export const FOCUS_EDIT_VERBS:readonly string[] = ['focus', 'unfocus'];
/** Verbs only a mind can run: they call the model or shape its later prompts. A character without a mind never has them. */
export const MIND_ONLY_VERBS:readonly string[] = [
	PASS_VERB, INSTEAD_VERB, 'think', 'remember', 'set_goal', 'drop_goal', 'finish_goal', 'set_identity', ...WATCH_EDIT_VERBS, ...FOCUS_EDIT_VERBS,
];
export const STOCK_ARC_VERBS = ['if', 'when', 'loop', 'law', 'unlaw'] as const;
/** A System One model picks one of its arcs. Withheld from any runner without a System One, whatever its kit says. */
export const CHOOSE_VERB = 'choose';
export const STOCK_VERBS = [...STOCK_MOVE_VERBS, ...STOCK_ITEM_VERBS, ...STOCK_MIND_VERBS, ...STOCK_ARC_VERBS, CHOOSE_VERB] as const;
export type StockVerb = (typeof STOCK_VERBS)[number] | (typeof STOCK_TRADE_VERBS)[number];

/** Every stock verb, in the order `VerbRegistry.addAll` registers them. */
export const STOCK_VERB_DEFS = {
	go_to: { args: { target: 'id' }, seen: 'going to {target}', impact: 0.3 },
	follow: { args: { target: 'id', distance: 'number?' }, help: 'stays within distance until your next arc', seen: 'following {target}', endless: true },
	flee: { args: { from: 'id', distance: 'number?' }, help: 'runs until clear of them for a few seconds; distance is how far counts as clear', seen: 'fleeing {from}', impact: 0.9 },
	wander: { args: { until: 'watch?', seconds: 'number?' }, impact: 0.1 },
	use: { args: { item: 'id', target: 'id?' }, help: 'goes to the target first', impact: 0.8 },
	pick_up: { args: { item: 'id', from: { kind: 'id?', ignoreUnknown: true } }, help: 'goes to it first; from: its container', seen: 'picking up {item}', impact: 0.8 },
	drop: { args: { item: 'id', to: 'id?' }, impact: 0.8 },
	give: { args: { item: 'id', to: 'id', quantity: 'number?' }, help: 'goes to them first. to buy or sell, use offer', reply: true, seen: 'giving {item} to {to}', impact: 0.8 },
	examine: { args: { target: 'id' } },
	say: { args: { text: 'text', to: 'id?', as: { kind: 'string?', names: Object.values(SayTone) } }, help: 'one short sentence', reply: true, channel: 'voice', group: 'to', impact: 0.3 },
	wait: { args: { seconds: { kind: 'number?', min: 0 }, until: 'watch?' }, help: 'until fails if not met within seconds (default 20)', channel: '', impact: 0.2 },
	pass: { args: {}, help: 'keeps your current program; reply pass() when nothing needs to change', channel: '' },
	instead: { args: { arc: 'arc' }, help: 'drops your running program for these steps; at the root of a reply only' },
	remember: { args: { content: 'text', tags: 'string[]?' }, channel: '' },
	think: { args: { about: 'text?' }, channel: '' },
	set_goal: { args: { goal: 'text', priority: 'number?' }, seen: 'thinking', channel: '' },
	drop_goal: { args: { goal: 'text?' }, seen: 'thinking', channel: '' },
	finish_goal: { args: { goal: 'text?' }, help: 'it is done', seen: 'thinking', channel: '' },
	set_identity: { args: { role: 'string?', traits: 'string[]?' }, seen: 'thinking', channel: '' },
	watch: { args: { name: 'string', expr: 'expr' }, channel: '' },
	unwatch: { args: { name: 'string' }, channel: '' },
	focus: { args: { expr: 'expr' }, channel: '' },
	unfocus: { args: { expr: 'expr' }, channel: '' },
	if: { args: { cond: 'arc', arc: 'arc', else: 'arc?' }, impact: 0 },
	when: { args: { watch: 'watch', arc: 'arc', times: 'number?', until: 'watch?', rearm: 'number?' }, help: `this job's interrupt from where it is written; no extra think`, impact: 0 },
	loop: { args: { arc: 'arc', through: 'watch?', until: 'watch?', times: 'number?', unbreakable: 'hold?' }, help: 'repeats until a round fails. In a when or law, it stops once the trigger is false; unbreakable=true goes on to its end, unbreakable=N for N rounds first, unbreakable=10s for 10s (on follow too)', impact: 0.1 },
	law: { args: { who: 'expr?', watch: 'watch', arc: { kind: 'arc', not: ['law'] }, name: 'law?', times: 'number?', until: 'watch?', rearm: 'number?' }, help: 'standing reaction until unlaw; no extra think', channel: '' },
	unlaw: { args: { name: 'law' }, help: 'drops that law', channel: '' },
	// Its choices are named args of their own; `arc/choose.ts` reads them.
	choose: { args: { goal: 'text' }, help: 'a fast model picks one by name each run; loop it to keep picking', impact: 0 },
	offer: { args: { to: 'id?', give: 'bundle?', get: 'bundle?' }, help: 'goes to them first if out of earshot. each side as {"Egg":12, "Milk":3}, items and gold only. if they offer that or better, both move at once; else it waits for their answer. no to: offered to anyone', reply: true, impact: 0.8 },
} as const satisfies Record<StockVerb, VerbDef>;
