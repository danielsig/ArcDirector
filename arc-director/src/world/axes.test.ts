import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dummyEntity } from '../expr/natives.js';
import { Bearing, BearingMode } from '../perception/perception-types.js';
import { bearingOf, bearingText, formatSight } from '../perception/sight.js';
import { raySpread } from '../perception/sound-path.js';
import { Axes, checkAxes, groundAxes, rightOf, toLocal } from './axes.js';
import { geometryKernels } from './geometry-kernels.js';
import { inReach, reachOf, reachTo } from './lookup.js';
import type { HostWorld, Pose, Vec } from './world-types.js';

const near = (a:Vec, b:Vec):boolean => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

describe('checkAxes', () => {
	it('passes every preset, filling in right and handedness', () => {
		for (const [name, axes] of Object.entries(Axes)) {
			assert.ok(checkAxes(axes).right, name);
		}
		assert.ok(near(checkAxes(Axes.Unity).right!, [1, 0, 0]));
		assert.ok(near(checkAxes(Axes.Unreal).right!, [0, 1, 0]));
		assert.ok(near(checkAxes(Axes.ThreeJS).right!, [1, 0, 0]));
		assert.equal(checkAxes({ forward: [0, 0, 1], up: [0, 1, 0], right: [1, 0, 0] }).handed, 'left');
	});

	it('normalizes lengths and lets rounding pass', () => {
		assert.deepEqual(checkAxes({ forward: [0, -3], right: [2, 0] }), { forward: [0, -1], right: [1, 0] });
		assert.ok(checkAxes({ forward: [0, 0, -1], up: [0, 1, 0.00001], right: [1, 0.00002, 0] }));
	});

	it('throws on skewed axes, missing handedness, and none at all', () => {
		assert.throws(() => checkAxes({ forward: [0, 0, -1], up: [0, 1, 0], right: [1, 0.2, 0] }), /right angles: right is not forward × up in either order/);
		assert.throws(() => checkAxes({ forward: [0, 1], right: [1, 0.1] }), /right angles/);
		assert.throws(() => checkAxes({ forward: [0, 0, -1], up: [0, 1, 0] }), /right or handed/);
		assert.throws(() => checkAxes(undefined), /Axes\.Unity.*Axes\.Screen/);
	});
});

describe('left and right by the axes', () => {
	const cases:[string, Axes, Vec][] = [
		['Unity', Axes.Unity, [5, 0, 0]],
		['Unreal', Axes.Unreal, [0, 5, 0]],
		['ThreeJS', Axes.ThreeJS, [5, 0, 0]],
		['Screen', Axes.Screen, [5, 0]],
	];
	for (const [name, preset, east] of cases) {
		it(`says what is east of one facing north is to its right in ${name}`, () => {
			const axes = checkAxes(preset);
			const self = { point: axes.forward.map(() => 0), facing: axes.forward };
			assert.equal(bearingOf(self, { point: east }, axes), Bearing.Right);
			assert.equal(bearingOf(self, { point: east.map((v) => -v) }, axes), Bearing.Left);
			assert.equal(bearingText(self, { point: east }, axes), 'to your right');
		});

		it(`tells all eight ways round one facing north in ${name}, as the compass does`, () => {
			const axes = checkAxes(preset);
			const self = { point: axes.forward.map(() => 0), facing: axes.forward };
			const round = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => axes.forward.map((v, k) => v * 5 * Math.cos(i * Math.PI / 4) + east[k] * Math.sin(i * Math.PI / 4)));
			assert.deepEqual(round.map((point) => bearingOf(self, { point }, axes)), [Bearing.Ahead, Bearing.AheadRight, Bearing.Right, Bearing.BehindRight, Bearing.Behind, Bearing.BehindLeft, Bearing.Left, Bearing.AheadLeft]);
			assert.deepEqual(round.map((point) => bearingText(self, { point }, axes, BearingMode.Both)), [
				'in front of you (north)', 'ahead to your right (northeast)', 'to your right (east)', 'behind you to the right (southeast)',
				'behind you (south)', 'behind you to the left (southwest)', 'to your left (west)', 'ahead to your left (northwest)',
			]);
		});
	}

	it('turns right with the one facing: in Unity, facing +X, right is −Z', () => {
		const axes = checkAxes(Axes.Unity);
		assert.ok(near(rightOf([1, 0, 0], axes)!, [0, 0, -1]));
		assert.equal(bearingOf({ point: [0, 0, 0], facing: [1, 0, 0] }, { point: [0, 0, -4] }, axes), Bearing.Right);
	});

	it('reads a pose\'s own up over the world\'s', () => {
		const axes = checkAxes(Axes.ThreeJS);
		// Rolled onto its left side, facing north: its up is west, so its right hand points up.
		const rolled = { point: [0, 0, 0], facing: [0, 0, -1], up: [-1, 0, 0] };
		assert.equal(bearingOf(rolled, { point: [0, 5, 0] }, axes), Bearing.Right);
		assert.equal(bearingOf({ ...rolled, up: undefined }, { point: [0, 5, 0] }, axes), Bearing.Above);
	});

	it('tells a seen thing\'s facing as if the one looking faced forward', () => {
		const axes = checkAxes(Axes.Unreal);
		// Facing east (+Y), it sees one face east: straight ahead, which at rest is +X.
		assert.ok(near(toLocal([0, 1, 0], [0, 1, 0], axes), [1, 0, 0]));
	});
});

