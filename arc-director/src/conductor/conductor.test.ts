import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArc, parseArcText, formatArc } from '../arc/parse.js';
import { VerbRegistry, registerStockVerbs, STOCK_VERBS } from '../arc/stock-verbs.js';
import { dummyEntity } from '../expr/natives.js';
import { FakeProvider } from '../inference/fake.js';
import {
	formatSightClauses,
	joinSightClauses,
	mergeHiveClauses,
	orderSightClauses,
} from '../perception/sight.js';
import { ArcDirector } from '../director/director.js';
import type { VerbCall } from '../director/types.js';
import { CrowdConductor, isCrowdConductor } from './conductor.js';
import { registerStockCrowdVerbs, STOCK_CROWD_VERBS } from './conductor-verbs.js';
import { squadTag } from './tags.js';
import { OPEN_WORLD } from '../testing/world.js';

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

function crowdVerbs():VerbRegistry {
	return registerStockCrowdVerbs(registerStockVerbs(new VerbRegistry()));
}

const CROWD_KIT = { verbs: [...STOCK_VERBS, ...STOCK_CROWD_VERBS] };

function kernels(hurt:Set<string> = new Set()) {
	return (ctx:Ctx) => ({
		me: dummyEntity(ctx.id, { tags: ['agent'] }),
		others: [],
		items: [],
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
	kit?:{ verbs:string[] };
} = {}):Promise<ArcDirector<Ctx>> {
	const director = await new ArcDirector<Ctx>()
		.withPriorityQueue({
			processInterval: 0,
			watchInterval: 0,
			heartbeatStart: 100,
			heartbeatMin: 100,
			maxParallel: 2,
		})
		.withFakeInference()
		.addStockVerbs()
		.addStockCrowdVerbs()
		.withSight({ limit: 16 })
		.withKernels(kernels(opts.hurt))
		.onVerb(async (call) => {
			opts.calls?.push(call);
			if (opts.slow) {
				await sleep(40);
			}
			return { ok: true, verb: call.verb };
		})
		.withContext((id) => ({ id }))
		.addCrowdConductor({
			id: 'Hive',
			skipHeartbeat: true,
			kit: opts.kit ?? CROWD_KIT,
			identity: { role: 'Keeps the square moving.' },
			pinnedSightFocus: ['isHurt(it)'],
			sightFocus: ['isNear(it, Player)'],
			units: [
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

async function hangingDawn():Promise<{
	director:ArcDirector<Ctx>;
	dawn:CrowdConductor<Ctx>;
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
		.withFakeInference(async () => {
			await hang;
			return { content: 'go_to(Keep)', toolCalls: [] };
		})
		.addStockVerbs()
		.addStockCrowdVerbs()
		.withKernels(kernels())
		.onVerb((call) => {
			calls.push(call);
			return { ok: true, verb: call.verb };
		})
		.withContext((id) => ({ id }))
		.addCrowdConductor({
			id: 'Dawn',
			skipHeartbeat: true,
			kit: CROWD_KIT,
			commander: 'Dawn',
			identity: { role: 'Leads.' },
			units: [{ id: 'Dawn' }, { id: 'Wisp' }],
		})
		.start();
	const dawn = director.agent('Dawn');
	assert.ok(isCrowdConductor(dawn));
	const pending = dawn.tick(1);
	await sleep(20);
	return { director, dawn, calls, pending, release };
}

type Hang = Awaited<ReturnType<typeof hangingDawn>>;

describe('CrowdConductor chain', () => {
	it('addStockCrowdVerbs registers; kit must still grant when', async () => {
		const director = await new ArcDirector<Ctx>()
			.withFakeInference()
			.addStockVerbs()
			.addStockCrowdVerbs()
			.withContext((id) => ({ id }))
			.addCrowdConductor({
				id: 'Hive',
				skipHeartbeat: true,
				kit: { verbs: ['wait'] },
				identity: { role: 'Waits.' },
				units: [{ id: 'Mira' }],
			})
			.start();
		const agent = director.agent('Hive')!;
		assert.ok(agent.verbs.has('issue'));
		assert.equal(agent.activeVerbs().has('issue'), false);
		assert.ok(agent.verbs.has('when'));
		assert.ok(isCrowdConductor(agent));
		director.dispose();
	});

	it('addCrowdUnit and addCrowdLaw stay open after start', async () => {
		const director = await hiveOf();
		director.addCrowdUnit('Hive', { id: 'Pike', tags: ['Flank'] });
		director.addCrowdLaw('Hive', {
			name: 'follow',
			who: 'units.filter("Pike")',
			watch: 'isNear(me, Player)',
			arc: 'follow(Player)',
		});
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		assert.ok(hive.crowd.has('Pike'));
		assert.ok(hive.laws.some((s) => s.name === 'follow'));
		assert.equal(hive.crowd.get('Pike')?.tags.includes(squadTag('Hive', 'Flank')), true);
		director.dispose();
	});

	it('removeCrowdUnit drops them from the roster and issue who', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		director.removeCrowdUnit('Hive', 'Mira');
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		assert.equal(hive.crowd.has('Mira'), false);
		const text = (hive as unknown as { extraVolatile():string }).extraVolatile();
		assert.equal(/Mira/.test(text), false);
		await hive.enact(parseArc('issue(who=allUnits, arc=go_to(Keep))', hive.verbs));
		await waitFor(() => calls.some((c) => c.verb === 'go_to'));
		assert.equal(calls.some((c) => c.actorID === 'Mira'), false);
		assert.equal(calls.some((c) => c.actorID === 'Tomas' && c.verb === 'go_to'), true);
		director.dispose();
	});
});

describe('issue(who)', () => {
	it('parses unquoted who= and nested arc=', () => {
		const registry = crowdVerbs();
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

	it('is instantaneous and fans out with actorID', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, slow: true });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		const t0 = Date.now();
		const result = await hive.enact(parseArc(
			'issue(who=units.filter("Guard"), arc=go_to(Keep))',
			hive.verbs,
		));
		assert.ok(Date.now() - t0 < 30);
		assert.equal(result.ok, true);
		assert.equal(result.verb, 'issue');
		await waitFor(() => calls.some((c) => c.verb === 'go_to' && c.actorID === 'Mira'));
		assert.ok(calls.some((c) => c.verb === 'go_to' && c.actorID === 'Tomas'));
		assert.equal(calls.some((c) => c.verb === 'issue'), false);
		director.dispose();
	});

	it('issue ; issue starts both groups without waiting on bodies', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, slow: true });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		const result = await hive.enact(parseArc(
			'issue(who=units.filter("Mira"), arc=go_to(WestGate)) '
			+ '; issue(who=units.filter("Tomas"), arc=go_to(EastGate))',
			hive.verbs,
		));
		assert.equal(result.ok, true);
		await waitFor(() => (
			calls.some((c) => c.actorID === 'Mira' && String(c.args.target) === 'WestGate')
			&& calls.some((c) => c.actorID === 'Tomas' && String(c.args.target) === 'EastGate')
		));
		director.dispose();
	});

	it('inner arc= is sequential per unit', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		await hive.enact(parseArc(
			'issue(who=units.filter("Mira"), arc=go_to(Tomas) && examine(Tomas))',
			hive.verbs,
		));
		await waitFor(() => calls.filter((c) => c.actorID === 'Mira').length >= 2);
		const mine = calls.filter((c) => c.actorID === 'Mira').map((c) => c.verb);
		assert.deepEqual(mine.slice(0, 2), ['go_to', 'examine']);
		director.dispose();
	});

	it('who= uses units not others; later when interrupts that unit only', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, slow: true });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		void hive.enact(parseArc(
			'issue(who=units.filter("Guard"), arc=go_to(Keep))',
			hive.verbs,
		));
		await waitFor(() => hive.crowd.get('Mira')?.busy === true);
		await hive.enact(parseArc(
			'issue(who=units.filter("Mira"), arc=go_to(Home))',
			hive.verbs,
		));
		await waitFor(() => calls.some((c) => c.actorID === 'Mira' && String(c.args.target) === 'Home'));
		assert.ok(hive.crowd.get('Tomas')?.busy);
		director.dispose();
	});

	it('meetup wander(until) uses inner me = unit', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		await hive.enact(parseArc(
			'issue(who=units.filter("Mira"), arc=wander(until=isNear(me, Tomas))) '
			+ '; issue(who=units.filter("Tomas"), arc=wander(until=isNear(me, Mira)))',
			hive.verbs,
		));
		await waitFor(() => calls.filter((c) => c.verb === 'wander').length >= 2);
		const mira = calls.find((c) => c.actorID === 'Mira' && c.verb === 'wander');
		const tomas = calls.find((c) => c.actorID === 'Tomas' && c.verb === 'wander');
		assert.equal(mira?.args.until, 'isNear(me, Tomas)');
		assert.equal(tomas?.args.until, 'isNear(me, Mira)');
		director.dispose();
	});

	it('formation verbs run once on the set', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		await hive.enact(parseArc(
			'issue(who=units.filter("Guard"), arc=hold_line(at=WestGate, facing=Player))',
			hive.verbs,
		));
		const lines = calls.filter((c) => c.verb === 'hold_line');
		assert.equal(lines.length, 1);
		assert.deepEqual((lines[0].units ?? []).slice().sort(), ['Mira', 'Tomas']);
		director.dispose();
	});
});

