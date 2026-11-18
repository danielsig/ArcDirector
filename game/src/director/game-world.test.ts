import { GameObject } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArcDirector, showNamingText, type ArcResult } from 'arc-director';
import { CharacterMotor } from '../characters/CharacterMotor';
import { NPCInput } from '../characters/NPCInput';
import { BoxCollider, HumanBody, Lock, Named, RigidBody } from '../engine/components';
import { DemoWorld } from '../engine/demo-world';
import { Container } from '../items/item-components';
import { getDef } from '../items/defs';
import { instantiateDef } from '../items/instance';
import { itemMatchesName, listCarried, tryInsert } from '../items/inventory';
import type { GameHost } from './adapter';
import type { CharacterCtx } from './game-types';
import { gameWorld } from './game-world';
import { kernelsOf } from './kernels';
import { idOf } from './names';
import { lockedReason } from '../items/pickup';

function body(world:DemoWorld, id:string, x:number):GameObject {
	const go = new GameObject(id, 'Person');
	go.transform.localPosition = { x, y: 0, z: 0 };
	go.addComponent(Named, { id });
	go.addComponent(NPCInput);
	go.addComponent(CharacterMotor);
	go.addComponent(RigidBody, { kinematic: true });
	go.addComponent(BoxCollider, { size: { x: 0.45, y: 1.1, z: 0.45 }, pad: 0.36 });
	go.addComponent(HumanBody, { pockets: go.addComponent(Container, { size: 8 }) });
	world.add(go);
	return go;
}

test('a market thief steals what it sees in reach on someone, by the library\'s default alone', async () => {
	const world = new DemoWorld();
	const thief = body(world, 'Thief', 0);
	const bram = body(world, 'Bram', 1);
	assert.equal(tryInsert(bram, instantiateDef(getDef('apple'))), true);
	const host = { world, hooks: { allowTheft: false } } as unknown as GameHost;
	const geography = gameWorld(host);
	assert.equal(geography.transfers!.canPickUp!(thief, 'Apple', bram), undefined, 'no rule of the game\'s on picking pockets');
	const ctxOf = (id:string):CharacterCtx | undefined => {
		const go = world.findNamed(id);
		return go && { world, character: go, npc: go.getComponent(NPCInput)!, scene: 'marketplace' };
	};
	const director = new ArcDirector<CharacterCtx, GameObject>()
		.withVerbs((v) => v.addStock())
		.withWorld(geography)
		.withStealing()
		.withContext(ctxOf)
		.withKernels((ctx) => kernelsOf(world, ctx.character))
		.withSight({ look: (ctx) => ({
			self: { id: 'Thief', point: [0, 0] },
			objects: ctx.character === thief ? [{ id: 'Bram', point: [1, 0], tags: ['character'] }] : [],
		}) })
		.addCharacter({ id: 'Thief', kit: { verbs: ['steal'] } })
		.addCharacter({ id: 'Bram', kit: { verbs: ['wait'] } });
	director.tick(0);
	const seen = director.getSight()!.seenBy(ctxOf('Thief')!)!.objects[0];
	assert.deepEqual(seen.carrying, ['Apple'], 'a thief sees what Bram carries');
	let done:ArcResult | undefined;
	void director.character('Thief')!.perform({ verb: 'steal', args: { item: 'Apple', from: 'Bram' } }).then((r) => {
		done = r;
	});
	// Already in reach: the move ends on the next look.
	for (let i = 0; i < 20 && !done; i++) {
		director.tick(0.05);
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	assert.equal(done?.status, 'ok', done?.reason);
	assert.ok(listCarried(thief).some((it) => itemMatchesName(it, 'Apple')));
	// As the adapter wires it: the thief knows Bram carries the key; Bram, not the thief.
	world.canSeeInventoryOf = (viewer, holder) => !!director.getWorldVerbs()?.canSeeInventoryOf(idOf(viewer), idOf(holder));
	assert.equal(tryInsert(bram, instantiateDef(getDef('brass_key'))), true);
	const lock = new GameObject('Gate').addComponent(Lock, { keyID: 'brass' });
	// Each mind reads it in its own names: never the item's display name, never an id it does not call it by.
	const aliases = (id:string):string => ({ BrassKey: 'ShinyKey', Bram: 'OldBram' })[id] ?? id;
	assert.equal(showNamingText(lockedReason(world, lock, thief), aliases), 'locked — needs ShinyKey, carried by OldBram');
	assert.equal(showNamingText(lockedReason(world, lock, thief)), 'locked — needs BrassKey, carried by Bram');
	assert.equal(showNamingText(lockedReason(world, lock, bram), aliases), 'locked — needs ShinyKey');
	director.dispose();
});
