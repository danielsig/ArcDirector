import { type GameObject } from '@arc-director/kindling';
import type { WorldSave } from '@arc-director/kindling';
import type { CastJSON } from 'arc-director';
import type { ItemInstance } from '../items/instance';
import { lsGet, lsSet } from '../prefs';
import { spawnNPC, type NPCSpawnOpts } from '../world/spawn';
import { spawnWorldItem } from '../world/spawnItem';
import type { ViewPose } from './viewPersist';
import type { World } from './World';

/** One save per scene: the world as a diff of the fresh scene, the cast, and the camera. */
export type GameSave = {
	savedUTC:string;
	time:number;
	bargainDone:boolean;
	pose:ViewPose;
	world:WorldSave;
	cast:CastJSON;
};

/** What `spawnWorldItem` / `spawnNPC` stamp on `GameObject.recipe`. */
type Recipe = { item:ItemInstance; chunkID?:string } | { npc:NPCSpawnOpts; chunkID:string };

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
export function respawn(world:World, raw:unknown):GameObject | undefined {
	const recipe = raw as Recipe;
	if ('item' in recipe) {
		return spawnWorldItem(world, recipe.item, 0, 0, 0, recipe.chunkID);
	}
	const chunk = [...world.chunks.values()].find((c) => c.id === recipe.chunkID);
	return chunk && spawnNPC(world, chunk, recipe.npc);
}
