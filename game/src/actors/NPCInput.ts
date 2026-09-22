import { Component } from '../engine/Component';
import { Order } from '../engine/order';
import type { GameObject } from '../engine/GameObject';
import { Companion, Door, Interior, Lock, Named, Celebrating } from '../engine/components';
import { distXZ } from '../items/inventory';
import { resolveNamedTarget, USE_RANGE } from '../items/pickup';
import { cellWalkable, findPath } from '../world/path';
import {
	buildingOfDoor,
	doorInteriorAlong,
	interiorContains,
} from '../world/interior';

const GO_TO_TIMEOUT = 45;
const APPROACH = USE_RANGE * 0.55;
/** Half-width of a doorway. A door far off the line does not block. */
const DOOR_HALF = 1.2;

function segmentCrossesDoor(
	px:number,
	pz:number,
	tx:number,
	tz:number,
	dx:number,
	dz:number,
	axis:'x' | 'z',
):boolean {
	if (axis === 'x') {
		const span = tx - px;
		if (span === 0 || (px - dx) * (tx - dx) >= 0) {
			return false;
		}
		const t = (dx - px) / span;
		if (t <= 0 || t >= 1) {
			return false;
		}
		return Math.abs(pz + t * (tz - pz) - dz) <= DOOR_HALF;
	}
	const span = tz - pz;
	if (span === 0 || (pz - dz) * (tz - dz) >= 0) {
		return false;
	}
	const t = (dz - pz) / span;
	if (t <= 0 || t >= 1) {
		return false;
	}
	return Math.abs(px + t * (tx - px) - dx) <= DOOR_HALF;
}

export type NPCVerbResult = {
	ok:boolean;
	interrupted?:boolean;
	reason?:string;
	verb?:string;
};

export type WanderGuide = {
	stop?:()=>boolean;
	dest?:()=>{ x:number; z:number } | null;
	note?:()=>void;
};

type Job =
	| { kind:'go_to'; name:string; startedAt:number; within:number; done:(r:NPCVerbResult)=>void }
	| { kind:'follow'; name:string; startedAt:number; until:number; done:(r:NPCVerbResult)=>void }
	| { kind:'wander'; startedAt:number; until:number; guide?:WanderGuide; notedAt:number; done:(r:NPCVerbResult)=>void }
	| { kind:'wait'; until:number; stop?:()=>boolean; done:(r:NPCVerbResult)=>void }
	| { kind:'point'; dest:{ x:number; z:number }; startedAt:number; done:(r:NPCVerbResult)=>void };

/** Named destinations + conversation overlay. No yaw verb. */
export class NPCInput extends Component {
	static override order = Order.npcInput;
	destinationName:string | null = null;
	destinationPoint:{ x:number; z:number } | null = null;
	faceName:string | null = null;
	faceUntil = 0;
	converseName:string | null = null;
	aiOn = true;
	/** Next time `world.time` this body may start a cast. */
	attackReadyAt = 0;
	/** Next time `world.time` this body may start a heal. */
	healReadyAt = 0;
	private job:Job | null = null;
	private lastX = 0;
	private lastZ = 0;
	private stuckFor = 0;
	private detour:{ x:number; z:number } | null = null;
	private route:{ x:number; z:number }[] = [];
	private routeAt = 0;
	private routeGoal:{ x:number; z:number } | null = null;
	private wanderDest:{ x:number; z:number } | null = null;
	/** Side of a door we started on (+1 / −1). Frozen so an open-door walk does not flip dest. */
	private doorPass = 0;

	goTo(name:string, within = APPROACH):Promise<NPCVerbResult> {
		return this.begin({
			kind: 'go_to',
			name,
			within,
			startedAt: this.now(),
			done: () => undefined,
		});
	}

	follow(name:string, seconds = 6):Promise<NPCVerbResult> {
		return this.begin({
			kind: 'follow',
			name,
			startedAt: this.now(),
			until: this.now() + seconds,
			done: () => undefined,
		});
	}

	wander(seconds = 6, guide?:WanderGuide):Promise<NPCVerbResult> {
		return this.begin({
			kind: 'wander',
			startedAt: this.now(),
			until: this.now() + seconds,
			guide,
			notedAt: 0,
			done: () => undefined,
		});
	}

	wait(seconds = 1, stop?:()=>boolean):Promise<NPCVerbResult> {
		return this.begin({
			kind: 'wait',
			until: this.now() + seconds,
			stop,
			done: () => undefined,
		});
	}

	goToPoint(x:number, z:number):Promise<NPCVerbResult> {
		return this.begin({
			kind: 'point',
			dest: { x, z },
			startedAt: this.now(),
			done: () => undefined,
		});
	}

