import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STOCK_VERBS, VerbRegistry, registerStockVerbs } from '../arc/stock-verbs.js';
import { FakeProvider, goToNamedInteractable, hashEmbed } from '../inference/fake.js';
import { chatContentText } from '../inference/provider.js';
import { formatSight, formatSightClauses } from '../perception/sight.js';
import type { SeenObject } from '../perception/types.js';
import { soloCharacter, type SoloOptions } from '../testing/solo.js';
import { conversationCapFor, mindFields } from './mind.js';
import { CONVERSATION_HEADER } from './prompt.js';
import type { Character, CharacterJSON } from '../character/character.js';

/** A saved character, restored on its own. */
function restore<TCtx>(json:CharacterJSON, deps:Omit<SoloOptions<TCtx>, 'id'>) {
	return soloCharacter<TCtx>({ ...deps, id: json.id }, json);
}
import { DEFAULT_YOU_SYMBOL } from './map.js';
import { TalkNet } from './talk.js';
import type { MindEvent, Sense, ToolSpec } from './types.js';
import { withPriorityQueue } from '../think/queue.js';
import { buildCatalog, dummyEntity, SampleCache } from '../expr/index.js';

/** Every stock verb: registered, and in the kit. */
function stockVerbs():{ verbs:VerbRegistry; kit:{ verbs:readonly string[] } } {
	return { verbs: registerStockVerbs(new VerbRegistry()), kit: { verbs: STOCK_VERBS } };
}

type Ctx = { paragraph:string };

/** A line `speakerID` said clearly, as TalkNet delivers it. */
function heard(speakerID:string, text:string, to:string[] = []):MindEvent {
	return {
		kind: 'HeardSpeech',
		remember: true,
		text: `${speakerID} says${to.length > 0 ? ` to ${to.join(', ')}` : ''}: "${text}"`,
		tags: ['speech'],
		turn: { speakerID, to, text },
	};
}

/** The Current Conversation lines in a prompt. */
function conversationOf(prompt:string | undefined):string[] {
	const block = (prompt ?? '').split(`${CONVERSATION_HEADER}\n`)[1];
	return block ? block.split('\n\n')[0].split('\n') : [];
}

function named(id:string, extra:Partial<SeenObject> & { x?:number; z?:number } = {}):SeenObject {
	const { x, z, ...rest } = extra;
	return {
		id,
		point: [x ?? 0, z ?? 0],
		tags: extra.tags ?? [],
		...rest,
	};
}

