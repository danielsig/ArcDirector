import { GameObject, stepPhysics } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoxCollider, Bridge, RigidBody } from '../engine/components';
import { DemoWorld } from '../engine/demo-world';
import { RUINS_CHUNKS } from '../scenes/ruins/ruins-map';
import { glen_0_0 } from '../data/chunks/glen-0-0';
import { glen_0_1 } from '../data/chunks/glen-0-1';
import { glen_1_0 } from '../data/chunks/glen-1-0';
import { glen_1_1 } from '../data/chunks/glen-1-1';
import { decodeGlyphChunk } from '../world/decode-glyph-chunk';
import { spawnChunkEntities } from '../world/spawn';
import { CharacterMotor } from './CharacterMotor';
import { NPCInput } from './NPCInput';

test('two walkers meeting head-on each step to their right and pass', () => {
	const world = new DemoWorld();
	for (const file of RUINS_CHUNKS) {
		world.addChunk(decodeGlyphChunk(file).chunk);
	}
	// Glyph row 7 of the ruins, open floor from column 24 to 39, with room to either side where they meet.
	const walker = (id:string, x:number, toX:number) => {
		const go = new GameObject(id, 'NPC');
		go.transform.localPosition = { x, y: 0, z: 7.5 };
		go.addComponent(NPCInput).destinationPoint = { x: toX, z: 7.5 };
		const motor = go.addComponent(CharacterMotor);
		go.addComponent(RigidBody, { kinematic: true });
		go.addComponent(BoxCollider, { size: { x: 0.45, y: 1.1, z: 0.45 }, pad: 0.36 });
		world.add(go);
		return { go, motor, swerve: 0 };
	};
	const east = walker('East', 25.5, 37.5);
	const west = walker('West', 37.5, 25.5);
	const dt = 1 / 60;
	for (let t = 0; t < 10; t += dt) {
		for (const w of [east, west]) {
			w.motor.update(dt);
		}
		stepPhysics(world, dt);
		world.reindex();
		// Their right: south for the one walking east, north for the one walking west.
		east.swerve = Math.max(east.swerve, east.go.transform.position.z - 7.5);
		west.swerve = Math.max(west.swerve, 7.5 - west.go.transform.position.z);
	}
	assert.ok(east.go.transform.position.x > 37, `East stuck at x ${east.go.transform.position.x.toFixed(2)}`);
	assert.ok(west.go.transform.position.x < 26, `West stuck at x ${west.go.transform.position.x.toFixed(2)}`);
	assert.ok(east.swerve > 0.3 && west.swerve > 0.3, `did not both step right: ${east.swerve.toFixed(2)}, ${west.swerve.toFixed(2)}`);
});

test('a walker crosses the glen river on the lowered drawbridge, and not while it is raised', () => {
	const cross = (lowered:boolean):number => {
		const world = new DemoWorld();
		for (const file of [glen_0_0, glen_0_1, glen_1_0, glen_1_1]) {
			const chunk = decodeGlyphChunk(file).chunk;
			spawnChunkEntities(world, chunk);
			world.addChunk(chunk);
		}
		const bridge = world.findNamed('Bridge')!.getComponent(Bridge)!;
		bridge.open = lowered;
		bridge.start();
		// The span is glyph column 13 of chunk (0, 1), rows 4 to 6: the river from z 20 to 23.
		const go = new GameObject('Walker', 'NPC');
		go.transform.localPosition = { x: 13.5, y: 0, z: 18.5 };
		go.addComponent(NPCInput).destinationPoint = { x: 13.5, z: 24.5 };
		const motor = go.addComponent(CharacterMotor);
		go.addComponent(RigidBody, { kinematic: true });
		go.addComponent(BoxCollider, { size: { x: 0.45, y: 1.1, z: 0.45 }, pad: 0.36 });
		world.add(go);
		world.reindex();
		const dt = 1 / 60;
		for (let t = 0; t < 8; t += dt) {
			bridge.update(dt);
			motor.update(dt);
			stepPhysics(world, dt);
			world.reindex();
		}
		return go.transform.position.z;
	};
	const across = cross(true);
	assert.ok(across > 24, `stopped at z ${across.toFixed(2)} on the lowered bridge`);
	const held = cross(false);
	assert.ok(held < 20, `crossed the raised bridge to z ${held.toFixed(2)}`);
});
