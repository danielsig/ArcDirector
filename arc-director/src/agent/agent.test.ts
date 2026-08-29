import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VerbRegistry, registerCoreVerbs } from '../action/registry.js';
import { FakeProvider, goToNamedInteractable, hashEmbed } from '../inference/fake.js';
import { describeScene } from '../perception/describe.js';
import { builtinLodLayers } from '../perception/lod.js';
import { builtinStringifiers } from '../perception/stringifiers.js';
import type { PerceptionObject } from '../perception/types.js';
import { Agent } from './agent.js';
import { DEFAULT_YOU_SYMBOL } from './map.js';
import { TalkNet } from './talk.js';
import type { PerceptionRecipe } from './types.js';

type Ctx = { paragraph:string };

type Posed = PerceptionObject & { x:number; z:number };

function xz(a:PerceptionObject, b:PerceptionObject):number {
	const pa = a as Partial<Posed>;
	const pb = b as Partial<Posed>;
	return Math.hypot((pa.x ?? 0) - (pb.x ?? 0), (pa.z ?? 0) - (pb.z ?? 0));
}

function named(id:string, extra:Partial<Posed> = {}):Posed {
	return {
		id,
		tags: extra.tags ?? [],
		landmarkTier: extra.landmarkTier ?? 50,
		x: extra.x ?? 0,
		z: extra.z ?? 0,
		movable: extra.movable,
		interesting: extra.interesting,
		interactable: extra.interactable,
		describe: extra.describe ?? (() => id),
		...extra,
	};
}

function paragraph():string {
	return describeScene({
		self: { id: 'Guard' },
		radius: 20,
		ambient: 'damp stone hall',
		objects: [
			named('EastGate', {
				tags: ['door', 'landmark'],
				movable: false,
				interactable: true,
				landmarkTier: 80,
				x: 8,
				z: 0,
				describe: () => 'east gate',
			}),
			named('OakA', { tags: ['tree'], landmarkTier: 40, x: -1, z: -6 }),
			named('OakB', { tags: ['tree'], landmarkTier: 40, x: 0, z: -6 }),
			named('OakC', { tags: ['tree'], landmarkTier: 40, x: 1, z: -6 }),
			named('OakD', { tags: ['tree'], landmarkTier: 40, x: 0.3, z: -5.4 }),
		],
		closeness: 2,
		farDistance: 12,
		clusterFactor: 1.2,
		lodLayers: builtinLodLayers(),
		relationships: builtinStringifiers(),
		distance: xz,
	});
}

function recipe():PerceptionRecipe<Ctx> {
	return {
		push: {
			environment: {
				description: 'Described scene; no coordinates.',
				gather: (ctx) => ctx.paragraph,
			},
		},
		tools: {},
	};
}

