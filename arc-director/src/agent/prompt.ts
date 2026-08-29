import { verbHelp } from '../action/schema.js';
import type { VerbRegistry } from '../action/registry.js';
import type { ActionResult } from '../action/types.js';
import type { MemoryRecord } from '../memory/store.js';
import { DEFAULT_YOU_SYMBOL } from './map.js';
import type { AgentIdentity, Goal } from './types.js';

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
	'Watch language (JS-looking calls, not a JS subset). Bindings: me, others, items; host names like Player, events.',
	'Standing conditions go in JSON watches: ["expr", ...]. One-shot questions this think: observe({expr}).',
	'Two-arg relations: distance(me, Player), isNear(me, Player), isNear(me, Player, 16), hasSightline(me, Player), facing(me, Player), isFacing(me, Player).',
	'hasSightline is line of sight only. isFacing is facing(a,b) > √2/2 (90° cone).',
	'Infix is matches id, name, or tag: i is "Lantern". find/filter/some/all take a predicate or a string needle.',
	'Lists: others.nearby(), others.nearby(16), others.approaching(), others.departing(), events.filter("theft").nearby(16).',
	'&& / || on numbers are min / max; on bools, and / or. Gate analog with *. Ternary cond ? a : b. ?? is absent-coalesce only (keeps 0 and false).',
	'! / !!. Dot on absent does not throw. Wrap raw distance in clamp or softClamp. hp / maxHP if the host plugged them.',
	'trueScore applies only to a boolean watch root, not inside arithmetic.',
].join(' ');

export function seeMapHint(youSymbol = DEFAULT_YOU_SYMBOL):string {
	const you = youSymbol.trim() || DEFAULT_YOU_SYMBOL;
	return [
		'The English scene already names who and what is near, with distances in paces.',
		'Do not call see_map unless that text is not enough to pick a go_to.',
		'see_map({zoom:1}) is close around you; see_map({zoom:0}) is the whole loaded land; in-between values zoom.',
		`Pictograms. Match the legend (${you} = you) to names. No coordinates.`,
		'Calling it again soon, without having moved, returns the same legend and no new picture.',
	].join(' ');
}

export const SEE_MAP_HINT = seeMapHint();

function planInstructions(verbs:VerbRegistry):string {
	return `Change goals when what you must do changed (a standing order, harm, theft, a threat) — put `
		+ `"goals":[{"text":"...","priority":0}] on the same ActionPlan JSON; that change is lasting. `
		+ `Omit identity. Do not emit identity or set_identity unless who you are has actually changed for good. `
		+ `Weather, an order, helping, and danger are not a new identity. `
		+ `Do not pick a nickname or shorten the role. A new name only sticks with a new role, and both need that same rare bar. `
		+ `Harm, theft, and threats outrank standing role text this think. `
		+ `set_goal and drop_goal also work as verbs. Avoid set_identity. `
		+ `Chain several steps with then_if_ok when you already know the next action. `
		+ `Prefer the scene text. Tools are optional; skip them if you can already act. `
		+ `Then emit one ActionPlan as JSON. `
		+ `Never emit coordinates. Names only. Available verbs: ${verbHelp(verbs)}. `
		+ `JSON shape: {"head":{"verb":"go_to","args":{"name":"EastGate"}},"then":{"join":"then_if_ok","plan":{"head":{"verb":"wait","args":{"seconds":1}}}}}. `
		+ `Close every brace. Do not write "...". At most four chained steps.`;
}

function stringifyPush(value:unknown):string {
	if (typeof value === 'string') {
		return value;
	}
	if (value === undefined) {
		return '';
	}
	return JSON.stringify(value);
}

export function volatileBlock(opts:{
	pushed:Record<string, unknown>;
	intrusion?:string;
	lastResult?:ActionResult;
	goals?:Goal[];
	pinned?:MemoryRecord[];
	watches?:string[];
	pinnedWatches?:string[];
	watchesWritable?:boolean;
	scold?:string;
	recentSummary?:string;
	recent?:string[];
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
	for (const [name, value] of Object.entries(opts.pushed)) {
		const text = stringifyPush(value).trim();
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
	if (opts.pinnedWatches && opts.pinnedWatches.length > 0) {
		parts.push(`Required watches (host; do not remove):\n${opts.pinnedWatches.map((w) => `- ${w}`).join('\n')}`);
	}
	if (opts.watches && opts.watches.length > 0) {
		const extra = opts.pinnedWatches?.length
			? opts.watches.filter((w) => !opts.pinnedWatches!.includes(w))
			: opts.watches;
		if (extra.length > 0) {
			parts.push(`Current watches:\n${extra.map((w) => `- ${w}`).join('\n')}`);
		}
	}
	if (opts.watchesWritable) {
		parts.push('You may replace the non-required watches in the ActionPlan JSON as "watches": ["expr", ...]. Required watches stay even if omitted.');
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
		+ `Emit one valid ActionPlan JSON now. Names only, no coordinates. Close every brace.`;
}

/** Follow-up after a say plan whose audience is out of range. Speech did not happen. */
export function sayRangeHint(reason:string, nearby:string[]):string {
	const range = nearby.length > 0
		? `In talking range: ${nearby.join(', ')}.`
		: 'No one is in talking range.';
	return `${reason}. That say did not happen. ${range} `
		+ `Keep this conversation. go_to the name first, or say to someone already in range. `
		+ `Then emit one valid ActionPlan JSON. Names only, no coordinates.`;
}
