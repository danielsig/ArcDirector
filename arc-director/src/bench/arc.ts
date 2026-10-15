import { STOCK_TRADE_VERBS, STOCK_VERBS } from '../arc/stock-verbs.js';
import type { ArcResult } from '../arc/types.js';
import { ArcDirector } from '../director/director.js';
import type { MemoryDraft } from '../memory/store.js';
import type { KnowledgeEntry } from '../mind/knowledge.js';
import type { Offer } from '../world/offers.js';
import { FIGHT_VERBS, SceneWorld, type BenchScene, type SceneRules } from './scene.js';
import { runBench, type BenchLevel, type BenchScore, type Timer } from './score.js';

/** What a director staging a scene knows of each character: who it is. */
export type SceneCtx = { id:string };

/**
 * One moment with a goal to reach, as a scene. The bench stages it in a real director and plays it as the game would:
 * its character's mind thinks, the arc plays out in the scene's {@link SceneWorld}, and the mind thinks again on how
 * that went while the goal is not reached, a few times at most. Then `done` decides: any arcs that get there are
 * right. Its level: 1 one obvious deed, 2 a fact in the scene decides the deeds,
 * 3 the deeds take several facts at once.
 */
export type ArcCase = BenchScene & SceneRules & {
	skill:string;
	level:BenchLevel;
	/** What `me` is, in its persona. */
	role?:string;
	/** What it remembers, as a persona spec's memories. */
	memories?:MemoryDraft[];
	/** What the world knows: `recall` finds these, not the prompt. */
	know?:KnowledgeEntry[];
	/** Lines said to `me` just before it thinks. */
	heard?:{ from:string; text:string }[];
	/** How its last arc ended. */
	last?:ArcResult;
	/** What the others do, every tick while the arc runs. */
	act?:(world:SceneWorld, director:ArcDirector<SceneCtx>)=>void;
	/** Whether the goal was reached, once the arc ended or time ran out. */
	done:(world:SceneWorld)=>boolean;
	/** Thinks it gets. Default {@link THINKS}. */
	thinks?:number;
	/** Seconds of play it gets. Default {@link PLAY_SECONDS}. */
	seconds?:number;
};

/** {@link ARC_BENCH}'s version. Raised whenever a case or how cases are played changes, so only scores of one version compare. */
export const ARC_BENCH_VERSION = 1;

/** `maker` takes the first offer made to them, near enough to trade, that `fair` approves. */
function accept(w:SceneWorld, director:ArcDirector<SceneCtx>, maker:string, fair:(offer:Offer)=>boolean):void {
	const offer = director.offers.all.find((o) => o.to === maker && w.near(maker, o.from, 4) && fair(o));
	if (offer && w.exchange({ character: maker, other: offer.from, give: offer.get, get: offer.give }).ok) {
		director.offers.prune((o) => o !== offer);
	}
}

/**
 * Goals as the game's scenes set them, from easy to hard: chaining deeds, trading, dealing with people, fighting, and
 * looking up what no prompt shows. Things past the sight radius (24) are out of sight: only the map shows them.
 */
