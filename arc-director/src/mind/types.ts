import type { JsonSchema } from '../json.js';

export type MindEvent = {
	kind:string;
	text:string;
	tags?:string[];
	major?:boolean;
	/** Game time. Default: when the mind receives it. */
	timestamp?:number;
	/** Also keep it as an episodic memory, not only in short-term memory. */
	remember?:boolean;
	/** Real ids for `{0}`, `{1}`, … in `text`. Each listener reads its own name for them, and gets those names as tags. */
	who?:string[];
	/** Clear speech, for Current Conversation. Without it, the event is only in short-term memory. */
	turn?:ConversationTurn;
};

/** One clearly heard line. Ids are real; each mind names them its own way when it shows the line. */
export type ConversationTurn = {
	speakerID:string;
	/** Who it was said to. Empty or absent: to everyone. */
	to?:string[];
	text:string;
};

/** Named English that is always in the user block this think. */
export type Sense<TCtx = unknown> = {
	description:string;
	gather:(ctx:TCtx)=>unknown;
};

export type ToolSpec<TCtx = unknown> = {
	description:string;
	parameters:JsonSchema;
	handler:(ctx:TCtx, args:unknown)=>unknown;
};
