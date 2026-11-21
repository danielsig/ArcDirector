import type { SightClause } from '../perception/perception-types.js';
import { isRecord, type JsonValue } from '../json.js';
import { cosine, keptText, mergeTags, nameTags, restsOnFact, union, type Meaning, type MemoryRecord, type MemoryStore, type RestsOn } from '../memory/store.js';
import { seeded } from '../random.js';
import { idsIn, joinTextWithIDs, readTextWithIDs, parseTextWithIDs, showTextWithIDs, type TextWithIDs } from '../character/text-with-ids.js';
import { hand, internalsOf } from '../internals.js';
import { ago, nothingRecalled } from './prompt.js';
import type { Mind, MindJSON } from './mind.js';
import type { HeldEvent, HeldTurn, Manner, TurnDraft } from './mind-types.js';
import type { FeelingLevels, Mood } from '../character/feeling.js';
import { centroid, dot, sub, unit } from '../world/vec.js';
import type { Vec } from '../world/world-types.js';
import { showInPerson, writerToID } from '../character/person.js';

const RECENT_CAP = 8;
/** Most things it is told changed in one think. */
const MAX_CHANGES = 3;
const RECENT_SUMMARY_MAX = 600;
const RECENT_SEPARATOR = '; ';
const BARE_RESULT = new Set(['ok', 'failed', 'stopped']);
/** Thinks a muffled line stays in short-term memory. */
const MUFFLED_THINKS = 2;
const SEEN = 'seen:';
/** The tag of a sighting of a thing found gone from where it was seen. */
const GONE = 'gone';
/**
 * Memories of nothing in particular: how close what a mind perceives comes to them, on average, is where a memory's
 * meaning starts to count ({@link Meaning}). Measured so, small and large embedding models alike put a memory that fits
 * a sight about 0.15 above it, and one that does not near 0, in every setting tried: fantasy, a ship, a space station,
 * a noir city, the Old West, horror and a farm.
 */
const PLAIN_MEMORIES = ['I remember an ordinary day.', 'I once walked down a road.', 'I met someone at the market once.', 'I used to live in a house.', 'I sold something to a man once.', 'I talked with a friend.'];

/** `text` on one line: its runs of space as one, none at either end. */
function tidy(text:TextWithIDs):TextWithIDs {
	const out = text.map((part, i) => (i % 2 === 1 ? part : part.replace(/\s+/g, ' ')));
	out[0] = out[0].trimStart();
	out[out.length - 1] = out[out.length - 1].trimEnd();
	return out;
}

/** A recent line, by id, the game time of what it tells, the characters that know it, and the fact it rests on. */
interface KeptLine { text:TextWithIDs; at:number; knownBy:string[]; restsOn?:RestsOn }

/** A recent line as a save keeps it. */
export interface KeptLineJSON { text:JsonValue; at:number; knownBy:string[]; restsOn?:RestsOn }

/** A turn of the conversation, the game time it was said, and the characters that heard it. */
interface KeptTurn extends HeldTurn {
	at:number;
	knownBy:string[];
}

/** The folded summary's lines with `overflow` added, the oldest whole lines dropped past the cap. */
function foldRecent(prev:readonly KeptLine[], overflow:readonly KeptLine[]):KeptLine[] {
	const lines = [...prev, ...overflow].map((line) => ({ ...line, text: tidy(line.text) })).filter((line) => showTextWithIDs(line.text).length > 0);
	let letters = lines.reduce((n, line) => n + showTextWithIDs(line.text).length + RECENT_SEPARATOR.length, -RECENT_SEPARATOR.length);
	while (lines.length > 1 && letters > RECENT_SUMMARY_MAX) {
		letters -= showTextWithIDs(lines.shift()!.text).length + RECENT_SEPARATOR.length;
	}
	return lines;
}

function lineToJSON({ text, at, knownBy, restsOn }:KeptLine):KeptLineJSON {
	return { text: [...text], at, knownBy: [...knownBy], ...restsOn ? { restsOn } : {} };
}

