import { verbHelp } from '../action/schema.js';
import type { VerbRegistry } from '../action/registry.js';
import type { ActionResult } from '../action/types.js';
import type { MemoryRecord } from '../memory/store.js';
import { DEFAULT_YOU_SYMBOL } from './map.js';
import type { AgentIdentity, Goal, Watches } from './types.js';
import { extrasWithoutPins, formatWatches, watchCount, watchNames } from './watch.js';

export type StablePrefixOpts = {
	includeWatches?:boolean;
	canSeeMap?:boolean;
	/** Pictogram for this agent's own location. Used in the see_map hint. */
	youSymbol?:string;
};

/**
 * Identity + standing instructions. Keep this byte-stable across thinks so
 * local servers can reuse the KV prefix. Goals, memory, and perception go
 * in `volatileBlock`.
 */
export function stablePrefix(
	identity:AgentIdentity,
	verbs:VerbRegistry,
	opts:StablePrefixOpts = {},
):string {
	const lines = [
		`You are ${identity.name}. Role: ${identity.role}.`,
		'Keep this name and this role. Do not rewrite identity to recap an order, a mood, or a crisis.',
		'The role is default work, not a cage. Harm, theft, and threats outrank it this think — act. You do not need a new role to help, flee, or fight.',
	];
	if (identity.traits && identity.traits.length > 0) {
		lines.push(`Traits: ${identity.traits.join(', ')}.`);
	}
	if (opts.includeWatches) {
		lines.push(WATCH_CHEAT_SHEET);
	}
	if (opts.canSeeMap) {
		lines.push(seeMapHint(opts.youSymbol));
	}
	lines.push(planInstructions(verbs));
	return lines.join('\n');
}

export const WATCH_CHEAT_SHEET = [
	'Watch language (JS-looking calls, not a JS subset). Bindings: me, others, items, units (this Crowd roster, not others), landmarks; host names like Player, Cottage, events.',
	'Standing conditions: addWatches / editWatches / removeWatches, or replace extras with watches: {name: expr, ...}. Keys are short names. One-shot questions this think: observe({expr}).',
	'Two-arg relations: distance(me, Player), isNear(me, Player), isNear(me, Player, 16), hasSightline(me, Player), facing(me, Player), isFacing(me, Player), manhattan(me, Player), chebyshev(me, Player), inSquare(me, Player, 4).',
	'hasSightline is line of sight only. isFacing is facing(a,b) > √2/2 (90° cone).',
	'Infix is matches id, name, or tag: i is "Lantern". find/filter/some/all take a predicate or a string needle.',
	'Lists: others.nearby(), others.nearby(16), others.approaching(), others.departing(), events.filter("theft").nearby(16).',
	'isReachable(me, Cottage), others.reachable() (walk path, nearest first); wrap list watches in some.',
	'&& / || on numbers are min / max; on bools, and / or. Gate analog with *. Ternary cond ? a : b. ?? is absent-coalesce only (keeps 0 and false).',
	'! / !!. Dot on absent does not throw. Wrap raw distance in clamp or softClamp. hp / maxHP if the host plugged them.',
	'trueScore applies only to a boolean watch root, not inside arithmetic.',
	'Crowd units: u.busy / isBusy(u) / doing(u, "go_to"). Selectors cap at roster size.',
].join(' ');

export function seeMapHint(youSymbol = DEFAULT_YOU_SYMBOL):string {
	const you = youSymbol.trim() || DEFAULT_YOU_SYMBOL;
	return [
		'The English scene already names who and what is near, with distances in paces.',
		'If you are looking for something the scene has not named, wander(until) with args.until a watch-expr string rather than guessing a go_to.',
		'Do not call see_map unless that text is not enough to pick a go_to or wander(until).',
		'see_map({zoom:1}) is close around you; see_map({zoom:0}) is the whole loaded land; in-between values zoom.',
		`Pictograms. Match the legend (${you} = you) to names. No coordinates.`,
		'Calling it again soon, without having moved, returns the same legend and no new picture.',
	].join(' ');
}

export const SEE_MAP_HINT = seeMapHint();

