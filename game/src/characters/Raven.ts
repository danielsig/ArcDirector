import { MeshRenderer, Time, yawToward, Component } from '@arc-director/kindling';
import * as THREE from 'three';
import { HumanBody } from '../engine/components';
import { Order } from '../engine/order';

/** Someone this close (m) sends a raven up. */
const SPOOK = 2.6;
/** Flight: speed (m/s), the arc's height over the straight line (m), how far it goes (m). */
const FLY_SPEED = 6;
const ARC = 3;
const FLY_MIN = 8;
const FLY_MAX = 16;
/** Wing beats per second in flight. */
const FLAP_HZ = 5;

/** What a raven on the ground does next, and for how long (s). */
type Act = { kind:'peck' | 'hop' | 'look' | 'still'; t0:number; seconds:number; from:THREE.Vector3; to:THREE.Vector3; yaw:number };
type Flight = { from:THREE.Vector3; to:THREE.Vector3; t0:number; seconds:number };

/** Bone turns (radians, file frame: the bird faces +Z, its left wing along +X) for one pose. */
type Pose = { body:number; head:[number, number]; tail:number; wing:[number, number, number]; tip:[number, number] };

/** Wings folded back along the body. */
const FOLDED:Pose = { body: 0, head: [0, 0], tail: 0, wing: [0, 1.35, -0.35], tip: [0.7, 0] };

/**
 * A raven (`Raven` model, rigged by `buildModels.mjs` `bird`) on the ground: it hops, pecks and
 * looks about. Anyone walking close sends it flapping off to land somewhere else nearby.
 */
export class Raven extends Component {
	public static override order = Order.present - 1;

	private _act:Act | null = null;
	private _flight:Flight | null = null;

	public override lateUpdate():void {
		const root = this.gameObject.getComponent(MeshRenderer)?.mesh;
		if (!root) {
			return;
		}
		const now = Time.time;
		if (!this._flight && this.spooked()) {
			this.takeOff(now);
		}
		const pose = this._flight ? this.fly(now) : this.potter(now);
		applyPose(root, pose);
	}

	/** Anyone with a body within {@link SPOOK}. */
	private spooked():boolean {
		const world = this.gameObject.world;
		const p = this.gameObject.transform.position;
		let near = false;
		world?.forEachComponent(HumanBody, (_body, go) => {
			const q = go.transform.position;
			near ||= Math.hypot(q.x - p.x, q.z - p.z) < SPOOK;
		});
		return near;
	}

	private takeOff(now:number):void {
		const p = this.gameObject.transform.position;
		const from = new THREE.Vector3(p.x, p.y, p.z);
		const world = this.gameObject.world;
		// Somewhere open to land, else back where it was.
		let to = from.clone();
		for (let i = 0; i < 12; i++) {
			const turn = Math.random() * Math.PI * 2;
			const reach = FLY_MIN + Math.random() * (FLY_MAX - FLY_MIN);
			const x = p.x + Math.cos(turn) * reach;
			const z = p.z + Math.sin(turn) * reach;
			const ground = world?.sampleTerrain(x, z);
			if (ground && !ground.blocked) {
				to = new THREE.Vector3(x, ground.worldY, z);
				break;
			}
		}
		this._act = null;
		this._flight = { from, to, t0: now, seconds: Math.max(1.5, from.distanceTo(to) / FLY_SPEED) };
	}

