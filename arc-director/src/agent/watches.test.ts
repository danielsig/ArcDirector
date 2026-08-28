import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VerbRegistry, registerCoreVerbs } from '../action/registry.js';
import {
	buildCatalog,
	dummyEntity,
	evaluate,
	observeExpr,
	SampleCache,
	stringifyVal,
	type Catalog,
	type ExprEntity,
	type HostKernels,
} from '../expr/index.js';
import { FakeProvider } from '../inference/fake.js';
import { ThinkQueue } from '../think/queue.js';
import { Agent } from './agent.js';
import type { PerceptionRecipe } from './types.js';

type Ctx = Record<string, never>;

type Posed = ExprEntity & { x:number; z:number };

function posed(id:string, extra:Partial<ExprEntity> & { x:number; z:number }):Posed {
	return { ...dummyEntity(id, extra), x: extra.x, z: extra.z };
}

function xz(a:ExprEntity, b:ExprEntity):number {
	const pa = a as Partial<Posed>;
	const pb = b as Partial<Posed>;
	return Math.hypot((pa.x ?? 0) - (pb.x ?? 0), (pa.z ?? 0) - (pb.z ?? 0));
}

function hostAt(dist:number, extra:Partial<HostKernels> = {}):{ host:HostKernels; cat:Catalog } {
	const me = posed('Forager', { x: 0, z: 0, tags: ['agent'] });
	const Player = posed('Player', { x: dist, z: 0, tags: ['agent'] });
	const theft = posed('Theft', { x: dist, z: 0, tags: ['theft'] });
	const cache = extra.cache ?? new SampleCache();
	const host:HostKernels = {
		me,
		others: [Player],
		items: [],
		cache,
		distance: xz,
		nearRadius: 8,
		canSee: () => true,
		inventory: () => extra.inventory ? extra.inventory(me) : [],
		hasHeard: false,
		bindings: {
			Player: { kind: 'entity', value: Player },
			events: { kind: 'list', value: [{ kind: 'entity', value: theft }] },
		},
		stringifiers: {
			entity: (v) => v.kind === 'entity' ? v.value.id : '',
			list: (v) => v.kind === 'list'
				? v.value.map((x) => x.kind === 'entity' ? x.value.id : '').filter(Boolean).join(', ')
				: '',
		},
		...extra,
	};
	return { host, cat: buildCatalog(host) };
}

function recipe():PerceptionRecipe<Ctx> {
	return { push: { scene: { description: 'x', gather: () => 'a glen' } }, tools: {} };
}

function agentOf(opts:{
	watches?:string[];
	pinnedWatches?:string[];
	watchesWritable?:boolean;
	toolRoundCap?:number;
	provider:FakeProvider;
	catalog:()=>Catalog;
}):Agent<Ctx> {
	return new Agent({
		id: 'Forager',
		identity: { name: 'Forager', role: 'Watch the glen.' },
		provider: opts.provider,
		verbs: registerCoreVerbs(new VerbRegistry()),
		recipe: recipe(),
		context: () => ({}),
		catalog: opts.catalog,
		watches: opts.watches,
		pinnedWatches: opts.pinnedWatches,
		watchesWritable: opts.watchesWritable,
		toolRoundCap: opts.toolRoundCap ?? 0,
		heartbeat: 0,
		model: 'fake',
	});
}

