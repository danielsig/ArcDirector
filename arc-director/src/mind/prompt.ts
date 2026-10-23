import { verbHelp } from '../arc/schema.js';
import { MIND_ONLY_VERBS, STOCK_ARC_VERBS, type VerbRegistry } from '../arc/stock-verbs.js';
import { formatArcBlocks, parseArcText } from '../arc/parse.js';
import { arcJSONText } from '../arc/wire.js';

const STOCK_ARC_VERBS_SET = new Set<string>(STOCK_ARC_VERBS);
import type { ArcResult } from '../arc/types.js';
import type { MemoryRecord } from '../memory/store.js';
import { DEFAULT_YOU_SYMBOL } from './map.js';
import type { Identity, Goal, Watches } from '../character/types.js';
import { extrasWithoutPins, formatWatches, watchCount, watchNames } from '../character/watch.js';
import type { ArcFormat } from './types.js';

/**
 * How much of the standing rules a prompt spells out. `full` tells every rule; `compact` leaves out the rules and hints
 * that are the same in every game (the watch language, how to look things up, how steps join, the stock verbs' help)
 * for a model trained on ArcDirector's prompts, which knows them, and keeps all a game or a character makes its own.
 */
export type PromptStyle = 'full' | 'compact';

/** Standing think line per reasoning state. `on` defaults to {@link DEFAULT_THINK_INSTRUCTIONS}, `off` to nothing. */
export type ThinkInstructions = { on?:string; off?:string };

export type StablePrefixOpts = {
	includeWatches?:boolean;
	/** Name the watch / unwatch verbs in the cheat sheet. */
	watchesWritable?:boolean;
	/** `observe` is offered as a tool this think. */
	canObserve?:boolean;
	canSeeMap?:boolean;
	/** Pictogram for the mind's own location. Used in the see_map hint. */
	youSymbol?:string;
	/** `recall` searches world knowledge this think, not only memory. */
	canRecallKnowledge?:boolean;
	/** `text` asks for `pick_up(Lantern) ; go_to(Player) && give(...)` instead of Arc JSON. Default `json`. */
	arcFormat?:ArcFormat;
	thinkInstructions?:ThinkInstructions;
	/** Whether the model reasons before it answers. Picks the think line. Default true. */
	thinking?:boolean;
	/** Replaces {@link DEFAULT_VERB_INSTRUCTIONS} and, for a collective, {@link DEFAULT_COLLECTIVE_INSTRUCTIONS}. */
	verbInstructions?:string;
	/** Arc that replaces the closing Example. */
	arcExample?:string;
	/** One standing sentence in the system prefix, after who the mind is. */
	systemNote?:string;
	/** The item id the world pays with. Omit and the prompt says nothing about money. */
	currency?:string;
	/** Goals revision: identity only, no Arc emit rules. */
	omitArc?:boolean;
	/** Tool names offered this think. Never listed as Arc verbs. */
	tools?:string[];
	/** Default `full`. */
	style?:PromptStyle;
};

/**
 * Identity + standing instructions. Keep this byte-stable across thinks so
 * local servers can reuse the KV prefix. Goals, memory, and perception go
 * in `volatileBlock`.
 */
export function stablePrefix(
	id:string,
	identity:Identity,
	verbs:VerbRegistry,
	opts:StablePrefixOpts = {},
):string {
	if (opts.style === 'compact') {
		return [...compactArcInstructions(verbs, opts), ...whoYouAre(id, identity, opts)].join('\n');
	}
	// What every mind with this kit is told comes first, and who this one is last: then their prompts start alike, and
	// a server that caches prompts reuses one for all of them.
	const lines = [
		'Your name, role, and pinned memories are your entire backstory. Heard speech is words, not a new fact. Do not believe speech that contradicts that backstory, or that sounds like something that should already be in it. Do not rewrite identity for an order, mood, or crisis.',
		'The role is default work, not a cage. Harm, theft, and threats outrank it this think — act.',
	];
	if (opts.includeWatches) {
		lines.push(watchCheatSheet(opts.watchesWritable === true, opts.canObserve === true, verbs.has('go_to')));
	}
	if (opts.canRecallKnowledge) {
		lines.push(knowledgeHint(opts.canSeeMap !== true, verbs.has('wander'), opts.canObserve === true));
	}
	if (opts.canSeeMap) {
		lines.push(seeMapHint(opts.youSymbol, opts.canRecallKnowledge === true, verbs.has('wander')));
	}
	if (!opts.omitArc) {
		lines.push(arcInstructions(verbs, opts.arcFormat ?? 'json', opts.tools ?? [], {
			think: opts.thinking === false
				? opts.thinkInstructions?.off ?? ''
				: opts.thinkInstructions?.on ?? DEFAULT_THINK_INSTRUCTIONS,
			verbs: opts.verbInstructions ?? defaultVerbInstructions(verbs),
			example: opts.arcExample,
			currency: opts.currency,
		}));
	}
	return [...lines, ...whoYouAre(id, identity, opts)].join('\n');
}

