import { yawToForward, type GameObject, type Hand } from '@arc-director/kindling';
import * as THREE from 'three';
import { Appearance } from '../../engine/components';
import type { Stance } from '../../render/spell-fx';

// What every move needs from outside its own effects, so each move file imports it from here.
export * as THREE from 'three';
export { MeshRenderer, Time, aimHeld, closeHand, create, crouch, drawBow, ease, humanBone, move, orientHand, otherHand, palmOf, placeFoot, reach, type GameObject, type Hand, type MoveTiming, type SfxHandle, type XZ } from '@arc-director/kindling';
export { Appearance, Celebrating, POSE_SECONDS, SpeechBubble, Vitals } from '../../engine/components';
export { HeldProps, turnAboutGrip } from '../HeldProps';
export { cueAt, cueAtPoint } from '../../audio/cue';
export { SWISH_PEAK, type SfxName } from '../../audio/sfx';

export const UP = new THREE.Vector3(0, 1, 0);

/** What a move reaches of the character it poses; `CharacterPose` hands it over. */
export type PoseBody = {
	go:()=>GameObject;
	/** The character's own clock (s): game time that stands still through a hitstop, so its moves hold too. */
	now:()=>number;
	/** Shifts the model `offset` (world, flat) from where the character stands; `null` puts it back. */
	step:(root:THREE.Object3D, offset:THREE.Vector3 | null)=>void;
	/** Whether any move is `busy`. */
	movesBusy:()=>boolean;
};

/**
 * A move on top of the clip; `CharacterPose` poses its moves every frame, in a fixed order. `current` is the move
 * under way, and while there is one the move is `busy`: it holds the arms, so a tool's pose waits.
 */
export abstract class PoseMove<T = never> {
	protected current:T | null = null;

	constructor(protected readonly body:PoseBody) {}

	public get busy():boolean {
		return !!this.current;
	}

	protected get go():GameObject {
		return this.body.go();
	}

	protected get now():number {
		return this.body.now();
	}

	public abstract update(root:THREE.Object3D, alive:boolean, dt:number):void;

	/** Lets go of what it left in the world (arrows, sounds) as its character goes. */
	public dispose():void {}
}

/** `meters` ahead of where `go` faces, flat. */
export function aheadOf(go:GameObject, meters:number):THREE.Vector3 {
	const { x, z } = yawToForward(go.transform.yaw);
	return new THREE.Vector3(x, 0, z).multiplyScalar(meters);
}

/** Where `go` faces, flat, its right, and its side toward `hand` (the right mirrored for the left). */
export function frameOf(go:GameObject, hand:Hand = 'right'):{ ahead:THREE.Vector3; right:THREE.Vector3; side:THREE.Vector3 } {
	const ahead = aheadOf(go, 1);
	const right = new THREE.Vector3().crossVectors(ahead, UP);
	return { ahead, right, side: right.clone().multiplyScalar(hand === 'right' ? 1 : -1) };
}

/** How tall a character is (m). */
export function heightOf(go:GameObject):number {
	return go.getComponent(Appearance)?.height ?? 1.7;
}

/** Where a character stands, and how tall it is. */
export function stanceOf(go:GameObject):Stance {
	return { feet: pointOn(go, 0), height: heightOf(go) };
}

/**
 * Where on a character to look at or hand things to: a height fraction of `Appearance`. A spot on
 * the ground stands in for someone of the usual height standing there.
 */
export function pointOn(at:GameObject | THREE.Vector3, fraction:number):THREE.Vector3 {
	const p = at instanceof THREE.Vector3 ? at : at.transform.position;
	const height = at instanceof THREE.Vector3 ? 1.7 : heightOf(at);
	return new THREE.Vector3(p.x, p.y + height * fraction, p.z);
}
