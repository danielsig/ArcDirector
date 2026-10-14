import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BoxCollider } from './BoxCollider.js';
import { GameObject, resetAllocID } from './GameObject.js';
import { Rigidbody } from './Rigidbody.js';
import { World, type TerrainSample } from './World.js';
import { canOccupy, resolveBody, stepPhysics } from './physics.js';

describe('stepPhysics', () => {
	it('integrates velocity on XZ', () => {
		resetAllocID();
		const world = new World();
		const go = new GameObject('body');
		const rb = go.addComponent(Rigidbody);
		rb.velocity.x = 2;
		rb.velocity.z = -1;
		world.add(go);
		stepPhysics(world, 0.5);
		assert.equal(go.transform.position.x, 1);
		assert.equal(go.transform.position.z, -0.5);
		assert.equal(rb.prevX, 0);
		assert.equal(rb.prevZ, 0);
	});

	it('slides a body out of a cylinder along the line from its axis', () => {
		resetAllocID();
		const world = new World();
		const post = new GameObject('post');
		const pc = post.addComponent(BoxCollider);
		pc.size = { x: 1, y: 1, z: 1 };
		pc.shape = 'cylinder';
		const body = new GameObject('body');
		body.transform.position.x = 0.35;
		body.transform.position.z = 0.35;
		body.addComponent(Rigidbody);
		body.addComponent(BoxCollider).size = { x: 0.2, y: 1, z: 0.2 };
		world.add(post);
		world.add(body);
		stepPhysics(world, 0);
		const p = body.transform.position;
		// Nearest box corner sits on the circle, and the push is diagonal (no axis snap like a box).
		assert.ok(Math.abs(Math.hypot(p.x - 0.1, p.z - 0.1) - 0.5) < 1e-6);
		assert.ok(Math.abs(p.x - p.z) < 1e-9);
	});

	it('separates overlapping solid colliders', () => {
		resetAllocID();
		const world = new World();
		const a = new GameObject('a');
		a.addComponent(Rigidbody);
		const ac = a.addComponent(BoxCollider);
		ac.size = { x: 1, y: 1, z: 1 };
		const b = new GameObject('b');
		b.transform.position.x = 0.4;
		b.addComponent(Rigidbody);
		const bc = b.addComponent(BoxCollider);
		bc.size = { x: 1, y: 1, z: 1 };
		world.add(a);
		world.add(b);
		stepPhysics(world, 0);
		const gap = Math.abs(a.transform.position.x - b.transform.position.x);
		assert.ok(gap >= 0.999, `gap ${gap}`);
	});

	function padded(id:string, x:number, vx = 0):{ go:GameObject; rb:Rigidbody } {
		const go = new GameObject(id);
		go.transform.position.x = x;
		const rb = go.addComponent(Rigidbody);
		rb.velocity.x = vx;
		const col = go.addComponent(BoxCollider);
		col.size = { x: 0.45, y: 1.1, z: 0.45 };
		col.pad = 0.36;
		return { go, rb };
	}

	it('shoves the other body in the walker’s direction and does not bounce the walker', () => {
		resetAllocID();
		const world = new World();
		const walker = padded('walker', 0, 4.2);
		const idle = padded('idle', 0.5);
		world.add(walker.go);
		world.add(idle.go);
		const dt = 0.1;
		stepPhysics(world, dt);
		assert.ok(Math.abs(walker.go.transform.position.x - 4.2 * dt) < 1e-9);
		assert.ok(idle.go.transform.position.x > 0.5);
		assert.ok(
			Math.abs(idle.go.transform.position.x - walker.go.transform.position.x) >= 0.45 - 1e-6,
			`stacked ${idle.go.transform.position.x} ${walker.go.transform.position.x}`,
		);
	});

	it('lets a walker push the earlier-spawned body (player)', () => {
		resetAllocID();
		const world = new World();
		const player = padded('Player', 0.5);
		const npc = padded('NPC', 0, 4.2);
		world.add(player.go);
		world.add(npc.go);
		stepPhysics(world, 0.1);
		assert.ok(player.go.transform.position.x > 0.5);
		assert.ok(Math.abs(npc.go.transform.position.x - 0.42) < 1e-9);
	});

	it('does not shove when the walker is moving away', () => {
		resetAllocID();
		const world = new World();
		const walker = padded('walker', 0.5, 4.2);
		const idle = padded('idle', 0);
		world.add(walker.go);
		world.add(idle.go);
		stepPhysics(world, 0.1);
		assert.equal(idle.go.transform.position.x, 0);
	});

	class WallWorld extends World {
		public override sampleTerrain(x:number, z:number):TerrainSample | undefined {
			return { height: 0, worldY: 0, blocked: x >= 2, climbable: false };
		}
	}

	it('resolveBody does not push a body through a blocked tile', () => {
		resetAllocID();
		const world = new WallWorld();
		world.tileSize = 1;
		const go = new GameObject('hurt');
		go.transform.position.x = 1.4;
		const rb = go.addComponent(Rigidbody);
		rb.prevX = 1.4;
		rb.prevZ = 0;
		const col = go.addComponent(BoxCollider);
		col.size = { x: 0.45, y: 1.1, z: 0.45 };
		world.add(go);
		go.transform.position.x = 2.2;
		resolveBody(world, go);
		assert.ok(go.transform.position.x + col.size.x * 0.5 <= 2 + 1e-6, `through wall at ${go.transform.position.x}`);
	});

	class CellWorld extends World {
		public override sampleTerrain(x:number, z:number):TerrainSample | undefined {
			return { height: 0, worldY: 0, blocked: x >= 2 && x < 3, climbable: false };
		}
	}

	it('resolveBody does not eject a body through a blocked cell', () => {
		resetAllocID();
		const world = new CellWorld();
		world.tileSize = 1;
		const go = new GameObject('hurt');
		go.transform.position.x = 1.4;
		const rb = go.addComponent(Rigidbody);
		rb.prevX = 1.4;
		rb.prevZ = 0;
		const col = go.addComponent(BoxCollider);
		col.size = { x: 0.45, y: 1.1, z: 0.45 };
		world.add(go);
		go.transform.position.x = 2.6;
		resolveBody(world, go);
		assert.ok(go.transform.position.x + col.size.x * 0.5 <= 2 + 1e-6, `through cell at ${go.transform.position.x}`);
	});

	it('resolveBody does not push a body through a solid collider', () => {
		resetAllocID();
		const world = new World();
		const wall = new GameObject('wall');
		wall.transform.position.x = 2;
		const wallCol = wall.addComponent(BoxCollider);
		wallCol.size = { x: 1, y: 2, z: 1 };
		world.add(wall);
		const go = new GameObject('hurt');
		go.transform.position.x = 1.1;
		go.addComponent(Rigidbody);
		const col = go.addComponent(BoxCollider);
		col.size = { x: 0.45, y: 1.1, z: 0.45 };
		world.add(go);
		world.reindex();
		go.transform.position.x = 1.6;
		resolveBody(world, go);
		const gap = wall.transform.position.x - go.transform.position.x;
		assert.ok(gap >= (1 + 0.45) * 0.5 - 1e-6, `inside wall gap ${gap}`);
	});

	it('canOccupy climbs one stair and refuses a raised floor', () => {
		const ground = { height: 0, worldY: 0, blocked: false, climbable: false };
		const stair = { height: 1, worldY: 0.7, blocked: false, climbable: true };
		const dais = { height: 1, worldY: 0.7, blocked: false, climbable: false };
		const wall = { height: 1, worldY: 0.7, blocked: true, climbable: false };
		assert.equal(canOccupy(ground, stair), true);
		assert.equal(canOccupy(stair, dais), true);
		assert.equal(canOccupy(ground, dais), false);
		assert.equal(canOccupy(ground, wall), false);
		assert.equal(canOccupy(dais, ground), true);
	});

	it('finds a wide collider whose centre is tiles away', () => {
		resetAllocID();
		const world = new World();
		const bridge = new GameObject('bridge');
		bridge.addComponent(BoxCollider).size = { x: 8, y: 1, z: 1 };
		const go = new GameObject('walker');
		go.transform.position.x = 3.9;
		go.addComponent(Rigidbody);
		go.addComponent(BoxCollider).size = { x: 0.45, y: 1, z: 0.45 };
		world.add(bridge);
		world.add(go);
		stepPhysics(world, 0.02);
		assert.ok(go.transform.position.x - 0.45 * 0.5 >= 4 - 1e-6, `inside bridge at ${go.transform.position.x}`);
	});
});

describe('World.solidCover', () => {
	it('measures how much of a tile lies under colliders that never move', () => {
		resetAllocID();
		const world = new World();
		world.tileSize = 1;
		// A log 2.5 m long, 0.5 m deep, lying east–west across three tiles.
		const log = new GameObject('log');
		log.transform.position.x = 1.5;
		log.transform.position.z = 0.5;
		log.addComponent(BoxCollider).size = { x: 2.5, y: 1, z: 0.5 };
		const body = new GameObject('body');
		body.transform.position.x = 4.5;
		body.transform.position.z = 0.5;
		body.addComponent(Rigidbody);
		body.addComponent(BoxCollider).size = { x: 1, y: 1, z: 1 };
		world.add(log);
		world.add(body);
		world.reindex();
		assert.equal(world.solidCover(1, 0), 0.5);
		assert.equal(world.solidCover(0, 0), 0.375);
		assert.equal(world.solidCover(1, 1), 0);
		assert.equal(world.solidCover(4, 0), 0, 'a body is not cover');
	});
});
