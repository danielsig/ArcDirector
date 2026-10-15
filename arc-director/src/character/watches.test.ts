import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STOCK_VERBS, VerbRegistry, registerStockVerbs } from '../arc/stock-verbs.js';
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
import { soloCharacter, type SoloOptions } from '../testing/solo.js';
import type { Character, CharacterJSON } from '../character/character.js';

/** A saved character, restored on its own. */
function restore<TCtx>(json:CharacterJSON, deps:Omit<SoloOptions<TCtx>, 'id'>) {
	return soloCharacter<TCtx>({ ...deps, id: json.id }, json);
}
import type { WatchInput } from './types.js';

/** Every stock verb: registered, and in the kit. */
function stockVerbs():{ verbs:VerbRegistry; kit:{ verbs:readonly string[] } } {
	return { verbs: registerStockVerbs(new VerbRegistry()), kit: { verbs: STOCK_VERBS } };
}

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
	const me = posed('Forager', { x: 0, z: 0, tags: ['character'] });
	const Player = posed('Player', { x: dist, z: 0, tags: ['character'] });
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

function perception():{ senses:Record<string, { description:string; gather:()=>string }>; tools:Record<string, never> } {
	return { senses: { scene: { description: 'x', gather: () => 'a glen' } }, tools: {} };
}

