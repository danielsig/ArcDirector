import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArcText } from '../arc/arc-parse.js';
import { formatArc } from '../arc/arc-format.js';
import { chatContentText } from '../inference/provider.js';
import { parseArc } from '../arc/wire.js';
import { BlockedArcError, isArc, type Arc, type ArcResult } from '../arc/arc-types.js';
import { VerbRegistry, STOCK_VERB_DEFS, STOCK_VERBS } from '../arc/stock-verbs.js';
import { dummyEntity } from '../expr/natives.js';
import {
	formatSightClauses,
	joinSightClauses,
	mergeHiveClauses,
	orderSightClauses,
} from '../perception/sight.js';
import { ArcDirector } from '../director/ArcDirector.js';
import '../director/shortcuts.js';
import type { CollectiveSpec, VerbCall } from '../director/director-types.js';
import type { Collective, CollectiveJSON } from './Collective.js';
import type { Law } from '../arc/laws.js';
import { STOCK_COLLECTIVE_VERB_DEFS, STOCK_COLLECTIVE_VERBS } from './collective-verbs.js';
import { squadTag } from './tags.js';
import { OPEN_WORLD } from '../testing/open-world.js';
import { Mind } from '../mind/mind.js';
import { TalkFeature } from '../mind/TalkFeature.js';
import { KnowledgeFeature } from '../mind/KnowledgeFeature.js';
import { InventoryFeature } from '../perception/carrying.js';
import type { ThinkEvent } from '../mind/mind-types.js';
import { sleep } from '../turn.js';

type Ctx = { id:string };

async function waitFor(fn:()=>boolean, ms = 400):Promise<void> {
	const t0 = Date.now();
	while (!fn()) {
		if (Date.now() - t0 > ms) {
			throw new Error('timeout');
		}
		await sleep(10);
	}
}

function collectiveVerbs():VerbRegistry {
	return new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);
}

const COLLECTIVE_KIT = { verbs: [...STOCK_VERBS, ...STOCK_COLLECTIVE_VERBS] };

function kernels(hurt:Set<string> = new Set()) {
	return (ctx:Ctx) => ({
		me: dummyEntity(ctx.id, { tags: ['character'] }),
		others: [],
		items: [],
		nearRadius: 8,
		distance: () => 4,
		hp: (who:{ id:string }) => (
			hurt.has(who.id) ? { hp: 1, maxHP: 5 } : { hp: 5, maxHP: 5 }
		),
		point: (who:{ id:string }) => {
			if (who.id === 'Mira') {
				return { x: 0, z: 0 };
			}
			if (who.id === 'Tomas') {
				return { x: 4, z: 0 };
			}
			return { x: 0, z: 0 };
		},
	});
}

async function hiveOf(opts:{
	calls?:VerbCall<Ctx>[];
	hurt?:Set<string>;
	slow?:boolean;
	/** Calls that never finish on their own: still running however long a test takes to look. */
	hold?:(call:VerbCall<Ctx>)=>boolean;
	kit?:{ verbs:string[] };
	commander?:string;
} = {}):Promise<ArcDirector<Ctx>> {
	const director = await new ArcDirector<Ctx>()
		.withPriorityThinkQueue({
			processInterval: 0,
			heartbeatStart: 100,
			heartbeatMin: 100,
		})
		.withIntervals({ watch: 0, think: 0 })
		.addFake()
		.withVerbs((v) => v.addStock()
			.addStockCollective())
		.withDefaultKit(COLLECTIVE_KIT)
		.withSight({ limit: 16 })
		.withKernels(kernels(opts.hurt))
		.onVerb(async (call) => {
			opts.calls?.push(call);
			if (opts.hold?.(call)) {
				await new Promise(() => {});
			}
			if (opts.slow) {
				await sleep(40);
			}
			return { status: 'ok', verb: call.verb };
		})
		.withContext((id) => ({ id }))
		.addCollective({
			id: 'Hive',
			mind: { skipHeartbeat: true },
			kit: opts.kit ?? COLLECTIVE_KIT,
			identity: { role: 'Keeps the square moving.' },
			pinnedSightFocus: ['isHurt(it)'],
			sightFocus: ['isNear(it, Player)'],
			characters: [
				{ id: 'Mira', tags: ['Guard'] },
				{ id: 'Tomas', tags: ['Guard'] },
			],
			laws: [{
				name: 'flee',
				who: 'units.filter(u => !u.busy)',
				watch: 'isHurt(me)',
				arc: 'go_to(Keep)',
				pinned: true,
			}],
			commander: opts.commander,
		})
		.connect();
	return director;
}

/** The hive the tests build with `hiveOf`. */
function hive(director:ArcDirector<Ctx>):Collective<Ctx> {
	return director.collective('Hive')!;
}

async function hangingDawn():Promise<{
	director:ArcDirector<Ctx>;
	party:Collective<Ctx>;
	calls:VerbCall<Ctx>[];
	pending:Promise<unknown>;
	release:()=>void;
}> {
	const calls:VerbCall<Ctx>[] = [];
	let release:()=>void = () => undefined;
	const hang = new Promise<void>((resolve) => {
		release = resolve;
	});
	const director = await new ArcDirector<Ctx>()
		.withMind({ arcFormat: 'text' })
		.addFake({ chat: async () => {
			await hang;
			return { content: 'go_to(Keep)', toolCalls: [] };
		} })
		.withVerbs((v) => v.addStock()
			.addStockCollective())
		.withDefaultKit(COLLECTIVE_KIT)
		.withKernels(kernels())
		.onVerb((call) => {
			calls.push(call);
			return { status: 'ok', verb: call.verb };
		})
		.withContext((id) => ({ id }))
		.addCollective({
			id: 'DawnParty',
			mind: { skipHeartbeat: true },
			kit: COLLECTIVE_KIT,
			commander: 'Dawn',
			identity: { role: 'Leads.' },
			characters: [{ id: 'Dawn' }, { id: 'Wisp' }],
		})
		.connect();
	const party = director.collective('DawnParty')!;
	const pending = party.mind.tick(1);
	await sleep(20);
	return { director, party, calls, pending, release };
}

type Hang = Awaited<ReturnType<typeof hangingDawn>>;

describe('Collective chain', () => {
	it('addStockCollectiveVerbs registers; kit must still grant when', async () => {
		const director = await new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit({ verbs: ['wait'] })
			.withContext((id) => ({ id }))
			.addCollective({
				id: 'Hive',
				mind: { skipHeartbeat: true },
				kit: { verbs: ['wait'] },
				identity: { role: 'Waits.' },
				characters: [{ id: 'Mira' }],
			})
			.connect();
		const hive = director.collective('Hive')!;
		assert.ok(hive.verbs.has('command'));
		assert.equal(hive.activeVerbs().has('command'), false);
		assert.ok(hive.verbs.has('when'));
		director.dispose();
	});

	it('refuses a spec with more laws than its maxLaws, rather than dropping the rest', async () => {
		const laws = ['a', 'b', 'c'].map((name) => ({ name, watch: '1 > 0', arc: 'wait()' }));
		await assert.rejects(async () => {
			await new ArcDirector<Ctx>()
				.addFake()
				.withVerbs((v) => v.addStock()
					.addStockCollective())
				.withDefaultKit({ verbs: ['wait'] })
				.withContext((id) => ({ id }))
				.addCollective({ id: 'Hive', maxLaws: 2, laws, kit: { verbs: ['wait'] }, identity: { role: 'Waits.' }, characters: [{ id: 'Mira' }] })
				.connect();
		}, /Hive: law c is past its 2 laws/);
	});

	it('addCharacter and addLaw stay open after connect', async () => {
		const director = await hiveOf();
		const pike = hive(director).addCharacter({ id: 'Pike', tags: ['Flank'] }).character('Pike')!;
		hive(director).addLaw({
			name: 'follow',
			who: 'units.filter("Pike")',
			watch: 'isNear(me, Player)',
			arc: 'follow(Player)',
		});
		assert.equal(hive(director).character('Pike'), pike);
		assert.equal(director.character('Pike'), pike);
		assert.equal(pike.collective, hive(director));
		assert.ok(hive(director).laws.some((s) => s.name === 'follow'));
		assert.deepEqual(pike.tags, ['Flank']);
		assert.throws(() => hive(director).addCharacter({ id: 'Mira' }), /already a character or a collective/);
		director.dispose();
	});

	it('evaluate and holds take a collective id, seeing as its laws do', async () => {
		const director = await hiveOf();
		assert.equal(director.evaluate('Hive', 'units').error, undefined);
		assert.equal(director.holds('Hive', 'units.filter("Pike")'), false);
		hive(director).addCharacter({ id: 'Pike', tags: ['Flank'] });
		assert.equal(director.holds('Hive', 'units.filter("Flank")'), true);
		director.dispose();
	});

	it('removeCharacter drops them from the roster and command who', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		hive(director).removeCharacter('Mira');
		const hive1 = hive(director);
		assert.equal(hive1.character('Mira'), undefined);
		assert.equal(director.character('Mira'), undefined);
		const text = hive1.promptSection(hive1.mind);
		assert.equal(/Mira/.test(text), false);
		await hive1.enact(parseArc('command(who=allUnits, arc=go_to(Keep))', hive1.verbs));
		await waitFor(() => calls.some((c) => c.verb === 'go_to'));
		assert.equal(calls.some((c) => c.character.id === 'Mira'), false);
		assert.equal(calls.some((c) => c.character.id === 'Tomas' && c.verb === 'go_to'), true);
		director.dispose();
	});

	it('removeCharacter leaves the host\'s spec whole for the next director', async () => {
		const party:CollectiveSpec<Ctx> = {
			id: 'DawnParty',
			mind: { skipHeartbeat: true },
			kit: { verbs: ['wait'] },
			commander: 'Dawn',
			characters: [{ id: 'Dawn' }, { id: 'Wisp' }],
		};
		const build = ():Promise<ArcDirector<Ctx>> => new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit({ verbs: ['wait'] })
			.withContext((id) => ({ id }))
			.addCollective(party)
			.connect();
		const first = await build();
		first.removeCharacter('Dawn');
		first.dispose();
		const next = await build();
		assert.equal(next.collective('DawnParty')?.commander?.id, 'Dawn');
		next.dispose();
	});

	it('a character keeps its own kit in a collective; the roster says what it alone can do and what it cannot', async () => {
		const director = await new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withContext((id) => ({ id }))
			.onVerb(({ verb }) => ({ status: 'ok', verb }))
			.withDefaultKit({ verbs: ['go_to', 'follow'] })
			.addCharacter({ id: 'Tom', kit: { verbs: ['go_to', 'wander'] } })
			.addCollective({
				id: 'DawnParty',
				mind: { skipHeartbeat: true },
				kit: { verbs: ['go_to', 'follow', 'command'] },
				characters: [{ id: 'Ann' }],
			})
			.connect();
		const party = director.collective('DawnParty')!;
		const verbsOf = (id:string) => director.character(id)!.activeVerbs().list().map((v) => v.name).sort();
		assert.deepEqual(verbsOf('Ann'), ['follow', 'go_to']);
		director.character('Tom')!.collective = party;
		assert.deepEqual(verbsOf('Tom'), ['go_to', 'wander']);
		const roster = party.promptSection(party.mind);
		assert.match(roster, /^\| Ann \| [^|]* \| [^|]* \| idle \| — \| — \| — \|$/m);
		assert.match(roster, /^\| Tom \| [^|]* \| [^|]* \| idle \| — \| — \| wander; not follow \|$/m);
		director.dispose();
	});

	it('names units ordered together a group: its own name or a letter, kept by its larger part, one row in the roster', async () => {
		const director = await new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withContext((id) => ({ id }))
			.withKernels(kernels())
			.onVerb(() => new Promise<ArcResult>(() => undefined))
			.addCollective({ id: 'Host', mind: { skipHeartbeat: true }, kit: { verbs: ['go_to', 'command'] }, characters: ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => ({ id, tags: ['Blade'] })) })
			.connect();
		const host = director.collective('Host')!;
		const [a, b, c, d, e, f] = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => director.character(id)!);
		const march:Arc = [{ verb: 'go_to', args: { target: 'Ford' } }];
		const groupOf = (character:typeof a):string[] => character.tags.filter((t) => host.ownsTag(t)).map((t) => host.shortOf(t));
		assert.equal(host.command([a, b, c, d, e, f], march, 'Pack'), 'Pack');
		assert.deepEqual(groupOf(a), ['Pack']);
		assert.match(host.promptSection(host.mind), /^\| Pack \| 6 Blade \|/m, 'one row for the group, its kind without its name');
		assert.equal(host.command([a, b], march), 'Pack2', 'a few split off unnamed are named after it');
		assert.equal(host.command([c, d, e], march), 'Pack', 'most of it, unnamed, keeps its name');
		assert.deepEqual(groupOf(f), [], 'and the one left behind loses it');
		host.command([d], march);
		assert.deepEqual(groupOf(d), [], 'one sent alone leaves its group');
		assert.equal(host.command([d, f], march), 'Alpha', 'from no group: a letter');
		host.command([c], march);
		assert.deepEqual(groupOf(e), ['Pack'], 'the last one left keeps its tag');
		assert.match(host.promptSection(host.mind), /^\| E \| Blade \|/m, 'but shows by its own name');
		const result = await host.enact(parseArc('command(who=units.filter(u => u is "Blade"), arc=go_to(Ford))', host.verbs));
		assert.equal(result.reason, 'no group= given: called them Bravo', 'told the name it was given');
		host.command([a, b, c, d, e], march, 'Bravo2');
		assert.equal(host.command([a, b], march), 'Bravo3', 'a split off a split counts on from its name, not onto it');
		director.dispose();
	});

	it('says on each roster line what the unit is at: its step in its verb\'s words, or how its program ended and its last step', async () => {
		let release:((r:ArcResult)=>void) | undefined;
		const director = await new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withContext((id) => ({ id }))
			.onVerb(({ verb }) => (verb === 'go_to'
				? new Promise<ArcResult>((done) => {
					release = done;
				})
				: { status: 'failed', verb, reason: 'no target' }))
			.addCollective({ id: 'DawnParty', mind: { skipHeartbeat: true }, kit: { verbs: ['go_to', 'follow', 'command'] }, characters: [{ id: 'Ann' }, { id: 'Bo' }] })
			.connect();
		const party = director.collective('DawnParty')!;
		void director.character('Ann')!.enact([{ verb: 'go_to', args: { target: 'Cottage' } }]);
		await director.character('Bo')!.enact([{ verb: 'follow', args: { target: 'Ann' } }]);
		const roster = party.promptSection(party.mind);
		assert.match(roster, /^\| Ann \| [^|]* \| [^|]* \| going to Cottage \|/m);
		assert.match(roster, /^\| Bo \| [^|]* \| [^|]* \| failed: no target \| follow failed: no target \|/m);
		release?.({ status: 'ok', verb: 'go_to' });
		director.dispose();
	});

	it('enact on a character runs the arc on that character and returns the result', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const mira = hive(director).character('Mira');
		assert.ok(mira);
		const result = await mira.enact(parseArc('go_to(Keep)', mira.verbs));
		assert.equal(result.status === 'ok', true);
		assert.equal(result.verb, 'go_to');
		assert.equal(calls.some((c) => c.character.id === 'Mira' && c.verb === 'go_to'), true);
		assert.equal(calls.some((c) => c.character.id === 'Tomas'), false);
		director.dispose();
	});
});

