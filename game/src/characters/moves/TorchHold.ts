import { THREE, holdAt, type Hand, HeldProps, heldPose, inWorld, PoseMove } from './pose-body';

/**
 * Where a lit torch is held, whatever the clip does with that arm: the hand ahead of its shoulder, a little out and
 * below it, so the elbow hangs by the ribs and the forearm rises; the torch standing in the fist, leaning out and
 * ahead, its flame above the hand and away from the body.
 */
const HOLD = heldPose([0.136, 0.649, -0.252], [-90, -76, -68.6], [0.157, 0.634, -0.078]);
/** How fast the hold eases in as the torch is lit and out as it goes out (per second). */
const HOLD_EASE = 6;

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
		if (this._weight >= 0.01 && torch) {
			holdAt(root, this._hand, torch, inWorld(this.go, this._hand, HOLD), this._weight);
		}
	}
}
