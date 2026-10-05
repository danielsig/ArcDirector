import type { JsonSchema } from '../json.js';

/** The agent's id is its name. `role` is an optional plain tag others may also address it by (`Herbalist`). */
export type AgentIdentity = {
	role?:string;
	traits?:string[];
};

export type Goal = {
	text:string;
	priority?:number;
};

/** Standing conditions: short name → watch-language expr. */
export type Watches = Record<string, string>;

/** Dict, or a legacy list of exprs / `{ name, expr }` objects. */
export type WatchInput = Watches | readonly unknown[];

export type GoalRevision = {
	goals:Goal[];
};

export type AgentEvent = {
	kind:string;
	text:string;
	tags?:string[];
	major?:boolean;
	/** Game time. Default: when the agent receives it. */
	timestamp?:number;
	/** Also keep it as an episodic memory, not only in short-term memory. */
	remember?:boolean;
	/** Real ids for `{0}`, `{1}`, … in `text`. Each listener reads its own name for them, and gets those names as tags. */
	who?:string[];
};

/** Named English that is always in the user block this think. */
export type Sense<TAgentCtx = unknown> = {
	description:string;
	gather:(ctx:TAgentCtx)=>unknown;
};

export type ToolSpec<TAgentCtx = unknown> = {
	description:string;
	parameters:JsonSchema;
	handler:(ctx:TAgentCtx, args:unknown)=>unknown;
};

/**
 * What this mind may use. Fetched every tick from `Agent.kit`.
 * `verbs` omitted or empty = none. `senses` / `tools` omitted = all registered senses / tools; `[]` = none.
 */
export type Kit = {
	verbs?:readonly string[];
	senses?:readonly string[];
	tools?:readonly string[];
};

/** Plain object (mutate in place, or use getters) or a callback. */
export type KitSource<TAgentCtx = unknown> = Kit | ((ctx:TAgentCtx)=>Kit);
