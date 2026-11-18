import type { SightClause } from '../perception/perception-types.js';
import { isRecord } from '../json.js';
import { keptText, mergeTags, nameTags, type MemoryRecord } from '../memory/store.js';
import { idsIn, joinTextWithIDs, readTextWithIDs, textSegments, parseTextWithIDs, showTextWithIDs, type TextWithIDs } from '../character/text-with-ids.js';
import { hand, internalsOf } from '../internals.js';
import { nothingRecalled } from './prompt.js';
import type { Mind, MindJSON } from './mind.js';
import type { ConversationTurn, HeldEvent, HeldTurn, Manner, TurnDraft } from './mind-types.js';

const RECENT_CAP = 8;
const RECENT_SUMMARY_MAX = 600;
const RECENT_SEPARATOR = '; ';
const BARE_RESULT = new Set(['ok', 'failed', 'stopped']);
/** Thinks a muffled line stays in short-term memory. */
const MUFFLED_THINKS = 2;

/** `text` on one line: its runs of space as one, none at either end. */
function tidy(text:TextWithIDs):TextWithIDs {
	const out = text.map((part, i) => (i % 2 === 1 ? part : part.replace(/\s+/g, ' ')));
	out[0] = out[0].trimStart();
	out[out.length - 1] = out[out.length - 1].trimEnd();
	return out;
}

/** The folded summary's lines with `overflow` added, the oldest whole lines dropped past the cap. */
function foldRecent(prev:readonly TextWithIDs[], overflow:readonly TextWithIDs[]):TextWithIDs[] {
	const lines = [...prev, ...overflow].map(tidy).filter((line) => showTextWithIDs(line).length > 0);
	let letters = lines.reduce((n, line) => n + showTextWithIDs(line).length + RECENT_SEPARATOR.length, -RECENT_SEPARATOR.length);
	while (lines.length > 1 && letters > RECENT_SUMMARY_MAX) {
		letters -= showTextWithIDs(lines.shift()!).length + RECENT_SEPARATOR.length;
	}
	return lines;
}

/**
 * One quarter of the context window, in letters. English runs about 4 letters a token, so this is
 * `contextTokens / 4 * 4`. An unknown window is unlimited. 0 shows none.
 */
export function conversationCapFor(contextTokens:number | undefined):number {
	if (contextTokens === undefined || !Number.isFinite(contextTokens)) {
		return Number.POSITIVE_INFINITY;
	}
	if (contextTokens <= 0) {
		return 0;
	}
	return Math.floor(contextTokens / 4 * 4);
}

/** The `query` of `recall`'s `args`, `''` without one. */
export function recallQuery(args:unknown):string {
	return isRecord(args) && typeof args.query === 'string' ? args.query : '';
}

/** A result that says nothing past how it went (`ok`, `wait: 5s`), its verb aside. */
function isBareResult(text:string):boolean {
	const t = text.trim().toLowerCase().replace(/^\w+: /, '');
	return !t || BARE_RESULT.has(t) || /^\d+s$/.test(t);
}

/** What only its mind can tell its memory: an event as it keeps it (itself as "you", others by id), who is the mind itself, and what embeds a memory. */
export type MemoryHooks = {
	kept(event:HeldEvent):{ text:TextWithIDs; tags:string[] };
	/** The events it holds for its next think. */
	events():readonly HeldEvent[];
	isSelf(id:string):boolean;
	/** Whether character `id` has fallen, so it is no longer worth remembering where it was last seen. */
	hasFallen(id:string):boolean;
	controls(id:string):boolean;
	embed():((texts:string[])=>Promise<number[][]>) | undefined;
	/** How a turn was said, in words (`growls angrily`), or `''` plainly. */
	manner(turn:Manner):string;
};

/**
 * What a mind's memory hands its mind (`internalsOf`): taking events in (by default all it holds for its next think),
 * each once, and whether it took one in, which a think that ends well drops.
 */
export type MindMemoryFields = {
	absorb(events?:readonly HeldEvent[]):void;
	absorbed(event:HeldEvent):boolean;
};

/** A memory as a prompt shows it: in the mind's names. */
export type ShownMemory = Omit<MemoryRecord, 'text' | 'segments'> & { text:string };

/** What a prompt shows of a mind's memory: what it recalls, its recent lines and their summary, the conversation. */
export type MemoryLines = { recalled:ShownMemory[]; recent:string[]; recentSummary:string; conversation:string[] };

/**
 * A mind's memory and conversation: its recent lines, Current Conversation, the sightings and facts it keeps in its
 * persona's long-term memory, and what it recalls for a prompt. Every mind has one (`mind.memory`). Long-term memory
 * keeps characters by id, so a character that joins or leaves a collective keeps what it knows; each mind reads it in
 * its own names.
 */
