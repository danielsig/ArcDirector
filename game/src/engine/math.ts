export type Vec3 = {
	x:number;
	y:number;
	z:number;
};

export function vec3(x = 0, y = 0, z = 0):Vec3 {
	return { x, y, z };
}

export function clamp(v:number, lo:number, hi:number):number {
	return Math.max(lo, Math.min(hi, v));
}

export function lerpAngle(a:number, b:number, t:number):number {
	let d = b - a;
	while (d > Math.PI) {
		d -= Math.PI * 2;
	}
	while (d < -Math.PI) {
		d += Math.PI * 2;
	}
	return a + d * clamp(t, 0, 1);
}

/** Yaw 0 faces -Z (Three.js default). */
export function yawToForward(yaw:number):{ x:number; z:number } {
	return {
		x: -Math.sin(yaw),
		z: -Math.cos(yaw),
	};
}

export function yawToward(dx:number, dz:number):number {
	return Math.atan2(-dx, -dz);
}
