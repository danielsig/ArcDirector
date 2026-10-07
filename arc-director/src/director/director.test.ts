import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STOCK_MOVE_VERBS, STOCK_VERBS } from '../arc/stock-verbs.js';
import { goToNamedInteractable } from '../inference/fake.js';
import { dummyEntity } from '../expr/natives.js';
import { SampleCache } from '../expr/types.js';
import { formatSight } from '../perception/sight.js';
import { formatInventory } from '../perception/formatInventory.js';
import { parseArc } from '../arc/parse.js';
import { ArcDirector } from './director.js';
import type { VerbCall } from './types.js';
import { OPEN_WORLD } from '../testing/world.js';

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
		.addCharacter({
			id: 'Able',
			mind: { skipHeartbeat: true },
			kit: KIT,
			identity: { role: 'Goes.' },
			goals: [{ text: 'Wait', priority: 1 }],
		})
		.addCharacter({
			id: 'Baker',
			mind: { skipHeartbeat: true },
			kit: KIT,
			identity: { role: 'Goes.' },
			goals: [{ text: 'Wait', priority: 1 }],
		})
		.addCharacter({
			id: 'Charlie',
			mind: { skipHeartbeat: true },
			kit: KIT,
			identity: { role: 'Goes.' },
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
			return { ok: true, verb: call.verb, reason: String(call.args.target ?? '') };
		})
		.addSense('scene', {
			description: 'What you can see. Names only.',
			gather: (ctx) => ctx.paragraph,
		})
		.withContext((id) => ({ paragraph: scene(), id }));
}

