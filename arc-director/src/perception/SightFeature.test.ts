import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ArcDirector } from '../director/ArcDirector.js';
import '../director/shortcuts.js';
import { dummyEntity } from '../expr/natives.js';
import type { FakeChatFn } from '../inference/fake.js';
import { OPEN_WORLD } from '../testing/open-world.js';
import { Axes } from '../world/axes.js';
import type { Vec } from '../world/world-types.js';
import { internalsOf } from '../internals.js';
import type { MemoryRecord } from '../memory/store.js';
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
		assert.ok(kept.some((r) => r.text === 'FigureA is watching Ada'), 'a label is kept as a word, never as who it is');
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
		assert.ok(kept().includes('Bo owes Ada a loaf'), kept().join('\n'));
		assert.ok(kept().some((text) => text.startsWith('Ada last saw Bo: Bo ')), kept().join('\n'));
		assert.deepEqual(await own.memory.recall({ query: 'loaf' }), ['moments ago: Hooded owes you a loaf']);
		ada.collective = director.collective('Watch')!;
		assert.ok(kept().includes('Bo owes Ada a loaf'), 'its own memory is untouched by the move');
		const watch = director.collective('Watch')!;
		watch.mind!.seen({ id: 'Bo' });
		watch.persona.memory.add({ category: 'semantic', text: (name) => `${name('Bo')} owes Ada a loaf`, tags: [], timestamp: 0 }, 0);
		assert.deepEqual(await watch.mind!.memory.recall({ query: 'loaf' }), ['moments ago: Smith owes Ada a loaf', 'moments ago: Smith owes Ada a loaf'], 'its own record, and Ada\'s note, which it reads since she joined');
		director.dispose();
	});

	it('teaches each character\'s own book what its collective\'s mind makes out through its eyes, as the rule names it for that character', async () => {
		const director = await scene()
			.withNames((observer, target) => (target.id !== 'Bo' ? target.id : observer.id === 'Cy' ? 'Smith' : 'Hooded'))
			.addCollective({ id: 'Watch', mind: { rethinkingThreshold: 0 }, characters: [{ id: 'Cy' }] })
			.connect();
		const watch = director.collective('Watch')!;
		assert.match(String(director.senses.all.sight({ id: 'Cy' }, watch.mind)), /Hooded/);
		assert.equal(watch.persona.names.peek('Bo'), 'Hooded');
		assert.equal(director.character('Cy')!.persona.names.peek('Bo'), 'Smith');
		director.dispose();
	});

	it('remembers the state it saw a thing in, says once what changed, and changed() holds until it has seen it', async () => {
		const bridge:SeenObject = { id: 'Bridge', point: [0, -5], tags: [], state: { position: 'raised' } };
		const director = await scene(undefined, [bridge]).addCharacter({ id: 'Ada', mind: { rethinkingThreshold: 0 } }).connect();
		const mind = director.character('Ada')!.mind!;
		const look = ():void => {
			director.senses.all.sight({ id: 'Ada' }, mind);
		};
		const changed = ():boolean => {
			const { value } = director.evaluate('Ada', 'changed("Bridge")');
			return value.kind === 'bool' && value.value;
		};
		// A think that ends well keeps what it saw.
		const thought = ():void => internalsOf(mind.memory).commitSeen();
		const sighting = ():MemoryRecord | undefined => mind.persona.memory.all().find((r) => r.tags.includes('seen:Bridge'));
		look();
		assert.deepEqual(mind.memory.noteSeen(), [], 'nothing seen before');
		thought();
		bridge.state = { position: 'lowered' };
		director.tick(0.1);
		assert.equal(changed(), true);
		look();
		assert.deepEqual(mind.memory.noteSeen(), ['Bridge was raised when you last saw it. Now it is lowered.']);
		internalsOf(mind).stamp(7);
		look();
		assert.deepEqual(mind.memory.noteSeen(), ['Bridge was raised when you last saw it. Now it is lowered.'], 'its think failed: told again');
		assert.equal(sighting()?.timestamp, 7, 'last seen now');
		thought();
		look();
		assert.deepEqual(mind.memory.noteSeen(), [], 'said once');
		director.tick(0.1);
		assert.equal(changed(), false);
		director.dispose();
	});

	it('sees within a field of view where one is set, a character\'s own over the director\'s; all around without', async () => {
		// Facing north (-z): Bo ahead, Ivo to the side, Kim a little behind the side, Eda behind.
		const points:Record<string, Vec> = { Ada: [0, 0], Owl: [0.5, 0], Cat: [0, 0.2], Bo: [0, -3], Ivo: [3, 0], Kim: [-3, 0.8], Eda: [0, 3] };
		const director = await scene(points)
			.withSight({ fieldOfView: { clear: 120, dim: 180, vague: 220 } })
			.addCharacter({ id: 'Ada', mind: { rethinkingThreshold: 0 } })
			.addCharacter({ id: 'Owl', mind: { rethinkingThreshold: 0 }, fieldOfView: 360 })
			.addCharacter({ id: 'Cat', mind: { rethinkingThreshold: 0 }, fieldOfView: 180 })
			.connect();
		const sight = (id:string):string => String(director.senses.all.sight({ id }, director.character(id)!.mind!));
		assert.match(sight('Ada'), /Bo 3 paces/);
		assert.doesNotMatch(sight('Ada'), /Eda/, 'nothing behind it');
		assert.match(sight('Ada'), /Ivo 3 paces to your right/, 'to its side: dim, by name');
		assert.match(sight('Ada'), /FigureA/, 'a little behind: vague');
		assert.doesNotMatch(sight('Ada'), /Kim/);
		assert.match(sight('Owl'), /Eda/, 'its own field, all around');
		assert.match(sight('Cat'), /Ivo 3 paces to your right/, 'a cone 180 across: its sides whole');
		assert.doesNotMatch(sight('Cat'), /Eda|Kim|FigureA/, 'nothing past them, not even vaguely');
		director.dispose();
	});

	it('sees one exactly beside it in a cone 180 across, whichever way it faces', async () => {
		let yaw = 0;
		const way = ():Vec => [Math.sin(yaw), -Math.cos(yaw)];
		const director = await new ArcDirector<Ctx>()
			.addFake({})
			.withVerbs((v) => v.addStock())
			.withDefaultKit({ verbs: ['wait'] })
			.withContext((id) => ({ id }))
			.withSight({ fieldOfView: 180, look: ({ id }) => ({ self: { id, point: [0, 0], facing: way() }, objects: [{ id: 'Bo', point: [-way()[1] * 3, way()[0] * 3], tags: [] }] }) })
			.addCharacter({ id: 'Ada', mind: { rethinkingThreshold: 0 } })
			.connect();
		const missed = [...Array(360).keys()].filter((deg) => {
			yaw = deg * Math.PI / 180;
			return !director.getSight()!.sees('Ada', 'Bo');
		});
		assert.deepEqual(missed, []);
		director.dispose();
	});

	it('says who perceives an event: whoever makes out one it is about, not one too far to', async () => {
		const director = await scene()
			.addCharacter({ id: 'Ada', mind: { rethinkingThreshold: 0 } })
			.addCharacter({ id: 'Far', mind: { rethinkingThreshold: 0 } })
			.connect();
		director.pushEvent({ kind: 'Theft', text: (who) => `${who('Bo')} stole a loaf` });
		assert.equal(director.character('Ada')!.mind!.events().length, 1, 'Bo is 3 paces from Ada');
		assert.equal(director.character('Far')!.mind!.events().length, 0, 'and 117 from Far');
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
	it('names whom it sees, and a voice it cannot place by a name of its own it can answer; seen speaking, the voice is theirs', async () => {
		const points:Record<string, Vec> = { Ada: [0, 0], Bo: [0, -3], Cy: [0, -30], Ivo: [0, -45], Eda: [0, -80], Far: [0, -120] };
		const director = await scene(points).addCharacter({ id: 'Ada', mind: { rethinkingThreshold: 0 } }).connect();
		const mind = director.character('Ada')!.mind!;
		const talk = director.getTalk()!;
		const earshot = ():string => String(director.senses.all.earshot({ id: 'Ada' }, mind));
		const heard = ():string[] => mind.events().map((e) => e.text);
		director.senses.all.sight({ id: 'Ada' }, mind);
		assert.match(earshot(), /In talking range: Bo, Cy, someone you cannot make out\./, 'Ivo, vague and silent');
		assert.equal(talk.canSay('Ada', 'Ivo').ok, false);
		talk.say('Ivo', 'Who goes there?', 'Ada', 1);
		assert.deepEqual(heard(), ['VoiceA says to you: "Who goes there?"'], 'heard, not made out: a voice of its own');
		assert.match(earshot(), /In talking range: Bo, Cy, VoiceA\./);
		assert.equal(talk.canSay('Ada', mind.persona.names.resolve('VoiceA')).ok, true, 'a voice it heard, it can answer');
		points.Bo = [0, -45];
		talk.say('Bo', 'Over here.', 'Ada', 2);
		assert.equal(heard().at(-1), 'VoiceB says to you: "Over here."', 'one it saw, silent, heard out of sight: not by the face');
		points.Bo = [0, -3];
		// Everyone faces north: Ivo just north of Ada turns his back on her, just south of her his face.
		points.Ivo = [0, -3];
		talk.say('Ivo', 'It is me.', 'Ada', 3);
		assert.equal(heard().at(-1), 'VoiceA says to you: "It is me."', 'seen speaking with his back to her: no face to tie the voice to');
		points.Ivo = [0, 3];
		talk.say('Ivo', 'Behind you.', 'Ada', 3.5);
		points.Ivo = [0, -45];
		assert.deepEqual(heard().slice(0, 1), ['Ivo says to you: "Who goes there?"'], 'seen speaking face on: its voice is theirs, back to its first line');
		talk.say('Ivo', 'Still here.', 'Ada', 4);
		assert.equal(heard().at(-1), 'Ivo says to you: "Still here."', 'a voice it knows, out of sight');
		assert.match(earshot(), /In talking range: Bo, Cy, Ivo\./);
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
