import { THREE, MeshRenderer, Time, crouch, humanBone, reach, type Hand, Appearance, POSE_SECONDS, aheadOf, heightOf, pointOn, PoseMove } from './pose-body';

/** A give or take, as shares of its `POSE_SECONDS`: the hand is out by `REACH_OUT`, held there until `REACH_HOLD`, back at the end. */
const REACH_OUT = 0.28;
const REACH_HOLD = 0.56;
/**
 * Taking a thing, as fractions of height: below `TAKE_LOW` the body bends for it (fully at the
 * floor), down by up to `TAKE_DROP` and forward by up to `TAKE_LEAN` radians; then the feet step in
 * (up to `TAKE_STEP` m) as far as the arm still falls short. The back turns up to `TAKE_TWIST` radians toward a thing off to the side.
 */
const TAKE_LOW = 0.55;
const TAKE_DROP = 0.32;
const TAKE_LEAN = 1.1;
const TAKE_STEP = 0.8;
const TAKE_TWIST = 0.8;

/** Giving or taking (the `give` and `take` clips): the right hand out, held and back, to the other person's, or the body down to a thing. */
export class Take extends PoseMove {
	/** The take under way (its `Appearance.clipT0`) and the point it reaches for. */
	private _takeT0 = -1;
	private readonly _takeAt = new THREE.Vector3();

	public override get busy():boolean {
		const clip = this.go.getComponent(Appearance)?.clip;
		return clip === 'give' || clip === 'take';
	}

	public override update(root:THREE.Object3D, alive:boolean):void {
		if (!alive) {
			return;
		}
		const look = this.go.getComponent(Appearance);
		if (!look || (look.clip !== 'give' && look.clip !== 'take')) {
			return;
		}
		const u = (Time.time - look.clipT0) / POSE_SECONDS[look.clip];
		const weight = u < REACH_OUT
			? THREE.MathUtils.smoothstep(u, 0, REACH_OUT)
			: 1 - THREE.MathUtils.smoothstep(u, REACH_HOLD, 1);
		const other = look.clipToward;
		if (other?.getComponent(Appearance)) {
			// Hands meet halfway.
			reach(root, 'right', pointOn(this.go, 0.6).lerp(pointOn(other, 0.6), 0.5), weight);
			return;
		}
		// Where the thing was when the take began: picking it up takes it out of the world.
		if (this._takeT0 !== look.clipT0) {
			this._takeT0 = look.clipT0;
			const thing = other?.getComponent(MeshRenderer)?.mesh;
			this._takeAt.copy(thing ? topOf(thing) : pointOn(this.go, 0.6).add(aheadOf(this.go, 0.5)));
		}
		this.takeFrom(root, this._takeAt, weight);
	}

	/**
	 * Reaches for a thing the way a body can: bends down for it if it is low, turns the back toward it,
	 * steps in if it is still too far, then reaches with the nearer hand.
	 */
	private takeFrom(root:THREE.Object3D, target:THREE.Vector3, weight:number):void {
		const height = heightOf(this.go);
		const p = this.go.transform.position;
		const ahead = aheadOf(this.go, 1);
		const to = new THREE.Vector3(target.x - p.x, 0, target.z - p.z);
		const away = to.length();
		// Positive when the thing is to the left.
		const side = away > 1e-3 ? Math.atan2(ahead.x * to.z - ahead.z * to.x, ahead.x * to.x + ahead.z * to.z) * -1 : 0;
		const low = THREE.MathUtils.clamp((TAKE_LOW * height - (target.y - p.y)) / (TAKE_LOW * height), 0, 1);
		const hand:Hand = side > 0.4 ? 'left' : 'right';
		crouch(root, { drop: low * TAKE_DROP * height, lean: low * TAKE_LEAN, twist: THREE.MathUtils.clamp(side, -TAKE_TWIST, TAKE_TWIST) }, weight);
		// Step in as far as the bent body's arm still falls short.
		const stepIn = away > 1e-3 ? Math.min(TAKE_STEP, shortfall(root, hand, target, to.clone().normalize())) : 0;
		if (stepIn > 0) {
			this.body.step(root, to.normalize().multiplyScalar(stepIn * weight));
		}
		reach(root, hand, target, weight);
	}
}

function shortfall(root:THREE.Object3D, hand:Hand, target:THREE.Vector3, toward:THREE.Vector3):number {
	const [shoulder, elbow, wrist, knuckle] = ['UpperArm', 'LowerArm', 'Hand', 'MiddleProximal'].map((b) => humanBone(root, `${hand}${b}`));
	if (!shoulder || !elbow || !wrist) {
		return 0;
	}
	root.updateMatrixWorld(true);
	const at = (bone:THREE.Object3D):THREE.Vector3 => bone.getWorldPosition(new THREE.Vector3());
	const arm = 0.97 * (at(shoulder).distanceTo(at(elbow)) + at(elbow).distanceTo(at(wrist)) + (knuckle ? at(wrist).distanceTo(at(knuckle)) : 0));
	const d = target.clone().sub(at(shoulder));
	if (d.length() <= arm) {
		return 0;
	}
	// The least s with |d − s·toward| = arm; the nearest pass when the arm can never get there.
	const along = d.dot(toward);
	const gap = along * along - d.lengthSq() + arm * arm;
	return Math.max(0, gap >= 0 ? along - Math.sqrt(gap) : along);
}

/** The middle of a thing's top, where a hand takes it (into an open chest, off the floor). */
function topOf(thing:THREE.Object3D):THREE.Vector3 {
	// Not an open lid standing up over it.
	const box = new THREE.Box3();
	thing.traverse((part) => {
		if ((part as THREE.Mesh).isMesh && part.name !== 'lid' && part.parent?.name !== 'lid') {
			box.expandByObject(part, true);
		}
	});
	const at = box.getCenter(new THREE.Vector3());
	at.y = box.max.y - Math.min(0.08, (box.max.y - box.min.y) * 0.3);
	return at;
}