export const ARC_BENCH:ArcCase[] = [
	{
		skill: 'chain',
		level: 1,
		me: { id: 'Ren' },
		things: { RedKey: { away: 3, side: 'left' }, VaultDoor: { away: 6, side: 'ahead' } },
		goal: 'Open the VaultDoor with the RedKey',
		uses: { 'RedKey>VaultDoor': (w) => (w.flags.add('VaultDoor open'), 'the VaultDoor swings open') },
		done: (w) => w.flags.has('VaultDoor open'),
	},
	{
		skill: 'trade',
		level: 1,
		me: { id: 'Mia' },
		gold: 10,
		others: { Baker: { away: 2, side: 'ahead', carrying: ['Loaf', 'Loaf', 'Loaf'], offers: [{ give: { Loaf: 1 }, get: { gold: 5 } }] } },
		goal: 'Buy one Loaf from the Baker',
		done: (w) => w.holds('Mia', 'Loaf') && w.count('Mia', 'gold') >= 5,
	},
	{
		skill: 'social',
		level: 1,
		me: { id: 'Rook' },
		role: 'Gate guard',
		others: { Wren: { away: 3, side: 'ahead' } },
		heard: [{ from: 'Wren', text: 'Hello there! What is your name?' }],
		goal: 'Be friendly to everyone you meet',
		done: (w) => w.heard('Wren', 'Rook'),
	},
	{
		skill: 'social',
		level: 1,
		me: { id: 'Lin' },
		others: { Player: { away: 3, side: 'ahead' } },
		things: { Well: { away: 30, side: 'behind' } },
		heard: [{ from: 'Player', text: 'Follow me, I will show you the old Well.' }],
		goal: 'Do what the Player asks',
		act: (w) => w.time > 1 && w.walk('Player', 'Well', 1.5),
		done: (w) => w.near('Player', 'Well') && w.near('Lin', 'Player', 5),
	},
	{
		skill: 'fight',
		level: 1,
		me: { id: 'Ash', hp: [12, 12] },
		role: 'Archer',
		others: { EnemyHealer: { away: 8, side: 'ahead', hp: [12, 12] }, EnemyBlade: { away: 5, side: 'left', hp: [20, 20] } },
		goal: 'Kill their EnemyHealer first',
		done: (w) => w.downed[0] === 'EnemyHealer',
	},
	{
		skill: 'lookup',
		level: 1,
		me: { id: 'Mia' },
		gold: 10,
		// Not the Baker of the think instructions' example, so the name cannot be guessed.
		others: { Hilda: { away: 41, side: 'left', carrying: ['Bread', 'Bread'] } },
		things: { Fountain: { away: 5, side: 'ahead' }, RedStall: { away: 40, side: 'left' } },
		goal: 'Buy some bread',
		act: (w, director) => accept(w, director, 'Hilda', (o) => o.get.Bread === 1 && (o.give.gold ?? 0) >= 2),
		done: (w) => w.holds('Mia', 'Bread'),
	},
	{
		skill: 'chain',
		level: 2,
		me: { id: 'Hob' },
		last: { ok: false, verb: 'use', reason: 'IronDoor is locked; it opens with the IronKey' },
		things: { IronKey: { away: 5, side: 'right' }, IronDoor: { away: 2, side: 'ahead' } },
		goal: 'Get through the IronDoor',
		uses: { 'IronKey>IronDoor': (w) => (w.flags.add('IronDoor open'), 'the IronDoor unlocks') },
		done: (w) => w.flags.has('IronDoor open'),
	},
	{
		skill: 'trade',
		level: 2,
		me: { id: 'Tam' },
		carrying: ['Egg', 'Egg', 'Egg'],
		others: { Grocer: { away: 2, side: 'ahead', gold: 20, offers: [{ give: { gold: 2 }, get: { Egg: 1 } }] } },
		goal: 'Sell all your Eggs to the Grocer',
		done: (w) => w.count('Tam', 'Egg') === 0 && w.count('Tam', 'gold') === 6,
	},
	{
		skill: 'social',
		level: 2,
		me: { id: 'Ada' },
		others: { Player: { away: 2, side: 'ahead' } },
		things: { Lantern: { away: 4, side: 'left' } },
		heard: [{ from: 'Player', text: 'Could you bring me that Lantern, please?' }],
		goal: 'Help whoever asks you',
		done: (w) => w.holds('Player', 'Lantern'),
	},
	{
		skill: 'social',
		level: 2,
		me: { id: 'Mia' },
		gold: 10,
		others: { Thief: { away: 6, side: 'ahead' }, Guard: { away: 15, side: 'behind' } },
		heard: [{ from: 'Thief', text: 'Hand over your gold, or I take it!' }],
		goal: 'Keep your gold',
		// The thief runs at her for a while, and gives up near the Guard.
		act: (w) => {
			if (w.time < 20 && !w.near('Thief', 'Guard', 5)) {
				w.walk('Thief', 'Mia', 2);
			}
			if (w.near('Thief', 'Mia')) {
				w.take('Mia', 'Thief', 'gold');
			}
		},
		done: (w) => w.count('Mia', 'gold') === 10,
	},
	{
		skill: 'fight',
		level: 2,
		me: { id: 'Cinder', hp: [3, 12] },
		role: 'Witch',
		carrying: ['HealingPotion'],
		others: { EnemyBlade: { away: 2, side: 'left', hp: [18, 20], hits: 5 } },
		goal: 'You are badly hurt. Defeat EnemyBlade, and never die',
		uses: { HealingPotion: (w) => (w.heal('Cinder'), 'your wounds close') },
		done: (w) => w.isDown('EnemyBlade') && !w.isDown('Cinder'),
	},
	{
		skill: 'lookup',
		level: 2,
		me: { id: 'Ren', hp: [3, 12] },
		know: [{ name: 'Maud', aliases: ['healer', 'heal', 'wounds', 'hurt'], text: 'Maud the healer mends wounds for free. She lives at the Mill.' }],
		things: { Smithy: { away: 30, side: 'left' }, Mill: { away: 45, side: 'behind' } },
		goal: 'You are badly hurt. Get healed',
		act: (w) => w.near('Ren', 'Mill') && w.heal('Ren'),
		done: (w) => w.hp('Ren') === 12,
	},
	{
		skill: 'chain',
		level: 3,
		me: { id: 'Kip' },
		carrying: ['Flint'],
		last: { ok: false, verb: 'pick_up', reason: 'too dark to see SilverRing' },
		things: { Torch: { away: 1, side: 'right' }, Cellar: { away: 3, side: 'ahead' }, SilverRing: { away: 3, side: 'ahead' } },
		goal: 'Fetch the SilverRing from the Cellar',
		uses: { 'Flint>Torch': (w) => (w.flags.add('lit'), 'the Torch lights the Cellar') },
		sees: (w, _from, to) => to !== 'SilverRing' || w.flags.has('lit'),
		done: (w) => w.holds('Kip', 'SilverRing'),
	},
	{
		skill: 'trade',
		level: 3,
		me: { id: 'Wil' },
		role: 'Weaver',
		carrying: ['Scarf', 'Scarf'],
		others: { Pell: { away: 2, side: 'ahead', gold: 12, offers: [{ give: { gold: 4 }, get: { Scarf: 1 } }] } },
		heard: [{ from: 'Pell', text: 'I will give you 4 gold for a Scarf.' }],
		goal: 'Sell Scarves, never for less than 6 gold each',
		// Pell offers 4, and pays up to 6 when asked.
		act: (w, director) => accept(w, director, 'Pell', (o) => o.give.Scarf === 1 && (o.get.gold ?? Infinity) <= 6),
		done: (w) => w.count('Wil', 'Scarf') === 1 && w.count('Wil', 'gold') === 6,
	},
	{
		skill: 'social',
		level: 3,
		me: { id: 'Ned' },
		role: 'Messenger',
		others: { Captain: { away: 2, side: 'ahead' }, Smith: { away: 20, side: 'right' } },
		heard: [{ from: 'Captain', text: 'Go tell the Smith I need 3 Swords by dusk.' }],
		goal: 'Carry messages for the Captain',
		done: (w) => w.heard('Smith', 'Swords'),
	},
	{
		skill: 'social',
		level: 3,
		me: { id: 'Bo' },
		gold: 5,
		others: {
			Player: { away: 2, side: 'ahead' },
			Smith: { away: 15, side: 'right', carrying: ['Sword'], offers: [{ give: { Sword: 1 }, get: { gold: 5 } }] },
		},
		heard: [{ from: 'Player', text: 'I gave you 5 gold. Buy me a Sword from the Smith and bring it here, please.' }],
		goal: 'Help whoever asks you',
		done: (w) => w.holds('Player', 'Sword'),
	},
	{
		// The glen: what the Forager wants is across a river, behind a bridge only a paid BridgeKeeper lowers.
		skill: 'social',
		level: 3,
		me: { id: 'Forager' },
		gold: 5,
		memories: [
			{ text: 'I am a glen forager. I harvest mushrooms for a living, mostly among the trees west of Cottage.', tags: ['backstory', 'mushroom', 'trees'], pinned: true },
			{ text: 'BridgeKeeper can lower and raise the bridge crossing the river.', tags: ['BridgeKeeper', 'Bridge', 'river'] },
			{ text: 'FireMushroom grows among the trees west of Cottage, outdoors.', tags: ['FireMushroom', 'trees', 'harvest', 'mushroom'] },
			{ text: 'Angler is the only one who sells SilverTrout as far as I know.', tags: ['Angler', 'SilverTrout'] },
			{ text: 'I last saw Angler on the other side of the river.', tags: ['Angler', 'river'] },
		],
		others: {
			BridgeKeeper: { away: 8, side: 'ahead' },
			Angler: { away: 30, side: 'ahead', carrying: ['SilverTrout', 'SilverTrout'], offers: [{ give: { SilverTrout: 1 }, get: { gold: 5 } }] },
		},
		things: {
			Bridge: { away: 12, side: 'ahead' },
			Cottage: { away: 10, side: 'left' },
			OakA: { away: 25, side: 'left' },
			OakB: { away: 26, side: 'left' },
			FireMushroom: { away: 27, side: 'left' },
		},
		goal: 'Buy SilverTrout, unless you already have one.',
		thinks: 8,
		seconds: 240,
		blocks: (w, [, z]) => (z <= -10 && z >= -14 && !w.flags.has('Bridge down') ? 'Bridge is raised' : undefined),
		// The BridgeKeeper names the fee to whoever speaks to him, and lowers the bridge once he holds it.
		act: (w, director) => {
			const tell = (text:string) => w.near('BridgeKeeper', 'Forager', 12) && director.talk!.say('BridgeKeeper', text, 'Forager');
			if (!w.flags.has('Bridge down') && (w.holds('BridgeKeeper', 'FireMushroom') || w.count('BridgeKeeper', 'gold') >= 10)) {
				w.flags.add('Bridge down');
				tell('Paid in full. The bridge is down; cross.');
			}
			for (const [i, line] of w.said.entries()) {
				if (line.speakerID === 'Forager' && line.heardBy.includes('BridgeKeeper') && !w.flags.has(`answered ${i}`)) {
					w.flags.add(`answered ${i}`);
					tell(w.flags.has('Bridge down') ? 'The bridge is down; cross.' : 'Lowering the bridge costs 10 gold, or one FireMushroom. Give it to me and I lower it.');
				}
			}
		},
		done: (w) => w.holds('Forager', 'SilverTrout'),
	},
	{
		skill: 'fight',
		level: 3,
		me: { id: 'Wisp', hp: [9, 12] },
		role: 'Archer',
		last: { ok: false, verb: 'shoot', reason: 'no line of sight to EnemyWitch' },
		others: { EnemyWitch: { away: 9, side: 'ahead', hp: [4, 12] }, EnemyKnight: { away: 3, side: 'left', hp: [20, 28] } },
		things: { Boulder: { away: 4, side: 'right' } },
		goal: 'Kill EnemyWitch. From the Boulder you can see past the cover',
		sees: (w, from, to) => to !== 'EnemyWitch' || w.near(from, 'Boulder'),
		done: (w) => w.isDown('EnemyWitch'),
	},
	{
		skill: 'lookup',
		level: 3,
		me: { id: 'Pip' },
		others: { Witch: { away: 3, side: 'ahead' } },
		things: { Emberkap: { away: 40, side: 'left' }, OldOak: { away: 41, side: 'left' } },
		know: [{ name: 'Emberkap', text: 'A glowing red mushroom. It grows by the OldOak in the woods.' }],
		heard: [{ from: 'Witch', text: 'Fetch me one of those glowing red mushrooms from the woods, dear.' }],
		goal: 'Help whoever asks you',
		done: (w) => w.holds('Witch', 'Emberkap'),
	},
];

