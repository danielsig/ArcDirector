import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArcText } from './arc/arc-parse.js';
import { STOCK_VERB_DEFS, STOCK_VERBS, VerbRegistry } from './arc/stock-verbs.js';
import { arcJSONText } from './arc/wire.js';
import { STOCK_COLLECTIVE_VERB_DEFS } from './collective/collective-verbs.js';
import { HANDOVER_THREAD } from './collective/handover.js';
import { ArcDirector } from './director/ArcDirector.js';
import { FakeProvider } from './inference/fake.js';
import type { ChatContent, ChatRequest, ChatResponse } from './inference/provider.js';
import type { ArcFormat } from './mind/mind-types.js';
import type { PromptStyle } from './mind/prompt.js';
import { playScenario, type Scenario, type SceneCtx } from './scenario/play.js';
import { US } from './scenario/scene-world.js';
import { sleep } from './turn.js';

/**
 * Every prompt the library sends, byte for byte, for fixed scripted scenes: a refactor must leave what a model reads
 * as it was. A change on purpose rewrites the files with `UPDATE_SNAPSHOTS=1` (in a commit of its own, after a look
 * at the AI log). The files sit beside this file's source, not its build.
 */
const SNAPSHOTS = fileURLToPath(new URL('../src/prompt-snapshots/', import.meta.url));

function matchesSnapshot(name:string, text:string):void {
	const file = `${SNAPSHOTS}${name}.txt`;
	if (process.env.UPDATE_SNAPSHOTS === '1') {
		writeFileSync(file, text);
		return;
	}
	assert.ok(existsSync(file), `no snapshot ${name}: run with UPDATE_SNAPSHOTS=1`);
	assert.equal(text, readFileSync(file, 'utf8'), `prompt ${name} changed`);
}

/** A message's content as the model reads it; an image by its hash. */
function contentText(content:ChatContent):string {
	if (!Array.isArray(content)) {
		return content ?? '(none)';
	}
	return content.map((part) => (part.type === 'text' ? part.text : `[image ${createHash('sha256').update(part.image_url.url).digest('hex').slice(0, 16)}]`)).join('\n');
}

/** The requests of one scene, each written down as it reaches the server: a think keeps adding to its messages after. */
class Sent {
	private readonly _texts:string[] = [];
	/** The request each long field or message was first written in, by what it says. */
	private readonly _written = new Map<string, number>();

	public get count():number {
		return this._texts.length;
	}

	public add(req:ChatRequest):void {
		const n = this._texts.length + 1;
		const lines = Object.entries(req)
			// What reaches the model; an abort signal and a stream listener do not.
			.filter(([key, value]) => value !== undefined && !['messages', 'signal', 'onDelta'].includes(key))
			.map(([key, value]) => `${key}: ${this.once(`${key}: `, JSON.stringify(value, null, '\t'), n)}`);
		this._texts.push([
			`# request ${n}\n${lines.join('\n')}`,
			...req.messages.map((m) => {
				const calls = m.toolCalls ? ` calls ${JSON.stringify(m.toolCalls)}` : '';
				const answers = m.toolCallID ? ` answers ${m.toolCallID}` : '';
				const head = `## ${m.role}${calls}${answers}\n`;
				return `${head}${this.once(head, contentText(m.content), n)}`;
			}),
		].join('\n\n'));
	}

	/** `text`, or where it was written already when it is long: a think's later requests repeat its first one's messages. */
	private once(under:string, text:string, n:number):string {
		const key = `${under}${text}`;
		const first = this._written.get(key);
		if (first !== undefined) {
			return `(as in request ${first})`;
		}
		if (text.length > 200) {
			this._written.set(key, n);
		}
		return text;
	}

	public toString():string {
		return `${this._texts.join('\n\n')}\n`;
	}
}

/** What the fake model writes for one think request: Arc text, or tool calls. */
type Reply = string | { tools:Record<string, Record<string, unknown>> } | ChatResponse;

/** Stock verbs, to write an Arc as JSON for a model writing `json` or `schema`. */
const VERBS = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);

/**
 * A fake model on its own server that sees (so `see_map` is offered), writing `replies` in turn for thinks, the last
 * again after; a System One pick gets `A`, anything else `{}`. Each request is written down as it comes.
 */
