import type { Arc } from '../arc/arc-types.js';
import type { Mind } from './mind.js';
import type { ModelChat } from '../director/ModelSlots.js';
import type { JsonSchema } from '../json.js';

/**
 * What a mind is doing as it thinks, for a host to show; none of it reaches a prompt. `who` is the character acting
 * for the mind, or a collective's own id while it has no commander.
 */
export type ThinkEvent =
	/** A think began. */
	| { kind:'start'; who:string }
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
	| { kind:'end'; who:string; arc?:Arc; error?:string }
	/** `who` ordered the characters `to` to run `arc`; `text` is that arc as Arc text. */
	| { kind:'command'; who:string; to:string[]; arc:Arc; text:string };

/** Unfinished work an Arc would cut short: whose, how far along, and what would take its place. */
export type Replacing = { id:string; now:string; next:string; looping:boolean };

/**
 * How a model writes the Arc it thinks up. `text`: Arc text (`go_to() && wait()`), parsed forgivingly. `json`: Arc
 * JSON, parsed as written. `schema`: Arc JSON the server must follow, enforced by a response schema.
 */
export type ArcFormat = 'text' | 'json' | 'schema';

export interface MindEvent {
	/** The event's kind. */
	kind:string;
	/** The event's text. */
	text:string;
	/** Tags of the event, for filtering and grouping. */
	tags?:string[];
	/** Whether the event is a major event which forces the mind to think. */
	major?:boolean;
	/** Game time in seconds when the event happened. Default: when the mind receives it. */
	timestamp?:number;
	/** Also keep it as an episodic memory, not only in short-term memory. */
	remember?:boolean;
	/** Real IDs for `{0}`, `{1}`, … in `text`. Each listener reads its own name for them, and gets those names as tags. */
	who?:string[];
	/** Clear speech, for Current Conversation. Without it, the event is only in short-term memory. */
	turn?:ConversationTurn;
	/** Replaces a waiting event with the same key: a sound heard again, louder. */
	key?:string;
	/** At most this many events of its {@link kind} wait for the next think; past that, the one of least {@link weight} is dropped. */
	cap?:number;
	/** How much it matters next to others of its {@link kind}, e.g. a sound's loudness. Affects what is dropped when {@link cap} is reached. Default: 0. */
	weight?:number;
};

/** One clearly heard line. Ids are real; each mind names them its own way when it shows the line. */
export interface ConversationTurn {
	/** The id of the character who spoke. */
	speakerID:string;
	/** IDs of the characters who heard it. Empty or omitted: to everyone. */
	to?:string[];
	text:string;
};

/** Named English that is always in the user block this think: what it senses now, from the voice's context, for `mind`; `undefined` leaves it out of this think. */
export type Sense<TCtx = unknown> = (ctx:TCtx, mind:Mind<TCtx>)=>unknown;

export interface ToolSpec<TCtx = unknown> {

	/** The tool's description. */
	description:string;
	/** The tool's arguments' JSON schema. */
	parameters:JsonSchema;
	/** Whether it can work for `mind` now (`see_map` for a model that sees); omit for always. A kit's `tools` is the host's say. */
	offered?:(mind:Mind<TCtx>)=>boolean;
	/** What the tool answers `mind`, which called it from `ctx`: a value or a promise of one. `chat` is its think's own lease. */
	handler:(ctx:TCtx, args:unknown, mind:Mind<TCtx>, chat:ModelChat)=>unknown | Promise<unknown>;
}
