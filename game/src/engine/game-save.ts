import { type GameObject } from '@arc-director/kindling';
import type { WorldSave } from '@arc-director/kindling';
import type { CastJSON } from 'arc-director';
import type { ItemInstance } from '../items/instance';
import { lsGet, lsSet } from '../prefs';
import { spawnNPC, type NPCSpawnDef } from '../world/spawn';
import { spawnWorldItem } from '../world/spawn-item';
import type { ViewPose } from './view-persist';
import type { DemoWorld } from './demo-world';
import type { SceneState } from '../director/adapter';

/** One save per scene: the world as a diff of the fresh scene, the cast, and the camera. */
export type GameSave = {
	savedUTC:string;
	time:number;
	/** The scene's own state (`GameHost.sceneState`). */
	scene:SceneState;
	pose:ViewPose;
	world:WorldSave;
	cast:CastJSON;
};

/** What `spawnWorldItem` / `spawnNPC` stamp on `GameObject.recipe`. */
type Recipe = { item:ItemInstance; chunkID?:string } | { npc:NPCSpawnDef };

const key = (sceneID:string):string => `arc-director.save.${sceneID}`;

export function readSave(sceneID:string):GameSave | null {
	try {
		return JSON.parse(lsGet(key(sceneID)) ?? 'null') as GameSave | null;
	}
	catch {
		return null;
	}
}

export function writeSave(sceneID:string, save:GameSave):boolean {
	return lsSet(key(sceneID), JSON.stringify(save));
}

/** Rebuild an object the fresh scene does not have. Its saved state is applied after. */
export function respawn(world:DemoWorld, raw:unknown):GameObject | undefined {
	const recipe = raw as Recipe;
	if ('item' in recipe) {
		return spawnWorldItem(world, recipe.item, 0, 0, 0, recipe.chunkID);
	}
	return spawnNPC(world, recipe.npc);
}
