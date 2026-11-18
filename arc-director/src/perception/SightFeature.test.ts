import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ArcDirector } from '../director/ArcDirector.js';
import '../director/shortcuts.js';
import { dummyEntity } from '../expr/natives.js';
import type { FakeChatFn } from '../inference/fake.js';
import { OPEN_WORLD } from '../testing/open-world.js';
import { Axes } from '../world/axes.js';
import type { Vec } from '../world/world-types.js';
import type { SeenObject } from './perception-types.js';

type Ctx = { id:string };

/**
 * Ada at the origin facing north; at 1× sight Bo is clear, Cy dim, Ivo vague, Eda and Far unseen. `things`: what else
 * everyone sees; `chat`: what the model answers.
 */
function scene(points:Record<string, Vec> = { Ada: [0, 0], Bo: [0, -3], Cy: [0, -30], Ivo: [0, -45], Eda: [0, -80], Far: [0, -120] }, things:SeenObject[] = [], chat?:FakeChatFn) {
	const others = (id:string):string[] => Object.keys(points).filter((other) => other !== id);
	return new ArcDirector<Ctx>()
		.addFake(chat ? { chat } : {})
		.withVerbs((v) => v.addStock().addStockCollective())
		.withDefaultKit({ verbs: ['wait', 'say'] })
		.withHandover({ handover: false })
		.withWorld({ ...OPEN_WORLD, geometry: { axes: Axes.Plane, getPose: (id) => ({ point: points[String(id)] ?? [0, 0], facing: [0, -1] }) } })
		.withContext((id) => (points[id] ? { id } : undefined))
		.withSight({ look: ({ id }) => ({ self: { id, point: points[id], facing: [0, -1] }, objects: [...others(id).map((other) => ({ id: other, point: points[other], tags: ['character'] })), ...things] }) })
		.withKernels(({ id }) => ({ me: dummyEntity(id), others: others(id).map((other) => dummyEntity(other)), items: [], nearRadius: 5 }))
		.withTalk({ others, inRange: (a, b) => Math.abs(points[a][1] - points[b][1]) <= 50 });
}

