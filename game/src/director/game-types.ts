import { type GameObject } from '@arc-director/kindling';
import type { CharacterSpec, SpeechUtterance, ThinkReason } from 'arc-director';
import type { NPCInput } from '../characters/NPCInput';
import type { DemoWorld } from '../engine/demo-world';
import type { HudGoalSide } from '../ui/hud-model';

export type CharacterCtx = {
	world:DemoWorld;
	character:GameObject;
	/** Where ArcDirector steers this character, and its cooldowns. Every character ArcDirector drives has one. */
	npc:NPCInput;
	/** Scene id from the game host. ArcDirector does not interpret it. */
	scene:string;
};

export type SceneHooks<H> = {
	afterPickUp?:(host:H, character:GameObject, name:string)=>void;
	tickMarketNPC?:(host:H)=>void;
	onSpoke?:(host:H, utterance:SpeechUtterance)=>void;
	checkBargain?:(host:H)=>void;
	/** May this mind think now? Held thinks wait in the queue until it may. Default: yes. */
	mayThink?:(host:H, mindID:string, reason:ThinkReason)=>boolean;
	allowTheft?:boolean;
	/** The scene's goal track at the top of the screen, asked every frame. None: no track. */
	goals?:(host:H)=>SceneGoals;
};

/** A side of the goal track, and who it is: the IDs of the characters it stands for. */
export type SceneGoalSide = HudGoalSide & { who?:string[] };

/**
 * A scene's goal track: one side filling from the left, or two racing in from both ends. When both name `who`, the
 * side whose characters stand further left on screen takes the left end.
 */
export type SceneGoals = { left:SceneGoalSide; right?:SceneGoalSide };

const RECEIVED = 'count(me.inventory) > count(prev.me.inventory) || me.gold > prev.me.gold';

export function withReceived<T>(spec:CharacterSpec<T>):CharacterSpec<T> {
	return { ...spec, watches: { received: RECEIVED, ...spec.watches } };
}
