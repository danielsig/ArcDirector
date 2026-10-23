import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArc } from '../arc/wire.js';
import type { ArcResult, CountMap } from '../arc/types.js';
import { ArcDirector } from '../director/director.js';
import { dummyEntity } from '../expr/natives.js';
import { evaluate } from '../expr/eval.js';
import { buildCatalog } from '../expr/natives.js';
import { SampleCache } from '../expr/types.js';
import type { HostWorld, Vec } from '../world/types.js';
import { distance } from '../world/vec.js';
import { RTS_COMMANDER_VERBS } from './rts.js';
import { STOCK_CITY_VERBS } from './verbs.js';
import type { KindSpec, RTSHost } from './types.js';

type Ctx = { id:string };

function flush():Promise<void> {
	return new Promise((resolve) => {
		setImmediate(resolve);
	});
}

const KINDS:Record<string, KindSpec> = {
	TownCenter: { cost: { Wood: 200 }, seconds: 10, provides: 5, tags: ['Building', 'DropOff:Gold', 'DropOff:Wood'], holds: { capacity: 3 } },
	House: { cost: { Wood: 30 }, seconds: 2, provides: 5, tags: ['Building'] },
	Barracks: { cost: { Wood: 60 }, seconds: 3, tags: ['Building'], slots: 2 },
	Granary: { tags: ['Building'] },
	Palisade: { cost: { Wood: 5 }, seconds: 1, tags: ['Building', 'Wall'] },
	Gatehouse: { cost: { Wood: 20 }, seconds: 1, tags: ['Building', 'Gate'] },
	Worker: { cost: { Gold: 50 }, seconds: 1, supply: 1, madeAt: ['TownCenter'], tags: ['Worker'], range: 1 },
	Spearman: { cost: { Gold: 40, Wood: 10 }, seconds: 1, supply: 1, madeAt: ['Barracks'], requires: ['Barracks'], range: 1.2 },
	Knight: { cost: { Gold: 100 }, seconds: 2, supply: 2, madeAt: ['Stable'] },
	Stable: { cost: { Wood: 100 }, tags: ['Building'] },
	Forging: { cost: { Gold: 20 }, seconds: 1, madeAt: ['Barracks'], tags: ['Tech'] },
	GoldMine: { tags: ['Node:Gold'] },
	Raider: { range: 1.2 },
};

/**
 * A tiny RTS on a grid: sides Red and Blue, a stock each, nodes that empty, sites that rise, and units that move four
 * cells a second. Each primitive acts once, as `RTSHost` asks.
 */
class Game {
	public readonly point = new Map<string, Vec>();
	public readonly what = new Map<string, { kind:string; owner?:string }>();
	public readonly stock:Record<string, CountMap> = { Red: { Gold: 500, Wood: 500 }, Blue: { Gold: 0 } };
	public readonly hp = new Map<string, number>();
	public readonly gold = new Map<string, number>();
	public readonly carry = new Map<string, number>();
	public readonly progress = new Map<string, number>();
	public readonly inside = new Set<string>();
	/** Goods a building holds, and what a hauler carries. */
	public readonly stored = new Map<string, Record<string, number>>();
	public readonly hauling = new Map<string, [string, number]>();
	public readonly techs:string[] = [];
	private readonly steering = new Map<string, Vec | null>();
	private spawned = 0;
	public director!:ArcDirector<Ctx>;

	public add(id:string, kind:string, point:Vec, owner?:string):this {
		this.point.set(id, point);
		this.what.set(id, { kind, owner });
		this.hp.set(id, 3);
		return this;
	}

	public step(dt:number):void {
		for (const [id, to] of this.steering) {
			const point = this.point.get(id);
			if (!to || !point || this.inside.has(id)) {
				continue;
			}
			const gap = distance(point, to);
			const move = Math.min(gap, 4 * dt);
			this.point.set(id, gap > 1e-9 ? point.map((v, i) => v + ((to[i] - v) / gap) * move) : to);
		}
	}

