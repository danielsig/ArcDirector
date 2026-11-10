import { BoxCollider, Component, MeshRenderer, Time, closeHand, create, crouch, humanBone, palmOf, placeFoot, reach, restFoot, underInk, yawToForward, type GameObject } from '@arc-director/kindling';
import { findRoute, pointGoal } from 'arc-director';
import * as THREE from 'three';
import { Belly } from '../engine/Belly';
import { Furniture, Named, Vitals } from '../engine/components';
import { bindMesh } from '../engine/demo-mesh-renderer';
import { Order } from '../engine/order';
import { getDef } from '../items/defs';
import { instantiateDef } from '../items/instance';
import { tryInsert } from '../items/inventory';
import { dropItem } from '../items/pickup';
import { canStand, cellWays } from '../world/path';
import { showsWater } from '../world/sand';

/** Hip joint height over the floor when sat (a chair seat is about 0.47 m, a mattress 0.39 m), and how far ahead of the seat's middle it sits, so the seat of the trousers clears the backrest. */
const HIP_SEAT = 0.65;
const HIP_EDGE = 0.57;
const HIP_AHEAD = 0.1;
/** Seconds to get settled, and to get up; a bed takes this twice, once for its edge and once for lying down. */
const SETTLE_SECONDS = 0.8;
/** How far to the side a body steps to get up out of a chair, and out of a bed. */
const STEP_ASIDE = 0.45;
const STEP_OUT_OF_BED = 0.8;
/** The rod's length, and how steeply it points up over the water (radians). */
const ROD_LENGTH = 2.2;
const ROD_RISE = 0.55;
/** Where the line meets the water, meters ahead. */
const CAST = 2.7;
/** Seconds between bites, and the chance of landing one before luck. */
const BITE_SECONDS = 60;
const CATCH_CHANCE = 0.5;
/** In a bed (meters from its middle, along it toward the pillow): where someone on the edge sits out from the middle, where a sleeper's neck lies and how high, where its ankles and hands come to rest, and how high its legs swing up over the frame on the way. */
const EDGE = 0.25;
const NECK_ALONG = 0.36;
const NECK_HEIGHT = 0.55;
const ANKLES_ALONG = -0.5;
const ANKLE_HEIGHT = 0.47;
const LEGS_SWING = 0.4;
const HANDS_AHEAD = 0.2;
const HANDS_ALONG = 0.14;
const HAND_HEIGHT = 0.47;
/** A sleeper's curl (radians of back), and how far above and ahead its upper leg and hand lie on its lower ones. */
const CURL = 0.5;
const STACKED = 0.09;

type Spot = { x:number; z:number; yaw:number };

const UP = new THREE.Vector3(0, 1, 0);
const LENGTHWISE = new THREE.Vector3(0, 0, 1);

/** Where along a seat, in meters from its middle toward its head or back, a body may stand beside it: abreast of its middle if there is room, else toward its foot. */
const BESIDE_ALONG = [0, -0.3, -0.6, 0.3];

/** Where a body fits beside `seat` on its `side` (1 the seat's right, -1 its left), the likeliest first. */
function spotsBeside(seat:GameObject, side:number, body:GameObject):{ x:number; z:number }[] {
	const s = seat.transform.position;
	const right = yawToForward(seat.transform.yaw - Math.PI / 2);
	const along = yawToForward(seat.transform.yaw);
	const out = side * (seat.getComponent(Furniture)!.kind === 'bed' ? STEP_OUT_OF_BED : STEP_ASIDE);
	return BESIDE_ALONG
		.map((a) => ({ x: s.x + right.x * out + along.x * a, z: s.z + right.z * out + along.z * a }))
		.filter((p) => !!body.world && canStand(body.world, body, p.x, p.z));
}

/** The side of `seat` nearer `body`: 1 its right, -1 its left. */
function nearerSide(seat:GameObject, body:GameObject):number {
	const s = seat.transform.position;
	const p = body.transform.position;
	const right = yawToForward(seat.transform.yaw - Math.PI / 2);
	return (p.x - s.x) * right.x + (p.z - s.z) * right.z < 0 ? -1 : 1;
}

