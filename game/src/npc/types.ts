import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';

export type HostCtx = {
	world:World;
	actor:GameObject;
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