	faceToward(name:string, until = Number.POSITIVE_INFINITY):void {
		this.faceName = name;
		this.faceUntil = until;
	}

	attend(name:string):void {
		if (!name) {
			return;
		}
		this.faceToward(name);
		this.converseName = name;
		if (this.job?.kind === 'wander') {
			this.finish({ ok: true, verb: 'wander', reason: 'attend' });
		}
	}

	busy():boolean {
		return this.job !== null;
	}

	jobKind():string | null {
		return this.job?.kind ?? null;
	}

	interrupt(reason = 'urgent'):void {
		if (this.job) {
			this.finish({ ok: false, interrupted: true, verb: this.job.kind, reason });
		}
	}

	/** Named go_to / follow target, if any. Point walks leave this empty. */
	headingTo():string | null {
		if (this.job?.kind === 'go_to' || this.job?.kind === 'follow') {
			return this.job.name;
		}
		return this.destinationName;
	}

	override update(dt:number):void {
		if (!this.gameObject.world?.arcDirectorOn) {
			return;
		}
		if (!this.aiOn) {
			if (this.job) {
				this.finish({ ok: true, interrupted: true, verb: this.job.kind, reason: 'rest' });
			}
			this.steerCompanion(dt);
			return;
		}
		const job = this.job;
		if (!job) {
			this.steerCompanion(dt);
			return;
		}
		const now = this.now();
		if (job.kind === 'wait') {
			this.steer(null, null);
			if (job.stop?.()) {
				this.finish({ ok: true, verb: 'wait', reason: 'until' });
				return;
			}
			if (now >= job.until) {
				this.finish({ ok: true, verb: 'wait' });
			}
			return;
		}
		if (job.kind === 'point') {
			if (now - job.startedAt > GO_TO_TIMEOUT) {
				this.finish({ ok: false, verb: 'go_to', reason: 'stuck' });
				return;
			}
			if (this.arrivedAt(job.dest, 0.45)) {
				this.finish({ ok: true, verb: 'go_to' });
				return;
			}
			const next = this.followPath(job.dest, dt);
			if (!next) {
				this.finish({
					ok: false,
					verb: 'go_to',
					reason: 'cannot reach point — path blocked (locked door, water, or walls)',
				});
				return;
			}
			this.steer(null, next);
			return;
		}
		if (job.kind === 'wander') {
			this.noteWander(job);
			if (this.wanderUntilReached()) {
				this.finish({ ok: true, verb: 'wander', reason: 'until' });
				return;
			}
			if (now >= job.until) {
				this.finish({ ok: true, verb: 'wander' });
				return;
			}
			if (!this.wanderDest || this.arrivedAt(this.wanderDest, 0.45)) {
				this.wanderDest = job.guide?.dest?.() ?? this.randomWalkPoint();
				this.clearRoute();
			}
			if (!this.wanderDest) {
				this.steer(null, null);
				return;
			}
			const next = this.followPath(this.wanderDest, dt);
			if (!next) {
				this.wanderDest = null;
				this.clearRoute();
				this.steer(null, null);
				return;
			}
			this.steer(null, next);
			return;
		}
		const target = this.findNamed(job.name);
		if (!target) {
			this.finish({ ok: false, verb: job.kind, reason: `no such place ${job.name}` });
			return;
		}
		if (job.kind === 'follow') {
			if (now >= job.until) {
				this.finish({ ok: true, verb: 'follow' });
				return;
			}
			const dest = this.approachPoint(target);
			this.steer(null, this.followPath(dest, dt) ?? dest);
			return;
		}
		if (now - job.startedAt > GO_TO_TIMEOUT) {
			this.finish({ ok: false, verb: 'go_to', reason: 'stuck' });
			return;
		}
		const blocked = this.lockedDoorOnPath(target);
		if (blocked) {
			const name = blocked.getComponent(Named)?.id ?? blocked.id;
			this.finish({ ok: false, verb: 'go_to', reason: `${name} is locked — unlock it first` });
			return;
		}
		const dest = this.approachPoint(target, job.within);
		if (this.reachedGoTo(target, dest, job.within)) {
			this.finish({ ok: true, verb: 'go_to' });
			return;
		}
		const next = this.followPath(dest, dt);
		if (!next) {
			this.finish({
				ok: false,
				verb: 'go_to',
				reason: `cannot reach ${job.name} — path blocked (locked door, water, or walls)`,
			});
			return;
		}
		this.steer(null, next);
	}

