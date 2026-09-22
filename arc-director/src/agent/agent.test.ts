import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VerbRegistry, registerStockVerbs } from '../arc/stock-verbs.js';
import { FakeProvider, goToNamedInteractable, hashEmbed } from '../inference/fake.js';
import { chatContentText } from '../inference/provider.js';
import { formatSight } from '../perception/sight.js';
import type { SeenObject } from '../perception/types.js';
import { Agent } from './agent.js';
import { DEFAULT_YOU_SYMBOL } from './map.js';
import { TalkNet } from './talk.js';
import type { Sense, ToolSpec } from './types.js';
import { withPriorityQueue } from '../think/queue.js';
import { buildCatalog, dummyEntity, SampleCache } from '../expr/index.js';

type Ctx = { paragraph:string };

function named(id:string, extra:Partial<SeenObject> & { x?:number; z?:number } = {}):SeenObject {
	const { x, z, ...rest } = extra;
	return {
		id,
		at: [x ?? 0, z ?? 0],
		tags: extra.tags ?? [],
		...rest,
	};
}

function paragraph():string {
	return formatSight({
		self: { id: 'Guard', at: [0, 0] },
		ambient: 'damp stone hall',
		objects: [
			named('EastGate', {
				tags: ['door', 'landmark'],
				movable: false,
				interactable: true,
				x: 8,
				z: 0,
			}),
			named('OakA', { tags: ['tree'], x: -1, z: -6 }),
			named('OakB', { tags: ['tree'], x: 0, z: -6 }),
			named('OakC', { tags: ['tree'], x: 1, z: -6 }),
			named('OakD', { tags: ['tree'], x: 0.3, z: -5.4 }),
		],
	});
}

function perception():{ senses:Record<string, Sense<Ctx>>; tools:Record<string, ToolSpec<Ctx>> } {
	return {
		senses: {
			environment: {
				description: 'Described scene; no coordinates.',
				gather: (ctx) => ctx.paragraph,
			},
		},
		tools: {},
	};
}

async function waitUntil(fn:()=>boolean, ms = 400):Promise<void> {
	const t0 = Date.now();
	while (!fn()) {
		if (Date.now() - t0 > ms) {
			throw new Error('timeout');
		}
		await new Promise((r) => setTimeout(r, 5));
	}
}