describe('what sight makes out', () => {
	it('names and remembers by id only what it makes out; a vague figure goes by a label of its own and leaves no memory', async () => {
		const director = await scene().addCharacter({ id: 'Ada', mind: { rethinkingThreshold: 0 } }).connect();
		const mind = director.character('Ada')!.mind!;
		const sight = String(director.senses.all.sight({ id: 'Ada' }, mind));
		assert.match(sight, /Bo .*Cy|Cy .*Bo/s);
		assert.match(sight, /FigureA 45 paces in front of you/);
		assert.doesNotMatch(sight, /Ivo|Eda|\?/);
		mind.memory.noteSeen();
		await mind.memory.remember('FigureA is watching me');
		const kept = director.character('Ada')!.persona.memory.all();
		assert.deepEqual(kept.flatMap((r) => r.tags.filter((t) => t.startsWith('seen:'))).sort(), ['seen:Bo', 'seen:Cy']);
		assert.ok(kept.some((r) => r.text === 'FigureA is watching me'), 'a label is kept as a word, never as who it is');
		assert.ok(kept.every((r) => !r.text.includes('Ivo')), kept.map((r) => r.text).join('\n'));
		director.dispose();
	});

	it('letters each vague thing by its kind, the same while it stays vague; made out, it is shown by name and the label names no one', async () => {
		const points:Record<string, Vec> = { Ada: [0, 0], Ivo: [0, -45], Eda: [5, -45] };
		const tome = { id: 'RedTome', point: [0, -46], tags: [], kind: 'Book' };
		const crate = { id: 'Crate', point: [0, -47], tags: [] };
		const director = await scene(points, [tome, crate]).addCharacter({ id: 'Ada', mind: { rethinkingThreshold: 0 } }).connect();
		const mind = director.character('Ada')!.mind!;
		const look = ():string => String(director.senses.all.sight({ id: 'Ada' }, mind));
		const first = look();
		assert.deepEqual(first.match(/\b(Book|Figure|Something)[A-Z]+\b/g)?.sort(), ['BookA', 'FigureA', 'FigureB', 'SomethingA'], first);
		assert.doesNotMatch(first, /Ivo|Eda|RedTome|Crate/);
		const ivo = mind.persona.names.peek('Ivo')!;
		assert.equal(look(), first, 'the same letters while it stays vague');
		assert.equal(mind.persona.names.read(ivo), 'Ivo', 'the mind acts on it by its label');
		assert.equal(mind.shownSteps([{ verb: 'go_to', args: { target: 'Ivo' } }], director.verbs, 'text'), `go_to(${ivo})`, 'and its own code shows the label it wrote');
		points.Ivo = [0, -3];
		assert.match(look(), /Ivo 3 paces/);
		assert.equal(mind.persona.names.resolve(ivo), ivo, 'the label names no one any more');
		assert.equal(mind.shownSteps([{ verb: 'go_to', args: { target: 'Ivo' } }], director.verbs, 'text'), 'go_to(Ivo)');
		director.dispose();
	});

	it('walks to a vague figure by its label', async () => {
		const prompts:string[] = [];
		const director = await scene(undefined, [], (req) => {
			prompts.push(String(req.messages.at(-1)?.content));
			return { content: 'go_to(FigureA)', toolCalls: [] };
		})
			.withPriorityThinkQueue({ processInterval: 0, rethinkInterval: 100 })
			.withIntervals({ think: Infinity })
			.withMind({ arcFormat: 'text' })
			.withDefaultKit({ verbs: ['wait', 'say', 'go_to'] })
			.addCharacter({ id: 'Ada', mind: { rethinkingThreshold: 0 } })
			.connect();
		const arcs:unknown[] = [];
		director.onThink((event) => event.kind === 'end' && arcs.push(event.arc));
		director.queue!.enqueueMajor('Ada');
		for (let n = 0; n < 40 && arcs.length === 0; n++) {
			director.tick(0.1);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.match(prompts[0], /FigureA 45 paces/);
		assert.doesNotMatch(prompts[0], /Ivo/);
		assert.deepEqual(arcs[0], [{ verb: 'go_to', args: { target: 'Ivo' } }]);
		director.dispose();
	});

	it('keeps memories by id and shows each mind its own names, across a move into a collective', async () => {
		const director = await scene()
			.withNames((observer, target) => (target.id !== 'Bo' ? target.id : observer.id === 'Ada' ? 'Hooded' : 'Smith'))
			.addCharacter({ id: 'Ada', mind: { rethinkingThreshold: 0 } })
			.addCollective({ id: 'Watch', mind: { rethinkingThreshold: 0 }, characters: [{ id: 'Cy' }] })
			.connect();
		const ada = director.character('Ada')!;
		const own = ada.mind!;
		assert.match(String(director.senses.all.sight({ id: 'Ada' }, own)), /Hooded/);
		own.memory.noteSeen();
		await own.memory.remember('Hooded owes me a loaf');
		const kept = ():string[] => ada.persona.memory.all().map((r) => r.text);
		assert.ok(kept().includes('Bo owes me a loaf'), kept().join('\n'));
		assert.ok(kept().some((text) => text.startsWith('Last I saw Bo: Bo ')), kept().join('\n'));
		assert.deepEqual((await own.memory.recall({ query: 'loaf' })).map((r) => r.text), ['Hooded owes me a loaf']);
		ada.collective = director.collective('Watch')!;
		assert.ok(kept().includes('Bo owes me a loaf'), 'its own memory is untouched by the move');
		const watch = director.collective('Watch')!;
		watch.mind!.seen({ id: 'Bo' });
		watch.persona.memory.add({ category: 'semantic', text: (name) => `${name('Bo')} owes Ada a loaf`, tags: [], timestamp: 0 }, 0);
		assert.deepEqual((await watch.mind!.memory.recall({ query: 'loaf' })).map((r) => r.text), ['Smith owes Ada a loaf']);
		director.dispose();
	});

	it('pools every unit\'s vague sightings in a collective, even of the same one', async () => {
		const points:Record<string, Vec> = { Mira: [0, 0], Tomas: [80, 0], Stranger: [40, -3] };
		const director = await scene(points).addCollective({ id: 'Hive', mind: { rethinkingThreshold: 0 }, characters: [{ id: 'Mira' }, { id: 'Tomas' }] }).connect();
		const sight = String(director.senses.all.sight({ id: 'Mira' }, director.collective('Hive')!.mind!));
		assert.equal(sight.match(/FigureA/g)?.length, 2, sight);
		assert.doesNotMatch(sight, /Stranger|\?/);
		director.dispose();
	});
});

describe('earshot by what a mind can tell', () => {
	it('names whom it sees or whose voice it knows; anyone else it cannot make out, and say(to) them fails', async () => {
		const points:Record<string, Vec> = { Ada: [0, 0], Bo: [0, -3], Cy: [0, -30], Ivo: [0, -45], Eda: [0, -80], Far: [0, -120] };
		const director = await scene(points).addCharacter({ id: 'Ada', mind: { rethinkingThreshold: 0 } }).connect();
		const mind = director.character('Ada')!.mind!;
		const earshot = ():string => String(director.senses.all.earshot({ id: 'Ada' }, mind));
		assert.match(earshot(), /In talking range: Bo, Cy, someone you cannot make out\./);
		assert.deepEqual(director.getTalk()!.canSay('Ada', 'Ivo'), { ok: false, reason: 'no one you can make out here answers to Ivo; get closer first', nearby: ['Bo', 'Cy', 'Ivo'] });
		mind.memory.noteConversation({ speakerID: 'Ivo', text: 'Who goes there?' });
		assert.match(earshot(), /someone you cannot make out/, 'a voice it never saw is no one it knows');
		points.Ivo = [0, -3];
		director.senses.all.sight({ id: 'Ada' }, mind);
		points.Ivo = [0, -45];
		assert.match(earshot(), /In talking range: Bo, Cy, Ivo\./, 'a voice it knows');
		assert.equal(director.getTalk()!.canSay('Ada', 'Ivo').ok, true);
		director.senses.all.sight({ id: 'Ada' }, mind);
		const label = mind.persona.names.peek('Ivo')!;
		assert.match(label, /^Figure[A-Z]+$/);
		assert.match(earshot(), /In talking range: Bo, Cy, someone you cannot make out\./, 'seen again but not made out, a voice it knows is no one it can tell');
		assert.deepEqual(director.getTalk()!.canSay('Ada', mind.persona.names.resolve(label)), { ok: false, reason: `no one you can make out here answers to ${label}; get closer first`, nearby: ['Bo', 'Cy', 'Ivo'] });
		director.dispose();
	});
});

describe('observe by sight\'s tiers', () => {
	it('makes out twice as far as sight; dim says to get closer, and vague or farther is no one by that name', async () => {
		const director = await scene().addCharacter({ id: 'Ada', mind: { rethinkingThreshold: 0 } }).connect();
		const mind = director.character('Ada')!.mind!;
		const observe = (expr:string) => director.tools.all.observe.handler({ id: 'Ada' }, { expr }, mind, null as never);
		assert.equal(await observe('isNear(Cy, me, 40)'), 'true', 'dim at sight is clear at twice its range');
		assert.equal(await observe('isNear(Ivo, me, 50)'), 'true\nIvo: too far to make out clearly; get closer to see');
		assert.deepEqual(await observe('isNear(Eda, me, 100)'), { error: 'Eda: you make out no one by that name from here; get closer to see' });
		assert.deepEqual(await observe('isNear(Far, me, 200)'), { error: 'Far: you make out no one by that name from here; get closer to see' }, 'vague and farther alike: it never learns who a vague figure is');
		assert.equal(await observe('count(others.filter(u => u.name == "Ivo"))'), '1\nIvo: too far to make out clearly; get closer to see');
		assert.equal(await observe('count(others)'), '3', 'Bo, Cy and Ivo; Eda vague, Far unseen');
		const again = 'Asking again will not change that: move, look, or act.';
		assert.equal(await observe('others.filter(u => isNear(u, me, 1))'), `No one here matches others.filter(u => isNear(u, me, 1)). ${again}`);
		assert.equal(await observe('items'), `Nothing here matches items. ${again}`);
		director.senses.all.sight({ id: 'Ada' }, mind);
		assert.deepEqual(await observe('isNear(FigureA, me, 50)'), { error: 'FigureA: too far to make out; get closer to see' }, 'its label says nothing of who it is, even where observe makes it out');
		director.dispose();
	});

	it('keeps to its own range factor', async () => {
		const director = await scene().withSight({ observeRangeFactor: 1 }).addCharacter({ id: 'Ada', mind: { rethinkingThreshold: 0 } }).connect();
		const observe = (expr:string) => director.tools.all.observe.handler({ id: 'Ada' }, { expr }, director.character('Ada')!.mind!, null as never);
		assert.equal(await observe('isNear(Cy, me, 40)'), 'true\nCy: too far to make out clearly; get closer to see');
		assert.deepEqual(await observe('isNear(Ivo, me, 50)'), { error: 'Ivo: you make out no one by that name from here; get closer to see' });
		director.dispose();
	});
});

describe('a range of the game\'s own', () => {
	for (const [what, range] of [
		['a wider range', { clear: 60, dim: 90, vague: 100 }],
		['a range function', () => 1],
	] as const) {
		it(`sees as far as ${what} says, in the sight text, the roster and sees`, async () => {
			const director = await scene().withSight({ range }).addCollective({ id: 'Team', commander: 'Ada', characters: [{ id: 'Ada', mind: { rethinkingThreshold: 0 } }] }).connect();
			const team = director.collective('Team')!;
			const sight = String(director.senses.all.sight({ id: 'Ada' }, team.mind!));
			assert.match(sight, /Eda 80 paces/);
			const roster = director.getSight()!.othersSeenBy('Ada', team, team.mind!).map((o) => o.name);
			assert.ok(roster.includes('Eda'), roster.join(', '));
			assert.equal(director.getSight()!.sees('Ada', 'Eda'), true);
			assert.equal(director.getSight()!.sees('Ada', 'Far'), typeof range === 'function');
			director.dispose();
		});
	}
});

describe('the roster\'s reach', () => {
	it('tags each one in reach, in reach with no clear shot, or out of reach, and asks light only of those in reach', () => {
		const points:Record<string, Vec> = { Ada: [0, 0], Bo: [0, -1.5], Cy: [1.5, 0], Dee: [0, -5] };
		const asked:Vec[] = [];
		const director = new ArcDirector<Ctx>()
			.addFake({})
			.withVerbs((v) => v.addStock().addStockCollective())
			.withDefaultKit({ verbs: ['wait'] })
			.withWorld({ ...OPEN_WORLD, geometry: {
				axes: Axes.Plane,
				getPose: (id) => ({ point: points[String(id)] ?? [0, 0] }),
				getReach: () => 2,
				// A wall between Ada and Cy.
				getClarity: (what, a, b) => {
					asked.push(b);
					return b[0] > 1 ? 0 : 1;
				},
			} })
			.withContext((id) => (points[id] ? { id } : undefined))
			// Seen whatever stands between, so sight asks no clarity of its own.
			.withSight({ look: ({ id }) => ({ self: { id, point: points[id] }, objects: Object.keys(points).filter((o) => o !== id).map((o) => ({ id: o, point: points[o], tags: ['character'], always: true })) }) })
			.addCollective({ id: 'Team', commander: 'Ada', characters: [{ id: 'Ada' }] });
		director.tick(0);
		const team = director.collective('Team')!;
		const roster = director.getSight()!.othersSeenBy('Ada', team, team.mind!).map((o) => o.text);
		assert.deepEqual(roster, ['Bo 2 paces (in reach)', 'Cy 2 paces (in reach, no clear shot)', 'Dee 5 paces (out of reach)']);
		assert.deepEqual(asked, [points.Bo, points.Cy], 'no light asked of Dee, out of reach');
		director.dispose();
	});
});
