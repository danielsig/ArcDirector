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

export type Pusher<HostCtx = unknown> = {
	description:string;
	gather:(ctx:HostCtx)=>unknown;
};

export type ToolSpec<HostCtx = unknown> = {
	description:string;
	parameters:JsonSchema;
	handler:(ctx:HostCtx, args:unknown)=>unknown;
};

export type PerceptionRecipe<HostCtx = unknown> = {
	push:Record<string, Pusher<HostCtx>>;
	tools:Record<string, ToolSpec<HostCtx>>;
};