function scriptedModel<TCtx>(format:ArcFormat, style:PromptStyle, replies:Reply[], sent:Sent):(director:ArcDirector<TCtx>)=>void {
	let n = 0;
	let calls = 0;
	const answer = (reply:Reply):ChatResponse => {
		if (typeof reply !== 'string') {
			return 'tools' in reply
				? { content: null, toolCalls: Object.entries(reply.tools).map(([name, args]) => ({ id: `call${++calls}`, name, arguments: JSON.stringify(args) })) }
				: reply;
		}
		if (format === 'text') {
			return { content: reply, toolCalls: [] };
		}
		// A tool written in the reply's own JSON, or an Arc.
		return { content: reply.startsWith('{') ? reply : arcJSONText(parseArcText(reply, VERBS), VERBS), toolCalls: [] };
	};
	const chat = (req:ChatRequest):ChatResponse => {
		sent.add(req);
		if (req.topLogprobs !== undefined) {
			return { content: 'A', toolCalls: [] };
		}
		return req.thread && req.thread !== HANDOVER_THREAD ? answer(replies[Math.min(n++, replies.length - 1)]) : { content: '{}', toolCalls: [] };
	};
	return (director) => director
		.withMind((m) => m.withArcFormat(format))
		.addInference('fake', new FakeProvider(chat), { vision: true })
		.addModel('main', { id: 'fake', prompt: style });
}

/**
 * One character with everything on: sight, carrying, talk, hearing (with a noisy verb), the map, knowledge mentions,
 * offers, currency, a pinned memory, a host verb and an alias with a watch (which makes `law`'s own watch optional).
 */
const MARKET:Scenario = {
	me: { id: 'Hilde', hp: [8, 12] },
	role: 'Herbalist',
	gold: 9,
	carrying: ['Basket'],
	memories: [{ text: 'Bram keeps his prices high until asked twice.', pinned: true }],
	know: [{ name: 'Gisele', aliases: ['salt', 'Saltworks'], text: 'Gisele sells Salt at the Saltworks, 2 gold a pouch.' }],
	others: {
		Bram: { away: 3, side: 'ahead', carrying: ['Candle', 'Candle'], offers: [{ give: { Candle: 1 }, get: { gold: 3 } }] },
		Odo: { away: 30, side: 'right' },
	},
	things: {
		Well: { away: 6, side: 'left', description: 'An old stone Well.' },
		Bell: { away: 20, side: 'behind' },
	},
	heard: [{ from: 'Bram', text: 'Ask Gisele about salt, she is cheaper.' }],
	goal: 'Buy a Candle and some salt',
	verbs: {
		ring: { args: { target: 'id' }, help: 'rings a bell', run: () => 'it rings' },
		hush: { arc: 'wait(seconds=1)', watch: 'me.hp < 4' },
	},
	noise: { go_to: { name: 'footsteps', loudness: 0.4 } },
	sees: (_world, _from, to) => to !== 'Bell',
	blocks: (_world, point) => (Math.hypot(...point) > 20 ? 'the river' : undefined),
	act: (world, director) => {
		if (world.time >= 1 && !world.flags.has('rang')) {
			world.flags.add('rang');
			director.emitSound('Bell', { name: 'bell', loudness: 1 });
		}
	},
	thinks: 2,
	seconds: 12,
	done: () => false,
};

/** The first think looks everything up (as tool calls, or written in the reply), then sets a law; the second says a line no one can hear, then trades. */
function marketReplies(format:ArcFormat):Reply[] {
	const lookUps:Reply[] = format === 'text'
		? [{ tools: { recall: { query: 'salt' }, observe: { expr: 'others' }, earshot: {}, see_map: {} } }, 'recall(query=Candle)']
		: ['{"tool":"recall","query":"salt"}', '{"tool":"observe","expr":"others"}'];
	return [
		...lookUps,
		'law(name=flee, watch=me.hp < 3, arc=go_to(target=Well)) && examine(target=Well)',
		'say(to=Odo, text="Come here")',
		'offer(to=Bram, give={"gold":3}, get={"Candle":1})',
	];
}

