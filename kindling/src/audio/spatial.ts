import type { ListenerPose } from './types.js';

/** Kindling yaw 0 faces −Z. */
export function forwardXZ(yaw:number):{ x:number; z:number } {
	return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Inverse-square attenuator. Near 1m stays loud; far drops fast. Mute past `hear` yourself. */
export function distanceGain(dist:number, falloff:number):number {
	return 1 / (1 + (dist * falloff) ** 2);
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