/**
 * Where `body` goes to sit on or lie in `seat`: beside it on its nearer side, or the other when it cannot get there. None
 * when it cannot get to either: a chair in a tight corner, or a house it is locked out of.
 */
export function approachSpot(seat:GameObject, body:GameObject):{ x:number; z:number } | undefined {
	const world = body.world;
	if (!world) {
		return undefined;
	}
	const p = body.transform.position;
	const side = nearerSide(seat, body);
	return [...spotsBeside(seat, side, body), ...spotsBeside(seat, -side, body)].find((spot) => {
		const route = findRoute(cellWays(world), body, [p.x, p.z], pointGoal([spot.x, spot.z]));
		return !!route && 'points' in route;
	});
}

/** Whether someone in the chair `seat` looks out over water near enough to cast a line in. */
export function overWater(seat:GameObject):boolean {
	const p = seat.transform.position;
	const f = yawToForward(seat.transform.yaw + Math.PI);
	return showsWater(seat.world?.tileAtWorld(p.x + f.x * CAST, p.z + f.z * CAST)?.def);
}

/**
 * What a body rests on and how: `settle` takes it to a chair (knees bent, feet forward; with `rod`, fishing the water
 * ahead, a line out to a bobbing float) or into a bed (sat on its edge, then curled on its side, asleep), and its body
 * stops being solid so the furniture does not push it off. `stand` gets it up the same way back: the rod goes, it steps
 * aside and is solid again. On its feet, with no `seatID`, it does nothing.
 */
export class Seated extends Component {
	// After the clip and the hands' props, before `CharacterPose` turns the head.
	public static override order = Order.present - 1.5;
	public static override saved = ['seatID', 'rod', 'wakeAt', 'side'];

	/** The id of the `Furniture` it rests on; '' on its feet. */
	public seatID = '';
	public rod = false;
	/** When a sleeper wakes by itself; 0 sleeps until woken. */
	public wakeAt = 0;
	/** The side of a bed it lies facing: 1 the bed's right, -1 its left. */
	public side = 1;
	/** 1 settled, 0 on its feet; eases between them. In a bed, 0.5 is sitting on the edge. */
	private _sit = 1;
	private _standing = false;
	private _gear:{ rod:THREE.Object3D; line:THREE.Line; float:THREE.Mesh } | null = null;
	private _time = 0;
	/** Where it stands off its seat, while on its way there or back. */
	private _from:Spot | null = null;
	/** The way out of a bed it gets up by; null for the way it faces. */
	private _outYaw:number | null = null;
	/** When the next bite comes; 0 with no line out yet. */
	private _nextBite = 0;

	/** Whether it rests on anything, and is not yet getting up: walking must wait. */
	public get resting():boolean {
		return !!this.seatID && !this._standing;
	}

	/** Whether its body still belongs to its seat, getting up included. */
	public get held():boolean {
		return !!this.seatID;
	}

	public get asleep():boolean {
		return this.resting && this._sit === 1 && this.furniture()?.kind === 'bed';
	}

	/** What others see it doing there. */
	public get doing():string {
		return this.asleep ? 'asleep' : this.rod ? 'fishing' : 'sitting';
	}

	private seat():GameObject | undefined {
		return this.gameObject.world?.findByID(this.seatID);
	}

	private furniture():Furniture | undefined {
		return this.seat()?.getComponent(Furniture);
	}

	/** Gets on `seat`, with a rod out if `rod`: from where it stands, easing over {@link SETTLE_SECONDS}. */
	public settle(seat:GameObject, { rod = false, seconds = 0 }:{ rod?:boolean; seconds?:number } = {}):void {
		if (this.seat() !== seat) {
			this.vacate();
		}
		const p = this.gameObject.transform.position;
		this._from = this.seatID === seat.id ? null : { x: p.x, z: p.z, yaw: this.gameObject.transform.yaw };
		this._sit = this._from ? 0 : 1;
		this._standing = false;
		this._outYaw = null;
		if (this._from && seat.getComponent(Furniture)!.kind === 'bed') {
			const nearer = nearerSide(seat, this.gameObject);
			this.side = spotsBeside(seat, nearer, this.gameObject).length > 0 ? nearer : -nearer;
		}
		this.seatID = seat.id;
		this.rod = rod;
		this.wakeAt = seconds > 0 ? Time.time + seconds : 0;
		seat.getComponent(Furniture)!.occupant = this.gameObject;
		this.setSolid(false);
	}