	/** Up, along, and down again on an arc, beating hard at the ends and gliding between. */
	private fly(now:number):Pose {
		const f = this._flight!;
		const u = Math.min(1, (now - f.t0) / f.seconds);
		const at = f.from.clone().lerp(f.to, u);
		at.y += Math.sin(Math.PI * u) * ARC;
		this.place(at);
		const dx = f.to.x - f.from.x;
		const dz = f.to.z - f.from.z;
		if (Math.hypot(dx, dz) > 0.1) {
			this.gameObject.transform.yaw = yawToward(dx, dz);
		}
		if (u >= 1) {
			this._flight = null;
			return FOLDED;
		}
		// Beats hard rising and landing, glides on the way.
		const beat = 0.35 + 0.65 * Math.abs(Math.cos(Math.PI * u));
		const ph = now * FLAP_HZ * Math.PI * 2;
		const open = Math.min(1, u * 8, (1 - u) * 8);
		return {
			body: 0.35 * open,
			head: [-0.25 * open, 0],
			tail: -0.15 * open,
			wing: [0, FOLDED.wing[1] * (1 - open), FOLDED.wing[2] * (1 - open) + Math.sin(ph) * 0.9 * beat * open],
			tip: [FOLDED.tip[0] * (1 - open), Math.sin(ph - 0.7) * 0.5 * beat * open],
		};
	}

	/** On the ground: pecks, hops a little way, or looks about. */
	private potter(now:number):Pose {
		let act = this._act;
		if (!act || now >= act.t0 + act.seconds) {
			act = this._act = this.nextAct(now);
		}
		const u = Math.min(1, (now - act.t0) / act.seconds);
		const bump = Math.sin(Math.PI * u);
		const pose:Pose = { ...FOLDED, head: [0, 0] };
		if (act.kind === 'peck') {
			// Two quick jabs.
			const jab = Math.max(0, Math.sin(Math.PI * 2 * u));
			pose.body = 0.55 * jab;
			pose.head = [0.6 * jab, 0];
			pose.tail = -0.3 * jab;
		}
		else if (act.kind === 'hop') {
			const at = act.from.clone().lerp(act.to, u);
			at.y += 0.07 * bump;
			this.place(at);
			this.gameObject.transform.yaw = act.yaw;
			pose.wing = [0, FOLDED.wing[1] - 0.25 * bump, FOLDED.wing[2] + 0.3 * bump];
			pose.tail = 0.25 * bump;
		}
		else if (act.kind === 'look') {
			pose.head = [-0.15 * bump, act.yaw * bump];
		}
		return pose;
	}

	private nextAct(now:number):Act {
		const p = this.gameObject.transform.position;
		const from = new THREE.Vector3(p.x, p.y, p.z);
		const roll = Math.random();
		if (roll < 0.35) {
			return { kind: 'peck', t0: now, seconds: 0.5, from, to: from, yaw: 0 };
		}
		if (roll < 0.6) {
			const yaw = this.gameObject.transform.yaw + (Math.random() - 0.5) * 1.6;
			const to = from.clone().add(new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(0.18));
			const ground = this.gameObject.world?.sampleTerrain(to.x, to.z);
			if (ground && !ground.blocked) {
				to.y = ground.worldY;
				return { kind: 'hop', t0: now, seconds: 0.22, from, to, yaw };
			}
		}
		if (roll < 0.8) {
			return { kind: 'look', t0: now, seconds: 0.9, from, to: from, yaw: (Math.random() - 0.5) * 1.6 };
		}
		return { kind: 'still', t0: now, seconds: 0.4 + Math.random() * 1.2, from, to: from, yaw: 0 };
	}

	private place(at:THREE.Vector3):void {
		const p = this.gameObject.transform.position;
		p.x = at.x;
		p.y = at.y;
		p.z = at.z;
	}
}

/** Sets the rig's bones; the right side mirrors the left. */
function applyPose(root:THREE.Object3D, pose:Pose):void {
	const set = (name:string, x:number, y:number, z:number):void => {
		root.getObjectByName(name)?.rotation.set(x, y, z);
	};
	set('Body', pose.body, 0, 0);
	set('Head', pose.head[0], pose.head[1], 0);
	set('Tail', pose.tail, 0, 0);
	set('WingL', pose.wing[0], pose.wing[1], pose.wing[2]);
	set('WingR', pose.wing[0], -pose.wing[1], -pose.wing[2]);
	set('WingTipL', 0, pose.tip[0], pose.tip[1]);
	set('WingTipR', 0, -pose.tip[0], -pose.tip[1]);
}
