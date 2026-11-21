import { THREE, aimHeld, humanBone, reach, type Hand, HeldProps, UP, frameOf, heightOf, PoseMove } from './pose-body';

/**
 * Where a lit torch is held, whatever the clip does with that arm: the hand ahead of its shoulder, out to its side
 * and a little below it (fractions of height), so the elbow hangs by the ribs and the forearm rises; and the torch
 * upright, leaning `out` and `ahead` (1 is 45°), its flame above the hand and away from the body.
 */
const HAND = { ahead: 0.2, out: 0.08, up: 0 };
const LEAN = { ahead: 0.2, out: 0.25 };
/** How fast the hold eases in as the torch is lit and out as it goes out (per second). */
const HOLD_EASE = 6;
/** A held torch's own axes: its flame up its +Y, a side along ±X. */
const TORCH_UP = new THREE.Vector3(0, 1, 0);
const TORCH_SIDE = new THREE.Vector3(1, 0, 0);

/** A lit torch held up like a torch. It poses first, so any move that needs that arm (a reach, a swing) takes it. */
export class TorchHold extends PoseMove {
	private _hand:Hand = 'right';
	private _weight = 0;

	public override update(root:THREE.Object3D, alive:boolean, dt:number):void {
		const held = this.go.getComponent(HeldProps);
		const lit = held?.litHand();
		this._hand = lit ?? this._hand;
		this._weight += ((alive && lit ? 1 : 0) - this._weight) * Math.min(1, dt * HOLD_EASE);
		// Easing out, the hand may already hold what came after the torch.
		const torch = held?.item(this._hand)?.Torch ? held.prop(this._hand) : undefined;
		const shoulder = humanBone(root, `${this._hand}UpperArm`);
		if (this._weight < 0.01 || !torch || !shoulder) {
			return;
		}
		root.updateMatrixWorld(true);
		const height = heightOf(this.go);
		const { ahead, side } = frameOf(this.go, this._hand);
		const hand = shoulder.getWorldPosition(new THREE.Vector3())
			.addScaledVector(ahead, HAND.ahead * height)
			.addScaledVector(side, HAND.out * height)
			.addScaledVector(UP, HAND.up * height);
		reach(root, this._hand, hand, this._weight, UP.clone().negate().addScaledVector(side, 0.5));
		const up = UP.clone().addScaledVector(ahead, LEAN.ahead).addScaledVector(side, LEAN.out);
		aimHeld(root, this._hand, torch, TORCH_UP, TORCH_SIDE, up, ahead, this._weight);
	}
}
