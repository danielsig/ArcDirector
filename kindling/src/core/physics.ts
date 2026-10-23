import { BoxCollider } from './BoxCollider.js';
import { Rigidbody } from './Rigidbody.js';
import type { GameObject } from './GameObject.js';
import type { TerrainSample, World } from './World.js';

/** Padded characters: pad-only overlap shoves at this fraction of the walker’s speed. */
export const SHOVE_YIELD = 0.1;
const SHOVE_MIN_SPEED = 0.05;

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

type Shover = { go:GameObject; col:BoxCollider; rb:Rigidbody };

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

/**
 * The solid boxes under `a`. A tile that names `solids` (a thin wall, the sides of a stair) is those boxes.
 * Anything else blocked, or ground `stand` cannot step up onto, is the whole tile, so a body stops at a face
 * instead of walking into it.
 */
function tileSolids(world:World, a:AABB, stand?:TerrainSample):AABB[] {
	const size = world.tileSize;
	const boxes:AABB[] = [];
	for (let tz = Math.floor(a.minZ / size); tz <= Math.floor((a.maxZ - 1e-6) / size); tz++) {
		for (let tx = Math.floor(a.minX / size); tx <= Math.floor((a.maxX - 1e-6) / size); tx++) {
			const hit = world.sampleTerrain((tx + 0.5) * size, (tz + 0.5) * size);
			const cell = { minX: tx * size, maxX: (tx + 1) * size, minZ: tz * size, maxZ: (tz + 1) * size };
			// On the flight, or up on its landing, the side strips would block the way on and off.
			const onFlight = !!hit?.climbable && !!stand && (stand.climbable || stand.height >= hit.height);
			if (hit?.solids && !onFlight) {
				boxes.push(...hit.solids);
			}
			else if (!hit?.solids && (hit?.blocked || (hit && stand && !canOccupy(stand, hit)))) {
				boxes.push(cell);
			}
		}
	}
	return boxes;
}

/**
 * Push the body out of each solid tile box it overlaps, back the way it came in: along Z for a box it already
 * overlapped on X before this step, and the other way round. A box it came at corner-first, or with no step
 * to go by, takes the shallower way out. Boxes it came at side-on go first, so the seam between two boxes
 * of one wall never catches it.
 */
function resolveAgainstTiles(go:GameObject, col:BoxCollider, world:World, rb?:Rigidbody):void {
	if (world.tileSize <= 0) {
		return;
	}
	const pos = go.transform.position;
	const hx = col.size.x * 0.5;
	const hz = col.size.z * 0.5;
	const prevX = rb?.enabled ? rb.prevX : pos.x;
	const prevZ = rb?.enabled ? rb.prevZ : pos.z;
	const axisOf = (b:AABB):'x' | 'z' | undefined => {
		const wasX = prevX + hx > b.minX && prevX - hx < b.maxX;
		const wasZ = prevZ + hz > b.minZ && prevZ - hz < b.maxZ;
		return wasX === wasZ ? undefined : wasX ? 'z' : 'x';
	};
	const boxes = tileSolids(world, actorAABB(go, col), groundAt(world, pos.x, pos.z));
	boxes.sort((a, b) => (axisOf(a) ? 0 : 1) - (axisOf(b) ? 0 : 1));
	for (const b of boxes) {
		const a = actorAABB(go, col);
		if (!overlaps(a, b)) {
			continue;
		}
		const pushX = pos.x < (b.minX + b.maxX) * 0.5 ? b.minX - a.maxX : b.maxX - a.minX;
		const pushZ = pos.z < (b.minZ + b.maxZ) * 0.5 ? b.minZ - a.maxZ : b.maxZ - a.minZ;
		const axis = axisOf(b) ?? (Math.abs(pushX) < Math.abs(pushZ) ? 'x' : 'z');
		shift(pos, axis, axis === 'x' ? pushX : pushZ);
	}
}

/** The ground at a point for a body standing there: a tile with `solids` is blocked only inside them. */
function groundAt(world:World, x:number, z:number):TerrainSample | undefined {
	const s = world.sampleTerrain(x, z);
	return s?.solids && !s.solids.some((b) => x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ)
		? { ...s, blocked: false }
		: s;
}