	/** Gets up: the rod is put away now, and the pose eases out over {@link SETTLE_SECONDS}. */
	public stand():void {
		if (!this.resting) {
			return;
		}
		this._standing = true;
		this.rod = false;
		this.dropGear();
		this._from ??= this.wayOut();
	}

	public override onDestroy():void {
		this.dropGear();
		this.vacate();
		this.setSolid(true);
	}

	public override update():void {
		if (this.wakeAt > 0 && Time.time >= this.wakeAt) {
			this.stand();
		}
	}

	public override lateUpdate(dt:number):void {
		const seat = this.seat();
		if (!seat) {
			return;
		}
		this._time += dt;
		const furniture = seat.getComponent(Furniture)!;
		// A body that starts or is restored on its seat claims it.
		if (!furniture.occupant) {
			furniture.occupant = this.gameObject;
			this.setSolid(false);
		}
		const model = this.gameObject.getComponent(MeshRenderer)?.mesh;
		const bed = furniture.kind === 'bed';
		const step = dt / (bed ? 2 * SETTLE_SECONDS : SETTLE_SECONDS);
		this._sit = THREE.MathUtils.clamp(this._sit + (this._standing ? -step : step), 0, 1);
		this.moveOnto(seat);
		if (this._standing && this._sit === 0) {
			this.rise(model);
			return;
		}
		if (!this._standing) {
			this.fish();
		}
		if (!model) {
			return;
		}
		model.position.set(0, 0, 0);
		model.quaternion.identity();
		if (bed) {
			this.poseSitting(model, this.edge(seat), HIP_EDGE, THREE.MathUtils.smoothstep(this._sit, 0, 0.5));
			this.poseLying(model, seat, THREE.MathUtils.smoothstep(this._sit, 0.5, 1));
		}
		else {
			this.poseSitting(model, seat.transform.position, HIP_SEAT, THREE.MathUtils.smoothstep(this._sit, 0, 1));
		}
	}

	/** The body between where it stands and `seat`, facing out from it: in a bed by way of its edge, and there once settled. */
	private moveOnto(seat:GameObject):void {
		const t = this.gameObject.transform;
		const s = seat.transform.position;
		const bed = seat.getComponent(Furniture)!.kind === 'bed';
		const rest = { x: s.x, z: s.z, yaw: bed ? this.lyingYaw(seat, this.side) : seat.transform.yaw + Math.PI };
		const from = this._from ?? rest;
		const [a, b, k]:[Spot, Spot, number] = !bed ? [from, rest, THREE.MathUtils.smoothstep(this._sit, 0, 1)]
			: this._sit < 0.5 ? [from, this.edge(seat), THREE.MathUtils.smoothstep(this._sit, 0, 0.5)]
			: [this.edge(seat), rest, THREE.MathUtils.smoothstep(this._sit, 0.5, 1)];
		t.position.x = a.x + (b.x - a.x) * k;
		t.position.z = a.z + (b.z - a.z) * k;
		const turn = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
		t.yaw = a.yaw + turn * k;
		if (this._sit === 1 && !this._standing) {
			this._from = null;
		}
	}

	/** Facing out over the bed's `side`: how a sleeper lies, and how it sits on that edge. */
	private lyingYaw(seat:GameObject, side:number):number {
		return seat.transform.yaw - side * Math.PI / 2;
	}