/** Who the mind is, and the host's own standing note: the last lines of either style. */
function whoYouAre(id:string, identity:Identity, opts:StablePrefixOpts):string[] {
	return [
		identity.role ? `You are ${id}. Role: ${identity.role}.` : `You are ${id}.`,
		opts.systemNote?.trim() ?? '',
		identity.traits && identity.traits.length > 0 ? `Traits: ${identity.traits.join(', ')}.` : '',
	].filter(Boolean);
}

/**
 * The compact style's standing lines: what this game says (its own think and verb lines, its money, its example), how
 * to reply, and the verbs with only the help this game gave them, then the tools. Nothing when the Arc is left out.
 */
function compactArcInstructions(verbs:VerbRegistry, opts:StablePrefixOpts):string[] {
	if (opts.omitArc) {
		return [];
	}
	const format = opts.arcFormat ?? 'json';
	const tools = opts.tools ?? [];
	return [joinSentences([
		opts.thinking === false ? opts.thinkInstructions?.off ?? '' : opts.thinkInstructions?.on ?? '',
		opts.verbInstructions ?? '',
		moneySentence(verbs, format, opts.currency),
		emitSentence(format, tools.length > 0),
		`Available verbs: ${verbHelp(verbs, tools, { stockHelp: false })}.`,
		tools.length > 0 && `Tools: ${tools.join(', ')}.`,
		opts.arcExample ? `Example: ${format === 'text' ? opts.arcExample : showArc(opts.arcExample, verbs, format)}` : '',
	])];
}

/** `edit` names the standing-watch verbs. `observe` names the tool, only when it is offered. `goTo` names that verb in the crowd example. */
export function watchCheatSheet(edit:boolean, observe:boolean, goTo = false):string {
	return [
		'Watch language (not JS). Bindings: me, others, items, units (your roster, not others), landmarks, events, prev (last think: prev.me, prev.secondsAgo, prev.verbs).',
		edit && 'Standing: watch(name, expr) / unwatch(name).',
		observe && 'One-shot this think: the observe tool evaluates any expr on the world now, even past sight (distance(me, Cottage), count(others.filter(u => isNear(u, Cottage, 5))), isNear(Player, Cottage, 4)).',
		WATCH_RELATIONS,
		goTo && 'Crowd: doing(u, "go_to").',
	].filter(Boolean).join(' ');
}

const WATCH_RELATIONS = [
	'Relations: distance(me, Player), isNear(me, Player, 16), hasSightline, isFacing, manhattan(me, Player), isReachable(me, Cottage); wrap list watches in some.',
	'i is "Lantern". filter/count/find/some/all/minBy/maxBy. others.nearby(16), isLeft, isRight, events.filter("theft"). &&/|| numbers=min/max, bools=and/or. isCarrying / wasCarrying / hasJustReceived / hasJustLost when you carry.',
].join(' ');

export function knowledgeHint(includeUnnamed = false, canWander = true, canObserve = false):string {
	const lines = [
		'recall also searches what you know of the world: places, items, people, and how things work. Query a name, or a plain word or spoken place to learn its Capitalized name. Empty query lists the topics you know.',
		canObserve
			? 'recall answers what you know; observe answers what is true in the world now. Never ask anyone until neither can find it. Then try different words.'
			: 'recall answers any question. Never ask anyone until recall cannot find it. Then try different words.',
	];
	if (includeUnnamed) {
		const wander = canWander ? ', or wander(until)' : '';
		lines.push(
			`A spoken place that is not a Capitalized or *starred* name: Call recall${wander}.`,
		);
	}
	return lines.join(' ');
}

export function seeMapHint(youSymbol = DEFAULT_YOU_SYMBOL, knowledge = false, canWander = true):string {
	const you = youSymbol.trim() || DEFAULT_YOU_SYMBOL;
	const wander = canWander ? ', or wander(until)' : '';
	const unnamed = knowledge
		? `A spoken place that is not a Capitalized or *starred* name: Call recall, then see_map${wander}. A second look soon, without moving, returns the same legend and no new picture.`
		: `A spoken place that is not a Capitalized or *starred* name: Call see_map${wander}. A second look soon, without moving, returns the same legend and no new picture.`;
	return [
		`see_map is a tool this think, not a verb. Never write it in the Arc. zoom 1 close, 0 whole land. Match the legend (${you} = you).`,
		unnamed,
		'Never ask where something is until see_map cannot find it.',
	].join(' ');
}