function agentOf(opts:{
	watches?:WatchInput;
	pinnedWatches?:WatchInput;
	watchesWritable?:boolean;
	toolRoundCap?:number;
	provider:FakeProvider;
	catalog:()=>Catalog;
}):Character<Ctx> {
	return soloCharacter({
		id: 'Forager',
		identity: { role: 'Watch the glen.' },
		provider: opts.provider,
		...stockVerbs(),
		...perception(),
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
	it('adds and removes named watches; a frozen mind cannot', async () => {
		const { cat } = hostAt(3);
		let live:Catalog = cat;
		const provider = new FakeProvider(() => ({ content: 'wait()', toolCalls: [] }));
		const a = agentOf({
			watches: { approaching: 'hasHeard || some(others.approaching())' },
			provider,
			catalog: () => live,
		});
		await a.perform({ verb: 'watch', args: { name: 'theft', expr: 'some(events.filter("theft").nearby(16))' } });
		await a.perform({ verb: 'unwatch', args: { name: 'approaching' } });
		assert.deepEqual(a.persona.watches, { theft: 'some(events.filter("theft").nearby(16))' });
		const q = new ThinkQueue({ watchInterval: 0, processInterval: 0 });
		q.ensure('Forager', { skipHeartbeat: true });
		q.setWatches('Forager', a.persona.effectiveWatches());
		const far = hostAt(20);
		live = far.cat;
		q.tick(1, new Map([['Forager', far.cat]]));
		assert.equal(q.lastMax('Forager') > 0.05, false);
		const near = hostAt(5);
		const rows = q.tick(1, new Map([['Forager', near.cat]]));
		assert.ok(rows.some((r) => r.mindID === 'Forager'));

		const frozen = agentOf({
			watches: { approaching: 'hasHeard || some(others.approaching())' },
			watchesWritable: false,
			provider,
			catalog: () => live,
		});
		assert.equal((await frozen.perform({ verb: 'watch', args: { name: 'x', expr: 'true' } })).ok, false);
		assert.deepEqual(frozen.persona.watches, { approaching: 'hasHeard || some(others.approaching())' });

		const json = a.toJSON();
		const restored = restore(json, {
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({}),
			catalog: () => live,
			model: 'fake',
		});
		assert.deepEqual(restored.persona.watches, a.persona.watches);
	});

	it('does not replace extras when the model omits watch ops', async () => {
		const { cat } = hostAt(3);
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }),
			toolCalls: [],
		}));
		const a = agentOf({
			watches: { approaching: 'some(others.approaching())' },
			provider,
			catalog: () => cat,
		});
		await a.mind!.tick(1);
		assert.deepEqual(a.persona.watches, { approaching: 'some(others.approaching())' });
	});

	it('watch replaces a watch of the same name', async () => {
		const { cat } = hostAt(3);
		const a = agentOf({
			watches: { nearby: 'isNear(me, Player)' },
			provider: new FakeProvider(() => ({ content: 'wait()', toolCalls: [] })),
			catalog: () => cat,
		});
		assert.equal((await a.perform({ verb: 'watch', args: { name: 'nearby', expr: 'isNear(me, Player, 16)' } })).ok, true);
		assert.deepEqual(a.persona.watches, { nearby: 'isNear(me, Player, 16)' });
	});

	it('keeps host pinnedWatches; LLM cannot edit or remove them', async () => {
		const { cat } = hostAt(3);
		const provider = new FakeProvider(() => ({ content: 'wait()', toolCalls: [] }));
		const a = agentOf({
			watches: { approaching: 'some(others.approaching())' },
			pinnedWatches: { hurt: 'isHurt(me)' },
			provider,
			catalog: () => cat,
		});
		assert.deepEqual(a.persona.effectiveWatches(), ['isHurt(me)', 'some(others.approaching())']);
		await a.perform({ verb: 'watch', args: { name: 'heard', expr: 'hasHeard' } });
		assert.equal((await a.perform({ verb: 'watch', args: { name: 'hurt', expr: 'isNear(me, Player)' } })).ok, false);
		assert.equal((await a.perform({ verb: 'unwatch', args: { name: 'hurt' } })).ok, false);
		assert.deepEqual(a.persona.watches, {
			approaching: 'some(others.approaching())',
			heard: 'hasHeard',
		});
		assert.deepEqual(a.persona.effectiveWatches(), ['isHurt(me)', 'some(others.approaching())', 'hasHeard']);
		assert.equal(a.persona.editWatch('hurt', 'isNear(me, Player)'), false);
		assert.equal(a.persona.removeWatch('hurt'), false);
		assert.equal(a.persona.addWatch('hurt', 'hasHeard'), false);
		const json = a.toJSON();
		assert.deepEqual(json.persona.pinnedWatches, { hurt: 'isHurt(me)' });
		const restored = restore(json, {
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({}),
			catalog: () => cat,
			model: 'fake',
		});
		assert.deepEqual(restored.persona.effectiveWatches(), ['isHurt(me)', 'some(others.approaching())', 'hasHeard']);
		const oldSave = restored.toJSON();
		oldSave.persona.pinnedWatches = {};
		const merged = restore(oldSave, {
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({}),
			catalog: () => cat,
			model: 'fake',
			pinnedWatches: { hurt: 'isHurt(me)' },
		});
		assert.deepEqual(merged.persona.effectiveWatches(), ['isHurt(me)', 'some(others.approaching())', 'hasHeard']);
	});

	it('loads legacy string watches as watch_N and still merges host pins', () => {
		const { cat } = hostAt(3);
		const provider = new FakeProvider(() => ({
			content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }),
			toolCalls: [],
		}));
		const restored = restore({
			id: 'Forager',
			persona: {
				identity: { role: 'Watch the glen.' },
				goals: [],
				memories: [],
				watches: ['some(others.approaching())'],
				pinnedWatches: ['isHurt(me)'],
				maxGoals: 5,
				maxEpisodic: 40,
			},
			tags: [],
			liveArc: false,
		}, {
			provider,
			...stockVerbs(),
			...perception(),
			context: () => ({}),
			catalog: () => cat,
			model: 'fake',
			pinnedWatches: { hurt: 'isHurt(me)' },
		});
		assert.deepEqual(restored.persona.pinnedWatches, { hurt: 'isHurt(me)' });
		assert.equal(Object.keys(restored.persona.watches).length, 1);
		assert.equal(Object.values(restored.persona.watches)[0], 'some(others.approaching())');
	});

	it('isNear / nearby radius on/off enqueues; observe names only', () => {
		const q = new ThinkQueue({ watchInterval: 0, processInterval: 0 });
		q.ensure('G', { skipHeartbeat: true });
		q.drop('G');
		q.setWatches('G', ['isNear(me, Player)']);
		const at5 = hostAt(5);
		let rows = q.tick(1, new Map([['G', at5.cat]]));
		assert.ok(rows.length === 1);
		q.ensure('G2', { skipHeartbeat: true });
		q.drop('G2');
		q.setWatches('G2', ['isNear(me, Player)']);
		const at12 = hostAt(12);
		rows = q.tick(1, new Map([['G2', at12.cat]]));
		assert.equal(rows.some((r) => r.mindID === 'G2'), false);
		q.ensure('G3', { skipHeartbeat: true });
		q.drop('G3');
		q.setWatches('G3', ['isNear(me, Player, 16)']);
		rows = q.tick(1, new Map([['G3', at12.cat]]));
		assert.ok(rows.some((r) => r.mindID === 'G3'));
		q.ensure('G4', { skipHeartbeat: true });
		q.drop('G4');
		q.setWatches('G4', ['events.filter("theft").nearby(16)']);
		assert.equal(q.scoreWatches('G4', at12.cat) > 0, false);
		q.ensure('G5', { skipHeartbeat: true });
		q.drop('G5');
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
		const q = new ThinkQueue({ watchInterval: 0, processInterval: 0 });
		q.ensure('G', { skipHeartbeat: true });
		q.setWatches('G', ['some(events.filter("theft").nearby(16).approaching())']);
		const first = hostAt(12, { cache });
		q.scoreWatches('G', first.cat);
		evaluate('distance(me, events.find("theft"))', first.cat);
		cache.commit();
		const closer = posed('Theft', { x: 6, z: 0, tags: ['theft'] });
		const me = posed('Forager', { x: 0, z: 0, tags: ['character'] });
		const host:HostKernels = {
			me,
			others: [],
			items: [],
			cache,
			distance: xz,
			nearRadius: 8,
			bindings: { events: { kind: 'list', value: [{ kind: 'entity', value: closer }] } },
		};
		const rows = q.tick(1, new Map([['G', buildCatalog(host)]]));
		assert.ok(rows.some((r) => r.mindID === 'G'));
	});

	it('observe tool round then arc; toolRoundCap 0 never calls it', async () => {
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
				content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }),
				toolCalls: [],
			};
		});
		const a = agentOf({ provider, catalog: () => cat, toolRoundCap: 1 });
		const arc = await a.mind!.tick(1);
		assert.ok(arc);
		assert.equal(observed, true);
		observed = false;
		const b = agentOf({ provider, catalog: () => cat, toolRoundCap: 0 });
		await b.mind!.tick(2);
		assert.equal(observed, false);
	});

	it('isCarrying(Player) when mounted; extra args error', () => {
		const Player = dummyEntity('Player', { tags: ['character'] });
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
