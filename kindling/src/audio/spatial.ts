import type { ListenerPose } from './types.js';

/** Kindling yaw 0 faces −Z. */
export function forwardXZ(yaw:number):{ x:number; z:number } {
	return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/**
 * Sharp fall, long tail. Full through the first meter, then a steep drop,
 * then a shallow whisper that lasts out toward `hear`. `falloff` scales both
 * slopes (higher is more local). Mute past `hear` yourself.
 */
export function distanceGain(dist:number, falloff:number):number {
	const d = Math.max(0, dist);
	const k = Math.max(falloff, 1e-6);
	const close = Math.exp(-8 * k * Math.max(0, d - 1));
	const tail = 1 / (1 + 0.55 * k * d);
	return 0.78 * close + 0.22 * tail;
}

/** Closer than this along the ground (meters), a sound has no direction: it is right here. */
const NEAR = 1;
/** From this far along the ground (meters), a sound has its full direction. */
const FAR = 3;

/**
 * Where to put a sound's panner. Direction is kept flat, at the listener's height: HRTF muffles
 * and quiets sounds from below, which would bury everything under a camera looking down on the
 * world, so sounds carry left, right, front and back only. Close sounds also stay steady: HRTF
 * swings wildly for a source almost on the listener, so a near sound sits straight ahead and
 * only turns toward its true direction as it moves away. Loudness is not affected: panners here
 * do not roll off with distance.
 */
export function heardAt(listener:ListenerPose, x:number, z:number):{ x:number; y:number; z:number } {
	const dx = x - listener.x;
	const dz = z - listener.z;
	const flat = Math.hypot(dx, dz);
	const spread = Math.min(1, Math.max(0, (flat - NEAR) / (FAR - NEAR)));
	if (spread >= 1) {
		return { x, y: listener.y, z };
	}
	const ahead = forwardXZ(listener.yaw);
	const toX = flat > 1e-6 ? dx / flat : 0;
	const toZ = flat > 1e-6 ? dz / flat : 0;
	let ax = ahead.x * (1 - spread) + toX * spread;
	let az = ahead.z * (1 - spread) + toZ * spread;
	let len = Math.hypot(ax, az);
	if (len < 1e-6) {
		ax = ahead.x;
		az = ahead.z;
		len = 1;
	}
	const reach = Math.max(NEAR, flat) / len;
	return { x: listener.x + ax * reach, y: listener.y, z: listener.z + az * reach };
}

export function makePanner(ctx:AudioContext, hear:number):PannerNode {
	const panner = ctx.createPanner();
	panner.panningModel = 'HRTF';
	panner.distanceModel = 'inverse';
	panner.refDistance = 1;
	panner.maxDistance = Math.max(2, hear);
	panner.rolloffFactor = 0;
	panner.coneInnerAngle = 360;
	panner.coneOuterAngle = 360;
	return panner;
}

export function placePanner(
	panner:PannerNode,
	x:number,
	y:number,
	z:number,
	when:number,
	smooth:boolean,
):void {
	if (panner.positionX) {
		if (smooth) {
			panner.positionX.setTargetAtTime(x, when, 0.05);
			panner.positionY.setTargetAtTime(y, when, 0.05);
			panner.positionZ.setTargetAtTime(z, when, 0.05);
			return;
		}
		panner.positionX.setValueAtTime(x, when);
		panner.positionY.setValueAtTime(y, when);
		panner.positionZ.setValueAtTime(z, when);
		return;
	}
	panner.setPosition(x, y, z);
}

export function poseListener(ctx:AudioContext, pose:ListenerPose, when:number):void {
	const { x, z } = forwardXZ(pose.yaw);
	const listener = ctx.listener;
	if (listener.positionX) {
		listener.positionX.setTargetAtTime(pose.x, when, 0.04);
		listener.positionY.setTargetAtTime(pose.y, when, 0.04);
		listener.positionZ.setTargetAtTime(pose.z, when, 0.04);
		listener.forwardX.setTargetAtTime(x, when, 0.04);
		listener.forwardY.setTargetAtTime(0, when, 0.04);
		listener.forwardZ.setTargetAtTime(z, when, 0.04);
		listener.upX.setTargetAtTime(0, when, 0.04);
		listener.upY.setTargetAtTime(1, when, 0.04);
		listener.upZ.setTargetAtTime(0, when, 0.04);
		return;
	}
	listener.setPosition(pose.x, pose.y, pose.z);
	listener.setOrientation(x, 0, z, 0, 1, 0);
}

/** Force a stereo graph. Surround / Atmos is not available on Web Audio. */
export function forceStereo(ctx:AudioContext):void {
	const dest = ctx.destination;
	try {
		dest.channelCountMode = 'explicit';
		dest.channelInterpretation = 'speakers';
		const max = dest.maxChannelCount || 2;
		dest.channelCount = Math.min(2, max);
	}
	catch {
		// some destinations lock channelCount
	}
}
