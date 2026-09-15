import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STOCK_MOVE_VERBS, STOCK_VERBS } from '../action/registry.js';
import { goToNamedInteractable } from '../inference/fake.js';
import { dummyEntity } from '../expr/natives.js';
import { formatSight } from '../perception/sight.js';
import { formatInventory } from '../perception/formatInventory.js';
import { ArcDirector } from './director.js';
import type { VerbCall } from './types.js';

type Ctx = { paragraph:string; id:string };

function sleep(ms:number):Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function waitFor(fn:()=>boolean, ms = 400):Promise<void> {
	const t0 = Date.now();
	while (!fn()) {
		if (Date.now() - t0 > ms) {
			throw new Error('timeout');
		}
		await sleep(10);
	}
}

function scene():string {
	return 'A damp stone hall. EastGate stands in the east wall.';
}

const KIT = { verbs: STOCK_VERBS };

const WAIT_REPLY = {
	content: JSON.stringify({ head: { verb: 'wait', args: {} } }),
	toolCalls: [] as [],
};

async function gatedTrio(opts:{
	batchThinks?:boolean;
	batchWait?:number;
}):Promise<{
	director:ArcDirector<Ctx>;
	chats:string[];
	gates:Array<()=>void>;
}> {
	const gates:Array<()=>void> = [];
	const chats:string[] = [];
	const director = await new ArcDirector<Ctx>()
		.withPriorityQueue({
			processInterval: 0,
			watchInterval: 0,
			heartbeatStart: 100,
			heartbeatMin: 100,
			maxParallel: 2,
			batchThinks: opts.batchThinks,
			batchWait: opts.batchWait,
		})
		.withFakeInference((req) => new Promise((resolve) => {
			chats.push(req.thread ?? '?');
			gates.push(() => resolve(WAIT_REPLY));
		}))
		.addStockVerbs()
		.withDefaultKit(KIT)
		.onVerb(() => ({ ok: true, verb: 'wait' }))
		.addSense('scene', {
			description: 'see',
			gather: (ctx) => ctx.paragraph,
		})
		.withContext((id) => ({ paragraph: scene(), id }))
		.addAgent({
			id: 'Able',
			skipHeartbeat: true,
			kit: KIT,
			identity: { name: 'Able', role: 'Goes.' },
			goals: [{ text: 'Wait', priority: 1 }],
		})
		.addAgent({
			id: 'Baker',
			skipHeartbeat: true,
			kit: KIT,
			identity: { name: 'Baker', role: 'Goes.' },
			goals: [{ text: 'Wait', priority: 1 }],
		})
		.addAgent({
			id: 'Charlie',
			skipHeartbeat: true,
			kit: KIT,
			identity: { name: 'Charlie', role: 'Goes.' },
			goals: [{ text: 'Wait', priority: 1 }],
		})
		.start();
	const queue = director.mindQueue()!;
	queue.enqueueMajor('Able');
	queue.enqueueMajor('Baker');
	queue.enqueueMajor('Charlie');
	return { director, chats, gates };
}

function directorOf(calls?:VerbCall<Ctx>[]):ArcDirector<Ctx> {
	return new ArcDirector<Ctx>()
		.withPriorityQueue({
			processInterval: 0,
			watchInterval: 0,
			heartbeatStart: 0.01,
			heartbeatMin: 0.01,
			maxParallel: 2,
		})
		.withFakeInference(goToNamedInteractable())
		.addStockVerbs()
		.withDefaultKit(KIT)
		.onVerb((call) => {
			calls?.push(call);
			return { ok: true, verb: call.verb, reason: String(call.args.name ?? '') };
		})
		.addSense('scene', {
			description: 'What you can see. Names only.',
			gather: (ctx) => ctx.paragraph,
		})
		.withContext((id) => ({ paragraph: scene(), id }));
}