describe('bearing modes', () => {
	const axes = checkAxes(Axes.Plane);
	const self = { point: [0, 0], facing: [0, -1] };
	const woman = { id: 'Woman', point: [12, 0], tags: ['character'] };
	const look = (bearing:BearingMode, from:{ point:Vec; facing?:Vec } = self):string => formatSight({ self: { id: 'Me', ...from }, objects: [woman] }, { axes, bearing, unitName: 'm' });

	it('tells where things are from the one looking, by the compass, or both', () => {
		assert.equal(look(BearingMode.Relative), 'Woman 10m to your right.');
		assert.equal(look(BearingMode.Absolute), 'Woman 10m east.');
		assert.equal(look(BearingMode.Both), 'Woman 10m to your right (east).');
		assert.equal(look(BearingMode.Both, { point: [0, 0] }), 'Woman 10m east.');
		assert.equal(look(BearingMode.Relative, { point: [0, 0] }), 'Woman 10m.');
	});

	it('names eight compass points, north along forward and east along right', () => {
		const points:Vec[] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
		assert.deepEqual(points.map((point) => bearingOf(self, { point }, axes, BearingMode.Absolute)), [
			Bearing.North, Bearing.Northeast, Bearing.East, Bearing.Southeast, Bearing.South, Bearing.Southwest, Bearing.West, Bearing.Northwest,
		]);
		assert.equal(bearingOf({ point: [0, 0, 0] }, { point: [0, 3, 0] }, checkAxes(Axes.Unreal), BearingMode.Absolute), Bearing.East);
	});

	it('tells what is steeper than 45° above or below, in 3D only, in every mode; both adds the compass', () => {
		const three = checkAxes(Axes.ThreeJS);
		const me = { point: [0, 0, 0], facing: [0, 0, -1] };
		const modes = [BearingMode.Relative, BearingMode.Absolute, BearingMode.Both];
		assert.deepEqual(modes.map((mode) => bearingOf(me, { point: [0, 3, -2] }, three, mode)), [Bearing.Above, Bearing.Above, Bearing.Above]);
		assert.deepEqual(modes.map((mode) => bearingText(me, { point: [0, -3, -2] }, three, mode)), ['below you', 'below you', 'below you (north)']);
		assert.equal(bearingText(me, { point: [0, 3, 0] }, three, BearingMode.Both), 'above you', 'straight up has no compass');
		assert.equal(bearingText({ point: [0, 0, 0] }, { point: [0, 3, -2] }, three), 'above you', 'facing nowhere');
		assert.equal(bearingOf(me, { point: [0, 2, -2] }, three), Bearing.Ahead, 'at 45° it is level');
		assert.equal(bearingOf(me, { point: [0, 2.01, -2] }, three), Bearing.Above, 'past 45°');
		assert.equal(bearingOf(me, { point: [0, -2, -2] }, three), Bearing.Ahead);
		assert.equal(bearingOf(self, { point: [0, -9] }, axes, BearingMode.Both), Bearing.North, '2D never');
		assert.equal(formatSight({ self: { id: 'Me', ...me }, objects: [{ ...woman, point: [0, 12, -3] }] }, { axes: three, bearing: BearingMode.Both, unitName: 'm' }), 'Woman 10m above you (north).');
	});
});

