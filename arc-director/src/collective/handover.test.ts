import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STOCK_VERBS } from '../arc/stock-verbs.js';
import { dummyEntity } from '../expr/natives.js';
import type { ChatRequest } from '../inference/provider.js';
import { ArcDirector } from '../director/director.js';
import { STOCK_COLLECTIVE_VERBS } from './verbs.js';
import { HANDOVER_THREAD } from './handover.js';

type Ctx = { id:string };

const KIT = { verbs: [...STOCK_VERBS, ...STOCK_COLLECTIVE_VERBS] };

function sleep(ms:number):Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/** Tom and Ann in DawnParty, Bob too but with no identity, and an empty DuskParty. `reply` answers the handover. */
async function stage(reply:(req:ChatRequest)=>string = () => '{}') {
	const calls:ChatRequest[] = [];
	const director = await new ArcDirector<Ctx>()
		.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 100, heartbeatMin: 100, maxParallel: 2 })
		.withFakeInference((req) => {
			if (req.thread !== HANDOVER_THREAD) {
				return { content: 'wait()', toolCalls: [] };
			}
			calls.push(req);
			return { content: reply(req), toolCalls: [] };
		})
		.withArcText(true)
		.addStockVerbs()
		.addStockCollectiveVerbs()
		.withDefaultKit(KIT)
		.withKernels((ctx) => ({ me: dummyEntity(ctx.id), others: [], items: [] }))
		.withContext((id) => ({ id }))
		.onVerb(({ verb }) => ({ ok: true, verb }))
		.addCollective({
			id: 'DawnParty',
			mind: { skipHeartbeat: true, skipMajor: true },
			kit: KIT,
			identity: { role: 'Holds the bridge.' },
			memories: [
				{ text: 'Tom scouts the east road for us.', category: 'semantic' },
				{ text: 'We hold the bridge.', tags: ['backstory', 'bridge'], pinned: true },
			],
			characters: [
				{ id: 'Tom', mind: { skipHeartbeat: true, skipMajor: true }, identity: { role: 'Scout' }, memories: [{ text: 'The east road is clear.' }] },
				{ id: 'Ann', mind: { skipHeartbeat: true, skipMajor: true }, identity: { traits: ['loud'] } },
				{ id: 'Bob' },
			],
		})
		.addCollective({
			id: 'DuskParty',
			mind: { skipHeartbeat: true, skipMajor: true },
			kit: KIT,
			identity: { role: 'Takes the bridge.' },
		})
		.start();
	const dawn = director.collective('DawnParty')!;
	const dusk = director.collective('DuskParty')!;
	const of = (id:string) => director.character(id)!;
	/** Director ticks until the thinks the moves woke are done and the handover had its free slot. */
	let clock = 0;
	const tick = async ():Promise<void> => {
		for (let i = 0; i < 8; i++) {
			director.tick(1, clock += 1);
			await sleep(10);
		}
	};
	return { director, calls, dawn, dusk, of, tick };
}

const userText = (req:ChatRequest):string => String(req.messages[1]?.content ?? '');

describe('memory handover', () => {
	it('batches moves in one tick into one call', async () => {
		const { director, calls, of, tick } = await stage();
		of('Tom').collective = null;
		of('Ann').collective = null;
		await tick();
		assert.equal(calls.length, 1);
		assert.match(userText(calls[0]), /- Tom left DawnParty and is on their own now\.\n- Ann left DawnParty/);
		await tick();
		assert.equal(calls.length, 1);
		director.dispose();
	});

	it('collapses a character\'s moves in the window into one journey', async () => {
		const { director, calls, dusk, of, tick } = await stage();
		of('Tom').collective = null;
		of('Tom').collective = dusk;
		await tick();
		assert.equal(calls.length, 1);
		const moves = userText(calls[0]).split('\n\n')[0];
		assert.equal(moves, 'Moves:\n- Tom moved from DawnParty to DuskParty.');
		director.dispose();
	});

	it('edits every persona involved, never a pinned memory', async () => {
		const { director, dawn, dusk, of, tick } = await stage((req) => {
			const ids = (text:string) => [...userText(req).matchAll(new RegExp(`- (mem_\\d+): ${text}`, 'g'))].map((m) => m[1]);
			const [scout] = ids('Tom scouts the east road for us\\.');
			const [road] = ids('The east road is clear\\.');
			return JSON.stringify({
				Tom: { rewrite: [{ id: road, text: 'DawnParty last saw the east road clear.' }], add: ['mem_9: I fight for DuskParty now.'] },
				DawnParty: { remove: [scout, 'mem_404'], add: ['Tom went over to DuskParty.'] },
				DuskParty: { add: ['Tom joined us from DawnParty.'] },
			});
		});
		const pinned = dawn.persona.memory.pinned().map((m) => m.text);
		of('Tom').collective = dusk;
		await tick();
		const texts = (memory:{ all():{ text:string }[] }) => memory.all().map((m) => m.text);
		assert.ok(texts(of('Tom').persona.memory).includes('DawnParty last saw the east road clear.'));
		assert.ok(texts(of('Tom').persona.memory).includes('I fight for DuskParty now.'));
		assert.equal(texts(dawn.persona.memory).includes('Tom scouts the east road for us.'), false);
		assert.ok(texts(dawn.persona.memory).includes('Tom went over to DuskParty.'));
		assert.ok(texts(dusk.persona.memory).includes('Tom joined us from DawnParty.'));
		assert.deepEqual(dawn.persona.memory.pinned().map((m) => m.text), pinned);
		director.dispose();
	});

	it('leaves pinned memories alone even when the reply names them', async () => {
		const { director, dawn, of, tick } = await stage(() => '{}');
		const pin = dawn.persona.memory.pinned()[0];
		director.withMemoryHandover({
			handover: async () => [{ id: 'DawnParty', remove: [pin.id], rewrite: [{ id: pin.id, text: 'gone' }] }],
		});
		of('Tom').collective = null;
		await tick();
		assert.equal(dawn.persona.memory.pinned()[0], pin);
		assert.equal(pin.text, 'We hold the bridge.');
		director.dispose();
	});

	it('skips characters with no identity, and can be turned off', async () => {
		const { director, calls, of, tick } = await stage();
		of('Bob').collective = null;
		await tick();
		assert.equal(calls.length, 0);
		director.withMemoryHandover({ handover: false });
		of('Tom').collective = null;
		await tick();
		assert.equal(calls.length, 0);
		director.dispose();
	});
});
