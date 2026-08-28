import { BoxCollider } from './BoxCollider.js';
import { Rigidbody } from './Rigidbody.js';
import type { GameObject } from './GameObject.js';
import type { TerrainSample, World } from './World.js';

/** Padded characters: pad-only overlap shoves at this fraction of the walker’s speed. */
export const CROWD_YIELD = 0.1;
const CROWD_MIN_SPEED = 0.05;

type AABB = {
	minX:number;
	maxX:number;
	minZ:number;
	maxZ:number;
};

type Mtv = {
	axis:'x' | 'z';
	dir:number;
	depth:number;
};

function actorAABB(go:GameObject, col:BoxCollider, pad = 0):AABB {
	const p = go.transform.position;
	const hx = col.size.x * 0.5 + pad;
	const hz = col.size.z * 0.5 + pad;
	return {
		minX: p.x - hx,
		maxX: p.x + hx,
		minZ: p.z - hz,
		maxZ: p.z + hz,
	};
}

function overlaps(a:AABB, b:AABB):boolean {
	return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

function mtvOf(a:AABB, b:AABB, idA:string, idB:string):Mtv {
	const overlapX = Math.min(a.maxX - b.minX, b.maxX - a.minX);
	const overlapZ = Math.min(a.maxZ - b.minZ, b.maxZ - a.minZ);
	const ax = (a.minX + a.maxX) * 0.5;
	const az = (a.minZ + a.maxZ) * 0.5;
	const bx = (b.minX + b.maxX) * 0.5;
	const bz = (b.minZ + b.maxZ) * 0.5;
	const sameSpot = Math.abs(ax - bx) < 1e-3 && Math.abs(az - bz) < 1e-3;
	const preferX = sameSpot ? idA < idB : overlapX < overlapZ;
	if (preferX) {
		const dir = sameSpot ? (idA < idB ? -1 : 1) : (ax < bx ? -1 : 1);
		return { axis: 'x', dir, depth: overlapX };
	}
	const dir = sameSpot ? (idA < idB ? -1 : 1) : (az < bz ? -1 : 1);
	return { axis: 'z', dir, depth: overlapZ };
}

function shift(pos:{ x:number; z:number }, axis:'x' | 'z', delta:number):void {
	if (axis === 'x') {
		pos.x += delta;
	}
	else {
		pos.z += delta;
	}
}

function applyMtv(pos:{ x:number; z:number }, hit:Mtv, invert:boolean):void {
	shift(pos, hit.axis, (invert ? -hit.dir : hit.dir) * hit.depth);
}

function separateAxis(
	pos:{ x:number; z:number },
	half:number,
	tileMin:number,
	tileMax:number,
	axis:'x' | 'z',
):void {
	const min = (axis === 'x' ? pos.x : pos.z) - half;
	const max = (axis === 'x' ? pos.x : pos.z) + half;
	if (max <= tileMin || min >= tileMax) {
		return;
	}
	const pushNeg = max - tileMin;
	const pushPos = tileMax - min;
	const delta = pushNeg < pushPos ? -pushNeg : pushPos;
	if (axis === 'x') {
		pos.x += delta;
	}
	else {
		pos.z += delta;
	}
}

function resolveAgainstTiles(go:GameObject, col:BoxCollider, world:World):void {
	const size = world.tileSize;
	if (size <= 0) {
		return;
	}
	const pos = go.transform.position;
	const hx = col.size.x * 0.5;
	const hz = col.size.z * 0.5;

	for (let pass = 0; pass < 2; pass++) {
		const axis:'x' | 'z' = pass === 0 ? 'x' : 'z';
		const aabb = actorAABB(go, col);
		const minTX = Math.floor(aabb.minX / size);
		const maxTX = Math.floor((aabb.maxX - 1e-6) / size);
		const minTZ = Math.floor(aabb.minZ / size);
		const maxTZ = Math.floor((aabb.maxZ - 1e-6) / size);

		for (let tz = minTZ; tz <= maxTZ; tz++) {
			for (let tx = minTX; tx <= maxTX; tx++) {
				const cx = (tx + 0.5) * size;
				const cz = (tz + 0.5) * size;
				const hit = world.sampleTerrain(cx, cz);
				if (!hit?.blocked) {
					continue;
				}
				const tileMinX = tx * size;
				const tileMinZ = tz * size;
				if (axis === 'x') {
					separateAxis(pos, hx, tileMinX, tileMinX + size, 'x');
				}
				else {
					separateAxis(pos, hz, tileMinZ, tileMinZ + size, 'z');
				}
			}
		}
	}
}

function shoveAlong(
	pos:{ x:number; z:number },
	vx:number,
	vz:number,
	speed:number,
	dt:number,
):void {
	if (dt <= 0 || speed < CROWD_MIN_SPEED) {
		return;
	}
	const step = speed * CROWD_YIELD * dt;
	pos.x += (vx / speed) * step;
	pos.z += (vz / speed) * step;
}

function settleMover(world:World, go:GameObject, col:BoxCollider, rb:Rigidbody):void {
	resolveAgainstTiles(go, col, world);
	blockCliffs(go, rb, world);
}

function resolveCrowdPair(
	world:World,
	a:{ go:GameObject; col:BoxCollider; rb:Rigidbody },
	b:{ go:GameObject; col:BoxCollider; rb:Rigidbody },
	dt:number,
):void {
	const pad = a.col.pad > 0 && b.col.pad > 0 ? Math.max(a.col.pad, b.col.pad) : 0;
	if (pad <= 0) {
		return;
	}
	const aSense = actorAABB(a.go, a.col);
	const bSense = actorAABB(b.go, b.col, pad);
	const aSenseB = actorAABB(a.go, a.col, pad);
	const bSenseA = actorAABB(b.go, b.col);
	if (!overlaps(aSense, bSense) && !overlaps(aSenseB, bSenseA)) {
		return;
	}
	const aPos = a.go.transform.position;
	const bPos = b.go.transform.position;
	const dx = bPos.x - aPos.x;
	const dz = bPos.z - aPos.z;
	const aSpeed = Math.hypot(a.rb.velocity.x, a.rb.velocity.z);
	const bSpeed = Math.hypot(b.rb.velocity.x, b.rb.velocity.z);
	const aToward = aSpeed >= CROWD_MIN_SPEED && dx * a.rb.velocity.x + dz * a.rb.velocity.z > 0;
	const bToward = bSpeed >= CROWD_MIN_SPEED && -dx * b.rb.velocity.x - dz * b.rb.velocity.z > 0;
	if (aToward) {
		shoveAlong(bPos, a.rb.velocity.x, a.rb.velocity.z, aSpeed, dt);
	}
	if (bToward) {
		shoveAlong(aPos, b.rb.velocity.x, b.rb.velocity.z, bSpeed, dt);
	}
	const aBody = actorAABB(a.go, a.col);
	const bBody = actorAABB(b.go, b.col);
	if (overlaps(aBody, bBody)) {
		const hit = mtvOf(aBody, bBody, a.go.id, b.go.id);
		if (aToward && !bToward) {
			applyMtv(bPos, hit, true);
		}
		else if (bToward && !aToward) {
			applyMtv(aPos, hit, false);
		}
		else {
			const half = { ...hit, depth: hit.depth * 0.5 };
			applyMtv(aPos, half, false);
			applyMtv(bPos, half, true);
		}
	}
	if (aToward) {
		settleMover(world, b.go, b.col, b.rb);
	}
	if (bToward) {
		settleMover(world, a.go, a.col, a.rb);
	}
	if (!aToward && !bToward && overlaps(actorAABB(a.go, a.col), actorAABB(b.go, b.col))) {
		settleMover(world, a.go, a.col, a.rb);
		settleMover(world, b.go, b.col, b.rb);
	}
}

function resolveCrowd(world:World, dt:number):void {
	const bodies:{ go:GameObject; col:BoxCollider; rb:Rigidbody }[] = [];
	world.forEachComponent(BoxCollider, (col, go) => {
		if (!col.enabled || !col.solid || col.isTrigger || col.pad <= 0) {
			return;
		}
		const rb = go.getComponent(Rigidbody);
		if (!rb?.enabled) {
			return;
		}
		bodies.push({ go, col, rb });
	});
	for (let i = 0; i < bodies.length; i++) {
		for (let j = i + 1; j < bodies.length; j++) {
			resolveCrowdPair(world, bodies[i], bodies[j], dt);
		}
	}
}

function resolveAgainstOthers(world:World, go:GameObject, col:BoxCollider):void {
	const pos = go.transform.position;
	const a = actorAABB(go, col);
	world.forEachComponent(BoxCollider, (otherCol, other) => {
		if (other === go || !otherCol.enabled || !otherCol.solid || otherCol.isTrigger) {
			return;
		}
		if (col.pad > 0 && otherCol.pad > 0 && other.getComponent(Rigidbody)) {
			return;
		}
		const pad = col.pad > 0 && otherCol.pad > 0 ? col.pad : 0;
		const b = actorAABB(other, otherCol, pad);
		if (!overlaps(a, b)) {
			return;
		}
		const hit = mtvOf(a, b, go.id, other.id);
		applyMtv(pos, hit, false);
		a.minX = pos.x - col.size.x * 0.5;
		a.maxX = pos.x + col.size.x * 0.5;
		a.minZ = pos.z - col.size.z * 0.5;
		a.maxZ = pos.z + col.size.z * 0.5;
	});
}

function canOccupy(from:TerrainSample | undefined, to:TerrainSample | undefined):boolean {
	if (!to || to.blocked) {
		return false;
	}
	const ph = from?.height ?? 0;
	const nh = to.height;
	if (nh > ph) {
		return to.climbable && nh - ph <= 1;
	}
	return ph - nh <= 1;
}

function blockCliffs(go:GameObject, rb:Rigidbody, world:World):void {
	if (world.tileSize <= 0) {
		return;
	}
	const pos = go.transform.position;
	const prev = world.sampleTerrain(rb.prevX, rb.prevZ);
	const next = world.sampleTerrain(pos.x, pos.z);
	if (canOccupy(prev, next)) {
		return;
	}
	const alongX = world.sampleTerrain(pos.x, rb.prevZ);
	if (canOccupy(prev, alongX)) {
		pos.z = rb.prevZ;
		return;
	}
	const alongZ = world.sampleTerrain(rb.prevX, pos.z);
	if (canOccupy(prev, alongZ)) {
		pos.x = rb.prevX;
		return;
	}
	pos.x = rb.prevX;
	pos.z = rb.prevZ;
}

function integrate(world:World, dt:number):void {
	world.forEachComponent(Rigidbody, (rb, go) => {
		if (!rb.enabled) {
			return;
		}
		const p = go.transform.position;
		rb.prevX = p.x;
		rb.prevZ = p.z;
		p.x += rb.velocity.x * dt;
		p.z += rb.velocity.z * dt;
	});
}

function resolveCollisions(world:World, dt:number):void {
	world.forEachComponent(BoxCollider, (col, go) => {
		if (!col.enabled || !col.solid || col.isTrigger) {
			return;
		}
		const rb = go.getComponent(Rigidbody);
		if (!rb) {
			return;
		}
		resolveAgainstTiles(go, col, world);
		resolveAgainstOthers(world, go, col);
	});
	resolveCrowd(world, dt);
	world.forEachComponent(BoxCollider, (col, go) => {
		if (!col.enabled || !col.solid || col.isTrigger) {
			return;
		}
		const rb = go.getComponent(Rigidbody);
		if (!rb) {
			return;
		}
		blockCliffs(go, rb, world);
	});
}

function snapGround(world:World, dt:number):void {
	world.forEachComponent(Rigidbody, (rb, go) => {
		if (!rb.enabled || !rb.grounded) {
			return;
		}
		const p = go.transform.position;
		const tile = world.sampleTerrain(p.x, p.z);
		const targetY = tile?.worldY ?? 0;
		const dy = targetY - p.y;
		if (dy > rb.stepHeight + 0.02) {
			return;
		}
		const speed = 10;
		if (Math.abs(dy) <= speed * dt) {
			p.y = targetY;
		}
		else {
			p.y += Math.sign(dy) * speed * dt;
		}
	});
}

/** Integrate rigidbodies, resolve colliders, snap grounded Y. */
export function stepPhysics(world:World, dt:number):void {
	integrate(world, dt);
	resolveCollisions(world, dt);
	snapGround(world, dt);
}