/** A commander and two units: the collective's roster, its orders. */
const SQUAD:Scenario = {
	me: { id: 'Cap', as: 'Rifleman' },
	squad: { Kell: { away: 1, side: 'left', as: 'Rifleman' }, Mira: { away: 1, side: 'right', as: 'Rifleman', tags: ['Scout'] } },
	others: { Raider: { away: 9, side: 'ahead', hp: [20, 20] } },
	goal: 'Hold the line',
	thinks: 1,
	seconds: 4,
	done: () => false,
};

/** A village in an RTS: its commander's stock, supply and grouped units. */
const VILLAGE:Scenario = {
	me: { id: 'Aldwyn' },
	rts: {
		kinds: {
			Hall: { provides: 5, tags: ['Building', 'DropOff:Wood'] },
			Worker: { cost: { Gold: 50 }, seconds: 4, supply: 1, madeAt: ['Hall'], tags: ['Worker'] },
			Grove: { tags: ['Node:Wood'] },
		},
		stock: { [US]: { Wood: 0, Gold: 60 } },
	},
	squad: {
		Hall: { away: 3, side: 'behind', kind: 'Hall' },
		Harrik: { away: 1, side: 'left', kind: 'Worker' },
		Bodil: { away: 1, side: 'right', kind: 'Worker' },
	},
	things: { Grove: { away: 10, side: 'ahead', kind: 'Grove', amount: 400 } },
	goal: 'Get 100 Wood into your stock',
	thinks: 1,
	seconds: 2,
	done: () => false,
};

type Ctx = { id:string };

async function waitFor(fn:()=>boolean):Promise<void> {
	for (let tries = 0; !fn(); tries++) {
		if (tries > 200) {
			throw new Error('timeout');
		}
		await sleep(5);
	}
}

/** A plain director on the scripted model: stock verbs, a scene sense, every verb done at once. */
function director(format:ArcFormat, replies:Reply[], sent:Sent):ArcDirector<Ctx> {
	const director = new ArcDirector<Ctx>()
		.withPriorityQueue({ processInterval: 0, heartbeatStart: 100, heartbeatMin: 100 })
		.withIntervals({ watch: 0, think: 0 })
		.addStockVerbs()
		.withDefaultKit({ verbs: STOCK_VERBS })
		.onVerb((call) => ({ status: 'ok', verb: call.verb }))
		.addSense('scene', { description: 'What you can see. Names only.', gather: () => 'A damp stone hall. EastGate stands in the east wall. A Well.' })
		.withContext((id) => ({ id }));
	scriptedModel<Ctx>(format, 'full', replies, sent)(director);
	return director;
}