	private begin(job:Job):Promise<NPCVerbResult> {
		const hop = this.gameObject.getComponent(Celebrating);
		const now = this.gameObject.world?.time ?? 0;
		if (!hop?.enabled || now >= hop.until) {
			hop?.stop();
		}
		if (this.job) {
			this.finish({ ok: false, interrupted: true, verb: this.job.kind, reason: 'replaced' });
		}
		return new Promise((resolve) => {
			this.job = { ...job, done: resolve };
			this.stuckFor = 0;
			this.detour = null;
			this.doorPass = 0;
			this.lastX = this.gameObject.transform.position.x;
			this.lastZ = this.gameObject.transform.position.z;
			if (job.kind === 'go_to' || job.kind === 'follow') {
				const target = this.findNamed(job.name);
				if (!target) {
					this.finish({ ok: false, verb: job.kind, reason: `no such place ${job.name}` });
					return;
				}
				if (job.kind === 'go_to') {
					const blocked = this.lockedDoorOnPath(target);
					if (blocked) {
						const name = blocked.getComponent(Named)?.id ?? blocked.id;
						this.finish({
							ok: false,
							verb: 'go_to',
							reason: `${name} is locked — unlock it first`,
						});
						return;
					}
					const dest = this.approachPoint(target, job.within);
					if (this.reachedGoTo(target, dest, job.within)) {
						this.finish({ ok: true, verb: 'go_to' });
						return;
					}
					const next = this.followPath(dest, 0);
					if (!next) {
						this.finish({
							ok: false,
							verb: 'go_to',
							reason: `cannot reach ${job.name} — path blocked (locked door, water, or walls)`,
						});
						return;
					}
					this.steer(null, next);
					return;
				}
				const dest = this.approachPoint(target);
				this.steer(null, this.followPath(dest, 0) ?? dest);
			}
			else if (job.kind === 'wander') {
				if (this.wanderUntilReached()) {
					this.finish({ ok: true, verb: 'wander', reason: 'until' });
					return;
				}
				this.wanderDest = job.guide?.dest?.() ?? this.randomWalkPoint();
				if (this.wanderDest) {
					this.steer(null, this.followPath(this.wanderDest, 0) ?? this.wanderDest);
				}
			}
			else {
				this.steer(null, null);
			}
		});
	}

	private finish(result:NPCVerbResult):void {
		const job = this.job;
		this.job = null;
		this.stuckFor = 0;
		this.detour = null;
		this.doorPass = 0;
		this.clearRoute();
		this.wanderDest = null;
		this.steer(null, null);
		job?.done(result);
	}

	private clearRoute():void {
		this.route = [];
		this.routeAt = 0;
		this.routeGoal = null;
	}

	private steer(name:string | null, point:{ x:number; z:number } | null):void {
		this.destinationName = name;
		this.destinationPoint = point;
	}

	private arrivedAt(point:{ x:number; z:number }, eps:number):boolean {
		const p = this.gameObject.transform.position;
		return Math.hypot(point.x - p.x, point.z - p.z) <= eps;
	}

	private followPath(dest:{ x:number; z:number }, dt:number):{ x:number; z:number } | null {
		const world = this.gameObject.world;
		if (!world) {
			return dest;
		}
		if (this.arrivedAt(dest, 0.45)) {
			this.clearRoute();
			return dest;
		}
		const p = this.gameObject.transform.position;
		const destMoved = !this.routeGoal
			|| Math.hypot(dest.x - this.routeGoal.x, dest.z - this.routeGoal.z) > 0.55;
		if (this.stuckFor >= 0.4) {
			this.clearRoute();
		}
		if (destMoved || this.route.length === 0) {
			const path = findPath(world, p.x, p.z, dest.x, dest.z, this.pathIgnore());
			if (!path) {
				this.clearRoute();
				return null;
			}
			this.route = path.length > 0 ? path.concat([dest]) : [dest];
			this.routeAt = 0;
			this.routeGoal = dest;
		}
		while (this.routeAt < this.route.length && this.arrivedAt(this.route[this.routeAt], 0.4)) {
			this.routeAt += 1;
		}
		const step = this.route[this.routeAt] ?? dest;
		return this.avoidStuck(step, dt);
	}

	private avoidStuck(dest:{ x:number; z:number }, dt:number):{ x:number; z:number } {
		const p = this.gameObject.transform.position;
		const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
		this.lastX = p.x;
		this.lastZ = p.z;
		if (moved < 0.04) {
			this.stuckFor += dt;
		}
		else {
			this.stuckFor = 0;
			this.detour = null;
		}
		if (this.nearDoorPassage()) {
			this.detour = null;
			this.stuckFor = 0;
			return dest;
		}
		if (this.stuckFor < 0.45) {
			return this.detour ?? dest;
		}
		const next = this.detourPoint(dest);
		if (next) {
			this.detour = next;
			this.stuckFor = 0;
			return next;
		}
		return dest;
	}