export class MindMemory<TCtx = unknown> {
	private _recent:TextWithIDs[] = [];
	private _recentSummary:TextWithIDs[] = [];
	/** Its recent lines that are speech it could not make out: who said each, and how many more thinks it stays. */
	private readonly _muffled = new Map<TextWithIDs, { speakerID:string; thinks:number }>();
	private _conversation:HeldTurn[] = [];
	/** The events it took in. */
	private readonly _absorbed = new WeakSet<HeldEvent>();
	/** What its sight showed since it last noted sightings. */
	private _sighted:readonly SightClause[] = [];
	/** What is before it this think, and how much each should bring its memories to mind. */
	private _salience:ReadonlyMap<string, number> = new Map();
	/** Whether its last prompt (`lines`) shows a memory already, so `recall` need not bring it back. */
	private _onScreen:(record:MemoryRecord)=>boolean = () => false;
	public lastIntrusionTimestamp = Number.NEGATIVE_INFINITY;

	constructor(private readonly _mind:Mind<TCtx>, private readonly _hooks:MemoryHooks) {
		hand(this, { absorb: (events) => this.absorb(events), absorbed: (event) => this._absorbed.has(event) } satisfies MindMemoryFields);
	}

	private get now():number {
		return this._mind.now;
	}

	/**
	 * Its own words (`text`, in its names) as kept: each name it gave as that one's id, read once. A vague label
	 * (`FigureA`) stays a word: kept as who it is, it would name them once recalled.
	 */
	private inIDs(text:string):TextWithIDs {
		return parseTextWithIDs(text, (word) => this._mind.persona.names.idOf(word));
	}

	/** Long-term memory in its names; never in vague labels, which would tell who a vague figure is. */
	private inNames(text:TextWithIDs):string {
		return showTextWithIDs(text, (id) => this._mind.persona.names.peek(id, false) ?? id);
	}

	/** What it heard or did lately, in its names for them now, its vague labels too. */
	private shown(text:TextWithIDs):string {
		return showTextWithIDs(text, (id) => this._mind.nameOf(id));
	}

	/** A query in its words with ids for its names, as its memory is searched. */
	private query(text:string):string {
		return showTextWithIDs(this.inIDs(text));
	}

	/** Every id its memories, recent lines, conversation and last sight still name: whose names its book must keep. */
	public ids():string[] {
		return [
			...this._mind.persona.memory.all().flatMap((r) => idsIn(keptText(r))),
			...[...this._recent, ...this._recentSummary].flatMap(idsIn),
			...this._conversation.flatMap((turn) => [turn.speakerID, ...turn.to ?? [], ...idsIn(turn.text)]),
			...this._sighted.flatMap((clause) => clause.claimedIDs),
		];
	}

	/** Its persona's pinned memories, in its names. */
	public pinned():{ text:string }[] {
		return this._mind.persona.memory.pinned().map((r) => ({ ...r, text: this.inNames(keptText(r)) }));
	}

	/** What its sight showed this think, by id, and how much each id in it should bring its memories to mind. */
	public sighted(clauses:readonly SightClause[], salience?:ReadonlyMap<string, number>):void {
		this._sighted = clauses;
		this._salience = salience ?? new Map();
	}

