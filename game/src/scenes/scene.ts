import type { GameObject, RendererLook, Score, Track, XZ } from '@arc-director/kindling';
import type { ArcDirector, CharacterSpec, FeelingLevels, KnowledgeEntry, MemoryDraft, NamingText, Requirement } from 'arc-director';
import type { ChunkFile } from '../world/decode-glyph-chunk';
import type { CameraLook, NPCSpawnDef, RoomDef } from '../world/spawn';
import type { OutskirtHeights, Surface } from '../kit/land/land';
import type { GameHost } from '../director/adapter';
import type { CharacterCtx, SceneHooks } from '../director/game-types';

/**
 * One character of a scene, declared once: its mind's spec, its `body` (how and where it spawns), and `of`, the
 * collective it is a unit of. Without `of` it has a mind of its own.
 */
export type CastMember = CharacterSpec<CharacterCtx> & { body:Omit<NPCSpawnDef, 'id'>; of?:string };

/** A scene's characters, one record each: the bodies spawned, the minds and the collectives' units come from it. */
export type SceneCast = readonly CastMember[];

/**
 * A memory of a character's life, steeped in `feelings`: a lasting fact from before the scene, so shown with no age and
 * never pushed out by what happens, it lasts years of memory and comes to mind readily. Whom its text names
 * (`(name) => \`${name('Bram')} …\``), it feels that way toward, and seeing them stirs it.
 */
export function lived(text:NamingText, feelings:FeelingLevels):MemoryDraft {
	return { text, feelings, category: 'semantic', weight: 2, stability: 3650, timestamp: -Infinity };
}

/** What spawns for `member`. */
export function bodyOf(member:CastMember):NPCSpawnDef {
	return { id: member.id, ...member.body };
}

/** The specs the director gets from `cast`: the units of collective `of`, or without it, the minds of their own. */
export function mindsOf(cast:SceneCast, of?:string):CharacterSpec<CharacterCtx>[] {
	return cast.filter((member) => member.of === of).map(({ body, of: unitOf, ...spec }) => spec);
}

/** How the player starts in a scene. */
export type PlayerDef = {
	wallet?:number;
	/** Item defs put in the player's hands. */
	equip?:string[];
	/** What the cast calls the player, besides Player. */
	name?:string;
	/** The player's character tags, such as a fight role. */
	tags?:string[];
};

export type SceneKey = {
	key:string;
	action:string;
};

/** The keys every scene shares, listed before the scene's own `keys`. */
export const SCENE_KEYS:SceneKey[] = [
	{ key: 'E', action: 'Pick Up or Unlock' },
	{ key: 'F', action: 'Use' },
	{ key: 'X', action: 'Swap Hands' },
];

/** With a sword in hand: the moves a click makes, and the guard. */
export const SWORD_KEYS:SceneKey[] = [
	{ key: 'Click', action: 'Slice' },
	{ key: 'Move + Click', action: 'Stab' },
	{ key: 'Shift + Click', action: 'Cleave' },
	{ key: 'Hold Shift', action: 'Block' },
];

/** What fighters carry in hand. */
export const SWORD = ['iron_sword'];
export const STAFF = ['oak_staff'];
export const BOW = ['short_bow'];

export type CarriedOverhead = 'everyone' | 'shoppers';

/** One scene: its map and cast, how it looks and sounds, and what its minds know. A new scene is a folder and a line in `SCENES`. */
export type Scene = {
	/** One lowercase word: the URL's `scene`, the save key, the folder. */
	id:string;
	title:string;
	/** One line under its card on the main menu. */
	blurb:string;
	/** Lights, fog and ink. With a `sun` the scene is sunlit and has trees. */
	look:RendererLook;
	music:Score | Track;
	/** What every mind in this scene may look up. */
	knowledge:readonly KnowledgeEntry[];
	/** What doing a verb needs of whoever does it here (ArcDirector's `withRequirements`). */
	requirements?:readonly Requirement[];
	/** The land behind the map's walls, out to the horizon (`landOf`). Meadow when unset. */
	ground?:Surface;
	/** Heights of the land past the map's edge, per edge tile; each edge tile's own where unset. */
	outskirts?:OutskirtHeights;
	/** How bright every light is but the sun, 1 (the default) as full. */
	lightLevel?:number;
	/** Health bars over the characters, for scenes that fight. */
	healthBars?:boolean;
	/** Tiny icons over each head for the gold and `CARRY_ICONS` items they carry; `shoppers` leaves out whoever sells. */
	carried?:CarriedOverhead;
	/** A card beside whoever the player points at or stands close to: their name, traits, goal and what they carry. */
	inspect?:boolean;
	chunks:ChunkFile[];
	/** Every character but the player. */
	cast:SceneCast;
	ambient:string;
	/** Player keys for this scene, besides the ones every scene shares (`SCENE_KEYS`). */
	keys?:SceneKey[];
	/** One paragraph: what this scene is for, and how the characters usually get there. */
	brief:string;
	player?:PlayerDef;
	/** Named rooms, by the cells of the scene's map: places to go to and to be in. */
	rooms?:RoomDef[];
	/** Ravens on the ground at the start, at world `x`, `z`. */
	ravens?:{ x:number; z:number; yaw?:number }[];
	/** World `x`, `z` the main-menu backdrop's camera circles (`Showcase`); the player's start when unset. */
	orbit?:XZ;
	/** How the camera starts. */
	camera?:CameraLook;
	/** Player stays centered and the chunk-sized map scrolls. `false` = current chunk, moving arrow. */
	minimapFollow?:boolean;
	/** What the host calls as the scene runs. */
	hooks?:SceneHooks<GameHost>;
	/** The scene's verbs, doctrine and collectives, onto a director the host has configured with the cast's own minds. */
	direct:(host:GameHost, director:ArcDirector<CharacterCtx, GameObject>)=>ArcDirector<CharacterCtx, GameObject>;
};