	private detourPoint(dest:{ x:number; z:number }):{ x:number; z:number } | null {
		const world = this.gameObject.world;
		if (!world) {
			return null;
		}
		const p = this.gameObject.transform.position;
		const here = Math.hypot(dest.x - p.x, dest.z - p.z);
		let best:{ x:number; z:number } | null = null;
		let bestScore = here;
		for (let i = 0; i < 8; i++) {
			const a = i * Math.PI / 4;
			const nx = p.x + Math.cos(a) * 1.35;
			const nz = p.z + Math.sin(a) * 1.35;
			if (!cellWalkable(world, nx, nz, this.pathIgnore())) {
				continue;
			}
			const score = Math.hypot(dest.x - nx, dest.z - nz);
			if (score + 0.2 < bestScore) {
				bestScore = score;
				best = { x: nx, z: nz };
			}
		}
		return best;
	}

	private reachedGoTo(target:GameObject, dest:{ x:number; z:number }, within = APPROACH):boolean {
		if (distXZ(this.gameObject, target) <= within) {
			return true;
		}
		const p = this.gameObject.transform.position;
		const room = target.getComponent(Interior);
		if (room && interiorContains(room, p.x, p.z)) {
			return true;
		}
		const door = target.getComponent(Door);
		if (door?.open) {
			const building = buildingOfDoor(target);
			const box = building?.getComponent(Interior);
			if (box && interiorContains(box, p.x, p.z) && distXZ(this.gameObject, target) <= USE_RANGE) {
				return true;
			}
		}
		return this.arrivedAt(dest, 0.45);
	}

	private pathIgnore():string[] {
		const ids = [this.gameObject.id];
		const named = this.gameObject.getComponent(Named)?.id;
		if (named) {
			ids.push(named);
		}
		const job = this.job;
		if (job && (job.kind === 'go_to' || job.kind === 'follow')) {
			ids.push(job.name);
			const target = this.findNamed(job.name);
			if (target) {
				ids.push(target.id);
				const targetName = target.getComponent(Named)?.id;
				if (targetName) {
					ids.push(targetName);
				}
			}
		}
		const bond = this.gameObject.getComponent(Companion);
		if (bond && !bond.hold) {
			ids.push(bond.targetID);
		}
		return ids;
	}

	private approachPoint(target:GameObject, range = APPROACH):{ x:number; z:number } {
		if (target.getComponent(Door)) {
			return this.doorApproach(target);
		}
		const room = target.getComponent(Interior);
		if (room) {
			return {
				x: (room.minX + room.maxX) * 0.5,
				z: (room.minZ + room.maxZ) * 0.5,
			};
		}
		const via = this.doorOnPath(target);
		if (via && via !== target && !via.getComponent(Door)?.open) {
			return this.doorApproach(via);
		}
		const p = this.gameObject.transform.position;
		const t = target.transform.position;
		const dx = p.x - t.x;
		const dz = p.z - t.z;
		const dist = Math.hypot(dx, dz);
		if (dist < 0.05) {
			return { x: t.x - range, z: t.z };
		}
		const scale = range / dist;
		return { x: t.x + dx * scale, z: t.z + dz * scale };
	}

	private doorApproach(target:GameObject):{ x:number; z:number } {
		const p = this.gameObject.transform.position;
		const t = target.transform.position;
		const door = target.getComponent(Door);
		const along = (door?.axis ?? 'x') === 'x' ? { x: 1, z: 0 } : { x: 0, z: 1 };
		const inward = doorInteriorAlong(target);
		const side = (p.x - t.x) * along.x + (p.z - t.z) * along.z;
		const lateral = (door?.axis ?? 'x') === 'x' ? p.z - t.z : p.x - t.x;
		if (this.doorPass === 0) {
			this.doorPass = side >= 0 ? 1 : -1;
		}
		const stay = this.doorPass;
		if (door?.open) {
			const building = buildingOfDoor(target);
			const box = building?.getComponent(Interior);
			const inside = !!box && interiorContains(box, p.x, p.z);
			if (inside && inward !== 0) {
				return {
					x: t.x + along.x * inward * 1.2,
					z: t.z + along.z * inward * 1.2,
				};
			}
			const outside = inward !== 0 ? -inward : stay;
			if (Math.abs(lateral) > 0.18) {
				return {
					x: t.x + along.x * outside * 1.2,
					z: t.z + along.z * outside * 1.2,
				};
			}
			const dir = inward !== 0 ? inward : stay * -1;
			return {
				x: t.x + along.x * dir * 1.7,
				z: t.z + along.z * dir * 1.7,
			};
		}
		return {
			x: t.x + along.x * stay * Math.max(APPROACH, 1.15),
			z: t.z + along.z * stay * Math.max(APPROACH, 1.15),
		};
	}