describe('ArcDirector', () => {
	it('chains any order, start, tick with FakeProvider', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await directorOf(calls)
			.addAgent({
				id: 'Watcher',
				kit: KIT,
				identity: { name: 'Watcher', role: 'Pays attention.', traits: ['alert'] },
				goals: [{ text: 'Go to EastGate', priority: 1 }],
			})
			.start();
		director.tick(1, 1);
		await waitFor(() => !!director.agent('Watcher')?.lastPlan);
		const plan = director.agent('Watcher')!.lastPlan!;
		assert.equal(plan.head.verb, 'go_to');
		assert.equal(plan.head.args.name, 'EastGate');
		await waitFor(() => calls.length > 0);
		assert.equal(calls[0].verb, 'go_to');
		assert.equal(calls[0].agent.id, 'Watcher');
		assert.equal(calls[0].ctx.id, 'Watcher');
		director.dispose();
	});

	it('throws with* after start', async () => {
		const director = await directorOf().addAgent({
			id: 'Watcher',
			kit: KIT,
			identity: { name: 'Watcher', role: 'Pays attention.' },
		}).start();
		assert.throws(() => director.withFakeInference(), /already started/);
		assert.throws(() => director.withPriorityQueue(), /already started/);
		assert.throws(() => director.withContext(() => ({ paragraph: '', id: '' })), /already started/);
		assert.throws(() => director.withDefaultKit({ verbs: [] }), /already started/);
		assert.throws(() => director.withSight({ look: () => ({ self: { id: 'Watcher', at: [0, 0] }, objects: [] }) }), /already started/);
		assert.throws(() => director.withInventory(() => ({})), /already started/);
		director.dispose();
	});

	it('start without inference rejects', async () => {
		await assert.rejects(
			() => new ArcDirector().addStockVerbs().start(),
			/no inference/,
		);
	});

	it('start twice is a no-op', async () => {
		const director = await directorOf().addAgent({
			id: 'Watcher',
			kit: KIT,
			identity: { name: 'Watcher', role: 'Pays attention.' },
		}).start();
		const again = await director.start();
		assert.equal(again, director);
		director.dispose();
	});

	it('addAgent after start wires a live mind', async () => {
		const director = await directorOf().start();
		director.addAgent({
			id: 'Guard',
			kit: KIT,
			identity: { name: 'Guard', role: 'Walks to EastGate.' },
			goals: [{ text: 'Go to EastGate', priority: 1 }],
		});
		assert.ok(director.agent('Guard'));
		director.tick(1, 1);
		await waitFor(() => !!director.agent('Guard')?.lastPlan);
		assert.equal(director.agent('Guard')!.lastPlan!.head.verb, 'go_to');
		director.removeAgent('Guard');
		assert.equal(director.agent('Guard'), undefined);
		director.dispose();
	});

	it('addVerb binds a named handler; onVerb is catch-all', async () => {
		const gave:string[] = [];
		const other:string[] = [];
		const director = await new ArcDirector<Ctx>()
			.withFakeInference((req) => {
				const text = JSON.stringify(req.messages);
				const give = /give/.test(text) === false;
				return {
					content: JSON.stringify({
						head: give
							? { verb: 'give', args: { item: 'Key', to: 'Player' } }
							: { verb: 'go_to', args: { name: 'EastGate' } },
					}),
					toolCalls: [],
				};
			})
			.withPriorityQueue({
				processInterval: 0,
				heartbeatStart: 0.01,
				heartbeatMin: 0.01,
				maxParallel: 1,
			})
			.addStockVerbs()
			.addVerb('give', { item: 'id', to: 'id' }, ({ args }) => {
				gave.push(String(args.item));
				return { ok: true, verb: 'give' };
			})
			.onVerb(({ verb }) => {
				other.push(verb);
				return { ok: true, verb };
			})
			.addSense('scene', {
				description: 'see',
				gather: (ctx) => ctx.paragraph,
			})
			.withContext((id) => ({ paragraph: scene(), id }))
			.addAgent({
				id: 'Giver',
				kit: { verbs: [...STOCK_VERBS, 'give'] },
				identity: { name: 'Giver', role: 'Gives the key.' },
				goals: [{ text: 'give the key', priority: 1 }],
			})
			.start();
		director.tick(1, 1);
		await waitFor(() => gave.length + other.length > 0);
		assert.ok(gave.length > 0 || other.includes('go_to'));
		director.dispose();
	});

	it('rank tie-breaks after score', async () => {
		const order:string[] = [];
		const director = await directorOf()
			.onVerb(({ agent, verb }) => {
				order.push(agent.id);
				return { ok: true, verb };
			})
			.addAgent({
				id: 'Low',
				rank: 0,
				kit: KIT,
				identity: { name: 'Low', role: 'Waits.' },
				goals: [{ text: 'Go to EastGate', priority: 1 }],
			})
			.addAgent({
				id: 'High',
				rank: 1,
				kit: KIT,
				identity: { name: 'High', role: 'Goes first.' },
				goals: [{ text: 'Go to EastGate', priority: 1 }],
			})
			.start();
		director.setMaxParallel(1);
		director.tick(1, 1);
		await waitFor(() => order.length > 0);
		assert.equal(order[0], 'High');
		director.dispose();
	});

	it('runLoop returns a stop function', async () => {
		const director = await directorOf().addAgent({
			id: 'Watcher',
			kit: KIT,
			identity: { name: 'Watcher', role: 'Pays attention.' },
			goals: [{ text: 'Go to EastGate', priority: 1 }],
		}).start();
		const stop = director.runLoop(50);
		await waitFor(() => !!director.agent('Watcher')?.lastPlan, 800);
		stop();
		director.dispose();
	});

	it('sets planIndex while enacting', async () => {
		const seen:number[] = [];
		const director = await new ArcDirector<Ctx>()
			.withFakeInference(() => ({
				content: JSON.stringify({
					head: { verb: 'go_to', args: { name: 'EastGate' } },
					then: {
						join: 'then',
						plan: { head: { verb: 'wait', args: { seconds: 1 } } },
					},
				}),
				toolCalls: [],
			}))
			.withPriorityQueue({
				processInterval: 0,
				heartbeatStart: 0.01,
				heartbeatMin: 0.01,
				maxParallel: 1,
			})
			.addStockVerbs()
			.onVerb((call) => {
				seen.push(call.agent.planIndex);
				return { ok: true, verb: call.verb };
			})
			.addSense('scene', {
				description: 'see',
				gather: (ctx) => ctx.paragraph,
			})
			.withContext((id) => ({ paragraph: scene(), id }))
			.addAgent({
				id: 'Walker',
				kit: KIT,
				identity: { name: 'Walker', role: 'Walks then waits.' },
				goals: [{ text: 'act', priority: 1 }],
			})
			.start();
		director.tick(1, 1);
		await waitFor(() => seen.length >= 2);
		assert.deepEqual(seen.slice(0, 2), [0, 1]);
		director.dispose();
	});

	it('addStockVerbs can register a stock subset', async () => {
		const director = await new ArcDirector<Ctx>()
			.withFakeInference(goToNamedInteractable())
			.addStockVerbs(...STOCK_MOVE_VERBS)
			.addStockVerbs('go_to', 'wait')
			.withContext((id) => ({ paragraph: scene(), id }))
			.addAgent({
				id: 'Guard',
				kit: { verbs: [...STOCK_MOVE_VERBS, 'wait'] },
				identity: { name: 'Guard', role: 'Walks.' },
			})
			.start();
		const verbs = director.agent('Guard')!.verbs;
		assert.ok(verbs.has('go_to'));
		assert.ok(verbs.has('follow'));
		assert.ok(verbs.has('wander'));
		assert.ok(verbs.has('wait'));
		assert.equal(verbs.has('pick_up'), false);
		assert.equal(verbs.has('think'), false);
		director.dispose();
	});

	it('removeVerbs drops catalog names', async () => {
		const director = await directorOf()
			.removeVerbs('wander', 'follow')
			.withDefaultKit({ verbs: ['go_to'] })
			.addAgent({
				id: 'Guard',
				kit: { verbs: ['go_to'] },
				identity: { name: 'Guard', role: 'Walks.' },
			})
			.start();
		const verbs = director.agent('Guard')!.verbs;
		assert.ok(verbs.has('go_to'));
		assert.equal(verbs.has('wander'), false);
		assert.equal(verbs.has('follow'), false);
		director.removeVerbs();
		assert.ok(verbs.has('go_to'));
		director.dispose();
	});

	it('withDefaultKit applies when addAgent omits kit', async () => {
		const director = await new ArcDirector<Ctx>()
			.withFakeInference(goToNamedInteractable())
			.addStockVerbs()
			.withDefaultKit({ verbs: ['go_to'] })
			.withContext((id) => ({ paragraph: scene(), id }))
			.addAgent({
				id: 'Guard',
				identity: { name: 'Guard', role: 'Walks.' },
			})
			.start();
		assert.deepEqual(
			director.agent('Guard')!.activeVerbs().list().map((v) => v.name),
			['go_to'],
		);
		director.dispose();
	});

	it('kit object and callback are fetched every tick', async () => {
		const kit = { verbs: ['go_to', 'wait'] };
		const director = await directorOf()
			.addAgent({
				id: 'Guard',
				identity: { name: 'Guard', role: 'Walks.' },
				kit,
			})
			.start();
		const agent = director.agent('Guard')!;
		director.tick(1, 1);
		assert.deepEqual(agent.activeVerbs().list().map((v) => v.name), ['go_to', 'wait']);
		kit.verbs = ['wait'];
		director.tick(1, 2);
		assert.deepEqual(agent.activeVerbs().list().map((v) => v.name), ['wait']);
		const denied = await agent.perform({ verb: 'go_to', args: { name: 'EastGate' } });
		assert.equal(denied.ok, false);
		assert.match(denied.reason ?? '', /not available/);
		agent.kit = () => ({ verbs: ['go_to'] });
		const ok = await agent.perform({ verb: 'go_to', args: { name: 'EastGate' } });
		assert.equal(ok.ok, true);
		director.dispose();
	});

	it('addSense after start mutates the shared catalog', async () => {
		const director = await directorOf()
			.addAgent({
				id: 'Guard',
				kit: KIT,
				identity: { name: 'Guard', role: 'Walks.' },
			})
			.start();
		const agent = director.agent('Guard')!;
		assert.ok(agent.senses.scene);
		director.removeSense('scene');
		assert.equal(agent.senses.scene, undefined);
		director.addSense('hall', {
			description: 'x',
			gather: () => 'a hall',
		});
		assert.equal(agent.senses.hall?.description, 'x');
		director.dispose();
	});

	it('addStockVerbs throws on a name that is not stock', () => {
		assert.throws(
			() => new ArcDirector().addStockVerbs('fly' as 'go_to'),
			/not a stock verb/,
		);
	});

	it('start throws when a kit names an unregistered verb', async () => {
		const director = directorOf().withDefaultKit({ verbs: ['fly'] });
		await assert.rejects(() => director.start(), /verb 'fly' is not registered/);
		director.dispose();
	});

	it('start throws when a kit names an unregistered tool', async () => {
		const director = directorOf()
			.withDefaultKit({ verbs: ['go_to'], tools: ['examine'] });
		await assert.rejects(() => director.start(), /tool 'examine' is not registered/);
		director.dispose();
	});

	it('start throws when a kit names an unregistered sense', async () => {
		const director = directorOf()
			.withDefaultKit({ verbs: ['go_to'], senses: ['bogus'] });
		await assert.rejects(() => director.start(), /sense 'bogus' is not registered/);
		director.dispose();
	});

	it('start throws when a kit names see_map without a map', async () => {
		const director = directorOf()
			.withDefaultKit({ verbs: ['go_to'], tools: ['see_map'] });
		await assert.rejects(() => director.start(), /tool 'see_map' is not registered/);
		director.dispose();
	});

	it('start({ ignoreMissing }) logs unknown names and continues', async () => {
		const logs:string[] = [];
		const director = await directorOf()
			.onLog((entry) => logs.push(entry.message))
			.withDefaultKit({ verbs: ['fly'], tools: ['examine'] })
			.addAgent({
				id: 'Guard',
				identity: { name: 'Guard', role: 'Walks.' },
			})
			.start({ ignoreMissing: true });
		assert.match(logs.join('\n'), /verb 'fly' is not registered/);
		assert.match(logs.join('\n'), /tool 'examine' is not registered/);
		assert.ok(director.ready);
		director.dispose();
	});

	it('addAgent after start throws on an unknown kit verb', async () => {
		const director = await directorOf().start();
		assert.throws(
			() => director.addAgent({
				id: 'Late',
				identity: { name: 'Late', role: 'Walks.' },
				kit: { verbs: ['nope'] },
			}),
			/verb 'nope' is not registered \(agent Late\)/,
		);
		director.dispose();
	});

	it('start accepts built-in recall and observe tools', async () => {
		const director = await directorOf()
			.withDefaultKit({ verbs: ['go_to'], tools: ['recall', 'observe'] })
			.addAgent({
				id: 'Guard',
				identity: { name: 'Guard', role: 'Walks.' },
			})
			.start();
		assert.ok(director.ready);
		director.dispose();
	});

	it('withSight gather matches formatSight', async () => {
		const sight = {
			self: { id: 'Captain', at: [11.5, 10.5], facing: [0, -1] as number[] },
			ambient: 'A damp stone hall of the abbey.',
			objects: [
				{ id: 'Alchemist', at: [11.5, 7.5], tags: ['agent', 'person'], interactable: true, interesting: 1 },
				{ id: 'Bitterroot', at: [11.5, -5], tags: ['item'], interactable: true, interesting: 1 },
				{ id: 'HiddenLoot', at: [12, 10], tags: ['item'] },
			],
		};
		const director = await new ArcDirector<Ctx>()
			.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 0.01, heartbeatMin: 0.01, maxParallel: 2 })
			.withFakeInference(goToNamedInteractable())
			.addStockVerbs()
			.withDefaultKit(KIT)
			.withSight({ look: () => sight })
			.withContext((id) => ({ paragraph: scene(), id }))
			.addAgent({
				id: 'Captain',
				kit: { verbs: ['go_to'], senses: ['sight'] },
				identity: { name: 'Captain', role: 'Pays attention.' },
			})
			.start();
		const agent = director.agent('Captain')!;
		assert.equal(agent.senses.sight.gather({ paragraph: scene(), id: 'Captain' }), formatSight(sight));
		director.dispose();
	});

	it('withLineOfSight drops occluded bodies from sight', async () => {
		const sight = {
			self: { id: 'Captain', at: [0, 0] },
			ambient: 'A damp stone hall of the abbey.',
			objects: [
				{ id: 'Alchemist', at: [0, 3], tags: ['agent', 'person'], interactable: true },
				{ id: 'HiddenLoot', at: [1, 0], tags: ['item'] },
			],
		};
		const director = await new ArcDirector<Ctx>()
			.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 0.01, heartbeatMin: 0.01, maxParallel: 2 })
			.withFakeInference(goToNamedInteractable())
			.addStockVerbs()
			.withDefaultKit(KIT)
			.withSight({ look: () => sight })
			.withLineOfSight((_a, b) => b !== 'HiddenLoot')
			.withContext((id) => ({ paragraph: scene(), id }))
			.addAgent({
				id: 'Captain',
				kit: { verbs: ['go_to'], senses: ['sight'] },
				identity: { name: 'Captain', role: 'Pays attention.' },
			})
			.start();
		const text = director.agent('Captain')!.senses.sight.gather({ paragraph: scene(), id: 'Captain' }) as string;
		assert.equal(text.includes('Alchemist'), true);
		assert.equal(text.includes('HiddenLoot'), false);
		director.dispose();
	});

	it('withInventory gather matches formatInventory', async () => {
		const bag = {
			worn: {
				head: 'Helmet',
				torso: 'Tunic',
				feet: 'Boots',
				back: "Traveler'sPack",
				'hands.left.held': 'Torch',
			},
			purse: 22,
			pockets: ['CottageKey'],
			pack: { name: "Traveler'sPack", items: ['GoldCoin', 'ChestKey'] },
		};
		const director = await new ArcDirector<Ctx>()
			.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 0.01, heartbeatMin: 0.01, maxParallel: 2 })
			.withFakeInference(goToNamedInteractable())
			.addStockVerbs()
			.withDefaultKit(KIT)
			.withInventory(() => bag)
			.withContext((id) => ({ paragraph: scene(), id }))
			.addAgent({
				id: 'Captain',
				kit: { verbs: ['go_to'], senses: ['carrying'] },
				identity: { name: 'Captain', role: 'Pays attention.' },
			})
			.start();
		assert.equal(
			director.agent('Captain')!.senses.carrying.gather({ paragraph: scene(), id: 'Captain' }),
			formatInventory(bag),
		);
		director.dispose();
	});

	it('injects hasHeard from pending HeardSpeech, not host kernels', async () => {
		const director = await new ArcDirector<Ctx>()
			.withPriorityQueue({
				processInterval: 0,
				watchInterval: 0,
				heartbeatStart: 0.01,
				heartbeatMin: 0.01,
				maxParallel: 2,
			})
			.withFakeInference(goToNamedInteractable())
			.addStockVerbs()
			.withDefaultKit(KIT)
			.withContext((id) => ({ paragraph: scene(), id }))
			.withKernels(() => ({
				me: dummyEntity('Guard'),
				others: [],
				items: [],
				hasHeard: true,
			}))
			.addAgent({
				id: 'Guard',
				kit: KIT,
				identity: { name: 'Guard', role: 'Listens.' },
				goals: [{ text: 'Go to EastGate', priority: 1 }],
				skipHeartbeat: true,
				watches: { heard: 'hasHeard' },
			})
			.start();
		director.tick(1, 1);
		assert.equal(director.agent('Guard')?.lastPlan, undefined);
		director.agent('Guard')!.pushEvent({
			kind: 'HeardSpeech',
			text: 'hey',
			tags: ['speech'],
			major: true,
			at: 1,
		});
		director.tick(1, 2);
		await waitFor(() => !!director.agent('Guard')?.lastPlan);
		director.dispose();
	});

	it('does not start a think while another generation is still in flight', async () => {
		const { director, chats, gates } = await gatedTrio({});
		const queue = director.mindQueue()!;
		director.tick(1, 1);
		await waitFor(() => chats.length === 2);
		assert.equal(queue.inFlight, 2);
		assert.equal(chats.includes('Charlie'), false);
		gates.shift()!();
		await waitFor(() => queue.inFlight === 1);
		director.tick(1, 2);
		await sleep(20);
		assert.equal(chats.length, 2);
		assert.equal(queue.inFlight, 1);
		for (const release of [...gates]) {
			release();
		}
		await waitFor(() => queue.inFlight === 0);
		queue.enqueueMajor('Charlie');
		director.tick(1, 3);
		await waitFor(() => chats.includes('Charlie'));
		director.dispose();
	});

	it('fills a free slot immediately when batchThinks is false', async () => {
		const { director, chats, gates } = await gatedTrio({ batchThinks: false });
		const queue = director.mindQueue()!;
		director.tick(1, 1);
		await waitFor(() => chats.length === 2);
		assert.equal(chats.includes('Charlie'), false);
		gates.shift()!();
		await waitFor(() => queue.inFlight === 1);
		director.tick(1, 2);
		await waitFor(() => chats.includes('Charlie'));
		assert.equal(chats.length, 3);
		for (const release of [...gates]) {
			release();
		}
		await waitFor(() => queue.inFlight === 0);
		director.dispose();
	});

	it('starts a waiting think after batchWait even if someone is still generating', async () => {
		const { director, chats, gates } = await gatedTrio({ batchThinks: true, batchWait: 20 });
		const queue = director.mindQueue()!;
		director.tick(1, 1);
		await waitFor(() => chats.length === 2);
		gates.shift()!();
		await waitFor(() => queue.inFlight === 1);
		director.tick(1, 20);
		await sleep(20);
		assert.equal(chats.includes('Charlie'), false);
		director.tick(1, 21);
		await waitFor(() => chats.includes('Charlie'));
		assert.equal(queue.inFlight, 2);
		for (const release of [...gates]) {
			release();
		}
		await waitFor(() => queue.inFlight === 0);
		director.dispose();
	});
});