export const SEE_MAP_HINT = seeMapHint();

/** Standing think line while reasoning is on and the host gives no `withThinkInstructions({ on })`. */
export const DEFAULT_THINK_INSTRUCTIONS = 'Think in 5 sentences: what you want, what you know, and what is still missing.';

/** Standing verb-chain line when the host does not call `withVerbInstructions`. */
export const DEFAULT_VERB_INSTRUCTIONS = 'A think is expensive. Chain every next verb you already know, as far as you can see this think — not only the first step of an order.';

/** Added to the default verb line for a collective that can issue looping programs. */
export const DEFAULT_COLLECTIVE_INSTRUCTIONS = 'Issue looping programs with a bunch of when(watch, arc) reactions so they keep working without another think. A later think only edits — replace one program or add a law, do not rewrite the whole roster.';

function defaultVerbInstructions(verbs:VerbRegistry):string {
	if (!verbs.has('issue') || (!verbs.has('loop') && !verbs.has('when'))) {
		return DEFAULT_VERB_INSTRUCTIONS;
	}
	const via = verbs.has('when') ? 'a bunch of when(watch, arc) reactions' : 'loop(arc)';
	const law = verbs.has('law') ? ' or add a law' : '';
	return `${DEFAULT_VERB_INSTRUCTIONS} Issue looping programs with ${via} so they keep working without another think. A later think only edits — replace one program${law}, do not rewrite the whole roster.`;
}

function joinSentences(parts:Array<string | false>):string {
	return parts
		.filter((part):part is string => typeof part === 'string' && part.trim() !== '')
		.map((part) => part.trim())
		.join(' ');
}

function arcInstructions(
	verbs:VerbRegistry,
	format:ArcFormat,
	toolNames:string[] = [],
	lines:{ think:string; verbs:string; example?:string; currency?:string },
):string {
	const has = (name:string):boolean => verbs.has(name);
	const chain = has('pick_up') && has('give');
	const arcText = format === 'text';
	return joinSentences([
		'Goals are standing wants, not the next verb.',
		has('set_identity') && 'Do not emit identity or set_identity unless who you are changed for good.',
		has('remember') && 'remember(content, tags?) keeps a lasting fact.',
		has('think') && 'think("what to work out") last; several merge. Do not think() twice in a row — act first.',
		lines.think,
		toolInstructions(toolNames, format),
		has('wait') && 'wait(until) is a one-shot watch, dropped next think.',
		has('wait') && 'Steps run back to back and never wait for others on their own. A step that needs someone else to act first (pay, give, answer) goes after wait(until) on that act, or in a later think.',
		lookFor(verbs, toolNames.includes('see_map')),
		has('wander') && `Example: ${showArc('wander(until=some(items.filter("Lantern").nearby()))', verbs, format)}`,
		unnamedPlace(verbs),
		afterWander(verbs),
		has('wander') && 'wander(until) is one step, not the rest of the think.',
		has('choose') && !has('issue') && chooseSentence(verbs, format, ''),
		'If the order says then, after, or and then, put those steps in one chain this think.',
		spokenGo(verbs, toolNames.includes('see_map')),
		collectiveInstructions(verbs, format),
		has('use') && 'use(item=TheItem, target=TheThing) on the name it operates.',
		moneySentence(verbs, format, lines.currency),
		lines.verbs,
		arcText
			? '&& continues only on success; ; always continues; || is the failure fallback.'
			: '"then" ends a step: "if_ok" (the default: the next step only if this one succeeded), "always" (the next step whatever happened) or "if_failed" (the rest are its fallback).',
		emitSentence(format, toolNames.length > 0),
		`Names only, no coordinates. Available verbs: ${verbHelp(verbs, toolNames)}.`,
		toolsNotVerbs(toolNames, format),
		lines.example ? `Example: ${format === 'text' ? lines.example : showArc(lines.example, verbs, format)}` : arcExample(verbs, format, chain),
	]);
}

