import type { Scene } from './scene';
import { COMBAT } from './combat/combat-scene';
import { DUNGEON } from './dungeon/dungeon-scene';
import { GLEN } from './glen/glen-scene';
import { MARKETPLACE } from './marketplace/marketplace-scene';

/** Every scene by id, in the order the main menu shows them. */
export const SCENES:Record<string, Scene> = Object.fromEntries([COMBAT, MARKETPLACE, GLEN, DUNGEON].map((scene) => [scene.id, scene]));

export const DEFAULT_SCENE_ID = DUNGEON.id;

export function sceneByID(id:string):Scene {
	return SCENES[id] ?? DUNGEON;
}
