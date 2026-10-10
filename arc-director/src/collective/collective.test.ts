import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArc, parseArcText, formatArc } from '../arc/parse.js';
import { VerbRegistry, registerStockVerbs, STOCK_VERBS } from '../arc/stock-verbs.js';
import { dummyEntity } from '../expr/natives.js';
import {
	formatSightClauses,
	joinSightClauses,
	mergeHiveClauses,
	orderSightClauses,
} from '../perception/sight.js';
import { ArcDirector } from '../director/director.js';
import type { CollectiveSpec, VerbCall } from '../director/types.js';
import type { Collective } from './collective.js';
import { registerStockCollectiveVerbs, STOCK_COLLECTIVE_VERBS } from './verbs.js';
import { squadTag } from './tags.js';
import { OPEN_WORLD } from '../testing/world.js';
import { Mind } from '../mind/mind.js';
import { TalkNet } from '../mind/talk.js';

type Ctx = { id:string };

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

function collectiveVerbs():VerbRegistry {
	return registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry()));
}

const COLLECTIVE_KIT = { verbs: [...STOCK_VERBS, ...STOCK_COLLECTIVE_VERBS] };

function kernels(hurt:Set<string> = new Set()) {
	return (ctx:Ctx) => ({
		me: dummyEntity(ctx.id, { tags: ['agent'] }),
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
} = {}):Promise<ArcDirector<Ctx>> {
	const director = await new ArcDirector<Ctx>()
		.withPriorityQueue({
			processInterval: 0,
			watchInterval: 0,
			heartbeatStart: 100,
			heartbeatMin: 100,
		})
		.addFakeInference()
		.addStockVerbs()
		.addStockCollectiveVerbs()
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
			return { ok: true, verb: call.verb };
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
		})
		.start();
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
		.withArcText(true)
		.addFakeInference(async () => {
			await hang;
			return { content: 'go_to(Keep)', toolCalls: [] };
		})
		.addStockVerbs()
		.addStockCollectiveVerbs()
		.withDefaultKit(COLLECTIVE_KIT)
		.withKernels(kernels())
		.onVerb((call) => {
			calls.push(call);
			return { ok: true, verb: call.verb };
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
		.start();
	const party = director.collective('DawnParty')!;
	const pending = party.mind.tick(1);
	await sleep(20);
	return { director, party, calls, pending, release };
}

type Hang = Awaited<ReturnType<typeof hangingDawn>>;

describe('Collective chain', () => {
	it('addStockCollectiveVerbs registers; kit must still grant when', async () => {
		const director = await new ArcDirector<Ctx>()
			.addFakeInference()
			.addStockVerbs()
			.addStockCollectiveVerbs()
			.withDefaultKit({ verbs: ['wait'] })
			.withContext((id) => ({ id }))
			.addCollective({
				id: 'Hive',
				mind: { skipHeartbeat: true },
				kit: { verbs: ['wait'] },
				identity: { role: 'Waits.' },
				characters: [{ id: 'Mira' }],
			})
			.start();
		const hive = director.collective('Hive')!;
		assert.ok(hive.verbs.has('issue'));
		assert.equal(hive.activeVerbs().has('issue'), false);
		assert.ok(hive.verbs.has('when'));
		director.dispose();
	});

	it('addCharacter and addLaw stay open after start', async () => {
		const director = await hiveOf();
		const pike = hive(director).addCharacter({ id: 'Pike', tags: ['Flank'] });
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

	it('removeCharacter drops them from the roster and issue who', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		hive(director).removeCharacter('Mira');
		const hive1 = hive(director);
		assert.equal(hive1.character('Mira'), undefined);
		assert.equal(director.character('Mira'), undefined);
		const text = hive1.promptSection(hive1.mind);
		assert.equal(/Mira/.test(text), false);
		await hive1.enact(parseArc('issue(who=allUnits, arc=go_to(Keep))', hive1.verbs));
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
			.addFakeInference()
			.addStockVerbs()
			.addStockCollectiveVerbs()
			.withDefaultKit({ verbs: ['wait'] })
			.withContext((id) => ({ id }))
			.addCollective(party)
			.start();
		const first = await build();
		first.removeCharacter('Dawn');
		first.dispose();
		const next = await build();
		assert.equal(next.collective('DawnParty')?.commander?.id, 'Dawn');
		next.dispose();
	});

	it('a character keeps its own kit in a collective; the roster says what it cannot do', async () => {
		const director = await new ArcDirector<Ctx>()
			.addFakeInference()
			.addStockVerbs()
			.addStockCollectiveVerbs()
			.withDefaultKit(COLLECTIVE_KIT)
			.withContext((id) => ({ id }))
			.onVerb(({ verb }) => ({ ok: true, verb }))
			.withDefaultKit({ verbs: ['go_to', 'follow'] })
			.addCharacter({ id: 'Tom', kit: { verbs: ['go_to'] } })
			.addCollective({
				id: 'DawnParty',
				mind: { skipHeartbeat: true },
				kit: { verbs: ['go_to', 'follow', 'issue'] },
				characters: [{ id: 'Ann' }],
			})
			.start();
		const party = director.collective('DawnParty')!;
		const verbsOf = (id:string) => director.character(id)!.activeVerbs().list().map((v) => v.name).sort();
		assert.deepEqual(verbsOf('Ann'), ['follow', 'go_to']);
		director.character('Tom')!.collective = party;
		assert.deepEqual(verbsOf('Tom'), ['go_to']);
		assert.match(party.promptSection(party.mind), /^- Ann$\n^- Tom \(cannot follow\)$/m);
		director.dispose();
	});

	it('enact on a character runs the arc on that character and returns the result', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const mira = hive(director).character('Mira');
		assert.ok(mira);
		const result = await mira.enact(parseArc('go_to(Keep)', mira.verbs));
		assert.equal(result.ok, true);
		assert.equal(result.verb, 'go_to');
		assert.equal(calls.some((c) => c.character.id === 'Mira' && c.verb === 'go_to'), true);
		assert.equal(calls.some((c) => c.character.id === 'Tomas'), false);
		director.dispose();
	});
});

describe('issue(who)', () => {
	it('parses unquoted who= and nested arc=', () => {
		const registry = collectiveVerbs();
		const arc = parseArcText(
			'issue(who=units.filter("Loaf").filter(u => !u.busy), arc=go_to(BakerStall)) '
			+ '; issue(who=units.filter("Guard"), arc=go_to(Tomas) && give(item=Loaf, to=Tomas))',
			registry,
		);
		assert.equal(arc.head?.verb, 'issue');
		assert.equal(arc.head?.args.who, 'units.filter("Loaf").filter(u => !u.busy)');
		assert.equal(typeof arc.head?.args.arc, 'object');
		assert.ok(arc.head?.args.arc && typeof arc.head.args.arc === 'object' && 'head' in arc.head.args.arc);
		const inner = arc.head.args.arc as { head:{ verb:string }; then?:{ arc:{ head:{ verb:string } } } };
		assert.equal(inner.head.verb, 'go_to');
		assert.equal(arc.then?.arc.head?.verb, 'issue');
		const second = arc.then!.arc.head!.args.arc as {
			head:{ verb:string };
			then?:{ arc:{ head:{ verb:string; args:Record<string, unknown> } } };
		};
		assert.equal(second.head.verb, 'go_to');
		assert.equal(second.then?.arc.head.verb, 'give');
		assert.match(formatArc(arc), /issue\(/);
	});

	it('is instantaneous and fans out to each character', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, slow: true });
		const hive = director.collective('Hive')!;
		const t0 = Date.now();
		const result = await hive.enact(parseArc(
			'issue(who=units.filter("Guard"), arc=go_to(Keep))',
			hive.verbs,
		));
		assert.ok(Date.now() - t0 < 30);
		assert.equal(result.ok, true);
		assert.equal(result.verb, 'issue');
		await waitFor(() => calls.some((c) => c.verb === 'go_to' && c.character.id === 'Mira'));
		assert.ok(calls.some((c) => c.verb === 'go_to' && c.character.id === 'Tomas'));
		assert.equal(calls.some((c) => c.verb === 'issue'), false);
		director.dispose();
	});

	it('issue ; issue starts both groups without waiting on characters', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, slow: true });
		const hive = director.collective('Hive')!;
		const result = await hive.enact(parseArc(
			'issue(who=units.filter("Mira"), arc=go_to(WestGate)) '
			+ '; issue(who=units.filter("Tomas"), arc=go_to(EastGate))',
			hive.verbs,
		));
		assert.equal(result.ok, true);
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
			'issue(who=units.filter("Mira"), arc=go_to(Tomas) && examine(Tomas))',
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
			'issue(who=units.filter("Guard"), arc=go_to(Keep))',
			hive.verbs,
		));
		await waitFor(() => hive.character('Mira')?.busy === true);
		await hive.enact(parseArc(
			'issue(who=units.filter("Mira"), arc=go_to(Home))',
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
			'issue(who=units.filter("Mira"), arc=wander(until=isNear(me, Tomas))) '
			+ '; issue(who=units.filter("Tomas"), arc=wander(until=isNear(me, Mira)))',
			hive.verbs,
		));
		await waitFor(() => calls.filter((c) => c.verb === 'wander').length >= 2);
		const mira = calls.find((c) => c.character.id === 'Mira' && c.verb === 'wander');
		const tomas = calls.find((c) => c.character.id === 'Tomas' && c.verb === 'wander');
		assert.equal(mira?.args.until, 'isNear(me, Tomas)');
		assert.equal(tomas?.args.until, 'isNear(me, Mira)');
		director.dispose();
	});

	it('each character issued a formation takes its own place in the same squad', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc(
			'issue(who=units.filter("Guard"), arc=hold_line(at=WestGate, facing=Player))',
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
		director.tick(0.05, 1);
		await waitFor(() => calls.some((c) => c.character.id === 'Mira' && c.verb === 'go_to'));
		assert.equal(hive.mind.lastArc, undefined);
		const n = calls.filter((c) => c.character.id === 'Mira' && c.verb === 'go_to').length;
		director.tick(0.05, 2);
		await sleep(20);
		assert.equal(calls.filter((c) => c.character.id === 'Mira' && c.verb === 'go_to').length, n);
		await hive.enact(parseArc(
			'issue(who=units.filter("Mira"), arc=go_to(Home))',
			hive.verbs,
		));
		await waitFor(() => calls.some((c) => c.character.id === 'Mira' && String(c.args.target) === 'Home'));
		director.dispose();
	});

	it('tags are namespaced per conductor', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await new ArcDirector<Ctx>()
			.addFakeInference()
			.addStockVerbs()
			.addStockCollectiveVerbs()
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb((call) => {
				calls.push(call);
				return { ok: true, verb: call.verb };
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
			.start();
		const red = director.collective('Red')!;
		const blue = director.collective('Blue')!;
		assert.deepEqual(red.character('Able')?.tags, ['Guard']);
		await red.enact(parseArc('issue(who=units.filter("Guard"), arc=go_to(Keep))', red.verbs));
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
			.addFakeInference()
			.addStockVerbs()
			.addStockCollectiveVerbs()
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb((call) => {
				calls.push(call);
				return { ok: true, verb: call.verb };
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
			.start();
		const captain = director.collective('Guards')!.voice;
		assert.equal(captain, director.character('Captain'));
		await captain.enact(parseArc(
			'issue(who=units.filter("Mira"), arc=go_to(Keep)) ; go_to(WestGate)',
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
		assert.equal((await conductor.perform({ verb: 'focus', args: { expr: 'isHurt(it)' } })).ok, false);
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
			'issue(who=units.filter("Mira"), arc=go_to(WestGate)) '
			+ '; issue(who=units.filter("Tomas"), arc=go_to(EastGate))',
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
			'issue(who=units.filter("Mira"), arc=say("hold"))',
			hive.verbs,
		));
		assert.ok(hive.laws.some((l) => l.name === 'flee'));
		director.dispose();
	});

	it('watch false aborts a running law', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const hurt = new Set(['Mira']);
		const director = await hiveOf({ calls, hurt, slow: true });
		const hive = director.collective('Hive')!;
		director.tick(0.05, 1);
		await waitFor(() => hive.character('Mira')?.busy === true);
		hurt.delete('Mira');
		director.tick(0.05, 2);
		await waitFor(() => hive.character('Mira')?.busy === false);
		director.dispose();
	});

	it('a hive with no commander uses dummy me and skips carrying', async () => {
		let hiveCarry = 0;
		const director = await new ArcDirector<Ctx>()
			.withWorld(OPEN_WORLD)
			.addFakeInference()
			.addStockVerbs()
			.addStockCollectiveVerbs()
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.withInventory((ctx) => {
				if (ctx.id === 'Hive') {
					hiveCarry += 1;
				}
				return { pockets: [] };
			})
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
			.start();
		director.tick(0.05, 1);
		assert.equal(hiveCarry, 0);
		director.dispose();
	});

	it('a formation after other steps runs when they are done', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc(
			'issue(who=units.filter("Mira"), arc=go_to(Keep) && hold_line(at=WestGate, facing=Player))',
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

describe('commander pointer and sticky issue', () => {
	it('thinkThread and identity follow the living commander', async () => {
		const director = await new ArcDirector<Ctx>()
			.addFakeInference()
			.addStockVerbs()
			.addStockCollectiveVerbs()
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb(() => ({ ok: true, verb: 'go_to' }))
			.withContext((id) => ({ id }))
			.addCollective({
				id: 'DawnParty',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				commander: 'Dawn',
				identity: { role: 'Leads.' },
				characters: [{ id: 'Dawn' }, { id: 'Wisp' }],
			})
			.start();
		const party = director.collective('DawnParty')!;
		assert.equal(party.mind.thinkThread(), 'Dawn');
		assert.equal(party.mind.id, 'DawnParty');
		director.removeCharacter('Dawn');
		assert.equal(party.mind.thinkThread(), 'DawnParty');
		party.commander = party.character('Wisp')!;
		assert.equal(party.mind.thinkThread(), 'Wisp');
		director.dispose();
	});

	for (const [name, abort] of [
		['abortThink', (h:Hang) => h.party.mind.abortThink()],
		['director.abortThink', (h:Hang) => h.director.abortThink('DawnParty')],
		['vacating the commander', (h:Hang) => h.director.removeCharacter('Dawn')],
		['removeCollective', (h:Hang) => h.director.removeCollective('DawnParty')],
		['setAiOn(false)', (h:Hang) => h.director.mindQueue()?.setAiOn('DawnParty', false)],
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

	it('issue(me) fails; allUnits skips the commander', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await new ArcDirector<Ctx>()
			.addFakeInference()
			.addStockVerbs()
			.addStockCollectiveVerbs()
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb((call) => {
				calls.push(call);
				return { ok: true, verb: call.verb };
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
			.start();
		const guards = director.collective('Guards')!;
		assert.equal(guards.commander?.id, 'Captain');
		const captain = guards.voice;
		const me = await captain.enact(parseArc('issue(who=me, arc=go_to(Keep))', captain.verbs));
		assert.equal(me.ok, false);
		assert.equal(calls.some((c) => c.character.id === 'Captain' && c.verb === 'go_to'), false);
		await captain.enact(parseArc('issue(who=allUnits, arc=go_to(Home))', captain.verbs));
		await waitFor(() => calls.some((c) => c.character.id === 'Mira' && String(c.args.target) === 'Home'));
		assert.equal(calls.some((c) => c.character.id === 'Captain' && String(c.args.target) === 'Home'), false);
		director.dispose();
	});

	it('groups identical unit programs in the prompt section', async () => {
		const director = await hiveOf({ slow: true });
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc(
			'issue(who=units.filter("Guard"), arc=go_to(Keep))',
			hive.verbs,
		));
		await waitFor(() => hive.character('Mira')?.busy === true && hive.character('Tomas')?.busy === true);
		const text = hive.promptSection(hive.mind);
		assert.match(text, /Mira, Tomas: go_to\(Keep\)/);
		director.dispose();
	});

	it('shows how each unit program is going, failures with why and choose picks', async () => {
		const director = await hiveOf({ slow: true });
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc('issue(who=units.filter("Guard"), arc=go_to(Keep))', hive.verbs));
		await waitFor(() => hive.character('Mira')?.busy === true);
		const mira = hive.character('Mira')!;
		mira.record.note({ ok: true, verb: 'shoot' });
		for (let i = 0; i < 3; i++) {
			mira.record.note({ ok: false, verb: 'shoot', reason: 'no line of sight' });
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
		assert.match(text, /Units \(issue who=units\.filter\("Tag"\)/);
		assert.match(text, /- Mira: Guard/);
		assert.match(text, /- Tomas: Guard/);
		director.dispose();
	});

	it('does not start a law on a unit with no host context', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await new ArcDirector<Ctx>()
			.withPriorityQueue({
				processInterval: 0,
				watchInterval: 0,
				heartbeatStart: 100,
				heartbeatMin: 100,
			})
			.addFakeInference()
			.addStockVerbs()
			.addStockCollectiveVerbs()
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels(new Set(['Mira', 'Tomas'])))
			.onVerb((call) => {
				calls.push(call);
				return { ok: true, verb: call.verb };
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
			.start();
		director.tick(1, 1);
		await waitFor(() => calls.some((c) => c.character.id === 'Tomas' && c.verb === 'go_to'));
		assert.equal(calls.some((c) => c.character.id === 'Mira'), false);
		director.dispose();
	});

	it('vacates the commander on commander = null', async () => {
		const vacant:{ collective:string; character:string }[] = [];
		const director = await new ArcDirector<Ctx>()
			.addFakeInference()
			.addStockVerbs()
			.addStockCollectiveVerbs()
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.onVerb(() => ({ ok: true, verb: 'go_to' }))
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
			.start();
		const guards = director.collective('Guards')!;
		guards.commander = null;
		assert.deepEqual(vacant, [{ collective: 'Guards', character: 'Captain' }]);
		assert.equal(guards.commander, null);
		director.dispose();
	});
});

describe('solo law', () => {
	it('survives think and omits who from the kit', async () => {
		const director = await new ArcDirector<Ctx>()
			.addFakeInference()
			.addStockVerbs()
			.withKernels(kernels())
			.onVerb(() => ({ ok: true, verb: 'go_to' }))
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
			.start();
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
			.addFakeInference(() => ({ content: 'wait()', toolCalls: [] }))
			.withArcText(true)
			.addStockVerbs()
			.addStockCollectiveVerbs()
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels(opts.hurt))
			.onVerb(async (call) => {
				calls.push(call);
				if (call.verb === 'go_to') {
					await held;
				}
				return { ok: true, verb: call.verb };
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
			.start();
		const tom = director.character('Tom')!;
		const dawn = director.collective('DawnParty')!;
		const dusk = director.collective('DuskParty')!;
		return { director, calls, release, tom, dawn, dusk };
	}

	it('join, move and leave keep the running arc and the law that started it', async () => {
		const { director, calls, release, tom, dawn, dusk } = await stage({ hurt: new Set(['Tom']) });
		const flee = tom.laws[0];
		director.tick(0.05, 1);
		await waitFor(() => calls.some((c) => c.character.id === 'Tom' && c.verb === 'go_to'));
		const ownMind = tom.mind;
		tom.collective = dawn;
		assert.equal(tom.mind, dawn.mind);
		assert.equal(ownMind?.attached, false);
		assert.deepEqual(tom.laws, []);
		assert.equal(dawn.laws.find((law) => law.name === 'Tom.flee'), flee);
		assert.equal(tom.liveArc, true);
		director.tick(0.05, 2);
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
		assert.equal(tom.mind?.rank, 2);
		assert.equal(tom.liveArc, true);
		director.tick(0.05, 3);
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
		assert.equal((await wisp.enact(parseArc('law(watch=1 > 0, arc=wait(), name=hold)', wisp.verbs))).ok, true);
		assert.equal((await wisp.enact(parseArc('law(who=units, watch=1 > 0, arc=wait(), name=x)', wisp.verbs))).ok, false);
		const voice = dawn.voice;
		assert.equal((await voice.enact(parseArc('law(who=units, watch=1 > 0, arc=wait(), name=rally)', voice.verbs))).ok, true);
		assert.deepEqual(dawn.laws.map((law) => [law.name, law.who]), [['rally', 'units'], ['Wisp.hold', 'me']]);
		release();
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
		const talk = new TalkNet({
			inRange: (a, b) => Math.abs((at[a] ?? 1e9) - (at[b] ?? -1e9)) <= 2,
			others: (speaker) => Object.keys(at).filter((id) => id !== speaker),
		});
		const director = await new ArcDirector<Ctx>()
			.addFakeInference(() => ({ content: 'wait()', toolCalls: [] }))
			.addStockVerbs()
			.addStockCollectiveVerbs()
			.withDefaultKit(COLLECTIVE_KIT)
			.withContext((id) => ({ id }))
			.onVerb(({ verb }) => ({ ok: true, verb }))
			.withTalk(talk)
			.addCharacter({ id: 'Player' })
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit: COLLECTIVE_KIT, characters: [{ id: 'Mira' }, { id: 'Tomas' }] })
			.addCollective({
				id: 'DawnParty',
				mind: { skipHeartbeat: true },
				kit: COLLECTIVE_KIT,
				commander: 'Dawn',
				characters: [{ id: 'Dawn' }, { id: 'Wisp' }],
			})
			.start();
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
		assert.equal(result.ok, false);
		assert.match(result.reason ?? '', /not a character in this scene; issue say to one of your characters/);
		director.dispose();
	});
});

describe('a collective with no commander', () => {
	it('looks things up from its characters, and waits on the director\'s clock', async () => {
		const toolResults:string[] = [];
		const director = await new ArcDirector<Ctx>()
			.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 100, heartbeatMin: 100 })
			.addFakeInference((req) => {
				const results = req.messages.filter((m) => m.role === 'tool').map((m) => String(m.content));
				if (results.length > 0) {
					toolResults.push(...results);
					return { content: 'wait(seconds=1)', toolCalls: [] };
				}
				return {
					content: '',
					toolCalls: [
						{ id: 'a', name: 'grep_world_encyclopedia', arguments: '{"query":"Keep"}' },
						{ id: 'b', name: 'observe', arguments: '{"expr":"units"}' },
					],
				};
			})
			.addStockVerbs()
			.addStockCollectiveVerbs()
			.withDefaultKit(COLLECTIVE_KIT)
			.withKernels(kernels())
			.withEncyclopedia((ctx:Ctx) => [{ name: 'Keep', text: `A stone keep, as ${ctx.id} knows it.` }])
			.withContext((id) => (id === 'Hive' ? undefined : { id }))
			.onVerb(({ verb }) => ({ ok: true, verb }))
			.addCollective({ id: 'Hive', mind: { skipHeartbeat: true }, kit: COLLECTIVE_KIT, characters: [{ id: 'Mira' }, { id: 'Tomas' }] })
			.start();
		const hive = director.collective('Hive')!;
		void hive.mind.tick(1);
		await waitFor(() => hive.verb === 'wait');
		assert.equal(toolResults.length, 2);
		assert.match(toolResults[0], /stone keep, as Mira knows it/);
		assert.match(toolResults[1], /Mira/);
		assert.match(toolResults[1], /Tomas/);
		director.tick(2, 3);
		await waitFor(() => hive.lastResult?.verb === 'wait');
		assert.equal(hive.lastResult?.ok, true);
		director.dispose();
	});

	it('is offered only its own verbs and wait, yet still issues the rest', async () => {
		const director = await hiveOf();
		const hive = director.collective('Hive')!;
		const offered = hive.activeVerbs();
		assert.equal(offered.has('go_to'), false);
		assert.equal(offered.has('say'), false);
		assert.ok(offered.has('wait') && offered.has('issue'));
		const arc = parseArc('issue(who=units, arc=go_to(Keep))', offered);
		assert.equal(arc.head.verb, 'issue');
		hive.commander = hive.character('Mira')!;
		assert.ok(hive.activeVerbs().has('go_to'));
		director.dispose();
	});

	it('shows each roster tag once, though its own and a spec tag shorten alike', async () => {
		const director = await hiveOf();
		const hive = director.collective('Hive')!;
		await hive.enact(parseArc('tag(who=units.filter("Mira"), name=Guard)', hive.verbs));
		const mira = hive.promptSection(hive.mind).split('\n').find((line) => line.startsWith('- Mira'));
		assert.equal(mira?.match(/Guard/g)?.length, 1);
		director.dispose();
	});
});