describe('size and reach', () => {
	const poses:Record<string, Pose> = { Ann: { point: [0, 0] }, Bo: { point: [2, 0], size: 0.5 }, Tower: { point: [10, 0], size: 4 } };
	const reaches:Record<string, number> = { Sword: 2, steal: 1.5 };
	const world:HostWorld<string> = {
		find: (id) => id,
		geometry: { axes: Axes.Plane, getPose: (id) => poses[id], getReach: (who, using) => (using === undefined ? 1 : reaches[using] ?? 1) },
	};

	it('measures distance and reach edge to edge, the same both ways', () => {
		const { distance } = geometryKernels(world, 'Ann');
		assert.equal(distance!(dummyEntity('Ann'), dummyEntity('Tower')), 6);
		assert.equal(distance!(dummyEntity('Tower'), dummyEntity('Ann')), 6, 'symmetric');
		assert.equal(distance!(dummyEntity('Bo'), dummyEntity('Tower')), 3.5, 'less both sizes');
		assert.equal(distance!(dummyEntity('Bo'), dummyEntity('Bo')), 0, 'never below 0');
		assert.equal(reachTo(world, 'Ann', 'Tower'), 5);
		assert.equal(reachTo(world, 'Tower', 'Ann'), 5);
		assert.equal(reachTo(world, 'Bo', 'Tower', 'Sword'), 6.5);
	});

	it('reaches with an item, with a verb, or bare-handed, default 1', () => {
		assert.equal(reachOf(world, 'Ann', 'Sword'), 2);
		assert.equal(reachOf(world, 'Ann', 'steal'), 1.5);
		assert.equal(reachOf(world, 'Ann'), 1);
		assert.equal(reachOf({ ...world, geometry: { ...world.geometry!, getReach: undefined } }, 'Ann', 'Sword'), 1, 'no getReach');
		assert.equal(inReach(world, 'Ann', 'Bo'), false, 'its edge is 1.5 off');
		assert.equal(inReach(world, 'Ann', 'Bo', 'steal'), true);
		assert.equal(inReach(world, 'Ann', 'Bo', 'Sword'), true);
		assert.equal(inReach(world, 'Ann', 'Nobody'), undefined, 'no place, no answer');
	});
});

describe('ground and rays by the axes', () => {
	it('lays formations on the ground across up, whichever way the axes turn', () => {
		const [east, north] = groundAxes(checkAxes(Axes.Unreal));
		assert.deepEqual([east, north], [[0, 1, 0], [1, 0, 0]]);
		const tilted = checkAxes({ forward: [1, 1, 0], up: [-1, 1, 0], handed: 'right' });
		for (const axis of groundAxes(tilted)) {
			assert.ok(Math.abs(axis[0] * -1 + axis[1]) < 1e-9, 'level with the ground');
		}
	});

	it('spreads sound rays across the plane in 2D, over a cone in 3D, unless told', () => {
		assert.equal(raySpread({ count: 8 }, checkAxes(Axes.Plane)), 'plane');
		assert.equal(raySpread({ count: 8 }, checkAxes(Axes.ThreeJS)), 'cone');
		assert.equal(raySpread({ count: 8, spread: 'plane' }, checkAxes(Axes.Unity)), 'plane');
	});
});
