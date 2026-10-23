import { registerToonClips, registerToonModel } from '@arc-director/kindling';

/** Built from `brainstorming/3Dmodels` by `kindling/scripts/buildModels.mjs` (config: `game/models.json`). */
const MODELS_URL = '/models/';

/** A 3D character model: how tall it stands (hat included), and whether its voice sits high and it may stand hands on hips and jump for joy. */
export type CharacterModelDef = { height:number; feminine?:boolean };

/** Every 3D character, by mesh ID (the GLB's name). */
export const CHARACTER_MODELS:Record<string, CharacterModelDef> = {
	Hero: { height: 1.7 },
	KnightMale: { height: 1.8 },
	KnightFemale: { height: 1.72, feminine: true },
	Rogue: { height: 1.72 },
	Scout: { height: 1.6, feminine: true },
	Sorceress: { height: 1.7, feminine: true },
	Witch: { height: 1.9, feminine: true },
	Shaman: { height: 1.8, feminine: true },
	Robe: { height: 1.75 },
	Merchant: { height: 1.7 },
	Blacksmith: { height: 1.75 },
	VillagerMale: { height: 1.75 },
	VillagerFemale: { height: 1.7, feminine: true },
	Ghoul: { height: 1.75 },
	SkeletonWarrior: { height: 1.75 },
	SkeletonArcher: { height: 1.7 },
	SkeletonKing: { height: 2.1 },
};

/** Models that are not characters, by mesh ID: what characters hold, and the raven. Height in meters. */
export const PROP_MODELS:Record<string, number> = {
	Sword: 1,
	Staff: 1.7,
	ShamanStaff: 1.6,
	ShamanBow: 1.2,
	SkeletalBow: 1.2,
	ShamanArrow: 0.75,
	SkeletalArrow: 0.75,
	Raven: 0.45,
};

/** Whether `meshID` is a built model (a character or a prop), which registers itself with Kindling. */
export function isModel(meshID:string):boolean {
	return !!CHARACTER_MODELS[meshID] || meshID in PROP_MODELS;
}

export function characterModel(meshID:string):CharacterModelDef | undefined {
	return CHARACTER_MODELS[meshID];
}

let pending:Promise<void> | null = null;

/** Registers every character and prop model and the shared clip library, once. */
export function loadCharacterModels():Promise<void> {
	pending ??= Promise.all([
		registerToonClips(`${MODELS_URL}clips.glb`),
		...Object.entries(CHARACTER_MODELS).map(([id, def]) => registerToonModel(id, `${MODELS_URL}${id}.glb`, { height: def.height })),
		...Object.entries(PROP_MODELS).map(([id, height]) => registerToonModel(id, `${MODELS_URL}${id}.glb`, { height })),
	]).then(() => undefined).catch((err:unknown) => {
		pending = null;
		throw err;
	});
	return pending;
}

/** Who the player is when no choice is saved. The player's alone: no NPC wears it. */
export const PLAYER_MODEL = 'Hero';

/** `KnightFemale` → `Knight Female`. */
export function characterLabel(id:string):string {
	return id.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** The characters the player can be, for the menu. */
export function characterOptions():{ id:string; label:string }[] {
	return Object.keys(CHARACTER_MODELS)
		.map((id) => ({ id, label: characterLabel(id) }))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/** A saved player choice if it is still a character, else {@link PLAYER_MODEL}. */
export function resolvePlayerKind(kind:string | null | undefined):string {
	const id = kind?.trim() ?? '';
	return CHARACTER_MODELS[id] ? id : PLAYER_MODEL;
}
