import type { JsonSchema } from '../json.js';

export type AgentIdentity = {
	name:string;
	role:string;
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
	at?:number;
};

/** Named English that is always in the user block this think. */
export type Sense<HostCtx = unknown> = {
	description:string;
	gather:(ctx:HostCtx)=>unknown;
};

export type ToolSpec<HostCtx = unknown> = {
	description:string;
	parameters:JsonSchema;
	handler:(ctx:HostCtx, args:unknown)=>unknown;
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
export type KitSource<HostCtx = unknown> = Kit | ((ctx:HostCtx)=>Kit);