function paragraph():string {
	return formatSight({
		self: { id: 'Guard', point: [0, 0] },
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

		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: {
				role: 'Walk to named interactables. Never emit coordinates.',
			},
			goals: [{ text: 'Go to EastGate', priority: 1 }],
			provider: new FakeProvider(goToNamedInteractable()),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: scene }),
			model: 'fake',
		});
		const arc = await agent.mind!.tick(1);
		assert.ok(arc);
		assert.equal(arc.head.verb, 'go_to');
		assert.equal(arc.head.args.target, 'EastGate');

		const json = agent.toJSON();
		const restored = restore(json, {
			provider: new FakeProvider(goToNamedInteractable()),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: scene }),
			model: 'fake',
		});
		assert.equal(restored.id, 'Guard');
		assert.equal(restored.persona.goals[0].text, 'Go to EastGate');
	});

	it('a saved memory with a legacy ID key loads', () => {
		const restored = restore(JSON.parse(`{
			"id": "Guard",
			"persona": {
				"identity": { "role": "guard" },
				"goals": [],
				"memories": [{
					"ID": "mem_1",
					"category": "episodic",
					"text": "a gate",
					"tags": [],
					"timestamp": 0,
					"lastAccessed": 0
				}],
				"maxGoals": 4,
				"maxEpisodic": 256
			},
			"tags": [],
			"liveArc": false
		}`), {
			provider: new FakeProvider(goToNamedInteractable()),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: '' }),
			model: 'fake',
		});
		assert.equal(restored.id, 'Guard');
		assert.equal(restored.persona.memory.all()[0].id, 'mem_1');
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

		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: scene }),
			model: 'fake',
		});
		await agent.mind!.remember('EastGate is the door in the east wall', ['gate', 'EastGate'], 0);
		const arc = await agent.mind!.tick(1);
		assert.equal(sawRecall, true);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(arc?.head.args.target, 'EastGate');
	});

	it('recalls a speech line only after it leaves the conversation', async () => {
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			users.push(String(req.messages[req.messages.length - 1]?.content ?? ''));
			return {
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			};
		});
		const agent = soloCharacter<Ctx>({
			id: 'Forager',
			identity: { role: 'forager' },
			goals: [{ text: 'Trade FireMushroom for SilverTrout.' }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
			conversationCap: 10,
		});
		agent.mind!.pushEvent(heard('BridgeKeeper', 'The bridge fee is FireMushroom.', ['Forager']));
		await agent.mind!.tick(1);
		assert.deepEqual(conversationOf(users[0]), ['BridgeKeeper (to you): The bridge fee is FireMushroom.']);
		assert.doesNotMatch(users[0] ?? '', /You remember:[^]*bridge fee/);
		assert.ok(agent.persona.memory.all().some((row) => row.text.includes('bridge fee')));
		for (let i = 0; i < 10; i++) {
			agent.mind!.pushEvent(heard('Player', `Noise ${i}.`));
		}
		users.length = 0;
		await agent.mind!.tick(2);
		assert.equal(conversationOf(users[0]).some((line) => line.startsWith('BridgeKeeper')), false);
		assert.match(users[0] ?? '', /You remember:[^]*bridge fee is FireMushroom/);
	});

	it('keeps last-seen of a name after it leaves sight, and nothing for names it only heard of', async () => {
		const sight = {
			self: { id: 'Angler', point: [0, 0] },
			objects: [named('Forager', { tags: ['person'], x: 3, z: 0 })],
		};
		let scene = `${formatSight(sight)} Carrying: Purse, Knife.`;
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			users.push(String(req.messages[req.messages.length - 1]?.content ?? ''));
			return {
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			};
		});
		const agent = soloCharacter<Ctx>({
			id: 'Angler',
			identity: { role: 'angler' },
			goals: [{ text: 'Pay Forager with SilverTrout.' }],
			provider,
			...stockVerbs(),
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
		mindFields(agent.mind!).sighted(formatSightClauses(sight));
		await agent.mind!.tick(1);
		assert.equal((users[0] ?? '').includes('Last I saw Forager'), false);
		scene = 'empty grass.';
		users.length = 0;
		await agent.mind!.tick(2);
		assert.match(users[0] ?? '', /Last I saw Forager/);
		const seen = agent.persona.memory.all().filter((r) => r.tags.includes('seen')).map((r) => r.text);
		assert.deepEqual(seen.map((text) => text.split(':')[0]), ['Last I saw Forager']);
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
				content: JSON.stringify({ head: { verb: 'go_to', args: { target: 'EastGate' } } }),
				toolCalls: [],
			};
		});
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: scene }),
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 2,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(calls, 2);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(arc?.head.args.target, 'EastGate');
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
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: scene }),
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 2,
			arcText: true,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(calls, 2);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(arc?.head.args.target, 'EastGate');
	});

	it('warns when the same output comes back twice in a row, and again after that', async () => {
		const same = 'go_to(EastGate)';
		const warnings:string[] = [];
		const provider = new FakeProvider((req) => {
			const last = String(req.messages[req.messages.length - 1]?.content ?? '');
			if (last.includes('Same output again')) {
				warnings.push(last);
			}
			if (last.includes('3 times in a row')) {
				return { content: 'go_to(Well)', toolCalls: [] };
			}
			return { content: same, toolCalls: [] };
		});
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			arcText: true,
		});
		const first = await agent.mind!.tick(1);
		assert.equal(first?.head.args.target, 'EastGate');
		const insisted = await agent.mind!.tick(2);
		assert.equal(insisted?.head.args.target, 'EastGate');
		const third = await agent.mind!.tick(3);
		assert.equal(third?.head.args.target, 'Well');
		assert.match(warnings[0] ?? '', /twice in a row/);
		assert.match(warnings[1] ?? '', /3 times in a row/);
	});

	it('does not warn about a repeat when something new came in since the last think', async () => {
		let warned = false;
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider: new FakeProvider((req) => {
				const last = String(req.messages[req.messages.length - 1]?.content ?? '');
				warned ||= last.includes('Same output again');
				return { content: 'go_to(EastGate)', toolCalls: [] };
			}),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			arcText: true,
		});
		await agent.mind!.tick(1);
		agent.mind!.pushEvent({ kind: 'HeardSpeech', text: 'Mira: the gate is open' });
		const again = await agent.mind!.tick(2);
		assert.equal(again?.head.args.target, 'EastGate');
		assert.equal(warned, false);
	});

	it('does not retry a bad arc when arcRetryCap is 0', async () => {
		let calls = 0;
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider: new FakeProvider(() => {
				calls += 1;
				return { content: '{"nope":true}', toolCalls: [] };
			}),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		await assert.rejects(() => agent.mind!.tick(1), /step is not an object|arc is not an object/);
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
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 1,
			arcRetryCap: 0,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(sawToolError, true);
		assert.equal(arc?.head.verb, 'go_to');
	});

	it('refuses the same lookup again in a later think', async () => {
		const results:string[] = [];
		const provider = new FakeProvider((req) => {
			const tool = req.messages.find((m) => m.role === 'tool');
			if (!tool) {
				return { content: null, toolCalls: [{ id: `c${results.length}`, name: 'recall', arguments: '{"query":"SilverTrout"}' }] };
			}
			results.push(String(tool.content));
			return { content: `remember(content=Note ${results.length})`, toolCalls: [] };
		});
		const agent = soloCharacter<Ctx>({
			id: 'Forager',
			identity: { role: 'forager' },
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			arcText: true,
			toolRoundCap: 2,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		await agent.mind!.tick(10);
		await agent.mind!.tick(20);
		assert.equal(results[0].includes('Duplicate call'), false);
		assert.match(results[1] ?? '', /Duplicate call/);
	});

	it('keeps an event that arrives while the model answers for the next think', async () => {
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			users.push(String(req.messages[1]?.content));
			if (users.length === 1) {
				agent.mind!.pushEvent({ kind: 'Given', text: '{0} gave FireMushroom to {1}', who: ['Forager', 'BridgeKeeper'], tags: ['give'] });
			}
			return { content: `remember(content=Note ${users.length})`, toolCalls: [] };
		});
		const agent = soloCharacter<Ctx>({
			id: 'BridgeKeeper',
			identity: { role: 'keeper' },
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			arcText: true,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		await agent.mind!.tick(10);
		await agent.mind!.tick(20);
		assert.equal(users[0].includes('gave FireMushroom'), false);
		assert.match(users[1] ?? '', /Forager gave FireMushroom to you/);
	});

	it('shows the article for what was heard, once, under short-term memory', async () => {
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			users.push(String(req.messages[1]?.content));
			return { content: `remember(content=Note ${users.length})`, toolCalls: [] };
		});
		const agent = soloCharacter<Ctx>({
			id: 'Forager',
			identity: { role: 'forager' },
			goals: [{ text: 'Buy SilverTrout.' }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			arcText: true,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
			encyclopedia: [{ name: 'FireMushroom', aliases: ['10 gold'], text: 'Worth 10 gold.' }],
		});
		agent.mind!.pushEvent({ kind: 'HeardSpeech', remember: true, text: 'BridgeKeeper says: "10 gold or items of equal value."', tags: ['speech'] });
		await agent.mind!.tick(10);
		await agent.mind!.tick(20);
		assert.match(users[0] ?? '', /Encyclopedia on what was said:\n- FireMushroom: Worth 10 gold\./);
		assert.equal((users[1] ?? '').includes('Encyclopedia on what was said'), false);
	});

	it('tells the think after three talk-only arcs to stop talking and act, with every tool still offered', async () => {
		const firstTurns:{ choice?:string; user:string; tools:string[] }[] = [];
		let n = 0;
		const provider = new FakeProvider((req) => {
			if (req.messages.length === 2) {
				firstTurns.push({ choice: req.toolChoice, user: String(req.messages[1]?.content), tools: (req.tools ?? []).map((t) => t.name) });
			}
			n += 1;
			return { content: `remember(content=Note ${n})`, toolCalls: [] };
		});
		const agent = soloCharacter<Ctx>({
			id: 'Forager',
			identity: { role: 'forager' },
			goals: [{ text: 'Buy SilverTrout.' }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			arcText: true,
			toolRoundCap: 2,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		for (let t = 1; t <= 4; t++) {
			await agent.mind!.tick(t * 10);
		}
		assert.deepEqual(firstTurns.map((turn) => turn.choice), ['auto', 'auto', 'auto', 'auto']);
		assert.match(firstTurns[3].user, /only talked or waited for 3 thinks\. Stop talking: take the next step toward your goal/);
		assert.equal(firstTurns[2].user.includes('Stop talking'), false);
		assert.deepEqual(firstTurns[3].tools, firstTurns[2].tools, 'no lookup is forced: it may act at once');
	});

	it('refuses a repeated tool call in one think instead of rerunning it', async () => {
		let calls = 0;
		let runs = 0;
		const provider = new FakeProvider((req) => {
			calls += 1;
			if (calls <= 2) {
				return {
					content: null,
					toolCalls: [{ id: `call_${calls}`, name: 'count', arguments: calls === 1 ? '{"q":"x"}' : '{ "q": "x" }' }],
				};
			}
			const results = req.messages.filter((m) => m.role === 'tool').map((m) => String(m.content));
			assert.equal(results.length, 2);
			assert.match(results[1], /Duplicate call/);
			return goToNamedInteractable()(req);
		});
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			...stockVerbs(),
			...perception(),
			tools: {
				count: {
					description: 'Counts.',
					parameters: { type: 'object', additionalProperties: false, properties: { q: { type: 'string' } } },
					handler: () => {
						runs += 1;
						return runs;
					},
				},
			},
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 3,
			arcRetryCap: 0,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(runs, 1);
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
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			...stockVerbs(),
			...perceptionWithBoom,
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 1,
			arcRetryCap: 0,
		});
		const arc = await agent.mind!.tick(1);
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
			assert.match(String(last?.content), /Get closer to them first/);
			return {
				content: JSON.stringify({ head: { verb: 'go_to', args: { target: 'Guard' } } }),
				toolCalls: [],
			};
		});
		const agent = soloCharacter<Ctx>({
			id: 'Acolyte',
			identity: { role: 'Ask the guard.' },
			goals: [{ text: 'Talk to Guard' }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			talk,
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(calls, 2);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(arc?.head.args.target, 'Guard');
		assert.equal(spoke.length, 0);
	});

	it('tells events from its own point of view', () => {
		const agentOf = (id:string) => soloCharacter<Ctx>({
			id,
			identity: { role: id },
			provider: new FakeProvider(() => ({ content: 'wait(seconds=1)', toolCalls: [] })),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
		});
		const given = { kind: 'Given', text: '{0} gave FireMushroom to {1}', who: ['Forager', 'BridgeKeeper'], tags: ['give'] };
		const views = ['Forager', 'BridgeKeeper', 'Angler'].map((id) => {
			const agent = agentOf(id);
			agent.mind!.pushEvent(given);
			return agent.mind!.events().map((e) => e.text);
		});
		assert.deepEqual(views, [
			['You gave FireMushroom to BridgeKeeper'],
			['Forager gave FireMushroom to you'],
			['Forager gave FireMushroom to BridgeKeeper'],
		]);
	});

	it('puts what it carries next to an item that was talked about', async () => {
		const users:string[] = [];
		let carried:ReturnType<typeof dummyEntity>[] = [];
		const agent = soloCharacter<Ctx>({
			id: 'BridgeKeeper',
			identity: { role: 'keeper' },
			provider: new FakeProvider((req) => {
				users.push(String(req.messages[1]?.content));
				return { content: `remember(content=Note ${users.length})`, toolCalls: [] };
			}),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			catalog: () => buildCatalog({ me: dummyEntity('me'), others: [], items: [], cache: new SampleCache(), inventory: (who) => (who.id === 'me' ? carried : []) }),
			model: 'fake',
			heartbeat: 0,
			arcText: true,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
			encyclopedia: [{ name: 'FireMushroom', text: 'Worth 10 gold.', item: true }, { name: 'Bridge', text: 'Raised unless lowered.' }],
		});
		agent.mind!.pushEvent({ kind: 'HeardSpeech', remember: true, text: 'Forager says to you: "Here, take this FireMushroom for the Bridge."', tags: ['speech'] });
		await agent.mind!.tick(10);
		carried = [dummyEntity('FireMushroom', { tags: ['item'] })];
		await agent.mind!.tick(20);
		assert.match(users[0] ?? '', /- FireMushroom \(you carry none\): Worth 10 gold\./);
		assert.match(users[0] ?? '', /- Bridge: Raised unless lowered\./);
		assert.match(users[1] ?? '', /- FireMushroom \(you carry one\)\./);
		assert.equal((users[1] ?? '').includes('- Bridge'), false);
	});

	it('waits for an answer only after an arc that ends on a say', async () => {
		const talk = new TalkNet({ inRange: () => true, others: () => ['Forager'] });
		const arcs = ['say(text=Very well, the mushroom covers the fee.) && remember(content=Paid)', 'say(text=The bridge is down now.)'];
		const waits:number[] = [];
		let n = 0;
		const agent = soloCharacter<Ctx>({
			id: 'BridgeKeeper',
			identity: { role: 'keeper' },
			provider: new FakeProvider(() => ({ content: arcs[n++], toolCalls: [] })),
			execute: async (step) => {
				if (step.verb === 'wait') {
					waits.push(n);
				}
				return { ok: true, verb: step.verb };
			},
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			arcText: true,
			talk,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		await agent.mind!.tick(10);
		await agent.mind!.tick(20);
		assert.deepEqual(waits, [2]);
	});

	it('refuses a say that everyone it is for already heard, and lets it reach someone new', async () => {
		const listeners = ['Forager'];
		const talk = new TalkNet({ inRange: () => true, others: () => listeners });
		const lines = [
			'Excuse me? Could you repeat what you said about the bridge?',
			'Excuse me, sir? I can lower the bridge for you, but I require ten gold or items of equal value.',
			'As I have stated, lowering the bridge requires ten gold or items of equal value.',
			'As I have stated, lowering the bridge requires ten gold or items of equal value.',
		];
		let n = 0;
		const agent = soloCharacter<Ctx>({
			id: 'BridgeKeeper',
			identity: { role: 'keeper' },
			provider: new FakeProvider(() => ({ content: `say(text=${lines[n++]})`, toolCalls: [] })),
			execute: async (step) => ({ ok: true, verb: step.verb }),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			arcText: true,
			talk,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		const results:boolean[] = [];
		for (let t = 1; t <= 3; t++) {
			await agent.mind!.tick(t * 10);
			results.push(agent.lastResult?.ok === true);
		}
		assert.deepEqual(results, [true, true, false]);
		assert.match(agent.lastResult?.reason ?? '', /already heard you say that \("Excuse me, sir\?/);
		listeners.push('Angler');
		await agent.mind!.tick(40);
		assert.equal(agent.lastResult?.ok, true);
	});

	it('refuses a move that already found no way until the way opens', async () => {
		let blocked:string | undefined = 'Bridge is raised';
		const replies = ['go_to(Angler)', 'go_to(target=Angler)', 'wait(1)', 'go_to(Angler)'];
		const hints:string[] = [];
		const ran:string[] = [];
		const agent = soloCharacter<Ctx>({
			id: 'Forager',
			identity: { role: 'forager' },
			provider: new FakeProvider((req) => {
				const last = req.messages[req.messages.length - 1];
				if (req.messages.length > 2) {
					hints.push(String(last.content));
				}
				return { content: replies.shift()!, toolCalls: [] };
			}),
			execute: async (step) => {
				ran.push(step.verb);
				return step.verb === 'go_to' && blocked
					? { ok: false, verb: 'go_to', reason: `no way to Angler, blocked on the way: ${blocked}`, unreachable: 'Angler' }
					: { ok: true, verb: step.verb };
			},
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			arcText: true,
			wayBlocked: () => blocked,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		await agent.mind!.tick(10);
		await agent.mind!.tick(20);
		assert.deepEqual(ran, ['go_to', 'wait']);
		assert.match(hints[0] ?? '', /^no way to Angler, blocked on the way: Bridge is raised\. That already failed and still would/);
		blocked = undefined;
		await agent.mind!.tick(30);
		assert.deepEqual(ran, ['go_to', 'wait', 'go_to']);
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
		const agent = soloCharacter<Ctx>({
			id: 'Acolyte',
			identity: { role: 'Ask the guard.' },
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			talk,
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(calls, 1);
		assert.equal(arc?.head.verb, 'say');
		assert.equal(arc?.head.args.to, 'Guard');
	});

	it('marks who is in earshot but out of reach, and why', async () => {
		const talk = new TalkNet({
			inRange: () => true,
			others: () => ['Guard', 'Angler'],
		});
		let user = '';
		const provider = new FakeProvider((req) => {
			user = String(req.messages.find((m) => m.role === 'user')?.content);
			return { content: JSON.stringify({ head: { verb: 'wait', args: {} } }), toolCalls: [] };
		});
		await soloCharacter<Ctx>({
			id: 'Forager',
			identity: { role: 'forager' },
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			talk,
			wayBlocked: (id) => (id === 'Angler' ? 'Bridge is raised' : undefined),
			toolRoundCap: 0,
			arcRetryCap: 0,
		}).mind!.tick(1);
		assert.match(user, /In talking range: Guard, Angler \(unreachable, blocked on the way: Bridge is raised\)\./);
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
				content: JSON.stringify({ head: { verb: 'go_to', args: { target: 'Guard' } } }),
				toolCalls: [],
			};
		});
		const agent = soloCharacter<Ctx>({
			id: 'Acolyte',
			identity: { role: 'Ask the guard.' },
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			talk,
			toolRoundCap: 1,
			arcRetryCap: 0,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(sawError, true);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(calls, 2);
	});

	it('keeps heard speech in the conversation on later thinks', async () => {
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			const last = req.messages[req.messages.length - 1];
			users.push(String(last?.content ?? ''));
			return {
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			};
		});
		const deps = {
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		};
		const agent = soloCharacter<Ctx>({ id: 'Assistant', identity: { role: 'You assist Player.' }, ...deps });
		agent.mind!.pushEvent({ ...heard('Player', 'Stay inside the cottage.', ['Assistant']), major: true });
		await agent.mind!.tick(1);
		assert.deepEqual(conversationOf(users[0]), ['Player (to you): Stay inside the cottage.']);
		await agent.mind!.tick(2);
		assert.deepEqual(conversationOf(users[1]), ['Player (to you): Stay inside the cottage.']);
		const restored = restore(agent.toJSON(), deps);
		users.length = 0;
		await restored.mind!.tick(3);
		assert.deepEqual(conversationOf(users[0]), ['Player (to you): Stay inside the cottage.']);
	});

	it('shows the last lines the host set, oldest first', async () => {
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			users.push(String(req.messages[req.messages.length - 1]?.content ?? ''));
			return {
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			};
		});
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'Watch.' },
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
			conversationCap: 10,
		});
		for (let i = 0; i < 12; i++) {
			agent.mind!.pushEvent(heard('Player', `Order ${i}.`));
		}
		agent.mind!.contextTokens = 1024;
		await agent.mind!.tick(1);
		assert.deepEqual(conversationOf(users[0]), Array.from({ length: 10 }, (_, n) => `Player: Order ${n + 2}.`));
		assert.equal(agent.mind!.settings().conversationCap, 10);
		assert.equal(agent.persona.memory.all().filter((row) => row.text.includes('Order')).length, 12);
	});

	it('shows 2 conversation lines per 1K tokens of context, at most 64', async () => {
		assert.equal(conversationCapFor(1024), 2);
		assert.equal(conversationCapFor(8192), 16);
		assert.equal(conversationCapFor(32768), 64);
		assert.equal(conversationCapFor(131072), 64);
		assert.equal(conversationCapFor(0), 0);
		assert.equal(conversationCapFor(undefined), 64);
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			users.push(String(req.messages[req.messages.length - 1]?.content ?? ''));
			return {
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			};
		});
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'Watch.' },
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		agent.mind!.contextTokens = 2048;
		for (let i = 0; i < 6; i++) {
			agent.mind!.pushEvent(heard('Player', `Tok ${i}.`));
		}
		await agent.mind!.tick(1);
		assert.deepEqual(conversationOf(users[0]), ['Player: Tok 2.', 'Player: Tok 3.', 'Player: Tok 4.', 'Player: Tok 5.']);
		agent.mind!.contextTokens = 8192;
		users.length = 0;
		await agent.mind!.tick(2);
		assert.equal(conversationOf(users[0]).length, 6);
		assert.equal(agent.mind!.settings().conversationCap, undefined);
	});

	it('names its own lines Me, the listener you, and others as it knows them', async () => {
		const talk = new TalkNet({
			inRange: () => true,
			others: (id) => id === 'BridgeKeeper' ? ['Forager'] : ['BridgeKeeper'],
		});
		const prompts:string[] = [];
		const said:string[] = [];
		let keeperCalls = 0;
		const keeper = soloCharacter<Ctx>({
			id: 'BridgeKeeper',
			identity: { role: 'Keeper.' },
			provider: new FakeProvider((req) => {
				keeperCalls += 1;
				said.push(String(req.messages[req.messages.length - 1]?.content ?? ''));
				if (keeperCalls === 1) {
					return {
						content: JSON.stringify({ head: { verb: 'say', args: { text: 'That costs 10 gold.', to: 'Forager' } } }),
						toolCalls: [],
					};
				}
				return {
					content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
					toolCalls: [],
				};
			}),
			execute: async (step) => ({ ok: true, verb: step.verb }),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			talk,
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		const forager = soloCharacter<Ctx>({
			id: 'Forager',
			identity: { role: 'Forager.' },
			provider: new FakeProvider((req) => {
				prompts.push(String(req.messages[req.messages.length - 1]?.content ?? ''));
				return {
					content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
					toolCalls: [],
				};
			}),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			talk,
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		await keeper.mind!.tick(1);
		await forager.mind!.tick(1);
		await keeper.mind!.tick(2);
		assert.deepEqual(conversationOf(prompts[0]), ['BridgeKeeper (to you): That costs 10 gold.']);
		assert.deepEqual(conversationOf(said.at(-1)), ['Me (to Forager): That costs 10 gold.']);
	});

	it('applies identity and goals from the arc JSON', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				identity: { role: 'Night watch of EastGate.' },
				goals: [{ text: 'Hold EastGate.', priority: 3 }],
				head: { verb: 'wait', args: { seconds: 8 } },
			}),
			toolCalls: [],
		}));
		const agent = soloCharacter<Ctx>({
			id: 'Assistant',
			identity: { role: 'You assist Player.', traits: ['obedient'] },
			goals: [{ text: 'Follow Player', priority: 2 }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(arc?.head.verb, 'wait');
		assert.equal(agent.persona.identity.role, 'Night watch of EastGate.');
		assert.equal(agent.persona.goals[0]?.text, 'Hold EastGate.');
		assert.ok(agent.persona.memory.pinned().some((m) => m.text.includes('Night watch of EastGate')));
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
		const agent = soloCharacter<Ctx>({
			id: 'Assistant',
			identity: { role: 'You assist Player.', traits: ['obedient'] },
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			execute: async () => ({ ok: true }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(arc?.head.verb, 'set_identity');
		assert.equal(agent.persona.identity.role, 'Night watch of EastGate.');
		assert.deepEqual(agent.persona.identity.traits, ['stern']);
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
		const agent = soloCharacter<Ctx>({
			id: 'Assistant',
			identity: { role: 'You assist Player.', traits: ['obedient'] },
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(arc?.head.verb, 'set_identity');
		assert.equal(agent.persona.identity.role, 'You assist Player.');
		const result = await agent.perform(arc!.head);
		assert.equal(result.ok, true);
		assert.equal(result.verb, 'set_identity');
		assert.equal(agent.persona.identity.role, 'Watch');
		assert.deepEqual(agent.persona.identity.traits, ['stern', 'watchful']);
	});

	it('set_identity changes the role, never the id', async () => {
		const agent = soloCharacter<Ctx>({
			id: 'Fern',
			identity: { role: 'Herbalist' },
			provider: new FakeProvider(() => ({
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			})),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		const same = await agent.perform({ verb: 'set_identity', args: { role: 'Herbalist' } });
		assert.equal(same.ok, false);
		assert.equal(same.reason, 'nothing to change');
		const ok = await agent.perform({ verb: 'set_identity', args: { role: 'Watchman' } });
		assert.equal(ok.ok, true);
		assert.equal(agent.id, 'Fern');
		assert.equal(agent.persona.identity.role, 'Watchman');
		assert.ok(agent.persona.memory.pinned().some((m) => m.text === 'I am Fern. Role: Watchman.'));
	});

	it('applies a new role from arc JSON', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				identity: { role: 'Watchman' },
				head: { verb: 'wait', args: { seconds: 1 } },
			}),
			toolCalls: [],
		}));
		const agent = soloCharacter<Ctx>({
			id: 'Fern',
			identity: { role: 'Herbalist' },
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		await agent.mind!.tick(1);
		assert.equal(agent.persona.identity.role, 'Watchman');
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
		const agent = soloCharacter<Ctx>({
			id: 'Assistant',
			identity: { role: 'You assist Player.' },
			goals: [{ text: 'Follow Player', priority: 2 }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		agent.mind!.pushEvent({
			kind: 'HeardSpeech',
			text: 'Player says to you: "Guard EastGate."',
			tags: ['speech', 'Player'],
			major: true,
		});
		await agent.mind!.tick(1);
		assert.equal(calls, 2);
		assert.equal(agent.persona.identity.role, 'I hold EastGate now.');
		assert.equal(agent.persona.goals[0]?.text, 'Hold EastGate.');
	});

	it('skips JSON goal revision when arcText is on', async () => {
		let calls = 0;
		const provider = new FakeProvider(() => {
			calls += 1;
			return { content: 'wait(seconds=1)', toolCalls: [] };
		});
		const agent = soloCharacter<Ctx>({
			id: 'Assistant',
			identity: { role: 'You assist Player.' },
			goals: [{ text: 'Follow Player', priority: 2 }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
			arcText: true,
		});
		agent.mind!.pushEvent({
			kind: 'HeardSpeech',
			text: 'Player says to you: "Go to the waterfall."',
			tags: ['speech', 'Player'],
			major: true,
		});
		await agent.mind!.tick(1);
		assert.equal(calls, 1);
		assert.equal(agent.persona.goals[0]?.text, 'Follow Player');
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
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Find the forest' }],
			provider,
			...stockVerbs(),
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
		await agent.mind!.tick(1);
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
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider: capture,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 0,
		};
		await soloCharacter<Ctx>({ ...base, vision: true }).mind!.tick(1);
		await soloCharacter<Ctx>({
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
		}).mind!.tick(1);
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
				assert.ok((req.tools ?? []).some((t) => t.name === 'see_map'));
				assert.equal(req.toolChoice, 'auto');
				const system = req.messages.find((m) => m.role === 'system');
				assert.match(String(system?.content), new RegExp(`${DEFAULT_YOU_SYMBOL} = you`));
				return {
					content: null,
					toolCalls: [{ id: 'call_map', name: 'see_map', arguments: '{"zoom":1}' }],
				};
			}
			assert.ok((req.tools ?? []).some((t) => t.name === 'see_map'));
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
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 1,
			arcRetryCap: 0,
			vision: true,
			map: {
				snapshot: (npcID, zoom) => {
					assert.equal(zoom, 1);
					return {
						image: 'data:image/png;base64,xx',
						width: 8,
						height: 8,
						toPixel: (x, y) => ({ u: x, v: y }),
						marks: [
							{ symbol: DEFAULT_YOU_SYMBOL, id: 'you', x: 1, y: 1 },
							{ symbol: '⛩️', id: 'EastGate', x: 4, y: 1 },
						],
					};
				},
			},
		});
		const arc = await agent.mind!.tick(1);
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
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 1,
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
		const arc = await agent.mind!.tick(1);
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
		await soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 1,
			arcRetryCap: 0,
			vision: true,
			map: {
				you: '🎯',
				snapshot: () => ({
					image: 'data:image/png;base64,xx',
					width: 8,
					height: 8,
					toPixel: (x, y) => ({ u: x, v: y }),
					marks: [{ symbol: '🎯', id: 'you', x: 1, y: 1 }],
				}),
			},
		}).mind!.tick(1);
	});

	it('lets the host keep the last picture by returning that image', async () => {
		let snaps = 0;
		let paints = 0;
		let loc = { x: 0, y: 0 };
		const snapshot = (npcID:string, zoom:number, prev?:{ image:string; zoom:number; timestamp:number; x?:number; y?:number }) => {
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
				marks: [{ symbol: DEFAULT_YOU_SYMBOL, id: 'you', x: 1, y: 1 }],
				x: loc.x,
				y: loc.y,
			};
		};
		let looks = 0;
		const provider = new FakeProvider((req) => {
			const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
			if (String(lastUser?.content ?? '').includes('Same output again')) {
				return goToNamedInteractable()(req);
			}
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
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 1,
			arcRetryCap: 0,
			vision: true,
			map: {
				snapshot,
			},
		});
		await agent.mind!.tick(1);
		assert.equal(snaps, 1);
		assert.equal(paints, 1);
		await agent.mind!.tick(30);
		assert.equal(snaps, 2);
		assert.equal(paints, 1);
		loc = { x: 8, y: 0 };
		await agent.mind!.tick(40);
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
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			provider,
			...stockVerbs(),
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
		assert.equal(agent.toJSON().mind!.thinkAbout, undefined);
		const blocked = await agent.perform({ verb: 'think', args: { about: 'which key' } });
		assert.equal(blocked.ok, false);
		await agent.perform({ verb: 'set_goal', args: { goal: 'find the key' } });
		const again = await agent.perform({ verb: 'think', args: { about: 'which key' } });
		assert.equal(again.ok, true);
		await agent.mind!.tick(1);
		assert.ok(seen.some((s) => s.includes('You asked to think about: which key')));
		await agent.mind!.tick(2);
		assert.equal(seen.filter((s) => s.includes('which key')).length, 1);
		const long = 'x'.repeat(300);
		await agent.perform({ verb: 'set_goal', args: { goal: 'keep going' } });
		const capped = await agent.perform({ verb: 'think', args: { about: long } });
		assert.equal(capped.ok, true);
		const json = agent.toJSON();
		assert.equal(json.mind!.thinkAbout?.length, 200);
		assert.equal(json.mind!.lastVerb, 'think');
	});

	it('allows think after a world verb in the same arc', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				head: { verb: 'go_to', args: { target: 'EastGate' } },
				then: {
					join: 'then_if_ok',
					arc: { head: { verb: 'think', args: { about: 'how to open it' } } },
				},
			}),
			toolCalls: [],
		}));
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			execute: async (step) => ({ ok: true, verb: step.verb }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(agent.toJSON().mind!.thinkAbout, 'how to open it');
		assert.equal(agent.toJSON().mind!.lastVerb, 'think');
	});

	it('moves think to the end and concatenates abouts', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				head: { verb: 'think', args: { about: 'the lock' } },
				then: {
					join: 'then_if_ok',
					arc: {
						head: { verb: 'go_to', args: { target: 'EastGate' } },
						then: {
							join: 'then',
							arc: { head: { verb: 'think', args: { about: 'which key' } } },
						},
					},
				},
			}),
			toolCalls: [],
		}));
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			execute: async (step) => ({ ok: true, verb: step.verb }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(arc?.head.verb, 'go_to');
		assert.equal(arc?.then?.join, 'then');
		assert.equal(arc?.then?.arc.head.verb, 'think');
		assert.equal(arc?.then?.arc.head.args.about, 'the lock which key');
		assert.equal(agent.toJSON().mind!.thinkAbout, 'the lock which key');
		assert.equal(agent.toJSON().mind!.lastVerb, 'think');
	});

	it('tick occupies a think slot; enact arms wait(until) and notes the queue', async () => {
		const think = withPriorityQueue({ watchInterval: 100, processInterval: 0 });
		const q = think.queue;
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				head: { verb: 'go_to', args: { target: 'EastGate' } },
				then: {
					join: 'then',
					arc: { head: { verb: 'wait', args: { until: 'hasHeard' } } },
				},
			}),
			toolCalls: [],
		}));
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			provider,
			...stockVerbs(),
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
		const arc = await agent.mind!.tick(1);
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

	it('thinkNow skips heartbeat and occupies the think slot', async () => {
		const think = withPriorityQueue({ watchInterval: 100, processInterval: 0 });
		const q = think.queue;
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			provider: new FakeProvider(() => ({
				content: JSON.stringify({ head: { verb: 'wait', args: {} } }),
				toolCalls: [],
			})),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			execute: async (step) => ({ ok: true, verb: step.verb }),
			...think,
			autoEnact: false,
			heartbeat: 30,
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 0,
		});
		q.ensure('Guard', { skipHeartbeat: true });
		agent.stamp(1);
		const first = await agent.mind!.tick(1);
		assert.equal(first?.head.verb, 'wait');
		const skipped = await agent.mind!.tick(2);
		assert.equal(skipped, null);
		const forced = await agent.mind!.thinkNow({ about: 'the gate', enact: false });
		assert.equal(forced?.head.verb, 'wait');
		assert.equal(q.inFlight, 0);
		assert.equal(q.isThinking('Guard'), false);
	});

	it('replaces a live arc when the current verb did not change during think', async () => {
		const think = withPriorityQueue({ watchInterval: 100, processInterval: 0 });
		let releaseGoTo:(()=>void) | undefined;
		const chats:Array<{ enableThinking?:boolean; fakeThought?:boolean; user:string }> = [];
		const replies = [
			JSON.stringify({ head: { verb: 'go_to', args: { target: 'EastGate' } } }),
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
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			provider,
			...stockVerbs(),
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
		void agent.mind!.tick(1);
		await waitUntil(() => agent.toJSON().mind!.lastVerb === 'go_to');
		const next = await agent.mind!.tick(2);
		assert.equal(next?.head.verb, 'wait');
		assert.equal(agent.mind!.lastArc?.head.verb, 'wait');
		assert.equal(chats.length, 2);
		assert.equal(chats[1]?.enableThinking, true, 'a fresh think asks for the mind\'s own thinking');
		assert.equal(chats[1]?.fakeThought, undefined);
		assert.equal(chats[1]?.user.includes('live verb changed'), false);
	});

	it('asks again with a canned thought when the live verb changed, and confirm keeps the first arc', async () => {
		const think = withPriorityQueue({ watchInterval: 100, processInterval: 0 });
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
						head: { verb: 'go_to', args: { target: 'EastGate' } },
						then: { join: 'then', arc: { head: { verb: 'pick_up', args: { item: 'Lantern' } } } },
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
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			provider,
			...stockVerbs(),
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
		void agent.mind!.tick(1);
		await waitUntil(() => gates.has('go_to'));
		const second = agent.mind!.tick(2);
		await waitUntil(() => hangThink !== undefined);
		gates.get('go_to')!({ ok: true, verb: 'go_to' });
		await waitUntil(() => agent.toJSON().mind!.lastVerb === 'pick_up');
		hangThink!({
			content: JSON.stringify({ head: { verb: 'wander', args: {} } }),
			toolCalls: [],
		});
		const arc = await second;
		assert.equal(arc?.head.verb, 'wander');
		assert.equal(agent.mind!.lastArc?.head.verb, 'wander');
		assert.equal(chats.length, 3);
		assert.equal(chats[2]?.enableThinking, undefined);
		assert.equal(chats[2]?.fakeThought, true);
		assert.match(chats[2]?.user ?? '', /live verb changed from go_to to pick_up/);
		assert.match(chats[2]?.user ?? '', /Do not think again/);
	});

	it('uses a new verb list from the canned-thought follow-up when the live verb changed', async () => {
		const think = withPriorityQueue({ watchInterval: 100, processInterval: 0 });
		const gates = new Map<string, (result:{ ok:boolean; interrupted?:boolean; verb:string })=>void>();
		let hangThink:((res:{ content:string; toolCalls:[] })=>void) | undefined;
		const chats:Array<{ fakeThought?:boolean }> = [];
		const provider = new FakeProvider((req) => {
			chats.push({ fakeThought: req.fakeThought });
			if (chats.length === 1) {
				return {
					content: JSON.stringify({
						head: { verb: 'go_to', args: { target: 'EastGate' } },
						then: { join: 'then', arc: { head: { verb: 'pick_up', args: { item: 'Lantern' } } } },
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
		const agent = soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			provider,
			...stockVerbs(),
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
		void agent.mind!.tick(1);
		await waitUntil(() => gates.has('go_to'));
		const second = agent.mind!.tick(2);
		await waitUntil(() => hangThink !== undefined);
		gates.get('go_to')!({ ok: true, verb: 'go_to' });
		await waitUntil(() => agent.toJSON().mind!.lastVerb === 'pick_up');
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

describe('repairs, mind verbs, and names', () => {
	function agentOf(provider:FakeProvider, extra:Partial<SoloOptions<Ctx>> = {}):Character<Ctx> {
		return soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			toolRoundCap: 0,
			arcRetryCap: 3,
			arcText: true,
			...extra,
		});
	}

	it('repairs a truncated reply without parsing it or reasoning, and warms up from the second repair', async () => {
		const temps:Array<number | undefined> = [];
		const thinking:Array<boolean | undefined> = [];
		const provider = new FakeProvider((req) => {
			temps.push(req.temperature);
			thinking.push(req.enableThinking);
			if (temps.length === 1) {
				return { content: 'go_to(Kee', toolCalls: [], truncated: true };
			}
			if (temps.length === 2) {
				assert.match(String(req.messages.at(-1)?.content), /cut off at the token limit/);
				assert.equal(req.messages.some((m) => String(m.content).includes('go_to(Kee')), false);
				return { content: 'nonsense(', toolCalls: [] };
			}
			return { content: 'go_to(EastGate)', toolCalls: [] };
		});
		const arc = await agentOf(provider, { repairTemperature: 0.7 }).mind!.tick(1);
		assert.equal(arc?.head.args.target, 'EastGate');
		assert.deepEqual(temps, [0, 0, 0.7]);
		assert.deepEqual(thinking, [true, false, false]);
	});

	it('watch, unwatch, focus, and unfocus edit the extras and leave pins alone', async () => {
		const agent = agentOf(new FakeProvider(() => ({ content: 'wait()', toolCalls: [] })), {
			pinnedWatches: { hurt: 'isHurt(me)' },
			pinnedSightFocus: ['isHurt(it)'],
		});
		const run = (verb:string, args:Record<string, string>) => agent.perform({ verb, args });
		assert.equal((await run('watch', { name: 'near', expr: 'isNear(me, Player)' })).ok, true);
		assert.equal((await run('watch', { name: 'near', expr: 'isNear(me, Player, 4)' })).ok, true);
		assert.deepEqual(agent.persona.watches, { near: 'isNear(me, Player, 4)' });
		assert.match((await run('watch', { name: 'hurt', expr: 'false' })).reason ?? '', /required watch/);
		assert.equal((await run('unwatch', { name: 'near' })).ok, true);
		assert.equal((await run('unwatch', { name: 'near' })).ok, false);
		assert.equal((await run('focus', { expr: 'isNear(it, Player)' })).ok, true);
		assert.deepEqual(agent.persona.effectiveSightFocus(), ['isHurt(it)', 'isNear(it, Player)']);
		assert.equal((await run('unfocus', { expr: 'isHurt(it)' })).ok, false);
		assert.equal((await run('unfocus', { expr: 'isNear(it, Player)' })).ok, true);
		agent.persona.watchesWritable = false;
		assert.match((await run('watch', { name: 'x', expr: 'true' })).reason ?? '', /not available/);
	});

	it('names characters by the host policy, numbers duplicates, and reads events through those names', () => {
		const provider = new FakeProvider(() => ({ content: 'wait()', toolCalls: [] }));
		const agent = agentOf(provider, {
			seenAs: (target) => target.tags?.includes('enemy') ? 'EnemyKnight' : target.id,
		});
		assert.equal(agent.mind!.seen({ id: 'Helms', tags: ['enemy'] }), 'EnemyKnight');
		assert.equal(agent.mind!.seen({ id: 'Stone', tags: ['enemy'] }), 'EnemyKnight2');
		assert.equal(agent.mind!.seen({ id: 'Helms', tags: ['enemy'] }), 'EnemyKnight');
		assert.equal(agent.mind!.seen({ id: 'Brune', tags: [] }), 'Brune');
		assert.equal(agent.persona.names.resolve('EnemyKnight2'), 'Stone');
		assert.equal(agent.persona.names.resolve('Tree'), 'Tree');
		agent.mind!.pushEvent({ kind: 'hit', text: '{0} cleaved {1}', who: ['Brune', 'Helms'], tags: ['hit'] });
		assert.equal(agent.mind!.events()[0]?.text, 'Brune cleaved EnemyKnight');
		assert.deepEqual(agent.mind!.events()[0]?.tags, ['hit', 'Brune', 'EnemyKnight']);
		const json = agent.toJSON();
		assert.deepEqual(json.mind!.events?.[0]?.who, ['Brune', 'Helms']);
		const restored = restore(json, {
			provider,
			...stockVerbs(),
			context: () => ({ paragraph: paragraph() }),
		});
		assert.equal(restored.persona.names.resolve('EnemyKnight2'), 'Stone');
		assert.equal(restored.mind!.nameOf('Helms'), 'EnemyKnight');
		assert.equal(restored.mind!.events()[0]?.text, 'Brune cleaved EnemyKnight');
	});
});