describe('prompt snapshots', () => {
	for (const [format, style] of [['text', 'full'], ['json', 'full'], ['schema', 'full'], ['schema', 'compact']] as const) {
		it(`a character with everything on, ${format} ${style}`, async () => {
			const sent = new Sent();
			await playScenario(MARKET, scriptedModel(format, style, marketReplies(format), sent));
			matchesSnapshot(`market-${format}-${style}`, String(sent));
		});
	}

	for (const [format, style] of [['text', 'full'], ['schema', 'compact']] as const) {
		it(`a collective and its roster, ${format} ${style}`, async () => {
			const sent = new Sent();
			await playScenario(SQUAD, scriptedModel(format, style, ['command(who=units.filter("Scout"), arc=go_to(target=Raider))'], sent));
			matchesSnapshot(`squad-${format}-${style}`, String(sent));
		});
	}

	it('an RTS commander', async () => {
		const sent = new Sent();
		await playScenario(VILLAGE, scriptedModel('text', 'full', ['gather(from=Wood)'], sent));
		matchesSnapshot('village-text-full', String(sent));
	});

	for (const format of ['text', 'schema'] as const) {
		it(`the strategic pass, ${format}`, async () => {
			const sent = new Sent();
			const goals = format === 'text' ? 'set_goal(text="Guard the Well", priority=2)' : { content: '{"goals":[{"text":"Guard the Well","priority":2}]}', toolCalls: [] };
			const built = await director(format, [goals, 'go_to(target=EastGate)'], sent)
				.addCharacter({ id: 'Guard', mind: { skipHeartbeat: true }, identity: { role: 'Gate guard', traits: ['dutiful'] }, goals: [{ text: 'Keep the gate', priority: 1 }] })
				.connect();
			built.pushEvent({ kind: 'alarm', text: 'The bell rings.', major: true });
			built.tick(1);
			await waitFor(() => sent.count >= 2);
			await sleep(10);
			built.dispose();
			matchesSnapshot(`strategic-${format}`, String(sent));
		});
	}

	it('repairs: a bad reply, part of one, a thought cut short, and the same Arc again', async () => {
		const sent = new Sent();
		const built = await director('text', [
			'jump(target=Well)',
			'say(text="Wait for me") ; law(name=hide, watch=me.hp < < 3, arc=wait(seconds=1))',
			{ content: null, reasoning: 'The Well is near. I should look at it', truncated: true, toolCalls: [] },
			'examine(target=Well)',
			'examine(target=Well)',
			'go_to(target=EastGate)',
		], sent)
			.withMind((m) => m.withRepairRetries(4).withRepairPerStep())
			.addCharacter({ id: 'Guard', mind: { skipHeartbeat: true, skipStrategic: true }, identity: { role: 'Gate guard' }, goals: [{ text: 'Look around', priority: 1 }] })
			.connect();
		const queue = built.mindQueue()!;
		queue.enqueueMajor('Guard');
		built.tick(1);
		await waitFor(() => sent.count >= 4 && !queue.isThinking('Guard'));
		await sleep(10);
		queue.enqueueMajor('Guard');
		built.tick(1);
		await waitFor(() => sent.count >= 6 && !queue.isThinking('Guard'));
		built.dispose();
		matchesSnapshot('repairs-text', String(sent));
	});

	it('the replace question', async () => {
		const sent = new Sent();
		const built = await director('schema', ['loop(arc=go_to(target=EastGate) && go_to(target=Well))', 'examine(target=Well)'], sent)
			.onVerb((call) => (call.verb === 'go_to' ? new Promise(() => undefined) : { status: 'ok', verb: call.verb }))
			.withReplaceCheck()
			.addCharacter({ id: 'Guard', mind: { skipHeartbeat: true, skipStrategic: true }, identity: { role: 'Gate guard' } })
			.connect();
		const queue = built.mindQueue()!;
		queue.enqueueMajor('Guard');
		built.tick(1);
		await waitFor(() => sent.count >= 1 && !queue.isThinking('Guard'));
		await sleep(10);
		queue.enqueueMajor('Guard');
		built.tick(1);
		await waitFor(() => sent.count >= 3 && !queue.isThinking('Guard'));
		built.dispose();
		matchesSnapshot('replace-schema', String(sent));
	});

	it('System One: the choice question, and a chat model asked to pick', async () => {
		const sent = new Sent();
		const built = await director('text', ['wait(seconds=1)'], sent)
			.addModel('decider', { id: 'fake', decision: true })
			.addCharacter({ id: 'Sentry', systemOne: 'decider', choose: { goal: 'Keep the gate', hold: 'wait(seconds=1)', patrol: 'go_to(target=EastGate)' } })
			.connect();
		const question = built.choiceQuestion('Sentry', { look: 'examine(target=Well)', leave: 'go_to(target=EastGate)' }, { doing: 'wait' });
		built.tick(1);
		await waitFor(() => sent.count >= 1);
		built.dispose();
		matchesSnapshot('system-one', `# choiceQuestion ${JSON.stringify(question, null, 2)}\n\n${String(sent)}`);
	});

	it('the memory handover', async () => {
		const sent = new Sent();
		const member = (id:string, role:string) => ({ id, identity: { role } });
		const built = await director('text', ['wait(seconds=1)'], sent)
			.addCollective({ id: 'Watch', mind: { skipHeartbeat: true, skipStart: true }, identity: { role: 'The night watch' }, characters: [member('Ada', 'Watchman'), member('Bo', 'Watchman')], memories: [{ text: 'Ada keeps the keys.' }] })
			.addCollective({ id: 'Smiths', mind: { skipHeartbeat: true, skipStart: true }, identity: { role: 'The smithy' }, characters: [member('Cy', 'Smith')] })
			.connect();
		built.character('Ada')!.collective = built.collective('Smiths')!;
		built.tick(1);
		await waitFor(() => sent.count >= 1);
		built.dispose();
		matchesSnapshot('handover', String(sent));
	});
});
