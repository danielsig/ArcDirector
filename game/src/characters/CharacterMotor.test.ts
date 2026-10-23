import { GameObject, stepPhysics } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoxCollider, RigidBody } from '../engine/components';
import { World } from '../engine/World';
import { RUINS_CHUNKS } from '../data/chunks/ruins';
import { decodeGlyphChunk } from '../world/decodeGlyphChunk';
import { CharacterMotor } from './CharacterMotor';
import { NPCInput } from './NPCInput';

test('two walkers meeting head-on each step to their right and pass', () => {
	const world = new World();
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
