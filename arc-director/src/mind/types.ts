import type { JsonSchema } from '../json.js';

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

/** Named English that is always in the user block this think. */
export interface Sense<TCtx = unknown> {
	/** The sense's description. */
	description:string;
	/** The function that will be called to gather the sense. */
	gather:(ctx:TCtx)=>unknown;
}

export interface ToolSpec<TCtx = unknown> {

	/** The tool's description. */
	description:string;
	/** The tool's arguments' JSON schema. */
	parameters:JsonSchema;
	/** The function that will be called when the tool is called. Returns a promise or a value. */
	handler:(ctx:TCtx, args:unknown)=>unknown | Promise<unknown>;
}
