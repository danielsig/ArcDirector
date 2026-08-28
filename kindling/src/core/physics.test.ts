import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BoxCollider } from './BoxCollider.js';
import { GameObject, resetAllocID } from './GameObject.js';
import { Rigidbody } from './Rigidbody.js';
import { World } from './World.js';
import { stepPhysics } from './physics.js';

describe('stepPhysics', () => {
	it('integrates velocity on XZ', () => {
		resetAllocID();
		const world = new World();
		const go = new GameObject('body');
		const rb = go.addComponent(new Rigidbody());
		rb.velocity.x = 2;
		rb.velocity.z = -1;
		world.add(go);
		stepPhysics(world, 0.5);
		assert.equal(go.transform.position.x, 1);
		assert.equal(go.transform.position.z, -0.5);
		assert.equal(rb.prevX, 0);
		assert.equal(rb.prevZ, 0);
	});

	it('separates overlapping solid colliders', () => {
		resetAllocID();
		const world = new World();
		const a = new GameObject('a');
		a.addComponent(new Rigidbody());
		const ac = a.addComponent(new BoxCollider());
		ac.size = { x: 1, y: 1, z: 1 };
		const b = new GameObject('b');
		b.transform.position.x = 0.4;
		b.addComponent(new Rigidbody());
		const bc = b.addComponent(new BoxCollider());
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
		const rb = go.addComponent(new Rigidbody());
		rb.velocity.x = vx;
		const col = go.addComponent(new BoxCollider());
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
		const npc = padded('Npc', 0, 4.2);
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
});
