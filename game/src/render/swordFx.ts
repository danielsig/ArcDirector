import { streaks, sweep, type Streak } from '@arc-director/kindling';
import * as THREE from 'three';

/**
 * Anime sword effects, short-lived: the white crescent a blade leaves through its swing, and the
 * lance of light a thrust drives forward. Built from Kindling's effect primitives; the starburst and
 * dust a blow leaves are in `./fightFx`.
 */

/** A swing's crescent: drawn along its path in `draw` s, then erased tail first over `fade` s, pale blue at the hilt end to white at the tip. */
const SLASH = { draw: 0.05, fade: 0.22, inner: new THREE.Color(0.72, 0.86, 1), outer: new THREE.Color(1, 1, 1) };
/**
 * A thrust's lance of light: how many streaks, how long they shoot forward and fade (s), how wide the
 * core streak and the rest are (m), and how far each may start late (s).
 */
const LANCE_STREAKS = 14;
const LANCE_LIFE = 0.3;
const LANCE_CORE = 0.12;
const LANCE_WIDTH = 0.025;
const LANCE_STAGGER = 0.04;

/**
 * A white crescent swept between two edges of a swing: `inner[i]` near the hilt and `outer[i]` past
 * the tip, at the same moment `i` of the swing, first to last.
 */
export function slashTrail(scene:THREE.Object3D, inner:THREE.Vector3[], outer:THREE.Vector3[]):void {
	sweep(scene, inner, outer, SLASH);
}

/**
 * A lance of white light driven forward by a thrust: streaks rooted along the blade, from `hilt` to
 * `tip` (world), that shoot past the tip and close in on `impact`, where the blow lands, one thick
 * core streak down the blade's line among thinner ones. They reach out the whole time they fade.
 */
export function thrustLance(scene:THREE.Object3D, hilt:THREE.Vector3, tip:THREE.Vector3, impact:THREE.Vector3):void {
	const line = impact.clone().sub(hilt).normalize();
	const across = new THREE.Vector3().crossVectors(line, Math.abs(line.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
	const across2 = new THREE.Vector3().crossVectors(line, across);
	const lance = Array.from({ length: LANCE_STREAKS }, (_, i):Streak => {
		const core = i === 0;
		// Roots spread a little round the blade, tighter toward the tip; heads gather at the impact.
		const along = core ? 0.1 : Math.random();
		const spread = (core ? 0 : 0.12) * (1 - along * 0.6);
		const turn = Math.random() * Math.PI * 2;
		const root = hilt.clone().lerp(tip, along)
			.addScaledVector(across, Math.cos(turn) * spread).addScaledVector(across2, Math.sin(turn) * spread);
		const to = impact.clone().addScaledVector(across, (Math.random() - 0.5) * 0.08).addScaledVector(across2, (Math.random() - 0.5) * 0.08);
		const way = to.clone().sub(root);
		return {
			root,
			dir: way.clone().normalize(),
			length: way.length() * (core ? 1 : 0.75 + 0.35 * Math.random()),
			width: core ? LANCE_CORE : LANCE_WIDTH * (0.6 + 0.8 * Math.random()),
			delay: core ? 0 : LANCE_STAGGER * Math.random(),
		};
	});
	streaks(scene, lance, LANCE_LIFE);
}