describe('laws and tags', () => {
	it('hurt unit gets go_to without a think; no per-tick restart; when(who) wins', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const hurt = new Set(['Mira']);
		const director = await hiveOf({ calls, hurt, slow: true });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		assert.equal(hive.lastArc, undefined);
		director.tick(0.05, 1);
		await waitFor(() => calls.some((c) => c.actorID === 'Mira' && c.verb === 'go_to'));
		assert.equal(hive.lastArc, undefined);
		const n = calls.filter((c) => c.actorID === 'Mira' && c.verb === 'go_to').length;
		director.tick(0.05, 2);
		await sleep(20);
		assert.equal(calls.filter((c) => c.actorID === 'Mira' && c.verb === 'go_to').length, n);
		await hive.enact(parseArc(
			'issue(who=units.filter("Mira"), arc=go_to(Home))',
			hive.verbs,
		));
		await waitFor(() => calls.some((c) => c.actorID === 'Mira' && String(c.args.target) === 'Home'));
		director.dispose();
	});

	it('tags are namespaced per conductor', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await new ArcDirector<Ctx>()
			.withFakeInference()
			.addStockVerbs()
			.addStockCrowdVerbs()
			.withKernels(kernels())
			.onVerb((call) => {
				calls.push(call);
				return { ok: true, verb: call.verb };
			})
			.withContext((id) => ({ id }))
			.addCrowdConductor({
				id: 'Red',
				skipHeartbeat: true,
				kit: CROWD_KIT,
				identity: { role: 'Commands red.' },
				units: [{ id: 'Able', tags: ['Guard'] }],
			})
			.addCrowdConductor({
				id: 'Blue',
				skipHeartbeat: true,
				kit: CROWD_KIT,
				identity: { role: 'Commands blue.' },
				units: [{ id: 'Baker', tags: ['Guard'] }],
			})
			.start();
		const red = director.agent('Red');
		const blue = director.agent('Blue');
		assert.ok(isCrowdConductor(red) && isCrowdConductor(blue));
		assert.equal(red.crowd.get('Able')?.tags.includes(squadTag('Red', 'Guard')), true);
		assert.equal(blue.crowd.get('Baker')?.tags.includes(squadTag('Blue', 'Guard')), true);
		await red.enact(parseArc('issue(who=units.filter("Guard"), arc=go_to(Keep))', red.verbs));
		await waitFor(() => calls.some((c) => c.actorID === 'Able'));
		assert.equal(calls.some((c) => c.actorID === 'Baker'), false);
		await red.enact(parseArc('tag(who=units.filter("Able"), name=Flank)', red.verbs));
		assert.ok(red.crowd.get('Able')?.tags.includes(squadTag('Red', 'Flank')));
		assert.equal(blue.crowd.get('Baker')?.tags.includes(squadTag('Red', 'Flank')), false);
		director.dispose();
	});
});

