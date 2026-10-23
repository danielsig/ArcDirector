import { Time, clamp, lerpAngle, yawToward, type GameObject } from '@arc-director/kindling';
import { NPCInput } from '../characters/NPCInput';
import { PlayerInput } from '../characters/PlayerInput';
import { Companion, HumanBody, Named } from '../engine/components';
import type { World } from '../engine/World';
import { distXZ } from '../items/inventory';
import { lineClear } from '../world/path';
import { findObject } from './names';

export const CONVERSE_RANGE = 2;
/** Clear-with-LOS cutoff (meters). Closer than CONVERSE_RANGE is always clear. */
export const CLEAR_RANGE = 8;
/** How far a line carries at all (meters). */
export const HEAR_RANGE = 16;
/** Speech bubble and glance toward a speaker last this long. */
export const SPEECH_LIFE = 4.8;

/** Hidden from NPCs unless a participant, except to the companion following them. */
export function talkNotices(viewer:GameObject, go:GameObject):boolean {
	const world = viewer.world;
	if (!world) {
		return false;
	}
	if (world.npcCanSee(go)) {
		return true;
	}
	const bond = viewer.getComponent(Companion);
	return !!bond && (go.id === bond.targetID || go.getComponent(Named)?.id === bond.targetID);
}

/** Close enough to catch every word: within 2 m, or within 8 m where sound passes. People in the way do not stop a voice. */
export function canHearClearly(world:World, speakerID:string, listenerID:string):boolean {
	const speaker = findObject(world, speakerID);
	const listener = findObject(world, listenerID);
	if (!speaker || !listener || speaker === listener) {
		return false;
	}
	const dist = distXZ(speaker, listener);
	if (dist <= CONVERSE_RANGE) {
		return true;
	}
	if (dist > CLEAR_RANGE) {
		return false;
	}
	return lineClear(world, 'sound', speaker.transform.position, listener.transform.position);
}

export function talkFace(world:World, who:string, toward:string):void {
	const character = findObject(world, who);
	const peer = findObject(world, toward);
	// Only someone with a body turns to whoever speaks; a stone spoken to stays as it stands.
	if (!character || !peer || character.getComponent(PlayerInput) || !character.getComponent(HumanBody)) {
		return;
	}
	const dx = peer.transform.position.x - character.transform.position.x;
	const dz = peer.transform.position.z - character.transform.position.z;
	if (Math.hypot(dx, dz) < 0.05) {
		return;
	}
	character.transform.yaw = yawToward(dx, dz);
	character.getComponent(NPCInput)?.faceToward(toward, Time.time + SPEECH_LIFE);
}

export function facePeer(character:GameObject, dt:number):void {
	const world = character.world;
	const npc = character.getComponent(NPCInput);
	if (!world || !npc?.faceName) {
		return;
	}
	if (Number.isFinite(npc.faceUntil) && Time.time >= npc.faceUntil) {
		npc.faceName = null;
		npc.faceUntil = 0;
		return;
	}
	const peer = findObject(world, npc.faceName);
	if (!peer) {
		return;
	}
	const p = character.transform.position;
	const t = peer.transform.position;
	const dx = t.x - p.x;
	const dz = t.z - p.z;
	if (Math.hypot(dx, dz) < 0.05) {
		return;
	}
	character.transform.yaw = lerpAngle(
		character.transform.yaw,
		yawToward(dx, dz),
		clamp(dt * 10, 0, 1),
	);
}