describe('command(who)', () => {
	it('parses unquoted who= and nested arc=', () => {
		const registry = collectiveVerbs();
		const arc = parseArcText(
			'command(who=units.filter("Loaf").filter(u => !u.busy), arc=go_to(BakerStall)) '
			+ '; command(who=units.filter("Guard"), arc=go_to(Tomas) && give(item=Loaf, to=Tomas))',
			registry,
		);
		assert.equal(arc[0].verb, 'command');
		assert.equal(arc[0].args.who, 'units.filter("Loaf").filter(u => !u.busy)');
		assert.equal(isArc(arc[0].args.arc), true);
		assert.deepEqual((arc[0].args.arc as Arc).map((step) => step.verb), ['go_to']);
		assert.equal(arc[1].verb, 'command');
		assert.equal(arc[0].then, 'always');
		assert.deepEqual((arc[1].args.arc as Arc).map((step) => step.verb), ['go_to', 'give']);
		assert.match(formatArc(arc), /command\(/);
	});

	it('is instantaneous and fans out to each character', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, slow: true });
		const hive = director.collective('Hive')!;
		const t0 = Date.now();
		const result = await hive.enact(parseArc(
			'command(who=units.filter("Guard"), arc=go_to(Keep))',
			hive.verbs,
		));
		assert.ok(Date.now() - t0 < 30);
		assert.equal(result.status === 'ok', true);
		assert.equal(result.verb, 'command');
		await waitFor(() => calls.some((c) => c.verb === 'go_to' && c.character.id === 'Mira'));
		assert.ok(calls.some((c) => c.verb === 'go_to' && c.character.id === 'Tomas'));
		assert.equal(calls.some((c) => c.verb === 'command'), false);
		director.dispose();
	});

	it('command ; command starts both groups without waiting on characters', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, slow: true });
		const hive = director.collective('Hive')!;
		const result = await hive.enact(parseArc(
			'command(who=units.filter("Mira"), arc=go_to(WestGate)) '
			+ '; command(who=units.filter("Tomas"), arc=go_to(EastGate))',
			hive.verbs,
		));
		assert.equal(result.status === 'ok', true);
		await waitFor(() => (
			calls.some((c) => c.character.id === 'Mira' && String(c.args.target) === 'WestGate')
			&& calls.some((c) => c.character.id === 'Tomas' && String(c.args.target) === 'EastGate')
		));
		director.dispose();
	});

	it('inner arc= is sequential per unit', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc(
			'command(who=units.filter("Mira"), arc=go_to(Tomas) && examine(Tomas))',
			hive.verbs,
		));
		await waitFor(() => calls.filter((c) => c.character.id === 'Mira').length >= 2);
		const mine = calls.filter((c) => c.character.id === 'Mira').map((c) => c.verb);
		assert.deepEqual(mine.slice(0, 2), ['go_to', 'examine']);
		director.dispose();
	});

	it('who= uses units not others; later when interrupts that unit only', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, hold: (call) => call.args.target === 'Keep' });
		const hive = director.collective('Hive')!;
		void hive.enact(parseArc(
			'command(who=units.filter("Guard"), arc=go_to(Keep))',
			hive.verbs,
		));
		await waitFor(() => hive.character('Mira')?.busy === true);
		await hive.enact(parseArc(
			'command(who=units.filter("Mira"), arc=go_to(Home))',
			hive.verbs,
		));
		await waitFor(() => calls.some((c) => c.character.id === 'Mira' && String(c.args.target) === 'Home'));
		assert.ok(hive.character('Tomas')?.busy);
		director.dispose();
	});

	it('meetup wander(until) uses inner me = unit', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc(
			// Not near yet: an until that already holds would end the wander before it began.
			'command(who=units.filter("Mira"), arc=wander(until=isNear(me, Tomas, 1))) '
			+ '; command(who=units.filter("Tomas"), arc=wander(until=isNear(me, Mira, 1)))',
			hive.verbs,
		));
		await waitFor(() => calls.filter((c) => c.verb === 'wander').length >= 2);
		const mira = calls.find((c) => c.character.id === 'Mira' && c.verb === 'wander');
		const tomas = calls.find((c) => c.character.id === 'Tomas' && c.verb === 'wander');
		assert.equal(mira?.args.until, 'isNear(me, Tomas, 1)');
		assert.equal(tomas?.args.until, 'isNear(me, Mira, 1)');
		director.dispose();
	});

	it('each character issued a formation takes its own place in the same squad', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc(
			'command(who=units.filter("Guard"), arc=hold_line(at=WestGate, facing=Player))',
			hive.verbs,
		));
		await waitFor(() => calls.filter((c) => c.verb === 'hold_line').length === 2);
		const lines = calls.filter((c) => c.verb === 'hold_line');
		assert.deepEqual(lines.map((c) => c.character.id).sort(), ['Mira', 'Tomas']);
		for (const line of lines) {
			assert.deepEqual(line.character.squad, ['Mira', 'Tomas']);
		}
		director.dispose();
	});
});

describe('laws and tags', () => {
	it('hurt unit gets go_to without a think; no per-tick restart; when(who) wins', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const hurt = new Set(['Mira']);
		const director = await hiveOf({ calls, hurt, slow: true });
		const hive = director.collective('Hive')!;
		assert.equal(hive.mind.lastArc, undefined);
		director.tick(1);
		await waitFor(() => calls.some((c) => c.character.id === 'Mira' && c.verb === 'go_to'));
		assert.equal(hive.mind.lastArc, undefined);
		const n = calls.filter((c) => c.character.id === 'Mira' && c.verb === 'go_to').length;
		director.tick(1);
		await sleep(20);
		assert.equal(calls.filter((c) => c.character.id === 'Mira' && c.verb === 'go_to').length, n);
		await hive.enact(parseArc(
			'command(who=units.filter("Mira"), arc=go_to(Home))',
			hive.verbs,
		));
		await waitFor(() => calls.some((c) => c.character.id === 'Mira' && String(c.args.target) === 'Home'));
		director.dispose();
	});

	it('tags are namespaced per conductor', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb((call) => {
				calls.push(call);
				return { status: 'ok', verb: call.verb };
			})
			.withContext((id) => ({ id }))
			.addCollective({
				id: 'Red',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				identity: { role: 'Commands red.' },
				characters: [{ id: 'Able', tags: ['Guard'] }],
			})
			.addCollective({
				id: 'Blue',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				identity: { role: 'Commands blue.' },
				characters: [{ id: 'Baker', tags: ['Guard'] }],
			})
			.connect();
		const red = director.collective('Red')!;
		const blue = director.collective('Blue')!;
		assert.deepEqual(red.character('Able')?.tags, ['Guard']);
		await red.enact(parseArc('command(who=units.filter("Guard"), arc=go_to(Keep))', red.verbs));
		await waitFor(() => calls.some((c) => c.character.id === 'Able'));
		assert.equal(calls.some((c) => c.character.id === 'Baker'), false);
		await red.enact(parseArc('tag(who=units.filter("Able"), name=Flank)', red.verbs));
		assert.ok(red.character('Able')?.tags.includes(squadTag('Red', 'Flank')));
		assert.equal(blue.character('Baker')?.tags.includes(squadTag('Red', 'Flank')), false);
		await red.enact(parseArc('untag(who=units.filter("Able"), name=Flank)', red.verbs));
		assert.deepEqual(red.character('Able')?.tags, ['Guard']);
		director.dispose();
	});
});

describe('commander and sightFocus', () => {
	it('commander mixes own go_to with when(who)', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb((call) => {
				calls.push(call);
				return { status: 'ok', verb: call.verb };
			})
			.withContext((id) => ({ id }))
			.addCollective({
				id: 'Guards',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				identity: { role: 'Leads.' },
				commander: 'Captain',
				characters: [{ id: 'Captain' }, { id: 'Mira', tags: ['Guard'] }],
			})
			.connect();
		const captain = director.collective('Guards')!.voice;
		assert.equal(captain, director.character('Captain'));
		await captain.enact(parseArc(
			'command(who=units.filter("Mira"), arc=go_to(Keep)) ; go_to(WestGate)',
			captain.verbs,
		));
		await waitFor(() => (
			calls.some((c) => c.character.id === 'Mira' && c.verb === 'go_to')
			&& calls.some((c) => c.character.id === 'Captain' && String(c.args.target) === 'WestGate')
		));
		director.dispose();
	});

	it('pinnedSightFocus stays; focus edits extras; sightLimit slices clauses', async () => {
		const clauses = [
			{ text: 'A damp hall', claimedIDs: [] as string[], ambient: true },
			{ text: 'pebble', claimedIDs: ['Pebble'] },
			{ text: 'Mira hurt', claimedIDs: ['Mira'] },
			{ text: 'Player near', claimedIDs: ['Player'] },
			{ text: 'Door', claimedIDs: ['Door'] },
		];
		const scores = new Map([['Mira', 1], ['Player', 0.8], ['Pebble', 0], ['Door', 0]]);
		const ranked = orderSightClauses(clauses, scores, 3, true);
		assert.equal(ranked[0].ambient, true);
		assert.equal(ranked[1].text, 'Mira hurt');
		assert.equal(ranked[2].text, 'Player near');
		assert.equal(ranked.length, 3);
		const director = await hiveOf();
		const conductor = hive(director);
		assert.deepEqual(conductor.persona.pinnedSightFocus, ['isHurt(it)']);
		assert.deepEqual(conductor.persona.sightFocus, ['isNear(it, Player)']);
		assert.equal((await conductor.perform({ verb: 'focus', args: { expr: 'isHurt(it)' } })).status === 'ok', false);
		await conductor.perform({ verb: 'focus', args: { expr: 'isNear(it, EastGate)' } });
		await conductor.perform({ verb: 'unfocus', args: { expr: 'isNear(it, Player)' } });
		assert.deepEqual(conductor.persona.pinnedSightFocus, ['isHurt(it)']);
		assert.deepEqual(conductor.persona.sightFocus, ['isNear(it, EastGate)']);
		director.dispose();
	});

	it('hive merge keeps disjoint stalls and fromName leftovers', () => {
		const west = formatSightClauses({
			self: { id: 'Mira', point: [0, 0] },
			ambient: 'A square.',
			objects: [
				{ id: 'WestStall', point: [2, 0], tags: ['landmark', 'stall'], interactable: true, movable: false },
				{ id: 'Door', point: [8, 0], tags: ['door'], interactable: true, movable: false },
			],
		}, { fromName: 'Mira' });
		const east = formatSightClauses({
			self: { id: 'Tomas', point: [40, 0] },
			ambient: 'A square.',
			objects: [
				{ id: 'EastStall', point: [42, 0], tags: ['landmark', 'stall'], interactable: true, movable: false },
			],
		}, { fromName: 'Tomas', skipAmbient: true });
		const merged = mergeHiveClauses([
			{ unitID: 'Mira', clauses: west },
			{ unitID: 'Tomas', clauses: east },
		]);
		const text = joinSightClauses(merged);
		assert.match(text, /WestStall/);
		assert.match(text, /EastStall/);
		assert.match(text, /from Mira/);
		assert.equal((text.match(/A square/g) ?? []).length, 1);
		const overlap = mergeHiveClauses([
			{ unitID: 'Mira', clauses: [{ text: 'Mira holding Loaf', claimedIDs: ['Mira', 'Loaf'] }] },
			{ unitID: 'Tomas', clauses: [{ text: 'Mira nearby', claimedIDs: ['Mira'] }] },
		]);
		assert.equal(overlap.length, 1);
	});
});