	/** Where someone sits on the edge of bed `seat`: the side it lies facing, or the way out it gets up by. */
	private edge(seat:GameObject):Spot {
		const s = seat.transform.position;
		const yaw = this._outYaw ?? this.lyingYaw(seat, this.side);
		const f = yawToForward(yaw);
		return { x: s.x + f.x * EDGE, z: s.z + f.z * EDGE, yaw };
	}

	/** Off its seat and on its feet at last. */
	private rise(model:THREE.Object3D | null | undefined):void {
		this.vacate();
		this.seatID = '';
		this.wakeAt = 0;
		this._standing = false;
		this._from = null;
		this._outYaw = null;
		this.setSolid(true);
		model?.position.set(0, 0, 0);
		model?.quaternion.identity();
	}

	private vacate():void {
		const furniture = this.furniture();
		if (furniture?.occupant === this.gameObject) {
			furniture.occupant = null;
		}
	}

	/** How far along `yaw` a body steps off `seat`, as far as the seat asks. */
	private stepOff(seat:GameObject, yaw:number):{ x:number; z:number } {
		const reach = seat.getComponent(Furniture)!.kind === 'bed' ? STEP_OUT_OF_BED : STEP_ASIDE;
		const f = yawToForward(yaw);
		return { x: f.x * reach, z: f.z * reach };
	}

	/** Whether stepping off `seat` along `yaw` leads somewhere a body fits. */
	private isClear(seat:GameObject, yaw:number):boolean {
		const go = this.gameObject;
		const s = seat.transform.position;
		const out = this.stepOff(seat, yaw);
		return go.world?.blocker(go, s.x + out.x, s.z + out.z) === undefined;
	}

	/** Where it stands once off its seat, whichever way is open: from a chair its right, its left or straight ahead, keeping its yaw; from a bed the side it faces, the other side or the foot, facing out. */
	private wayOut():Spot {
		const t = this.gameObject.transform;
		const seat = this.seat()!;
		const bed = seat.getComponent(Furniture)!.kind === 'bed';
		const side = bed ? [this.side, -this.side].find((s) => spotsBeside(seat, s, this.gameObject).length > 0) : undefined;
		if (side !== undefined) {
			this._outYaw = this.lyingYaw(seat, side);
			return { ...spotsBeside(seat, side, this.gameObject)[0]!, yaw: this._outYaw };
		}
		const turns = bed ? [-this.side * Math.PI / 2] : [-Math.PI / 2, Math.PI / 2, 0];
		const yaw = t.yaw + (turns.find((turn) => this.isClear(seat, t.yaw + turn)) ?? turns[0]!);
		const out = this.stepOff(seat, yaw);
		if (bed) {
			this._outYaw = yaw;
		}
		return { x: t.position.x + out.x, z: t.position.z + out.z, yaw: bed ? yaw : t.yaw };
	}

	/** A bite every {@link BITE_SECONDS}: a trout at even chances, better for the lucky. */
	private fish():void {
		const go = this.gameObject;
		if (!this.rod) {
			this._nextBite = 0;
			return;
		}
		this._nextBite ||= Time.time + BITE_SECONDS;
		if (Time.time < this._nextBite) {
			return;
		}
		this._nextBite = Time.time + BITE_SECONDS;
		if (Math.random() >= CATCH_CHANCE + (go.getComponent(Belly)?.luck ?? 0)) {
			return;
		}
		const trout = instantiateDef(getDef('silver_trout'));
		if (!tryInsert(go, trout)) {
			dropItem(go, trout);
		}
		go.world?.caught(go, 'SilverTrout');
	}

