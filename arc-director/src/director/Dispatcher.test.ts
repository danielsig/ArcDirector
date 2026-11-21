import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ArcDirector } from './ArcDirector.js';
import './shortcuts.js';
import { dummyEntity } from '../expr/natives.js';
import { showNamingText } from '../character/text-with-ids.js';

type Ctx = { id:string };

describe('Dispatcher', () => {
	it('refuses a step until what its requirements need of the doer holds, telling it in its own names', async () => {
		const tags:string[] = [];
		const rung:string[] = [];
		const director = new ArcDirector<Ctx>()
			.withVerbs((v) => v.addStock().add('ring', { args: { target: 'id' }, handler: (call) => {
				rung.push(call.args.target as string);
				return { status: 'ok', verb: 'ring' };
			} }))
			.withWorld({ find: (id) => (['Ann', 'Bell', 'Cook'].includes(id) ? id : undefined) })
			.withKernels((ctx) => ({ me: dummyEntity(ctx.id, { tags }), others: [dummyEntity('Bell'), dummyEntity('Cook', { tags: ['kitchen'] })], items: [] }))
			.withContext((id) => ({ id }))
			.addCharacter({ id: 'Ann', kit: { verbs: ['ring'] } })
			.withRequirements([
				{ verb: 'ring', target: 'Bell', condition: 'me is "sitting"', reason: 'sit down to ring Bell' },
				{ verb: 'ring', target: 'kitchen', condition: 'me is "Cook"' },
			]);
		const ann = director.character('Ann')!;
		const told = (reason:unknown):string => showNamingText(reason as string, (id) => ({ Bell: 'the brass bell', Cook: 'Old Tom' })[id] ?? id);
		assert.equal(told((await ann.perform({ verb: 'ring', args: { target: 'Bell' } })).reason), 'sit down to ring the brass bell', 'each id in the reason in the mind\'s own names');
		tags.push('sitting');
		assert.equal((await ann.perform({ verb: 'ring', args: { target: 'Bell' } })).status, 'ok');
		assert.equal(told((await ann.perform({ verb: 'ring', args: { target: 'Cook' } })).reason), 'needs me is "Old Tom"', 'matched by a tag; with no reason, the condition, named as well');
		assert.deepEqual(rung, ['Bell'], 'a refused step never reaches its handler');
		assert.throws(() => director.withRequirements([{ verb: 'ring', to: 'Bell', condition: 'true' }]), /no arg to/);
		assert.throws(() => director.withRequirements([{ verb: 'chime', target: 'Bell', condition: 'true' }]), /no such verb/);
	});
});
