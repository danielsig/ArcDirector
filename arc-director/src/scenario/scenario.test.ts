import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ArcDirector } from '../director/director.js';
import { FakeProvider } from '../inference/fake.js';
import type { ChatRequest } from '../inference/provider.js';
import { ABILITIES, abilityHelp } from './combat.js';
import { loudnessFor } from '../perception/hearing.js';
import { idleScenario, playScenario, type Scenario, type SceneCtx } from './play.js';
import { SceneWorld, type SceneSpot } from './world.js';

/** A model on its own server, writing Arc text; it can see, so `see_map` is offered. `chat` answers each request. */
function model(chat:(req:ChatRequest)=>string):(director:ArcDirector<SceneCtx>)=>unknown {
	return (director) => director
		.withArcFormat('text')
		.addInference('fake', new FakeProvider((req) => ({ content: chat(req), toolCalls: [] })), { vision: true })
		.addModel('main', { id: 'fake' });
}

/** A model that writes `arcs` in turn, one a think, the last again after; a request that is no think gets `OK`. */
function scripted(arcs:string | string[]):(director:ArcDirector<SceneCtx>)=>unknown {
	const list = [arcs].flat();
	let thinks = 0;
	return model((req) => (req.thread ? list[Math.min(thinks++, list.length - 1)] : 'OK'));
}

/** Whether `s` reached its goal when its arcs are `arcs`, one a think. */
async function reached(s:Scenario, arcs:string | string[]):Promise<boolean> {
	return (await playScenario(s, scripted(arcs))).done;
}