	public readonly world:HostWorld<string> = {
		find: (id) => (this.point.has(id) ? id : undefined),
		getPose: (id) => {
			const point = this.point.get(id);
			return point ? { point, facing: [0, 1], right: [1, 0] } : undefined;
		},
		getNeighbors: (point) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [Math.round(point[0]) + dx, Math.round(point[1]) + dz]),
		canPass: () => ({}),
		steerToward: (character, to) => {
			this.steering.set(character, to);
			const point = this.point.get(character);
			return !!(to && point && distance(point, to) < 0.05);
		},
		getReach: () => 1.2,
	};

	public readonly host:RTSHost = {
		kinds: KINDS,
		describe: (id) => this.what.get(id),
		known: () => [...this.what.keys()],
		getStock: (side) => ({ ...this.stock[side] }),
		addStock: (side, bundle) => {
			const stock = this.stock[side] ??= {};
			for (const [k, v] of Object.entries(bundle)) {
				stock[k] = (stock[k] ?? 0) + v;
			}
		},
		placeSite: (kind, near, builder, exact) => {
			const at = exact ?? this.point.get(near ?? builder);
			if (!at) {
				return { reason: `no room near ${near}` };
			}
			const id = `${kind}Site${++this.spawned}`;
			this.add(id, kind, exact ? [...exact] : [at[0] + 2, at[1]], this.what.get(builder)?.owner);
			return id;
		},
		removeSite: (site) => {
			this.point.delete(site);
			this.what.delete(site);
		},
		work: (unit, target, seconds) => {
			const kind = this.what.get(target)?.kind;
			if (kind === 'GoldMine') {
				const left = this.gold.get(target) ?? 0;
				if (left <= 0) {
					return { stop: `${target} is empty` };
				}
				const took = Math.min(left, 2);
				this.gold.set(target, left - took);
				this.carry.set(unit, (this.carry.get(unit) ?? 0) + took);
				return { full: (this.carry.get(unit) ?? 0) >= 10 };
			}
			const done = (this.progress.get(target) ?? 0) + seconds;
			this.progress.set(target, done);
			return { done: done >= (KINDS[kind ?? '']?.seconds ?? 1) };
		},
		deposit: (unit, at) => {
			const load = this.hauling.get(unit);
			if (load) {
				const store = this.stored.get(at) ?? {};
				store[load[0]] = (store[load[0]] ?? 0) + load[1];
				this.stored.set(at, store);
				this.hauling.delete(unit);
				return { [load[0]]: load[1] };
			}
			const gold = this.carry.get(unit) ?? 0;
			this.carry.delete(unit);
			this.host.addStock(this.what.get(at)!.owner!, { Gold: gold });
			return { Gold: gold };
		},
		withdraw: (unit, from, good) => {
			const store = this.stored.get(from) ?? {};
			const took = Math.min(store[good] ?? 0, 3);
			store[good] = (store[good] ?? 0) - took;
			if (took > 0) {
				this.hauling.set(unit, [good, took]);
			}
			return took;
		},
		holding: (building, good) => this.stored.get(building)?.[good] ?? 0,
		spawn: (building, kind) => {
			const id = `${kind}${++this.spawned}`;
			const at = this.point.get(building)!;
			this.add(id, kind, [at[0], at[1] + 1], this.what.get(building)?.owner);
			return id;
		},
		applyTech: (_side, tech) => {
			this.techs.push(tech);
		},
		attack: (unit, target) => {
			const reach = KINDS[this.what.get(unit)?.kind ?? '']?.range ?? 1;
			const a = this.point.get(unit);
			const b = this.point.get(target);
			if (!a || !b || distance(a, b) > reach + 0.3) {
				return false;
			}
			const hp = (this.hp.get(target) ?? 0) - 1;
			this.hp.set(target, hp);
			if (hp <= 0) {
				this.point.delete(target);
				this.what.delete(target);
			}
			return true;
		},
		enter: (unit) => {
			this.inside.add(unit);
		},
		exit: (unit) => {
			this.inside.delete(unit);
		},
		areAllies: (a, b) => [a, b].sort().join() === 'Gold,Red',
		maxSupply: 50,
	};
}

const COMMAND = { verbs: [...RTS_COMMANDER_VERBS, ...STOCK_CITY_VERBS] };

/** Red: a commander, a town center, two workers, a barracks; a gold mine east. */
async function start(game = new Game(), more:(g:Game)=>void = () => undefined, build:(d:ArcDirector<Ctx>)=>void = () => undefined):Promise<ArcDirector<Ctx>> {
	game.add('Chief', 'Commander', [0, 0], 'Red')
		.add('Hall', 'TownCenter', [0, 2], 'Red')
		.add('Brann', 'Worker', [1, 2], 'Red')
		.add('Cole', 'Worker', [-1, 2], 'Red')
		.add('Yard', 'Barracks', [4, 0], 'Red')
		.add('Mine', 'GoldMine', [8, 2]);
	game.gold.set('Mine', 100);
	more(game);
	const members = [...game.what].filter(([id, w]) => w.owner === 'Red' && id !== 'Chief');
	const director = new ArcDirector<Ctx>()
		.addFakeInference()
		.addStockVerbs()
		.addStockCollectiveVerbs()
		.withWorld(game.world)
		.withRTS(game.host)
		.withKernels((ctx) => ({
			me: dummyEntity(ctx.id, { tags: [game.what.get(ctx.id)?.kind ?? 'character'] }),
			others: [...game.what].filter(([id]) => id !== ctx.id && game.point.has(id)).map(([id, w]) => dummyEntity(id, { tags: [w.kind], fields: { foe: { kind: 'bool', value: !!w.owner && w.owner !== game.what.get(ctx.id)?.owner } } })),
			items: [],
		}))
		.withContext((id) => (game.point.has(id) ? { id } : undefined))
		.withSight({ look: (ctx) => ({ self: { id: ctx.id, point: game.point.get(ctx.id)! }, objects: [...game.point].filter(([id]) => id !== ctx.id).map(([id, point]) => ({ id, point, tags: [] })) }) })
		.addCollective({
			id: 'Red',
			commander: 'Chief',
			// A game that caps nothing has no supply_ahead.
			kit: { verbs: COMMAND.verbs.filter((v) => v !== 'supply_ahead' || Object.values(game.host.kinds).some((k) => (k.provides ?? 0) > 0)) },
			characters: [{ id: 'Chief' }, ...members.map(([id, w]) => ({ id, tags: [w.kind] }))],
		});
	for (const [id, w] of game.what) {
		if (w.owner && w.owner !== 'Red') {
			director.addCharacter({ id, tags: [w.kind], kit: { verbs: ['wait'] } });
		}
	}
	build(director);
	game.director = director;
	return director.start();
}