	/** Takes `events`, by default all it holds for its next think, into recent lines, the conversation and long-term memory: each once. */
	private absorb(events = this._hooks.events()):void {
		const persona = this._mind.persona;
		for (const e of events.filter((event) => !this._absorbed.has(event))) {
			this._absorbed.add(e);
			// Long-term memory keeps others by id.
			const { text: fact, tags: factTags } = this._hooks.kept(e);
			const text = this.shown(fact).trim();
			if (!text) {
				continue;
			}
			const factLine = showTextWithIDs(fact).trim();
			// go_to is a walk. It is not a line of chat, and it does not fill short-term or Current Conversation.
			const walk = e.tags?.includes('go_to') === true;
			if (e.kind === 'arc_result') {
				if (isBareResult(text)) {
					continue;
				}
				if (!walk && !e.tags?.includes('said')) {
					this.noteRecent(fact);
				}
				if (e.remember) {
					this.keepFact(fact, mergeTags(['result'], factTags, nameTags(factLine)));
				}
				continue;
			}
			const who = e.who;
			// Speech it could not make out (no turn): a newer line from its speaker takes its place.
			const muffled = e.kind === 'HeardSpeech' && !e.turn;
			if (e.kind === 'HeardSpeech') {
				this.dropMuffled((line) => line.speakerID === who[0]);
			}
			// A deed between one of its own and another, worth keeping (a gift, a trade), reads as part of the
			// conversation; a passing one (a blow in a fight) is only short-term memory.
			const betweenUs = !muffled && !e.turn && e.remember === true && who.length >= 2 && who.some((id) => this._hooks.controls(id));
			// A walk with no spoken turn is not chat. Speech still is, even beside a walk tag.
			if (!(walk && !e.turn)) {
				if (betweenUs) {
					this.keepTurn({ speakerID: '', text: fact });
				}
				else if (e.turn) {
					this.keepTurn(e.turn);
				}
				else {
					const line = this.noteRecent(fact);
					if (line && muffled) {
						this._muffled.set(line, { speakerID: who[0], thinks: MUFFLED_THINKS });
					}
				}
			}
			if (e.remember || (betweenUs && !walk)) {
				const tags = betweenUs ? mergeTags(factTags, ['act'], nameTags(factLine)) : mergeTags(factTags, nameTags(factLine));
				const last = persona.memory.all().at(-1);
				if (!last || last.text !== factLine) {
					internalsOf(persona.memory).add({
						category: 'episodic',
						text: tidy(fact),
						tags,
						timestamp: e.timestamp ?? this.now,
					}, e.timestamp ?? this.now);
				}
			}
		}
	}

	/** A line said, in the conversation it shows: its text in this mind's names, as its model wrote it (as {@link remember} reads it). */
	public noteConversation(turn:Omit<TurnDraft, 'text'> & { text:string }):void {
		this.keepTurn({ ...turn, text: this.inIDs(turn.text) });
	}

	/** Drops oldest messages past the letter budget. A cap of 0 still keeps the window's quarter, so raising it shows them. */
	private keepTurn(turn:HeldTurn):void {
		const text = tidy(turn.text);
		const last = this._conversation[this._conversation.length - 1];
		if (!showTextWithIDs(text) || (last?.speakerID === turn.speakerID && showTextWithIDs(last.text) === showTextWithIDs(text))) {
			return;
		}
		this._conversation.push({ ...turn, text });
		const cap = this._mind.setting('conversationCap');
		const budget = cap !== undefined && cap > 0 ? cap : conversationCapFor(this._mind.thinksWith.contextTokens);
		const kept = this.turnsWithin(this._conversation, budget);
		const start = kept.length > 0 ? this._conversation.length - kept.length : this._conversation.length - 1;
		this._conversation.splice(0, Math.max(0, start));
	}

	/** The newest whole messages whose rendered lines fit in `cap` letters. */
	private turnsWithin(turns:readonly HeldTurn[], cap:number):HeldTurn[] {
		if (cap <= 0) {
			return [];
		}
		let used = 0;
		let start = turns.length;
		for (let i = turns.length - 1; i >= 0; i--) {
			const n = this.conversationLine(turns[i]).length;
			if (used + n > cap) {
				break;
			}
			used += n;
			start = i;
		}
		return turns.slice(start);
	}

	/** The turns Current Conversation shows, oldest first. */
	private shownTurns():HeldTurn[] {
		const cap = this._mind.setting('conversationCap') ?? conversationCapFor(this._mind.thinksWith.contextTokens);
		return this.turnsWithin(this._conversation, cap);
	}

	/**
	 * `Me (to Forager): …`, `Wolf (growls, to you): …`, `Guard (angrily): …` to everyone, with how it was said. Each id is
	 * named as this mind knows it now.
	 */
	private conversationLine(turn:HeldTurn):string {
		if (!turn.speakerID) {
			return this.shown(turn.text);
		}
		const named = (id:string, self:string):string => (this._hooks.isSelf(id) ? self : this._mind.nameOf(id));
		const to = (turn.to ?? []).map((id) => named(id, 'you'));
		const notes = [this._hooks.manner(turn), to.length > 0 && `to ${to.join(', ')}`].filter(Boolean);
		return `${named(turn.speakerID, 'Me')}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}: ${this.shown(turn.text)}`;
	}

	private conversationLines():string[] {
		return this.shownTurns().map((turn) => this.conversationLine(turn));
	}

	/** Whether character `id` said something it heard clearly lately: a line of `id`'s is still in its conversation. */
	public heardFrom(id:string):boolean {
		return this._conversation.some((turn) => turn.speakerID === id);
	}

	/** What was said and heard lately, as its prompt shows it: short-term memory, then the conversation. */
	public talkedOf():string[] {
		return [...this._recent.map((line) => this.shown(line)), ...this.conversationLines()];
	}

