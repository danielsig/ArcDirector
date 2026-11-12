import { GameObject } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameHost } from '../director/adapter';
import { DemoWorld } from './demo-world';
import { DirectorPulse } from './systems';

test('the director gets each frame of game time while the AI is on, and none while it is off', () => {
	const world = new DemoWorld();
	const dts:number[] = [];
	const director = { observe: () => undefined, pulse: (dt:number) => dts.push(dt) } as unknown as GameHost;
	const systems = new GameObject('Systems', 'Systems');
	const pulse = systems.addComponent(DirectorPulse, { director });
	world.add(systems);
	pulse.update(0.5);
	world.arcDirectorOn = false;
	pulse.update(30);
	world.arcDirectorOn = true;
	pulse.update(0.5);
	assert.deepEqual(dts, [0.5, 0.5], 'no gap for the 30 s it was off');
});