/** How far apart two characters may stand and still talk. */
const TALK_RANGE = 12;
/** Seconds of play a case gets to reach its goal, over all its thinks. */
const PLAY_SECONDS = 60;
/** Thinks a case gets: the first, and one more after each arc that fell short. */
const THINKS = 3;
/** Seconds the others get to answer once the arc ends: a trade it offered, a word it said. */
const SETTLE_SECONDS = 3;
/** Seconds a tick. */
const TICK = 0.5;

/** One turn of the event loop, so the steps a tick woke can run before the next. */
function nextTurn():Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

/** `c` staged in `director`: its world, sight, map, knowledge and characters. Only `me` thinks, and only when asked. */
function stage(director:ArcDirector<SceneCtx>, c:ArcCase, world:SceneWorld):ArcDirector<SceneCtx> {
	for (const [name, def] of Object.entries(FIGHT_VERBS)) {
		director.addVerb(name, { ...def, handler: (call) => world.attack(call) });
	}
	for (const [id, spot] of Object.entries(c.others ?? {})) {
		director.addCharacter({ id, offers: spot.offers });
	}
	return director
		.addStockVerbs()
		.withCurrency('gold')
		.withPriorityQueue({ mayThink: () => false })
		.withWorld(world)
		.withKernels(({ id }) => world.kernels(id))
		.withSight({ look: ({ id }) => world.sight(id) })
		.withInventory(({ id }) => world.inventory(id))
		.withTalk({
			inRange: (a, b) => world.distance(a, b) <= TALK_RANGE,
			others: (id) => world.characters.filter((other) => other !== id),
		}, (line) => world.said.push(line))
		.withMap(world.map())
		.withKnowledge(c.know ?? [])
		.withContext((id) => (world.find(id) === id ? { id } : undefined))
		.withDefaultKit({ verbs: [...STOCK_VERBS, ...STOCK_TRADE_VERBS, ...Object.keys(FIGHT_VERBS)] })
		.addCharacter({
			id: c.me.id,
			mind: { skipStart: true, skipHeartbeat: true, skipMajor: true, skipStrategic: true },
			identity: c.role ? { role: c.role } : undefined,
			goals: [{ text: c.goal }],
			memories: c.memories,
		});
}