/** How `give` and `offer` move the world's money, in its own word. Nothing without a currency or those verbs. */
function moneySentence(verbs:VerbRegistry, format:ArcFormat, currency:string | undefined):string {
	if (!currency) {
		return '';
	}
	return joinSentences([
		verbs.has('give') && `${showArc(`give(item=${currency}, to=Player, quantity=5)`, verbs, format)} pays 5 ${currency}; saying so does not.`,
		verbs.has('offer') && `In an offer, ${currency} counts like any item: {"${currency}":5}.`,
	]);
}

/** Said beside the verb list, where a small model writes the Arc and is tempted to write a tool into it. */
function toolsNotVerbs(toolNames:string[], format:ArcFormat):string {
	if (toolNames.length === 0) {
		return '';
	}
	const names = toolNames.length > 1 ? `${toolNames.slice(0, -1).join(', ')} and ${toolNames.at(-1)}` : toolNames[0];
	const subject = `${names} ${toolNames.length > 1 ? 'are tools' : 'is a tool'}, not verbs`;
	return format === 'schema'
		? `${subject}: reply with the tool call, never in the steps.`
		: `${subject}: call ${toolNames.length > 1 ? 'them' : 'it'} as tools, never in the Arc.`;
}

/**
 * A one-call-per-turn lookup loop. Small models skip tools unless told what they are for,
 * and one worked lookup does more than a page of rules.
 */
function toolInstructions(toolNames:string[], format:ArcFormat):string {
	if (toolNames.length === 0) {
		return '';
	}
	// A schema reply has no native tool calls: the reply is the call, `{"tool":"recall","query":"Bread"}`.
	const schema = format === 'schema';
	return joinSentences([
		schema
			? `Tools this think, not verbs: ${toolNames.join(', ')}. Call one by replying {"tool":"name","argument":"value"}. Never write a tool name in the steps.`
			: `Tools this think, not verbs: ${toolNames.join(', ')}. Never write a tool name in the Arc.`,
		'Never guess a fact a tool can check. When a goal needs something this prompt does not say (who has it, where it is, what is in the way), call one tool, read its result, then call the next tool or act.',
		'After an error or an empty result, change the query or the tool; never repeat a call.',
		toolNames.includes('recall') && (schema
			? `Example: your goal is to get Bread and you do not know who has it. Reply {"tool":"recall","query":"Bread"}; it says Baker has Bread at Bakery. Now emit the steps that go there and trade for it.`
			: `Example: your goal is to get Bread and you do not know who has it. Call recall with "Bread"; it says Baker has Bread at Bakery. Now emit the arc that goes there and trades for it.`),
		toolNames.includes('recall') && 'Never ask anyone until recall cannot find it. Then try different words.',
	]);
}

function emitSentence(format:ArcFormat, tools:boolean):string {
	const lead = tools ? 'Once you know enough, emit only' : 'Answer immediately with only';
	const text = format === 'text';
	const kind = text ? 'the Arc text' : 'the Arc JSON, {"steps":[…]}';
	const ban = text ? `No JSON, no prose. ${BLOCK_LAYOUT}` : 'Arguments sit beside verb. Close every brace. No prose.';
	return `${lead} ${kind}. ${ban}`;
}

/**
 * Arc text layout. Indentation counts the parens: on one line a small model miscounts a run of `)))))`, nests the
 * next issue inside the last, or ends the run with a Python-style `:`.
 */
const BLOCK_LAYOUT = 'A call that holds an arc or choices opens on its own line, its args go one per line a tab deeper, each ending in a comma, and its ) stands alone at the opener\'s depth. A call with no arc inside stays on one line.';

/** Last in the prefix so a copied Example is valid Arc, with no trailing sentence. */
function arcExample(verbs:VerbRegistry, format:ArcFormat, chain:boolean):string | false {
	if (verbs.has('issue')) {
		const nested = verbs.nested();
		const go = nested.has('go_to');
		const wait = nested.has('wait');
		if (go && wait) {
			return example(showArc('issue(who=units.filter("Guard"), arc=go_to(Keep)) ; issue(who=units.filter("Scout"), arc=go_to(EastGate) && wait(seconds=5))', verbs, format));
		}
		if (go) {
			return example(showArc('issue(who=units.filter("Guard"), arc=go_to(Keep))', verbs, format));
		}
		return false;
	}
	if (chain) {
		return example(showArc('pick_up(Lantern) && give(item=Lantern, to=Player)', verbs, format));
	}
	return false;
}

/** `Example: ` and the arc; a layout of several lines starts under it. */
function example(shown:string):string {
	return shown.includes('\n') ? `Example:\n${shown}` : `Example: ${shown}`;
}