describe('characters, laws, dummy me', () => {
	it('parallel when(who) keeps each character apart', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, slow: true });
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc(
			'command(who=units.filter("Mira"), arc=go_to(WestGate)) '
			+ '; command(who=units.filter("Tomas"), arc=go_to(EastGate))',
			hive.verbs,
		));
		await waitFor(() => (
			calls.some((c) => c.character.id === 'Mira' && c.verb === 'go_to')
			&& calls.some((c) => c.character.id === 'Tomas' && c.verb === 'go_to')
		));
		for (const call of calls.filter((c) => c.verb === 'go_to')) {
			if (call.character.id === 'Mira') {
				assert.equal(String(call.args.target), 'WestGate');
			}
			if (call.character.id === 'Tomas') {
				assert.equal(String(call.args.target), 'EastGate');
			}
		}
		director.dispose();
	});

	it('when(who) does not drop laws', async () => {
		const director = await hiveOf();
		const hive = director.collective('Hive')!;
		assert.ok(hive.laws.some((l) => l.name === 'flee'));
		await hive.enact(parseArc(
			'command(who=units.filter("Mira"), arc=say("hold"))',
			hive.verbs,
		));
		assert.ok(hive.laws.some((l) => l.name === 'flee'));
		director.dispose();
	});

	it('a unit reads itself as me in its law, not its commander', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, hurt: new Set(['Tomas']), commander: 'Mira' });
		director.tick(1);
		// Only Tomas is hurt: read as the unhurt commander, his law would never start.
		await waitFor(() => calls.some((c) => c.character.id === 'Tomas' && c.verb === 'go_to'));
		director.dispose();
	});

	it('watch false aborts a running law', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const hurt = new Set(['Mira']);
		const director = await hiveOf({ calls, hurt, slow: true });
		const hive = director.collective('Hive')!;
		director.tick(1);
		await waitFor(() => hive.character('Mira')?.busy === true);
		hurt.delete('Mira');
		director.tick(1);
		await waitFor(() => hive.character('Mira')?.busy === false);
		director.dispose();
	});

	it('a hive with no commander uses dummy me and skips carrying', async () => {
		let hiveCarry = 0;
		const director = await new ArcDirector<Ctx>()
			.withWorld(OPEN_WORLD)
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.addFeature(new InventoryFeature((ctx) => {
				if (ctx.id === 'Hive') {
					hiveCarry += 1;
				}
				return { pockets: [] };
			}))
			.withContext((id) => id === 'Hive' ? undefined : { id })
			.addCollective({
				id: 'Hive',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				identity: { role: 'Sees.' },
				characters: [
					{ id: 'Mira', tags: ['Guard'] },
					{ id: 'Tomas', tags: ['Guard'] },
				],
			})
			.connect();
		director.tick(1);
		assert.equal(hiveCarry, 0);
		director.dispose();
	});

	it('a formation after other steps runs when they are done', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc(
			'command(who=units.filter("Mira"), arc=go_to(Keep) && hold_line(at=WestGate, facing=Player))',
			hive.verbs,
		));
		await waitFor(() => calls.some((c) => c.verb === 'hold_line'));
		const line = calls.find((c) => c.verb === 'hold_line')!;
		assert.equal(line.character.id, 'Mira');
		assert.deepEqual(line.character.squad, ['Mira']);
		assert.ok(calls.findIndex((c) => c.verb === 'go_to') < calls.indexOf(line));
		director.dispose();
	});
});

describe('commander pointer and sticky command', () => {
	it('thinkThread and identity follow the living commander', async () => {
		const director = await new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb(() => ({ status: 'ok', verb: 'go_to' }))
			.withContext((id) => ({ id }))
			.addCollective({
				id: 'DawnParty',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				commander: 'Dawn',
				identity: { role: 'Leads.' },
				characters: [{ id: 'Dawn' }, { id: 'Wisp' }],
			})
			.connect();
		const party = director.collective('DawnParty')!;
		assert.equal(party.mind.thinkThread(), 'Dawn');
		assert.equal(party.mind.id, 'DawnParty');
		director.removeCharacter('Dawn');
		assert.equal(party.mind.thinkThread(), 'DawnParty');
		party.commander = party.character('Wisp')!;
		assert.equal(party.mind.thinkThread(), 'Wisp');
		director.dispose();
	});

	it('does not ask a think again when only the commander\'s own step changed while it thought', async () => {
		const gates:Array<()=>void> = [];
		let hangThink:((content:string)=>void) | undefined;
		let chats = 0;
		const director = await new ArcDirector<Ctx>()
			.withMind({ arcFormat: 'text' })
			.addFake({ chat: async () => {
				chats += 1;
				const content = chats === 1 ? 'go_to(Keep) ; wander()' : await new Promise<string>((resolve) => {
					hangThink = resolve;
				});
				return { content, toolCalls: [] };
			} })
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb(async (call) => {
				if (call.verb !== 'say') {
					await new Promise<void>((resolve) => {
						gates.push(resolve);
					});
				}
				return { status: 'ok', verb: call.verb };
			})
			.onAbortArc(() => {
				gates.forEach((release) => release());
			})
			.withContext((id) => ({ id }))
			.addCollective({
				id: 'DawnParty',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				commander: 'Dawn',
				identity: { role: 'Leads.' },
				characters: [{ id: 'Dawn' }, { id: 'Wisp' }],
			})
			.connect();
		const party = director.collective('DawnParty')!;
		void party.mind.tick(1);
		await waitFor(() => gates.length === 1);
		const second = party.mind.tick(2);
		await waitFor(() => hangThink !== undefined);
		gates[0]();
		await waitFor(() => party.mind.toJSON().lastVerb === 'wander');
		hangThink!('say("Onward!")');
		assert.equal((await second)?.[0].verb, 'say');
		assert.equal(chats, 2);
		director.dispose();
	});

	for (const [name, abort] of [
		['abortThink', (h:Hang) => h.party.mind.abortThink()],
		['director.abortThink', (h:Hang) => h.director.queue.abortThink('DawnParty')],
		['vacating the commander', (h:Hang) => h.director.removeCharacter('Dawn')],
		['removeCollective', (h:Hang) => h.director.removeCollective('DawnParty')],
		['setAiOn(false)', (h:Hang) => h.director.queue?.setAiOn('DawnParty', false)],
	] as const) {
		it(`${name} aborts the in-flight think`, async () => {
			const h = await hangingDawn();
			abort(h);
			assert.equal(await h.pending, null);
			assert.equal(h.calls.length, 0);
			h.release();
			h.director.dispose();
		});
	}

	it('command(me) fails, as does a command that picks no unit; allUnits skips the commander', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb((call) => {
				calls.push(call);
				return { status: 'ok', verb: call.verb };
			})
			.withContext((id) => ({ id }))
			.addCollective({
				id: 'Guards',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				commander: 'Captain',
				identity: { role: 'Leads.' },
				characters: [
					{ id: 'Captain', tags: ['Lead'] },
					{ id: 'Mira', tags: ['Guard'] },
				],
			})
			.connect();
		const guards = director.collective('Guards')!;
		assert.equal(guards.commander?.id, 'Captain');
		const captain = guards.voice;
		const me = await captain.enact(parseArc('command(who=me, arc=go_to(Keep))', captain.verbs));
		assert.equal(me.status === 'ok', false);
		assert.equal(calls.some((c) => c.character.id === 'Captain' && c.verb === 'go_to'), false);
		const nobody = await captain.enact(parseArc('command(who=units.filter("Archer"), arc=go_to(Keep))', captain.verbs));
		assert.equal(nobody.status === 'ok', false);
		assert.match(nobody.reason ?? '', /picks no unit/);
		await captain.enact(parseArc('command(who=allUnits, arc=go_to(Home))', captain.verbs));
		await waitFor(() => calls.some((c) => c.character.id === 'Mira' && String(c.args.target) === 'Home'));
		assert.equal(calls.some((c) => c.character.id === 'Captain' && String(c.args.target) === 'Home'), false);
		director.dispose();
	});

	it('refuses a command that names more units than maxUnitsPerCommand', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb((call) => {
				calls.push(call);
				return { status: 'ok', verb: call.verb };
			})
			.withContext((id) => ({ id }))
			.addCollective({
				id: 'Hive',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				maxUnitsPerCommand: 1,
				identity: { role: 'Leads.' },
				characters: [
					{ id: 'Mira', tags: ['Shopper'] },
					{ id: 'Tomas', tags: ['Shopper'] },
				],
			})
			.connect();
		const hive = director.collective('Hive')!;
		const all = await hive.enact(parseArc('command(who=units.filter("Shopper"), arc=go_to(Baker))', hive.verbs));
		assert.equal(all.status === 'ok', false);
		assert.match(all.reason ?? '', /that is 2 units; a command names one/);
		assert.equal(calls.length, 0);
		const one = await hive.enact(parseArc('command(who=units.filter("Mira"), arc=go_to(Baker))', hive.verbs));
		assert.equal(one.status === 'ok', true);
		await waitFor(() => calls.some((c) => c.character.id === 'Mira'));
		assert.equal(calls.some((c) => c.character.id === 'Tomas'), false);
		assert.match(hive.promptSection(hive.mind), /a command names one unit/);
		director.dispose();
	});

	it('groups identical unit programs in the prompt section', async () => {
		const director = await hiveOf({ slow: true });
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc(
			'command(who=units.filter("Guard"), arc=go_to(Keep))',
			hive.verbs,
		));
		await waitFor(() => hive.character('Mira')?.busy === true && hive.character('Tomas')?.busy === true);
		const text = hive.promptSection(hive.mind);
		assert.match(text, /^programs\/Alpha\.arc \(units\.filter\("Alpha"\) = Mira 5\/5 hp, Tomas 5\/5 hp; running 0s\)\n\{"steps":\[\{"verb":"go_to","target":"Keep"\}\]\} \/\/ ← now, 0s$/m);
		director.dispose();
	});

	it('shows how each unit program is going, failures with why and choose picks', async () => {
		const director = await hiveOf({ slow: true });
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc('command(who=units.filter("Guard"), arc=go_to(Keep))', hive.verbs));
		await waitFor(() => hive.character('Mira')?.busy === true);
		const mira = hive.character('Mira')!;
		mira.record.note({ status: 'ok', verb: 'shoot' });
		for (let i = 0; i < 3; i++) {
			mira.record.note({ status: 'failed', verb: 'shoot', reason: 'no line of sight' });
		}
		mira.record.picked('nearest');
		mira.record.picked('finish');
		mira.record.picked('nearest');
		assert.match(hive.promptSection(hive.mind), /- Mira: shoot 1 ok, 3 failed \(no line of sight ×3\), picked nearest ×2, finish/);
		await mira.enact(parseArc('go_to(Home)', mira.verbs));
		assert.equal(String(mira.record), 'go_to 1 ok', 'a new program starts a new record');
		director.dispose();
	});

	it('lists idle roster tags in the prompt section', async () => {
		const director = await hiveOf();
		const hive = director.collective('Hive')!;
		const text = hive.promptSection(hive.mind);
		assert.match(text, /Units \(command who=units\.filter\("Tag"\)/);
		assert.match(text, /^\| Mira \| Guard \|/m);
		assert.match(text, /^\| Tomas \| Guard \|/m);
		director.dispose();
	});

	it('does not start a law on a unit with no host context', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await new ArcDirector<Ctx>()
			.withPriorityThinkQueue({
				processInterval: 0,
				heartbeatStart: 100,
				heartbeatMin: 100,
			})
			.withIntervals({ watch: 0, think: 0 })
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels(new Set(['Mira', 'Tomas'])))
			.onVerb((call) => {
				calls.push(call);
				return { status: 'ok', verb: call.verb };
			})
			.withContext((id) => (id === 'Mira' ? undefined : { id }))
			.addCollective({
				id: 'Hive',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				identity: { role: 'Keeps the square moving.' },
				characters: [
					{ id: 'Mira', tags: ['Guard'] },
					{ id: 'Tomas', tags: ['Guard'] },
				],
				laws: [{
					name: 'flee',
					who: 'units',
					watch: 'isHurt(me)',
					arc: 'go_to(Keep)',
					pinned: true,
				}],
			})
			.connect();
		director.tick(1);
		await waitFor(() => calls.some((c) => c.character.id === 'Tomas' && c.verb === 'go_to'));
		assert.equal(calls.some((c) => c.character.id === 'Mira'), false);
		director.dispose();
	});

	it('vacates the commander on commander = null', async () => {
		const vacant:{ collective:string; character:string }[] = [];
		const director = await new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb(() => ({ status: 'ok', verb: 'go_to' }))
			.withContext((id) => ({ id }))
			.onCommanderVacant((collective, character) => vacant.push({ collective: collective.id, character: character.id }))
			.addCollective({
				id: 'Guards',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				commander: 'Captain',
				identity: { role: 'Leads.' },
				characters: [{ id: 'Captain' }, { id: 'Mira' }],
			})
			.connect();
		const guards = director.collective('Guards')!;
		guards.commander = null;
		assert.deepEqual(vacant, [{ collective: 'Guards', character: 'Captain' }]);
		assert.equal(guards.commander, null);
		director.dispose();
	});
});

