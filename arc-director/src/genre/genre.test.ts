import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STOCK_VERBS } from '../arc/stock-verbs.js';
import { parseArc } from '../arc/wire.js';
import { ArcDirector } from '../director/director.js';
import { OPEN_WORLD } from '../testing/world.js';

type Ctx = { id:string };

function director():ArcDirector<Ctx> {
	return new ArcDirector<Ctx>().addFakeInference().withWorld(OPEN_WORLD).withContext((id) => ({ id }));
}

function verbsOf(d:ArcDirector<Ctx>, id:string):string[] {
	return d.character(id)!.activeVerbs().list().map((verb) => verb.name);
}

describe('withRPG and withMOBA', () => {
	it('registers the verbs the game handles, with their args and help, and grants them with the stock verbs and offer', async () => {
		const equipped:string[] = [];
		const d = await director()
			.withRPG({
				equip: ({ args }) => {
					equipped.push(args.item);
					return { ok: true, verb: 'equip' };
				},
				block: { help: 'guard up 2s', handler: () => ({ ok: true, verb: 'block' }) },
				abilities: { hex: ({ args }) => ({ ok: true, verb: 'hex', reason: args.target }) },
			})
			.addCharacter({ id: 'Wren' })
			.start();
		const verbs = d.character('Wren')!.activeVerbs();
		assert.deepEqual(Object.keys(verbs.get('equip')!.args), ['item', 'slot']);
		assert.equal(verbs.get('block')!.help, 'guard up 2s');
		assert.equal(verbs.get('hex')!.args.target, 'id');
		assert.deepEqual(verbsOf(d, 'Wren').filter((verb) => !(STOCK_VERBS as readonly string[]).includes(verb)), ['offer', 'equip', 'block', 'hex']);
		assert.equal((await d.character('Wren')!.enact(parseArc('equip(item=Sword)', verbs))).ok, true);
		assert.deepEqual(equipped, ['Sword']);
		d.dispose();
	});

	it('keeps an explicit default kit, given before or after, and a MOBA trades nothing', async () => {
		const attack = { attack: () => ({ ok: true, verb: 'attack' }) };
		const before = await director().withDefaultKit({ verbs: ['wait'] }).withMOBA(attack).addCharacter({ id: 'A' }).start();
		const after = await director().withMOBA(attack).withDefaultKit({ verbs: ['wait'] }).addCharacter({ id: 'A' }).start();
		const moba = await director().withMOBA(attack).addCharacter({ id: 'A' }).start();
		assert.deepEqual(verbsOf(before, 'A'), ['wait']);
		assert.deepEqual(verbsOf(after, 'A'), ['wait']);
		assert.ok(verbsOf(moba, 'A').includes('attack'));
		assert.equal(verbsOf(moba, 'A').includes('offer'), false);
		[before, after, moba].forEach((d) => d.dispose());
	});
});