	/** Sat with its hip joints `hipHeight` over the floor at `s`, the seat's middle. */
	private poseSitting(root:THREE.Object3D, s:{ x:number; z:number }, hipHeight:number, w:number):void {
		const go = this.gameObject;
		const p = go.transform.position;
		const f = yawToForward(go.transform.yaw);
		const ahead = new THREE.Vector3(f.x, 0, f.z);
		const side = new THREE.Vector3(-f.z, 0, f.x);
		root.updateMatrixWorld(true);
		const hipBone = humanBone(root, 'hips');
		const hips = hipBone?.getWorldPosition(new THREE.Vector3());
		if (hipBone && hips) {
			crouch(root, { drop: Math.max(0, hips.y - p.y - hipHeight), lean: 0.12 }, w);
			// Crouching sends the hips back; slide the whole model so they land just ahead of the seat's middle.
			root.updateMatrixWorld(true);
			const sat = hipBone.getWorldPosition(new THREE.Vector3());
			const parent = root.parent;
			if (parent) {
				const at = parent.getWorldPosition(new THREE.Vector3());
				at.x += (s.x + ahead.x * HIP_AHEAD - sat.x) * w;
				at.z += (s.z + ahead.z * HIP_AHEAD - sat.z) * w;
				root.position.copy(parent.worldToLocal(at));
				root.updateMatrixWorld(true);
			}
		}
		for (const hand of [-1, 1] as const) {
			const foot = new THREE.Vector3(p.x, p.y + 0.14, p.z).addScaledVector(ahead, 0.5).addScaledVector(side, hand * 0.13);
			placeFoot(root, hand < 0 ? 'left' : 'right', foot, w, ahead);
			restFoot(root, hand < 0 ? 'left' : 'right', w);
		}
		if (!this.rod || this._standing) {
			this.dropGear();
			return;
		}
		// Both fists on the butt in the lap, the rod pointing up and out over the water.
		const dir = ahead.clone().multiplyScalar(Math.cos(ROD_RISE)).addScaledVector(UP, Math.sin(ROD_RISE));
		const grip = new THREE.Vector3(p.x, p.y + 0.62, p.z).addScaledVector(ahead, 0.3).addScaledVector(side, 0.06);
		reach(root, 'right', grip, w, side.clone().negate());
		reach(root, 'left', grip.clone().addScaledVector(dir, 0.28).addScaledVector(side, -0.06), w);
		closeHand(root, 'right', 1);
		closeHand(root, 'left', 1);
		// The rod runs through both fists: from the lower palm through the upper one, unless the arms left them crossed.
		root.updateMatrixWorld(true);
		const lower = palmOf(root, 'right') ?? grip;
		const upper = palmOf(root, 'left');
		const axis = upper ? upper.clone().sub(lower).normalize() : dir;
		this.poseGear(lower.clone().addScaledVector(axis.dot(dir) > 0.6 ? axis : dir, -0.15), axis.dot(dir) > 0.6 ? axis : dir, ahead);
	}

	/**
	 * From sitting on the edge, tipped over sideways onto the mattress, still facing the way it sat: its head on the
	 * pillow, its back curled, knees drawn up ahead of it (a bed is shorter than a body) and hands by its chest.
	 */
	private poseLying(root:THREE.Object3D, seat:GameObject, w:number):void {
		const parent = root.parent;
		const neck = humanBone(root, 'neck');
		const hips = humanBone(root, 'hips');
		if (!parent || !neck || !hips || w <= 0) {
			return;
		}
		crouch(root, { lean: CURL }, w);
		const go = this.gameObject;
		const y = go.transform.position.y;
		const s = seat.transform.position;
		const f = yawToForward(seat.transform.yaw);
		const along = (meters:number, height:number):THREE.Vector3 => new THREE.Vector3(s.x + f.x * meters, y + height, s.z + f.z * meters);
		const tip = (share:number):THREE.Vector3 => {
			root.quaternion.setFromAxisAngle(LENGTHWISE, this.side * share * Math.PI / 2);
			root.updateMatrixWorld(true);
			return hips.getWorldPosition(new THREE.Vector3());
		};
		// The hips slide along the mattress to where they lie once the neck is on the pillow, so tipping never sinks them through it.
		const flat = tip(1).add(along(NECK_ALONG, NECK_HEIGHT)).sub(neck.getWorldPosition(new THREE.Vector3()));
		const hipsNow = tip(w);
		root.position.add(parent.worldToLocal(hipsNow.clone().lerp(flat, w)).sub(parent.worldToLocal(hipsNow.clone())));
		root.updateMatrixWorld(true);
		const face = yawToForward(go.transform.yaw);
		const ahead = new THREE.Vector3(face.x, 0, face.z);
		const out = (bone:THREE.Object3D):number => {
			const at = bone.getWorldPosition(new THREE.Vector3());
			return (at.x - s.x) * ahead.x + (at.z - s.z) * ahead.z;
		};
		const swing = Math.sin(Math.PI * w) * LEGS_SWING;
		for (const limb of ['left', 'right'] as const) {
			// Tipped toward its left it lies with its right side up.
			const upper = (limb === 'right') === (this.side > 0) ? STACKED : 0;
			placeFoot(root, limb, along(ANKLES_ALONG, ANKLE_HEIGHT + upper + swing).addScaledVector(ahead, out(hips) + upper), w, ahead);
			reach(root, limb, along(HANDS_ALONG, HAND_HEIGHT + upper).addScaledVector(ahead, out(neck) + HANDS_AHEAD + upper), w, new THREE.Vector3(-f.x, -0.5, -f.z));
		}
	}