function planInstructions(verbs:VerbRegistry):string {
	return `Goals are standing wants, not the next action. Do not replace a goal with the next verb. `
		+ `Omit identity. Do not emit identity or set_identity unless who you are has actually changed for good. `
		+ `Weather, an order, helping, and danger are not a new identity. `
		+ `Do not pick a nickname or shorten the role. A new name only sticks with a new role, and both need that same rare bar. `
		+ `Harm, theft, and threats outrank standing role text this think. `
		+ `remember(content, tags?) keeps a fact you will still know later. Use it when you learn who someone is, what they want, or how a thing works. `
		+ `think(about?) always runs last; several merge into one. about is optional. Do not think() twice in a row — act first. `
		+ `wait(until) parks with a one-shot watch (same language as watches), dropped the next think. Do not addWatches for a one-check. `
		+ `Looking for a thing or place the scene has not named? wander(until) walks until the watch expr in args.until is true (same language as watches). `
		+ `Example: {"head":{"verb":"wander","args":{"until":"some(items.filter(\\"FireMushroom\\").nearby())"}}}. `
		+ `Other until strings: some(landmarks.filter("tree").nearby(16)), isNear(me, Cottage). Do not invent a go_to name. go_to only a name you already see. The wander result lists names you passed. `
		+ `If the last wander already met args.until, do not wander that same expr again — pick_up or go_to a name from the result. `
		+ crowdInstructions(verbs)
		+ `Chain several steps with then_if_ok when you already know the next action. `
		+ `Prefer the scene text. Tools are optional; skip them if you can already act. `
		+ `Answer immediately with only the ActionPlan JSON. No preamble, no scratchpad, no prose before or after it. `
		+ `Never emit coordinates. Names only. Available verbs: ${verbHelp(verbs)}. `
		+ `JSON shape: {"head":{"verb":"go_to","args":{"name":"EastGate"}},"then":{"join":"then_if_ok","plan":{"head":{"verb":"wait","args":{"seconds":1}}}}}. `
		+ `Close every brace. Do not write "...". At most four chained steps (when(watch) does not count; a (group) is one outer step).`;
}

function crowdInstructions(verbs:VerbRegistry):string {
	const parts:string[] = [];
	if (verbs.has('when')) {
		parts.push(
			`when(watch, plan) is critical on this job; it is hoisted and does not count toward four steps. `
			+ `watch false aborts that handler (preempt, not fail) and resumes the parent. `
			+ `Rank: earlier may preempt later that is running; later runs only if every earlier watch is false. Body never preempts. `,
		);
	}
	if (verbs.has('loop')) {
		parts.push(
			`loop(plan) repeats until fail. through=x in expr (require x in), until=expr, times=N. Each iteration is a frame. Preempt is not fail. `,
		);
	}
	if (verbs.has('law') || verbs.has('unlaw')) {
		parts.push(
			`when(who, plan) replaces that unit's plan stack; laws stay. `
			+ `law(who, watch, plan, name?) is a standing emergency on the Crowd (who omitted = units). unlaw(name). `
			+ `Emergencies = law list order; critical = when(watch) on the job, innermost first; body is fallback. `,
		);
	}
	else if (verbs.has('when')) {
		parts.push(`when(who, plan) issues orders immediately if this is a Crowd. `);
	}
	if (parts.length === 0) {
		return '';
	}
	return parts.join('');
}

function stringifySense(value:unknown):string {
	if (typeof value === 'string') {
		return value;
	}
	if (value === undefined) {
		return '';
	}
	return JSON.stringify(value);
}