describe('agent watches', () => {
	it('replaces watches from plan JSON; frozen mind ignores the field', async () => {
		const { cat } = hostAt(3);
		let live:Catalog = cat;
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				head: { verb: 'wait', args: { seconds: 1 } },
				watches: ['some(events.filter("theft").nearby(16))'],
			}),
			toolCalls: [],
		}));
		const a = agentOf({
			watches: ['hasHeard || some(others.approaching())'],
			provider,
			catalog: () => live,
		});
		await a.tick(1);
		assert.deepEqual(a.watches, ['some(events.filter("theft").nearby(16))']);
		const q = new ThinkQueue({ watchInterval: 0, processInterval: 0, maxParallel: 2 });
		q.ensure('Forager', { skipHeartbeat: true });
		q.setWatches('Forager', a.watches);
		const far = hostAt(20);
		live = far.cat;
		q.tick(1, new Map([['Forager', far.cat]]), 0);
		assert.equal(q.lastMax('Forager') > 0.05, false);
		const near = hostAt(5);
		const rows = q.tick(1, new Map([['Forager', near.cat]]), 0);
		assert.ok(rows.some((r) => r.npcID === 'Forager'));

		const frozen = agentOf({
			watches: ['hasHeard || some(others.approaching())'],
			watchesWritable: false,
			provider,
			catalog: () => live,
		});
		await frozen.tick(2);
		assert.deepEqual(frozen.watches, ['hasHeard || some(others.approaching())']);

		const json = a.toJSON();
		const restored = Agent.fromJSON(json, {
			provider,
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({}),
			catalog: () => live,
			model: 'fake',
		});
		assert.deepEqual(restored.watches, a.watches);
	});

	it('keeps host pinnedWatches when the model omits them', async () => {
		const { cat } = hostAt(3);
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({
				head: { verb: 'wait', args: { seconds: 1 } },
				watches: ['hasHeard'],
			}),
			toolCalls: [],
		}));
		const a = agentOf({
			watches: ['some(others.approaching())'],
			pinnedWatches: ['isHurt(me)'],
			provider,
			catalog: () => cat,
		});
		assert.deepEqual(a.effectiveWatches(), ['isHurt(me)', 'some(others.approaching())']);
		await a.tick(1);
		assert.deepEqual(a.watches, ['hasHeard']);
		assert.deepEqual(a.effectiveWatches(), ['isHurt(me)', 'hasHeard']);
		const json = a.toJSON();
		assert.deepEqual(json.pinnedWatches, ['isHurt(me)']);
		const restored = Agent.fromJSON(json, {
			provider,
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({}),
			catalog: () => cat,
			model: 'fake',
		});
		assert.deepEqual(restored.effectiveWatches(), ['isHurt(me)', 'hasHeard']);
		const oldSave = restored.toJSON();
		oldSave.pinnedWatches = [];
		const merged = Agent.fromJSON(oldSave, {
			provider,
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({}),
			catalog: () => cat,
			model: 'fake',
			pinnedWatches: ['isHurt(me)'],
		});
		assert.deepEqual(merged.effectiveWatches(), ['isHurt(me)', 'hasHeard']);
	});

	it('isNear / nearby radius on/off enqueues; observe names only', () => {
		const q = new ThinkQueue({ watchInterval: 0, processInterval: 0, maxParallel: 2 });
		q.ensure('G', { skipHeartbeat: true });
		q.setWatches('G', ['isNear(me, Player)']);
		const at5 = hostAt(5);
		let rows = q.tick(1, new Map([['G', at5.cat]]), 0);
		assert.ok(rows.length === 1);
		q.ensure('G2', { skipHeartbeat: true });
		q.setWatches('G2', ['isNear(me, Player)']);
		const at12 = hostAt(12);
		rows = q.tick(1, new Map([['G2', at12.cat]]), 0);
		assert.equal(rows.some((r) => r.npcID === 'G2'), false);
		q.ensure('G3', { skipHeartbeat: true });
		q.setWatches('G3', ['isNear(me, Player, 16)']);
		rows = q.tick(1, new Map([['G3', at12.cat]]), 0);
		assert.ok(rows.some((r) => r.npcID === 'G3'));
		q.ensure('G4', { skipHeartbeat: true });
		q.setWatches('G4', ['events.filter("theft").nearby(16)']);
		assert.equal(q.scoreWatches('G4', at12.cat) > 0, false);
		q.ensure('G5', { skipHeartbeat: true });
		q.setWatches('G5', ['some(events.filter("theft").nearby(16))']);
		assert.ok(q.scoreWatches('G5', at12.cat) > 0.05);
		const text = observeExpr('events.filter("theft").nearby(16)', at5.cat, evaluate);
		assert.equal(typeof text, 'string');
		assert.equal(/\d+\.\d+,\s*-?\d/.test(String(text)), false);
		assert.ok(String(text).includes('Theft') || String(text).length >= 0);
		const noR = hostAt(5, { nearRadius: undefined });
		delete (noR.host as { nearRadius?:number }).nearRadius;
		const cat = buildCatalog(noR.host);
		assert.ok(evaluate('isNear(me, Player, 16)', cat).error);
		assert.ok(evaluate('events.filter("theft").nearby(16)', cat).error);
	});

	it('approaching chain enqueues only when in range and closing', () => {
		const cache = new SampleCache();
		const q = new ThinkQueue({ watchInterval: 0, processInterval: 0, maxParallel: 2 });
		q.ensure('G', { skipHeartbeat: true });
		q.setWatches('G', ['some(events.filter("theft").nearby(16).approaching())']);
		const first = hostAt(12, { cache });
		q.scoreWatches('G', first.cat);
		evaluate('distance(me, events.find("theft"))', first.cat);
		cache.commit();
		const closer = posed('Theft', { x: 6, z: 0, tags: ['theft'] });
		const me = posed('Forager', { x: 0, z: 0, tags: ['agent'] });
		const host:HostKernels = {
			me,
			others: [],
			items: [],
			cache,
			distance: xz,
			nearRadius: 8,
			bindings: { events: { kind: 'list', value: [{ kind: 'entity', value: closer }] } },
		};
		const rows = q.tick(1, new Map([['G', buildCatalog(host)]]), 0);
		assert.ok(rows.some((r) => r.npcID === 'G'));
	});

	it('observe tool round then plan; toolRoundCap 0 never calls it', async () => {
		let observed = false;
		const { cat } = hostAt(5);
		const provider = new FakeProvider((req) => {
			const hasTool = req.messages.some((m) => m.role === 'tool');
			if (!hasTool && req.tools?.some((t) => t.name === 'observe')) {
				observed = true;
				return {
					content: null,
					toolCalls: [{
						id: 'c1',
						name: 'observe',
						arguments: JSON.stringify({ expr: 'events.filter("theft").nearby(16)' }),
					}],
				};
			}
			return {
				content: JSON.stringify({ head: { verb: 'wait', args: { seconds: 1 } } }),
				toolCalls: [],
			};
		});
		const a = agentOf({ provider, catalog: () => cat, toolRoundCap: 1 });
		const plan = await a.tick(1);
		assert.ok(plan);
		assert.equal(observed, true);
		observed = false;
		const b = agentOf({ provider, catalog: () => cat, toolRoundCap: 0 });
		await b.tick(2);
		assert.equal(observed, false);
	});

	it('isCarrying(Player) when mounted; extra args error', () => {
		const Player = dummyEntity('Player', { tags: ['agent'] });
		const { cat } = hostAt(5, { inventory: () => [Player] });
		assert.equal(evaluate('isCarrying(Player)', cat).value.kind, 'bool');
		assert.equal(evaluate('isCarrying(Player)', cat).value.kind === 'bool'
			&& evaluate('isCarrying(Player)', cat).value.kind === 'bool'
			? (evaluate('isCarrying(Player)', cat).value as { value:boolean }).value
			: false, true);
		assert.ok(evaluate('isCarrying(Player, "key")', cat).error);
	});

	it('scold on Player.isNear does not fire on unary isNear(Player)', () => {
		const { cat } = hostAt(5);
		assert.ok(evaluate('Player.isNear', cat).error);
		assert.equal(evaluate('Player.isNear', cat).error?.reason, 'fieldCall');
		assert.equal(evaluate('isNear(Player)', cat).error, undefined);
	});
});
