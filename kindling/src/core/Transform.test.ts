import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GameObject } from './GameObject.js';
import { Transform } from './Transform.js';

function close(a:number, b:number, eps = 1e-5):void {
	assert.ok(Math.abs(a - b) < eps, `${a} !~= ${b}`);
}

describe('Transform', () => {
	it('keeps Transform on the GameObject and refuses a second one', () => {
		const go = new GameObject('xf');
		assert.ok(go.getComponent(Transform));
		assert.throws(() => go.addComponent(new Transform()));
	});

	it('writes world position on a child as local offset', () => {
		const parent = new GameObject('parent');
		const child = new GameObject('child');
		parent.transform.position.x = 10;
		parent.transform.position.y = 2;
		parent.transform.position.z = -4;
		child.setParent(parent);
		child.transform.position.x = 12;
		child.transform.position.y = 2;
		child.transform.position.z = -4;
		close(child.transform.position.x, 12);
		close(child.transform.position.y, 2);
		close(child.transform.position.z, -4);
		close(child.transform.localPosition.x, 2);
		close(child.transform.localPosition.y, 0);
		close(child.transform.localPosition.z, 0);
	});

	it('setting yaw does not zero pitch', () => {
		const go = new GameObject('cam');
		go.transform.pitch = 0.5;
		go.transform.yaw = 1.2;
		close(go.transform.pitch, 0.5);
		close(go.transform.yaw, 1.2);
		go.transform.yaw = -0.4;
		close(go.transform.pitch, 0.5);
		close(go.transform.yaw, -0.4);
	});

	it('yaw 0 faces -Z', () => {
		const go = new GameObject('fwd');
		const f = go.transform.forward;
		close(f.x, 0);
		close(f.y, 0);
		close(f.z, -1);
	});
});
