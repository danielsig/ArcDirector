/** A character's id is its name. `role` is an optional plain tag others may also address it by (`Herbalist`). */
export type Identity = {
	role?:string;
	traits?:string[];
};

/**
 * Something a character or collective wants. Once reached it stops being a goal: it stays pinned as a memory for
 * {@link GOAL_PINNED_THINKS} thinks, and after that only `recall` finds it.
 */
export type Goal<TCtx = unknown> = {
	text:string;
	priority?:number;
	/**
	 * When it is reached: a watch, as its voice sees the world (`'isCarrying("Loaf")'`), or a test of that voice's
	 * context. Asked as often as watches are. Omit to leave it to the mind, which reads its goals every think and
	 * ends one with `finish_goal`.
	 */
	until?:string | ((ctx:TCtx)=>boolean);
};

/** Thinks a reached goal stays pinned, as long as the thinks that keep a mentioned article or a tool's result from repeating. */
export const GOAL_PINNED_THINKS = 5;

/** Standing conditions: short name → watch-language expr. */
export type Watches = Record<string, string>;

/** Dict, or a legacy list of exprs / `{ name, expr }` objects. */
export type WatchInput = Watches | readonly unknown[];

/**
 * What a character or collective may use. Fetched every tick from its `kit`.
 * `verbs` are all it may run; a fixed kit without any is a mistake the director refuses.
 * `senses` / `tools` omitted = all registered senses / tools; `[]` = none. `cooldowns`: game seconds after a verb before
 * this character may run it again, by verb, over the verb's own (`VerbDef.cooldown`).
 */
export type Kit = {
	verbs:readonly string[];
	senses?:readonly string[];
	tools?:readonly string[];
	cooldowns?:Readonly<Record<string, number>>;
};

/** Plain object (mutate in place, or use getters) or a callback. */
export type KitSource<TCtx = unknown> = Kit | ((ctx:TCtx)=>Kit);
