import { lookAt, Component } from '@arc-director/kindling';
import { Order } from '../engine/order';
import { Reading } from './Reading';
import { Seated } from './Seated';
import { type Outcome } from '../render/spell-fx';
import { NPCInput } from './NPCInput';
import { findObject, isLiving } from '../director/names';
import { Bow } from './moves/Bow';
import { Dodge } from './moves/Dodge';
import { Spell } from './moves/Spell';
import { ClipStrike, Sword } from './moves/sword';
import { Take } from './moves/Take';
import { ToolUse } from './moves/ToolUse';
import { TorchHold } from './moves/TorchHold';
import { THREE, MeshRenderer, Time, type GameObject, Appearance, SpeechBubble, pointOn, type PoseBody, type PoseMove } from './moves/pose-body';

/** How far a character turns its head to someone talking (meters). */
const HEED_RANGE = 8;
/** Head turn ease per second, in and out. */
const LOOK_EASE = 4;

/**
 * Touches on top of the clip, every frame after it plays: the head turns to whoever this character
 * deals with or hears talking, the right hand reaches out to give and take, archers draw and loose
 * their bows, swordsmen stab, slice and guard, and casters raise their staffs to cast. Each move is its
 * own object (`moves/`), started through the field that holds it (`pose.bow.shoot(…)`).
 */
export class CharacterPose extends Component {
	public static override order = Order.present - 1;

	private _now = 0;
	private _look = 0;
	private readonly _lookAt = new THREE.Vector3();
	/** Whether a move has the model stepped off where the character stands (its root moved); put back before the moves each frame. */
	private _stepped = false;
	private readonly _body:PoseBody = {
		go: () => this.gameObject,
		now: () => this._now,
		step: (root, offset) => this.step(root, offset),
		movesBusy: () => this._moves.some((move) => move !== this.tool && move.busy),
	};

	public readonly bow = new Bow(this._body);
	public readonly sword = new Sword(this._body);
	public readonly clipStrike = new ClipStrike(this._body);
	public readonly spell = new Spell(this._body);
	public readonly dodge = new Dodge(this._body);
	private readonly _take = new Take(this._body);
	public readonly tool = new ToolUse(this._body);
	private readonly _torch = new TorchHold(this._body);
	/**
	 * In the order they pose: a torch held up first, then the body, then arms, then the head (after the list), so the
	 * head still turns to the target after the stance.
	 */
	private readonly _moves:PoseMove<unknown>[] = [this._torch, this.bow, this._take, this.sword, this.dodge, this.clipStrike, this.spell, this.tool];

	/**
	 * How the shot or spell under way turned out, told as its blow is settled: it flies at the
	 * target on a hit (or a block), wide of it on a miss, and not at all when cut short (the bow
	 * lowers, the spell dies out). Untold, it counts as cut once its wind-up is over by
	 * `RELEASE_GRACE`.
	 */
	public resolve(outcome:Outcome):void {
		this.bow.resolve(outcome);
		this.spell.resolve(outcome);
	}

	/** Seconds the shot or spell under way will take to reach its target once loosed: 0 for a blow, a bolt or a heal. */
	public flightTime():number {
		return this.bow.flightTime() ?? this.spell.flightTime();
	}

	public override lateUpdate(dt:number):void {
		this._now += dt;
		const root = this.gameObject.getComponent(MeshRenderer)?.mesh;
		if (!root) {
			return;
		}
		const alive = isLiving(this.gameObject);
		this.step(root, null);
		for (const move of this._moves) {
			move.update(root, alive, dt);
		}
		this.updateLook(root, alive ? this.lookTarget() : null, dt);
	}

	public override onDestroy():void {
		this._moves.forEach((move) => move.dispose());
	}

	/** Who to look at: someone being handed something, the peer this character faces, or the nearest voice. */
	private lookTarget():THREE.Vector3 | null {
		if (this.gameObject.getComponent(Seated)?.asleep) {
			return null;
		}
		const reading = this.gameObject.getComponent(Reading)?.lookingAt;
		if (reading) {
			return reading.clone();
		}
		const go = this.gameObject;
		const world = go.world;
		if (!world) {
			return null;
		}
		const fighting = this.bow.look() ?? this.sword.look();
		if (fighting) {
			return fighting;
		}
		const toward = go.getComponent(Appearance)?.clipToward;
		if (toward?.world === world) {
			return pointOn(toward, 0.9);
		}
		const npc = go.getComponent(NPCInput);
		const peer = npc?.faceName && Time.time < npc.faceUntil ? findObject(world, npc.faceName) : null;
		if (peer && peer !== go) {
			return pointOn(peer, 0.9);
		}
		let best:GameObject | null = null;
		let bestD = HEED_RANGE;
		world.forEachComponent(SpeechBubble, (bubble, other) => {
			if (other === go || Time.time > bubble.until) {
				return;
			}
			const d = pointOn(other, 0).distanceTo(pointOn(go, 0));
			if (d < bestD) {
				best = other;
				bestD = d;
			}
		});
		if (best) {
			return pointOn(best, 0.9);
		}
		return this.tool.look();
	}

	private updateLook(root:THREE.Object3D, target:THREE.Vector3 | null, dt:number):void {
		const ease = Math.min(1, dt * LOOK_EASE);
		this._look += ((target ? 1 : 0) - this._look) * ease;
		if (target) {
			this._lookAt.lerp(target, this._look < 0.05 ? 1 : Math.min(1, dt * 8));
		}
		if (this._look > 0.01) {
			lookAt(root, this._lookAt, this._look);
		}
	}

	private step(root:THREE.Object3D, offset:THREE.Vector3 | null):void {
		if (!offset) {
			if (this._stepped) {
				root.position.set(0, 0, 0);
				this._stepped = false;
			}
			return;
		}
		const parent = root.parent;
		if (!parent) {
			return;
		}
		parent.updateMatrixWorld(true);
		const at = parent.getWorldPosition(new THREE.Vector3()).add(offset);
		root.position.copy(parent.worldToLocal(at));
		root.updateMatrixWorld(true);
		this._stepped = true;
	}
}
