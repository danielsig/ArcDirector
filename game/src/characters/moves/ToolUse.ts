import { Reading } from '../Reading';
import { Seated } from '../Seated';
import { heldMap } from '../../render/tool-fx';
import { THREE, MeshRenderer, Time, closeHand, humanBone, palmOf, reach, type Hand, Celebrating, SpeechBubble, HeldProps, UP, frameOf, heightOf, PoseMove } from './pose-body';

/**
 * How a free hand shows a tool being called, while nothing else needs the arm: where it goes from the head (fractions
 * of height, ahead, up, and out to its own side), and what the head looks at there (ahead and to the far side of the
 * hand, in meters; up from the eyes). Reading a map looks at the hand itself. Any tool not named here is `recall`'s: a
 * hand to the temple, looking up, trying to remember. A look round sweeps from side to side.
 */
type ToolPose = { hand:{ ahead:number; up:number; out:number }; look?:{ ahead:number; away:number; up:number }; sweep?:boolean; map?:boolean };
const TOOL_POSES:Record<string, ToolPose> = {
	see_map: { hand: { ahead: 0.26, up: -0.2, out: 0.03 }, map: true },
	observe: { hand: { ahead: 0.07, up: 0.05, out: 0.02 }, look: { ahead: 6, away: 0, up: 0 }, sweep: true },
	earshot: { hand: { ahead: 0, up: 0, out: 0.085 }, look: { ahead: 3, away: 1.6, up: 0 } },
	recall: { hand: { ahead: 0.04, up: 0.03, out: 0.07 }, look: { ahead: 3, away: 0.8, up: 1.2 } },
};
/** How fast a tool's pose eases in and out (per second), how far a look round sweeps (m, each way), and how fast (radians/s). */
const TOOL_EASE = 5;
const SWEEP_REACH = 3.5;
const SWEEP_SPEED = 1.6;
/** How far a hand holding nothing closes round a map. */
const MAP_GRIP = 0.45;

/** A tool a mind calls, shown in a free arm and the head's turn, over whatever the legs are doing. */
export class ToolUse extends PoseMove {
	/** The tool being shown, until when; `weight` is how far its pose is in, eased. */
	private _tool:{ pose:ToolPose; until:number; t0:number; weight:number } | null = null;
	/** Where the tool's pose has the head looking. */
	private readonly _toolLook = new THREE.Vector3();

	/**
	 * Shows `tool` being called for `seconds`, in a free hand and in the head's turn, whenever nothing else
	 * needs them: a move, a line of speech or a fall takes the arm back at once, and it comes up again after.
	 */
	public show(tool:string, seconds:number):void {
		const now = this.now;
		const pose = TOOL_POSES[tool] ?? TOOL_POSES.recall!;
		const shown = { pose, until: now + seconds, t0: now, weight: this._tool?.pose === pose ? this._tool.weight : 0 };
		this._tool = shown;
		if (pose.map && this.go.world) {
			heldMap(this.go.world.native, () => {
				const root = this.go.getComponent(MeshRenderer)?.mesh;
				const hand = this.freeHand();
				const palm = root && hand ? palmOf(root, hand) : null;
				const head = root && humanBone(root, 'head');
				if (this._tool !== shown || !palm || !head) {
					return null;
				}
				return { palm, eyes: head.getWorldPosition(new THREE.Vector3()), weight: shown.weight };
			});
		}
	}

	/** Where the head looks while the tool shows, once its pose is well in. */
	public look():THREE.Vector3 | null {
		return this._tool && this._tool.weight > 0.2 ? this._toolLook.clone() : null;
	}

	public override dispose():void {
		this._tool = null;
	}

	public override update(root:THREE.Object3D, alive:boolean, dt:number):void {
		const tool = this._tool;
		if (!tool) {
			return;
		}
		const now = this.now;
		const hand = this.freeHand();
		const on = alive && !!hand && now < tool.until && !this.armsBusy();
		tool.weight += ((on ? 1 : 0) - tool.weight) * Math.min(1, dt * TOOL_EASE);
		if (now >= tool.until && tool.weight < 0.02) {
			this._tool = null;
			return;
		}
		const head = humanBone(root, 'head');
		if (!head || !hand || tool.weight < 0.02) {
			return;
		}
		root.updateMatrixWorld(true);
		const height = heightOf(this.go);
		const { ahead, right, side } = frameOf(this.go, hand);
		const eyes = head.getWorldPosition(new THREE.Vector3());
		const { pose } = tool;
		const at = eyes.clone()
			.addScaledVector(ahead, pose.hand.ahead * height)
			.addScaledVector(UP, pose.hand.up * height)
			.addScaledVector(side, pose.hand.out * height);
		reach(root, hand, at, tool.weight, UP.clone().negate().addScaledVector(side, 0.8));
		if (pose.map) {
			closeHand(root, hand, MAP_GRIP * tool.weight);
			this._toolLook.copy(at);
			return;
		}
		const look = pose.look!;
		const sweep = pose.sweep ? Math.sin((now - tool.t0) * SWEEP_SPEED) * SWEEP_REACH : 0;
		this._toolLook.copy(eyes)
			.addScaledVector(ahead, look.ahead)
			.addScaledVector(side, -look.away)
			.addScaledVector(right, sweep)
			.addScaledVector(UP, look.up);
	}

	/** The hand that holds nothing, the left first (the right most often carries the weapon); none if both are full. */
	private freeHand():Hand | undefined {
		const held = this.go.getComponent(HeldProps);
		return !held?.prop('left') ? 'left' : !held.prop('right') ? 'right' : undefined;
	}

	/** Whether the body is busy with something a tool's pose must not cover: a move, a line of speech, sitting, a cheer. */
	private armsBusy():boolean {
		const bubble = this.go.getComponent(SpeechBubble);
		return this.body.movesBusy()
			|| (!!bubble?.text && Time.time < bubble.until)
			|| !!this.go.getComponent(Seated)?.held
			|| !!this.go.getComponent(Reading)?.active
			|| !!this.go.getComponent(Celebrating)?.enabled;
	}
}
