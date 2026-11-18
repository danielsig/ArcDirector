import type { Arc } from '../arc/arc-types.js';
import type { Feeling } from '../character/feeling.js';
import type { Mind } from './mind.js';
import type { NamingText, TextWithIDs } from '../character/text-with-ids.js';
import type { SayTone } from './talk.js';
import type { ModelChat } from '../director/ModelSlots.js';
import type { JsonSchema, JsonValue } from '../json.js';

/**
 * What a mind is doing as it thinks, for a host to show; none of it reaches a prompt. `who` is the character acting
 * for the mind, or a collective's own id while it has no commander.
 */
export type ThinkEvent =
	/**
	 * A think began, and `why`, in a few words for a log: what woke it from the queue (`rethink`, `heard speech`,
	 * `watch hurt`, `verb think failed`), or `forced` for `thinkNow`. None when its host ticked it itself.
	 */
	| { kind:'start'; who:string; why?:string }
	/**
	 * The model's reply so far: its reasoning, and what it has written of an Arc as Arc text in block layout (`''` until
	 * something reads as one). Restarts each time a think asks the model again, as after a tool.
	 */
	| { kind:'reply'; who:string; thought:string; arc:string }
	/** The think looked something up. */
	| { kind:'tool'; who:string; tool:string; args:string }
	/** The model's reply would not do, and it is being asked again: why. */
	| { kind:'retry'; who:string; reason:string }
	/** The think ended: with the Arc it chose, with the `error` that ended it, or with neither, cut short by a newer one. */
	| { kind:'end'; who:string; arc?:Arc; error?:string; skipped?:boolean }
	/** `who` ordered the characters `to` to run `arc`; `text` is that arc as Arc text. */
	| { kind:'command'; who:string; to:string[]; arc:Arc; text:string };

/**
 * How a model writes the Arc it thinks up. `text`: Arc text (`go_to() && wait()`), parsed forgivingly. `json`: Arc
 * JSON, parsed as written. `schema`: Arc JSON the server must follow, enforced by a response schema.
 */
export type ArcFormat = 'text' | 'json' | 'schema';

export interface MindEvent {
	/** The event's kind. */
	kind:string;
	/**
	 * The event's text. One that names others is a function handed `name`, which it calls for each id it names
	 * (``(name) => `${name(thief)} stole bread from ${name(baker)}` ``): each mind reads its own names for them, and its
	 * own as "you", unless the event is a {@link turn} of speech.
	 */
	text:NamingText;
	/** Tags of the event, for filtering and grouping. */
	tags?:string[];
	/** Whether the event is a major event which forces the mind to think. */
	major?:boolean;
	/** Game time in seconds when the event happened. Default: when the mind receives it. */
	timestamp?:number;
	/** Also keep it as an episodic memory, not only in short-term memory. */
	remember?:boolean;
	/** The ids it is about: each listener gets its names for them as tags. Default: the ids its text names. */
	who?:string[];
	/** Clear speech, for Current Conversation. Without it, the event is only in short-term memory. */
	turn?:TurnDraft;
	/** Replaces a waiting event with the same key: a sound heard again, louder. */
	key?:string;
	/** At most this many events of its {@link kind} wait for the next think; past that, the one of least {@link weight} is dropped. */
	cap?:number;
	/** How much it matters next to others of its {@link kind}, e.g. a sound's loudness. Affects what is dropped when {@link cap} is reached. Default: 0. */
	weight?:number;
};

/** A {@link MindEvent} as a mind holds it: its text by id, and whom it is about. */
export type HeldEvent = Omit<MindEvent, 'text' | 'turn'> & { text:TextWithIDs; who:string[]; turn?:HeldTurn };

/** How a line was said, which each feature words its own way (`Feature.manner`): its tone and its speaker's feeling. */
export type Manner = Pick<ConversationTurn, 'as' | 'feeling'>;

/** A {@link ConversationTurn} as a host writes one: what was said may name others by id. */
export type TurnDraft = Omit<ConversationTurn, 'text' | 'segments'> & { text:NamingText };

/** A {@link ConversationTurn} as a mind holds it: what was said, by id. */
export type HeldTurn = Omit<ConversationTurn, 'text' | 'segments'> & { text:TextWithIDs };

/** Text by id as a save keeps it (`T`'s `text`), read back as it was. */
export type Saved<T extends { text:unknown }> = Omit<T, 'text' | 'segments'> & { text:JsonValue };

/** A held event as a save keeps it. */
export type HeldEventJSON = Omit<MindEvent, 'text' | 'turn'> & { text:JsonValue; who:string[]; turn?:Saved<ConversationTurn> };

/** One clearly heard line. Ids are real; each mind names them its own way when it shows the line. */
export interface ConversationTurn {
	/** The id of the character who spoke. */
	speakerID:string;
	/** IDs of the characters who heard it. Empty or omitted: to everyone. */
	to?:string[];
	/** What was said, each one it names written as its id. */
	readonly text:string;
	/** What was said in pieces, each one it names a piece with its id, so a host can name it its own way. */
	segments():{ text:string; id?:string }[];
	/** The tone it was said in (`say(as)`); plainly without one. */
	as?:SayTone;
	/** The feeling its speaker showed as it was said (`withFeelings`). */
	feeling?:Feeling;
};

/** Named English that is always in the user block this think: what it senses now, from the voice's context, for `mind`; `undefined` leaves it out of this think. */
export type Sense<TCtx = unknown> = (ctx:TCtx, mind:Mind<TCtx>)=>JsonValue | undefined;

export interface ToolSpec<TCtx = unknown> {

	/** The tool's description, or what it says to `mind` now (`recall` with world knowledge only where there is some). */
	description:string | ((mind:Mind<TCtx>)=>string);
	/** The tool's arguments' JSON schema. */
	parameters:JsonSchema;
	/** Whether it can work for `mind` now (`see_map` for a model that sees); omit for always. A kit's `tools` is the host's say. */
	offered?:(mind:Mind<TCtx>)=>boolean;
	/** What the tool answers `mind`, which called it from `ctx`: a value or a promise of one. `chat` is its think's own lease. */
	handler:(ctx:TCtx, args:unknown, mind:Mind<TCtx>, chat:ModelChat)=>JsonValue | Promise<JsonValue>;
}
