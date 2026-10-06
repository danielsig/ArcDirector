import { NPCInput } from '../actors/NPCInput';
import { PlayerInput } from '../actors/PlayerInput';
import { Companion, Named } from '../engine/components';
import { clamp, lerpAngle, yawToward } from '../engine/math';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { distXZ } from '../items/inventory';
import { lineClear } from '../world/path';

export const CONVERSE_RANGE = 2;
/** Clear-with-LOS cutoff (meters). Closer than CONVERSE_RANGE is always clear. */
export const CLEAR_RANGE = 8;
/** Speech bubble and glance toward a speaker last this long. */
export const SPEECH_LIFE = 4.8;

function bodyNamed(world:World, id:string):GameObject | undefined {
	return world.findNamed(id) ?? world.findByID(id);
}

/** Observer hide, plus companion exception for the body they follow. */
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
	const a = bodyNamed(world, aID);
	const b = bodyNamed(world, bID);
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
	const speaker = bodyNamed(world, speakerID);
	const listener = bodyNamed(world, listenerID);
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
	const actor = bodyNamed(world, who);
	const peer = bodyNamed(world, toward);
	if (!actor || !peer || actor.getComponent(PlayerInput)) {
		return;
	}
	const dx = peer.transform.position.x - actor.transform.position.x;
	const dz = peer.transform.position.z - actor.transform.position.z;
	if (Math.hypot(dx, dz) < 0.05) {
		return;
	}
	actor.transform.yaw = yawToward(dx, dz);
	actor.getComponent(NPCInput)?.faceToward(toward, world.time + SPEECH_LIFE);
}

export function facePeer(actor:GameObject, dt:number):void {
	const world = actor.world;
	const npc = actor.getComponent(NPCInput);
	if (!world || !npc?.faceName) {
		return;
	}
	if (Number.isFinite(npc.faceUntil) && world.time >= npc.faceUntil) {
		npc.faceName = null;
		npc.faceUntil = 0;
		return;
	}
	const peer = bodyNamed(world, npc.faceName);
	if (!peer) {
		return;
	}
	const p = actor.transform.position;
	const t = peer.transform.position;
	const dx = t.x - p.x;
	const dz = t.z - p.z;
	if (Math.hypot(dx, dz) < 0.05) {
		return;
	}
	actor.transform.yaw = lerpAngle(
		actor.transform.yaw,
		yawToward(dx, dz),
		clamp(dt * 10, 0, 1),
	);
}