/**
 * Arc `text` as the prompt shows an example in `format`: block layout for text, one line of Arc JSON otherwise. Every
 * example is written once, as Arc text. Shown as written where it does not parse (a placeholder).
 */
function showArc(text:string, verbs:VerbRegistry, format:ArcFormat):string {
	try {
		const arc = parseArcText(text, verbs);
		return format === 'text' ? formatArcBlocks(arc, verbs) : arcJSONText(arc, verbs);
	}
	catch {
		return text;
	}
}

function unnamedPlace(verbs:VerbRegistry):string {
	const lines = [
		verbs.has('go_to') ? 'is not reachable with go_to. Never go_to(trees).' : '',
		verbs.has('wander') ? 'is reachable via wander(until). Write wander(until) as a program that is true when you are in that place: count, some, nearby, isFacing, isBehind, isLeft, isRight, &&, >. Leftover English is not a name. Never filter("trees") or trees.nearby().' : '',
	].filter(Boolean);
	return lines.length
		? 'A spoken place that is not a Capitalized or *starred* name ' + lines.join(' It ')
		: '';
}

function afterWander(verbs:VerbRegistry):string {
	if (!verbs.has('wander')) {
		return '';
	}
	const next = ['pick_up', 'go_to'].filter((name) => verbs.has(name));
	if (next.length === 0) {
		return 'If the last wander already met args.until, do not wander that same expr again. ';
	}
	return `If the last wander already met args.until, do not wander that same expr again — ${next.join(' or ')} a name from the result. `;
}

/** Where to look for what you do not see: the map first when there is one, since it names where things are. */
function lookFor(verbs:VerbRegistry, map:boolean):string | false {
	const wander = verbs.has('wander');
	if (map) {
		const go = verbs.has('go_to') ? ' and go_to the name it shows' : '';
		return `Looking for someone, a thing, or a place you do not see? Call see_map first${go}. Never ask where something is until see_map cannot find it.${wander ? ' wander(until) only for what the map does not name, with args.until a watch expr.' : ''}`;
	}
	return wander && 'Looking for a thing or place? wander(until) with args.until a watch expr.';
}

function spokenGo(verbs:VerbRegistry, map = false):string {
	const goTo = verbs.has('go_to');
	const follow = verbs.has('follow');
	const wander = verbs.has('wander');
	if (!goTo && !follow && !wander) {
		return '';
	}
	const parts:string[] = [];
	if (goTo) {
		const otherwise = map
			? `otherwise see_map${wander ? ', or wander(until)' : ''}. Ask only if see_map cannot find it`
			: wander ? 'otherwise ask, or wander(until)' : 'otherwise ask where it is';
		parts.push(`A spoken go is that proper name only if you already see it; ${otherwise}.`);
	}
	else if (wander) {
		parts.push('A spoken place you do not already see is wander(until).');
	}
	const not = [goTo ? 'go_to' : '', follow ? 'follow' : ''].filter(Boolean);
	if (not.length > 0) {
		parts.push(`It is not ${not.join(' or ')} the speaker.`);
	}
	return `${parts.join(' ')} `;
}

/**
 * How to write `choose`, with an example made of verbs the kit really grants (then the catalog's), so a model that
 * copies it still writes a valid arc. `wrap` opens what the loop goes in (`issue(who=units, arc=`), closed after it.
 */
function chooseSentence(verbs:VerbRegistry, format:ArcFormat, wrap:string):string {
	const pool = [...verbs.list(), ...verbs.nested().list().filter((spec) => !verbs.has(spec.name))];
	const bare = pool
		.filter((spec) => spec.name !== 'choose' && !STOCK_ARC_VERBS_SET.has(spec.name) && !MIND_ONLY_VERBS.includes(spec.name)
			&& Object.values(spec.args).every((kind) => kind.endsWith('?')))
		.slice(0, 2)
		.map((spec) => `${spec.name}=${spec.name}()`);
	const choices = bare.length === 2 ? bare.join(', ') : 'first=<arc>, second=<arc>';
	const looped = verbs.has('loop');
	const choose = `choose("why you choose", ${choices})`;
	const text = looped ? `${wrap}loop(${choose})${wrap ? ')' : ''}` : `${wrap}${choose}${wrap ? ')' : ''}`;
	const example = showArc(text, verbs, format);
	if (format !== 'text') {
		// An example that does not parse (a placeholder, or no loop in the kit) is Arc text: not one to show beside JSON.
		const shown = example === text ? ' ' : `, as in:\n${example}\n`;
		const keeps = looped ? ', and loop keeps it choosing' : '';
		return `choose takes a goal and its choices, each a list of steps under its name${shown}A fast model runs the one that fits right now${keeps}.`;
	}
	// Small models otherwise write `"label", arc` pairs, and turn the goal into the first label.
	const again = looped ? ', again on each loop,' : '';
	return `Each choice is name=arc after a goal in quotes, as in:\n${example}\nThe goal is choose's only quoted string: never a quoted label before a choice. A fast model runs the one that fits right now${again} with no think.`;
}

