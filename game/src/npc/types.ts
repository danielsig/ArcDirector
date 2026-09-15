import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';

export type HostCtx = {
	world:World;
	actor:GameObject;
};

export type SceneHooks<H> = {
	afterPickUp?:(host:H, actor:GameObject, name:string)=>void;
	tickMarketNPC?:(host:H)=>void;
	checkBargain?:(host:H)=>void;
	goalDone?:(host:H, id:string)=>boolean;
	allowTheft?:boolean;
};