	/** `line` among its recent lines, as kept; none when it is empty or the last one again. */
	private noteRecent(line:TextWithIDs):TextWithIDs | undefined {
		const text = tidy(line);
		const last = this._recent.at(-1);
		if (!showTextWithIDs(text) || (last && showTextWithIDs(last) === showTextWithIDs(text))) {
			return undefined;
		}
		this._recent.push(text);
		if (this._recent.length > RECENT_CAP) {
			// A muffled line is never summed up.
			const overflow = this._recent.splice(0, this._recent.length - RECENT_CAP).filter((old) => !this._muffled.delete(old));
			this._recentSummary = foldRecent(this._recentSummary, overflow);
		}
		return text;
	}

	/** A think ended: each muffled line has one think fewer to stay, and leaves short-term memory at none. */
	public thought():void {
		this.dropMuffled((line) => --line.thinks <= 0);
	}

	/** Drops each muffled line `gone` says from its recent lines. */
	private dropMuffled(gone:(line:{ speakerID:string; thinks:number })=>boolean):void {
		for (const [text, line] of this._muffled) {
			if (gone(line)) {
				this._muffled.delete(text);
				this._recent = this._recent.filter((kept) => kept !== text);
			}
		}
	}

	private keepFact(text:TextWithIDs, tags:string[]):void {
		const line = tidy(text);
		const memory = this._mind.persona.memory;
		const last = memory.all().at(-1);
		if (!showTextWithIDs(line) || (last && last.text === showTextWithIDs(line))) {
			return;
		}
		internalsOf(memory).add({ category: 'semantic', text: line, tags, timestamp: this.now }, this.now);
	}

	/**
	 * One "Last I saw" memory per id its sight showed, kept to the latest clause it was seen in; none for what it could
	 * not make out (its clause names no one), and none kept of anyone fallen.
	 */
	public noteSeen():void {
		const memory = this._mind.persona.memory;
		for (const record of memory.all()) {
			const seen = record.tags.find((tag) => tag.startsWith('seen:'));
			if (seen && this._hooks.hasFallen(seen.slice('seen:'.length))) {
				memory.remove(record.id);
			}
		}
		// A clause names only whom it claims, so only their names in it are read back as them.
		const sightings = this._sighted.flatMap((clause) => {
			const claimed = new Map(clause.claimedIDs.map((id) => [this._mind.nameOf(id), id]));
			const snippet = parseTextWithIDs(clause.text.trim(), (word) => claimed.get(word));
			return clause.claimedIDs.map((id) => ({ id, snippet }));
		});
		this._sighted = [];
		for (const { id, snippet } of sightings) {
			if (this._hooks.isSelf(id) || !showTextWithIDs(snippet) || this._hooks.hasFallen(id)) {
				continue;
			}
			const line = joinTextWithIDs('Last I saw ', ['', id, ''], ': ', snippet);
			const tag = `seen:${id}`;
			const existing = memory.all().find((r) => r.category === 'semantic' && r.tags.includes(tag));
			if (existing) {
				if (existing.text !== showTextWithIDs(line)) {
					internalsOf(memory).rewrite(existing.id, line);
					existing.lastAccessed = this.now;
				}
				continue;
			}
			internalsOf(memory).add({ category: 'semantic', text: line, tags: mergeTags([tag, id, 'seen'], nameTags(showTextWithIDs(snippet))), timestamp: this.now }, this.now);
		}
	}

	/** What its prompt shows of its memory, in its names: what `scene` and its goals and `about` bring to mind, then its recent lines and the conversation. */
	public lines(scene = '', about = ''):MemoryLines {
		const persona = this._mind.persona;
		const conversation = this.conversationLines();
		// Searched in ids: its goals and `about` read once from its words, the rest kept in ids already.
		const query = [...persona.goals.map((g) => this.query(g.text)), this.query(about), ...[...this._recent, ...this._recentSummary].map((line) => showTextWithIDs(line)), ...this._conversation.map((turn) => showTextWithIDs(turn.text))]
			.filter((s) => s.trim().length > 0).join(' ');
		const recent = this._recent.map((line) => this.shown(line));
		const pinnedIds = new Set(persona.memory.pinned().map((r) => r.id));
		const recentSet = new Set(recent);
		// Speech and acts still in Current Conversation are already on screen.
		const quoting = this.shownTurns().map((turn) => `"${this.inNames(turn.text)}"`);
		const shown = new Set(conversation);
		const skip = (r:MemoryRecord):boolean => {
			const text = this.inNames(keptText(r));
			const onScreen = (r.tags.includes('speech') && quoting.some((quote) => text.endsWith(quote)))
				|| (r.tags.includes('act') && shown.has(text));
			if (r.pinned || pinnedIds.has(r.id) || recentSet.has(text) || onScreen) {
				return true;
			}
			const seen = r.tags.find((t) => t.startsWith('seen:') && t.length > 5);
			return !!seen && scene.includes(this.inNames(['', seen.slice('seen:'.length), '']));
		};
		const recalled = !query.trim() ? [] : persona.memory.recall({
			query,
			k: this._mind.setting('recallK'),
			now: this.now,
			salience: this._salience,
			skip,
		}).map((r) => ({ ...r, text: this.inNames(keptText(r)) }));
		const listed = new Set(recalled.map((r) => r.id));
		this._onScreen = (r) => listed.has(r.id) || skip(r);
		return { recalled, recent, recentSummary: this._recentSummary.map((line) => this.shown(line)).join(RECENT_SEPARATOR), conversation };
	}