describe('Agent', () => {
	it('emits a go_to arc from a described scene', async () => {
		const scene = paragraph();
		assert.equal(scene.includes('EastGate'), true);
		assert.equal(scene.includes('trees'), true);
		assert.equal(scene.includes('cluster of'), false);

		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: {
				name: 'Guard',
				role: 'Walk to named interactables. Never emit coordinates.',
			},
			goals: [{ text: 'Go to EastGate', priority: 1 }],
			provider: new FakeProvider(goToNamedInteractable()),
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: scene }),
			model: 'fake',
		});
		const arc = await agent.tick(1);
		assert.ok(arc);
		assert.equal(arc.head.verb, 'go_to');
		assert.equal(arc.head.args.name, 'EastGate');

		const json = agent.toJSON();
		const restored = Agent.fromJSON(json, {
			provider: new FakeProvider(goToNamedInteractable()),
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: scene }),
			model: 'fake',
		});
		assert.equal(restored.id, 'Guard');
		assert.equal(restored.goals[0].text, 'Go to EastGate');
	});

	it('fromJSON reads a legacy ID key', () => {
		const restored = Agent.fromJSON(JSON.parse(`{
			"ID": "Guard",
			"identity": { "name": "Guard", "role": "guard" },
			"goals": [],
			"memories": [{
				"ID": "mem_1",
				"category": "episodic",
				"text": "a gate",
				"tags": [],
				"createdAt": 0,
				"lastAccessed": 0
			}],
			"liveArc": false,
			"maxGoals": 4,
			"maxEpisodic": 256
		}`), {
			provider: new FakeProvider(goToNamedInteractable()),
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: '' }),
			model: 'fake',
		});
		assert.equal(restored.id, 'Guard');
		assert.equal(restored.memory.all()[0].id, 'mem_1');
	});

	it('can tool-call recall before the arc', async () => {
		let sawRecall = false;
		const scene = paragraph();
		const provider = new FakeProvider((req) => {
			const hasToolResult = req.messages.some((m) => m.role === 'tool');
			if (!hasToolResult && req.tools?.some((t) => t.name === 'recall')) {
				sawRecall = true;
				return {
					content: null,
					toolCalls: [{
						id: 'call_recall',
						name: 'recall',
						arguments: JSON.stringify({ query: 'gate' }),
					}],
				};
			}
			return goToNamedInteractable()(req);
		}, (texts) => texts.map((t) => hashEmbed(t)));

		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: scene }),
			model: 'fake',
		});
		await agent.remember('EastGate is the door in the east wall', ['gate', 'EastGate'], 0);
		const arc = await agent.tick(1);
		assert.equal(sawRecall, true);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(arc?.head.args.name, 'EastGate');
	});

	it('surfaces unpinned speech in the next think without a recall tool', async () => {
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			users.push(String(req.messages[req.messages.length - 1]?.content ?? ''));
			return {
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			};
		});
		const agent = new Agent<Ctx>({
			id: 'Forager',
			identity: { name: 'Forager', role: 'forager' },
			goals: [{ text: 'Trade FireMushroom for SilverTrout.' }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		agent.pushEvent({
			kind: 'HeardSpeech',
			text: 'Miller says to Forager: "The mill-fee is FireMushroom."',
			tags: ['speech'],
		});
		await agent.tick(1);
		for (let i = 0; i < 8; i++) {
			agent.pushEvent({
				kind: 'HeardSpeech',
				text: `Player says: "Noise ${i}."`,
				tags: ['speech'],
			});
		}
		users.length = 0;
		await agent.tick(2);
		assert.match(users[0] ?? '', /You remember:/);
		assert.match(users[0] ?? '', /mill-fee is FireMushroom/);
	});

	it('keeps last-seen of a name after it leaves sight', async () => {
		let scene = formatSight({
			self: { id: 'Angler', at: [0, 0] },
			objects: [named('Forager', { tags: ['person'], x: 3, z: 0 })],
		});
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			users.push(String(req.messages[req.messages.length - 1]?.content ?? ''));
			return {
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			};
		});
		const agent = new Agent<Ctx>({
			id: 'Angler',
			identity: { name: 'Angler', role: 'angler' },
			goals: [{ text: 'Pay Forager with SilverTrout.' }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			senses: {
				environment: {
					description: 'Described scene; no coordinates.',
					gather: (ctx) => ctx.paragraph,
				},
			},
			tools: {},
			context: () => ({ paragraph: scene }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		await agent.tick(1);
		assert.equal((users[0] ?? '').includes('Last I saw Forager'), false);
		scene = 'empty grass.';
		users.length = 0;
		await agent.tick(2);
		assert.match(users[0] ?? '', /Last I saw Forager/);
	});

	it('retries a bad arc on the same thread when the host sets arcRetryCap', async () => {
		let calls = 0;
		const scene = paragraph();
		const provider = new FakeProvider((req) => {
			calls += 1;
			if (calls === 1) {
				return { content: '{"nope":true}', toolCalls: [] };
			}
			const last = req.messages[req.messages.length - 1];
			assert.equal(last?.role, 'user');
			assert.match(String(last?.content), /not a valid Arc/);
			assert.equal(req.messages.some((m) => m.role === 'system'), true);
			assert.equal(req.messages.some((m) => m.role === 'assistant' && String(m.content).includes('"nope"')), true);
			assert.equal(req.messages.some((m) => m.role === 'user' && String(m.content).includes('EastGate')), true);
			return {
				content: JSON.stringify({ head: { verb: 'go_to', args: { name: 'EastGate' } } }),
				toolCalls: [],
			};
		});
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: scene }),
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 2,
		});
		const arc = await agent.tick(1);
		assert.equal(calls, 2);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(arc?.head.args.name, 'EastGate');
	});

	it('does not keep verb-less prose on the repair thread', async () => {
		let calls = 0;
		const scene = paragraph();
		const provider = new FakeProvider((req) => {
			calls += 1;
			if (calls === 1) {
				return { content: 'I will follow the Player now.', toolCalls: [] };
			}
			assert.equal(req.messages.some((m) => String(m.content).includes('I will follow')), false);
			assert.match(String(req.messages[req.messages.length - 1]?.content), /not a valid Arc/);
			return { content: 'go_to(EastGate)', toolCalls: [] };
		});
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: scene }),
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 2,
			arcText: true,
		});
		const arc = await agent.tick(1);
		assert.equal(calls, 2);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(arc?.head.args.name, 'EastGate');
	});

	it('does not retry a bad arc when arcRetryCap is 0', async () => {
		let calls = 0;
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider: new FakeProvider(() => {
				calls += 1;
				return { content: '{"nope":true}', toolCalls: [] };
			}),
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		await assert.rejects(() => agent.tick(1), /step is not an object|arc is not an object/);
		assert.equal(calls, 1);
	});

	it('feeds unknown tool errors back and still arcs', async () => {
		let calls = 0;
		let sawToolError = false;
		const provider = new FakeProvider((req) => {
			calls += 1;
			if (calls === 1) {
				return {
					content: null,
					toolCalls: [{ id: 'call_nope', name: 'nope', arguments: '{}' }],
				};
			}
			const tool = req.messages.find((m) => m.role === 'tool');
			assert.ok(tool);
			assert.match(String(tool?.content), /unknown tool/);
			sawToolError = true;
			return goToNamedInteractable()(req);
		});
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 1,
			arcRetryCap: 0,
		});
		const arc = await agent.tick(1);
		assert.equal(sawToolError, true);
		assert.equal(arc?.head.verb, 'go_to');
	});

	it('turns a thrown tool handler into an error result on the thread', async () => {
		let calls = 0;
		const perceptionWithBoom = {
			...perception(),
			tools: {
				boom: {
					description: 'Always throws.',
					parameters: { type: 'object', additionalProperties: false, properties: {} },
					handler: () => {
						throw new Error('boom failed');
					},
				},
			},
		};
		const provider = new FakeProvider((req) => {
			calls += 1;
			if (calls === 1) {
				return {
					content: null,
					toolCalls: [{ id: 'call_boom', name: 'boom', arguments: '{}' }],
				};
			}
			const tool = req.messages.find((m) => m.role === 'tool');
			assert.match(String(tool?.content), /boom failed/);
			return goToNamedInteractable()(req);
		});
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perceptionWithBoom,
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 1,
			arcRetryCap: 0,
		});
		const arc = await agent.tick(1);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(calls, 2);
	});

	it('rejects an out-of-range say arc without speaking and keeps thinking', async () => {
		const spoke:string[] = [];
		const talk = new TalkNet({
			inRange: () => false,
			others: () => ['Guard'],
		}, (u) => {
			spoke.push(u.text);
		});
		let calls = 0;
		const provider = new FakeProvider((req) => {
			calls += 1;
			if (calls === 1) {
				return {
					content: JSON.stringify({
						head: { verb: 'say', args: { text: 'Open the gate.', to: 'Guard' } },
					}),
					toolCalls: [],
				};
			}
			const last = req.messages[req.messages.length - 1];
			assert.equal(last?.role, 'user');
			assert.match(String(last?.content), /not in earshot/);
			assert.match(String(last?.content), /did not happen/);
			assert.match(String(last?.content), /go_to/);
			return {
				content: JSON.stringify({ head: { verb: 'go_to', args: { name: 'Guard' } } }),
				toolCalls: [],
			};
		});
		const agent = new Agent<Ctx>({
			id: 'Acolyte',
			identity: { name: 'Acolyte', role: 'Ask the guard.' },
			goals: [{ text: 'Talk to Guard' }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			talk,
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		const arc = await agent.tick(1);
		assert.equal(calls, 2);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(arc?.head.args.name, 'Guard');
		assert.equal(spoke.length, 0);
	});

	it('accepts say when the audience is already in range', async () => {
		const talk = new TalkNet({
			inRange: () => true,
			others: () => ['Guard'],
		});
		let calls = 0;
		const provider = new FakeProvider(() => {
			calls += 1;
			return {
				content: JSON.stringify({
					head: { verb: 'say', args: { text: 'Hello.', to: 'Guard' } },
				}),
				toolCalls: [],
			};
		});
		const agent = new Agent<Ctx>({
			id: 'Acolyte',
			identity: { name: 'Acolyte', role: 'Ask the guard.' },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			talk,
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		const arc = await agent.tick(1);
		assert.equal(calls, 1);
		assert.equal(arc?.head.verb, 'say');
		assert.equal(arc?.head.args.to, 'Guard');
	});

	it('lets earshot({to}) fail closed so the model can go_to instead', async () => {
		const talk = new TalkNet({
			inRange: () => false,
			others: () => ['Guard'],
		});
		let calls = 0;
		let sawError = false;
		const provider = new FakeProvider((req) => {
			calls += 1;
			if (calls === 1) {
				return {
					content: null,
					toolCalls: [{
						id: 'call_ear',
						name: 'earshot',
						arguments: JSON.stringify({ to: 'Guard' }),
					}],
				};
			}
			const tool = req.messages.find((m) => m.role === 'tool');
			assert.ok(tool);
			assert.match(String(tool?.content), /not in earshot/);
			sawError = true;
			return {
				content: JSON.stringify({ head: { verb: 'go_to', args: { name: 'Guard' } } }),
				toolCalls: [],
			};
		});
		const agent = new Agent<Ctx>({
			id: 'Acolyte',
			identity: { name: 'Acolyte', role: 'Ask the guard.' },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			talk,
			toolRoundCap: 1,
			arcRetryCap: 0,
		});
		const arc = await agent.tick(1);
		assert.equal(sawError, true);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(calls, 2);
	});

	it('keeps heard speech in short-term memory on later thinks', async () => {
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			const last = req.messages[req.messages.length - 1];
			users.push(String(last?.content ?? ''));
			return {
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			};
		});
		const agent = new Agent<Ctx>({
			id: 'Assistant',
			identity: { name: 'Assistant', role: 'You assist Player.' },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		agent.pushEvent({
			kind: 'HeardSpeech',
			text: 'Player says to you: "Stay inside the cottage."',
			tags: ['speech', 'Player'],
			major: true,
		});
		await agent.tick(1);
		assert.match(users[0] ?? '', /Stay inside the cottage/);
		await agent.tick(2);
		assert.match(users[1] ?? '', /Short-term memory/);
		assert.match(users[1] ?? '', /Stay inside the cottage/);
		const saved = agent.toJSON();
		assert.ok((saved.recent ?? []).some((line) => line.includes('Stay inside the cottage')));
		const restored = Agent.fromJSON(saved, {
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		users.length = 0;
		await restored.tick(3);
		assert.match(users[0] ?? '', /Stay inside the cottage/);
	});

	it('folds overflow short-term lines into an Earlier summary', async () => {
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			const last = req.messages[req.messages.length - 1];
			users.push(String(last?.content ?? ''));
			return {
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			};
		});
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'Watch.' },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		for (let i = 0; i < 10; i++) {
			agent.pushEvent({
				kind: 'HeardSpeech',
				text: `Player says to you: "Order ${i}."`,
				tags: ['speech', 'Player'],
				major: true,
			});
		}
		await agent.tick(1);
		const text = users.find((u) => u.includes('environment:')) ?? users.at(-1) ?? '';
		const stm = text.split(/\n\nYou remember:/)[0] ?? text;
		assert.match(stm, /Earlier:/);
		assert.match(stm, /Order 9/);
		assert.doesNotMatch(stm, /^- Player says to you: "Order 0\."$/m);
	});

	it('applies identity and goals from the arc JSON', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				identity: { name: 'Assistant', role: 'Night watch of EastGate.' },
				goals: [{ text: 'Hold EastGate.', priority: 3 }],
				head: { verb: 'wait', args: { seconds: 8 } },
			}),
			toolCalls: [],
		}));
		const agent = new Agent<Ctx>({
			id: 'Assistant',
			identity: { name: 'Assistant', role: 'You assist Player.', traits: ['obedient'] },
			goals: [{ text: 'Follow Player', priority: 2 }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		const arc = await agent.tick(1);
		assert.equal(arc?.head.verb, 'wait');
		assert.equal(agent.identity.role, 'Night watch of EastGate.');
		assert.equal(agent.goals[0]?.text, 'Hold EastGate.');
		assert.ok(agent.memory.pinned().some((m) => m.text.includes('Night watch of EastGate')));
	});

	it('runs set_identity as a verb', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				head: {
					verb: 'set_identity',
					args: { role: 'Night watch of EastGate.', traits: ['stern'] },
				},
			}),
			toolCalls: [],
		}));
		const agent = new Agent<Ctx>({
			id: 'Assistant',
			identity: { name: 'Assistant', role: 'You assist Player.', traits: ['obedient'] },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			execute: async () => ({ ok: true }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		const arc = await agent.tick(1);
		assert.equal(arc?.head.verb, 'set_identity');
		assert.equal(agent.identity.role, 'Night watch of EastGate.');
		assert.deepEqual(agent.identity.traits, ['stern']);
	});

	it('perform applies set_identity when the host runs the arc', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				head: {
					verb: 'set_identity',
					args: { role: 'Watch', traits: ['stern', 'watchful'] },
				},
			}),
			toolCalls: [],
		}));
		const agent = new Agent<Ctx>({
			id: 'Assistant',
			identity: { name: 'Assistant', role: 'You assist Player.', traits: ['obedient'] },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		const arc = await agent.tick(1);
		assert.equal(arc?.head.verb, 'set_identity');
		assert.equal(agent.identity.role, 'You assist Player.');
		const result = await agent.perform(arc!.head);
		assert.equal(result.ok, true);
		assert.equal(result.verb, 'set_identity');
		assert.equal(agent.identity.role, 'Watch');
		assert.deepEqual(agent.identity.traits, ['stern', 'watchful']);
	});

	it('renames only when set_identity also changes role', async () => {
		const agent = new Agent<Ctx>({
			id: 'Assistant',
			identity: { name: 'Assistant', role: 'You assist Player.' },
			provider: new FakeProvider(() => ({
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			})),
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		const blocked = await agent.perform({
			verb: 'set_identity',
			args: { name: 'Lira' },
		});
		assert.equal(blocked.ok, false);
		assert.equal(blocked.reason, 'name only changes with a new role');
		assert.equal(agent.identity.name, 'Assistant');
		const sameRole = await agent.perform({
			verb: 'set_identity',
			args: { name: 'Lira', role: 'You assist Player.' },
		});
		assert.equal(sameRole.ok, false);
		assert.equal(agent.identity.name, 'Assistant');
		const ok = await agent.perform({
			verb: 'set_identity',
			args: { name: 'Lira', role: 'I joined the abbey watch.' },
		});
		assert.equal(ok.ok, true);
		assert.equal(agent.identity.name, 'Lira');
		assert.equal(agent.identity.role, 'I joined the abbey watch.');
	});

	it('applies a new name from arc JSON only with a new role', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				identity: { name: 'Lira', role: 'I joined the abbey watch.' },
				head: { verb: 'wait', args: { seconds: 1 } },
			}),
			toolCalls: [],
		}));
		const agent = new Agent<Ctx>({
			id: 'Assistant',
			identity: { name: 'Assistant', role: 'You assist Player.' },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		await agent.tick(1);
		assert.equal(agent.identity.name, 'Lira');
		assert.equal(agent.identity.role, 'I joined the abbey watch.');
	});

	it('ignores a new name in arc JSON when role is unchanged', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				identity: { name: 'Lira' },
				head: { verb: 'wait', args: { seconds: 1 } },
			}),
			toolCalls: [],
		}));
		const agent = new Agent<Ctx>({
			id: 'Assistant',
			identity: { name: 'Assistant', role: 'You assist Player.' },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		await agent.tick(1);
		assert.equal(agent.identity.name, 'Assistant');
	});

	it('revises identity on a major event even when strategicInterval is 0', async () => {
		let calls = 0;
		const provider = new FakeProvider(() => {
			calls += 1;
			if (calls === 1) {
				return {
					content: JSON.stringify({
						identity: { role: 'I hold EastGate now.' },
						goals: [{ text: 'Hold EastGate.', priority: 3 }],
					}),
					toolCalls: [],
				};
			}
			return {
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			};
		});
		const agent = new Agent<Ctx>({
			id: 'Assistant',
			identity: { name: 'Assistant', role: 'You assist Player.' },
			goals: [{ text: 'Follow Player', priority: 2 }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		agent.pushEvent({
			kind: 'HeardSpeech',
			text: 'Player says to you: "Guard EastGate."',
			tags: ['speech', 'Player'],
			major: true,
		});
		await agent.tick(1);
		assert.equal(calls, 2);
		assert.equal(agent.identity.role, 'I hold EastGate now.');
		assert.equal(agent.goals[0]?.text, 'Hold EastGate.');
	});

	it('skips JSON goal revision when arcText is on', async () => {
		let calls = 0;
		const provider = new FakeProvider(() => {
			calls += 1;
			return { content: 'wait(seconds=1)', toolCalls: [] };
		});
		const agent = new Agent<Ctx>({
			id: 'Assistant',
			identity: { name: 'Assistant', role: 'You assist Player.' },
			goals: [{ text: 'Follow Player', priority: 2 }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
			arcText: true,
		});
		agent.pushEvent({
			kind: 'HeardSpeech',
			text: 'Player says to you: "Go to the waterfall."',
			tags: ['speech', 'Player'],
			major: true,
		});
		await agent.tick(1);
		assert.equal(calls, 1);
		assert.equal(agent.goals[0]?.text, 'Follow Player');
	});

	it('greps the world encyclopedia for leftover English', async () => {
		let grepped = '';
		const provider = new FakeProvider((req) => {
			const hasTool = req.messages.some((m) => m.role === 'tool');
			if (!hasTool && req.tools?.some((t) => t.name === 'grep_world_encyclopedia')) {
				assert.match(String(req.messages.find((m) => m.role === 'system')?.content), /grep_world_encyclopedia is a tool this think/);
				return {
					content: null,
					toolCalls: [{
						id: 'g1',
						name: 'grep_world_encyclopedia',
						arguments: JSON.stringify({ query: 'trees' }),
					}],
				};
			}
			const tool = req.messages.find((m) => m.role === 'tool');
			grepped = String(tool?.content ?? '');
			return goToNamedInteractable()(req);
		});
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			goals: [{ text: 'Find the forest' }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			hideObserve: true,
			toolRoundCap: 1,
			arcRetryCap: 0,
			strategicInterval: 0,
			encyclopedia: [{
				name: 'Tree',
				aliases: ['trees'],
				text: 'Landmark type. Many; not reachable with go_to.',
			}],
		});
		await agent.tick(1);
		assert.match(grepped, /^Tree \(trees\)/);
		assert.match(grepped, /not reachable with go_to/);
	});

	it('omits see_map when the host has no map or the model cannot see', async () => {
		const names:string[][] = [];
		const capture = new FakeProvider((req) => {
			names.push((req.tools ?? []).map((t) => t.name));
			return goToNamedInteractable()(req);
		});
		const base = {
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider: capture,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 0,
		};
		await new Agent<Ctx>({ ...base, vision: true }).tick(1);
		await new Agent<Ctx>({
			...base,
			map: {
				snapshot: () => ({
					image: 'data:image/png;base64,xx',
					width: 4,
					height: 4,
					toPixel: () => ({ u: 0, v: 0 }),
					marks: [],
				}),
			},
			vision: false,
		}).tick(1);
		assert.equal(names[0]?.includes('see_map'), false);
		assert.equal(names[1]?.includes('see_map'), false);
		assert.equal(names[0]?.length ?? 0, 0);
		assert.equal(names[1]?.length ?? 0, 0);
	});

	it('runs see_map and injects the image on the next user turn', async () => {
		let calls = 0;
		const provider = new FakeProvider((req) => {
			calls += 1;
			if (calls === 1) {
				assert.deepEqual((req.tools ?? []).map((t) => t.name), ['see_map']);
				assert.equal(req.toolChoice, 'auto');
				const system = req.messages.find((m) => m.role === 'system');
				assert.match(String(system?.content), new RegExp(`${DEFAULT_YOU_SYMBOL} = you`));
				return {
					content: null,
					toolCalls: [{ id: 'call_map', name: 'see_map', arguments: '{"zoom":1}' }],
				};
			}
			assert.deepEqual((req.tools ?? []).map((t) => t.name), ['see_map']);
			assert.equal(req.toolChoice, 'none');
			const tool = req.messages.find((m) => m.role === 'tool');
			const body = JSON.parse(String(tool?.content));
			assert.equal(body.ok, true);
			assert.equal(body.zoom, 1);
			assert.match(String(body.legend), new RegExp(`${DEFAULT_YOU_SYMBOL} = you`));
			assert.match(String(body.legend), /⛩️ = EastGate/);
			assert.equal(/\d/.test(String(body.legend)), false);
			const pictured = req.messages.find((m) => m.role === 'user' && Array.isArray(m.content));
			assert.ok(pictured && Array.isArray(pictured.content));
			const image = pictured.content.find((p) => p.type === 'image_url');
			assert.equal(image?.type, 'image_url');
			if (image?.type === 'image_url') {
				assert.match(image.image_url.url, /^data:image\/png/);
			}
			return goToNamedInteractable()(req);
		});
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 0,
			vision: true,
			map: {
				snapshot: (_npcID, zoom) => {
					assert.equal(zoom, 1);
					return {
						image: 'data:image/png;base64,xx',
						width: 8,
						height: 8,
						toPixel: (x, y) => ({ u: x, v: y }),
						marks: [
							{ symbol: DEFAULT_YOU_SYMBOL, description: 'you', x: 1, y: 1 },
							{ symbol: '⛩️', description: 'EastGate', x: 4, y: 1 },
						],
					};
				},
			},
		});
		const arc = await agent.tick(1);
		assert.equal(calls, 2);
		assert.equal(arc?.head.verb, 'go_to');
	});

	it('does not treat see_map arc text as a tool call', async () => {
		let calls = 0;
		let snaps = 0;
		const provider = new FakeProvider((req) => {
			calls += 1;
			if (calls === 1) {
				return { content: 'see_map({zoom:1})', toolCalls: [] };
			}
			const last = req.messages[req.messages.length - 1];
			assert.equal(last?.role, 'user');
			assert.match(String(last?.content), /see_map is a tool, not a verb/);
			assert.equal(req.messages.some((m) => m.role === 'tool'), false);
			return { content: 'wait(seconds=1)', toolCalls: [] };
		});
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 1,
			arcText: true,
			vision: true,
			map: {
				snapshot: () => {
					snaps += 1;
					return {
						image: 'data:image/png;base64,xx',
						width: 8,
						height: 8,
						toPixel: () => ({ u: 0, v: 0 }),
						marks: [],
					};
				},
			},
		});
		const arc = await agent.tick(1);
		assert.equal(calls, 2);
		assert.equal(snaps, 0);
		assert.equal(arc?.head.verb, 'wait');
	});

	it('puts map.you in the standing see_map hint', async () => {
		const provider = new FakeProvider((req) => {
			const system = req.messages.find((m) => m.role === 'system');
			assert.match(String(system?.content), /🎯 = you/);
			assert.equal(String(system?.content).includes(`${DEFAULT_YOU_SYMBOL} = you`), false);
			return goToNamedInteractable()(req);
		});
		await new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 0,
			vision: true,
			map: {
				you: '🎯',
				snapshot: () => ({
					image: 'data:image/png;base64,xx',
					width: 8,
					height: 8,
					toPixel: (x, y) => ({ u: x, v: y }),
					marks: [{ symbol: '🎯', description: 'you', x: 1, y: 1 }],
				}),
			},
		}).tick(1);
	});

	it('lets the host keep the last picture by returning that image', async () => {
		let snaps = 0;
		let paints = 0;
		let loc = { x: 0, y: 0 };
		const snapshot = (_npcID:string, zoom:number, prev?:{ image:string; zoom:number; timestamp:number; x?:number; y?:number }) => {
			snaps += 1;
			if (prev && prev.x !== undefined && prev.y !== undefined && zoom === prev.zoom
				&& Math.hypot(loc.x - prev.x, loc.y - prev.y) < 2) {
				return { image: prev.image };
			}
			paints += 1;
			return {
				image: `data:image/png;base64,${paints}`,
				width: 8,
				height: 8,
				toPixel: (x:number, y:number) => ({ u: x, v: y }),
				marks: [{ symbol: DEFAULT_YOU_SYMBOL, description: 'you', x: 1, y: 1 }],
				x: loc.x,
				y: loc.y,
			};
		};
		let looks = 0;
		const provider = new FakeProvider((req) => {
			const hasTool = req.messages.some((m) => m.role === 'tool');
			if (!hasTool) {
				return {
					content: null,
					toolCalls: [{ id: 'call_map', name: 'see_map', arguments: '{"zoom":1}' }],
				};
			}
			looks += 1;
			const tool = req.messages.find((m) => m.role === 'tool');
			const body = JSON.parse(String(tool?.content));
			const pictured = req.messages.some((m) => m.role === 'user' && Array.isArray(m.content));
			if (looks === 1) {
				assert.equal(body.unchanged, undefined);
				assert.equal(pictured, true);
			}
			else if (looks === 2) {
				assert.equal(body.unchanged, true);
				assert.equal(pictured, false);
			}
			else {
				assert.equal(body.unchanged, undefined);
				assert.equal(pictured, true);
			}
			return goToNamedInteractable()(req);
		});
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			vision: true,
			map: {
				snapshot,
			},
		});
		await agent.tick(1);
		assert.equal(snaps, 1);
		assert.equal(paints, 1);
		await agent.tick(30);
		assert.equal(snaps, 2);
		assert.equal(paints, 1);
		loc = { x: 8, y: 0 };
		await agent.tick(40);
		assert.equal(snaps, 3);
		assert.equal(paints, 2);
		assert.equal(looks, 3);
	});

	it('think(about) is a one-shot note and cannot follow itself', async () => {
		const seen:string[] = [];
		const provider = new FakeProvider((req) => {
			const user = req.messages.find((m) => m.role === 'user');
			if (typeof user?.content === 'string') {
				seen.push(user.content);
			}
			return {
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			};
		});
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		const ok = await agent.perform({ verb: 'think', args: { about: 'how to open EastGate' } });
		assert.equal(ok.ok, true);
		const twice = await agent.perform({ verb: 'think', args: { about: 'something else' } });
		assert.equal(twice.ok, false);
		assert.match(twice.reason ?? '', /act first/);
		const empty = await agent.perform({ verb: 'set_goal', args: { goal: 'open EastGate' } });
		assert.equal(empty.ok, true);
		const blank = await agent.perform({ verb: 'think', args: { about: '   ' } });
		assert.equal(blank.ok, true);
		assert.equal(agent.toJSON().thinkAbout, undefined);
		const blocked = await agent.perform({ verb: 'think', args: { about: 'which key' } });
		assert.equal(blocked.ok, false);
		await agent.perform({ verb: 'set_goal', args: { goal: 'find the key' } });
		const again = await agent.perform({ verb: 'think', args: { about: 'which key' } });
		assert.equal(again.ok, true);
		await agent.tick(1);
		assert.ok(seen.some((s) => s.includes('You asked to think about: which key')));
		await agent.tick(2);
		assert.equal(seen.filter((s) => s.includes('which key')).length, 1);
		const long = 'x'.repeat(300);
		await agent.perform({ verb: 'set_goal', args: { goal: 'keep going' } });
		const capped = await agent.perform({ verb: 'think', args: { about: long } });
		assert.equal(capped.ok, true);
		const json = agent.toJSON();
		assert.equal(json.thinkAbout?.length, 200);
		assert.equal(json.lastVerb, 'think');
	});

	it('allows think after a world verb in the same arc', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				head: { verb: 'go_to', args: { name: 'EastGate' } },
				then: {
					join: 'then_if_ok',
					arc: { head: { verb: 'think', args: { about: 'how to open it' } } },
				},
			}),
			toolCalls: [],
		}));
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			execute: async (step) => ({ ok: true, verb: step.verb }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		const arc = await agent.tick(1);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(agent.toJSON().thinkAbout, 'how to open it');
		assert.equal(agent.toJSON().lastVerb, 'think');
	});

	it('moves think to the end and concatenates abouts', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				head: { verb: 'think', args: { about: 'the lock' } },
				then: {
					join: 'then_if_ok',
					arc: {
						head: { verb: 'go_to', args: { name: 'EastGate' } },
						then: {
							join: 'then',
							arc: { head: { verb: 'think', args: { about: 'which key' } } },
						},
					},
				},
			}),
			toolCalls: [],
		}));
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			execute: async (step) => ({ ok: true, verb: step.verb }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		const arc = await agent.tick(1);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(arc?.then?.join, 'then');
		assert.equal(arc?.then?.arc.head.verb, 'think');
		assert.equal(arc?.then?.arc.head.args.about, 'the lock which key');
		assert.equal(agent.toJSON().thinkAbout, 'the lock which key');
		assert.equal(agent.toJSON().lastVerb, 'think');
	});

	it('tick occupies a think slot; enact arms wait(until) and notes the queue', async () => {
		const think = withPriorityQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		const q = think.queue;
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				head: { verb: 'go_to', args: { name: 'EastGate' } },
				then: {
					join: 'then',
					arc: { head: { verb: 'wait', args: { until: 'hasHeard' } } },
				},
			}),
			toolCalls: [],
		}));
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			execute: async (step) => ({ ok: true, verb: step.verb }),
			...think,
			autoEnact: false,
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		q.ensure('Guard', { skipHeartbeat: true });
		const arc = await agent.tick(1);
		assert.equal(q.inFlight, 0);
		assert.equal(arc?.head.verb, 'go_to');
		await agent.enact(arc!);
		assert.equal(q.arcOf('Guard'), null);
		const me = dummyEntity('me');
		const cat = buildCatalog({
			me,
			others: [],
			items: [],
			cache: new SampleCache(),
			distance: () => 1,
			nearRadius: 8,
			hasHeard: true,
		});
		assert.ok(q.scoreWatches('Guard', cat) > 0.05);
		q.beginThink('Guard');
		assert.equal(q.scoreWatches('Guard', cat), 0);
	});

	it('replaces a live arc when the current verb did not change during think', async () => {
		const think = withPriorityQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		let releaseGoTo:(()=>void) | undefined;
		const chats:Array<{ enableThinking?:boolean; fakeThought?:boolean; user:string }> = [];
		const replies = [
			JSON.stringify({ head: { verb: 'go_to', args: { name: 'EastGate' } } }),
			JSON.stringify({ head: { verb: 'wait', args: {} } }),
		];
		const provider = new FakeProvider((req) => {
			const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
			chats.push({
				enableThinking: req.enableThinking,
				fakeThought: req.fakeThought,
				user: chatContentText(lastUser?.content),
			});
			return { content: replies.shift() ?? '', toolCalls: [] };
		});
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			execute: async (step) => {
				if (step.verb === 'go_to') {
					await new Promise<void>((r) => {
						releaseGoTo = r;
					});
					return { ok: true, verb: 'go_to' };
				}
				return { ok: true, verb: step.verb };
			},
			abortArc: () => {
				releaseGoTo?.();
			},
			...think,
			heartbeat: 0,
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		void agent.tick(1);
		await waitUntil(() => agent.toJSON().lastVerb === 'go_to');
		const next = await agent.tick(2);
		assert.equal(next?.head.verb, 'wait');
		assert.equal(agent.lastArc?.head.verb, 'wait');
		assert.equal(chats.length, 2);
		assert.equal(chats[1]?.enableThinking, undefined);
		assert.equal(chats[1]?.fakeThought, undefined);
		assert.equal(chats[1]?.user.includes('live verb changed'), false);
	});

	it('asks again with a canned thought when the live verb changed, and confirm keeps the first arc', async () => {
		const think = withPriorityQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		const gates = new Map<string, (result:{ ok:boolean; interrupted?:boolean; verb:string })=>void>();
		let hangThink:((res:{ content:string; toolCalls:[] })=>void) | undefined;
		const chats:Array<{ enableThinking?:boolean; fakeThought?:boolean; user:string }> = [];
		const provider = new FakeProvider((req) => {
			const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
			chats.push({
				enableThinking: req.enableThinking,
				fakeThought: req.fakeThought,
				user: chatContentText(lastUser?.content),
			});
			if (chats.length === 1) {
				return {
					content: JSON.stringify({
						head: { verb: 'go_to', args: { name: 'EastGate' } },
						then: { join: 'then', arc: { head: { verb: 'pick_up', args: { name: 'Lantern' } } } },
					}),
					toolCalls: [],
				};
			}
			if (chats.length === 2) {
				return new Promise((resolve) => {
					hangThink = resolve;
				});
			}
			return { content: 'looks good', toolCalls: [] };
		});
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			execute: (step) => {
				if (step.verb === 'go_to' || step.verb === 'pick_up') {
					return new Promise((resolve) => {
						gates.set(step.verb, resolve);
					});
				}
				return Promise.resolve({ ok: true, verb: step.verb });
			},
			abortArc: () => {
				for (const [verb, resolve] of gates) {
					resolve({ ok: false, interrupted: true, verb });
				}
				gates.clear();
			},
			...think,
			heartbeat: 0,
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		void agent.tick(1);
		await waitUntil(() => gates.has('go_to'));
		const second = agent.tick(2);
		await waitUntil(() => hangThink !== undefined);
		gates.get('go_to')!({ ok: true, verb: 'go_to' });
		await waitUntil(() => agent.toJSON().lastVerb === 'pick_up');
		hangThink!({
			content: JSON.stringify({ head: { verb: 'wander', args: {} } }),
			toolCalls: [],
		});
		const arc = await second;
		assert.equal(arc?.head.verb, 'wander');
		assert.equal(agent.lastArc?.head.verb, 'wander');
		assert.equal(chats.length, 3);
		assert.equal(chats[2]?.enableThinking, undefined);
		assert.equal(chats[2]?.fakeThought, true);
		assert.match(chats[2]?.user ?? '', /live verb changed from go_to to pick_up/);
		assert.match(chats[2]?.user ?? '', /Do not think again/);
	});

	it('uses a new verb list from the canned-thought follow-up when the live verb changed', async () => {
		const think = withPriorityQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		const gates = new Map<string, (result:{ ok:boolean; interrupted?:boolean; verb:string })=>void>();
		let hangThink:((res:{ content:string; toolCalls:[] })=>void) | undefined;
		const chats:Array<{ fakeThought?:boolean }> = [];
		const provider = new FakeProvider((req) => {
			chats.push({ fakeThought: req.fakeThought });
			if (chats.length === 1) {
				return {
					content: JSON.stringify({
						head: { verb: 'go_to', args: { name: 'EastGate' } },
						then: { join: 'then', arc: { head: { verb: 'pick_up', args: { name: 'Lantern' } } } },
					}),
					toolCalls: [],
				};
			}
			if (chats.length === 2) {
				return new Promise((resolve) => {
					hangThink = resolve;
				});
			}
			return {
				content: JSON.stringify({ head: { verb: 'wait', args: {} } }),
				toolCalls: [],
			};
		});
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			execute: (step) => {
				if (step.verb === 'go_to' || step.verb === 'pick_up') {
					return new Promise((resolve) => {
						gates.set(step.verb, resolve);
					});
				}
				return Promise.resolve({ ok: true, verb: step.verb });
			},
			abortArc: () => {
				for (const [verb, resolve] of gates) {
					resolve({ ok: false, interrupted: true, verb });
				}
				gates.clear();
			},
			...think,
			heartbeat: 0,
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		void agent.tick(1);
		await waitUntil(() => gates.has('go_to'));
		const second = agent.tick(2);
		await waitUntil(() => hangThink !== undefined);
		gates.get('go_to')!({ ok: true, verb: 'go_to' });
		await waitUntil(() => agent.toJSON().lastVerb === 'pick_up');
		hangThink!({
			content: JSON.stringify({ head: { verb: 'wander', args: {} } }),
			toolCalls: [],
		});
		const arc = await second;
		assert.equal(arc?.head.verb, 'wait');
		assert.equal(chats.length, 3);
		assert.equal(chats[2]?.fakeThought, true);
	});
});