export function volatileBlock(opts:{
	senses?:Record<string, unknown>;
	intrusion?:string;
	lastResult?:ActionResult;
	goals?:Goal[];
	pinned?:MemoryRecord[];
	recalled?:MemoryRecord[];
	watches?:Watches;
	pinnedWatches?:Watches;
	watchesWritable?:boolean;
	pinnedSightFocus?:string[];
	sightFocus?:string[];
	sightFocusWritable?:boolean;
	scold?:string;
	recentSummary?:string;
	recent?:string[];
	thinkAbout?:string;
}):string {
	const parts:string[] = [];
	const recent = shortTermBlock(opts.recentSummary ?? '', opts.recent ?? []);
	if (recent) {
		parts.push(recent);
	}
	if (opts.goals && opts.goals.length > 0) {
		const sorted = [...opts.goals].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
		parts.push(`Goals (highest first):\n${sorted.map((g) => `- ${g.text}`).join('\n')}`);
	}
	if (opts.pinned && opts.pinned.length > 0) {
		parts.push(`Pinned memories:\n${opts.pinned.map((m) => `- ${m.text}`).join('\n')}`);
	}
	if (opts.recalled && opts.recalled.length > 0) {
		parts.push(`You remember:\n${opts.recalled.map((m) => `- ${m.text}`).join('\n')}`);
	}
	for (const [name, value] of Object.entries(opts.senses ?? {})) {
		const text = stringifySense(value).trim();
		if (!text) {
			continue;
		}
		parts.push(`${name}:\n${text}`);
	}
	if (opts.intrusion) {
		parts.push(`[unbidden: ${opts.intrusion}]`);
	}
	if (opts.lastResult) {
		const r = opts.lastResult;
		const status = r.interrupted ? 'interrupted' : r.ok ? 'ok' : 'failed';
		const reason = r.reason ? ` — ${r.reason}` : '';
		parts.push(`Last action result: ${r.verb ?? 'action'} ${status}${reason}`);
	}
	if (opts.thinkAbout) {
		parts.push(`You asked to think about: ${opts.thinkAbout}`);
	}
	if (opts.pinnedWatches && watchCount(opts.pinnedWatches) > 0) {
		parts.push(`Required watches (host; do not edit or remove):\n${formatWatches(opts.pinnedWatches)}`);
	}
	if (opts.watches && watchCount(opts.watches) > 0) {
		const extra = opts.pinnedWatches && watchCount(opts.pinnedWatches) > 0
			? extrasWithoutPins(opts.watches, opts.pinnedWatches)
			: opts.watches;
		if (watchCount(extra) > 0) {
			parts.push(`Current watches:\n${formatWatches(extra)}`);
		}
	}
	if (opts.watchesWritable) {
		const pinNames = watchNames(opts.pinnedWatches ?? {}).join(', ');
		const pinNote = pinNames
			? ` Required watches (${pinNames}) stay. Do not reuse those names.`
			: ' Required watches stay. Do not reuse their names.';
		parts.push(
			'You may add, edit, or remove non-required watches on the ActionPlan JSON: '
			+ '"addWatches":{"theft":"some(events.filter(\\"theft\\").nearby(16))"}, '
			+ '"editWatches":{"theft":"..."}, '
			+ '"removeWatches":["theft"]. '
			+ 'To replace all extras at once: "watches":{"theft":"..."} (empty object {} clears extras). '
			+ pinNote,
		);
	}
	if (opts.pinnedSightFocus && opts.pinnedSightFocus.length > 0) {
		parts.push(`Required sightFocus (host; do not edit or remove):\n${opts.pinnedSightFocus.map((e) => `- ${e}`).join('\n')}`);
	}
	if (opts.sightFocus && opts.sightFocus.length > 0) {
		parts.push(`Current sightFocus:\n${opts.sightFocus.map((e) => `- ${e}`).join('\n')}`);
	}
	if (opts.sightFocusWritable) {
		parts.push(
			'You may replace extra sightFocus exprs on the ActionPlan JSON: "sightFocus":["isHurt(it)","isNear(it, Player)"]. '
			+ 'Required sightFocus stay. Do not copy those exprs into extras.',
		);
	}
	if (opts.scold) {
		parts.push(`[watch: ${opts.scold}]`);
	}
	return parts.join('\n\n');
}

/** Rolling what-just-happened. Always in the prompt; older lines fold into `Earlier:`. */
export function shortTermBlock(summary:string, recent:string[]):string {
	const earlier = summary.trim();
	if (!earlier && recent.length === 0) {
		return '';
	}
	const lines = [
		'Short-term memory (you still know this. A later line wins if they conflict. Honor orders here even if older role text disagrees.):',
	];
	if (earlier) {
		lines.push(`Earlier: ${earlier}`);
	}
	for (const line of recent) {
		const text = line.trim();
		if (text) {
			lines.push(`- ${text}`);
		}
	}
	return lines.join('\n');
}

/** Follow-up user turn after a bad plan or a tool call when tools are closed. Keeps the thread. */
export function planRepairHint(reason:string):string {
	return `That was not a valid ActionPlan (${reason}). Keep this conversation. `
		+ `Emit only one valid ActionPlan JSON now — no prose. Names only, no coordinates. Close every brace.`;
}

/** Follow-up after a say plan whose audience is out of range. Speech did not happen. */
export function sayRangeHint(reason:string, nearby:string[]):string {
	const range = nearby.length > 0
		? `In talking range: ${nearby.join(', ')}.`
		: 'No one is in talking range.';
	return `${reason}. That say did not happen. ${range} `
		+ `Keep this conversation. go_to the name first, or say to someone already in range. `
		+ `Then emit only one valid ActionPlan JSON — no prose. Names only, no coordinates.`;
}
