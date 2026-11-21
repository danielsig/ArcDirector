import { resetTime, type GameObject } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArcDirector } from 'arc-director';
import { NPCInput } from '../../characters/NPCInput';
import { DemoWorld } from '../../engine/demo-world';
import type { GameHost, SceneState } from '../../director/adapter';
import type { CharacterCtx } from '../../director/game-types';
import { gameWorld } from '../../director/game-world';
import { decodeGlyphChunk } from '../../world/decode-glyph-chunk';
import { spawnChunkEntities, spawnNPC } from '../../world/spawn';
import { bodyOf, mindsOf } from '../scene';
import { DUNGEON } from './dungeon-scene';

/** The crypt with its cast at game time `time`, fresh as a new game: a director that runs the party's own minds without a model, and the scene's state as a game starts it. */
function crypt(time:number):GameHost {
	resetTime(time);
	const world = new DemoWorld();
	for (const file of DUNGEON.chunks) {
		const { chunk } = decodeGlyphChunk(file);
		spawnChunkEntities(world, chunk);
		world.terrain.register(chunk);
	}
	DUNGEON.cast.forEach((member) => spawnNPC(world, bodyOf(member)));
	world.reindex();
	const state:SceneState = { bargainDone: false };
	const host = { world, scene: DUNGEON, hooks: {}, labels: new Map(), sceneState: () => state } as unknown as GameHost;
	const director = new ArcDirector<CharacterCtx, GameObject>()
		.withVerbs((v) => v.addStock())
		.withWorld(gameWorld(host))
		.withContext((id) => {
			const go = world.findNamed(id);
			return go && { world, character: go, npc: go.getComponent(NPCInput)! };
		});
	mindsOf(DUNGEON.cast).forEach((spec) => director.addCharacter({ id: spec.id, kit: { verbs: ['go_to'] } }));
	host.arc = DUNGEON.direct(host, director);
	return host;
}

test('a crawl saved while the party celebrates the crown, loaded later, still sends it up the stairs', () => {
	type Leaving = { leaving:{ at:number | null; ids:string[] } };
	// Saved through JSON, as the save is, three seconds into the celebration: the party sets off at 6.
	const won = crypt(3);
	Object.assign(won.sceneState(), { bargainDone: true, leaving: { at: 6, ids: [] } });
	// Loaded into a fresh game, as `SaveSlot.boot` does, past the hour.
	const loaded = crypt(7);
	Object.assign(loaded.sceneState(), JSON.parse(JSON.stringify(won.sceneState())) as object);
	DUNGEON.hooks!.tick!(loaded);
	const party = mindsOf(DUNGEON.cast).map(({ id }) => id);
	assert.deepEqual(loaded.sceneState<Leaving>().leaving, { at: null, ids: party });
	// Saved again on the way out, it loads on the way out: nobody is sent twice, and the stairs still know who leaves.
	const again = crypt(8);
	Object.assign(again.sceneState(), JSON.parse(JSON.stringify(loaded.sceneState())) as object);
	DUNGEON.hooks!.tick!(again);
	assert.deepEqual(again.sceneState<Leaving>().leaving, { at: null, ids: party });
});