describe('ArcDirector', () => {
	it('a host-driven character runs given arcs but never calls the model', async () => {
		let chats = 0;
		const calls:VerbCall<Ctx>[] = [];
		const director = await new ArcDirector<Ctx>()
			.withPriorityQueue({
				processInterval: 0,
				watchInterval: 100,
				heartbeatStart: 0.1,
				heartbeatMin: 0.1,
				maxParallel: 1,
			})
			.withFakeInference(() => {
				chats += 1;
				return { content: 'wait()', toolCalls: [] };
			})
			.withArcText(true)
			.addStockVerbs()
			.withDefaultKit({ verbs: [...STOCK_VERBS] })
			.onVerb((call) => {
				calls.push(call);
				return { ok: true, verb: call.verb };
			})
			.addSense('scene', {
				description: 'see',
				gather: (ctx) => ctx.paragraph,
			})
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({ id: 'Player' })
			.start();
		const player = director.character('Player');
		assert.ok(player);
		assert.equal(player.mind, null);
		assert.deepEqual(director.characters().map((a) => a.id), ['Player']);
		assert.deepEqual(director.minds(), []);
		for (let t = 1; t <= 4; t++) {
			director.tick(1, t);
		}
		await sleep(30);
		for (const verb of ['think(about=x)', 'remember(content=x)', 'set_goal(goal=x)']) {
			assert.throws(() => parseArc(verb, player.activeVerbs()));
		}
		const result = await player.enact(parseArc('go_to(EastGate)', player.activeVerbs()));
		assert.equal(result.ok, true);
		assert.equal(calls.some((c) => c.verb === 'go_to' && c.character === player), true);
		assert.equal(chats, 0);
		director.dispose();
	});

	it('thinks again on the next tick after go_to, wander, or sell', async () => {
		const lines = ['go_to(EastGate)', 'wander()', 'sell(item=Loaf, to=Baker)'];
		for (const line of lines) {
			let chats = 0;
			const director = await new ArcDirector<Ctx>()
				.withPriorityQueue({
					processInterval: 0,
					watchInterval: 100,
					heartbeatStart: 100,
					heartbeatMin: 100,
					maxParallel: 1,
				})
				.withFakeInference(() => {
					chats += 1;
					return { content: line, toolCalls: [] };
				})
				.withArcText(true)
				.addStockVerbs()
				.withDefaultKit({ verbs: [...STOCK_VERBS, 'sell'] })
				.onVerb((call) => ({ ok: true, verb: call.verb }))
				.addSense('scene', {
					description: 'see',
					gather: (ctx) => ctx.paragraph,
				})
				.withContext((id) => ({ paragraph: scene(), id }))
				.addCharacter({
					id: 'Npc',
					mind: { skipHeartbeat: true },
					kit: { verbs: [...STOCK_VERBS, 'sell'] },
					identity: { role: 'Moves.' },
				})
				.start();
			director.mindQueue()!.enqueueMajor('Npc');
			director.tick(1, 1);
			await waitFor(() => chats === 1 && director.character('Npc')?.lastResult?.ok === true);
			director.tick(1, 2);
			await waitFor(() => chats === 2);
			director.dispose();
		}
	});

	it('thinks again, told why, after a reply that never became an arc', async () => {
		const users:string[] = [];
		const director = await new ArcDirector<Ctx>()
			.withPriorityQueue({ processInterval: 0, watchInterval: 100, heartbeatStart: 100, heartbeatMin: 100, maxParallel: 1 })
			.withFakeInference((req) => {
				const user = String(req.messages[1]?.content);
				users.push(user);
				return { content: user.includes('not a valid Arc: ') ? 'wait()' : 'say(text=Hi) to Guard', toolCalls: [] };
			})
			.withArcText(true)
			.addStockVerbs()
			.withDefaultKit({ verbs: [...STOCK_VERBS] })
			.onVerb((call) => ({ ok: true, verb: call.verb }))
			.addSense('scene', { description: 'see', gather: (ctx) => ctx.paragraph })
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({ id: 'Npc', mind: { skipHeartbeat: true }, identity: { role: 'Talks.' } })
			.start();
		director.mindQueue()!.enqueueMajor('Npc');
		director.tick(1, 1);
		await waitFor(() => director.character('Npc')?.mind?.lastResult?.verb === 'think');
		let t = 2;
		await waitFor(() => {
			director.tick(1, t++);
			return director.character('Npc')?.mind?.lastResult?.ok === true;
		});
		assert.match(users[users.length - 1], /think failed — your reply was not a valid Arc: to is outside the parentheses/);
		director.dispose();
	});

	it('retries a stalled think once, not forever', async () => {
		let thinks = 0;
		const director = await new ArcDirector<Ctx>()
			.withPriorityQueue({ processInterval: 0, watchInterval: 100, heartbeatStart: 100, heartbeatMin: 100, maxParallel: 1 })
			.withFakeInference((req) => {
				thinks += req.messages.length === 2 ? 1 : 0;
				return { content: 'say(text=Hi) to Guard', toolCalls: [] };
			})
			.withArcText(true)
			.addStockVerbs()
			.withDefaultKit({ verbs: [...STOCK_VERBS] })
			.onVerb((call) => ({ ok: true, verb: call.verb }))
			.addSense('scene', { description: 'see', gather: (ctx) => ctx.paragraph })
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({ id: 'Npc', mind: { skipHeartbeat: true }, identity: { role: 'Talks.' } })
			.start();
		director.mindQueue()!.enqueueMajor('Npc');
		for (let t = 1; t <= 10; t++) {
			director.tick(1, t);
			await sleep(20);
		}
		assert.equal(thinks, 2);
		director.dispose();
	});

	it('chains any order, start, tick with FakeProvider', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await directorOf(calls)
			.addCharacter({
				id: 'Watcher',
				mind: {},
				kit: KIT,
				identity: { role: 'Pays attention.', traits: ['alert'] },
				goals: [{ text: 'Go to EastGate', priority: 1 }],
			})
			.start();
		director.tick(1, 1);
		await waitFor(() => !!director.character('Watcher')?.mind!.lastArc);
		const arc = director.character('Watcher')!.mind!.lastArc!;
		assert.equal(arc.head.verb, 'go_to');
		assert.equal(arc.head.args.target, 'EastGate');
		await waitFor(() => calls.length > 0);
		assert.equal(calls[0].verb, 'go_to');
		assert.equal(calls[0].character.id, 'Watcher');
		assert.equal(calls[0].ctx.id, 'Watcher');
		director.dispose();
	});

	it('logs reasoning alongside the arc', async () => {
		const logs:string[] = [];
		const arc = JSON.stringify({ head: { verb: 'wait', args: {} } });
		const director = await new ArcDirector<Ctx>()
			.withPriorityQueue({
				processInterval: 0,
				watchInterval: 0,
				heartbeatStart: 0.01,
				heartbeatMin: 0.01,
				maxParallel: 2,
			})
			.withFakeInference(() => ({
				content: arc,
				reasoning: 'Blade is close; loop slash, do not go_to.',
				toolCalls: [],
			}))
			.addStockVerbs()
			.withDefaultKit(KIT)
			.onVerb(() => ({ ok: true, verb: 'wait' }))
			.onLog((entry) => logs.push(entry.message))
			.addSense('scene', {
				description: 'What you can see. Names only.',
				gather: (ctx) => ctx.paragraph,
			})
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({
				id: 'Dawn',
				mind: {},
				kit: KIT,
				identity: { role: 'Fights.' },
				goals: [{ text: 'Win.', priority: 1 }],
			})
			.start();
		director.tick(1, 1);
		await waitFor(() => logs.some((m) => m.includes('(thinking)')));
		const prompt = logs.find((m) => m.startsWith('prompt\n')) ?? '';
		assert.match(prompt, /"role":"system"/);
		assert.match(prompt, /You are Dawn/);
		assert.ok(
			logs.findIndex((m) => m.startsWith('prompt\n'))
			< logs.findIndex((m) => m.includes('(thinking)')),
		);
		const hit = logs.find((m) => m.includes('(thinking)')) ?? '';
		assert.match(hit, /Blade is close; loop slash, do not go_to\./);
		assert.match(hit, /"verb":"wait"/);
		director.dispose();
	});

	it('throws with* after start', async () => {
		const director = await directorOf().addCharacter({
			id: 'Watcher',
			mind: {},
			kit: KIT,
			identity: { role: 'Pays attention.' },
		}).start();
		assert.throws(() => director.withFakeInference(), /already started/);
		assert.throws(() => director.withPriorityQueue(), /already started/);
		assert.throws(() => director.withContext(() => ({ paragraph: '', id: '' })), /already started/);
		assert.throws(() => director.withDefaultKit({ verbs: [] }), /already started/);
		assert.throws(() => director.withSight({ look: () => ({ self: { id: 'Watcher', point: [0, 0] }, objects: [] }) }), /already started/);
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
		const director = await directorOf().addCharacter({
			id: 'Watcher',
			mind: {},
			kit: KIT,
			identity: { role: 'Pays attention.' },
		}).start();
		const again = await director.start();
		assert.equal(again, director);
		director.dispose();
	});

	it('addAgent after start wires a live mind', async () => {
		const director = await directorOf().start();
		director.addCharacter({
			id: 'Guard',
			mind: {},
			kit: KIT,
			identity: { role: 'Walks to EastGate.' },
			goals: [{ text: 'Go to EastGate', priority: 1 }],
		});
		assert.ok(director.character('Guard'));
		director.tick(1, 1);
		await waitFor(() => !!director.character('Guard')?.mind!.lastArc);
		assert.equal(director.character('Guard')!.mind!.lastArc!.head.verb, 'go_to');
		director.removeCharacter('Guard');
		assert.equal(director.character('Guard'), undefined);
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
							: { verb: 'go_to', args: { target: 'EastGate' } },
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
			.addVerb('give', {
				args: { item: 'id', to: 'id' },
				handler: ({ args }) => {
					gave.push(String(args.item));
					return { ok: true, verb: 'give' };
				},
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
			.addCharacter({
				id: 'Giver',
				mind: {},
				kit: { verbs: [...STOCK_VERBS, 'give'] },
				identity: { role: 'Gives the key.' },
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
			.onVerb(({ character, verb }) => {
				order.push(character.id);
				return { ok: true, verb };
			})
			.addCharacter({
				id: 'Low',
				mind: { rank: 0 },
				kit: KIT,
				identity: { role: 'Waits.' },
				goals: [{ text: 'Go to EastGate', priority: 1 }],
			})
			.addCharacter({
				id: 'High',
				mind: { rank: 1 },
				kit: KIT,
				identity: { role: 'Goes first.' },
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
		const director = await directorOf().addCharacter({
			id: 'Watcher',
			mind: {},
			kit: KIT,
			identity: { role: 'Pays attention.' },
			goals: [{ text: 'Go to EastGate', priority: 1 }],
		}).start();
		const stop = director.runLoop(50);
		await waitFor(() => !!director.character('Watcher')?.mind!.lastArc, 800);
		stop();
		director.dispose();
	});

	it('sets verbIndex while enacting', async () => {
		const seen:number[] = [];
		const director = await new ArcDirector<Ctx>()
			.withFakeInference(() => ({
				content: JSON.stringify({
					head: { verb: 'go_to', args: { target: 'EastGate' } },
					then: {
						join: 'then',
						arc: { head: { verb: 'examine', args: { target: 'EastGate' } } },
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
				seen.push(call.character.verbIndex);
				return { ok: true, verb: call.verb };
			})
			.addSense('scene', {
				description: 'see',
				gather: (ctx) => ctx.paragraph,
			})
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({
				id: 'Walker',
				mind: {},
				kit: KIT,
				identity: { role: 'Walks then waits.' },
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
			.withWorld(OPEN_WORLD)
			.withFakeInference(goToNamedInteractable())
			.addStockVerbs(...STOCK_MOVE_VERBS)
			.addStockVerbs('go_to', 'wait')
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({
				id: 'Guard',
				mind: {},
				kit: { verbs: [...STOCK_MOVE_VERBS, 'wait'] },
				identity: { role: 'Walks.' },
			})
			.start();
		const verbs = director.character('Guard')!.verbs;
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
			.addCharacter({
				id: 'Guard',
				mind: {},
				kit: { verbs: ['go_to'] },
				identity: { role: 'Walks.' },
			})
			.start();
		const verbs = director.character('Guard')!.verbs;
		assert.ok(verbs.has('go_to'));
		assert.equal(verbs.has('wander'), false);
		assert.equal(verbs.has('follow'), false);
		director.removeVerbs();
		assert.ok(verbs.has('go_to'));
		director.dispose();
	});

	it('refuses a character with no kit, or with a kit of no verbs', async () => {
		const build = (kit?:{ verbs:string[] }) => new ArcDirector<Ctx>()
			.withFakeInference(goToNamedInteractable())
			.addStockVerbs()
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({ id: 'Guard', kit })
			.start();
		await assert.rejects(build(), /'Guard' has no kit/);
		await assert.rejects(build({ verbs: [] }), /'Guard' has a kit with no verbs/);
	});

	it('withDefaultKit applies when a spec omits its kit', async () => {
		const director = await new ArcDirector<Ctx>()
			.withWorld(OPEN_WORLD)
			.withFakeInference(goToNamedInteractable())
			.addStockVerbs()
			.withDefaultKit({ verbs: ['go_to'] })
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({
				id: 'Guard',
				mind: {},
				identity: { role: 'Walks.' },
			})
			.start();
		assert.deepEqual(
			director.character('Guard')!.activeVerbs().list().map((v) => v.name),
			['go_to'],
		);
		director.dispose();
	});

	it('kit object and callback are fetched every tick', async () => {
		const kit = { verbs: ['go_to', 'wait'] };
		const director = await directorOf()
			.addCharacter({
				id: 'Guard',
				mind: {},
				identity: { role: 'Walks.' },
				kit,
			})
			.start();
		const agent = director.character('Guard')!;
		director.tick(1, 1);
		assert.deepEqual(agent.activeVerbs().list().map((v) => v.name), ['go_to', 'wait']);
		kit.verbs = ['wait'];
		director.tick(1, 2);
		assert.deepEqual(agent.activeVerbs().list().map((v) => v.name), ['wait']);
		const denied = await agent.perform({ verb: 'go_to', args: { target: 'EastGate' } });
		assert.equal(denied.ok, false);
		assert.match(denied.reason ?? '', /not available/);
		agent.kit = () => ({ verbs: ['go_to'] });
		const ok = await agent.perform({ verb: 'go_to', args: { target: 'EastGate' } });
		assert.equal(ok.ok, true);
		director.dispose();
	});

	it('addSense after start mutates the shared catalog', async () => {
		const director = await directorOf()
			.addCharacter({
				id: 'Guard',
				mind: {},
				kit: KIT,
				identity: { role: 'Walks.' },
			})
			.start();
		const agent = director.character('Guard')!;
		assert.ok(agent.mind!.senses.scene);
		director.removeSense('scene');
		assert.equal(agent.mind!.senses.scene, undefined);
		director.addSense('hall', {
			description: 'x',
			gather: () => 'a hall',
		});
		assert.equal(agent.mind!.senses.hall?.description, 'x');
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

	it('start throws when a kit names grep_world_encyclopedia without pages', async () => {
		const director = directorOf()
			.withDefaultKit({ verbs: ['go_to'], tools: ['grep_world_encyclopedia'] });
		await assert.rejects(() => director.start(), /tool 'grep_world_encyclopedia' is not registered/);
		director.dispose();
	});

	it('start({ ignoreMissing }) logs unknown names and continues', async () => {
		const logs:string[] = [];
		const director = await directorOf()
			.onLog((entry) => logs.push(entry.message))
			.withDefaultKit({ verbs: ['fly'], tools: ['examine'] })
			.addCharacter({
				id: 'Guard',
				mind: {},
				identity: { role: 'Walks.' },
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
			() => director.addCharacter({
				id: 'Late',
				mind: {},
				identity: { role: 'Walks.' },
				kit: { verbs: ['nope'] },
			}),
			/verb 'nope' is not registered \(Late\)/,
		);
		director.dispose();
	});

	it('start accepts built-in recall and observe tools', async () => {
		const director = await directorOf()
			.withDefaultKit({ verbs: ['go_to'], tools: ['recall', 'observe'] })
			.addCharacter({
				id: 'Guard',
				mind: {},
				identity: { role: 'Walks.' },
			})
			.start();
		assert.ok(director.ready);
		director.dispose();
	});

	it('start accepts grep_world_encyclopedia when pages are set', async () => {
		const director = await directorOf()
			.withEncyclopedia([{ name: 'Tree', aliases: ['trees'], text: 'Landmark type.' }])
			.withDefaultKit({ verbs: ['go_to'], tools: ['grep_world_encyclopedia'] })
			.addCharacter({
				id: 'Guard',
				mind: {},
				identity: { role: 'Walks.' },
			})
			.start();
		assert.ok(director.ready);
		director.dispose();
	});

	it('withSight gather matches formatSight', async () => {
		const sight = {
			self: { id: 'Captain', point: [11.5, 10.5], facing: [0, -1] as number[] },
			ambient: 'A damp stone hall of the dungeon.',
			objects: [
				{ id: 'Alchemist', point: [11.5, 7.5], tags: ['agent', 'person'], interactable: true, interesting: 1 },
				{ id: 'Bitterroot', point: [11.5, -5], tags: ['item'], interactable: true, interesting: 1 },
				{ id: 'HiddenLoot', point: [12, 10], tags: ['item'] },
			],
		};
		const director = await new ArcDirector<Ctx>()
			.withWorld(OPEN_WORLD)
			.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 0.01, heartbeatMin: 0.01, maxParallel: 2 })
			.withFakeInference(goToNamedInteractable())
			.addStockVerbs()
			.withDefaultKit(KIT)
			.withSight({ look: () => sight })
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({
				id: 'Captain',
				mind: {},
				kit: { verbs: ['go_to'], senses: ['sight'] },
				identity: { role: 'Pays attention.' },
			})
			.start();
		const agent = director.character('Captain')!;
		assert.equal(agent.mind!.senses.sight.gather({ paragraph: scene(), id: 'Captain' }), formatSight(sight));
		director.dispose();
	});

	it('withSight unitName is passed to formatSight', async () => {
		const sight = {
			self: { id: 'Captain', point: [0, 0], facing: [0, -1] as number[] },
			objects: [
				{ id: 'Alchemist', point: [-4, 0], tags: ['agent', 'person'], interactable: true },
			],
		};
		const director = await new ArcDirector<Ctx>()
			.withWorld(OPEN_WORLD)
			.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 0.01, heartbeatMin: 0.01, maxParallel: 2 })
			.withFakeInference(goToNamedInteractable())
			.addStockVerbs()
			.withDefaultKit(KIT)
			.withSight({ look: () => sight, unitName: 'm' })
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({
				id: 'Captain',
				mind: {},
				kit: { verbs: ['go_to'], senses: ['sight'] },
				identity: { role: 'Pays attention.' },
			})
			.start();
		const agent = director.character('Captain')!;
		assert.equal(
			agent.mind!.senses.sight.gather({ paragraph: scene(), id: 'Captain' }),
			formatSight(sight, { unitName: 'm' }),
		);
		assert.match(agent.mind!.senses.sight.description, /distances in m/);
		director.dispose();
	});

	it('withLineOfSight drops what is occluded from sight', async () => {
		const sight = {
			self: { id: 'Captain', point: [0, 0] },
			ambient: 'A damp stone hall of the dungeon.',
			objects: [
				{ id: 'Alchemist', point: [0, 3], tags: ['agent', 'person'], interactable: true },
				{ id: 'HiddenLoot', point: [1, 0], tags: ['item'] },
			],
		};
		const director = await new ArcDirector<Ctx>()
			.withWorld(OPEN_WORLD)
			.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 0.01, heartbeatMin: 0.01, maxParallel: 2 })
			.withFakeInference(goToNamedInteractable())
			.addStockVerbs()
			.withDefaultKit(KIT)
			.withSight({ look: () => sight })
			.withLineOfSight((a, b) => b !== 'HiddenLoot')
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({
				id: 'Captain',
				mind: {},
				kit: { verbs: ['go_to'], senses: ['sight'] },
				identity: { role: 'Pays attention.' },
			})
			.start();
		const text = director.character('Captain')!.mind!.senses.sight.gather({ paragraph: scene(), id: 'Captain' }) as string;
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
			.withWorld(OPEN_WORLD)
			.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 0.01, heartbeatMin: 0.01, maxParallel: 2 })
			.withFakeInference(goToNamedInteractable())
			.addStockVerbs()
			.withDefaultKit(KIT)
			.withInventory(() => bag)
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({
				id: 'Captain',
				mind: {},
				kit: { verbs: ['go_to'], senses: ['carrying'] },
				identity: { role: 'Pays attention.' },
			})
			.start();
		assert.equal(
			director.character('Captain')!.mind!.senses.carrying.gather({ paragraph: scene(), id: 'Captain' }),
			formatInventory(bag),
		);
		director.dispose();
	});

	it('injects hasHeard from pending HeardSpeech, not host kernels', async () => {
		const director = await new ArcDirector<Ctx>()
			.withWorld(OPEN_WORLD)
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
			.addCharacter({
				id: 'Guard',
				mind: { skipHeartbeat: true },
				kit: KIT,
				identity: { role: 'Listens.' },
				goals: [{ text: 'Go to EastGate', priority: 1 }],
				watches: { heard: 'hasHeard' },
			})
			.start();
		director.tick(1, 1);
		assert.equal(director.character('Guard')?.mind!.lastArc, undefined);
		director.character('Guard')!.mind!.pushEvent({
			kind: 'HeardSpeech',
			text: 'hey',
			tags: ['speech'],
			major: true,
			timestamp: 1,
		});
		director.tick(1, 2);
		await waitFor(() => !!director.character('Guard')?.mind!.lastArc);
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

	it('solo pinned law runs with no live arc', async () => {
		const seen:string[] = [];
		const director = await new ArcDirector<Ctx>()
			.withFakeInference(() => ({
				content: JSON.stringify({ head: { verb: 'wait', args: {} } }),
				toolCalls: [],
			}))
			.withPriorityQueue({
				processInterval: 0,
				heartbeatStart: 100,
				heartbeatMin: 100,
				maxParallel: 1,
			})
			.addStockVerbs()
			.withDefaultKit(KIT)
			.withKernels(() => ({
				me: dummyEntity('BridgeKeeper'),
				others: [],
				items: [],
				cache: new SampleCache(),
			}))
			.onVerb((call) => {
				seen.push(call.verb);
				return { ok: true, verb: call.verb };
			})
			.addSense('scene', {
				description: 'see',
				gather: (ctx) => ctx.paragraph,
			})
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({
				id: 'BridgeKeeper',
				mind: { skipHeartbeat: true },
				kit: KIT,
				identity: { role: 'Works the sluice.' },
				laws: [{
					name: 'sluice',
					watch: '1 > 0',
					arc: 'go_to(EastGate)',
					pinned: true,
				}],
			})
			.start();
		director.tick(1, 1);
		await waitFor(() => seen.includes('go_to'));
		director.dispose();
	});
});

describe('restoreCast', () => {
	const keeper = () => ({
		id: 'BridgeKeeper',
		mind: { skipHeartbeat: true },
		kit: KIT,
		identity: { traits: ['stubborn'] },
		goals: [{ text: 'Lower BridgeLever when paid.', priority: 2 }],
		laws: [{ name: 'sluice', watch: '1 > 2', arc: 'go_to(EastGate)', pinned: true }],
	});
	const director = () => new ArcDirector<Ctx>()
		.withWorld(OPEN_WORLD)
		.withFakeInference(() => WAIT_REPLY)
		.addStockVerbs()
		.withContext((id) => ({ paragraph: scene(), id }))
		.addCharacter(keeper());

	it('keeps agents restored before start, and a solo agent with laws stays solo', async () => {
		const first = await director().start();
		const was = first.character('BridgeKeeper')!;
		was.persona.goals = [{ text: 'Rest. The bridge is down.', priority: 1 }];
		await was.mind!.remember('Forager paid the bridge fee.', ['Forager'], 1);
		const saved = JSON.parse(JSON.stringify(first.exportCast()));
		first.dispose();

		const next = director();
		next.restoreCast(saved);
		await next.start();
		const agent = next.character('BridgeKeeper')!;
		assert.equal(agent.collective, null);
		assert.deepEqual(agent.persona.goals, [{ text: 'Rest. The bridge is down.', priority: 1 }]);
		assert.ok(agent.persona.memory.all().some((m) => m.text === 'Forager paid the bridge fee.'));
		assert.deepEqual(agent.laws.map((l) => l.name), ['sluice']);
		next.dispose();
	});
});

describe('withNames', () => {
	it('renames sight per agent and hands the host real ids', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const sight = {
			self: { id: 'Captain', point: [0, 0] },
			objects: [
				{ id: 'Nyx', point: [0, 3], tags: ['agent', 'person', 'enemy'], interactable: true },
				{ id: 'Ash', point: [0, 5], tags: ['agent', 'person', 'enemy'], interactable: true },
				{ id: 'Brune', point: [2, 0], tags: ['agent', 'person'], interactable: true },
			],
		};
		const director = await new ArcDirector<Ctx>()
			.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 0.01, heartbeatMin: 0.01, maxParallel: 2 })
			.withFakeInference(() => ({ content: 'go_to(Stranger2)', toolCalls: [] }))
			.withArcText(true)
			.addStockVerbs()
			.onVerb((call) => {
				calls.push(call);
				return { ok: true, verb: call.verb };
			})
			.withSight({ look: () => sight })
			.withNames({
				seen: (observer, target) => (
					observer.ctx?.id === 'Captain' && target.tags?.includes('enemy') ? 'Stranger' : target.id
				),
			})
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({
				id: 'Captain',
				mind: {},
				kit: { verbs: ['go_to'], senses: ['sight'] },
				identity: { role: 'Pays attention.' },
			})
			.start();
		const text = director.character('Captain')!.mind!.senses.sight.gather({ paragraph: scene(), id: 'Captain' }) as string;
		assert.match(text, /Stranger /);
		assert.match(text, /Stranger2 /);
		assert.match(text, /Brune /);
		assert.equal(text.includes('Nyx') || text.includes('Ash'), false);
		assert.equal(director.seen('Captain', { id: 'Ash', tags: ['enemy'] }), 'Stranger2');
		director.mindQueue()!.enqueueMajor('Captain');
		director.tick(1, 1);
		await waitFor(() => calls.length > 0);
		assert.equal(calls[0]?.args.target, 'Ash');
		director.dispose();
	});

	it('stores a law in ids, runs it on the character, and shows it in the mind\'s names', async () => {
		const examined:unknown[] = [];
		const prompts:string[] = [];
		const law = 'law(watch=some(EnemyWitch2) && some(others.filter("EnemyWitch2")), arc=examine(EnemyWitch2), name=flee)';
		const director = await new ArcDirector<Ctx>()
			.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 100, heartbeatMin: 100, maxParallel: 1 })
			.withFakeInference((req) => {
				prompts.push(String(req.messages.at(-1)?.content ?? ''));
				return { content: prompts.length === 1 ? law : 'wait(seconds=5)', toolCalls: [] };
			})
			.withArcText(true)
			.addStockVerbs()
			.withKernels((ctx) => ({
				me: dummyEntity(ctx.id, { tags: ['agent'] }),
				others: [dummyEntity('Ash', { tags: ['enemy'] }), dummyEntity('Nyx', { tags: ['enemy'] })],
				items: [],
			}))
			.withNames({ seen: (_observer, target) => (target.tags?.includes('enemy') ? 'EnemyWitch' : target.id) })
			.onVerb((call) => {
				if (call.verb === 'examine') {
					examined.push(call.args.target);
				}
				return { ok: true, verb: call.verb };
			})
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({ id: 'Captain', mind: {}, kit: { verbs: ['law', 'examine', 'wait'] }, identity: { role: 'Watches.' } })
			.start();
		const captain = director.character('Captain')!;
		director.mindQueue()!.enqueueMajor('Captain');
		for (let t = 1; t < 20 && examined.length === 0; t++) {
			director.tick(1, t);
			await sleep(10);
		}
		assert.equal(captain.laws[0]?.watch, 'some(Nyx) && some(others.filter("Nyx"))');
		assert.equal(examined[0], 'Nyx');
		director.mindQueue()!.enqueueMajor('Captain');
		for (let t = 20; t < 40 && prompts.length < 2; t++) {
			director.tick(1, t);
			await sleep(10);
		}
		assert.match(prompts[1] ?? '', /- flee: when some\(EnemyWitch2\) && some\(others\.filter\("EnemyWitch2"\)\), run examine\(.*EnemyWitch2\)/);
		director.dispose();
	});
});

describe('host verbs', () => {
	it('hands handlers real ids from expressions, gates steps, and runs wait itself', async () => {
		const went:unknown[] = [];
		const director = await new ArcDirector<Ctx>()
			.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 100, heartbeatMin: 100, maxParallel: 1 })
			.withFakeInference(() => ({
				content: 'go_to(others.filter("enemy")) ; wait(seconds=2) ; examine(Brune)',
				toolCalls: [],
			}))
			.withArcText(true)
			.addStockVerbs()
			.withKernels((ctx) => ({
				me: dummyEntity(ctx.id, { tags: ['agent'] }),
				others: [dummyEntity('Nyx', { tags: ['enemy'] }), dummyEntity('Brune', { tags: [] })],
				items: [],
			}))
			.addVerb('go_to', {
				handler: ({ args }) => {
					went.push(args.target);
					return { ok: true, verb: 'go_to' };
				},
			})
			.onVerb(({ verb }) => ({ ok: true, verb }))
			.withVerbGate(({ verb }) => (verb === 'examine' ? { ok: false, verb, reason: 'gated' } : undefined))
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({ id: 'Guard', mind: {}, kit: KIT, identity: { role: 'Guards.' } })
			.start();
		director.mindQueue()!.enqueueMajor('Guard');
		const guard = director.character('Guard')!;
		for (let t = 1; t < 12 && guard.lastResult?.verb !== 'examine'; t++) {
			director.tick(1, t);
			await sleep(20);
		}
		assert.deepEqual(went, ['Nyx']);
		assert.equal(guard.lastResult?.reason, 'gated');
		director.dispose();
	});

	it('scores a watch arg here and as if elsewhere', async () => {
		let scored:number[] = [];
		const director = await new ArcDirector<Ctx>()
			.withWorld(OPEN_WORLD)
			.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 100, heartbeatMin: 100, maxParallel: 1 })
			.withFakeInference(() => ({ content: 'wander(until=some(others.filter("Mushroom")))', toolCalls: [] }))
			.withArcText(true)
			.addStockVerbs()
			.withKernels((ctx, point) => ({
				me: dummyEntity(ctx.id, { tags: ['agent'] }),
				others: point ? [dummyEntity('Shroom', { tags: ['Mushroom'] })] : [],
				items: [],
			}))
			.addVerb('wander', {
				handler: (call) => {
					scored = [call.score('until'), call.score('until', [5, 0])];
					return { ok: true, verb: 'wander' };
				},
			})
			.withContext((id) => ({ paragraph: scene(), id }))
			.addCharacter({ id: 'Forager', mind: {}, kit: KIT, identity: { role: 'Forages.' } })
			.start();
		director.mindQueue()!.enqueueMajor('Forager');
		director.tick(1, 1);
		await waitFor(() => scored.length > 0);
		assert.equal(scored[0], 0);
		assert.ok(scored[1] > 0);
		director.dispose();
	});
});