describe('commander body and sightFocus', () => {
	it('commander mixes own go_to with when(who)', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await new ArcDirector<Ctx>()
			.withFakeInference()
			.addStockVerbs()
			.addStockCrowdVerbs()
			.withKernels(kernels())
			.onVerb((call) => {
				calls.push(call);
				return { ok: true, verb: call.verb };
			})
			.withContext((id) => ({ id }))
			.addCrowdConductor({
				id: 'Captain',
				skipHeartbeat: true,
				kit: CROWD_KIT,
				identity: { role: 'Leads.' },
				units: [{ id: 'Mira', tags: ['Guard'] }],
			})
			.start();
		const captain = director.agent('Captain');
		assert.ok(isCrowdConductor(captain));
		await captain.enact(parseArc(
			'issue(who=units.filter("Mira"), arc=go_to(Keep)) ; go_to(WestGate)',
			captain.verbs,
		));
		await waitFor(() => (
			calls.some((c) => c.actorID === 'Mira' && c.verb === 'go_to')
			&& calls.some((c) => c.actorID === 'Captain' && String(c.args.target) === 'WestGate')
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
		const conductor = new CrowdConductor<Ctx>({
			id: 'Hive',
			identity: { role: 'Sees.' },
			pinnedSightFocus: ['isHurt(it)'],
			sightFocus: ['isNear(it, Player)'],
			provider: new FakeProvider(() => ({ content: '{}', toolCalls: [] })),
			verbs: crowdVerbs(),
			senses: {},
			tools: {},
			context: () => ({ id: 'Hive' }),
		});
		assert.deepEqual(conductor.pinnedSightFocus, ['isHurt(it)']);
		assert.deepEqual(conductor.sightFocus, ['isNear(it, Player)']);
		assert.equal((await conductor.perform({ verb: 'focus', args: { expr: 'isHurt(it)' } })).ok, false);
		await conductor.perform({ verb: 'focus', args: { expr: 'isNear(it, EastGate)' } });
		await conductor.perform({ verb: 'unfocus', args: { expr: 'isNear(it, Player)' } });
		assert.deepEqual(conductor.pinnedSightFocus, ['isHurt(it)']);
		assert.deepEqual(conductor.sightFocus, ['isNear(it, EastGate)']);
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

describe('actorID, laws, dummy me', () => {
	it('parallel when(who) does not leak actorID', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, slow: true });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		await hive.enact(parseArc(
			'issue(who=units.filter("Mira"), arc=go_to(WestGate)) '
			+ '; issue(who=units.filter("Tomas"), arc=go_to(EastGate))',
			hive.verbs,
		));
		await waitFor(() => (
			calls.some((c) => c.actorID === 'Mira' && c.verb === 'go_to')
			&& calls.some((c) => c.actorID === 'Tomas' && c.verb === 'go_to')
		));
		for (const call of calls.filter((c) => c.verb === 'go_to')) {
			if (call.actorID === 'Mira') {
				assert.equal(String(call.args.target), 'WestGate');
			}
			if (call.actorID === 'Tomas') {
				assert.equal(String(call.args.target), 'EastGate');
			}
		}
		director.dispose();
	});

	it('when(who) does not drop laws', async () => {
		const director = await hiveOf();
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
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
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		director.tick(0.05, 1);
		await waitFor(() => hive.crowd.get('Mira')?.busy === true);
		hurt.delete('Mira');
		director.tick(0.05, 2);
		await waitFor(() => hive.crowd.get('Mira')?.busy === false);
		director.dispose();
	});

	it('bodiless hive uses dummy me and skips carrying', async () => {
		let hiveCarry = 0;
		const director = await new ArcDirector<Ctx>()
			.withWorld(OPEN_WORLD)
			.withFakeInference()
			.addStockVerbs()
			.addStockCrowdVerbs()
			.withKernels(kernels())
			.withInventory((ctx) => {
				if (ctx.id === 'Hive') {
					hiveCarry += 1;
				}
				return { pockets: [] };
			})
			.withContext((id) => id === 'Hive' ? undefined : { id })
			.addCrowdConductor({
				id: 'Hive',
				skipHeartbeat: true,
				kit: CROWD_KIT,
				identity: { role: 'Sees.' },
				units: [
					{ id: 'Mira', tags: ['Guard'] },
					{ id: 'Tomas', tags: ['Guard'] },
				],
			})
			.start();
		director.tick(0.05, 1);
		assert.equal(hiveCarry, 0);
		director.dispose();
	});

	it('formation in a unit body fails closed', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		await hive.enact(parseArc(
			'issue(who=units.filter("Mira"), arc=go_to(Keep) && hold_line(at=WestGate, facing=Player))',
			hive.verbs,
		));
		await waitFor(() => calls.some((c) => c.verb === 'go_to' && c.actorID === 'Mira'));
		assert.equal(calls.some((c) => c.verb === 'hold_line'), false);
		director.dispose();
	});
});

describe('commander pointer and sticky issue', () => {
	it('thinkThread and identity follow the living commander', async () => {
		const director = await new ArcDirector<Ctx>()
			.withFakeInference()
			.addStockVerbs()
			.addStockCrowdVerbs()
			.withKernels(kernels())
			.onVerb(() => ({ ok: true, verb: 'go_to' }))
			.withContext((id) => ({ id }))
			.addCrowdConductor({
				id: 'Dawn',
				skipHeartbeat: true,
				kit: CROWD_KIT,
				commander: 'Dawn',
				identity: { role: 'Leads.' },
				units: [{ id: 'Dawn' }, { id: 'Wisp' }],
			})
			.start();
		const dawn = director.agent('Dawn');
		assert.ok(isCrowdConductor(dawn));
		assert.equal(dawn.thinkThread(), 'Dawn');
		director.removeCrowdUnit('Dawn', 'Dawn');
		director.setCrowdCommander('Dawn', 'Wisp');
		assert.equal(dawn.thinkThread(), 'Wisp');
		assert.notEqual(dawn.thinkThread(), dawn.id);
		director.dispose();
	});

	for (const [name, abort] of [
		['abortThink', (h:Hang) => h.dawn.abortThink()],
		['director.abortThink', (h:Hang) => h.director.abortThink('Dawn')],
		['vacating the commander', (h:Hang) => h.director.removeCrowdUnit('Dawn', 'Dawn')],
		['removeAgent', (h:Hang) => h.director.removeAgent('Dawn')],
		['setAiOn(false)', (h:Hang) => h.director.mindQueue()?.setAiOn('Dawn', false)],
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
			.withFakeInference()
			.addStockVerbs()
			.addStockCrowdVerbs()
			.withKernels(kernels())
			.onVerb((call) => {
				calls.push(call);
				return { ok: true, verb: call.verb };
			})
			.withContext((id) => ({ id }))
			.addCrowdConductor({
				id: 'Captain',
				skipHeartbeat: true,
				kit: CROWD_KIT,
				commander: 'Captain',
				identity: { role: 'Leads.' },
				units: [
					{ id: 'Captain', tags: ['Lead'] },
					{ id: 'Mira', tags: ['Guard'] },
				],
			})
			.start();
		const captain = director.agent('Captain');
		assert.ok(isCrowdConductor(captain));
		assert.equal(captain.commanderID, 'Captain');
		const me = await captain.enact(parseArc('issue(who=me, arc=go_to(Keep))', captain.verbs));
		assert.equal(me.ok, false);
		assert.equal(calls.some((c) => c.actorID === 'Captain' && c.verb === 'go_to'), false);
		await captain.enact(parseArc('issue(who=allUnits, arc=go_to(Home))', captain.verbs));
		await waitFor(() => calls.some((c) => c.actorID === 'Mira' && String(c.args.target) === 'Home'));
		assert.equal(calls.some((c) => c.actorID === 'Captain' && String(c.args.target) === 'Home'), false);
		director.dispose();
	});

	it('groups identical unit programs in extraVolatile', async () => {
		const director = await hiveOf({ slow: true });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		await hive.enact(parseArc(
			'issue(who=units.filter("Guard"), arc=go_to(Keep))',
			hive.verbs,
		));
		await waitFor(() => hive.crowd.get('Mira')?.busy === true && hive.crowd.get('Tomas')?.busy === true);
		const text = (hive as unknown as { extraVolatile():string }).extraVolatile();
		assert.match(text, /Mira, Tomas: go_to\(Keep\)/);
		director.dispose();
	});

	it('lists idle roster tags in extraVolatile', async () => {
		const director = await hiveOf();
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		const text = (hive as unknown as { extraVolatile():string }).extraVolatile();
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
			.withFakeInference()
			.addStockVerbs()
			.addStockCrowdVerbs()
			.withKernels(kernels(new Set(['Mira', 'Tomas'])))
			.onVerb((call) => {
				calls.push(call);
				return { ok: true, verb: call.verb };
			})
			.withContext((id) => (id === 'Mira' ? undefined : { id }))
			.addCrowdConductor({
				id: 'Hive',
				skipHeartbeat: true,
				kit: CROWD_KIT,
				identity: { role: 'Keeps the square moving.' },
				units: [
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
		await waitFor(() => calls.some((c) => c.actorID === 'Tomas' && c.verb === 'go_to'));
		assert.equal(calls.some((c) => c.actorID === 'Mira'), false);
		director.dispose();
	});

	it('vacates commander on setCrowdCommander(null)', async () => {
		const vacant:{ conductorID:string; unitID:string }[] = [];
		const director = await new ArcDirector<Ctx>()
			.withFakeInference()
			.addStockVerbs()
			.addStockCrowdVerbs()
			.withKernels(kernels())
			.onVerb(() => ({ ok: true, verb: 'go_to' }))
			.withContext((id) => ({ id }))
			.onCommanderVacant((conductorID, unitID) => vacant.push({ conductorID, unitID }))
			.addCrowdConductor({
				id: 'Captain',
				skipHeartbeat: true,
				kit: CROWD_KIT,
				commander: 'Captain',
				identity: { role: 'Leads.' },
				units: [{ id: 'Captain' }, { id: 'Mira' }],
			})
			.start();
		director.setCrowdCommander('Captain', null);
		assert.equal(vacant.length, 1);
		assert.equal(vacant[0].unitID, 'Captain');
		const captain = director.agent('Captain');
		assert.ok(isCrowdConductor(captain));
		assert.equal(captain.commanderID, null);
		director.dispose();
	});
});

describe('solo law', () => {
	it('survives think and omits who from the kit', async () => {
		const director = await new ArcDirector<Ctx>()
			.withFakeInference()
			.addStockVerbs()
			.withKernels(kernels())
			.onVerb(() => ({ ok: true, verb: 'go_to' }))
			.withContext((id) => ({ id }))
			.addAgent({
				id: 'Guard',
				skipHeartbeat: true,
				kit: { verbs: [...STOCK_VERBS] },
				identity: { role: 'Watches.' },
				laws: [{
					name: 'flee',
					watch: 'isHurt(me)',
					arc: 'go_to(Keep)',
				}],
			})
			.start();
		const guard = director.agent('Guard');
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
