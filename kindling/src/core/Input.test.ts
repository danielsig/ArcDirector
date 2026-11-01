import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Input, TOUCH_TAP } from './Input.js';

/** The canvas side of the browser: events, and a 200 × 100 box at the corner of the page. */
class FakeCanvas extends EventTarget {
	public readonly style = { touchAction: '' };
	public getBoundingClientRect():{ left:number; top:number; width:number; height:number } {
		return { left: 0, top: 0, width: 200, height: 100 };
	}
}

type Press = { id?:number; x:number; y:number; at?:number; type?:string };

function fire(target:EventTarget, name:string, { id = 1, x, y, at = 0, type = 'touch' }:Press):void {
	const e = new Event(name);
	Object.defineProperties(e, {
		pointerId: { value: id },
		pointerType: { value: type },
		clientX: { value: x },
		clientY: { value: y },
		timeStamp: { value: at },
	});
	target.dispatchEvent(e);
}

describe('Input fingers', () => {
	let canvas:FakeCanvas;
	let input:Input;
	let mouse:EventTarget & { matches:boolean };

	/** A mouse or trackpad coming or going, as `(any-pointer: fine)` tells it. */
	function plugMouse(attached:boolean):void {
		mouse.matches = attached;
		mouse.dispatchEvent(new Event('change'));
	}

	beforeEach(() => {
		mouse = Object.assign(new EventTarget(), { matches: false });
		Object.assign(globalThis, { window: Object.assign(new EventTarget(), { matchMedia: () => mouse }), document: new EventTarget() });
		canvas = new FakeCanvas();
		input = new Input();
		input.attach(canvas as unknown as HTMLCanvasElement);
	});

	afterEach(() => {
		input.detach();
		Reflect.deleteProperty(globalThis, 'window');
		Reflect.deleteProperty(globalThis, 'document');
	});

	it('takes a quick press for a tap, and moves the mouse there', () => {
		fire(canvas, 'pointerdown', { x: 150, y: 25 });
		fire(canvas, 'pointerup', { x: 150, y: 25, at: 100 });
		assert.equal(input.pressed(TOUCH_TAP), true);
		assert.equal(input.mouseNdcX, 0.5);
		assert.equal(input.mouseNdcY, 0.5);
		input.endFrame();
		assert.equal(input.pressed(TOUCH_TAP), false);
	});

	it('takes neither a long press nor a drag for a tap', () => {
		fire(canvas, 'pointerdown', { x: 10, y: 10 });
		fire(canvas, 'pointerup', { x: 10, y: 10, at: 1000 });
		assert.equal(input.pressed(TOUCH_TAP), false);
		fire(canvas, 'pointerdown', { x: 10, y: 10 });
		fire(canvas, 'pointermove', { x: 40, y: 20 });
		fire(canvas, 'pointerup', { x: 40, y: 20, at: 100 });
		assert.equal(input.pressed(TOUCH_TAP), false);
	});

	it('makes a drag the look deltas', () => {
		fire(canvas, 'pointerdown', { x: 10, y: 10 });
		fire(canvas, 'pointermove', { x: 40, y: 5 });
		assert.equal(input.lookDeltaX, 30);
		assert.equal(input.lookDeltaY, -5);
		input.endFrame();
		assert.equal(input.lookDeltaX, 0);
	});

	it('reads two fingers as a pinch, a twist and their middle', () => {
		fire(canvas, 'pointerdown', { id: 1, x: 100, y: 50 });
		fire(canvas, 'pointerdown', { id: 2, x: 110, y: 50 });
		// The second finger swings a quarter turn clockwise on screen around the first, twice as far out.
		fire(canvas, 'pointermove', { id: 2, x: 100, y: 70 });
		assert.ok(Math.abs(input.pinch - 2) < 1e-9);
		assert.ok(Math.abs(input.twist - Math.PI / 2) < 1e-9);
		assert.equal(input.lookDeltaX, -5);
		assert.equal(input.lookDeltaY, 10);
		fire(canvas, 'pointerup', { id: 2, x: 100, y: 70, at: 50 });
		fire(canvas, 'pointerup', { id: 1, x: 100, y: 50, at: 50 });
		assert.equal(input.pressed(TOUCH_TAP), false);
	});

	it('locks only with a mouse or trackpad attached', () => {
		let locks = 0;
		Object.assign(canvas, { requestPointerLock: () => { locks += 1; } });
		assert.equal(input.touch, true);
		input.requestLock();
		assert.equal(locks, 0);
		plugMouse(true);
		assert.equal(input.touch, false);
		input.requestLock();
		assert.equal(locks, 1);
	});

	it('ignores fingers with a mouse or trackpad attached, whatever a press reports itself as', () => {
		let locks = 0;
		Object.assign(canvas, { requestPointerLock: () => { locks += 1; } });
		plugMouse(true);
		fire(canvas, 'pointerdown', { x: 10, y: 10 });
		fire(canvas, 'pointermove', { x: 40, y: 20 });
		fire(canvas, 'pointerup', { x: 40, y: 20, at: 50 });
		fire(canvas, 'pointerdown', { x: 40, y: 20 });
		fire(canvas, 'pointerup', { x: 40, y: 20, at: 50 });
		assert.equal(input.lookDeltaX, 0);
		assert.equal(input.pressed(TOUCH_TAP), false);
		input.requestLock();
		assert.equal(locks, 1);
	});

	it('drops a drag when a mouse is plugged in under it', () => {
		fire(canvas, 'pointerdown', { x: 10, y: 10 });
		plugMouse(true);
		fire(canvas, 'pointermove', { x: 40, y: 20 });
		assert.equal(input.lookDeltaX, 0);
	});

	it('leaves the mouse to the mouse handlers', () => {
		fire(canvas, 'pointerdown', { x: 10, y: 10, type: 'mouse' });
		fire(canvas, 'pointermove', { x: 40, y: 20, type: 'mouse' });
		fire(canvas, 'pointerup', { x: 40, y: 20, at: 50, type: 'mouse' });
		assert.equal(input.lookDeltaX, 0);
		assert.equal(input.pressed(TOUCH_TAP), false);
	});
});