describe('laws with an exit', () => {
	it('times=1 runs once for each unit it reaches, then the law is gone, pinned or not', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.collective('Hive')!;
		hive.addLaw({ name: 'cheer', watch: '1 > 0', arc: 'go_to(Home)', times: 1 }, true);
		director.tick(1);
		assert.ok(!hive.laws.some((law) => law.name === 'cheer'));
		await waitFor(() => calls.length === 2);
		await sleep(20);
		director.tick(1);
		await sleep(20);
		assert.deepEqual(calls.map((c) => c.character.id).sort(), ['Mira', 'Tomas']);
		director.dispose();
	});

	it('counts and reads until per unit, and keeps its progress in a save', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.collective('Hive')!;
		hive.addLaw({ name: 'mira', watch: 'me.id == "Mira"', arc: 'go_to(Home)', times: 1 });
		hive.addLaw({ name: 'tomas', watch: '1 > 2', arc: 'go_to(Home)', until: 'me.id == "Tomas"' });
		director.tick(1);
		await waitFor(() => calls.length === 1);
		assert.equal(calls[0].character.id, 'Mira');
		const named = (name:string):Law | undefined => hive.laws.find((law) => law.name === name);
		assert.deepEqual(named('mira')?.progress, { Mira: { runs: 1 }, Tomas: { runs: 0 } }, 'Tomas has not run it, so it stays');
		assert.deepEqual(named('tomas')?.progress, { Mira: { runs: 0 }, Tomas: { runs: 0, ended: true } }, 'over for Tomas alone');
		const saved = JSON.parse(JSON.stringify(hive.toJSON())) as CollectiveJSON;
		assert.deepEqual(saved.laws?.find((law) => law.name === 'mira')?.progress, named('mira')?.progress);
		director.dispose();
	});

	it('a solo law with times=1 goes by itself, and comes back from a save with its count', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const build = ():ArcDirector<Ctx> => new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock())
			.withKernels(kernels())
			.onVerb((call) => {
				calls.push(call);
				return { status: 'ok', verb: call.verb };
			})
			.withContext((id) => ({ id }))
			.addCharacter({
				id: 'Guard',
				mind: { skipHeartbeat: true, skipStart: true },
				kit: { verbs: [...STOCK_VERBS] },
				identity: { role: 'Watches.' },
				laws: [{ name: 'speech', watch: '1 > 0', arc: 'go_to(Keep)', times: 2 }],
			});
		const first = await build().connect();
		first.tick(1);
		await waitFor(() => calls.length === 1);
		const law = first.character('Guard')!.laws.find((l) => l.name === 'speech');
		assert.deepEqual(law?.progress, { Guard: { runs: 1 } });
		const saved = JSON.parse(JSON.stringify(first.exportCast()));
		first.dispose();
		const second = build();
		second.restoreCast(saved);
		await second.connect();
		const guard = second.character('Guard')!;
		assert.deepEqual(guard.laws.find((l) => l.name === 'speech')?.progress, { Guard: { runs: 1 } });
		second.tick(1);
		await waitFor(() => calls.length === 2);
		assert.ok(!guard.laws.some((l) => l.name === 'speech'));
		await sleep(20);
		second.tick(1);
		await sleep(20);
		assert.equal(calls.length, 2);
		second.dispose();
	});

	it('a law written by a mind\'s Arc takes times and until', async () => {
		const director = await hiveOf();
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc('law(who=units, watch=1 > 2, arc=wait(), name=x, times=1, until=1 > 2)', hive.verbs));
		const law = hive.laws.find((l) => l.name === 'x');
		assert.equal(law?.times, 1);
		assert.equal(law?.until, '1 > 2');
		assert.match(hive.mind.lawsSection(), /times=1, until 1 > 2/);
		director.dispose();
	});

	it('a parked program whose when has finished is no longer busy, and goes on', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const mira = director.character('Mira')!;
		void mira.enact(parseArc('when(watch=1 > 0, arc=go_to(Home), times=1)', mira.verbs));
		director.tick(1);
		await waitFor(() => calls.length === 1);
		await waitFor(() => !mira.busy);
		assert.ok(mira.arc, 'its program is still there');
		await sleep(20);
		director.tick(1);
		await sleep(20);
		assert.equal(calls.length, 1);
		director.dispose();
	});
});

describe('solo law', () => {
	it('survives think and omits who from the kit', async () => {
		const director = await new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock())
			.withKernels(kernels())
			.onVerb(() => ({ status: 'ok', verb: 'go_to' }))
			.withContext((id) => ({ id }))
			.addCharacter({
				id: 'Guard',
				mind: { skipHeartbeat: true },
				kit: { verbs: [...STOCK_VERBS] },
				identity: { role: 'Watches.' },
				laws: [{
					name: 'flee',
					watch: 'isHurt(me)',
					arc: 'go_to(Keep)',
				}],
			})
			.connect();
		const guard = director.character('Guard');
		assert.ok(guard);
		assert.ok(guard.laws.some((l) => l.name === 'flee'));
		assert.equal(guard.activeVerbs().get('law')?.args.who, undefined);
		await guard.enact(parseArc('go_to(EastGate)', guard.verbs));
		assert.ok(guard.laws.some((l) => l.name === 'flee'));
		assert.throws(
			() => parseArcText('law(who=me, watch=isHurt(me), arc=go_to(Keep))', guard.activeVerbs()),
			/has no arg 'who'/,
		);
		director.dispose();
	});
});