function shoveAlong(
	pos:{ x:number; z:number },
	vx:number,
	vz:number,
	speed:number,
	dt:number,
):void {
	if (dt <= 0 || speed < SHOVE_MIN_SPEED) {
		return;
	}
	const step = speed * SHOVE_YIELD * dt;
	pos.x += (vx / speed) * step;
	pos.z += (vz / speed) * step;
}

function settleMover(world:World, go:GameObject, col:BoxCollider, rb:Rigidbody):void {
	resolveAgainstTiles(go, col, world, rb);
	blockCliffs(go, rb, world);
}

function resolveShovePair(
	world:World,
	a:Shover,
	b:Shover,
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
	const aToward = aSpeed >= SHOVE_MIN_SPEED && dx * a.rb.velocity.x + dz * a.rb.velocity.z > 0;
	const bToward = bSpeed >= SHOVE_MIN_SPEED && -dx * b.rb.velocity.x - dz * b.rb.velocity.z > 0;
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

/** A padded, solid, moving body, which shoves rather than blocks. */
function shoverOf(go:GameObject):Shover | undefined {
	const col = go.getComponent(BoxCollider);
	const rb = go.getComponent(Rigidbody);
	return col?.enabled && col.solid && !col.isTrigger && col.pad > 0 && rb?.enabled ? { go, col, rb } : undefined;
}

function resolveShove(world:World, dt:number):void {
	for (const go of world.objects) {
		const a = shoverOf(go);
		if (!a) {
			continue;
		}
		const near = actorAABB(go, a.col, a.col.pad);
		world.forEachNear(near.minX, near.minZ, near.maxX, near.maxZ, (other) => {
			const b = other.id > go.id ? shoverOf(other) : undefined;
			if (b) {
				resolveShovePair(world, a, b, dt);
			}
		});
	}
}

/** Push box `a` (centered on `pos`) out of an upright cylinder, away from its axis, so bodies slide around it. */
function pushOutOfCylinder(pos:{ x:number; z:number }, a:AABB, center:{ x:number; z:number }, radius:number):void {
	const dx = Math.min(Math.max(center.x, a.minX), a.maxX) - center.x;
	const dz = Math.min(Math.max(center.z, a.minZ), a.maxZ) - center.z;
	const d = Math.hypot(dx, dz);
	if (d >= radius) {
		return;
	}
	if (d > 1e-6) {
		pos.x += (dx / d) * (radius - d);
		pos.z += (dz / d) * (radius - d);
		return;
	}
	// The axis is inside the box: leave along the line from the axis to the box center.
	const ox = pos.x - center.x || 1;
	const oz = pos.z - center.z;
	const len = Math.hypot(ox, oz);
	const reach = radius + Math.max(a.maxX - a.minX, a.maxZ - a.minZ) * 0.5;
	pos.x = center.x + (ox / len) * reach;
	pos.z = center.z + (oz / len) * reach;
}

function resolveAgainstOthers(world:World, go:GameObject, col:BoxCollider):void {
	const pos = go.transform.position;
	const a = actorAABB(go, col);
	const near = actorAABB(go, col, col.pad);
	world.forEachNear(near.minX, near.minZ, near.maxX, near.maxZ, (other) => {
		const otherCol = other.getComponent(BoxCollider);
		if (other === go || !otherCol?.enabled || !otherCol.solid || otherCol.isTrigger) {
			return;
		}
		if (col.pad > 0 && otherCol.pad > 0 && other.getComponent(Rigidbody)) {
			return;
		}
		if (otherCol.shape === 'cylinder') {
			pushOutOfCylinder(pos, a, other.transform.position, otherCol.size.x * 0.5);
		}
		else {
			const pad = col.pad > 0 && otherCol.pad > 0 ? col.pad : 0;
			const b = actorAABB(other, otherCol, pad);
			if (!overlaps(a, b)) {
				return;
			}
			applyMtv(pos, mtvOf(a, b, go.id, other.id), false);
		}
		a.minX = pos.x - col.size.x * 0.5;
		a.maxX = pos.x + col.size.x * 0.5;
		a.minZ = pos.z - col.size.z * 0.5;
		a.maxZ = pos.z + col.size.z * 0.5;
	});
}

export type BlockerOpts = {
	/** Where `body` steps from: ground too high or too low to step to from there is `'terrain'`. */
	from?:{ x:number; z:number };
	/** Only colliders standing taller than this, in meters: what one sees or hears past. */
	above?:number;
};

/**
 * What `body` would run into standing at `x`, `z`, by the tests physics pushes bodies out with: a solid collider
 * that never moves (one with no `Rigidbody`), else `'terrain'` (a blocked tile's solids, or ground it cannot step to
 * `from` where it is), else nothing. So a route planned with it is one bodies can walk. A box stops the body where
 * the two would overlap; bodies slide around a cylinder, so it stops one only over the body's middle. With no
 * `body`, what stands at the point itself.
 */
export function blockerAt(world:World, body:GameObject | null, x:number, z:number, opts:BlockerOpts = {}):GameObject | 'terrain' | undefined {
	const col = body?.getComponent(BoxCollider);
	const hx = (col?.size.x ?? 0) * 0.5;
	const hz = (col?.size.z ?? 0) * 0.5;
	const a:AABB = { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
	let hit:GameObject | undefined;
	world.forEachNear(a.minX, a.minZ, a.maxX, a.maxZ, (go) => {
		const other = go.getComponent(BoxCollider);
		if (hit || go === body || !other?.enabled || !other.solid || other.isTrigger || go.getComponent(Rigidbody) || other.size.y <= (opts.above ?? -Infinity)) {
			return;
		}
		if (other.shape === 'cylinder' ? other.contains(x, z) : overlaps(a, actorAABB(go, other))) {
			hit = go;
		}
	});
	if (hit) {
		return hit;
	}
	const stand = groundAt(world, opts.from?.x ?? x, opts.from?.z ?? z);
	if (world.tileSize > 0 && tileSolids(world, a, stand).some((b) => overlaps(a, b))) {
		return 'terrain';
	}
	return opts.from && !canOccupy(groundAt(world, opts.from.x, opts.from.z), groundAt(world, x, z)) ? 'terrain' : undefined;
}

/** Same rule as walking: up only on climbable steps of 1, down at most 1, never onto blocked. */
export function canOccupy(from:TerrainSample | undefined, to:TerrainSample | undefined):boolean {
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
	const prev = groundAt(world, rb.prevX, rb.prevZ);
	const next = groundAt(world, pos.x, pos.z);
	if (canOccupy(prev, next)) {
		return;
	}
	const alongX = groundAt(world, pos.x, rb.prevZ);
	if (canOccupy(prev, alongX)) {
		pos.z = rb.prevZ;
		return;
	}
	const alongZ = groundAt(world, rb.prevX, pos.z);
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
		p.x += rb.velocity.x * dt * go.timeRate;
		p.z += rb.velocity.z * dt * go.timeRate;
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
		blockCliffs(go, rb, world);
		resolveAgainstTiles(go, col, world, rb);
		resolveAgainstOthers(world, go, col);
	});
	resolveShove(world, dt);
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
		p.y = groundAt(world, p.x, p.z)?.worldY ?? 0;
	});
}

/** Push `go` out of blocked tiles, solid colliders, and illegal cliffs. */
export function resolveBody(world:World, go:GameObject):void {
	const col = go.getComponent(BoxCollider);
	if (!col?.enabled || !col.solid || col.isTrigger) {
		return;
	}
	const rb = go.getComponent(Rigidbody);
	if (rb?.enabled) {
		blockCliffs(go, rb, world);
	}
	resolveAgainstTiles(go, col, world, rb);
	resolveAgainstOthers(world, go, col);
	if (rb?.enabled) {
		blockCliffs(go, rb, world);
	}
}

/** Integrate rigidbodies, resolve colliders, snap grounded Y. */
export function stepPhysics(world:World, dt:number):void {
	integrate(world, dt);
	world.reindex();
	resolveCollisions(world, dt);
	snapGround(world, dt);
	world.reindex();
}
