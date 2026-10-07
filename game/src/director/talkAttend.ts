import { NPCInput } from '../characters/NPCInput';
import { PlayerInput } from '../characters/PlayerInput';
import { Companion, Named } from '../engine/components';
import { clamp, lerpAngle, yawToward } from '../engine/math';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { distXZ } from '../items/inventory';
import { lineClear } from '../world/path';
import { findObject } from './names';

export const CONVERSE_RANGE = 2;
/** Clear-with-LOS cutoff (meters). Closer than CONVERSE_RANGE is always clear. */
export const CLEAR_RANGE = 8;
/** Speech bubble and glance toward a speaker last this long. */
export const SPEECH_LIFE = 4.8;

/** Observer hide, plus companion exception for the character they follow. */
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

export function talkCanSee(world:World, aID:string, bID:string):boolean {
	const a = findObject(world, aID);
	const b = findObject(world, bID);
	if (!a || !b || a === b) {
		return false;
	}
	if (!talkNotices(a, b)) {
		return false;
	}
	return lineClear(
		world,
		a.transform.position.x,
		a.transform.position.z,
		b.transform.position.x,
		b.transform.position.z,
	);
}

/** Close enough to catch every word: within 2 m, or within 8 m with line of sight. */
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
	return lineClear(
		world,
		speaker.transform.position.x,
		speaker.transform.position.z,
		listener.transform.position.x,
		listener.transform.position.z,
	);
}

export function talkFace(world:World, who:string, toward:string):void {
	const character = findObject(world, who);
	const peer = findObject(world, toward);
	if (!character || !peer || character.getComponent(PlayerInput)) {
		return;
	}
	const dx = peer.transform.position.x - character.transform.position.x;
	const dz = peer.transform.position.z - character.transform.position.z;
	if (Math.hypot(dx, dz) < 0.05) {
		return;
	}
	character.transform.yaw = yawToward(dx, dz);
	character.getComponent(NPCInput)?.faceToward(toward, world.time + SPEECH_LIFE);
}

export function facePeer(character:GameObject, dt:number):void {
	const world = character.world;
	const npc = character.getComponent(NPCInput);
	if (!world || !npc?.faceName) {
		return;
	}
	if (Number.isFinite(npc.faceUntil) && world.time >= npc.faceUntil) {
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