describe('transfers', () => {
	/** Tom on his own with a `flee` law, and two parties. A held go_to keeps an arc running until `release`. */
	async function stage(opts:{ hurt?:Set<string>; vacant?:string[] } = {}) {
		const calls:VerbCall<Ctx>[] = [];
		let release:()=>void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const director = await new ArcDirector<Ctx>()
			.addFake({ chat: () => ({ content: 'wait()', toolCalls: [] }) })
			.withMind({ arcFormat: 'text' })
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels(opts.hurt))
			.onVerb(async (call) => {
				calls.push(call);
				if (call.verb === 'go_to') {
					await held;
				}
				return { status: 'ok', verb: call.verb };
			})
			.withContext((id) => ({ id }))
			.onCommanderVacant((party, character) => opts.vacant?.push(`${party.id}:${character.id}`))
			.addCharacter({
				id: 'Tom',
				mind: { skipHeartbeat: true, rank: 2 },
				kit: COLLECTIVE_KIT,
				identity: { role: 'Scouts.' },
				laws: [
					{ name: 'flee', watch: 'isHurt(me)', arc: 'go_to(Keep)' },
				],
			})
			.addCollective({
				id: 'DawnParty',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				commander: 'Dawn',
				identity: { role: 'Leads.' },
				characters: [{ id: 'Dawn' }, { id: 'Wisp' }],
			})
			.addCollective({
				id: 'DuskParty',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				commander: 'Dusk',
				identity: { role: 'Leads.' },
				characters: [{ id: 'Dusk' }],
			})
			.connect();
		const tom = director.character('Tom')!;
		const dawn = director.collective('DawnParty')!;
		const dusk = director.collective('DuskParty')!;
		return { director, calls, release, tom, dawn, dusk };
	}

	it('join, move and leave keep the running arc and the law that started it', async () => {
		const { director, calls, release, tom, dawn, dusk } = await stage({ hurt: new Set(['Tom']) });
		const flee = tom.laws[0];
		director.tick(1);
		await waitFor(() => calls.some((c) => c.character.id === 'Tom' && c.verb === 'go_to'));
		const ownMind = tom.mind;
		tom.collective = dawn;
		assert.equal(tom.mind, dawn.mind);
		assert.equal(ownMind?.attached, false);
		assert.deepEqual(tom.laws, []);
		assert.equal(dawn.laws.find((law) => law.name === 'Tom.flee'), flee);
		assert.equal(tom.liveArc, true);
		director.tick(1);
		await sleep(20);
		assert.equal(calls.filter((c) => c.character.id === 'Tom' && c.verb === 'go_to').length, 1);
		tom.collective = dusk;
		assert.equal(dawn.character('Tom'), undefined);
		assert.equal(dusk.laws.find((law) => law.name === 'Tom.flee'), flee);
		assert.equal(tom.liveArc, true);
		tom.collective = null;
		assert.equal(tom.laws[0], flee);
		assert.equal(flee.name, 'flee');
		assert.equal(tom.mind?.owner, tom);
		assert.equal(tom.mind?.setting('rank'), 2);
		assert.equal(tom.liveArc, true);
		director.tick(1);
		await sleep(20);
		assert.equal(calls.filter((c) => c.character.id === 'Tom' && c.verb === 'go_to').length, 1);
		release();
		director.dispose();
	});

	it('tells the collectives and the character what changed', async () => {
		const { director, release, tom, dawn } = await stage();
		const events = (mind:Mind<Ctx>):string[] => mind.events().map((e) => e.text);
		tom.collective = dawn;
		assert.deepEqual(events(dawn.mind), ['Tom joined']);
		void tom.enact(parseArc('go_to(Keep)', tom.verbs));
		tom.collective = null;
		assert.ok(events(dawn.mind).includes('Tom left'));
		assert.match(events(tom.mind!).join('\n'), /You left DawnParty\. You are still doing what DawnParty gave you: go_to\(Keep\)\./);
		release();
		director.dispose();
	});

	it('caps laws per group and keeps the collective\'s own ahead of its characters\'', async () => {
		const { director, release, tom, dawn } = await stage();
		dawn.maxLaws = 2;
		tom.collective = dawn;
		assert.ok(dawn.addLaw({ name: 'a', watch: '1 > 0', arc: 'wait()' }));
		assert.ok(dawn.addLaw({ name: 'Wisp.x', watch: '1 > 0', arc: 'wait()' }));
		assert.ok(dawn.addLaw({ name: 'Wisp.y', watch: '1 > 0', arc: 'wait()' }));
		assert.equal(dawn.addLaw({ name: 'Wisp.z', watch: '1 > 0', arc: 'wait()' }), undefined);
		assert.ok(dawn.addLaw({ name: 'b', watch: '1 > 0', arc: 'wait()' }));
		assert.equal(dawn.addLaw({ name: 'c', watch: '1 > 0', arc: 'wait()' }), undefined);
		assert.equal(dawn.addLaw({ name: 'Nobody.x', watch: '1 > 0', arc: 'wait()' }), undefined);
		assert.deepEqual(dawn.laws.map((law) => law.name), ['a', 'b', 'Tom.flee', 'Wisp.x', 'Wisp.y']);
		release();
		director.dispose();
	});

	it('drops laws that need a collective on leave, and keeps them on a move', async () => {
		const { director, release, tom, dawn, dusk } = await stage();
		tom.collective = dawn;
		assert.ok(dawn.addLaw({ name: 'Tom.rally', watch: 'some(units.filter(u => u.busy))', arc: 'wait()' }));
		tom.collective = dusk;
		assert.deepEqual(dusk.laws.map((law) => law.name), ['Tom.flee', 'Tom.rally']);
		tom.collective = null;
		assert.deepEqual(tom.laws.map((law) => law.name), ['flee']);
		assert.match(tom.mind!.events().map((e) => e.text).join('\n'), /laws that only work in a group are gone: rally/);
		release();
		director.dispose();
	});

	it('a member\'s own law step writes its own law; the voice writes the collective\'s', async () => {
		const { director, release, dawn } = await stage();
		const wisp = dawn.character('Wisp')!;
		assert.equal((await wisp.enact(parseArc('law(watch=1 > 0, arc=wait(), name=hold)', wisp.verbs))).status === 'ok', true);
		assert.equal((await wisp.enact(parseArc('law(who=units, watch=1 > 0, arc=wait(), name=x)', wisp.verbs))).status === 'ok', false);
		const voice = dawn.voice;
		assert.equal((await voice.enact(parseArc('law(who=units, watch=1 > 0, arc=wait(), name=rally)', voice.verbs))).status === 'ok', true);
		assert.deepEqual(dawn.laws.map((law) => [law.name, law.who]), [['rally', 'units'], ['Wisp.hold', 'me']]);
		release();
		director.dispose();
	});

	it('tells onThink every event of a think in the name it began for, though its commander changes mid-think', async () => {
		const events:ThinkEvent[] = [];
		let director:ArcDirector<Ctx> | undefined;
		director = await new ArcDirector<Ctx>()
			.withPriorityThinkQueue({ processInterval: 0, heartbeatStart: 100, heartbeatMin: 100 })
			.withIntervals({ watch: 0, think: 0 })
			.withMind({ arcFormat: 'text' })
			.addFake({ chat: () => {
				const hive = director!.collective('Hive')!;
				hive.commander = hive.character('Tomas') ?? null;
				return { content: 'wait(seconds=1)', toolCalls: [] };
			} })
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.withContext((id) => ({ id }))
			.onVerb(({ verb }) => ({ status: 'ok', verb }))
			.onThink((event) => events.push(event))
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit: COLLECTIVE_KIT, commander: 'Mira', characters: [{ id: 'Mira' }, { id: 'Tomas' }] })
			.connect();
		void director.collective('Hive')!.mind.tick(1);
		await waitFor(() => events.some((event) => event.kind === 'end'));
		assert.deepEqual([...new Set(events.map((event) => event.who))], ['Mira']);
		director.dispose();
	});

	it('runs an arc that needs no body beside the program under way, and keeps a program it runs already', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, hold: (call) => call.verb === 'go_to' });
		const mira = director.collective('Hive')!.character('Mira')!;
		void mira.enact(parseArc('go_to(Keep)', mira.verbs));
		await waitFor(() => calls.length === 1);
		assert.equal((await mira.enact(parseArc('wait()', mira.verbs))).status === 'ok', true);
		assert.equal(mira.verb, 'go_to', 'it needs no body: the walk goes on');
		assert.equal((await mira.enact(parseArc('go_to(Keep)', mira.verbs))).status === 'ok', true);
		assert.equal(calls.length, 1, 'the same program is not begun again');
		void mira.enact(parseArc('go_to(Gate)', mira.verbs));
		await waitFor(() => calls.length === 2);
		assert.equal(calls[1]!.args.target, 'Gate', 'one that needs the body takes over');
		director.dispose();
	});

	it('a commander\'s pass keeps every unit\'s program running and changes no law', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, hold: (call) => call.verb === 'go_to' });
		const hive = director.collective('Hive')!;
		void hive.enact(parseArc('command(who=units, arc=go_to(Keep)) ; law(who=units, watch=1 > 2, arc=wait(), name=x)', hive.verbs));
		await waitFor(() => calls.length === 2 && hive.laws.some((law) => law.name === 'x'));
		const programs = hive.characters.map((c) => c.arc);
		const laws = [...hive.laws];
		assert.equal((await hive.enact(parseArc('pass()', hive.verbs))).status === 'ok', true);
		await sleep(5);
		assert.deepEqual(hive.characters.map((c) => c.arc), programs, 'every program is the one it was');
		assert.equal(calls.length, 2, 'none is begun again');
		assert.deepEqual(hive.laws, laws);
		director.dispose();
	});

	it('a pass a commander wrote into a unit\'s program does nothing there, and the program goes on', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc('command(who=units.filter("Mira"), arc=pass() && go_to(Keep))', hive.verbs));
		await waitFor(() => calls.length === 1);
		assert.deepEqual([calls[0].character.id, calls[0].verb], ['Mira', 'go_to']);
		director.dispose();
	});

	it('shows its units\' programs as files: one a program, every step a unit is on marked with who, and who finished how', async () => {
		const held = (call:VerbCall<Ctx>):boolean => (call.character.id === 'Mira' && call.args.target === 'Keep') || (call.character.id === 'Tomas' && call.args.target === 'Gate');
		const director = await new ArcDirector<Ctx>()
			.withIntervals({ watch: 0, think: 0 })
			.withMind({ arcFormat: 'text' })
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb(async (call) => {
				if (held(call)) {
					await new Promise(() => {});
				}
				return { status: 'ok', verb: call.verb };
			})
			.withContext((id) => ({ id }))
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit: COLLECTIVE_KIT, characters: [{ id: 'Mira' }, { id: 'Tomas' }, { id: 'Ash' }] })
			.connect();
		const hive = director.collective('Hive')!;
		void hive.enact(parseArc('command(who=units, arc=go_to(Keep) ; go_to(Gate))', hive.verbs));
		await waitFor(() => hive.character('Mira')!.verb === 'go_to' && hive.character('Tomas')!.lastStep?.args.target === 'Gate' && !hive.character('Ash')!.busy);
		assert.match(hive.promptSection(hive.mind), new RegExp([
			'Programs your units run now:',
			'',
			'programs/Alpha\\.arc \\(units\\.filter\\("Alpha"\\) = Mira 5/5 hp, Tomas 5/5 hp, Ash 5/5 hp; running 0s\\)',
			'go_to\\(Keep\\) // ← Mira, 0s',
			'go_to\\(Gate\\) // ← Tomas, 0s',
			'// done: Ash, ok',
			'',
			'These files run now\\. A program can be right for some of its units and wrong for others: command only the units it is wrong for, by name or by a filter that leaves the rest out; reply pass\\(\\) if all still fit\\.$',
		].join('\n')));
		assert.match(hive.promptSection(hive.mind), /\| Alpha \| 3 unit \| 15\/15 \| 1 going to Keep; 1 going to Gate; 1 done, ok \|/, 'one that finished is done, not idle');
		director.dispose();
	});

	it('names a program file as its units are addressed: its group, which reaches exactly them', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await new ArcDirector<Ctx>()
			.withIntervals({ watch: 0, think: 0 })
			.withMind({ arcFormat: 'text' })
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb((call) => {
				calls.push(call);
				return new Promise((done) => {
					call.signal.addEventListener('abort', () => done({ status: 'stopped', verb: call.verb }), { once: true });
				});
			})
			.withContext((id) => ({ id }))
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit: COLLECTIVE_KIT, characters: [{ id: 'Mira' }, { id: 'Tomas' }, { id: 'Ash' }] })
			.connect();
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc('command(who=units.filter(u => u.id != "Ash"), arc=go_to(Keep), group=Vanguard) ; command(who=units.filter("Ash"), arc=go_to(Keep))', hive.verbs));
		await waitFor(() => calls.length === 3);
		const text = hive.promptSection(hive.mind);
		assert.match(text, /^programs\/Vanguard\.arc \(units\.filter\("Vanguard"\) = Mira 5\/5 hp, Tomas 5\/5 hp; running 0s\)\ngo_to\(Keep\) \/\/ ← now, 0s$/m);
		assert.match(text, /^programs\/Ash\.arc \(units\.filter\("Ash"\) = Ash 5\/5 hp; running 0s\)\ngo_to\(Keep\) \/\/ ← now, 0s$/m, 'the same program, another file: it is addressed apart');
		await hive.enact(parseArc('command(who=units.filter("Vanguard"), arc=go_to(Gate))', hive.verbs));
		await waitFor(() => calls.length === 5);
		assert.deepEqual(calls.slice(3).map((call) => call.character.id).sort(), ['Mira', 'Tomas'], 'the file\'s name re-targets exactly its units');
		await hive.enact(parseArc('command(who=units.filter("Tomas"), arc=go_to(Well))', hive.verbs));
		await waitFor(() => calls.length === 6);
		assert.equal(calls[5].character.id, 'Tomas', 'and the name beside each unit picks it alone');
		director.dispose();
	});

	it('marks a program step a law holds apart from the step the law runs', async () => {
		const director = await new ArcDirector<Ctx>()
			.withIntervals({ watch: 0, think: 0 })
			.withMind({ arcFormat: 'text' })
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			// A walk goes on until it is stopped, as a host's does.
			.onVerb((call) => new Promise((done) => {
				call.signal.addEventListener('abort', () => done({ status: 'stopped', verb: call.verb }), { once: true });
			}))
			.withContext((id) => ({ id }))
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit: COLLECTIVE_KIT, characters: [{ id: 'Mira' }, { id: 'Tomas' }] })
			.connect();
		const hive = director.collective('Hive')!;
		const mira = hive.character('Mira')!;
		hive.command([mira], parseArc('go_to(Keep)', mira.verbs));
		await waitFor(() => mira.verb === 'go_to');
		await hive.enact(parseArc('law(who=units.filter("Mira"), watch=1 > 0, arc=go_to(Gate), name=bolt)', hive.verbs));
		for (let i = 0; i < 20 && mira.lastStep?.args.target !== 'Gate'; i++) {
			director.tick(0.5);
			await sleep(5);
		}
		const text = hive.promptSection(hive.mind);
		assert.match(text, /^go_to\(Keep\) \/\/ ⏸ Mira, while law bolt runs$/m);
		assert.match(text, /- bolt \(for units\.filter\("Mira"\)\): when 1 > 0, it runs go_to\(Gate\); running for Mira: go_to\(Gate\)$/m);
		director.dispose();
	});

	it('asks which unfinished work to replace, and leaves the rest running', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const asked:string[] = [];
		let think = 0;
		const director = await new ArcDirector<Ctx>()
			.withPriorityThinkQueue({ processInterval: 0, heartbeatStart: 100, heartbeatMin: 100 })
			.withIntervals({ watch: 0, think: 0 })
			.withMind({ arcFormat: 'text' })
			.withReplaceCheck()
			.addFake({ chat: (req) => {
				const last = String(req.messages.at(-1)?.content);
				if (last.includes('cut short')) {
					asked.push(last);
					return { content: '{"Mira":"replace","Tomas":"keep"}', toolCalls: [] };
				}
				think += 1;
				return { content: `command(who=units, arc=go_to(${think === 1 ? 'Keep' : 'Gate'}))`, toolCalls: [] };
			} })
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.withContext((id) => ({ id }))
			.onVerb(async (call) => {
				calls.push(call);
				await new Promise(() => {});
				return { status: 'ok', verb: call.verb };
			})
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit: COLLECTIVE_KIT, characters: [{ id: 'Mira' }, { id: 'Tomas' }] })
			.connect();
		const hive = director.collective('Hive')!;
		await hive.mind.thinkNow();
		await waitFor(() => calls.length === 2);
		assert.equal(asked.length, 0, 'nothing was running to cut short');
		await hive.mind.thinkNow();
		await waitFor(() => calls.length === 3);
		await sleep(30);
		assert.equal(asked.length, 1);
		assert.match(asked[0]!, /Mira: at go_to\(Keep\), step 1 of 1\. Would become: go_to\(Gate\)/);
		assert.match(asked[0]!, /Tomas: at go_to\(Keep\)/);
		assert.deepEqual(calls.map((call) => [call.character.id, call.args.target]).slice(2), [['Mira', 'Gate']]);
		assert.equal(hive.character('Tomas')!.verb, 'go_to');
		director.dispose();
	});

	it('appends when the ask about unfinished work fails: the reply is not lost with it', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const release:(()=>void)[] = [];
		let reply = 'wait()';
		const director = await new ArcDirector<Ctx>()
			.withPriorityThinkQueue({ processInterval: 0, heartbeatStart: 100, heartbeatMin: 100 })
			.withIntervals({ watch: 0, think: 0 })
			.withMind({ arcFormat: 'text' })
			.withReplaceCheck()
			.addFake({ chat: (req) => {
				if (String(req.messages.at(-1)?.content).includes('cut short')) {
					throw new Error('server gone');
				}
				return { content: reply, toolCalls: [] };
			} })
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.withContext((id) => ({ id }))
			.onVerb(async (call) => {
				calls.push(call);
				await new Promise<void>((resolve) => {
					release.push(resolve);
				});
				return { status: 'ok', verb: call.verb };
			})
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit: COLLECTIVE_KIT, characters: [{ id: 'Mira' }] })
			.connect();
		const hive = director.collective('Hive')!;
		reply = 'command(who=units, arc=go_to(Keep))';
		await hive.mind.thinkNow();
		await waitFor(() => calls.length >= 1);
		reply = 'command(who=units, arc=go_to(Gate))';
		await hive.mind.thinkNow();
		release.splice(0).forEach((go) => go());
		await waitFor(() => calls.length >= 2);
		assert.deepEqual(calls.map((call) => call.args.target), ['Keep', 'Gate']);
		director.dispose();
	});

	it('appends to unfinished work: after a program that ends, inside a loop that never does', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const asked:string[] = [];
		const release:(()=>void)[] = [];
		let reply = 'wait()';
		// Anything but replace or keep appends: omitted, a word it made up, or a reply that does not read.
		const appendReplies = ['{}', '{"Mira":"whatever"}', 'no idea'];
		const director = await new ArcDirector<Ctx>()
			.withPriorityThinkQueue({ processInterval: 0, heartbeatStart: 100, heartbeatMin: 100 })
			.withIntervals({ watch: 0, think: 0 })
			.withMind({ arcFormat: 'text' })
			.withReplaceCheck()
			.addFake({ chat: (req) => {
				const last = String(req.messages.at(-1)?.content);
				if (last.includes('cut short')) {
					asked.push(last);
					return { content: appendReplies.shift() ?? '{"Mira":"append"}', toolCalls: [] };
				}
				return { content: reply, toolCalls: [] };
			} })
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.withContext((id) => ({ id }))
			.onVerb(async (call) => {
				calls.push(call);
				await new Promise<void>((resolve) => {
					release.push(resolve);
				});
				return { status: 'ok', verb: call.verb };
			})
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit: COLLECTIVE_KIT, characters: [{ id: 'Mira' }] })
			.connect();
		const hive = director.collective('Hive')!;
		const mira = hive.character('Mira')!;
		// A loop waits for game time to move before it goes round again.
		const time = setInterval(() => {
			director.tick(0.05);
		}, 2);
		const think = async (arc:string):Promise<void> => {
			reply = `command(who=units, arc=${arc})`;
			await hive.mind.thinkNow();
			reply = 'wait()';
		};
		const stepsDone = async (n:number):Promise<void> => {
			await waitFor(() => calls.length >= n);
			await sleep(10);
		};
		const finish = ():void => {
			release.splice(0).forEach((go) => go());
		};
		const targets = ():unknown[] => calls.map((call) => call.args.target);

		await think('go_to(Keep)');
		await stepsDone(1);
		await think('go_to(Gate)');
		await sleep(20);
		assert.equal(mira.verb, 'go_to');
		assert.doesNotMatch(asked[0]!, /no exit/, 'nothing about loops unless one is in one');
		finish();
		await stepsDone(2);
		assert.deepEqual(targets(), ['Keep', 'Gate'], 'after the program it was running');
		finish();
		await waitFor(() => !mira.busy);

		calls.length = 0;
		await think('loop(arc=go_to(Keep), times=1)');
		await stepsDone(1);
		await think('go_to(Gate)');
		await sleep(20);
		assert.match(asked[1]!, /runs once the loop exits/);
		finish();
		await stepsDone(2);
		assert.deepEqual(targets(), ['Keep', 'Gate'], 'after the loop exits');
		finish();
		await waitFor(() => !mira.busy);

		calls.length = 0;
		await think('loop(arc=go_to(Keep))');
		await stepsDone(1);
		await think('go_to(Gate)');
		await sleep(20);
		assert.match(asked[2]!, /which has no exit/);
		for (let n = 2; n <= 4; n += 1) {
			finish();
			await stepsDone(n);
		}
		assert.deepEqual(targets(), ['Keep', 'Keep', 'Gate', 'Keep'], 'inside the loop, from its next time round');
		clearInterval(time);
		director.dispose();
	});

	it('stops thinking through a commander the world says is down, however it went down', async () => {
		let down = false;
		const vacated:string[] = [];
		const director = await new ArcDirector<Ctx>()
			.withPriorityThinkQueue({ processInterval: 0, heartbeatStart: 100, heartbeatMin: 100 })
			.withIntervals({ watch: 0, think: 0 })
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit({ verbs: ['command', 'wait'], tools: [] })
			.withWorld({ find: () => undefined, getPose: () => undefined, isDown: (id:string) => down && id === 'Mira' })
			.withKernels(kernels())
			.withContext((id) => ({ id }))
			.onCommanderVacant((_, character) => vacated.push(character.id))
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit: { verbs: ['command', 'wait'], tools: [] }, commander: 'Mira', characters: [{ id: 'Mira' }, { id: 'Tomas' }] })
			.connect();
		const hive = director.collective('Hive')!;
		director.tick(0.1);
		assert.equal(hive.commander?.id, 'Mira');
		down = true;
		director.tick(0.1);
		assert.equal(hive.commander, null);
		assert.deepEqual(vacated, ['Mira']);
		director.dispose();
	});

	it('sends back a trade that names no item or no real count, an empty arc, and a verb it does not have', async () => {
		const replies = ['offer(give={"filter":1}, get={"gold":5})', 'offer(give={"gold":-1})', '{"steps":[{"verb":"command","who":"units","arc":[]}]}', 'wait()'];
		const asked:string[] = [];
		const director = await new ArcDirector<Ctx>()
			.withMind({ arcFormat: 'text', repairRetries: 3 })
			.addFake({ chat: (req) => {
				asked.push(String(req.messages.at(-1)?.content));
				return { content: replies.shift() ?? 'wait()', toolCalls: [] };
			} })
			.withVerbs((v) => v.addStock())
			.withDefaultKit({ verbs: ['offer', 'wait'], tools: [] })
			.withWorld({ find: () => undefined, getPose: () => undefined, transfer: () => undefined, getNeighbors: () => [], steerToward: () => true, canOffer: () => true, isItem: (name:string) => name === 'gold' } as never)
			.withKernels(kernels())
			.withContext((id) => ({ id }))
			.addCharacter({ id: 'Mira', mind: { skipHeartbeat: true } })
			.connect();
		await director.character('Mira')!.mind!.thinkNow({ enact: false });
		assert.match(asked[1]!, /'filter' is not an item/);
		assert.match(asked[2]!, /-1 of 'gold'; each count is a whole number above 0/);
		assert.match(asked[3]!, /unknown verb 'command'.*You can use only: /s);
		director.dispose();
	});

	it('a program of only reactions is still orders while it waits, and not once replaced', async () => {
		const director = await hiveOf({ calls: [], hold: () => false });
		const hive = director.collective('Hive')!;
		const mira = hive.character('Mira')!;
		hive.command([mira], parseArc('when(watch=hasHeard, arc=wait())', mira.verbs));
		await waitFor(() => !!mira.arcSession?.parked);
		await sleep(5);
		assert.ok(mira.orders, 'parked on its when');
		mira.replaceProgram();
		assert.equal(mira.orders, undefined);
		director.dispose();
	});

	it('an order it runs beside its program leaves it under the orders it had', async () => {
		const director = await hiveOf({ calls: [], hold: () => true });
		const hive = director.collective('Hive')!;
		const mira = hive.character('Mira')!;
		hive.command([mira], parseArc('go_to(Keep)', mira.verbs));
		await waitFor(() => mira.liveArc);
		const orders = mira.orders;
		assert.ok(orders);
		hive.command([mira], parseArc('say(text=hold)', mira.verbs));
		await sleep(5);
		assert.equal(mira.orders, orders);
		director.dispose();
	});

	it('a reply judged step by step runs in the order it was written', async () => {
		const kit = { verbs: ['go_to', 'say', 'think', 'wait'], tools: [] };
		const replies = ['go_to(Keep) ; say(text=hello) ; think(about=next)'];
		const director = await new ArcDirector<Ctx>()
			.withMind({ arcFormat: 'text', repairRetries: 1, repairPerStep: true })
			.addFake({ chat: () => ({ content: replies.shift() ?? 'wait()', toolCalls: [] }) })
			.withVerbs((v) => v.addStock())
			.withDefaultKit(kit)
			.withWorld({ find: (id:string) => (id === 'Keep' ? {} : undefined), getPose: () => undefined, transfer: () => undefined, getNeighbors: () => [], steerToward: () => true } as never)
			.withKernels(kernels())
			.withContext((id) => ({ id }))
			.addCharacter({ id: 'Mira', mind: { skipHeartbeat: true } })
			.connect();
		const arc = await director.character('Mira')!.mind!.thinkNow({ enact: false });
		assert.deepEqual(arc!.map((step) => step.verb), ['go_to', 'say', 'think']);
		director.dispose();
	});

	it('does not send back what the watch language really says', async () => {
		const asked:string[] = [];
		const reply = 'law(watch=some(others.filter((u) => u.hp > 0)) or me.foo == undefined, arc=wait(seconds=1), name=fine)';
		const director = await new ArcDirector<Ctx>()
			.withMind({ arcFormat: 'text', repairRetries: 1 })
			.addFake({ chat: (req) => {
				asked.push(String(req.messages.at(-1)?.content));
				return { content: asked.length === 1 ? reply : 'wait()', toolCalls: [] };
			} })
			.withVerbs((v) => v.addStock())
			.withDefaultKit({ verbs: ['law', 'wait'], tools: [] })
			.withWorld({ find: () => undefined, getPose: () => undefined, transfer: () => undefined, getNeighbors: () => [], steerToward: () => true } as never)
			.withKernels(kernels())
			.withContext((id) => ({ id }))
			.addCharacter({ id: 'Mira', mind: { skipHeartbeat: true } })
			.connect();
		const arc = await director.character('Mira')!.mind!.thinkNow({ enact: false });
		assert.equal(asked.length, 1, asked[1]);
		assert.equal(arc![0].args.name, 'fine');
		director.dispose();
	});

	it('reads a watch\'s name as its value, so an arc may wait on it', async () => {
		const asked:string[] = [];
		const director = await new ArcDirector<Ctx>()
			.withMind({ arcFormat: 'text', repairRetries: 1 })
			.addFake({ chat: (req) => {
				asked.push(String(req.messages.at(-1)?.content));
				return { content: asked.length === 1 ? 'wait(until=fallen || !calm)' : 'wait()', toolCalls: [] };
			} })
			.withVerbs((v) => v.addStock())
			.withDefaultKit({ verbs: ['wait'], tools: [] })
			.withWorld({ find: () => undefined, getPose: () => undefined, transfer: () => undefined, getNeighbors: () => [], steerToward: () => true } as never)
			.withKernels(kernels())
			.withContext((id) => ({ id }))
			.addCharacter({ id: 'Mira', mind: { skipHeartbeat: true }, pinnedWatches: { fallen: 'isHurt(me)', calm: 'count(others) == 0' } })
			.connect();
		const arc = await director.character('Mira')!.mind!.thinkNow({ enact: false });
		assert.equal(asked.length, 1, asked[1]);
		assert.equal(arc![0].args.until, 'fallen || !calm');
		assert.equal(director.evaluate('Mira', 'fallen || !calm').error, undefined);
		director.dispose();
	});

	it('thinks again instead of repairing a reply aimed at a thing gone since its mind looked', async () => {
		const asked:string[] = [];
		const director = await new ArcDirector<Ctx>()
			.withMind({ arcFormat: 'text', repairRetries: 3 })
			.addFake({ chat: (req) => {
				asked.push(String(req.messages.at(-1)?.content));
				return { content: 'go_to(Cobweb)', toolCalls: [] };
			} })
			.withVerbs((v) => v.addStock())
			.withDefaultKit({ verbs: ['go_to', 'wait'], tools: [] })
			.withWorld({ find: () => undefined, getPose: () => undefined, transfer: () => undefined, getNeighbors: () => [], steerToward: () => true } as never)
			.withKernels(kernels())
			.withContext((id) => ({ id }))
			.addCharacter({ id: 'Mira', mind: { skipHeartbeat: true }, memories: [{ text: 'Last I saw Cobweb: Cobweb 5m in front of you', tags: ['seen:Cobweb', 'Cobweb', 'seen'], category: 'semantic' }] })
			.connect();
		await assert.rejects(director.character('Mira')!.mind!.thinkNow({ enact: false }), (err:Error) => err instanceof BlockedArcError && /Cobweb is gone since you looked/.test(err.message));
		assert.equal(asked.length, 1, 'no repair turn on the old sight');
		director.dispose();
	});

	it('sends back what could never work: misused watches, unknown names, orders to no one, too many or twin laws', async () => {
		const asked:string[] = [];
		const replies = [
			"law(watch=some(others.nearby.filter('item').length) > 0, arc=wait())",
			'law(watch=count(others) > 0, arc=wait(), until=some(3))',
			'law(watch=some_condition, arc=wait())',
			'command(who=units.filter("Nobody"), arc=wait())',
			'go_to(Nowhere)',
			'law(watch=count(others) > 5, arc=wait(), name=two)',
			'law(watch=count(others) > 6, arc=wait(), name=three)',
			'wait()',
		];
		const director = await new ArcDirector<Ctx>()
			.withMind({ arcFormat: 'text', repairRetries: 10 })
			.addFake({ chat: (req) => {
				asked.push(String(req.messages.at(-1)?.content));
				return { content: replies.shift() ?? 'wait()', toolCalls: [] };
			} })
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit({ verbs: ['command', 'law', 'wait', 'go_to'], tools: [] })
			.withWorld({ find: (id:string) => (['Mira', 'Tomas', 'Keep'].includes(id) ? id : undefined), getPose: () => undefined, getNeighbors: () => [], steerToward: () => true } as never)
			.withKernels(kernels())
			.withContext((id) => ({ id }))
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit: { verbs: ['command', 'law', 'wait', 'go_to'], tools: [] }, commander: 'Mira', maxLaws: 1, characters: [{ id: 'Mira' }, { id: 'Tomas' }] })
			.connect();
		const hive = director.collective('Hive')!;
		// The first law goes in by hand, to be the twin and to fill the cap.
		hive.addLaw({ name: 'one', watch: 'count(others) > 5', arc: 'wait()' });
		await hive.mind.thinkNow({ enact: false });
		const said = asked.join('\n');
		assert.match(said, /'nearby' needs a call/);
		assert.match(said, /some needs a list/);
		assert.match(said, /there is no some_condition/);
		assert.match(said, /picks no unit/);
		assert.match(said, /there is no Nowhere/);
		assert.match(said, /that is your law one already/);
		assert.match(said, /unlaw one first/);
		director.dispose();
	});

	it('ends a reply as soon as it breaks down, and sends it back as a repair', async () => {
		const asked:string[] = [];
		let wrote = 0;
		const director = await new ArcDirector<Ctx>()
			.withMind({ repairRetries: 1 })
			.addFake({ chat: async (req) => {
				asked.push(String(req.messages.at(-1)?.content));
				if (asked.length > 1) {
					return { content: '{"steps":[{"verb":"wait"}]}', toolCalls: [] };
				}
				for (const piece of ['{"steps":[{"verb":"say","text":"Hi","to":"others.filter(u => u.hp)', '}]}}]}]}]}', '```out of reach; more junk', ' and more', ' and more']) {
					wrote += 1;
					req.onDelta?.({ content: piece });
					if (req.signal?.aborted) {
						break;
					}
				}
				return { content: 'junk', toolCalls: [] };
			} })
			.withVerbs((v) => v.addStock())
			.withDefaultKit({ verbs: ['say', 'wait'], tools: [] })
			.withKernels(kernels())
			.withContext((id) => ({ id }))
			.addCharacter({ id: 'Mira', mind: { skipHeartbeat: true } })
			.connect();
		await director.character('Mira')!.mind!.thinkNow({ enact: false });
		assert.equal(wrote, 2, 'it stops at the first piece that cannot be right');
		assert.match(asked[1]!, /"to" never closed its quote/);
		director.dispose();
	});

	it('keeps the good steps of a reply and sends back only the bad, shown only what stands', async () => {
		const stage = async (replies:string[], retries:number):Promise<{ arc:Arc | null; asked:{ last:string; before:string }[]; hive:Collective<Ctx>; director:ArcDirector<Ctx> }> => {
			const asked:{ last:string; before:string }[] = [];
			const kit = { verbs: ['command', 'law', 'wait'], tools: [] };
			const director = await new ArcDirector<Ctx>()
				.withMind({ arcFormat: 'text', repairRetries: retries, repairPerStep: true })
				.addFake({ chat: (req) => {
					asked.push({ last: String(req.messages.at(-1)?.content), before: String(req.messages.at(-2)?.content) });
					return { content: replies.shift() ?? 'wait()', toolCalls: [] };
				} })
				.withVerbs((v) => v.addStock()
					.addStockCollective())
				.withDefaultKit(kit)
				.withKernels(kernels())
				.withContext((id) => ({ id }))
				.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit, commander: 'Mira', characters: [{ id: 'Mira' }, { id: 'Tomas' }] })
				.connect();
			const hive = director.collective('Hive')!;
			return { arc: await hive.mind.thinkNow({ enact: false }), asked, hive, director };
		};
		const good = 'command(who=units, arc=wait(seconds=1))';
		const bad = 'law(watch=some(others.nearby.filter("x")), arc=wait(seconds=2), name=dead)';

		const fixed = await stage([`${good} ; ${bad}`, 'law(watch=count(others) > 3, arc=wait(seconds=2), name=alive)'], 2);
		assert.deepEqual(fixed.arc!.map((step) => step.verb), ['command', 'law']);
		assert.equal(fixed.arc![1].args.name, 'alive');
		assert.match(fixed.asked[1].last, /Those steps stand.*law named dead: .*'nearby' needs a call/s);
		assert.match(fixed.asked[1].before, /command/);
		assert.doesNotMatch(fixed.asked[1].before, /law|dead/, 'the bad step is not there to copy');
		fixed.director.dispose();

		const left = await stage([`${good} ; ${bad}`, 'wait()'], 2);
		assert.deepEqual(left.arc!.map((step) => step.verb), ['command'], 'wait leaves it out');
		left.director.dispose();

		const again = await stage([`${good} ; ${bad}`, `${good} ; law(watch=count(others) > 3, arc=wait(seconds=2), name=alive)`], 2);
		assert.deepEqual(again.arc!.map((step) => step.verb), ['command', 'law'], 'what stands written again runs once');
		again.director.dispose();

		const out = await stage([`${good} ; ${bad}`, bad], 1);
		assert.deepEqual(out.arc!.map((step) => step.verb), ['command'], 'out of tries, what is good runs');
		assert.match(out.hive.mind.events().map((event) => event.text).join('\n'), /did not run.*needs a call/);
		out.director.dispose();

		const none = await stage([bad, 'wait()'], 1);
		assert.match(none.asked[1].last, /not a valid Arc/, 'nothing good: the usual repair');
		none.director.dispose();
	});

	it('gives a law that only speaks to its commander unless it says otherwise', async () => {
		const kit = { verbs: ['law', 'wait', 'say'], tools: [] };
		const director = await new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock())
			.withDefaultKit(kit)
			.withKernels(kernels())
			.withContext((id) => ({ id }))
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit, commander: 'Mira', characters: [{ id: 'Mira' }, { id: 'Tomas' }] })
			.connect();
		const hive = director.collective('Hive')!;
		const mira = hive.character('Mira')!;
		const lawOf = async (text:string):Promise<string | undefined> => {
			await mira.enact(parseArc(text, mira.verbs));
			return hive.laws.at(-1)?.who;
		};
		assert.equal(await lawOf('law(watch=count(others) > 9, arc=say("Curtain!"), name=one)'), 'me');
		assert.equal(await lawOf('law(watch=count(others) > 9, arc=wait(seconds=1), name=two)'), 'units');
		assert.equal(await lawOf('law(who=units, watch=count(others) > 9, arc=say("All!"), name=three)'), 'units');
		director.dispose();
	});

	it('sends back a field no one has only when told to', async () => {
		const reply = 'law(watch=some(others.filter(u => u.foo > 3)), arc=wait(seconds=1))';
		const stage = async (unknownFields:boolean):Promise<string[]> => {
			const asked:string[] = [];
			const kit = { verbs: ['law', 'wait'], tools: [] };
			const director = await new ArcDirector<Ctx>()
				.withMind({ arcFormat: 'text', repairRetries: 1, repairUnknownFields: unknownFields })
				.addFake({ chat: (req) => {
					asked.push(String(req.messages.at(-1)?.content));
					return { content: asked.length === 1 ? reply : 'wait()', toolCalls: [] };
				} })
				.withVerbs((v) => v.addStock())
				.withDefaultKit(kit)
				.withKernels(kernels())
				.withContext((id) => ({ id }))
				.addCharacter({ id: 'Mira', mind: { skipHeartbeat: true } })
				.connect();
			await director.character('Mira')!.mind!.thinkNow({ enact: false });
			director.dispose();
			return asked;
		};
		assert.equal((await stage(false)).length, 1);
		const asked = await stage(true);
		assert.match(asked[1]!, /no one has a field 'foo'/);
	});

	it('keeps the root steps finished before a reply broke down', async () => {
		const asked:{ last:string; before:string }[] = [];
		const kit = { verbs: ['command', 'law', 'wait'], tools: [] };
		const pieces = ['{"steps":[{"verb":"command","who":"units","arc":[{"verb":"wait","seconds":1}]},', '{"verb":"law","watch":"count(others', '}]}}]}]}]}', ' more junk'];
		let wrote = 0;
		const director = await new ArcDirector<Ctx>()
			.withMind({ repairRetries: 1, repairPerStep: true })
			.addFake({ chat: async (req) => {
				asked.push({ last: String(req.messages.at(-1)?.content), before: String(req.messages.at(-2)?.content) });
				if (asked.length > 1) {
					return { content: '{"steps":[{"verb":"law","watch":"count(others) > 3","arc":[{"verb":"wait","seconds":2}],"name":"alive"}]}', toolCalls: [] };
				}
				for (const piece of pieces) {
					wrote += 1;
					req.onDelta?.({ content: piece });
					if (req.signal?.aborted) {
						break;
					}
				}
				return { content: 'junk', toolCalls: [] };
			} })
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(kit)
			.withKernels(kernels())
			.withContext((id) => ({ id }))
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit, commander: 'Mira', characters: [{ id: 'Mira' }, { id: 'Tomas' }] })
			.connect();
		const arc = await director.collective('Hive')!.mind.thinkNow({ enact: false });
		assert.equal(wrote, 3, 'cut off as it broke down');
		assert.match(asked[1]!.before, /"command"/);
		assert.doesNotMatch(asked[1]!.before, /"law"/);
		assert.match(asked[1]!.last, /the rest of your reply: "watch" never closed its quote/);
		assert.deepEqual(arc!.map((step) => step.verb), ['command', 'law']);
		director.dispose();
	});

	it('lets only its commander command, whatever brings a command to a unit', async () => {
		const { director, release, dawn } = await stage();
		const wisp = dawn.character('Wisp')!;
		const result = await wisp.enact(parseArc('command(who=units, arc=wait())', wisp.verbs));
		assert.equal(result.status === 'ok', false);
		assert.match(result.reason ?? '', /only your commander/);
		assert.equal((await dawn.voice.enact(parseArc('command(who=units, arc=wait(seconds=1))', dawn.voice.verbs))).status === 'ok', true);
		release();
		director.dispose();
	});

	it('a law whose whole arc is an alias takes its watch, who and name', async () => {
		const director = await new ArcDirector<Ctx>()
			.addFake()
			.withVerbs((v) => v.addStock()
				.addStockCollective()
				.addAlias('strike', { help: 'law-ready: every unit hits a seen enemy', arc: 'wait()', watch: 'isHurt(me)', who: 'units.filter("Guard")' }))
			.withDefaultKit({ verbs: [...COLLECTIVE_KIT.verbs, 'strike'] })
			.withKernels(kernels())
			.onVerb(() => ({ status: 'ok', verb: 'wait' }))
			.withContext((id) => ({ id }))
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit: { verbs: [...COLLECTIVE_KIT.verbs, 'strike'] }, characters: [{ id: 'Mira', tags: ['Guard'] }] })
			.connect();
		const voice = hive(director).voice;
		assert.equal((await voice.enact(parseArc('law(arc=strike())', voice.verbs))).status === 'ok', true);
		assert.deepEqual(hive(director).laws.map((law) => [law.name, law.who, law.watch]), [['strike', 'units.filter("Guard")', 'isHurt(me)']]);
		assert.equal((await voice.enact(parseArc('unlaw(name=strike)', voice.verbs))).status === 'ok', true);
		assert.deepEqual(hive(director).laws, []);
		director.dispose();
	});

	it('a character in a collective adds and drops its own laws there', async () => {
		const { director, release, dawn } = await stage();
		const wisp = dawn.character('Wisp')!;
		const law = wisp.addLaw({ name: 'duck', watch: 'isHurt(me)', arc: 'wait()' });
		assert.equal(law, dawn.laws.find((l) => l.name === 'Wisp.duck'));
		assert.equal(law?.who, 'me');
		assert.deepEqual(wisp.laws, []);
		wisp.removeLaw('duck');
		assert.equal(dawn.laws.some((l) => l.name === 'Wisp.duck'), false);
		release();
		director.dispose();
	});

	it('the mind setter joins, swaps, refuses another\'s mind, and hands over to the host', async () => {
		const { director, release, tom, dawn } = await stage();
		const wisp = dawn.character('Wisp')!;
		assert.throws(() => {
			wisp.mind = tom.mind;
		}, /thinks for 'Tom'/);
		tom.mind = dawn.mind;
		assert.equal(tom.collective, dawn);
		const fresh = new Mind<Ctx>({ rank: 5 });
		tom.mind = fresh;
		assert.equal(tom.collective, null);
		assert.equal(tom.mind, fresh);
		assert.equal(fresh.owner, tom);
		assert.ok(director.minds().includes(fresh));
		tom.mind = null;
		assert.equal(tom.mind, null);
		assert.equal(fresh.attached, false);
		tom.collective = dawn;
		tom.collective = null;
		assert.equal(tom.mind, null);
		assert.deepEqual(director.minds().map((m) => m.id), ['DawnParty', 'DuskParty']);
		release();
		director.dispose();
	});

	it('keeps one namespace for characters and collectives', async () => {
		const { director, release } = await stage();
		assert.throws(() => director.addCharacter({ id: 'DawnParty' }), /already a character or a collective/);
		assert.throws(() => director.addCollective({ id: 'Tom' }), /already a character or a collective/);
		assert.throws(() => director.addCollective({ id: 'Rivals', characters: [{ id: 'Wisp' }] }), /already a character or a collective/);
		release();
		director.dispose();
	});

	it('vacates the commander post when the commander leaves, and drops its party tags', async () => {
		const vacant:string[] = [];
		const { director, release, dawn } = await stage({ vacant });
		const commander = dawn.commander!;
		dawn.tagCharacters([commander], 'Point');
		commander.collective = null;
		assert.equal(dawn.commander, null);
		assert.deepEqual(vacant, ['DawnParty:Dawn']);
		assert.deepEqual(commander.tags, []);
		release();
		director.dispose();
	});

	it('removing a collective leaves its characters on their own', async () => {
		const { director, release, tom, dawn } = await stage();
		tom.collective = dawn;
		director.removeCollective('DawnParty');
		assert.equal(director.collective('DawnParty'), undefined);
		assert.equal(tom.collective, null);
		assert.equal(tom.mind?.owner, tom);
		assert.equal(director.character('Wisp')?.mind, null);
		release();
		director.dispose();
	});
});