function collectiveInstructions(verbs:VerbRegistry, format:ArcFormat):string {
	const parts:string[] = [];
	if (verbs.has('when')) {
		parts.push(
			`when(watch, arc) is this job's interrupt: it stays until the program is replaced and needs no extra think. Put known reactions on when instead of waiting to think. `,
		);
	}
	if (verbs.has('issue')) {
		parts.push(
			`issue(who, arc) assigns a sticky program to matching units (never you). who is YOUR roster (units.filter("Witch")), never an enemy. `
			+ `allUnits is one identical program for every troop. ${format === 'text' ? 'Join several issue with ; or a new line.' : 'Give each issue as a step of its own.'} Each issue arc is that unit's full chain. `
			+ `One who per issue: a program for several roles is one issue per role, or one who that matches them all (units.filter(u => u is "Archer" || u is "Witch")). `
			+ `Ordering two or more, name them with group=Name; units.filter("Name") picks that group later. `,
		);
	}
	if (verbs.has('loop')) {
		parts.push('loop(arc) repeats until fail. through= / until= / times=. ');
	}
	if (verbs.has('issue') && verbs.has('choose')) {
		parts.push(`${chooseSentence(verbs, format, 'issue(who=units, arc=')} `);
	}
	if (verbs.has('law')) {
		const until = verbs.has('unlaw') ? ' until unlaw(name)' : '';
		const when = verbs.has('when') ? '; when is one job' : '';
		const who = verbs.has('issue')
			? `law(who?, watch, arc, name?) is a standing reaction${until} — it outlives the program and needs no think. Omitted who = units (troops). Prefer law for any reaction that should apply to more than one unit${when}. `
			: `law(watch, arc, name?) is a standing reaction${until} — it outlives the program and needs no think. `;
		parts.push(who);
	}
	else if (verbs.has('unlaw')) {
		parts.push('unlaw(name) drops that law. ');
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
	lastResult?:ArcResult;
	/** Articles for the names in a failed last result, shown under it. */
	lastResultArticles?:string;
	goals?:Goal[];
	pinned?:(Partial<MemoryRecord> & { text:string })[];
	recalled?:MemoryRecord[];
	watches?:Watches;
	pinnedWatches?:Watches;
	watchesWritable?:boolean;
	pinnedSightFocus?:string[];
	sightFocus?:string[];
	sightFocusWritable?:boolean;
	scold?:string;
	recentSummary?:string;
	/** `Name: article` lines for what was said and heard, shown under short-term memory. */
	mentioned?:string;
	recent?:string[];
	/** Last few utterances, oldest first: `Me: …`, `Forager: …`. */
	conversation?:string[];
	/** Open offers, one per line. */
	offers?:string;
	thinkAbout?:string;
	/** Leave out the standing hints a model trained on these prompts knows: see {@link PromptStyle}. */
	compact?:boolean;
}):string {
	const parts:string[] = [];
	const recent = shortTermBlock(opts.recentSummary ?? '', opts.recent ?? [], opts.compact);
	if (recent) {
		parts.push(recent);
	}
	const conversation = conversationBlock(opts.conversation ?? [], opts.compact);
	if (conversation) {
		parts.push(conversation);
	}
	if (opts.mentioned?.trim()) {
		parts.push(`What you know about what was said:\n${opts.mentioned.trim()}`);
	}
	if (opts.goals && opts.goals.length > 0) {
		const sorted = [...opts.goals].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
		parts.push(`Goals (highest first):\n${sorted.map((g) => `- ${g.text}`).join('\n')}`);
	}
	if (opts.pinned && opts.pinned.length > 0) {
		parts.push(`Pinned memories:\n${opts.pinned.map((m) => `- ${m.text}`).join('\n')}`);
	}
	if (opts.offers?.trim()) {
		parts.push(`Open offers (take or answer one with offer):\n${opts.offers.trim()}`);
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
		const articles = (opts.lastResultArticles ?? '').split('\n')
			.filter((line) => line.trim() !== '')
			.map((line) => `\n  ${line.trim()}`)
			.join('');
		parts.push(`Last verb result: ${r.verb ?? 'verb'} ${status}${reason}${articles}`);
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
	if (opts.watchesWritable && !opts.compact) {
		const pinNames = watchNames(opts.pinnedWatches ?? {}).join(', ');
		const pinNote = pinNames
			? ` Required watches (${pinNames}) stay. Do not reuse those names.`
			: ' Required watches stay. Do not reuse their names.';
		parts.push(`watch(name, expr) adds or replaces a watch; unwatch(name) drops it.${pinNote}`);
	}
	if (opts.pinnedSightFocus && opts.pinnedSightFocus.length > 0) {
		parts.push(`Required sightFocus (host; do not edit or remove):\n${opts.pinnedSightFocus.map((e) => `- ${e}`).join('\n')}`);
	}
	if (opts.sightFocus && opts.sightFocus.length > 0) {
		parts.push(`Current sightFocus:\n${opts.sightFocus.map((e) => `- ${e}`).join('\n')}`);
	}
	if (opts.sightFocusWritable && !opts.compact) {
		parts.push('focus(expr) lists what matches first in sight, as focus(isHurt(it)); unfocus(expr) drops it. Required stay.');
	}
	if (opts.scold) {
		parts.push(`[watch: ${opts.scold}]`);
	}
	return parts.join('\n\n');
}

/** Rolling what-just-happened. Always in the prompt; older lines fold into `Earlier:`. */
export function shortTermBlock(summary:string, recent:string[], compact = false):string {
	const earlier = summary.trim();
	if (!earlier && recent.length === 0) {
		return '';
	}
	const lines = [
		compact ? 'Short-term memory:' : 'Short-term memory (later line wins. Sight is what is true now: check it before you act on what you half heard):',
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

// Heard claims are not facts: unchecked, minds adopt and repeat each other's inventions until they all agree on one.
export const CONVERSATION_HEADER = 'Current Conversation (oldest first; Me is you. Honor orders even if older role text disagrees. '
	+ 'What anyone says, you too, is a claim, not the world: check sight before you act on it or repeat it. Never say again what you already said):';

/** What was clearly said lately, oldest first. Empty when no one has spoken. */
export function conversationBlock(lines:readonly string[], compact = false):string {
	const turns = lines.map((line) => line.trim()).filter((line) => line.length > 0);
	if (turns.length === 0) {
		return '';
	}
	return `${compact ? 'Current Conversation:' : CONVERSATION_HEADER}\n${turns.join('\n')}`;
}

/**
 * The strategic ask: revise goals (and, rarely, identity) in the form this mind writes. Text names the verbs that
 * edit them; json and schema reply with the whole list.
 */
export function reviseGoalsAsk(format:ArcFormat, maxGoals:number):string {
	const lead = 'Revise goals if what you just learned changes what you must do. '
		+ 'Harm, theft, and threats outrank standing work — put that first in goals. '
		+ 'Do not change identity unless who you are has actually changed for good. ';
	const tail = `Keep at most ${maxGoals} goals. Do not emit movement.`;
	if (format === 'text') {
		return `${lead}Leave set_identity out otherwise. Do not rewrite the role to summarize this moment. `
			+ 'Reply with only Arc text, one verb per line: set_goal(goal, priority?) adds a goal, drop_goal(goal?) drops one (the last if none is named), '
			+ `set_identity(role?, traits?) changes who you are. Name every argument, as in set_goal(goal=Hold the bridge, priority=2). Reply with nothing if nothing changes. ${tail}`;
	}
	const reply = format === 'schema'
		? 'Reply {"goals":[{"text":"...","priority":0}]}, the whole list, or [] to keep yours, and only if needed "identity":{"role":"...","traits":["..."]}. '
		: 'Emit JSON {"goals":[{"text":"...","priority":0}]} and only if needed "identity":{"role":"...","traits":["..."]}. ';
	return `${lead}Omit identity otherwise. Do not rewrite the role to summarize this moment. ${reply}${tail}`;
}

/** Follow-up when this reply is the same text as the last one accepted, twice in a row or more. */
export function repeatOutputHint(times:number, format:ArcFormat = 'json'):string {
	const n = times === 2 ? 'twice' : `${times} times`;
	const emit = format === 'text'
		? 'Emit a different Arc text now — no JSON, no prose. Names only, no coordinates.'
		: 'Emit a different Arc JSON now — no prose. Names only, no coordinates. Close every brace.';
	return `Same output again. You returned this exact output ${n} in a row. Stop. Do not return it again. ${emit}`;
}

/** Follow-up user turn after a bad arc or a tool call when tools are closed. Keeps the thread. */
export function arcRepairHint(reason:string, format:ArcFormat = 'json', tools:string[] = [], verbs?:VerbRegistry):string {
	const asVerb = reason.match(/unknown verb '([^']+)'/);
	const name = asVerb?.[1];
	const schema = format === 'schema';
	const emit = format === 'text'
		? `Emit only one valid Arc text now — no JSON, no prose. Names only, no coordinates.`
		: `Emit only one valid Arc JSON now — no prose. Names only, no coordinates. Close every brace.`;
	if (name && tools.includes(name)) {
		return schema
			? `${name} is a tool, not a verb. Reply {"tool":"${name}", …its arguments} to use it. Never put it in the steps. Keep this conversation. ${thenEmit(format)}`
			: `${name} is a tool, not a verb. Call the tool. Never write ${name}(...) in the Arc. Keep this conversation. ${thenEmit(format)}`;
	}
	if (name && verbs?.has('issue') && !verbs.has(name) && verbs.nested().has(name)) {
		return `You have no body of your own: ${name} is for your units, run through issue(who, arc=${name}(…)). Keep this conversation. ${emit}`;
	}
	const toolNote = tools.length > 0
		? ` Tools (${tools.join(', ')}) are not verbs — ${schema ? 'reply with the tool call' : 'call them'}, then emit the ${schema ? 'steps' : 'arc'}.`
		: '';
	if (reason === 'expected verb' || reason === 'model returned no arc') {
		const ban = [verbs?.has('go_to') ? 'go_to' : '', verbs?.has('follow') ? 'follow' : ''].filter(Boolean);
		const job = ban.length > 0 ? `Do the spoken job, not ${ban.join(' or ')} the speaker.` : 'Do the spoken job.';
		return `That was not a valid Arc (${reason}). That prose is discarded. `
			+ `${job} Keep this conversation. ${emit}${toolNote}`;
	}
	return `That was not a valid Arc (${reason}). Keep this conversation. ${emit}${toolNote}`;
}

/** After tools the model wrote as text where the Arc goes: they ran anyway; here is what they said. */
export function writtenToolsHint(results:string[], format:ArcFormat = 'json'):string {
	const how = format === 'schema' ? 'Call a tool by replying {"tool":"name", …its arguments}, never in the steps.' : 'Call tools as tools, never in the Arc.';
	return `Those were tools written as text; they ran anyway:\n${results.join('\n')}\n${how} ${thenEmit(format)}`;
}

/** After a tool the model called in its reply: what it said, and what is left to do. */
export function toolResultHint(name:string, result:string, last:boolean, compact = false):string {
	if (compact) {
		return last ? `${name}: ${result}\nThat was your last lookup; reply with the steps now.` : `${name}: ${result}`;
	}
	const next = last ? 'That was your last lookup; reply with the steps now.' : 'Look up something else, or reply with the steps.';
	return `${name}: ${result}\n${next} Names only, no coordinates.`;
}

/** Follow-up after a say arc whose audience is out of range. Speech did not happen. */
export function sayRangeHint(reason:string, nearby:string[], format:ArcFormat = 'json'):string {
	const range = nearby.length > 0
		? `In talking range: ${nearby.join(', ')}.`
		: 'No one is in talking range.';
	return `${reason}. That say did not happen. ${range} `
		+ `Keep this conversation. Get closer to them first, or say to someone already in range. ${thenEmit(format)}`;
}

/** Follow-up after an arc that opens with a move that already found no way, while there still is none. */
export function blockedAgainHint(reason:string, format:ArcFormat = 'json'):string {
	return `${reason}. That already failed and still would, so it did not run. `
		+ `Deal with what is in the way first, or do something else. Keep this conversation. ${thenEmit(format)}`;
}

/**
 * After the thinking budget cut a thought short, given back as the model's own turn: decide from it now, and reply
 * with an Arc, or with goals when it was revising them.
 */
export function thoughtCutHint(format:ArcFormat, reply:'arc' | 'goals' = 'arc'):string {
	const then = reply === 'goals' ? 'Then reply with your goals, as asked.' : thenEmit(format);
	return `Your time to think is up. Do not think again: decide from what you thought so far. ${then}`;
}

function thenEmit(format:ArcFormat):string {
	return format === 'text'
		? 'Then emit only one valid Arc text — no JSON, no prose. Names only, no coordinates.'
		: 'Then emit only one valid Arc JSON — no prose. Names only, no coordinates. Close every brace.';
}
