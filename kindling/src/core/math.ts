export function clamp(v:number, lo:number, hi:number):number {
	return Math.max(lo, Math.min(hi, v));
}

/** From angle `a` toward `b` (radians) by `t` (0..1), the short way round. */
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

/** Unit ground direction a yaw faces. Yaw 0 faces -Z. */
export function yawToForward(yaw:number):{ x:number; z:number } {
	return {
		x: -Math.sin(yaw),
		z: -Math.cos(yaw),
	};
}

/** The yaw that faces ground direction (`dx`, `dz`). */
export function yawToward(dx:number, dz:number):number {
	return Math.atan2(-dx, -dz);
}

/** Steady pseudo-random 0..1 for a grid spot and a salt: the same spot always scatters the same way. */
export function hash(x:number, z:number, salt = 0):number {
	const n = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
	return n - Math.floor(n);
}