	/** A memory `perceptionText` and the `tags` of what happened bring to mind unbidden, at most once a cooldown. */
	public intrude(perceptionText:string, tags:string[]):string | undefined {
		if (this.now - this.lastIntrusionTimestamp < this._mind.setting('intrusionCooldown')) {
			return undefined;
		}
		const hit = this._mind.persona.memory.intrusion({ query: this.query(perceptionText), now: this.now, tags, threshold: this._mind.setting('intrusionThreshold') });
		if (!hit || hit.tags.includes('seen')) {
			return undefined;
		}
		this.lastIntrusionTimestamp = this.now;
		return this.inNames(keptText(hit));
	}

	/** `text`, in its names, as a fact it knows, kept in ids and embedded where its director has an embedding model. */
	public async remember(said:string, tags:string[] = [], timestamp = this.now):Promise<MemoryRecord> {
		const text = this.inIDs(said);
		const line = showTextWithIDs(text);
		const [embedding] = await this.embed(line);
		const names = this._mind.persona.names;
		return internalsOf(this._mind.persona.memory).add({ category: 'semantic', text, tags: mergeTags(tags.map((tag) => names.idOf(tag) ?? tag), nameTags(line)), timestamp, embedding }, timestamp);
	}

	/**
	 * What `recall` with `args` (`query`, `k`) brings back from memory that its prompt does not show already (its last
	 * `lines`): the best matches. None is said plainly by {@link nothingMore}.
	 */
	public async recall(args:unknown):Promise<{ id:string; text:string; tags:string[]; category:MemoryRecord['category'] }[]> {
		const query = recallQuery(args);
		const row = isRecord(args) ? args : {};
		const k = typeof row.k === 'number' ? row.k : this._mind.setting('recallK');
		const searched = this.query(query);
		const [embedding] = query ? await this.embed(searched) : [];
		return this._mind.persona.memory.recall({ query: searched, k, now: this.now, embedding, skip: this._onScreen })
			.map((r) => ({ id: r.id, text: this.inNames(keptText(r)), tags: r.tags, category: r.category }));
	}

	/** What `recall` with `args` answers when it finds nothing its prompt does not show: so, and where else to look. */
	public nothingMore(args:unknown):string {
		return nothingRecalled(recallQuery(args), this._mind.owner.activeVerbs());
	}

	/** `text` embedded, or nothing without an embedding model or when it fails. */
	private async embed(text:string):Promise<(number[] | undefined)[]> {
		try {
			return await this._hooks.embed()?.([text]) ?? [];
		}
		catch {
			return [];
		}
	}

	public toJSON():Pick<MindJSON, 'recent' | 'recentSummary' | 'conversation' | 'lastIntrusionTimestamp'> {
		return {
			lastIntrusionTimestamp: Number.isFinite(this.lastIntrusionTimestamp) ? this.lastIntrusionTimestamp : undefined,
			recent: this._recent.map((line) => [...line]),
			recentSummary: this._recentSummary.length > 0 ? this._recentSummary.map((line) => [...line]) : undefined,
			conversation: this._conversation.map((turn) => ({ ...turn, text: [...turn.text] })),
		};
	}

	public load(json:MindJSON):void {
		this.lastIntrusionTimestamp = json.lastIntrusionTimestamp ?? Number.NEGATIVE_INFINITY;
		this._recent = (json.recent ?? []).map(readTextWithIDs);
		this._recentSummary = (json.recentSummary ?? []).map(readTextWithIDs);
		this._conversation = (json.conversation ?? []).map((turn) => ({ ...turn, text: readTextWithIDs(turn.text) }));
		// What it remembers has them already.
		this._hooks.events().forEach((event) => this._absorbed.add(event));
	}
}