	private nearDoorPassage():boolean {
		const world = this.gameObject.world;
		if (!world) {
			return false;
		}
		const p = this.gameObject.transform.position;
		let close = false;
		world.forEachComponent(Door, (_door, go) => {
			if (distXZ(this.gameObject, go) < 2.4) {
				close = true;
			}
		});
		return close;
	}

	private doorOnPath(target:GameObject):GameObject | null {
		const world = this.gameObject.world;
		if (!world) {
			return null;
		}
		const p = this.gameObject.transform.position;
		const t = target.transform.position;
		let best:GameObject | null = null;
		let bestAbs = Infinity;
		world.forEachComponent(Door, (_door, go) => {
			if (go === target) {
				return;
			}
			const d = go.transform.position;
			const axis = go.getComponent(Door)?.axis ?? 'x';
			if (!segmentCrossesDoor(p.x, p.z, t.x, t.z, d.x, d.z, axis)) {
				return;
			}
			const abs = axis === 'x' ? Math.abs(p.x - d.x) : Math.abs(p.z - d.z);
			if (abs < bestAbs) {
				best = go;
				bestAbs = abs;
			}
		});
		return best;
	}

	private lockedDoorOnPath(target:GameObject):GameObject | null {
		if (target.getComponent(Door)) {
			return null;
		}
		const via = this.doorOnPath(target);
		if (!via) {
			return null;
		}
		const lock = via.getComponent(Lock);
		const door = via.getComponent(Door);
		if (lock?.locked || (door && !door.open)) {
			return via;
		}
		return null;
	}

	private wanderUntilReached():boolean {
		return this.job?.kind === 'wander' && !!this.job.guide?.stop?.();
	}

	private noteWander(job:Extract<Job, { kind:'wander' }>):void {
		const now = this.now();
		if (now - job.notedAt < 0.25) {
			return;
		}
		job.notedAt = now;
		job.guide?.note?.();
	}

	private randomWalkPoint():{ x:number; z:number } | null {
		const world = this.gameObject.world;
		if (!world) {
			return null;
		}
		const p = this.gameObject.transform.position;
		const chunk = world.chunkAtWorld(p.x, p.z);
		if (!chunk) {
			return { x: p.x, z: p.z };
		}
		for (let i = 0; i < 16; i++) {
			const lx = 1 + Math.floor(Math.random() * 14);
			const lz = 1 + Math.floor(Math.random() * 14);
			const center = chunk.worldCellCenter(lx, lz);
			if (cellWalkable(world, center.x, center.z)) {
				return center;
			}
		}
		return { x: p.x, z: p.z };
	}

	private steerCompanion(dt:number):void {
		const bond = this.gameObject.getComponent(Companion);
		if (!bond || bond.hold) {
			this.stuckFor = 0;
			this.detour = null;
			this.steer(null, null);
			return;
		}
		const target = this.findCompanionTarget(bond.targetID);
		if (!target) {
			this.stuckFor = 0;
			this.detour = null;
			this.steer(null, null);
			return;
		}
		const dest = this.approachPoint(target);
		if (this.arrivedAt(dest, 0.5)) {
			this.stuckFor = 0;
			this.detour = null;
			this.clearRoute();
			this.steer(null, null);
			this.faceToward(bond.targetID);
			return;
		}
		const next = this.followPath(dest, dt);
		this.steer(null, next ?? dest);
	}

	private findCompanionTarget(name:string):GameObject | undefined {
		const world = this.gameObject.world;
		if (!world) {
			return undefined;
		}
		return world.findByID(name) ?? resolveNamedTarget(world, name);
	}

	private findNamed(name:string):GameObject | undefined {
		const world = this.gameObject.world;
		if (!world) {
			return undefined;
		}
		const go = resolveNamedTarget(world, name);
		if (!go) {
			return undefined;
		}
		if (world.npcCanSee(go)) {
			return go;
		}
		const bond = this.gameObject.getComponent(Companion);
		if (bond && (go.id === bond.targetID || go.getComponent(Named)?.id === bond.targetID)) {
			return go;
		}
		return undefined;
	}

	private now():number {
		return this.gameObject.world?.time ?? 0;
	}
}