	/** The rod from `butt` along `dir`, and its line sagging from the tip to the float bobbing `CAST` m out. */
	private poseGear(butt:THREE.Vector3, dir:THREE.Vector3, ahead:THREE.Vector3):void {
		const scene = this.gameObject.world?.native;
		if (!scene) {
			return;
		}
		const gear = this._gear ??= this.makeGear(scene);
		gear.rod.position.copy(butt);
		gear.rod.quaternion.setFromUnitVectors(UP, dir);
		const tip = butt.clone().addScaledVector(dir, ROD_LENGTH);
		const p = this.gameObject.transform.position;
		const float = new THREE.Vector3(p.x, 0.02 + Math.sin(this._time * 2.3) * 0.015, p.z).addScaledVector(ahead, CAST);
		gear.float.position.copy(float);
		const pos = gear.line.geometry.getAttribute('position') as THREE.BufferAttribute;
		for (let i = 0; i < pos.count; i++) {
			const t = i / (pos.count - 1);
			const at = tip.clone().lerp(float, t);
			// A slack line hangs lowest past its middle.
			at.y -= Math.sin(Math.PI * t) * 0.25 * t;
			pos.setXYZ(i, at.x, at.y, at.z);
		}
		pos.needsUpdate = true;
		gear.line.geometry.computeBoundingSphere();
	}

	private makeGear(scene:THREE.Object3D):NonNullable<Seated['_gear']> {
		bindMesh('fishing_rod');
		const rod = create('fishing_rod') ?? new THREE.Group();
		// No depth, so the outline pass sees no edge along it.
		const lineMaterial = new THREE.LineBasicMaterial({ color: 0xe8e2d0, transparent: true, opacity: 0.8, depthWrite: false });
		underInk(lineMaterial);
		const line = new THREE.Line(
			new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12 * 3), 3)),
			lineMaterial,
		);
		line.frustumCulled = false;
		const float = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xd8402a }));
		scene.add(rod, line, float);
		return { rod, line, float };
	}

	private dropGear():void {
		const gear = this._gear;
		if (!gear) {
			return;
		}
		for (const part of [gear.rod, gear.line, gear.float]) {
			part.removeFromParent();
			part.traverse((node) => {
				const mesh = node as THREE.Mesh;
				mesh.geometry?.dispose();
				(Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []).forEach((m) => m.dispose());
			});
		}
		this._gear = null;
	}

	/** Solid or not; never a corpse, which `dropDown` has already taken out of the way. */
	private setSolid(solid:boolean):void {
		const col = this.gameObject.getComponent(BoxCollider);
		if (col) {
			col.enabled = solid && (this.gameObject.getComponent(Vitals)?.hp ?? 1) > 0;
		}
	}
}

/** The name of whoever rests on `seat`, for the words about it. */
export function occupantName(seat:GameObject):string | undefined {
	const occupant = seat.getComponent(Furniture)?.occupant;
	return occupant ? occupant.getComponent(Named)?.id ?? occupant.id : undefined;
}