/**
 * `c` played as in the game, in a fresh director `models` set up: `me` thinks (timed), its arc plays out, and while
 * the goal is not reached it thinks again on how that went, up to its {@link ArcCase.thinks} in its {@link ArcCase.seconds}.
 * Right when the goal was reached.
 */
async function playOut(c:ArcCase, models:(director:ArcDirector<SceneCtx>)=>unknown, time:Timer):Promise<boolean> {
	const world = new SceneWorld(c, c);
	const director = new ArcDirector<SceneCtx>();
	models(director);
	stage(director, c, world);
	try {
		await director.start();
		const character = director.character(c.me.id)!;
		const mind = character.mind!;
		if (c.last) {
			mind.ingestResult(c.last);
		}
		for (const { from, text } of c.heard ?? []) {
			director.talk!.say(from, text, c.me.id);
		}
		const seconds = c.seconds ?? PLAY_SECONDS;
		for (let thinks = 0; thinks < (c.thinks ?? THINKS) && world.time < seconds && !world.isDown(c.me.id); thinks++) {
			const arc = await time(mind.thinkNow({ now: world.time, enact: false }));
			if (!arc) {
				throw new Error('the think wrote no arc');
			}
			await play(director, c, world, character.enact(arc), seconds);
			if (c.done(world)) {
				return true;
			}
		}
		return false;
	}
	finally {
		director.dispose();
	}
}

