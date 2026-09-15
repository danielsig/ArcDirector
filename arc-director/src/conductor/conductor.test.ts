import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePlan, parsePlanText, formatPlan } from '../action/parse.js';
import { VerbRegistry, registerStockVerbs, STOCK_VERBS } from '../action/registry.js';
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
import { registerStockCrowdVerbs, STOCK_CROWD_VERBS } from './verbs.js';
import { squadTag } from './tags.js';

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
		at: (who:{ id:string }) => {
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
			identity: { name: 'Hive', role: 'Keeps the square moving.' },
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
				plan: 'go_to(Keep)',
				pinned: true,
			}],
		})
		.start();
	return director;
}

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
				identity: { name: 'Hive', role: 'Waits.' },
				units: [{ id: 'Mira' }],
			})
			.start();
		const agent = director.agent('Hive')!;
		assert.ok(agent.verbs.has('when'));
		assert.equal(agent.activeVerbs().has('when'), false);
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
			plan: 'follow(Player)',
		});
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		assert.ok(hive.crowd.has('Pike'));
		assert.ok(hive.laws.some((s) => s.name === 'follow'));
		assert.equal(hive.crowd.get('Pike')?.tags.includes(squadTag('Hive', 'Flank')), true);
		director.dispose();
	});
});

describe('when(who)', () => {
	it('parses unquoted who= and nested plan=', () => {
		const registry = crowdVerbs();
		const plan = parsePlanText(
			'when(who=units.filter("Loaf").filter(u => !u.busy), plan=go_to(BakerStall)) '
			+ '&& when(who=units.filter("Guard"), plan=go_to(Tomas) && give(item=Loaf, to=Tomas))',
			registry,
		);
		assert.equal(plan.head?.verb, 'when');
		assert.equal(plan.head?.args.who, 'units.filter("Loaf").filter(u => !u.busy)');
		assert.equal(typeof plan.head?.args.plan, 'object');
		assert.ok(plan.head?.args.plan && typeof plan.head.args.plan === 'object' && 'head' in plan.head.args.plan);
		const inner = plan.head.args.plan as { head:{ verb:string }; then?:{ plan:{ head:{ verb:string } } } };
		assert.equal(inner.head.verb, 'go_to');
		assert.equal(plan.then?.plan.head?.verb, 'when');
		const second = plan.then!.plan.head!.args.plan as {
			head:{ verb:string };
			then?:{ plan:{ head:{ verb:string; args:Record<string, unknown> } } };
		};
		assert.equal(second.head.verb, 'go_to');
		assert.equal(second.then?.plan.head.verb, 'give');
		assert.match(formatPlan(plan), /when\(/);
	});

	it('is instantaneous and fans out with actorID', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, slow: true });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		const t0 = Date.now();
		const result = await hive.enact(parsePlan(
			'when(who=units.filter("Guard"), plan=go_to(Keep))',
			hive.verbs,
		));
		assert.ok(Date.now() - t0 < 30);
		assert.equal(result.ok, true);
		assert.equal(result.verb, 'when');
		await waitFor(() => calls.some((c) => c.verb === 'go_to' && c.actorID === 'Mira'));
		assert.ok(calls.some((c) => c.verb === 'go_to' && c.actorID === 'Tomas'));
		assert.equal(calls.some((c) => c.verb === 'when'), false);
		director.dispose();
	});

	it('when && when starts both groups without waiting on bodies', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, slow: true });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		const result = await hive.enact(parsePlan(
			'when(who=units.filter("Mira"), plan=go_to(WestGate)) '
			+ '&& when(who=units.filter("Tomas"), plan=go_to(EastGate))',
			hive.verbs,
		));
		assert.equal(result.ok, true);
		await waitFor(() => (
			calls.some((c) => c.actorID === 'Mira' && String(c.args.name) === 'WestGate')
			&& calls.some((c) => c.actorID === 'Tomas' && String(c.args.name) === 'EastGate')
		));
		director.dispose();
	});

	it('inner plan= is sequential per unit', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		await hive.enact(parsePlan(
			'when(who=units.filter("Mira"), plan=go_to(Tomas) && wait(seconds=1))',
			hive.verbs,
		));
		await waitFor(() => calls.filter((c) => c.actorID === 'Mira').length >= 2);
		const mine = calls.filter((c) => c.actorID === 'Mira').map((c) => c.verb);
		assert.deepEqual(mine.slice(0, 2), ['go_to', 'wait']);
		director.dispose();
	});

	it('who= uses units not others; later when interrupts that unit only', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls, slow: true });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		void hive.enact(parsePlan(
			'when(who=units.filter("Guard"), plan=go_to(Keep))',
			hive.verbs,
		));
		await waitFor(() => hive.crowd.get('Mira')?.busy === true);
		await hive.enact(parsePlan(
			'when(who=units.filter("Mira"), plan=go_to(Home))',
			hive.verbs,
		));
		await waitFor(() => calls.some((c) => c.actorID === 'Mira' && String(c.args.name) === 'Home'));
		assert.ok(hive.crowd.get('Tomas')?.busy);
		director.dispose();
	});

	it('meetup wander(until) uses inner me = unit', async () => {
		const calls:VerbCall<Ctx>[] = [];
		const director = await hiveOf({ calls });
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		await hive.enact(parsePlan(
			'when(who=units.filter("Mira"), plan=wander(until=isNear(me, Tomas))) '
			+ '&& when(who=units.filter("Tomas"), plan=wander(until=isNear(me, Mira)))',
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
		await hive.enact(parsePlan(
			'when(who=units.filter("Guard"), plan=hold_line(at=WestGate, facing=Player))',
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
		assert.equal(hive.lastPlan, undefined);
		director.tick(0.05, 1);
		await waitFor(() => calls.some((c) => c.actorID === 'Mira' && c.verb === 'go_to'));
		assert.equal(hive.lastPlan, undefined);
		const n = calls.filter((c) => c.actorID === 'Mira' && c.verb === 'go_to').length;
		director.tick(0.05, 2);
		await sleep(20);
		assert.equal(calls.filter((c) => c.actorID === 'Mira' && c.verb === 'go_to').length, n);
		await hive.enact(parsePlan(
			'when(who=units.filter("Mira"), plan=go_to(Home))',
			hive.verbs,
		));
		await waitFor(() => calls.some((c) => c.actorID === 'Mira' && String(c.args.name) === 'Home'));
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
				identity: { name: 'Red', role: 'Commands red.' },
				units: [{ id: 'Able', tags: ['Guard'] }],
			})
			.addCrowdConductor({
				id: 'Blue',
				skipHeartbeat: true,
				kit: CROWD_KIT,
				identity: { name: 'Blue', role: 'Commands blue.' },
				units: [{ id: 'Baker', tags: ['Guard'] }],
			})
			.start();
		const red = director.agent('Red');
		const blue = director.agent('Blue');
		assert.ok(isCrowdConductor(red) && isCrowdConductor(blue));
		assert.equal(red.crowd.get('Able')?.tags.includes(squadTag('Red', 'Guard')), true);
		assert.equal(blue.crowd.get('Baker')?.tags.includes(squadTag('Blue', 'Guard')), true);
		await red.enact(parsePlan('when(who=units.filter("Guard"), plan=go_to(Keep))', red.verbs));
		await waitFor(() => calls.some((c) => c.actorID === 'Able'));
		assert.equal(calls.some((c) => c.actorID === 'Baker'), false);
		await red.enact(parsePlan('tag(who=units.filter("Able"), name=Flank)', red.verbs));
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
				identity: { name: 'Captain', role: 'Leads.' },
				units: [{ id: 'Mira', tags: ['Guard'] }],
			})
			.start();
		const captain = director.agent('Captain');
		assert.ok(isCrowdConductor(captain));
		await captain.enact(parsePlan(
			'when(who=units.filter("Mira"), plan=go_to(Keep)) && go_to(WestGate)',
			captain.verbs,
		));
		await waitFor(() => (
			calls.some((c) => c.actorID === 'Mira' && c.verb === 'go_to')
			&& calls.some((c) => c.actorID === 'Captain' && String(c.args.name) === 'WestGate')
		));
		director.dispose();
	});

	it('pinnedSightFocus stays; extras replace; sightLimit slices clauses', () => {
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
			identity: { name: 'Hive', role: 'Sees.' },
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
		(conductor as unknown as { applySightFocus:(raw:unknown)=>void })
			.applySightFocus({ sightFocus: ['isHurt(it)', 'isNear(it, EastGate)'] });
		assert.deepEqual(conductor.pinnedSightFocus, ['isHurt(it)']);
		assert.deepEqual(conductor.sightFocus, ['isNear(it, EastGate)']);
	});

	it('hive merge keeps disjoint stalls and fromName leftovers', () => {
		const west = formatSightClauses({
			self: { id: 'Mira', at: [0, 0] },
			ambient: 'A square.',
			objects: [
				{ id: 'WestStall', at: [2, 0], tags: ['landmark', 'stall'], interactable: true, movable: false },
				{ id: 'Door', at: [8, 0], tags: ['door'], interactable: true, movable: false },
			],
		}, { fromName: 'Mira' });
		const east = formatSightClauses({
			self: { id: 'Tomas', at: [40, 0] },
			ambient: 'A square.',
			objects: [
				{ id: 'EastStall', at: [42, 0], tags: ['landmark', 'stall'], interactable: true, movable: false },
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
		await hive.enact(parsePlan(
			'when(who=units.filter("Mira"), plan=go_to(WestGate)) '
			+ '&& when(who=units.filter("Tomas"), plan=go_to(EastGate))',
			hive.verbs,
		));
		await waitFor(() => (
			calls.some((c) => c.actorID === 'Mira' && c.verb === 'go_to')
			&& calls.some((c) => c.actorID === 'Tomas' && c.verb === 'go_to')
		));
		for (const call of calls.filter((c) => c.verb === 'go_to')) {
			if (call.actorID === 'Mira') {
				assert.equal(String(call.args.name), 'WestGate');
			}
			if (call.actorID === 'Tomas') {
				assert.equal(String(call.args.name), 'EastGate');
			}
		}
		director.dispose();
	});

	it('when(who) does not drop laws', async () => {
		const director = await hiveOf();
		const hive = director.agent('Hive');
		assert.ok(isCrowdConductor(hive));
		assert.ok(hive.laws.some((l) => l.name === 'flee'));
		await hive.enact(parsePlan(
			'when(who=units.filter("Mira"), plan=say("hold"))',
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
				identity: { name: 'Hive', role: 'Sees.' },
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
		await hive.enact(parsePlan(
			'when(who=units.filter("Mira"), plan=go_to(Keep) && hold_line(at=WestGate, facing=Player))',
			hive.verbs,
		));
		await waitFor(() => calls.some((c) => c.verb === 'go_to' && c.actorID === 'Mira'));
		assert.equal(calls.some((c) => c.verb === 'hold_line'), false);
		director.dispose();
	});
});