describe('Agent', () => {
	it('emits a go_to plan from a described scene', async () => {
		const scene = paragraph();
		assert.equal(scene.includes('EastGate'), true);
		assert.equal(scene.includes('cluster of trees'), true);
		assert.equal(/\(\s*-?\d/.test(scene), false);

		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: {
				name: 'Guard',
				role: 'Walk to named interactables. Never emit coordinates.',
			},
			goals: [{ text: 'Go to EastGate', priority: 1 }],
			provider: new FakeProvider(goToNamedInteractable()),
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: scene }),
			model: 'fake',
		});
		const plan = await agent.tick(1);
		assert.ok(plan);
		assert.equal(plan.head.verb, 'go_to');
		assert.equal(plan.head.args.name, 'EastGate');

		const json = agent.toJSON();
		const restored = Agent.fromJSON(json, {
			provider: new FakeProvider(goToNamedInteractable()),
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
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
			"livePlan": false,
			"maxGoals": 4,
			"maxEpisodic": 256
		}`), {
			provider: new FakeProvider(goToNamedInteractable()),
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: '' }),
			model: 'fake',
		});
		assert.equal(restored.id, 'Guard');
		assert.equal(restored.memory.all()[0].id, 'mem_1');
	});

	it('can tool-call recall before planning', async () => {
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
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: scene }),
			model: 'fake',
		});
		await agent.remember('EastGate is the door in the east wall', ['gate', 'EastGate'], 0);
		const plan = await agent.tick(1);
		assert.equal(sawRecall, true);
		assert.equal(plan?.head.verb, 'go_to');
		assert.equal(plan?.head.args.name, 'EastGate');
	});

	it('retries a bad plan on the same thread when the host sets planRetryCap', async () => {
		let calls = 0;
		const scene = paragraph();
		const provider = new FakeProvider((req) => {
			calls += 1;
			if (calls === 1) {
				return { content: '{"nope":true}', toolCalls: [] };
			}
			const last = req.messages[req.messages.length - 1];
			assert.equal(last?.role, 'user');
			assert.match(String(last?.content), /not a valid ActionPlan/);
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
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: scene }),
			model: 'fake',
			toolRoundCap: 0,
			planRetryCap: 2,
		});
		const plan = await agent.tick(1);
		assert.equal(calls, 2);
		assert.equal(plan?.head.verb, 'go_to');
		assert.equal(plan?.head.args.name, 'EastGate');
	});

	it('does not retry a bad plan when planRetryCap is 0', async () => {
		let calls = 0;
		const agent = new Agent<Ctx>({
			id: 'Guard',
			identity: { name: 'Guard', role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider: new FakeProvider(() => {
				calls += 1;
				return { content: '{"nope":true}', toolCalls: [] };
			}),
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 0,
			planRetryCap: 0,
		});
		await assert.rejects(() => agent.tick(1), /step is not an object|plan is not an object/);
		assert.equal(calls, 1);
	});

	it('feeds unknown tool errors back and still plans', async () => {
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
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 1,
			planRetryCap: 0,
		});
		const plan = await agent.tick(1);
		assert.equal(sawToolError, true);
		assert.equal(plan?.head.verb, 'go_to');
	});

	it('turns a thrown tool handler into an error result on the thread', async () => {
		let calls = 0;
		const recipeWithBoom:PerceptionRecipe<Ctx> = {
			...recipe(),
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
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipeWithBoom,
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 1,
			planRetryCap: 0,
		});
		const plan = await agent.tick(1);
		assert.equal(plan?.head.verb, 'go_to');
		assert.equal(calls, 2);
	});

	it('rejects an out-of-range say plan without speaking and keeps thinking', async () => {
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
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			talk,
			toolRoundCap: 0,
			planRetryCap: 0,
		});
		const plan = await agent.tick(1);
		assert.equal(calls, 2);
		assert.equal(plan?.head.verb, 'go_to');
		assert.equal(plan?.head.args.name, 'Guard');
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
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			talk,
			toolRoundCap: 0,
			planRetryCap: 0,
		});
		const plan = await agent.tick(1);
		assert.equal(calls, 1);
		assert.equal(plan?.head.verb, 'say');
		assert.equal(plan?.head.args.to, 'Guard');
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
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			talk,
			toolRoundCap: 1,
			planRetryCap: 0,
		});
		const plan = await agent.tick(1);
		assert.equal(sawError, true);
		assert.equal(plan?.head.verb, 'go_to');
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
			id: 'Servant',
			identity: { name: 'Servant', role: 'Obey Player.' },
			provider,
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			planRetryCap: 0,
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
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			planRetryCap: 0,
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
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			planRetryCap: 0,
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
		const text = users[0] ?? '';
		assert.match(text, /Earlier:/);
		assert.match(text, /Order 9/);
		assert.doesNotMatch(text, /^- Player says to you: "Order 0\."$/m);
	});

	it('applies identity and goals from the plan JSON', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				identity: { name: 'Servant', role: 'Night watch of EastGate.' },
				goals: [{ text: 'Hold EastGate.', priority: 3 }],
				head: { verb: 'wait', args: { seconds: 8 } },
			}),
			toolCalls: [],
		}));
		const agent = new Agent<Ctx>({
			id: 'Servant',
			identity: { name: 'Servant', role: 'You serve Player.', traits: ['obedient'] },
			goals: [{ text: 'Follow Player', priority: 2 }],
			provider,
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			planRetryCap: 0,
			strategicInterval: 0,
		});
		const plan = await agent.tick(1);
		assert.equal(plan?.head.verb, 'wait');
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
			id: 'Servant',
			identity: { name: 'Servant', role: 'You serve Player.', traits: ['obedient'] },
			provider,
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			execute: async () => ({ ok: true }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			planRetryCap: 0,
			strategicInterval: 0,
		});
		const plan = await agent.tick(1);
		assert.equal(plan?.head.verb, 'set_identity');
		assert.equal(agent.identity.role, 'Night watch of EastGate.');
		assert.deepEqual(agent.identity.traits, ['stern']);
	});

	it('perform applies set_identity when the host runs the plan', async () => {
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
			id: 'Servant',
			identity: { name: 'Servant', role: 'You serve Player.', traits: ['obedient'] },
			provider,
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			planRetryCap: 0,
			strategicInterval: 0,
		});
		const plan = await agent.tick(1);
		assert.equal(plan?.head.verb, 'set_identity');
		assert.equal(agent.identity.role, 'You serve Player.');
		const result = await agent.perform(plan!.head);
		assert.equal(result.ok, true);
		assert.equal(result.verb, 'set_identity');
		assert.equal(agent.identity.role, 'Watch');
		assert.deepEqual(agent.identity.traits, ['stern', 'watchful']);
	});

	it('renames only when set_identity also changes role', async () => {
		const agent = new Agent<Ctx>({
			id: 'Servant',
			identity: { name: 'Servant', role: 'You serve Player.' },
			provider: new FakeProvider(() => ({
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			})),
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			planRetryCap: 0,
			strategicInterval: 0,
		});
		const blocked = await agent.perform({
			verb: 'set_identity',
			args: { name: 'Lira' },
		});
		assert.equal(blocked.ok, false);
		assert.equal(blocked.reason, 'name only changes with a new role');
		assert.equal(agent.identity.name, 'Servant');
		const sameRole = await agent.perform({
			verb: 'set_identity',
			args: { name: 'Lira', role: 'You serve Player.' },
		});
		assert.equal(sameRole.ok, false);
		assert.equal(agent.identity.name, 'Servant');
		const ok = await agent.perform({
			verb: 'set_identity',
			args: { name: 'Lira', role: 'I joined the abbey watch.' },
		});
		assert.equal(ok.ok, true);
		assert.equal(agent.identity.name, 'Lira');
		assert.equal(agent.identity.role, 'I joined the abbey watch.');
	});

	it('applies a new name from plan JSON only with a new role', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				identity: { name: 'Lira', role: 'I joined the abbey watch.' },
				head: { verb: 'wait', args: { seconds: 1 } },
			}),
			toolCalls: [],
		}));
		const agent = new Agent<Ctx>({
			id: 'Servant',
			identity: { name: 'Servant', role: 'You serve Player.' },
			provider,
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			planRetryCap: 0,
			strategicInterval: 0,
		});
		await agent.tick(1);
		assert.equal(agent.identity.name, 'Lira');
		assert.equal(agent.identity.role, 'I joined the abbey watch.');
	});

	it('ignores a new name in plan JSON when role is unchanged', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				identity: { name: 'Lira' },
				head: { verb: 'wait', args: { seconds: 1 } },
			}),
			toolCalls: [],
		}));
		const agent = new Agent<Ctx>({
			id: 'Servant',
			identity: { name: 'Servant', role: 'You serve Player.' },
			provider,
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			planRetryCap: 0,
			strategicInterval: 0,
		});
		await agent.tick(1);
		assert.equal(agent.identity.name, 'Servant');
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
			id: 'Servant',
			identity: { name: 'Servant', role: 'You serve Player.' },
			goals: [{ text: 'Follow Player', priority: 2 }],
			provider,
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			planRetryCap: 0,
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
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 0,
			planRetryCap: 0,
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
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 0,
			planRetryCap: 0,
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
		const plan = await agent.tick(1);
		assert.equal(calls, 2);
		assert.equal(plan?.head.verb, 'go_to');
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
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 0,
			planRetryCap: 0,
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
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			planRetryCap: 0,
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
});