/** Ticks `world` and `director` until `run` ends and the others had {@link SETTLE_SECONDS} to answer, or play time is up at `seconds`. */
async function play(director:ArcDirector<SceneCtx>, c:ArcCase, world:SceneWorld, run:Promise<ArcResult>, seconds:number):Promise<void> {
	let end = seconds;
	void run.catch(() => undefined).finally(() => {
		end = Math.min(end, world.time + SETTLE_SECONDS);
	});
	while (world.time < end) {
		world.step(TICK);
		c.act?.(world, director);
		director.tick(TICK, world.time);
		await nextTurn();
	}
}

/**
 * How well a model writes arcs that reach their goals: each case once, played in a fresh director, and timed by the
 * model's thinks alone. `models` adds the model to bench to that director, as a host adds it for play (`addModel`,
 * `withArcFormat`, `withRepair`, …); the bench adds the scene. A think that throws or writes no arc fails. `onArc` reports progress as
 * {@link runBench} does.
 */
export function benchArcs(
	models:(director:ArcDirector<SceneCtx>)=>unknown,
	cases:ArcCase[] = ARC_BENCH,
	onArc?:(done:number, total:number)=>void,
):Promise<BenchScore> {
	return runBench(cases.map((c) => ({ skill: c.skill, level: c.level, run: (time) => playOut(c, models, time) })), onArc);
}
