import type { AgentSpec } from 'arc-director';
import type { NPCInput } from '../actors/NPCInput';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';

export type AgentCtx = {
	world:World;
	actor:GameObject;
	/** Where ArcDirector steers this body, and its cooldowns. Every body ArcDirector drives has one. */
	npc:NPCInput;
	/** Scene id from the game host. ArcDirector does not interpret it. */
	scene:string;
};

export type SceneHooks<H> = {
	afterPickUp?:(host:H, actor:GameObject, name:string)=>void;
	tickMarketNPC?:(host:H)=>void;
	checkBargain?:(host:H)=>void;
	goalDone?:(host:H, id:string)=>boolean;
	allowTheft?:boolean;
};

const RECEIVED = 'count(me.inventory) > count(prev.me.inventory) || me.gold > prev.me.gold';

export function withReceived<T>(spec:AgentSpec<T>):AgentSpec<T> {
	return { ...spec, watches: { received: RECEIVED, ...spec.watches } };
}