function lineFromJSON({ text, at, knownBy, restsOn }:KeptLineJSON):KeptLine {
	return { text: readTextWithIDs(text), at, knownBy: [...knownBy], ...restsOn ? { restsOn } : {} };
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

/** What only its mind can tell its memory: the events it holds, who is the mind itself, and what embeds a memory. */
export interface MemoryHooks {
	/** The events it holds for its next think. */
	events():readonly HeldEvent[];
	isSelf(id:string):boolean;
	/** Who knows what only the mind did or decided: its voice, which writes its notes, then its owner. */
	ownKnowers():string[];
	/** The collective it thinks for, whose words for itself (`we`) its notes keep as its id. */
	group():string | undefined;
	/** Whether character `id` has fallen, so it is no longer worth remembering where it was last seen. */
	hasFallen(id:string):boolean;
	controls(id:string):boolean;
	embed():((texts:string[])=>Promise<number[][]>) | undefined;
	/** Character `id`'s mood (`FeelingFeature.moodOf`): its voice's, or one of its collective's characters'. */
	moodOf(id:string):Mood | undefined;
	/** Its character `id` feels each of `levels` that much more (`FeelingFeature.stir`): what a memory that comes back stirs. */
	stir(id:string, levels:FeelingLevels):void;
	/** How a turn was said, in words (`growls angrily`), or `''` plainly. */
	manner(turn:Manner):string;
}

/**
 * What a mind's memory hands its mind (`internalsOf`): taking events in (by default all it holds for its next think),
 * each once, and whether it took one in, which a think that ends well drops.
 */
export interface MindMemoryFields<TCtx> {
	absorb(events?:readonly HeldEvent[]):void;
	absorbed(event:HeldEvent):boolean;
	/** Takes from `from` what character `id` knows of its recent lines and conversation; `from` keeps what others of its still know. */
	adopt(from:MindMemory<TCtx>, id:string):void;
	/** Its think ended well: each sighting keeps the state it saw, so a think that fails is told the change again. */
	commitSeen():void;
	/** It forgets what rests on `fact`, now that it is so no more: its recent lines of it, and its memories. */
	forgetRestingOn(fact:RestsOn):void;
}

/** `id`'s part of `lines`, taken out: what only it knew goes, what others knew too stays known by them. */
export function takeOut<T extends { knownBy:string[] }>(lines:readonly T[], id:string):{ taken:T[]; left:T[] } {
	const taken = lines.filter((line) => line.knownBy.includes(id));
	const left = lines.flatMap((line) => {
		const rest = line.knownBy.filter((who) => who !== id);
		return !line.knownBy.includes(id) ? [line] : rest.length > 0 ? [{ ...line, knownBy: rest }] : [];
	});
	return { taken, left };
}

/**
 * Whether `line` is one of `held` again, the same text at the same time (and `alike`), come a second way: a waiting
 * event or a line moved back from a mind that thought for one of its characters for a while. Then its knowers join it.
 */
function joinHeld<T extends { text:TextWithIDs; at:number; knownBy:string[] }>(held:readonly T[], line:T, alike:(had:T)=>boolean = ():boolean => true):boolean {
	const shown = showTextWithIDs(line.text);
	const had = held.find((old) => old.at === line.at && alike(old) && showTextWithIDs(old.text) === shown);
	if (had) {
		had.knownBy = union(had.knownBy, line.knownBy);
	}
	return had !== undefined;
}

/** The tag of every "last saw" memory of `id`. */
export function seenTag(id:string):string {
	return SEEN + id;
}

/** Whom a "last saw" memory is of; undefined for any other memory. */
function seenID(record:MemoryRecord):string | undefined {
	return record.tags.find((tag) => tag.startsWith(SEEN) && tag.length > SEEN.length)?.slice(SEEN.length);
}

/** `seer`'s own sightings in `memory` of things that are no character, where it saw each, as far as it knows still there. */
export function placedSightings(memory:MemoryStore, seer:string):{ id:string; at:Vec; record:MemoryRecord }[] {
	return memory.all().flatMap((record) => {
		const id = seenID(record);
		const own = record.knownBy.length === 1 && record.knownBy[0] === seer;
		return id && own && record.at && !record.tags.includes(GONE) ? [{ id, at: record.at, record }] : [];
	});
}

/** `seer`'s own last sighting of `id` in `memory`: the one only it knows. */
export function ownSighting(memory:MemoryStore, id:string, seer:string):MemoryRecord | undefined {
	return memory.all().find((r) => r.tags.includes(seenTag(id)) && r.knownBy.length === 1 && r.knownBy[0] === seer);
}

/** What a look showed beside its clauses ({@link MindMemory.sighted}), each thing by id. */
export interface Sighted {
	/** How much each thing before the mind should bring its memories to mind. */
	salience?:ReadonlyMap<string, number>;
	/** The state each thing was seen in (`SeenObject.state`). */
	states?:ReadonlyMap<string, Readonly<Record<string, string>>>;
	/** Where each thing that is no character was seen. */
	points?:ReadonlyMap<string, Vec>;
	/** Sightings of things the look now shows nothing of, where it makes out clearly the spot they were seen at. */
	gone?:readonly MemoryRecord[];
}

/**
 * A memory that comes back stirs what it was felt with this strongly, by its weight (half, at weight 1). By meaning alone
 * (no `MemoryRecord.felt`), by the square of how far it leans toward each feeling, so a faint lean stirs next to nothing:
 * tried on three embedding models over 296 memories, a memory of a feeling stirred it 0.07 to 0.10 on average (at most
 * 0.5), and a plain memory 0.04 to 0.07 spread over all of them (at most 0.26), none enough to show.
 */
const STIR = 0.5;
/**
 * Where a memory starts coming to mind more readily for being like its mind's interests (plain memories 0, the interest
 * lines 1), and where twice as readily. Everything with meaning leans their way a little (about 0.3 on average), so the
 * bar sits above it: tried on three embedding models with three interests, 62% of a mind's memories of an interest pass
 * 0.45 and 7% of the rest; almost none of either passes 0.65.
 */
const CARES_FROM = 0.45;
const CARES_FULL = 0.65;

/** How much more readily a memory naming each one comes to mind, by id: 1 plus what it feels toward them (`toward`), summed. */
function bondsOf(toward:ReadonlyMap<string, FeelingLevels>):Record<string, number> {
	return Object.fromEntries([...toward].map(([id, levels]) => [id, 1 + Object.values(levels).reduce((sum, level) => sum + level, 0)]));
}

/** How memories lean toward a mind's mood and what it cares about: what tints what comes to mind, and what it stirs. */
export interface MemoryLens {
	/** How much more readily `record` comes to mind unbidden (1: no more). */
	boost(record:MemoryRecord):number;
	/** What `record` stirs as it comes back in each of the mind's characters who holds it, by id. */
	stirs(record:MemoryRecord):ReadonlyMap<string, FeelingLevels>;
	/** How much more readily a memory naming each one comes to mind, by id ({@link bondsOf}). */
	bonds:Readonly<Record<string, number>>;
}

/** A memory as a prompt shows it: in the mind's names. */
export interface ShownMemory extends Omit<MemoryRecord, 'text' | 'segments'> {
	text:string;
}

/** What a prompt shows of a mind's memory: what it recalls, its recent lines and their summary, the conversation. */
export interface MemoryLines { recalled:ShownMemory[]; recent:string[]; recentSummary:string; conversation:string[] }

/**
 * A mind's memory and conversation: its recent lines, Current Conversation, the sightings and facts it keeps in its
 * persona's long-term memory, and what it recalls for a prompt. Every mind has one (`mind.memory`). Long-term memory
 * is its persona's view of the cast's pool, by who knows each record, so nothing is copied when a character joins or
 * leaves a collective; what it holds for the moment moves with the character (`adopt`). Each mind reads it in its own
 * names, itself as "you".
 */
export class MindMemory<TCtx = unknown> {
	private _recent:KeptLine[] = [];
	private _recentSummary:KeptLine[] = [];
	/** Its recent lines that are speech it could not make out: who said each, and how many more thinks it stays. */
	private readonly _muffled = new Map<KeptLine, { speakerID:string; thinks:number }>();
	private _conversation:KeptTurn[] = [];
	/** The events it took in. */
	private readonly _absorbed = new WeakSet<HeldEvent>();
	/** What its sight showed since it last noted sightings. */
	private _sighted:readonly SightClause[] = [];
	/** What else its last look showed: each thing's state and point, and the things it found gone. */
	private _seen:Sighted = {};
	/** The state each sighting of this think's look saw, kept once the think ends well ({@link MindMemoryFields.commitSeen}). */
	private _seenStates:{ record:MemoryRecord; state:Readonly<Record<string, string>> | undefined }[] = [];
	/** The sightings of things this think's look found gone, marked so once the think ends well. */
	private _gone:MemoryRecord[] = [];
	/** Whether its last prompt (`lines`) shows a memory already, so `recall` need not bring it back. */
	private _onScreen:(record:MemoryRecord)=>boolean = () => false;
	/** {@link PLAIN_MEMORIES} embedded, once there is an embedding model. */
	private _plain:number[][] | undefined;
	/** Each feeling's memories (`FeelingDef.memories`) and each interest (`PersonaSpec.interests`) embedded, by text. */
	private readonly _anchors = new Map<string, number[]>();
	public lastIntrusionTimestamp = Number.NEGATIVE_INFINITY;

	constructor(private readonly _mind:Mind<TCtx>, private readonly _hooks:MemoryHooks) {
		hand(this, { absorb: (events) => this.absorb(events), absorbed: (event) => this._absorbed.has(event), adopt: (from, id) => this.adopt(from, id), commitSeen: () => this.commitSeen(), forgetRestingOn: (fact) => this.forgetRestingOn(fact) } satisfies MindMemoryFields<TCtx>);
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

	/**
	 * Long-term memory in its names and its own person ("you"), never in vague labels, which would tell who a vague
	 * figure is: one it never made out has the naming rule's name.
	 */
	private inNames(text:TextWithIDs, writer?:string):string {
		return showInPerson(text, (id) => this._hooks.isSelf(id), (id) => this._mind.nameOf(id, false), writer);
	}

	/**
	 * A memory as it reads it, {@link inNames}. A note that does not name its writer has the writer's name in front for
	 * anyone else: `Cy: Player owes 5 gold for boots`.
	 */
	private recordText(record:MemoryRecord):string {
		const text = keptText(record);
		const writer = record.writer;
		const bare = writer !== undefined && !idsIn(text).includes(writer) && !this._hooks.isSelf(writer);
		return bare ? `${this._mind.nameOf(writer, false)}: ${this.inNames(text, writer)}` : this.inNames(text, writer);
	}

	/** What it heard or did lately, in its names for them now, its vague labels too, and its own person. */
	private shown(text:TextWithIDs):string {
		return showInPerson(text, (id) => this._hooks.isSelf(id), (id) => this._mind.nameOf(id));
	}

	/** A query in its words with ids for its names, as its memory is searched. */
	private query(text:string):string {
		return showTextWithIDs(this.inIDs(text));
	}

	/** Every id its memories, recent lines, conversation and last sight still name: whose names its book must keep. */
	public ids():string[] {
		return [
			...this._mind.persona.memory.all().flatMap((r) => idsIn(keptText(r))),
			...[...this._recent, ...this._recentSummary].flatMap((line) => idsIn(line.text)),
			...this._conversation.flatMap((turn) => [turn.speakerID, ...turn.to ?? [], ...idsIn(turn.text)]),
			...this._sighted.flatMap((clause) => clause.claimedIDs),
		];
	}

	/** Its persona's pinned memories, in its names. */
	public pinned():ShownMemory[] {
		return this._mind.persona.memory.pinned().map((r) => ({ ...r, text: this.recordText(r) }));
	}

	/** What its sight showed this think, by id, and what else the look found ({@link Sighted}). */
	public sighted(clauses:readonly SightClause[], seen:Sighted = {}):void {
		this._sighted = clauses;
		this._seen = seen;
	}

	/** Takes `events`, by default all it holds for its next think, into recent lines, the conversation and long-term memory: each once. */
	private absorb(events = this._hooks.events()):void {
		const persona = this._mind.persona;
		for (const e of events.filter((event) => !this._absorbed.has(event))) {
			this._absorbed.add(e);
			const at = e.timestamp ?? this.now;
			// Kept as held, everyone by id, and tagged with whom it is about.
			const fact = e.text;
			const factTags = mergeTags(e.tags, e.who);
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
					this.noteRecent(fact, e.knownBy, at, e.restsOn);
				}
				if (e.remember) {
					this.keepFact(fact, mergeTags(['result'], factTags, nameTags(factLine)), e.knownBy, e.restsOn);
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
					this.keepTurn({ speakerID: '', text: fact, at, knownBy: e.knownBy });
				}
				else if (e.turn) {
					this.keepTurn({ ...e.turn, at, knownBy: e.knownBy });
				}
				else {
					const line = this.noteRecent(fact, e.knownBy, at, e.restsOn);
					if (line && muffled) {
						this._muffled.set(line, { speakerID: who[0], thinks: MUFFLED_THINKS });
					}
				}
			}
			if (e.remember || (betweenUs && !walk)) {
				const tags = betweenUs ? mergeTags(factTags, ['act'], nameTags(factLine)) : mergeTags(factTags, nameTags(factLine));
				internalsOf(persona.memory).perceive({ category: 'episodic', text: tidy(fact), knownBy: e.knownBy, tags, timestamp: at, restsOn: e.restsOn }, at);
			}
		}
	}

	/**
	 * Takes from `from` what character `id` knows of its recent lines, their summary and the conversation, after its
	 * own: what a mind held for the moment moves with the character when another mind thinks for it.
	 */
	private adopt(from:MindMemory<TCtx>, id:string):void {
		const recent = takeOut(from._recent, id);
		const summary = takeOut(from._recentSummary, id);
		const turns = takeOut(from._conversation, id);
		from._recent = recent.left;
		from._recentSummary = summary.left;
		from._conversation = turns.left;
		const lines = [...this._recent, ...this._recentSummary];
		this._recentSummary = foldRecent(this._recentSummary, summary.taken.filter((line) => !joinHeld(lines, line)));
		recent.taken.forEach((line) => this.noteRecent(line.text, line.knownBy, line.at));
		turns.taken.forEach((turn) => this.keepTurn(turn));
	}

	/** A line said, in the conversation it shows: its text in this mind's names, as its model wrote it (as {@link remember} reads it). */
	public noteConversation(turn:Omit<TurnDraft, 'text'> & { text:string }):void {
		this.keepTurn({ ...turn, text: this.inIDs(turn.text), at: this.now, knownBy: this._hooks.ownKnowers() });
	}

	/** Drops oldest messages past the letter budget. A cap of 0 still keeps the window's quarter, so raising it shows them. */
	private keepTurn(turn:KeptTurn):void {
		const kept = { ...turn, text: tidy(turn.text) };
		const shown = showTextWithIDs(kept.text);
		const last = this._conversation.at(-1);
		// The same line again at once: known by whoever heard it now too.
		if (shown && last?.speakerID === turn.speakerID && showTextWithIDs(last.text) === shown) {
			last.knownBy = union(last.knownBy, turn.knownBy);
			return;
		}
		if (!shown || joinHeld(this._conversation, kept, (had) => had.speakerID === turn.speakerID)) {
			return;
		}
		this._conversation.push(kept);
		const cap = this._mind.setting('conversationCap');
		const budget = cap !== undefined && cap > 0 ? cap : conversationCapFor(this._mind.thinksWith.contextTokens);
		const fits = this.turnsWithin(this._conversation, budget);
		const start = fits.length > 0 ? this._conversation.length - fits.length : this._conversation.length - 1;
		this._conversation.splice(0, Math.max(0, start));
	}

	/** The newest whole messages whose rendered lines fit in `cap` letters. */
	private turnsWithin(turns:readonly KeptTurn[], cap:number):KeptTurn[] {
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
	private shownTurns():KeptTurn[] {
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
		// Its speaker as heard: by a voice it does not know yet, else by name. What was said keeps its speaker's words: every
		// name in it stays a name, as within a remembered line's quotes.
		return `${named(this._mind.persona.names.heardAs(turn.speakerID), 'Me')}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}: ${showTextWithIDs(turn.text, (id) => this._mind.nameOf(id))}`;
	}

	private conversationLines():string[] {
		return this.shownTurns().map((turn) => this.conversationLine(turn));
	}

	/** Whether character `id` said something it heard clearly lately: a line of `id`'s is still in its conversation, or waits for its next think. */
	public heardFrom(id:string):boolean {
		return this._conversation.some((turn) => turn.speakerID === id) || this._hooks.events().some((event) => event.turn?.speakerID === id);
	}

	/** What was said and heard lately, as its prompt shows it: short-term memory, then the conversation. */
	public talkedOf():string[] {
		return [...this._recent.map((line) => this.shown(line.text)), ...this.conversationLines()];
	}

	/** `line`, known by `knownBy`, among its recent lines, as kept; none when it is empty or the last one again. */
	private noteRecent(line:TextWithIDs, knownBy:string[], at:number, restsOn?:RestsOn):KeptLine | undefined {
		const kept:KeptLine = { text: tidy(line), at, knownBy, ...restsOn ? { restsOn } : {} };
		const shown = showTextWithIDs(kept.text);
		const last = this._recent.at(-1);
		// The last line again: known by these too.
		if (shown && last && showTextWithIDs(last.text) === shown) {
			last.knownBy = union(last.knownBy, knownBy);
			return undefined;
		}
		if (!shown || joinHeld([...this._recent, ...this._recentSummary], kept)) {
			return undefined;
		}
		this._recent.push(kept);
		if (this._recent.length > RECENT_CAP) {
			// A muffled line is never summed up.
			const overflow = this._recent.splice(0, this._recent.length - RECENT_CAP).filter((old) => !this._muffled.delete(old));
			this._recentSummary = foldRecent(this._recentSummary, overflow);
		}
		return kept;
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

	private keepFact(text:TextWithIDs, tags:string[], knownBy:string[], restsOn?:RestsOn):void {
		const line = tidy(text);
		if (showTextWithIDs(line)) {
			internalsOf(this._mind.persona.memory).perceive({ category: 'semantic', text: line, knownBy, tags, timestamp: this.now, restsOn }, this.now);
		}
	}

	/** {@link MindMemoryFields.forgetRestingOn}. */
	private forgetRestingOn(fact:RestsOn):void {
		this._recent = this._recent.filter((line) => !restsOnFact(line, fact));
		this._recentSummary = this._recentSummary.filter((line) => !restsOnFact(line, fact));
		this._mind.persona.memory.forgetRestingOn(fact);
	}

	/**
	 * One "last saw" memory per id its sight showed and character that saw it, kept to the latest clause it was seen in;
	 * none for what it could not make out (its clause names no one), and none kept of anyone fallen. What it finds
	 * changed since it last saw it comes back, field by field, each once (`Bridge was raised when you last saw it. Now it
	 * is lowered.`), and so does what it finds gone from where it saw it (`Cart is gone from where you last saw it.`), at
	 * most {@link MAX_CHANGES} in all.
	 */
	public noteSeen():string[] {
		const memory = this._mind.persona.memory;
		const { states, points, gone = [] } = this._seen;
		this._seenStates = [];
		for (const record of memory.all()) {
			const seen = seenID(record);
			if (seen && this._hooks.hasFallen(seen)) {
				memory.remove(record.id);
			}
		}
		// What fell is forgotten, not gone.
		this._gone = gone.filter((record) => record.knownBy.length > 0);
		// A clause names only whom it claims, so only their names in it are read back as them.
		const sightings = this._sighted.flatMap((clause) => {
			const claimed = new Map(clause.claimedIDs.map((id) => [this._mind.nameOf(id), id]));
			const snippet = parseTextWithIDs(clause.text.trim(), (word) => claimed.get(word));
			return clause.claimedIDs.map((id) => ({ id, snippet, seers: clause.knownBy ?? [this._mind.thinkThread()] }));
		});
		this._sighted = [];
		const changes = new Map<string, string>();
		for (const { id, snippet, seers } of sightings) {
			if (this._hooks.isSelf(id) || !showTextWithIDs(snippet) || this._hooks.hasFallen(id)) {
				continue;
			}
			// Each seer's own: `You last saw Joe: …` to it, `Ann last saw Joe: …` to anyone else.
			const state = states?.get(id);
			for (const seer of seers) {
				const line = joinTextWithIDs(['', seer, ''], ' last saw ', ['', id, ''], ': ', snippet);
				const had = ownSighting(memory, id, seer);
				for (const [field, was] of Object.entries(state ? had?.state ?? {} : {}).filter(([key, value]) => state![key] !== undefined && state![key] !== value)) {
					changes.set(`${id}.${field}`, this.shown(joinTextWithIDs(['', id, ''], ` was ${was} when `, ['', seer, ''], ` last saw it. Now it is ${state![field]}.`)));
				}
				// Where it was, not how it felt: no feeling of the moment is kept with it ({@link MemoryRecord.felt}).
				const record = !had
					? internalsOf(memory).add({ category: 'semantic', text: line, knownBy: [seer], tags: mergeTags([seenTag(id), id, 'seen'], nameTags(showTextWithIDs(snippet))), timestamp: this.now, feelings: {} }, this.now)
					: had.text === showTextWithIDs(line) ? had : internalsOf(memory).rewrite(had.id, line)!;
				record.timestamp = this.now;
				record.at = points?.get(id);
				// Seen again: no longer gone.
				record.tags = record.tags.filter((tag) => tag !== GONE);
				this._seenStates.push({ record, state });
			}
		}
		for (const record of this._gone) {
			const id = seenID(record)!;
			changes.set(`${id}.${GONE}`, this.shown(joinTextWithIDs(['', id, ''], ' is gone from where ', ['', record.knownBy[0], ''], ' last saw it.')));
		}
		return [...changes.values()].slice(0, MAX_CHANGES);
	}

	/** What the think's look saw is kept: each sighting's state, and each thing found gone is so, told no more. */
	private commitSeen():void {
		this._seenStates.forEach(({ record, state }) => {
			record.state = state;
		});
		for (const record of this._gone) {
			const kept = internalsOf(this._mind.persona.memory).rewrite(record.id, joinTextWithIDs(keptText(record), ' Later it was gone from there.'));
			if (kept) {
				kept.tags = mergeTags(kept.tags, [GONE]);
				kept.at = undefined;
			}
		}
		this._seenStates = [];
		this._gone = [];
	}

	/**
	 * What its prompt recalls by: its goals and `about`, read once from its words, and its recent lines and conversation,
	 * kept in ids already. Its own id is no search term: every memory of its own would match it.
	 */
	private recallQuery(about:string):string {
		const searched = (text:TextWithIDs):string => showTextWithIDs(text, (id) => (this._hooks.isSelf(id) ? '' : id));
		return [...this._mind.persona.goals.map((g) => this.query(g.text)), this.query(about), ...[...this._recent, ...this._recentSummary].map((line) => searched(line.text)), ...this._conversation.map((turn) => searched(turn.text))]
			.filter((text) => text.trim().length > 0).join(' ');
	}

	/**
	 * What its prompt shows of its memory, in its names: what `scene` and its goals and `about` bring to mind (by their
	 * `meaning` too, from {@link meanings}), then its recent lines and the conversation.
	 */
	public lines(scene = '', about = '', meaning:Meaning = {}, lens?:MemoryLens):MemoryLines {
		const persona = this._mind.persona;
		const conversation = this.conversationLines();
		const query = this.recallQuery(about);
		const recent = this._recent.map((line) => this.shown(line.text));
		const pins = persona.memory.pinned();
		// A pinned memory is in every prompt: each one a use, so once its pin runs out it fades from then on.
		persona.memory.used(pins, this.now);
		const pinnedIds = new Set(pins.map((r) => r.id));
		const shown = this.shownAlready(recent, conversation);
		const skip = (r:MemoryRecord):boolean => {
			if (r.pinned || pinnedIds.has(r.id) || shown(r)) {
				return true;
			}
			const seen = seenID(r);
			return !!seen && scene.includes(this.inNames(['', seen, '']));
		};
		const found = !query.trim() ? [] : persona.memory.recall({
			query,
			k: this._mind.setting('recallK'),
			salience: this._seen.salience,
			bonds: lens?.bonds,
			skip,
			...meaning,
		});
		persona.memory.used(found, this.now);
		const recalled = found.map((r) => ({ ...r, text: this.aged(r) }));
		const listed = new Set(recalled.map((r) => r.id));
		this._onScreen = (r) => listed.has(r.id) || skip(r);
		return { recalled, recent, recentSummary: this._recentSummary.map((line) => this.shown(line.text)).join(RECENT_SEPARATOR), conversation };
	}

	/**
	 * Whether a memory is on screen already: one of its `recent` lines, or speech or an act still in the `conversation` it
	 * shows.
	 */
	private shownAlready(recent:readonly string[], conversation:readonly string[]):(record:MemoryRecord)=>boolean {
		const lines = new Set(recent);
		const acts = new Set(conversation);
		const quoting = this.shownTurns().map((turn) => this.inNames(joinTextWithIDs('"', turn.text, '"')));
		return (record) => {
			const text = this.recordText(record);
			return lines.has(text) || (record.tags.includes('speech') && quoting.some((quote) => text.endsWith(quote))) || (record.tags.includes('act') && acts.has(text));
		};
	}

	/**
	 * What `perceptionText` and the `tags` of what happened bring to mind unbidden, at most once a cooldown: by words and
	 * tags they share, and where its director has an embedding model, by meaning (a memory's `weight`), its mood and
	 * interests tinting which (`lens`); each stirs again what it was felt with. One memory, its voice's; for a collective
	 * with no commander, up to one of each of {@link voices}, from its own memories, tinted by its own feelings and
	 * interests and stirring its own feelings.
	 */
	public intrude(perceptionText:string, tags:string[], meaning:Meaning = {}, lens?:MemoryLens):string[] {
		if (this.now - this.lastIntrusionTimestamp < this._mind.setting('intrusionCooldown')) {
			return [];
		}
		const memory = this._mind.persona.memory;
		const query = this.query(perceptionText);
		const members = this._mind.thinkThread() === this._mind.id ? this._mind.owner.characters ?? [] : [];
		// What is before it already (a line said a moment ago) does not come to mind unbidden.
		const shown = this.shownAlready(this._recent.map((line) => this.shown(line.text)), this.conversationLines());
		const came:MemoryRecord[] = [];
		for (const voice of members.length > 0 ? this.voices(members) : [undefined]) {
			const its = !voice ? lens : this.lens(this._hooks.moodOf(voice.id), voice.persona.interests, memory.feelingsToward(this.now, voice.id), voice.id);
			const hit = memory.intrusion({ query, ...meaning, tags, boost: its?.boost, bonds: its?.bonds, now: this.now, threshold: this._mind.setting('intrusionThreshold'), skip: (r) => came.includes(r) || shown(r) || (voice !== undefined && !r.knownBy.includes(voice.id)) });
			if (!hit || hit.tags.includes('seen')) {
				continue;
			}
			came.push(hit);
			memory.used([hit], this.now);
			for (const [id, levels] of its?.stirs(hit) ?? []) {
				if (voice === undefined || id === voice.id) {
					this._hooks.stir(id, levels);
				}
			}
		}
		if (came.length > 0) {
			this.lastIntrusionTimestamp = this.now;
		}
		return came.map((record) => this.recordText(record));
	}

	/**
	 * Who of a collective's characters brings a memory to mind as its mind looks: the one that feels most strongly now (the
	 * length of its feelings), then one picked by how strongly it feels, a little at random, then any one at all, so the
	 * strongest feelings come first without always being the only ones. Seeded by the game time: the same moment picks the
	 * same ones, so a run can be made again.
	 */
	private voices<T extends { id:string }>(members:readonly T[]):T[] {
		const random = seeded(Math.round(this.now * 1000));
		const strength = (member:T):number => Math.hypot(...Object.values(this._hooks.moodOf(member.id)?.levels ?? {}));
		const left = [...members];
		const picked:T[] = [];
		for (const score of [strength, (member:T):number => strength(member) * (0.5 + random()), ():number => random()]) {
			if (left.length === 0) {
				break;
			}
			const scores = left.map(score);
			const best = scores.indexOf(Math.max(...scores));
			picked.push(...left.splice(best, 1));
		}
		return picked;
	}

	/**
	 * What it perceives (`perceptionText`) and what its prompt recalls by (its goals, `about` and recent lines: {@link lines}),
	 * each by meaning (nothing without an embedding model), for {@link intrude} and {@link lines}, with how its mood, its
	 * interests and its feelings toward others tint them.
	 */
	public async meanings(perceptionText:string, about = ''):Promise<{ seen:Meaning; recalled:Meaning; lens:MemoryLens }> {
		const mood = this._hooks.moodOf(this._mind.thinkThread());
		const interests = this._mind.voice.persona.interests;
		// Its characters' interests too: each of a collective's tints what it brings to mind ({@link intrude}).
		const allInterests = [...interests, ...(this._mind.owner.characters ?? []).flatMap((c) => c.persona.interests)];
		const [seen = {}, recalled = {}] = await this.meaning(this.query(perceptionText), this.recallQuery(about), ...mood ? Object.values(mood.memories).flat() : [], ...allInterests);
		const toward = this._mind.persona.memory.feelingsToward(this.now, this._mind.thinkThread());
		return { seen, recalled, lens: this.lens(mood, interests, toward) };
	}

	/**
	 * How far a meaning lies from `against`'s memories (their means' mean; plain memories without them) toward `toward`'s:
	 * a plain memory 0, one like `toward`'s own 1. None until all of it is embedded.
	 */
	private axis(toward:readonly string[], against:readonly (readonly string[])[]):((v:number[])=>number) | undefined {
		const of = (texts:readonly string[]):number[][] => texts.map((text) => this._anchors.get(text)).filter((v) => v !== undefined).map((v) => unit(v) ?? v);
		const own = of(toward);
		const others = against.map(of).filter((vs) => vs.length > 0);
		if (own.length === 0 || !this._plain?.length) {
			return undefined;
		}
		const average = (vectors:number[][]):number[] => centroid(vectors) ?? [];
		const axis = sub(average(own), others.length > 0 ? average(others.map(average)) : average(this._plain.map((v) => unit(v) ?? v)));
		const along = (v:number[]):number => dot(unit(v) ?? v, axis);
		const plain = this._plain.reduce((sum, v) => sum + along(v), 0) / this._plain.length;
		const full = own.reduce((sum, v) => sum + along(v), 0) / own.length;
		return full === plain ? undefined : (v) => (along(v) - plain) / (full - plain);
	}

	/**
	 * How each memory leans toward `mood`'s feelings and toward `interests`. One kept with what its voice felt
	 * (`MemoryRecord.felt`) leans as it was felt; one with none, by how its meaning lies toward each feeling's memories
	 * against the other feelings', where there is an embedding model (tested on ten settings with three embedding models: a
	 * sad mood brought sad memories that fit up more often, a mood of another feeling did not).
	 * - Unbidden, it comes to mind 1 plus its lean times the mood's level more readily, summed over the feelings, so a
	 *   surprise gift in a happy surprise more than either alone; and up to twice as readily as it is like the interests
	 *   ({@link CARES_FROM}).
	 * - As it comes back it stirs in each of the mind's characters who holds it what that one felt in it, {@link STIR} as
	 *   strongly, times its weight; one kept with no feelings, by the square of its lean by meaning.
	 * - One naming someone or something it feels toward (`toward`) comes to mind 1 plus those feelings, summed, more
	 *   readily, in recall too: a loved one's memories, and a hated one's.
	 */
	private lens(mood:Mood | undefined, interests:readonly string[], toward:ReadonlyMap<string, FeelingLevels>, voice = this._mind.thinkThread()):MemoryLens {
		const feelings = Object.keys(mood?.memories ?? {});
		const axes = feelings.flatMap((feeling) => {
			const along = this.axis(mood!.memories[feeling], feelings.filter((other) => other !== feeling).map((other) => mood!.memories[other]));
			return along ? [[feeling, along] as const] : [];
		});
		const cares = this.axis(interests, []);
		const byMeaning = (record:MemoryRecord):FeelingLevels => (record.embedding ? Object.fromEntries(axes.map(([feeling, along]) => [feeling, along(record.embedding!)])) : {});
		const leans = (record:MemoryRecord):FeelingLevels => record.felt?.[voice] ?? record.felt?.[this._mind.id] ?? byMeaning(record);
		return {
			boost: (record) => {
				const lean = leans(record);
				const moved = Object.entries(mood?.levels ?? {}).reduce((sum, [feeling, level]) => sum + level * (lean[feeling] ?? 0), 0);
				const cared = cares && record.embedding ? Math.min(1, Math.max(0, (cares(record.embedding) - CARES_FROM) / (CARES_FULL - CARES_FROM))) : 0;
				return Math.max(0, 1 + moved) * (1 + cared);
			},
			stirs: (record) => {
				const by = STIR * (record.weight ?? 1);
				const stirred = (levels:FeelingLevels, felt:boolean):FeelingLevels => Object.fromEntries(Object.entries(levels).filter(([, lean]) => lean > 0)
					.map(([feeling, lean]) => [feeling, Math.min(1, (felt ? Math.min(1, lean) : Math.min(1, lean) ** 2) * by)]));
				return new Map(record.knownBy.filter((id) => this._hooks.controls(id)).map((id) => {
					const felt = record.felt?.[id];
					return [id, felt ? stirred(felt, true) : stirred(byMeaning(record), false)] as const;
				}));
			},
			bonds: bondsOf(toward),
		};
	}

	/**
	 * `queries` by meaning ({@link Meaning}): each embedded, with its baseline, how close it comes to a plain memory
	 * ({@link PLAIN_MEMORIES}), an empty one with none. Its memories that have no meaning yet are embedded with them, up to
	 * `embedBatch` (a mind setting) a time, a sighting's never (it changes as it is seen). Nothing without an embedding model.
	 */
	private async meaning(query:string, about?:string, ...anchors:string[]):Promise<Meaning[]> {
		const queries = about === undefined ? [query] : [query, about];
		if (!this._hooks.embed()) {
			return [];
		}
		const unmet = this._mind.persona.memory.all().filter((r) => !r.embedding && !r.pinned && !r.tags.includes('seen')).slice(0, this._mind.setting('embedBatch'));
		const plain = this._plain ? [] : PLAIN_MEMORIES;
		const fresh = [...new Set(anchors)].filter((text) => !this._anchors.has(text));
		const vectors = await this.embed(...queries.map((q) => q.trim() || '.'), ...unmet.map((r) => r.text), ...plain, ...fresh);
		if (vectors.length !== queries.length + unmet.length + plain.length + fresh.length) {
			return [];
		}
		unmet.forEach((r, i) => {
			r.embedding = vectors[queries.length + i];
		});
		fresh.forEach((text, i) => {
			const vector = vectors[queries.length + unmet.length + plain.length + i];
			if (vector) {
				this._anchors.set(text, vector);
			}
		});
		this._plain ??= vectors.slice(queries.length + unmet.length, queries.length + unmet.length + plain.length) as number[][];
		const plainVectors = this._plain;
		return queries.map((q, i) => {
			const embedding = vectors[i];
			return q.trim() && embedding ? { embedding, baseline: plainVectors.reduce((sum, vector) => sum + cosine(embedding, vector), 0) / Math.max(1, plainVectors.length) } : {};
		});
	}

	/**
	 * `said`, a note in its names written as "I" by `writer` (a unit) or else its voice, as a fact it knows: kept in ids, its
	 * writer's words for itself as the writer's id, and embedded where its director has an embedding model.
	 */
	public async remember(said:string, tags:string[] = [], timestamp = this.now, writer?:string):Promise<MemoryRecord> {
		// A unit's own note is its, and its collective's; else the voice writes for the mind.
		const by = writer ?? this._mind.thinkThread();
		const knownBy = union([by, this._mind.id]);
		const written = this.inIDs(said);
		const text = writerToID(written, by, writer ? undefined : this._hooks.group());
		const line = showTextWithIDs(text);
		const [embedding] = await this.embed(line);
		const names = this._mind.persona.names;
		// Tagged with whom it names as written, never its writer: every note would come to mind for the writer's name.
		return internalsOf(this._mind.persona.memory).add({ category: 'semantic', text, knownBy, writer: by, tags: mergeTags(tags.map((tag) => names.idOf(tag) ?? tag), nameTags(showTextWithIDs(written))), timestamp, embedding }, timestamp);
	}

	/**
	 * What `recall` with `args` (`query`, `k`) brings back from memory that its prompt does not show already (its last
	 * `lines`): the best matches. None is said plainly by {@link nothingMore}.
	 */
	public async recall(args:unknown):Promise<string[]> {
		const query = recallQuery(args);
		const row = isRecord(args) ? args : {};
		const k = typeof row.k === 'number' ? row.k : this._mind.setting('recallK');
		const searched = this.query(query);
		const [meaning = {}] = query ? await this.meaning(searched) : [];
		const memory = this._mind.persona.memory;
		const found = memory.recall({ query: searched, k, ...meaning, bonds: bondsOf(memory.feelingsToward(this.now, this._mind.thinkThread())), skip: this._onScreen });
		memory.used(found, this.now);
		return found.map((r) => this.aged(r));
	}

	/**
	 * `record` as recall shows it: how long ago, then its text (`20 minutes ago: You last saw Joe: …`); what was always so
	 * (`timestamp: -Infinity`, a backstory) with no age.
	 */
	private aged(record:MemoryRecord):string {
		const age = this.now - record.timestamp;
		// A save keeps -Infinity as the most negative number: as long ago.
		return age < Number.MAX_VALUE ? `${ago(age)}: ${this.recordText(record)}` : this.recordText(record);
	}

	/** What `recall` with `args` answers when it finds nothing its prompt does not show: so, and where else to look. */
	public nothingMore(args:unknown):string {
		return nothingRecalled(recallQuery(args), this._mind.owner.activeVerbs());
	}

	/** `texts` embedded, or nothing without an embedding model or when it fails. */
	private async embed(...texts:string[]):Promise<(number[] | undefined)[]> {
		try {
			return await this._hooks.embed()?.(texts) ?? [];
		}
		catch {
			return [];
		}
	}

	public toJSON():Pick<MindJSON, 'recent' | 'recentSummary' | 'conversation' | 'lastIntrusionTimestamp'> {
		return {
			lastIntrusionTimestamp: Number.isFinite(this.lastIntrusionTimestamp) ? this.lastIntrusionTimestamp : undefined,
			recent: this._recent.map(lineToJSON),
			recentSummary: this._recentSummary.length > 0 ? this._recentSummary.map(lineToJSON) : undefined,
			conversation: this._conversation.map((turn) => ({ ...turn, text: [...turn.text], knownBy: [...turn.knownBy] })),
		};
	}

	public load(json:MindJSON):void {
		this.lastIntrusionTimestamp = json.lastIntrusionTimestamp ?? Number.NEGATIVE_INFINITY;
		this._recent = (json.recent ?? []).map(lineFromJSON);
		this._recentSummary = (json.recentSummary ?? []).map(lineFromJSON);
		this._conversation = (json.conversation ?? []).map((turn) => ({ ...turn, text: readTextWithIDs(turn.text), knownBy: [...turn.knownBy] }));
		// What it remembers has them already.
		this._hooks.events().forEach((event) => this._absorbed.add(event));
	}
}
