import type { CharacterSpec } from 'arc-director';
import type { NPCInput } from '../characters/NPCInput';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';

export type CharacterCtx = {
	world:World;
	character:GameObject;
	/** Where ArcDirector steers this character, and its cooldowns. Every character ArcDirector drives has one. */
	npc:NPCInput;
	/** Scene id from the game host. ArcDirector does not interpret it. */
	scene:string;
};

export type SceneHooks<H> = {
	afterPickUp?:(host:H, character:GameObject, name:string)=>void;
	tickMarketNPC?:(host:H)=>void;
	checkBargain?:(host:H)=>void;
	goalDone?:(host:H, id:string)=>boolean;
	allowTheft?:boolean;
};

const RECEIVED = 'count(me.inventory) > count(prev.me.inventory) || me.gold > prev.me.gold';

export function withReceived<T>(spec:CharacterSpec<T>):CharacterSpec<T> {
	return { ...spec, watches: { received: RECEIVED, ...spec.watches } };
}
