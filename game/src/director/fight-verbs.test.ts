import { resetTime, stepPhysics, Time, type GameObject } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArcDirector, type ArcResult } from 'arc-director';
import { CharacterMotor } from '../characters/CharacterMotor';
import { NPCInput } from '../characters/NPCInput';
import { DemoWorld } from '../engine/demo-world';
import { DUNGEON } from '../scenes/dungeon/dungeon-scene';
import { decodeGlyphChunk } from '../world/decode-glyph-chunk';
import { inLineOfSight } from '../world/path';
import { spawnChunkEntities, spawnNPC } from '../world/spawn';
import type { GameHost } from './adapter';
import { fightVerbs } from './fight-verbs';
import type { CharacterCtx } from './game-types';
import { gameWorld } from './game-world';

const DT = 1 / 30;

/**
 * The dungeon's Pillared Hall with a bone archer of the Horde two cells north of the column at cell (15, 19) and
 * Seraphine, a healer of no collective, two cells south of it: the column stands on the line between them.
 */
function hall():{ world:DemoWorld; director:ArcDirector<CharacterCtx, GameObject>; archer:GameObject; healer:GameObject } {
	resetTime(0);
	const world = new DemoWorld();
	const decoded = DUNGEON.chunks.map(decodeGlyphChunk);
	for (const { chunk } of decoded) {
		spawnChunkEntities(world, chunk);
		world.terrain.register(chunk);
	}
	const spawn = (id:string, meshID:string, x:number, z:number, equip:string[]):GameObject => spawnNPC(world, { id, meshID, cell: [x, z], hp: 8, equip });
	const archer = spawn('BoneArcher1', 'SkeletonArcher', 15, 17, ['bone_bow']);
	const healer = spawn('Seraphine', 'Shaman', 15, 21, ['shaman_staff']);
	world.reindex();
	const host = { world, hooks: {} } as unknown as GameHost;
	const director = new ArcDirector<CharacterCtx, GameObject>()
		.withVerbs((v) => v.addStock())
		.withRPG(fightVerbs(host))
		.withWorld(gameWorld(host))
		.withContext((id) => {
			const go = world.findNamed(id);
			return go && { world, character: go, npc: go.getComponent(NPCInput)! };
		})
		.addCollective({ id: 'Horde', kit: { verbs: ['attack'] }, characters: [{ id: 'BoneArcher1', tags: ['Archer'] }] })
		.addCharacter({ id: 'Seraphine', tags: ['Healer'], kit: { verbs: ['wait'] } });
	(host as { arc:typeof director }).arc = director;
	return { world, director, archer, healer };
}

test('an archer with a column in its way walks round it for a clear shot, and shoots', async (t) => {
	// Every shot misses: a hit's flash and dust need a canvas.
	t.mock.method(Math, 'random', () => 0.999);
	const { world, director, archer, healer } = hall();
	const line = () => inLineOfSight(world, 'sound', archer.transform.position, healer.transform.position);
	assert.equal(line(), false, 'the column stands between them');
	const start = { x: archer.transform.position.x, z: archer.transform.position.z };
	let done:ArcResult | undefined;
	void director.character('BoneArcher1')!.perform({ verb: 'attack', args: { target: 'Seraphine' } }).then((r) => {
		done = r;
	});
	for (let s = 0; s < 20 && !done; s += DT) {
		Time.time += DT;
		world.runTimers();
		director.tick(DT);
		world.forEachComponent(CharacterMotor, (motor) => motor.update(DT));
		stepPhysics(world, DT);
		world.reindex();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	const why = typeof done?.reason === 'function' ? done.reason((id) => id) : done?.reason;
	assert.deepEqual([done?.status, why], ['ok', 'missed Seraphine'], 'it shot');
	const moved = Math.hypot(archer.transform.position.x - start.x, archer.transform.position.z - start.z);
	assert.ok(moved > 0.3 && moved < 2.5, `it stepped out from behind the column and no farther: ${moved.toFixed(2)} m`);
	assert.ok(line(), 'from where it shot, the line is clear');
	director.dispose();
});