describe('hearing', () => {
	/** Bodies on a line; talk carries 2 paces. A hive with no commander, and a party whose commander is Dawn. */
	async function stage(at:Record<string, number>) {
		const talk = new TalkFeature<Ctx>({
			inRange: (a, b) => Math.abs((at[a] ?? 1e9) - (at[b] ?? -1e9)) <= 2,
			others: (speaker) => Object.keys(at).filter((id) => id !== speaker),
		});
		const director = await new ArcDirector<Ctx>()
			.addFake({ chat: () => ({ content: 'wait()', toolCalls: [] }) })
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withContext((id) => ({ id }))
			.onVerb(({ verb }) => ({ status: 'ok', verb }))
			.addFeature(talk)
			.addCharacter({ id: 'Player' })
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit: COLLECTIVE_KIT, characters: [{ id: 'Mira' }, { id: 'Tomas' }] })
			.addCollective({
				id: 'DawnParty',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				commander: 'Dawn',
				characters: [{ id: 'Dawn' }, { id: 'Wisp' }],
			})
			.connect();
		const speech = (id:string) => director.collective(id)!.mind.events().filter((e) => e.kind === 'HeardSpeech');
		const heard = (id:string):string[] => speech(id).map((e) => e.text);
		return { director, talk, heard, speech };
	}

	it('a collective hears through every character it has, each line once', async () => {
		const { director, talk, heard } = await stage({ Player: 10, Mira: 11, Tomas: 9, Dawn: 50, Wisp: 12 });
		talk.say('Player', 'hello there', undefined, 1);
		assert.equal(heard('Hive').length, 1);
		assert.match(heard('Hive')[0], /hello there/);
		assert.equal(heard('DawnParty').length, 1, 'through Wisp, though its commander is far away');
		director.dispose();
	});

	it('a collective hears its characters talk to each other, but not its own voice', async () => {
		const { director, talk, heard } = await stage({ Player: 10, Mira: 11, Tomas: 12, Dawn: 13, Wisp: 14 });
		talk.say('Mira', 'over here', undefined, 1);
		assert.equal(heard('Hive').length, 1, 'through Tomas');
		assert.match(heard('Hive')[0], /Mira.*over here/);
		talk.say('Wisp', 'behind you', undefined, 2);
		talk.say('Dawn', 'hold', undefined, 3);
		const party = heard('DawnParty');
		assert.ok(party.some((line) => /Wisp.*behind you/.test(line)), 'through Dawn');
		assert.equal(party.some((line) => /hold/.test(line)), false, 'its commander is its voice');
		director.dispose();
	});

	it('two collectives hear their characters talk to each other, and know whom it was for', async () => {
		const { director, talk, speech } = await stage({ Player: 0, Tomas: 10, Mira: 11, Dawn: 12, Wisp: 13 });
		talk.say('Mira', 'need a hand?', 'Wisp', 1);
		const [party] = speech('DawnParty');
		assert.match(party?.text ?? '', /Mira says to Wisp: "need a hand\?"/, 'Wisp is not its voice, so not "you"');
		assert.equal(party?.major, true, 'meant for one of its characters, whoever heard it best');
		const [hive] = speech('Hive');
		assert.match(hive?.text ?? '', /Mira says to Wisp/, 'its own character, heard through Tomas');
		assert.equal(hive?.major, false);
		talk.say('Wisp', 'yes', 'Mira', 2);
		assert.match(speech('DawnParty')[1]?.text ?? '', /Wisp says to Mira: "yes"/, 'its own character, heard through Dawn');
		assert.equal(speech('DawnParty')[1]?.major, false);
		assert.match(speech('Hive')[1]?.text ?? '', /Wisp says to Mira: "yes"/);
		assert.equal(speech('Hive')[1]?.major, true);
		director.dispose();
	});

	it('a collective with no commander does not speak for itself', async () => {
		const { director } = await stage({ Player: 10 });
		const hive = director.collective('Hive')!;
		const result = await hive.enact(parseArc('say(text=hi)', hive.verbs));
		assert.equal(result.status === 'ok', false);
		assert.match(result.reason ?? '', /not a character in this scene; command one of your characters to say/);
		director.dispose();
	});
});