/** `seconds` of play, a tenth at a time. */
async function play(game:Game, director:ArcDirector<Ctx>, seconds:number, from = { t: 0 }):Promise<void> {
	for (let i = 0; i < seconds * 10; i++) {
		from.t += 0.1;
		game.step(0.1);
		director.tick(0.1, from.t);
		await flush();
	}
}

/** `arc` run by `id` as its own program, written as its mind would: a commander in its collective's verbs. */
function enact(director:ArcDirector<Ctx>, id:string, arc:string):Promise<ArcResult> {
	const runner = director.character(id)!;
	const writer = runner.collective?.commander === runner ? runner.collective : runner;
	return runner.enact(parseArc(arc, writer.activeVerbs()));
}

describe('stock RTS verbs', () => {
	it('gives each kind its verbs: workers gather, buildings train, fighters fight', async () => {
		const director = await start();
		assert.ok(director.character('Brann')!.activeVerbs().has('gather'));
		assert.equal(director.character('Brann')!.activeVerbs().has('train'), false);
		assert.ok(director.character('Hall')!.activeVerbs().has('train'));
		assert.ok(director.character('Hall')!.activeVerbs().has('unload'));
		assert.equal(director.character('Hall')!.activeVerbs().has('go_to'), false);
		director.dispose();
	});

	it('trains at the building that finishes soonest, pays, and new units join with their tags and verbs', async () => {
		const game = new Game();
		const director = await start(game, (g) => g.add('Hall2', 'TownCenter', [-6, 2], 'Red'));
		const result = await enact(director, 'Chief', 'train(what=Worker, count=3)');
		assert.equal(result.ok, true);
		assert.match(result.reason ?? '', /^Worker ×(2 at Hall, Worker ×1 at Hall2|1 at Hall2, Worker ×2 at Hall|2 at Hall2, Worker ×1 at Hall|1 at Hall, Worker ×2 at Hall2)$/);
		assert.equal(game.stock.Red.Gold, 350);
		await play(game, director, 3);
		const workers = director.collective('Red')!.characters.filter((c) => c.tags.includes('Worker'));
		assert.equal(workers.length, 5);
		assert.ok(workers.every((w) => w.activeVerbs().has('gather')));
		director.dispose();
	});

	it('says what is wrong: a building that cannot make it, nothing that makes it, too little to pay', async () => {
		const game = new Game();
		const director = await start(game);
		assert.match((await enact(director, 'Chief', 'train(what=Worker, at=Yard)')).reason ?? '', /Yard can't make Worker; it makes Spearman, Forging/);
		assert.match((await enact(director, 'Chief', 'train(what=Knight)')).reason ?? '', /nothing you own makes Knight; Stable does/);
		game.stock.Red.Gold = 10;
		assert.match((await enact(director, 'Chief', 'train(what=Worker)')).reason ?? '', /short 40 Gold/);
		director.dispose();
	});

	it('pauses at the supply cap and goes on once a house is built', async () => {
		const game = new Game();
		const director = await start(game);
		// The town center gives 5; two workers take 2.
		const result = await enact(director, 'Chief', 'train(what=Worker, count=5)');
		assert.match(result.reason ?? '', /waiting for supply/);
		await play(game, director, 8);
		assert.equal(director.collective('Red')!.characters.filter((c) => c.tags.includes('Worker')).length, 5);
		assert.match(director.collective('Red')!.status!(), /Supply: 5\/5 \(2 more queued\)/);
		assert.equal((await enact(director, 'Chief', 'build(what=House, near=Hall)')).ok, true);
		await play(game, director, 10);
		assert.equal(director.collective('Red')!.characters.filter((c) => c.tags.includes('Worker')).length, 7);
		director.dispose();
	});

	it('hands gathering out to idle workers, who carry gold back until the mine is empty', async () => {
		const game = new Game();
		const director = await start(game);
		const result = await enact(director, 'Chief', 'gather(from=Gold, workers=1)');
		assert.equal(result.ok, true);
		assert.equal(result.reason, undefined, 'a handed-out order is a bare ok');
		await play(game, director, 6);
		assert.ok(game.stock.Red.Gold > 500);
		assert.match(director.collective('Red')!.status!(), /Worker ×2 \(1 gathering Gold, 1 idle\)/);
		director.dispose();
	});

	it('builds: pays, lays out a site, builds it, and the builder goes back to what it was doing', async () => {
		const game = new Game();
		const director = await start(game);
		await enact(director, 'Chief', 'gather(from=Gold, by=Brann)');
		await play(game, director, 1);
		const result = await enact(director, 'Chief', 'build(what=House, near=Hall, by=Brann)');
		assert.equal(result.ok, true);
		assert.equal(game.stock.Red.Wood, 470);
		const site = director.collective('Red')!.characters.find((c) => c.tags.includes('House'))!;
		assert.ok(site.tags.includes('Unfinished'));
		await play(game, director, 6);
		assert.equal(site.tags.includes('Unfinished'), false);
		assert.equal(director.character('Brann')!.verb, 'gather');
		director.dispose();
	});

	it('takes a worker back to what it was at, not to what it already did', async () => {
		const game = new Game();
		const director = await start(game);
		await enact(director, 'Chief', 'issue(who=Brann, arc=build(what=House, near=Hall) ; gather(from=Gold))');
		await play(game, director, 8);
		assert.equal(director.character('Brann')!.verb, 'gather', 'built, now gathering');
		await enact(director, 'Chief', 'build(what=House, near=Yard, by=Brann)');
		await play(game, director, 8);
		const houses = director.collective('Red')!.characters.filter((c) => c.tags.includes('House'));
		assert.equal(houses.length, 2, 'the house it was told to build, and no third from its old program');
		assert.equal(director.character('Brann')!.verb, 'gather', 'back to gathering');
		director.dispose();
	});

	it('leaves a builder at its site unless named: other work goes to idle workers and gatherers', async () => {
		const game = new Game();
		const director = await start(game);
		await enact(director, 'Chief', 'build(what=House, near=Hall, by=Brann)');
		await play(game, director, 1);
		await enact(director, 'Chief', 'gather(from=Gold, workers=2)');
		await play(game, director, 1);
		assert.equal(director.character('Brann')!.verb, 'build', 'still building');
		assert.equal(director.character('Cole')!.verb, 'gather');
		await enact(director, 'Chief', 'gather(from=Gold, by=Brann)');
		assert.equal(director.character('Brann')!.verb, 'gather', 'named, it goes');
		director.dispose();
	});

	it('lays a wall cell by cell from one place to another, with a gate in it, and builds it all', async () => {
		const game = new Game();
		const director = await start(game, (g) => g.add('Ford', 'Place', [0, 8]));
		const red = director.collective('Red')!;
		assert.equal((await enact(director, 'Chief', 'wall(from=Hall, to=Ford, gates=1)')).ok, true);
		const pieces = red.characters.filter((c) => c.tags.includes('Palisade') || c.tags.includes('Gatehouse'));
		assert.equal(pieces.length, 7, 'every cell from the Hall to the Ford: y = 2 … 8');
		assert.equal(pieces.filter((c) => c.tags.includes('Gatehouse')).length, 1);
		assert.equal(game.stock.Red.Wood, 500 - 6 * 5 - 20);
		await play(game, director, 12);
		assert.equal(pieces.some((c) => c.tags.includes('Unfinished')), false);
		assert.match((await enact(director, 'Chief', 'wall(from=Hall, to=Ford, what=Barracks)')).reason ?? '', /Barracks is not a wall/);
		game.stock.Red.Wood = 10;
		assert.match((await enact(director, 'Chief', 'wall(from=Hall, to=Ford)')).reason ?? '', /short 25 Wood for a wall of 7/);
		director.dispose();
	});

	it('waits to train at a barracks still being built, and needs one to start', async () => {
		const game = new Game();
		const director = await start(game, (g) => g.what.delete('Yard'));
		assert.match((await enact(director, 'Chief', 'train(what=Spearman)')).reason ?? '', /nothing you own makes Spearman/);
		await enact(director, 'Chief', 'build(what=Barracks, near=Hall)');
		const queued = await enact(director, 'Chief', 'train(what=Spearman, count=2)');
		assert.equal(queued.ok, true);
		assert.match(queued.reason ?? '', /waiting/);
		await play(game, director, 8);
		assert.equal(director.collective('Red')!.characters.filter((c) => c.tags.includes('Spearman')).length, 2);
		director.dispose();
	});

	it('researches once, and refunds what is cancelled', async () => {
		const game = new Game();
		const director = await start(game);
		assert.equal((await enact(director, 'Chief', 'research(what=Forging)')).ok, true);
		assert.match((await enact(director, 'Chief', 'research(what=Forging)')).reason ?? '', /already queued at Yard/);
		await play(game, director, 2);
		assert.deepEqual(game.techs, ['Forging']);
		assert.match((await enact(director, 'Chief', 'research(what=Forging)')).reason ?? '', /already researched/);
		await enact(director, 'Chief', 'train(what=Worker, count=2)');
		const gold = game.stock.Red.Gold;
		assert.equal((await enact(director, 'Chief', 'cancel(what=Worker)')).ok, true);
		assert.equal(game.stock.Red.Gold, gold + 50);
		director.dispose();
	});

	it('attacks a list of foes in order, chasing each', async () => {
		const game = new Game();
		const director = await start(game, (g) => g.add('Reaver', 'Raider', [3, 4], 'Blue').add('Rook', 'Raider', [5, 5], 'Blue'));
		await enact(director, 'Chief', 'train(what=Spearman, at=Yard)');
		await play(game, director, 2);
		const spear = director.collective('Red')!.characters.find((c) => c.tags.includes('Spearman'))!;
		const result = await Promise.all([enact(director, spear.id, 'attack(target=others.filter("Raider"))'), play(game, director, 12)]);
		assert.equal(result[0].ok, true);
		assert.equal(game.point.has('Reaver') || game.point.has('Rook'), false);
		director.dispose();
	});

	it('garrisons until let out, and the unit\'s arc goes on after', async () => {
		const game = new Game();
		const director = await start(game);
		const brann = enact(director, 'Brann', 'garrison(in=Hall) && go_to(Mine)');
		await play(game, director, 2);
		assert.ok(game.inside.has('Brann'));
		assert.match(director.collective('Red')!.status!(), /1 inside Hall/);
		await enact(director, 'Hall', 'unload()');
		await play(game, director, 10);
		assert.equal((await brann).ok, true);
		assert.ok(distance(game.point.get('Brann')!, [8, 2]) < 1.5);
		director.dispose();
	});

	it('sends tribute to allies only', async () => {
		const game = new Game();
		const director = await start(game, (g) => g.add('Goldie', 'Commander', [9, 9], 'Gold').add('Bluey', 'Commander', [9, -9], 'Blue'));
		assert.match((await enact(director, 'Chief', 'tribute(to=Bluey, give={"Gold":10})')).reason ?? '', /not your ally/);
		assert.equal((await enact(director, 'Chief', 'tribute(to=Goldie, give={"Gold":100})')).ok, true);
		assert.equal(game.stock.Gold.Gold, 100);
		assert.match((await enact(director, 'Chief', 'tribute(to=Goldie, give={"Gold":1000})')).reason ?? '', /you have 400 Gold/);
		director.dispose();
	});

	it('refuses an ally\'s units in by and at', async () => {
		const game = new Game();
		const director = await start(game);
		assert.match((await enact(director, 'Chief', 'gather(from=Gold, by=Hall)')).reason ?? '', /not a worker: Hall/);
		director.dispose();
	});

	it('shows the commander its side at a glance, in place of every unit by name', async () => {
		const director = await start();
		const section = director.collective('Red')!.promptSection(director.collective('Red')!.mind);
		assert.match(section, /^Stock: 500 Gold, 500 Wood\nSupply: 2\/5\nUnits: TownCenter ×1; Worker ×2 \(2 idle\); Barracks ×1/);
		assert.equal(section.includes('- Brann'), false);
		director.dispose();
	});
});

describe('fighting and hauling verbs', () => {
	it('attack_move fights what it meets on the way and goes on to where it was sent', async () => {
		const game = new Game();
		const director = await start(game, (g) => g.add('Reaver', 'Raider', [5, 4], 'Blue').add('Ford', 'Place', [5, 9]));
		await enact(director, 'Chief', 'train(what=Spearman, at=Yard)');
		await play(game, director, 2);
		const spear = director.collective('Red')!.characters.find((c) => c.tags.includes('Spearman'))!;
		const [went] = await Promise.all([enact(director, spear.id, 'attack_move(to=Ford)'), play(game, director, 12)]);
		assert.equal(went.ok, true, went.reason);
		assert.equal(game.point.has('Reaver'), false);
		assert.ok(distance(game.point.get(spear.id)!, [5, 9]) < 2);
		director.dispose();
	});

	it('hold stays put, hits only what comes in range, and holds fire until it is close enough', async () => {
		const game = new Game();
		const director = await start(game, (g) => g.add('Reaver', 'Raider', [4, 2.1], 'Blue').add('Rook', 'Raider', [4, 6], 'Blue'));
		await enact(director, 'Chief', 'train(what=Spearman, at=Yard)');
		await play(game, director, 2);
		const spear = director.collective('Red')!.characters.find((c) => c.tags.includes('Spearman'))!;
		const spot = [...game.point.get(spear.id)!];
		void enact(director, spear.id, 'hold(fire_within=0.5)');
		await play(game, director, 4);
		assert.equal(game.hp.get('Reaver'), 3, 'held its fire: nothing came that close');
		assert.ok(distance(game.point.get(spear.id)!, spot) < 1.6, 'never chased');
		void enact(director, spear.id, 'hold()');
		await play(game, director, 6);
		assert.equal(game.point.has('Reaver'), false, 'in range, it fights');
		assert.equal(game.point.has('Rook'), true, 'out of range, it never chases');
		director.dispose();
	});

	it('patrols back and forth, fighting what it meets', async () => {
		const game = new Game();
		const director = await start(game, (g) => g.add('Hill', 'Place', [4, 8]).add('Rook', 'Raider', [4, 6], 'Blue'));
		await enact(director, 'Chief', 'train(what=Spearman, at=Yard)');
		await play(game, director, 2);
		const spear = director.collective('Red')!.characters.find((c) => c.tags.includes('Spearman'))!;
		void enact(director, spear.id, 'patrol(to=Hill)');
		await play(game, director, 15);
		assert.equal(game.point.has('Rook'), false);
		assert.match(director.collective('Red')!.status!(), /patrolling to Hill/);
		director.dispose();
	});

	it('staffs the free jobs of a building, and frees them', async () => {
		const game = new Game();
		const director = await start(game);
		assert.equal((await enact(director, 'Chief', 'staff(at=Yard)')).ok, true);
		await play(game, director, 2);
		assert.match(director.collective('Red')!.status!(), /Worker ×2 \(2 working at Yard\)/);
		assert.match((await enact(director, 'Chief', 'staff(at=Yard)')).reason ?? '', /no free jobs \(2\/2\)/);
		await enact(director, 'Chief', 'staff(at=Yard, workers=0)');
		await play(game, director, 1);
		assert.match(director.collective('Red')!.status!(), /Worker ×2 \(2 idle\)/);
		director.dispose();
	});

	it('hauls a good over and over until there is enough of it there', async () => {
		const game = new Game();
		const director = await start(game, (g) => g.add('Granary1', 'Granary', [-4, 2], 'Red'));
		game.stored.set('Hall', { Grain: 12 });
		const [hauled] = await Promise.all([enact(director, 'Brann', 'haul(what=Grain, from=Hall, to=Granary1, keep=6)'), play(game, director, 20)]);
		assert.equal(hauled.ok, true, hauled.reason);
		assert.ok((game.stored.get('Granary1')?.Grain ?? 0) >= 6);
		director.dispose();
	});
});

describe('stock verbs under a game\'s own names', () => {
	it('shows only its names, takes its arg names, and hands work out under them', async () => {
		const game = new Game();
		game.host.verbNames = { gather: { name: 'harvest', args: { from: 'source' } }, train: { name: 'recruit' } };
		const director = await start(game);
		const brann = director.character('Brann')!;
		assert.ok(brann.activeVerbs().has('harvest'));
		assert.equal(brann.activeVerbs().has('gather'), false);
		const named = RTS_COMMANDER_VERBS.map((v) => ({ gather: 'harvest', train: 'recruit' } as Record<string, string>)[v] ?? v);
		director.collective('Red')!.kit = { verbs: named };
		director.character('Chief')!.kit = { verbs: named };
		const verbs = director.collective('Red')!.activeVerbs();
		assert.deepEqual(Object.keys(verbs.get('harvest')!.args), ['source', 'by', 'workers', 'drop_at']);
		assert.equal((await enact(director, 'Chief', 'harvest(source=Gold, workers=1)')).ok, true);
		assert.equal((await enact(director, 'Chief', 'recruit(what=Worker)')).ok, true);
		await play(game, director, 3);
		assert.match(director.collective('Red')!.status!(), /1 gathering Gold/);
		assert.equal(director.collective('Red')!.characters.filter((c) => c.tags.includes('Worker')).length, 3);
		director.dispose();
	});
});

describe('stock tactics, as alias verbs', () => {
	it('keeps a unit away from what it is told to, then lets its program go on', async () => {
		const game = new Game();
		const director = await start(game, (g) => g.add('Brute', 'Raider', [3, 2], 'Blue'));
		const set = await enact(director, 'Chief', 'law(name=away, arc=keep_distance(from=others.filter("Raider"), keep=3), who=Brann)');
		assert.equal(set.ok, true, set.reason);
		await play(game, director, 3);
		assert.ok(distance(game.point.get('Brann')!, game.point.get('Brute')!) >= 3);
		director.dispose();
	});

	it('spreads a whole squad apart by law, though none was issued anything, and keeps them fighting there', async () => {
		const game = new Game();
		let spreads = 0;
		const director = await start(game, (g) => g.add('Burster', 'Raider', [0, 12], 'Blue'), (d) => d.onStep((call) => {
			spreads += call.verb === 'spread' ? 1 : 0;
		}).withKernels((ctx) => ({
			me: dummyEntity(ctx.id, { tags: [game.what.get(ctx.id)?.kind ?? 'character'] }),
			others: [...game.what].filter(([id]) => id !== ctx.id && game.point.has(id)).map(([id, w]) => dummyEntity(id, { tags: [w.kind, ...w.kind === 'Raider' ? ['Splash'] : []], fields: { foe: { kind: 'bool', value: !!w.owner && w.owner !== game.what.get(ctx.id)?.owner } } })),
			items: [],
		})));
		for (const id of ['Ann', 'Bo', 'Cy']) {
			game.add(id, 'Spearman', [0.5, 2], 'Red');
			director.collective('Red')!.addCharacter({ id, tags: ['Spearman'] });
		}
		assert.equal((await enact(director, 'Chief', 'law(name=apart, arc=spread_out(paces=4), who=units.filter("Spearman"))')).ok, true);
		await play(game, director, 4);
		const spots = ['Ann', 'Bo', 'Cy'].map((id) => game.point.get(id)!);
		assert.ok(spots.every((a, i) => spots.every((b, j) => i === j || distance(a, b) > 3)), 'apart from each other');
		assert.equal(spreads, 3, 'each walks to its spot once and holds there, not again and again');
		director.dispose();
	});

	it('hands a running fight over to a law, at ticks no shorter than its waits', async () => {
		const game = new Game();
		const director = await start(game, (g) => g.add('Brute', 'Raider', [8, 2], 'Blue'));
		const set = await enact(director, 'Chief', 'law(name=away, arc=keep_distance(from=others.filter("Raider"), keep=3), who=Brann)');
		assert.equal(set.ok, true, set.reason);
		void enact(director, 'Brann', 'hold()');
		// The Brute walks up to Brann while it holds; each tick is longer than hold's waits, so one ends every tick.
		const clock = { t: 0 };
		for (let i = 0; i < 16; i++) {
			clock.t += 0.5;
			const at = game.point.get('Brute')!;
			const to = game.point.get('Brann')!;
			game.point.set('Brute', distance(at, to) > 1 ? at.map((v, k) => v + Math.sign(to[k] - v) * Math.min(0.5, Math.abs(to[k] - v))) : at);
			game.step(0.5);
			director.tick(0.5, clock.t);
			await flush();
		}
		assert.equal(director.character('Brann')!.verb === 'keep_distance' || distance(game.point.get('Brann')!, game.point.get('Brute')!) >= 3, true, 'the law took over from hold');
		director.dispose();
	});

	it('keeps a building training until there are enough', async () => {
		const game = new Game();
		const director = await start(game);
		const set = await enact(director, 'Chief', 'law(name=workers, arc=keep_training(what=Worker, until=4))');
		assert.equal(set.ok, true, set.reason);
		await play(game, director, 6);
		assert.equal(director.collective('Red')!.characters.filter((c) => c.tags.includes('Worker')).length, 4);
		director.dispose();
	});

	it('keeps workers on a resource, sending idle ones, from the commander', async () => {
		const game = new Game();
		const director = await start(game);
		assert.equal((await enact(director, 'Chief', 'law(name=gold, arc=share_workers(on=Gold, of=2))')).ok, true);
		await play(game, director, 2);
		assert.match(director.collective('Red')!.status!(), /Worker ×2 \(2 gathering Gold\)/);
		director.dispose();
	});

	it('builds supply before the cap, once', async () => {
		const game = new Game();
		const director = await start(game);
		await enact(director, 'Chief', 'law(name=houses, arc=supply_ahead())');
		await enact(director, 'Chief', 'train(what=Worker)');
		await play(game, director, 3);
		assert.equal(director.collective('Red')!.characters.filter((c) => c.tags.includes('House')).length, 1);
		director.dispose();
	});

	it('are verbs like any other: in the kit, with help, usable outside a law', async () => {
		const game = new Game();
		const director = await start(game, (g) => g.add('Brute', 'Raider', [2, 2], 'Blue'));
		const verbs = director.collective('Red')!.activeVerbs();
		assert.match(verbs.get('keep_distance')!.help ?? '', /as a law: whenever one is nearer than keep/);
		assert.equal(verbs.get('law')!.args.watch, 'watch?');
		const [ran] = await Promise.all([enact(director, 'Brann', 'keep_distance(keep=4)'), play(game, director, 12)]);
		assert.equal(ran.ok, true, ran.reason);
		assert.ok(distance(game.point.get('Brann')!, game.point.get('Brute')!) > 2);
		assert.match((await enact(director, 'Chief', 'law(name=x, arc=wait())')).reason ?? '', /law needs watch and arc/);
		director.dispose();
	});

	it('fills a template alias from its args, and says which one is missing', async () => {
		const game = new Game();
		const director = await start(game, () => undefined, (d) => d.addVerb('mine_at', { args: { node: 'string?' }, help: 'gathers at node', arc: 'gather(from={node})' }));
		const brann = director.character('Brann')!;
		brann.kit = { verbs: [...brann.refreshKit().verbs, 'mine_at'] };
		const ran = enact(director, 'Brann', 'mine_at(node=Mine)');
		await play(game, director, 2);
		assert.equal(director.character('Brann')!.verb, 'mine_at');
		assert.match(director.collective('Red')!.status!(), /1 gathering Gold/);
		void ran;
		assert.match((await enact(director, 'Brann', 'mine_at()')).reason ?? '', /mine_at needs node/);
		director.dispose();
	});

	it('shows the results of its laws since the last think in the next prompt, then only remembers them', async () => {
		const game = new Game();
		const prompts:string[] = [];
		const director = await start(game, () => undefined, (d) => d.addFakeInference((req) => {
			prompts.push(req.messages.map((m) => String(m.content)).join('\n'));
			return { content: 'wait(seconds=1)', toolCalls: [] };
		}));
		await enact(director, 'Chief', 'law(name=gold, arc=share_workers(on=Gold, of=2))');
		await play(game, director, 2);
		const mind = director.collective('Red')!.mind;
		await mind.thinkNow({ now: 2, enact: false });
		assert.match(prompts[0], /Pinned memories:\n- Law gold ran ×2/);
		await mind.thinkNow({ now: 3, enact: false });
		assert.doesNotMatch(prompts[1], /Law gold ran/);
		assert.ok(mind.persona.memory.all().some((r) => r.text === 'Law gold ran ×2' && !r.pinned), 'recallable');
		director.dispose();
	});

	it('names the cap as the game does, and has none where nothing raises it', async () => {
		const named = new Game();
		named.host.supplyName = 'Energy';
		const director = await start(named);
		assert.match(director.collective('Red')!.status!(), /^Energy: 2\/5$/m);
		const [seen] = await Promise.all([enact(director, 'Chief', 'wait(until=energy == 2 && energyCap == 5, seconds=1)'), play(named, director, 1)]);
		assert.equal(seen.ok, true, seen.reason);
		director.dispose();
		const free = new Game();
		free.host.kinds = Object.fromEntries(Object.entries(free.host.kinds).map(([kind, spec]) => [kind, { ...spec, provides: 0 }]));
		const uncapped = await start(free);
		assert.equal(/Supply/.test(uncapped.collective('Red')!.status!()), false, 'no cap, no line');
		assert.equal(uncapped.collective('Red')!.activeVerbs().has('supply_ahead'), false, 'nothing to build ahead of');
		uncapped.dispose();
	});

	it('picks units by what the roster says they are at', async () => {
		const game = new Game();
		const director = await start(game);
		await enact(director, 'Chief', 'gather(from=Gold, by=Brann)');
		await play(game, director, 1);
		const moved = await enact(director, 'Chief', 'issue(who=units.filter(u => doing(u, "gathering Gold")), arc=go_to(Hall))');
		assert.equal(moved.ok, true, moved.reason);
		assert.equal(director.character('Brann')!.verb, 'go_to');
		assert.notEqual(director.character('Cole')!.verb, 'go_to', 'only the one gathering');
		director.dispose();
	});

	it('lets watches read supply, stock and who is gathering what', async () => {
		const game = new Game();
		const director = await start(game);
		await enact(director, 'Chief', 'gather(from=Gold, workers=1)');
		const [seen] = await Promise.all([enact(director, 'Chief', 'wait(until=supply == 2 && supplyCap == 5 && stock.Wood == 500 && gathering.Gold == 1, seconds=1)'), play(game, director, 1)]);
		assert.equal(seen.ok, true, seen.reason);
		director.dispose();
	});
});

describe('take', () => {
	it('keeps the first n of a list', () => {
		const catalog = buildCatalog({ me: dummyEntity('Ann'), others: ['A', 'B', 'C'].map((id) => dummyEntity(id)), items: [], cache: new SampleCache() });
		const r = evaluate('others.take(2)', catalog);
		assert.deepEqual(r.value.kind === 'list' ? r.value.value.map((v) => (v.kind === 'entity' ? v.value.id : '')) : [], ['A', 'B']);
	});
});