describe('scene play', () => {
	it('fights as often commanded as on its own, the commander too, and gives way to a reaction', async () => {
		const others:Scenario['others'] = { Dummy: { away: 5, side: 'ahead', hp: [1000, 1000] } };
		const squad:Scenario = {
			me: { id: 'Cap', as: 'Rifleman' }, squad: { Kell: { away: 1, side: 'left', as: 'Rifleman' } }, others,
			goal: 'g', thinks: 1, seconds: 10, done: () => false,
		};
		/** How much `arc` took off the Dummy. */
		const dealt = async (arc:string):Promise<number> => (await playScenario(squad, scripted(arc), { judge: (w) => 1000 - w.hp('Dummy')! })).judged;
		const idle = await dealt('say(text=Ready.)');
		assert.equal(idle, 40, 'the commander and its unit each strike back every second on their own');
		assert.equal(await dealt('issue(who=units, arc=fire(target=Dummy)) ; fire(target=Dummy)'), idle, 'commanded, as often');
		const fled = await reached(
			{ me: { id: 'Ash', as: 'Archer' }, others, things: { Keep: { away: 10, side: 'behind' } }, goal: 'g', thinks: 1, seconds: 20, done: (w) => w.near('Ash', 'Keep') },
			'when(watch=isHurt(Dummy), arc=go_to(Keep)) ; shoot(target=Dummy)',
		);
		assert.ok(fled, 'the reaction stops the shooting');
	});

	it('spreads a squad apart when told to', async () => {
		const bunched:Scenario = {
			me: { id: 'Cap', as: 'Knight' }, goal: 'g', thinks: 1, seconds: 8,
			squad: Object.fromEntries(['A', 'B', 'C'].map((id) => [id, { away: 3, side: 'ahead', as: 'Blade', tags: ['Sword'] }])),
			done: () => false,
		};
		const { judged: at } = await playScenario(bunched, scripted('issue(who=units.filter("Sword"), arc=spread(paces=4))'), {
			judge: (w) => ['A', 'B', 'C'].map((id) => w.getPose(id)!.point),
		});
		const apart = Math.min(...at.flatMap((a, i) => at.slice(i + 1).map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))));
		assert.ok(apart >= 3, `closest two ${apart.toFixed(1)} paces apart: ${JSON.stringify(at)}`);
	});

	it('places anyone anywhere, and its foes march on a goal or guard a post', async () => {
		const field:Scenario = {
			me: { id: 'Cap', as: 'Knight' }, goal: 'g', thinks: 1, thinkEvery: 12, seconds: 12,
			things: { Keep: { away: 20, side: 'ahead', offset: [10, 0] } },
			others: {
				Raider: { away: 20, side: 'ahead', offset: [-10, 0], as: 'Raider', tactic: 'march', toward: 'Keep' },
				Warden: { away: 8, side: 'behind', as: 'Raider', tactic: 'guard', guard: 4 },
			},
			done: () => false,
		};
		const { judged: seen } = await playScenario(field, scripted('wait(seconds=1)'), {
			judge: (w) => Object.fromEntries(['Keep', 'Raider', 'Warden'].map((id) => [id, w.getPose(id)!.point])),
		});
		assert.deepEqual(seen.Keep, [10, -20], 'offset from its point ahead');
		assert.ok(Math.hypot(seen.Raider[0] - 10, seen.Raider[1] + 20) <= 2, `the Raider marched to the Keep: ${seen.Raider}`);
		assert.deepEqual(seen.Warden, [0, 8], 'no foe near its post: the Warden stays');
		const near:Scenario = { ...field, squad: { Bait: { away: 5, side: 'behind', as: 'Blade', tags: ['Sword'] } } };
		const { judged: hurt } = await playScenario(near, scripted('wait(seconds=1)'), { judge: (w) => 20 - (w.hp('Bait') ?? 0) });
		assert.ok(hurt > 0, 'one within its guard: the Warden goes for it');
	});

	it('with crowding, lets a column strike one at a time and a ring all at once', async () => {
		const column:Scenario = {
			me: { id: 'Cap', as: 'Knight' }, goal: 'g', thinks: 1, seconds: 16,
			squad: Object.fromEntries(['A', 'B', 'C', 'D'].map((id, i) => [id, { away: 2 + i, side: 'ahead', as: 'Blade' }])),
			others: { Dummy: { away: 12, side: 'ahead', hp: [1000, 1000] } },
			done: () => false,
		};
		const dealt = async (s:Scenario, arc:string):Promise<number> => (await playScenario(s, scripted(arc), { judge: (w) => 1000 - w.hp('Dummy')! })).judged;
		const charge = 'issue(who=units, arc=stab(target=Dummy))';
		const ring = 'issue(who=units, arc=circle(around=Dummy, paces=1.5) && stab(target=Dummy))';
		const crowded = { ...column, crowding: 1.5 };
		const [line, round] = [await dealt(crowded, charge), await dealt(crowded, ring)];
		assert.ok(round >= 3 * line, `a ring dealt ${round}, a column ${line}`);
		assert.ok(await dealt(column, charge) >= 3 * line, 'no crowding, no waiting');
	});

	it('lands a combo\'s payoff harder on a foe the setup left under it', async () => {
		const s:Scenario = {
			me: { id: 'Cap', as: 'Knight' }, goal: 'g', thinks: 1, seconds: 3,
			squad: { A: { away: 1, side: 'ahead', as: 'Harpooner' } },
			others: { Dummy: { away: 3, side: 'ahead', hp: [100, 100] } },
			done: () => false,
		};
		const dealt = async (spot:SceneSpot):Promise<number> => (await playScenario({ ...s, others: { Dummy: spot } }, scripted('issue(who=units, arc=impale(target=Dummy))'), {
			judge: (w) => 100 - w.hp('Dummy')!,
		})).judged;
		assert.equal(await dealt({ away: 3, side: 'ahead', hp: [100, 100] }), 2);
		assert.equal(await dealt({ away: 3, side: 'ahead', hp: [100, 100], suffering: [{ status: 'root', seconds: 30 }] }), 16);
		assert.match(abilityHelp(ABILITIES.impale), /14 more on a rooted foe/);
	});

	it('wastes an aimed shot whose target is down before it lands', async () => {
		const s:Scenario = {
			me: { id: 'Cap', as: 'Knight' }, goal: 'g', thinks: 1, seconds: 6,
			squad: Object.fromEntries(['A', 'B'].map((id, i) => [id, { away: 1, side: i ? 'left' : 'right', as: 'Marksman' }])),
			// Out of aim at first, so neither fires on its own before its order.
			others: Object.fromEntries(['X', 'Y'].map((id, i) => [id, { away: 16, side: 'ahead', offset: [i * 2, 0], hp: [10, 10] }])),
			done: () => false,
		};
		const fallen = async (arc:string):Promise<string[]> => (await playScenario(s, scripted(arc), { judge: (w) => [...w.downed] })).judged;
		assert.deepEqual(await fallen('issue(who=units, arc=snipe(target=X))'), ['X'], 'both shots on X: one wasted');
		assert.deepEqual((await fallen('issue(who=A, arc=snipe(target=X)) ; issue(who=B, arc=snipe(target=Y))')).sort(), ['X', 'Y']);
	});

	it('plays an RTS scene with no cap on units, and idles one to its end', async () => {
		const s:Scenario = {
			me: { id: 'Cap', as: 'Knight' }, goal: 'g', thinks: 1, seconds: 4, rts: {},
			squad: { A: { away: 2, side: 'left', as: 'Blade', tags: ['Sword'] } },
			done: () => false,
		};
		assert.equal(await reached(s, 'wait(seconds=1)'), false);
		assert.equal((await idleScenario(s, (w) => w.time)).at(-1), 4);
	});

	it('lets its squad run the verbs it says they may', async () => {
		const marked:string[] = [];
		const s:Scenario = {
			me: { id: 'Cap', as: 'Knight' }, goal: 'g', thinks: 1, seconds: 4,
			squad: { A: { away: 2, side: 'left', as: 'Blade', tags: ['Sword'] } },
			verbs: { mark: { units: true, help: 'marks where you stand', run: (_w, { who }) => (marked.push(who), 'marked') } },
			done: () => false,
		};
		await playScenario(s, scripted('issue(who=units.filter("Sword"), arc=mark())'));
		assert.deepEqual(marked, ['A']);
	});

	it('paces its thinks as a game does when told to, and plays on to the end after the last', async () => {
		const quick:Scenario = { me: { id: 'Ash', as: 'Archer' }, goal: 'g', thinks: 2, seconds: 30, done: (w) => w.time >= 15 };
		assert.equal(await reached(quick, 'wait(seconds=1)'), false, 'unpaced, two quick thinks and it is over');
		assert.equal(await reached({ ...quick, thinkEvery: 10 }, 'wait(seconds=1)'), true, 'paced, the scene is still going at 15 s');
	});

	it('lets the verbs a scenario adds wait to end, and hurt and bind by their own rules', async () => {
		let release:((text:string)=>void) | undefined;
		const s:Scenario = {
			me: { id: 'Ash' }, goal: 'g', thinks: 1, seconds: 6,
			others: { Dummy: { away: 3, side: 'ahead', hp: [20, 20] } },
			verbs: {
				hex: {
					args: { target: 'id' },
					run: (w, { args }) => new Promise((done) => {
						release = (text) => {
							release = undefined;
							w.hurt(String(args.target), 15);
							w.suffer(String(args.target), { status: 'root', seconds: 30 });
							done(text);
						};
					}),
				},
			},
			act: (w) => (w.time >= 2 ? release?.('the hex lands') : undefined),
			done: () => false,
		};
		const end = await playScenario(s, scripted('hex(target=Dummy) && say(text=Done.)'), { judge: (w) => ({ hp: w.hp('Dummy'), statuses: w.statusesOf('Dummy'), said: w.said.map((l) => l.text), time: w.time }) });
		assert.equal(end.judged.hp, 5, 'hurt by its own rules');
		assert.deepEqual(end.judged.statuses, ['root']);
		assert.deepEqual(end.judged.said, ['Done.'], 'the next step ran once the verb ended');
	});

	it('hears a sound made near it in its next think, and knows how far its own verbs carry', async () => {
		const prompts:string[] = [];
		let made = false;
		const s:Scenario = {
			me: { id: 'Ash' }, goal: 'g', thinks: 2, thinkEvery: 3, seconds: 6,
			others: { Foe: { away: 3, side: 'behind', hp: [20, 20] } },
			verbs: { reload: { help: 'refills your gun', run: () => 'reloaded' } },
			noise: { reload: { name: 'reloading', loudness: loudnessFor(12) } },
			act: (w, director) => {
				if (w.time >= 1 && !made) {
					made = true;
					director.emitSound(w.getPose('Foe')!.point, { name: 'footsteps', loudness: 0.8 });
				}
			},
			done: () => false,
		};
		await playScenario(s, model((req) => {
			if (req.thread) {
				prompts.push(req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join(' '));
			}
			return req.thread ? 'wait(seconds=1)' : 'OK';
		}));
		assert.match(prompts[0], /reload — refills your gun; heard as reloading up to 12 paces/);
		assert.doesNotMatch(prompts[0], /You hear/);
		assert.match(prompts[1], /You hear footsteps LOUDLY 3 paces behind you!/);
	});

	it('tells a sound that goes on again only as it grows louder, one line for it: a fire catching', async () => {
		const prompts:string[] = [];
		const s:Scenario = {
			me: { id: 'Ash' }, goal: 'g', thinks: 2, thinkEvery: 5, seconds: 6,
			noise: {},
			act: (w, director) => {
				// A fire 2 paces behind catches, louder each second; the game keeps the sound going by making it again.
				const at = w.getPose('Ash')!.point;
				director.emitSound([at[0], at[1] + 2], { name: 'crackling', loudness: Math.min(1, 0.2 + w.time * 0.2), seconds: 1 });
			},
			done: () => false,
		};
		await playScenario(s, model((req) => {
			if (req.thread) {
				prompts.push(req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join(' '));
			}
			return req.thread ? 'wait(seconds=1)' : 'OK';
		}));
		const heard = prompts[1].match(/You hear crackling[^.!]*[.!]/g) ?? [];
		assert.deepEqual(heard.length, 1, `one line for it: ${heard.join(' | ')}`);
		assert.match(heard[0], /LOUDLY/, 'the latest, loudest');
	});

	it('shows what each one in sight is doing: a squad mate the verb it runs, a foe fighting on its own what it uses', async () => {
		const prompts:string[] = [];
		const s:Scenario = {
			me: { id: 'Cap' }, goal: 'g', thinks: 2, seconds: 25,
			squad: { Kell: { away: 1, side: 'left', as: 'Rifleman', hp: [100, 100] } },
			others: { Raider: { away: 6, side: 'ahead', as: 'Archer', hp: [100, 100], tactic: 'hold' } },
			done: () => false,
		};
		let thinks = 0;
		await playScenario(s, model((req) => {
			if (!req.thread) {
				return 'OK';
			}
			prompts.push(req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join(' '));
			return thinks++ === 0 ? 'issue(who=units, arc=fire(target=Raider))' : 'wait(seconds=1)';
		}));
		assert.match(prompts[1], /Kell \([^)]*firing\)/);
		assert.match(prompts[1], /Raider \([^)]*shooting\)/);
	});

	it('tells no mind of a sound whose maker it sees: sight says it already', async () => {
		const prompts:string[] = [];
		const s:Scenario = {
			me: { id: 'Ash' }, goal: 'g', thinks: 2, thinkEvery: 3, seconds: 6,
			others: { Foe: { away: 3, side: 'behind', hp: [20, 20] } },
			noise: {},
			act: (w, director) => {
				if (w.time >= 1 && w.time < 1.5) {
					director.emitSound('Foe', { name: 'footsteps', loudness: 0.8 });
					director.emitSound(w.getPose('Foe')!.point.map((v) => v + 2), { name: 'a twig snapping', loudness: 0.8 });
				}
			},
			done: () => false,
		};
		await playScenario(s, model((req) => {
			if (req.thread) {
				prompts.push(req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join(' '));
			}
			return req.thread ? 'wait(seconds=1)' : 'OK';
		}));
		assert.doesNotMatch(prompts[1], /You hear footsteps/, 'Foe is in sight');
		assert.match(prompts[1], /You hear a twig snapping/, 'nothing seen made it');
	});

	it('lets a reaction set up ahead fire on a sound heard since the last think', async () => {
		let made = false;
		const s:Scenario = {
			me: { id: 'Ash' }, goal: 'g', thinks: 1, seconds: 5,
			others: { Foe: { away: 4, side: 'behind', hp: [20, 20] } },
			things: { Rock: { away: 3, side: 'left' } },
			noise: {},
			act: (w, director) => {
				if (w.time >= 1 && !made) {
					made = true;
					director.emitSound(w.getPose('Foe')!.point, { name: 'footsteps', loudness: 0.8 });
				}
			},
			done: () => false,
		};
		// An event stays in `events` until the mind thinks again, so the reaction is one that may run more than once.
		const hid = (await playScenario(s, scripted('when(watch=some(events.filter("sound")), arc=go_to(Rock)) ; wait(seconds=4)'), { judge: (w) => w.near('Ash', 'Rock') })).judged;
		assert.equal(hid, true);
		const still = (await playScenario({ ...s, act: () => undefined }, scripted('when(watch=some(events.filter("sound")), arc=go_to(Rock)) ; wait(seconds=4)'), { judge: (w) => w.near('Ash', 'Rock') })).judged;
		assert.equal(still, false, 'no sound, no reaction');
	});

	it('places a thing that comes during play, and lets its rules change what a blow deals', async () => {
		const w = new SceneWorld({ me: { id: 'Ash' }, goal: 'g', others: { Bo: { away: 2, side: 'left', hp: [20, 20] } } });
		w.addThing('Box1', 'Bo', { carrying: ['Armor'], description: 'the box Bo left' });
		assert.ok(w.sight('Ash').objects.some((o) => o.id === 'Box1'), 'seen');
		assert.equal(w.count('Box1', 'Armor'), 1);
		assert.equal(w.getDescription('Ash', 'Box1'), 'the box Bo left');
		const s:Scenario = {
			me: { id: 'Ash', as: 'Archer' }, goal: 'g', thinks: 1, seconds: 3,
			others: { Dummy: { away: 5, side: 'ahead', hp: [100, 100] } },
			damage: (_w, _by, _target, d) => d * 2,
			done: () => false,
		};
		const left = (await playScenario(s, scripted('shoot(target=Dummy)'), { judge: (w2) => w2.hp('Dummy') })).judged;
		assert.equal(100 - left!, 20, 'two shots of 5, doubled');
	});

	it('brings a fallen fighter back, as an inn or a revive would', () => {
		const w = new SceneWorld({ me: { id: 'Ash' }, goal: 'g', others: { Bo: { away: 2, side: 'left', hp: [20, 20] } } });
		w.hurt('Bo', 50);
		assert.equal(w.isDown('Bo'), true);
		w.revive('Bo', 5);
		assert.deepEqual([w.isDown('Bo'), w.hp('Bo')], [false, 5]);
	});

	it('lets a squad of two count four foes in a watch: its lists hold more than its own members', async () => {
		const s:Scenario = {
			me: { id: 'Cap' }, goal: 'g', thinks: 1, seconds: 3,
			squad: { A: { away: 1, side: 'left', as: 'Blade' } },
			others: Object.fromEntries(['F1', 'F2', 'F3', 'F4'].map((id, i) => [id, { away: 12 + i, side: 'ahead' as const, hp: [20, 20] as [number, number] }])),
			things: { Rock: { away: 2, side: 'behind' } },
			done: () => false,
		};
		const hid = (await playScenario(s, scripted('when(watch=count(others.filter(u => u.foe)) >= 4, arc=go_to(Rock)) ; wait(seconds=3)'), { judge: (w) => w.near('Cap', 'Rock') })).judged;
		assert.equal(hid, true);
	});

	it('cuts a verb that ends later short for a reaction, aborting its work, and runs it again from the start after', async () => {
		let cancelled = 0;
		let hit = false;
		const kneels:{ until:number; done:(text:string)=>void }[] = [];
		const s:Scenario = {
			me: { id: 'Ash', hp: [10, 10] }, goal: 'g', thinks: 1, seconds: 12,
			things: { Flag: { away: 3, side: 'left' } },
			verbs: {
				kneel: {
					help: 'kneel for 3 seconds',
					run: (w, { signal }) => new Promise((done) => {
						const kneel = { until: w.time + 3, done };
						kneels.push(kneel);
						signal.addEventListener('abort', () => {
							cancelled += 1;
							kneels.splice(kneels.indexOf(kneel), 1);
						});
					}),
				},
				patch: { help: 'heals you', run: (w, { who }) => (w.mend(who, 10), 'patched') },
			},
			act: (w) => {
				if (w.time >= 1 && !hit) {
					hit = true;
					w.hurt('Ash', 2);
				}
				for (const kneel of kneels.filter((k) => w.time >= k.until)) {
					kneels.splice(kneels.indexOf(kneel), 1);
					kneel.done('knelt');
				}
			},
			done: (w) => w.near('Ash', 'Flag'),
		};
		const end = await playScenario(s, scripted('when(watch=isHurt(me), arc=patch()) ; kneel() && go_to(Flag)'));
		assert.equal(cancelled, 1, 'the hit cut the kneel short, and its work stopped');
		assert.equal(end.done, true, 'knelt again in full, then went on');
		assert.ok(end.at >= 4, `the second kneel took its whole 3 s (${end.at})`);
	});

	it('tells the fallen apart from the gone: off the roster and out of units, and a walk to one ends "down"', async () => {
		const prompts:string[] = [];
		let struck = false;
		const s:Scenario = {
			me: { id: 'Cap' }, goal: 'g', thinks: 2, seconds: 20,
			squad: { A: { away: 1, side: 'left', as: 'Blade' }, B: { away: 1, side: 'right', as: 'Blade' } },
			others: { Foe: { away: 12, side: 'ahead', hp: [20, 20] } },
			act: (w) => {
				if (w.time >= 1 && !struck) {
					struck = true;
					w.hurt('B', 100);
					w.hurt('Foe', 100);
				}
			},
			done: () => false,
		};
		let thinks = 0;
		const { judged: listed } = await playScenario(s, model((req) => {
			if (!req.thread) {
				return 'OK';
			}
			prompts.push(req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join(' '));
			return thinks++ === 0 ? 'go_to(Foe)' : 'issue(who=units, arc=say(text=Here.))';
		}), { judge: (w) => w.isDown('B') });
		assert.equal(listed, true);
		assert.match(prompts[0], /^\| B \|/m, 'standing at first');
		assert.match(prompts[0], /^\| A \| Blade \| \d+\/\d+ \|/m, 'with its health');
		assert.match(prompts[0], /^\| A \|[^\n]*\| Foe 20\/20 hp \d+ paces \|/m, 'and who it sees, with theirs');
		assert.match(prompts[0], /a law reaches you too only with who=allUnits/, 'its commander is told how its own laws reach it');
		assert.doesNotMatch(prompts[1], /^\| B \|/m, 'off the roster once down');
		assert.match(prompts[1], /Down: B/);
		assert.match(prompts[1], /Foe is down/);
		assert.doesNotMatch(prompts[1], /is gone/);
	});
});