describe('a collective with no commander', () => {
	it('looks things up from its characters, and waits on the director\'s clock', async () => {
		const toolResults:string[] = [];
		const director = await new ArcDirector<Ctx>()
			.withPriorityThinkQueue({ processInterval: 0, heartbeatStart: 100, heartbeatMin: 100 })
			.withIntervals({ watch: 0, think: 0 })
			// Native tool calls, as a model asked for plain JSON makes them.
			.withMind({ arcFormat: 'json' })
			.addFake({ chat: (req) => {
				const results = req.messages.filter((m) => m.role === 'tool').map((m) => String(m.content));
				if (results.length > 0) {
					toolResults.push(...results);
					return { content: 'wait(seconds=1)', toolCalls: [] };
				}
				return {
					content: '',
					toolCalls: [
						{ id: 'a', name: 'recall', arguments: '{"query":"Keep"}' },
						{ id: 'b', name: 'observe', arguments: '{"expr":"units"}' },
					],
				};
			} })
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.addFeature(new KnowledgeFeature({ pages: (ctx:Ctx) => [{ name: 'Keep', text: `A stone keep, as ${ctx.id} knows it.` }] }))
			.withContext((id) => (id === 'Hive' ? undefined : { id }))
			.onVerb(({ verb }) => ({ status: 'ok', verb }))
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit: COLLECTIVE_KIT, characters: [{ id: 'Mira' }, { id: 'Tomas' }] })
			.connect();
		const hive = director.collective('Hive')!;
		void hive.mind.tick(1);
		await waitFor(() => hive.verb === 'wait');
		assert.equal(toolResults.length, 2);
		assert.match(toolResults[0], /stone keep, as Mira knows it/);
		assert.match(toolResults[1], /Mira/);
		assert.match(toolResults[1], /Tomas/);
		director.tick(3);
		await waitFor(() => hive.lastResult?.verb === 'wait');
		assert.equal(hive.lastResult?.status === 'ok', true);
		director.dispose();
	});

	it('is offered only its own verbs and wait, yet still issues the rest', async () => {
		const director = await hiveOf();
		const hive = director.collective('Hive')!;
		const offered = hive.activeVerbs();
		assert.equal(offered.has('go_to'), false);
		assert.equal(offered.has('say'), false);
		assert.ok(offered.has('wait') && offered.has('command'));
		const arc = parseArc('command(who=units, arc=go_to(Keep))', offered);
		assert.equal(arc[0].verb, 'command');
		hive.commander = hive.character('Mira')!;
		assert.ok(hive.activeVerbs().has('go_to'));
		director.dispose();
	});

	it('picks one unit by health or distance as a who, and as a verb target', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, hurt: new Set(['Tomas']), hold: (call) => call.verb === 'go_to' });
		const hive = director.collective('Hive')!;
		const ran = async (arc:string):Promise<string[]> => {
			calls.length = 0;
			const result = await hive.enact(parseArc(arc, hive.verbs));
			assert.equal(result.status, 'ok', `${arc}: ${result.reason}`);
			await waitFor(() => calls.length > 0);
			return calls.map((call) => `${call.character.id} ${call.verb} ${String(call.args.target)}`);
		};
		assert.deepEqual(await ran('command(units.minBy(u => u.hp)) { go_to(Keep) }'), ['Tomas go_to Keep']);
		assert.deepEqual(await ran('command(units.maxBy(u => u.hp)) { go_to(Well) }'), ['Mira go_to Well']);
		assert.deepEqual(await ran('command(who=units.minBy(u => distance(me, u))) { go_to(Gate) }'), ['Mira go_to Gate']);
		assert.deepEqual(await ran('command(units.filter("Mira")) { go_to(units.minBy(u => u.hp)) }'), ['Mira go_to Tomas']);
		director.dispose();
	});

	it('says why a who that cannot be read picks no unit', async () => {
		const director = await hiveOf();
		const hive = director.collective('Hive')!;
		const result = await hive.enact(parseArc('command(units.minBy(u => u.mana)) { go_to(Keep) }', hive.verbs));
		assert.equal(result.status, 'failed');
		assert.match(result.reason ?? '', /cannot read units\.minBy\(u => u\.mana\): key is not a number/);
		director.dispose();
	});

	it('shows a unit that takes command as you, out of the group it was commanded in', async () => {
		const director = await hiveOf();
		const hive = director.collective('Hive')!;
		hive.addCharacter({ id: 'Ada', tags: ['Guard'] });
		await hive.enact(parseArc('command(who=units, group=Pack, arc=wait(5s))', hive.verbs));
		hive.commander = hive.character('Mira')!;
		const roster = hive.promptSection(hive.mind).split('\n');
		assert.ok(roster.some((line) => line.startsWith('| Mira (you) |')), roster.join('\n'));
		assert.ok(roster.some((line) => line.startsWith('| Pack |')));
		assert.equal(hive.character('Mira')!.tags.some((tag) => tag.endsWith('Pack')), false);
		director.dispose();
	});

	it('shows each roster tag once, though its own and a spec tag shorten alike', async () => {
		const director = await hiveOf();
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc('tag(who=units.filter("Mira"), name=Guard)', hive.verbs));
		const mira = hive.promptSection(hive.mind).split('\n').find((line) => line.startsWith('| Mira '));
		assert.equal(mira?.match(/Guard/g)?.length, 1);
		director.dispose();
	});
});

