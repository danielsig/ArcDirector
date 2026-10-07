/** A character's id is its name. `role` is an optional plain tag others may also address it by (`Herbalist`). */
export type Identity = {
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

/**
 * What a character or collective may use. Fetched every tick from its `kit`.
 * `verbs` are all it may run; a fixed kit without any is a mistake the director refuses.
 * `senses` / `tools` omitted = all registered senses / tools; `[]` = none.
 */
export type Kit = {
	verbs:readonly string[];
	senses?:readonly string[];
	tools?:readonly string[];
};

/** Plain object (mutate in place, or use getters) or a callback. */
export type KitSource<TCtx = unknown> = Kit | ((ctx:TCtx)=>Kit);
