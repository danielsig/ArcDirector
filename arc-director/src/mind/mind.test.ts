import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STOCK_VERBS, VerbRegistry, registerStockVerbs } from '../arc/stock-verbs.js';
import { FakeProvider, goToNamedInteractable, hashEmbed } from '../inference/fake.js';
import { chatContentText, type ChatRequest } from '../inference/provider.js';
import { formatSight, formatSightClauses } from '../perception/sight.js';
import type { SeenObject } from '../perception/types.js';
import { soloCharacter, type SoloOptions } from '../testing/solo.js';
import { mindFields } from './mind.js';
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
		assert.equal(arc[0].verb, 'go_to');
		assert.equal(arc[0].args.target, 'EastGate');

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
			// Native tool calls, as a model asked for plain JSON makes them.
			arcFormat: 'json',
			model: 'fake',
		});
		await agent.mind!.remember('EastGate is the door in the east wall', ['gate', 'EastGate'], 0);
		const arc = await agent.mind!.tick(1);
		assert.equal(sawRecall, true);
		assert.equal(arc?.[0].verb, 'go_to');
		assert.equal(arc?.[0].args.target, 'EastGate');
	});

	it('recalls a speech line only after it leaves the conversation', async () => {
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			users.push(String(req.messages[req.messages.length - 1]?.content ?? ''));
			return {
				content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }),
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
			conversationCap: 160,
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
			objects: [named('Forager', { tags: ['character'], x: 3, z: 0 })],
		};
		let scene = `${formatSight(sight)} Carrying: Purse, Knife.`;
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			users.push(String(req.messages[req.messages.length - 1]?.content ?? ''));
			return {
				content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }),
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

	it('retries a bad arc on the same thread, without the bad reply, when the host sets arcRetryCap', async () => {
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
			assert.equal(req.messages.some((m) => String(m.content).includes('"nope"')), false, 'a model shown its bad reply copies it');
			assert.equal(req.messages.some((m) => m.role === 'user' && String(m.content).includes('EastGate')), true);
			return {
				content: JSON.stringify({ steps: [{ verb: 'go_to', target: 'EastGate' }] }),
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
		assert.equal(arc?.[0].verb, 'go_to');
		assert.equal(arc?.[0].args.target, 'EastGate');
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
			arcFormat: 'text',
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(calls, 2);
		assert.equal(arc?.[0].verb, 'go_to');
		assert.equal(arc?.[0].args.target, 'EastGate');
	});

	it('runs a tool written as text where the Arc goes, and keeps an Arc written beside one', async () => {
		const lasts:string[] = [];
		const provider = new FakeProvider((req) => {
			lasts.push(String(req.messages.at(-1)?.content ?? ''));
			const content = lasts.length === 1 ? 'call:recall{query:<|"|>EastGate<|"|>}' : 'observe(hasSightline) && go_to(EastGate)';
			return { content, toolCalls: [] };
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
			toolRoundCap: 2,
			arcRetryCap: 0,
			arcFormat: 'text',
		});
		const arc = await agent.mind!.tick(1);
		assert.match(lasts[1] ?? '', /Those were tools written as text; they ran anyway:\nrecall: /);
		assert.equal(lasts.length, 2, 'the Arc beside a written tool is taken without another turn');
		assert.deepEqual(arc?.[0], { verb: 'go_to', args: { target: 'EastGate' } });
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
			arcFormat: 'text',
		});
		const first = await agent.mind!.tick(1);
		assert.equal(first?.[0].args.target, 'EastGate');
		const insisted = await agent.mind!.tick(2);
		assert.equal(insisted?.[0].args.target, 'EastGate');
		const third = await agent.mind!.tick(3);
		assert.equal(third?.[0].args.target, 'Well');
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
			arcFormat: 'text',
		});
		await agent.mind!.tick(1);
		agent.mind!.pushEvent({ kind: 'HeardSpeech', text: 'Mira: the gate is open' });
		const again = await agent.mind!.tick(2);
		assert.equal(again?.[0].args.target, 'EastGate');
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
		await assert.rejects(() => agent.mind!.tick(1), /arc is not \{"steps"/);
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
			// Native tool calls, as a model asked for plain JSON makes them.
			arcFormat: 'json',
			model: 'fake',
			toolRoundCap: 1,
			arcRetryCap: 0,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(sawToolError, true);
		assert.equal(arc?.[0].verb, 'go_to');
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
			arcFormat: 'text',
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
			arcFormat: 'text',
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
			arcFormat: 'text',
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
			knowledge: [{ name: 'FireMushroom', aliases: ['10 gold'], text: 'Worth 10 gold.' }],
		});
		agent.mind!.pushEvent({ kind: 'HeardSpeech', remember: true, text: 'BridgeKeeper says: "10 gold or items of equal value."', tags: ['speech'] });
		await agent.mind!.tick(10);
		await agent.mind!.tick(20);
		assert.match(users[0] ?? '', /What you know about what was said:\n- FireMushroom: Worth 10 gold\./);
		assert.equal((users[1] ?? '').includes('What you know about what was said'), false);
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
			arcFormat: 'text',
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
			// Native tool calls, as a model asked for plain JSON makes them.
			arcFormat: 'json',
			model: 'fake',
			toolRoundCap: 3,
			arcRetryCap: 0,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(runs, 1);
		assert.equal(arc?.[0].verb, 'go_to');
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
			// Native tool calls, as a model asked for plain JSON makes them.
			arcFormat: 'json',
			model: 'fake',
			toolRoundCap: 1,
			arcRetryCap: 0,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(arc?.[0].verb, 'go_to');
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
					content: JSON.stringify({ steps: [{ verb: 'say', text: 'Open the gate.', to: 'Guard' }] }),
					toolCalls: [],
				};
			}
			const last = req.messages[req.messages.length - 1];
			assert.equal(last?.role, 'user');
			assert.match(String(last?.content), /not in earshot/);
			assert.match(String(last?.content), /did not happen/);
			assert.match(String(last?.content), /Get closer to them first/);
			return {
				content: JSON.stringify({ steps: [{ verb: 'go_to', target: 'Guard' }] }),
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
		assert.equal(arc?.[0].verb, 'go_to');
		assert.equal(arc?.[0].args.target, 'Guard');
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

	it('keeps a two-character event in the conversation of a mind that controls one of them, then in memory', async () => {
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			users.push(String(req.messages[req.messages.length - 1]?.content ?? ''));
			return { content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }), toolCalls: [] };
		});
		const agentOf = (id:string) => soloCharacter<Ctx>({
			id,
			identity: { role: id },
			goals: [{ text: 'FireMushroom changes hands', priority: 1 }],
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
		const given = { kind: 'Given', text: '{0} gave FireMushroom to {1}', who: ['Forager', 'BridgeKeeper'], tags: ['give'], remember: true };
		const forager = agentOf('Forager');
		const angler = agentOf('Angler');
		forager.mind!.pushEvent(given);
		angler.mind!.pushEvent(given);
		await forager.mind!.thinkNow({ enact: false });
		await angler.mind!.thinkNow({ enact: false });
		const foragerPrompt = users[0] ?? '';
		const anglerPrompt = users[1] ?? '';
		assert.match(foragerPrompt, /Current Conversation[\s\S]*You gave FireMushroom to BridgeKeeper/);
		assert.equal(foragerPrompt.includes('- You gave FireMushroom'), false);
		assert.match(anglerPrompt, /- Forager gave FireMushroom to BridgeKeeper/);
		assert.equal(anglerPrompt.includes('Current Conversation'), false);
		assert.equal(forager.persona.memory.all().some((row) => row.text === 'You gave FireMushroom to BridgeKeeper'), true);
		assert.doesNotMatch(foragerPrompt, /You remember:[\s\S]*gave FireMushroom/);
		// A passing deed, a blow in a fight, is short-term memory, not conversation.
		const cade = agentOf('Cade');
		cade.mind!.pushEvent({ kind: 'Hurt', text: '{0} cleaved {1}', who: ['Cade', 'BridgeKeeper'] });
		users.length = 0;
		await cade.mind!.thinkNow({ enact: false });
		assert.match(users[0] ?? '', /- You cleaved BridgeKeeper/);
		assert.equal((users[0] ?? '').includes('Current Conversation'), false);
		forager.mind!.conversationCap = 20;
		forager.mind!.pushEvent({ kind: 'Note', text: 'z'.repeat(30), turn: { speakerID: 'Baker', text: 'z'.repeat(30) } });
		users.length = 0;
		await forager.mind!.thinkNow({ enact: false });
		const later = users[0] ?? '';
		assert.equal(later.split('You remember:')[0]?.includes('You gave FireMushroom'), false);
		assert.match(later, /You remember:[\s\S]*You gave FireMushroom to BridgeKeeper/);
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
			arcFormat: 'text',
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
			knowledge: [{ name: 'FireMushroom', text: 'Worth 10 gold.', item: true }, { name: 'Bridge', text: 'Raised unless lowered.' }],
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

	it('waits at the end of an arc when a reply verb\'s target is still nearby', async () => {
		let close = true;
		const talk = new TalkNet({ inRange: () => close, others: () => ['Forager'] });
		const verbs = registerStockVerbs(new VerbRegistry());
		verbs.add('heal', { args: { target: 'id' } });
		verbs.add('attack', { args: { target: 'id' } });
		const arcs = [
			'say(text=Very well, the mushroom covers the fee.) && remember(content=Paid)',
			'say(text=The bridge is down now.)',
			'say(text=You may cross now., to=Forager)',
			'give(item=FireMushroom, to=Forager)',
			'give(item=FireMushroom, to=Forager) && say(text=Here sir. This mushroom should cover the fee.)',
			'heal(target=Forager)',
			'attack(target=Forager)',
			'give(item=FireMushroom, to=Forager)',
		];
		const waits:string[] = [];
		let n = 0;
		const agent = soloCharacter<Ctx>({
			id: 'BridgeKeeper',
			identity: { role: 'keeper' },
			provider: new FakeProvider(() => ({ content: arcs[n++], toolCalls: [] })),
			execute: async (step) => {
				if (step.verb === 'wait') {
					waits.push(arcs[n - 1] ?? '');
				}
				return { ok: true, verb: step.verb };
			},
			verbs,
			kit: { verbs: [...STOCK_VERBS, 'heal', 'attack'] },
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			arcFormat: 'text',
			talk,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		for (let t = 1; t <= arcs.length; t++) {
			if (t === arcs.length) {
				close = false;
			}
			await agent.mind!.tick(t * 10);
		}
		assert.deepEqual(waits, [arcs[2], arcs[3], arcs[4]]);
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
			arcFormat: 'text',
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
			arcFormat: 'text',
			wayBlocked: (ids) => ids.map(() => blocked),
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
				content: JSON.stringify({ steps: [{ verb: 'say', text: 'Hello.', to: 'Guard' }] }),
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
		assert.equal(arc?.[0].verb, 'say');
		assert.equal(arc?.[0].args.to, 'Guard');
	});

	it('keeps who heard a line out of memory: the line is in the conversation', async () => {
		const agent = soloCharacter<Ctx>({
			id: 'Acolyte',
			identity: { role: 'acolyte' },
			provider: new FakeProvider(() => ({ content: 'wait(1)', toolCalls: [] })),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			arcFormat: 'text',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
		});
		agent.mind!.ingestResult({ ok: true, verb: 'say', reason: 'heard by Guard; too far for Baker to make out the words: get closer' });
		agent.mind!.ingestResult({ ok: true, verb: 'examine', reason: 'Gate is shut' });
		await agent.mind!.tick(10);
		const kept = agent.persona.memory.all().map((r) => r.text);
		assert.ok(!kept.some((text) => text.startsWith('heard by Guard')), 'a say result was kept as a memory');
		assert.ok(kept.includes('Gate is shut'), 'an examine result was not kept');
	});

	it('marks who is in earshot but out of reach, and why', async () => {
		const talk = new TalkNet({
			inRange: () => true,
			others: () => ['Guard', 'Angler'],
		});
		let user = '';
		const provider = new FakeProvider((req) => {
			user = String(req.messages.find((m) => m.role === 'user')?.content);
			return { content: JSON.stringify({ steps: [{ verb: 'wait' }] }), toolCalls: [] };
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
			wayBlocked: (ids) => ids.map((id) => (id === 'Angler' ? 'Bridge is raised' : undefined)),
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
				content: JSON.stringify({ steps: [{ verb: 'go_to', target: 'Guard' }] }),
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
			// Native tool calls, as a model asked for plain JSON makes them.
			arcFormat: 'json',
			model: 'fake',
			talk,
			toolRoundCap: 1,
			arcRetryCap: 0,
		});
		const arc = await agent.mind!.tick(1);
		assert.equal(sawError, true);
		assert.equal(arc?.[0].verb, 'go_to');
		assert.equal(calls, 2);
	});

	it('keeps heard speech in the conversation on later thinks', async () => {
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			const last = req.messages[req.messages.length - 1];
			users.push(String(last?.content ?? ''));
			return {
				content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }),
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

	it('shows whole messages that fit the letter cap, oldest first', async () => {
		const users:string[] = [];
		const provider = new FakeProvider((req) => {
			users.push(String(req.messages[req.messages.length - 1]?.content ?? ''));
			return {
				content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }),
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
			conversationCap: 900,
		});
		for (let i = 0; i < 4; i++) {
			agent.mind!.pushEvent(heard('Player', `${i}${'x'.repeat(291)}`));
		}
		agent.mind!.contextTokens = 1024;
		await agent.mind!.tick(1);
		const shown = conversationOf(users[0]);
		assert.equal(shown.length, 3);
		assert.equal(shown.reduce((n, line) => n + line.length, 0), 900);
		assert.equal(agent.mind!.settings().conversationCap, 900);
		assert.equal(agent.persona.memory.all().filter((row) => row.text.includes('xxx')).length, 4);
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
						content: JSON.stringify({ steps: [{ verb: 'say', text: 'That costs 10 gold.', to: 'Forager' }] }),
						toolCalls: [],
					};
				}
				return {
					content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }),
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
					content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }),
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

	it('takes no identity or goals from the arc reply: set_identity and set_goal are verbs', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				steps: [{ verb: 'wait', seconds: 8 }],
				identity: { role: 'Night watch of EastGate.' },
				goals: [{ text: 'Hold EastGate.', priority: 3 }],
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
		assert.equal(arc?.[0].verb, 'wait');
		assert.equal(agent.persona.identity.role, 'You assist Player.');
		assert.equal(agent.persona.goals[0]?.text, 'Follow Player');
	});

	it('runs set_identity as a verb', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({ steps: [{ verb: 'set_identity', role: 'Night watch of EastGate.', traits: ['stern'] }] }),
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
		assert.equal(arc?.[0].verb, 'set_identity');
		assert.equal(agent.persona.identity.role, 'Night watch of EastGate.');
		assert.deepEqual(agent.persona.identity.traits, ['stern']);
	});

	it('perform applies set_identity when the host runs the arc', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({ steps: [{ verb: 'set_identity', role: 'Watch', traits: ['stern', 'watchful'] }] }),
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
		assert.equal(arc?.[0].verb, 'set_identity');
		assert.equal(agent.persona.identity.role, 'You assist Player.');
		const result = await agent.perform(arc![0]);
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
				content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }),
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
				content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }),
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

	it('does not revise goals when skipStrategic is set, even after a major event', async () => {
		let calls = 0;
		const agent = soloCharacter<Ctx>({
			id: 'Angler',
			identity: { role: 'angler' },
			goals: [{ text: 'Buy FireMushroom, unless you already have one.', priority: 2 }],
			provider: new FakeProvider(() => {
				calls += 1;
				return { content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }), toolCalls: [] };
			}),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			skipStrategic: true,
			autoEnact: false,
		});
		agent.mind!.pushEvent({ kind: 'HeardSpeech', text: 'Forager says to you: "Do you sell SilverTrout?"', major: true });
		await agent.mind!.tick(200);
		assert.equal(calls, 1);
		assert.equal(agent.persona.goals[0]?.text, 'Buy FireMushroom, unless you already have one.');
	});

	/** An assistant whose first reply (the goal pass) is `goalReply` and whose next is a wait arc, in `arcFormat`; `seen` takes every request. */
	function goalPass(arcFormat:'text' | 'json' | 'schema', goalReply:string, seen:ChatRequest[]):Character<Ctx> {
		return soloCharacter<Ctx>({
			id: 'Assistant',
			identity: { role: 'You assist Player.' },
			goals: [{ text: 'Follow Player', priority: 2 }],
			provider: new FakeProvider((req) => {
				seen.push(req);
				return { content: seen.length === 1 ? goalReply : arcFormat === 'text' ? 'wait(seconds=1)' : JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }), toolCalls: [] };
			}),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			toolRoundCap: 0,
			arcRetryCap: 0,
			strategicInterval: 0,
			autoEnact: false,
			arcFormat,
		});
	}

	const speech:MindEvent = {
		kind: 'HeardSpeech',
		text: 'Player says to you: "Go to the waterfall."',
		tags: ['speech', 'Player'],
		major: true,
	};

	it('revises goals in Arc text when arcFormat is text: set_goal, drop_goal and set_identity', async () => {
		const seen:ChatRequest[] = [];
		const agent = goalPass('text', 'set_goal(goal=Go to the waterfall, priority=3)\ndrop_goal(goal=Follow Player)\nset_identity(role=Waterfall scout)', seen);
		agent.mind!.pushEvent(speech);
		await agent.mind!.tick(1);
		assert.equal(seen.length, 2, 'the goal pass, then the arc');
		assert.equal(seen[0].responseFormat, undefined);
		assert.match(chatContentText(seen[0].messages[1].content), /Reply with only Arc text, one verb per line: set_goal\(goal, priority\?\) adds a goal/);
		assert.match(chatContentText(seen[0].messages[1].content), /Name every argument, as in set_goal\(goal=Hold the bridge, priority=2\)/);
		assert.equal(chatContentText(seen[0].messages[1].content).includes('Emit JSON'), false);
		assert.deepEqual(agent.persona.goals.map((goal) => goal.text), ['Go to the waterfall']);
		assert.equal(agent.persona.goals[0].priority, 3);
		assert.equal(agent.persona.identity.role, 'Waterfall scout');
		assert.equal(agent.toJSON().mind!.lastVerb, undefined, 'a goal pass is not a verb the mind ran, so it never changes what it was last doing');
	});

	it('changes nothing for a goal pass that is empty, not Arc text, or holds any other verb', async () => {
		for (const reply of ['', 'I keep following the Player.', 'go_to(Waterfall)', 'set_goal(goal=Swim) ; go_to(Waterfall)', 'set_goal(']) {
			const seen:ChatRequest[] = [];
			const agent = goalPass('text', reply, seen);
			agent.mind!.pushEvent(speech);
			await agent.mind!.tick(1);
			assert.deepEqual(agent.persona.goals.map((goal) => goal.text), ['Follow Player'], JSON.stringify(reply));
			assert.equal(agent.persona.identity.role, 'You assist Player.');
		}
	});

	it('revises goals in JSON when arcFormat is json', async () => {
		const seen:ChatRequest[] = [];
		const agent = goalPass('json', JSON.stringify({ goals: [{ text: 'Go to the waterfall', priority: 3 }], identity: { role: 'Waterfall scout' } }), seen);
		agent.mind!.pushEvent(speech);
		await agent.mind!.tick(1);
		assert.equal(seen[0].responseFormat, undefined);
		assert.match(chatContentText(seen[0].messages[1].content), /Emit JSON \{"goals":/);
		assert.deepEqual(agent.persona.goals.map((goal) => goal.text), ['Go to the waterfall']);
		assert.equal(agent.persona.identity.role, 'Waterfall scout');
	});

	it('revises goals under the fixed goals schema when arcFormat is schema', async () => {
		const seen:ChatRequest[] = [];
		const agent = goalPass('schema', JSON.stringify({ goals: [{ text: 'Go to the waterfall' }] }), seen);
		agent.mind!.pushEvent(speech);
		await agent.mind!.tick(1);
		assert.equal(seen[0].responseFormat?.name, 'goals');
		assert.equal(seen[0].responseFormat?.strict, true);
		assert.deepEqual((seen[0].responseFormat?.schema as { required:string[] }).required, ['goals']);
		assert.match(chatContentText(seen[0].messages[1].content), /Reply \{"goals":\[\{"text":"...","priority":0\}\]\}, the whole list, or \[\] to keep yours/);
		assert.equal(seen[1].responseFormat?.name, 'reply');
		assert.deepEqual(agent.persona.goals.map((goal) => goal.text), ['Go to the waterfall']);
		const kept:ChatRequest[] = [];
		const same = goalPass('schema', '{"goals":[]}', kept);
		same.mind!.pushEvent(speech);
		await same.mind!.tick(1);
		assert.deepEqual(same.persona.goals.map((goal) => goal.text), ['Follow Player']);
	});

	it('recalls world knowledge beside memory for leftover English, with no lookup tool of its own', async () => {
		let grepped = '';
		const provider = new FakeProvider((req) => {
			const hasTool = req.messages.some((m) => m.role === 'tool');
			if (!hasTool && req.tools?.some((t) => t.name === 'recall')) {
				const system = String(req.messages.find((m) => m.role === 'system')?.content);
				assert.match(system, /recall also searches what you know of the world/);
				assert.deepEqual(req.tools?.map((t) => t.name).filter((name) => name !== 'recall' && name !== 'earshot'), []);
				return {
					content: null,
					toolCalls: [{
						id: 'g1',
						name: 'recall',
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
			// Native tool calls, as a model asked for plain JSON makes them.
			arcFormat: 'json',
			model: 'fake',
			hideObserve: true,
			toolRoundCap: 1,
			arcRetryCap: 0,
			strategicInterval: 0,
			knowledge: [{
				name: 'Tree',
				aliases: ['trees'],
				text: 'Landmark type. Many; not reachable with go_to.',
			}],
		});
		await agent.mind!.tick(1);
		const { remember, know } = JSON.parse(grepped) as { remember:unknown[]; know:string[] };
		assert.ok(Array.isArray(remember));
		assert.match(know[0] ?? '', /^Tree \(trees\)/);
		assert.match(know[0] ?? '', /not reachable with go_to/);
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

	it('omits other verbs from a tool description when the kit does not grant them', async () => {
		let description = '';
		const provider = new FakeProvider((req) => {
			description = req.tools?.find((tool) => tool.name === 'see_map')?.description ?? '';
			return { content: '{"steps":[{"verb":"wait"}]}', toolCalls: [] };
		});
		const verbs = registerStockVerbs(new VerbRegistry());
		await soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Look around' }],
			provider,
			verbs,
			kit: { verbs: ['wait'] },
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			// Native tool calls, as a model asked for plain JSON makes them.
			arcFormat: 'json',
			model: 'fake',
			toolRoundCap: 1,
			arcRetryCap: 0,
			vision: true,
			map: {
				snapshot: () => ({
					image: 'data:image/png;base64,xx',
					width: 4,
					height: 4,
					toPixel: () => ({ u: 0, v: 0 }),
					marks: [],
				}),
			},
		}).mind!.tick(1);
		assert.match(description, /Look here before you ask where something is/);
		assert.equal(description.includes('wander'), false);
		const withWander = new FakeProvider((req) => {
			description = req.tools?.find((tool) => tool.name === 'see_map')?.description ?? '';
			return { content: '{"steps":[{"verb":"wait"}]}', toolCalls: [] };
		});
		await soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Look around' }],
			provider: withWander,
			verbs,
			kit: { verbs: ['wait', 'wander'] },
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			arcFormat: 'json',
			model: 'fake',
			toolRoundCap: 1,
			arcRetryCap: 0,
			vision: true,
			map: {
				snapshot: () => ({
					image: 'data:image/png;base64,xx',
					width: 4,
					height: 4,
					toPixel: () => ({ u: 0, v: 0 }),
					marks: [],
				}),
			},
		}).mind!.tick(1);
		assert.match(description, /Look here before you wander/);
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
			// Native tool calls, as a model asked for plain JSON makes them.
			arcFormat: 'json',
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
		assert.equal(arc?.[0].verb, 'go_to');
	});

	it('runs see_map written as arc text as the tool call it meant, picture and all', async () => {
		let calls = 0;
		let snaps = 0;
		const provider = new FakeProvider((req) => {
			calls += 1;
			if (calls === 1) {
				return { content: 'see_map({zoom:1})', toolCalls: [] };
			}
			const last = req.messages[req.messages.length - 1];
			assert.equal(last?.role, 'user');
			assert.match(String(last?.content), /Those were tools written as text; they ran anyway:\nsee_map: /);
			assert.ok(req.messages.some((m) => Array.isArray(m.content)), 'the map picture came along');
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
			arcFormat: 'text',
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
		assert.equal(snaps, 1);
		assert.equal(arc?.[0].verb, 'wait');
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
			// Native tool calls, as a model asked for plain JSON makes them.
			arcFormat: 'json',
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
				content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }),
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
			content: JSON.stringify({ steps: [{ verb: 'go_to', target: 'EastGate' }, { verb: 'think', about: 'how to open it' }] }),
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
		assert.equal(arc?.[0].verb, 'go_to');
		assert.equal(agent.toJSON().mind!.thinkAbout, 'how to open it');
		assert.equal(agent.toJSON().mind!.lastVerb, 'think');
	});

	it('moves think to the end and concatenates abouts', async () => {
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({ steps: [{ verb: 'think', about: 'the lock' }, { verb: 'go_to', target: 'EastGate', then: 'always' }, { verb: 'think', about: 'which key' }] }),
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
		assert.equal(arc?.[0].verb, 'go_to');
		assert.equal(arc?.[0].then, 'always');
		assert.equal(arc?.[1].verb, 'think');
		assert.equal(arc?.[1].args.about, 'the lock which key');
		assert.equal(agent.toJSON().mind!.thinkAbout, 'the lock which key');
		assert.equal(agent.toJSON().mind!.lastVerb, 'think');
	});

	it('tick occupies a think slot; enact arms wait(until) and notes the queue', async () => {
		const think = withPriorityQueue({ watchInterval: 100, processInterval: 0 });
		const q = think.queue;
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({ steps: [{ verb: 'go_to', target: 'EastGate', then: 'always' }, { verb: 'wait', until: 'hasHeard' }] }),
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
		assert.equal(arc?.[0].verb, 'go_to');
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
				content: JSON.stringify({ steps: [{ verb: 'wait' }] }),
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
		assert.equal(first?.[0].verb, 'wait');
		const skipped = await agent.mind!.tick(2);
		assert.equal(skipped, null);
		const forced = await agent.mind!.thinkNow({ about: 'the gate', enact: false });
		assert.equal(forced?.[0].verb, 'wait');
		assert.equal(q.inFlight, 0);
		assert.equal(q.isThinking('Guard'), false);
	});

	it('replaces a live arc when the current verb did not change during think', async () => {
		const think = withPriorityQueue({ watchInterval: 100, processInterval: 0 });
		let releaseGoTo:(()=>void) | undefined;
		const chats:Array<{ enableThinking?:boolean; fakeThought?:boolean; user:string }> = [];
		const replies = [
			JSON.stringify({ steps: [{ verb: 'go_to', target: 'EastGate' }] }),
			JSON.stringify({ steps: [{ verb: 'wait' }] }),
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
		assert.equal(next?.[0].verb, 'wait');
		assert.equal(agent.mind!.lastArc?.[0].verb, 'wait');
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
					content: JSON.stringify({ steps: [{ verb: 'go_to', target: 'EastGate', then: 'always' }, { verb: 'pick_up', item: 'Lantern' }] }),
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
			// Native tool calls, as a model asked for plain JSON makes them.
			arcFormat: 'json',
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
			content: JSON.stringify({ steps: [{ verb: 'wander' }] }),
			toolCalls: [],
		});
		const arc = await second;
		assert.equal(arc?.[0].verb, 'wander');
		assert.equal(agent.mind!.lastArc?.[0].verb, 'wander');
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
					content: JSON.stringify({ steps: [{ verb: 'go_to', target: 'EastGate', then: 'always' }, { verb: 'pick_up', item: 'Lantern' }] }),
					toolCalls: [],
				};
			}
			if (chats.length === 2) {
				return new Promise((resolve) => {
					hangThink = resolve;
				});
			}
			return {
				content: JSON.stringify({ steps: [{ verb: 'wait' }] }),
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
			// Native tool calls, as a model asked for plain JSON makes them.
			arcFormat: 'json',
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
			content: JSON.stringify({ steps: [{ verb: 'wander' }] }),
			toolCalls: [],
		});
		const arc = await second;
		assert.equal(arc?.[0].verb, 'wait');
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
			arcFormat: 'text',
			...extra,
		});
	}

	it('repairs a truncated reply without parsing it or reasoning', async () => {
		const thinking:Array<boolean | undefined> = [];
		const provider = new FakeProvider((req) => {
			thinking.push(req.enableThinking);
			if (thinking.length === 1) {
				return { content: 'go_to(Kee', toolCalls: [], truncated: true };
			}
			if (thinking.length === 2) {
				assert.match(String(req.messages.at(-1)?.content), /cut off at the token limit/);
				assert.equal(req.messages.some((m) => String(m.content).includes('go_to(Kee')), false);
				return { content: 'nonsense(', toolCalls: [] };
			}
			return { content: 'go_to(EastGate)', toolCalls: [] };
		});
		const arc = await agentOf(provider).mind!.tick(1);
		assert.equal(arc?.[0].args.target, 'EastGate');
		assert.deepEqual(thinking, [true, false, false]);
	});

	it('answers from a thought the thinking budget cut short, without thinking again', async () => {
		const thinking:(boolean | undefined)[] = [];
		const provider = new FakeProvider((req) => {
			thinking.push(req.enableThinking);
			if (thinking.length === 1) {
				return { content: null, reasoning: 'The bridge is closed, so the EastGate is the way out', toolCalls: [], truncated: true };
			}
			assert.equal(req.messages.at(-2)?.role, 'assistant');
			assert.equal(req.messages.at(-2)?.content, 'The bridge is closed, so the EastGate is the way out');
			assert.match(String(req.messages.at(-1)?.content), /time to think is up/);
			return { content: 'go_to(EastGate)', toolCalls: [] };
		});
		const arc = await agentOf(provider).mind!.tick(1);
		assert.equal(arc?.[0].args.target, 'EastGate');
		assert.deepEqual(thinking, [true, false]);
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

describe('arcFormat schema', () => {
	const steps = JSON.stringify({ steps: [{ verb: 'go_to', target: 'EastGate' }] });
	const recall = (query:string):string => JSON.stringify({ tool: 'recall', query });

	/** A guard whose model says `replies` in turn (the last one again after that); `seen` takes every request. */
	function schemaGuard(replies:string[], seen:ChatRequest[], extra:Partial<SoloOptions<Ctx>> = {}):Character<Ctx> {
		let n = 0;
		return soloCharacter<Ctx>({
			id: 'Guard',
			identity: { role: 'guard' },
			goals: [{ text: 'Go to EastGate' }],
			provider: new FakeProvider((req) => {
				seen.push(req);
				return { content: replies[Math.min(n++, replies.length - 1)], toolCalls: [] };
			}),
			...stockVerbs(),
			...perception(),
			context: () => ({ paragraph: paragraph() }),
			model: 'fake',
			heartbeat: 0,
			strategicInterval: 0,
			arcRetryCap: 0,
			arcFormat: 'schema',
			...extra,
		});
	}

	it('asks for the reply schema, and offers tools as replies, never as native tools', async () => {
		const seen:ChatRequest[] = [];
		const arc = await schemaGuard([steps], seen).mind!.tick(1);
		assert.equal(arc?.[0].args.target, 'EastGate');
		assert.equal(seen[0].responseFormat?.name, 'reply');
		assert.equal(seen[0].tools, undefined);
		assert.equal(seen[0].toolChoice, undefined);
		const system = chatContentText(seen[0].messages[0].content);
		assert.match(system, /Tools this think, not verbs: recall, observe\. Call one by replying \{"tool":"name","argument":"value"\}/);
		assert.match(system, /Reply \{"tool":"recall","query":"Bread"\}/);
		const schema = seen[0].responseFormat!.schema as { anyOf:{ properties:{ tool?:{ const:string } } }[] };
		assert.deepEqual(schema.anyOf.slice(0, -1).map((branch) => branch.properties.tool?.const), ['recall', 'observe', 'earshot', 'see_map']);
	});

	it('looks a tool up from its reply, then answers with the steps', async () => {
		const seen:ChatRequest[] = [];
		const guard = schemaGuard([recall('gate'), steps], seen);
		await guard.mind!.remember('EastGate is the door in the east wall', ['gate', 'EastGate'], 0);
		const arc = await guard.mind!.tick(1);
		assert.equal(arc?.[0].verb, 'go_to');
		assert.equal(seen.length, 2);
		assert.equal(seen.every((req) => req.responseFormat?.name === 'reply' && req.tools === undefined), true, 'every request carries the schema, or it would go to the responses API without one');
		const [call, answer] = seen[1].messages.slice(-2);
		assert.equal(call.role, 'assistant');
		assert.equal(chatContentText(call.content), recall('gate'));
		assert.equal(answer.role, 'user');
		assert.match(chatContentText(answer.content), /^recall: .*EastGate is the door.*\nLook up something else, or reply with the steps\. Names only/s);
	});

	it('tells the model when a lookup was its last', async () => {
		const seen:ChatRequest[] = [];
		await schemaGuard([recall('gate'), steps], seen, { toolRoundCap: 1 }).mind!.tick(1);
		assert.match(chatContentText(seen[1].messages.at(-1)?.content), /That was your last lookup; reply with the steps now\./);
	});

	it('repairs a tool this mind lacks, and one called past the cap', async () => {
		const lacking = schemaGuard([JSON.stringify({ tool: 'observe', expr: 'isNear(me, EastGate)' }), steps], [], { hideObserve: true });
		await assert.rejects(lacking.mind!.tick(1), /observe is not a tool you have/);
		const over = schemaGuard([recall('gate'), recall('door'), steps], [], { toolRoundCap: 1 });
		await assert.rejects(over.mind!.tick(1), /no lookups left/);
		const seen:ChatRequest[] = [];
		const repaired = schemaGuard([JSON.stringify({ tool: 'observe', expr: 'x' }), steps], seen, { hideObserve: true, arcRetryCap: 1 });
		assert.equal((await repaired.mind!.tick(1))?.[0].verb, 'go_to');
		assert.match(chatContentText(seen[1].messages.at(-1)?.content), /observe is not a tool you have/);
		assert.equal(seen[1].enableThinking, false, 'a repair does not reason again');
	});

	it('reads a verb the schema allows but this kit does not as a repair', async () => {
		const seen:ChatRequest[] = [];
		const guard = schemaGuard([JSON.stringify({ steps: [{ verb: 'use', item: 'Lever' }] })], seen, { kit: { verbs: ['go_to', 'wait'] } });
		await assert.rejects(guard.mind!.tick(1), /unknown verb 'use'/);
		assert.match(JSON.stringify(seen[0].responseFormat?.schema), /"const":"use"/, 'the schema holds the whole catalog, not the kit');
	});

	it('asks for the steps again, without a canned thought, when the live verb changed, and a tool reply keeps the first arc', async () => {
		const think = withPriorityQueue({ watchInterval: 100, processInterval: 0 });
		const gates = new Map<string, (result:{ ok:boolean; interrupted?:boolean; verb:string })=>void>();
		let hangThink:((res:{ content:string; toolCalls:[] })=>void) | undefined;
		const chats:ChatRequest[] = [];
		const provider = new FakeProvider((req) => {
			chats.push(req);
			if (chats.length === 1) {
				return { content: JSON.stringify({ steps: [{ verb: 'go_to', target: 'EastGate', then: 'always' }, { verb: 'pick_up', item: 'Lantern' }] }), toolCalls: [] };
			}
			if (chats.length === 2) {
				return new Promise((resolve) => {
					hangThink = resolve;
				});
			}
			return { content: recall('lantern'), toolCalls: [] };
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
			arcFormat: 'schema',
		});
		void agent.mind!.tick(1);
		await waitUntil(() => gates.has('go_to'));
		const second = agent.mind!.tick(2);
		await waitUntil(() => hangThink !== undefined);
		gates.get('go_to')!({ ok: true, verb: 'go_to' });
		await waitUntil(() => agent.toJSON().mind!.lastVerb === 'pick_up');
		hangThink!({ content: JSON.stringify({ steps: [{ verb: 'wander' }] }), toolCalls: [] });
		const arc = await second;
		assert.equal(arc?.[0].verb, 'wander', 'the tool reply is not steps, so the first arc stands');
		assert.equal(chats.length, 3);
		assert.equal(chats[2].enableThinking, false);
		assert.equal(chats[2].fakeThought, undefined);
		assert.equal(chats[2].responseFormat?.name, 'reply');
		assert.match(chatContentText(chats[2].messages.at(-1)?.content), /live verb changed from go_to to pick_up[^]*repeat the steps you already wrote to keep them/);
	});

	it('is one schema for every mind, whatever its kit or tools', async () => {
		const seen:ChatRequest[] = [];
		await schemaGuard([steps], seen, { kit: { verbs: ['go_to', 'wait'] } }).mind!.tick(1);
		await schemaGuard([steps], seen, { toolRoundCap: 0 }).mind!.tick(1);
		await schemaGuard([steps], seen, { hideObserve: true }).mind!.tick(1);
		const bytes = seen.map((req) => JSON.stringify(req.responseFormat));
		assert.equal(new Set(bytes).size, 1);
	});
});