describe('a collective under arcFormat schema', () => {
	it('sends the same reply schema string as a character, and issues JSON', async () => {
		const sent:Record<string, string> = {};
		const prompts:string[] = [];
		const director = await new ArcDirector<Ctx>()
			.withMind({ arcFormat: 'schema' })
			.addFake({ chat: (req) => {
				sent[req.thread ?? '?'] = JSON.stringify(req.responseFormat);
				prompts.push(chatContentText(req.messages[0].content));
				return { content: JSON.stringify({ steps: [{ verb: 'wait' }] }), toolCalls: [] };
			} })
			.withVerbs((v) => v.addStock()
				.addStockCollective())
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb((call) => ({ status: 'ok', verb: call.verb }))
			.withContext((id) => ({ id }))
			.addCollective({
				id: 'DawnParty',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				commander: 'Dawn',
				identity: { role: 'Leads.' },
				characters: [{ id: 'Dawn' }, { id: 'Wisp' }],
			})
			.addCharacter({ id: 'Tom', mind: { skipHeartbeat: true }, kit: { verbs: ['wait', 'go_to'] }, identity: { role: 'Walks.' } })
			.connect();
		await Promise.all([director.collective('DawnParty')!.mind.thinkNow({ enact: false }), director.character('Tom')!.mind!.thinkNow({ enact: false })]);
		assert.deepEqual(Object.keys(sent).sort(), ['DawnParty', 'Tom']);
		assert.equal(sent.DawnParty, sent.Tom);
		assert.match(sent.DawnParty, /^\{"name":"reply","schema":/);
		const party = prompts.find((text) => text.includes('command(who, arc)'));
		assert.ok(party);
		assert.match(party, /Once you know enough, emit only the Arc JSON, \{"steps":\[…\]\}/);
		assert.match(party, /recall and observe are tools, not verbs: reply with the tool call, never in the steps\./);
		assert.match(party, /"then" joins the next step: "if_ok" \(the default\) only when/);
		director.dispose();
	});
});
