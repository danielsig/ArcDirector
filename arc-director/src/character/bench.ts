import { parseArcText } from '../arc/parse.js';
import { VerbRegistry, registerStockVerbs } from '../arc/stock-verbs.js';
import type { LastChoice } from '../arc/run.js';
import { buildCatalog, dummyEntity } from '../expr/natives.js';
import { SampleCache, type ExprEntity } from '../expr/types.js';
import type { SystemOne } from '../inference/systemone.js';
import { choicePrompt, type ChoicePrompt } from './choice.js';

/** How hard a case is: 1 the goal's words point at it, 2 a fact in the state decides it, 3 two facts beat a tempting name. */
export type DecisionLevel = 1 | 2 | 3;

/** Where someone or something is, seen from the one choosing. */
export type DecisionSpot = { away:number; side:'ahead' | 'behind' | 'left' | 'right'; hp?:[number, number] };

/**
 * One decision with a known best choice, as a scene. The bench asks it through {@link choicePrompt}, so a System
 * One reads exactly what the director would write for that scene.
 */
export type DecisionCase = {
	skill:string;
	level:DecisionLevel;
	/** Who chooses. */
	me:{ id:string; hp:[number, number] };
	/** The verb running before this `choose`. */
	doing:string;
	last?:LastChoice;
	/** Characters around, by name. */
	others?:Record<string, DecisionSpot>;
	/** Things and places around, by name. */
	things?:Record<string, DecisionSpot>;
	/** What the one choosing carries. */
	carrying?:string[];
	goal:string;
	/** Choice name to its arc, as an author writes it. */
	choices:Record<string, string>;
	answer:string;
};

export type SkillScore = { right:number; total:number };

export type BenchScore = {
	/** Right answers per skill, each case asked in both choice orders. */
	skills:Record<string, SkillScore>;
	/** Right answers per {@link DecisionLevel}. */
	levels:Record<DecisionLevel, SkillScore>;
	/** Mean wall time of one pick. */
	msPerPick:number;
	/** Picks that threw or named no choice. */
	failed:number;
	/** The last pick's error, when one threw. */
	error?:string;
};

/**
 * Decisions as the 5v5 fight and the marketplace really ask them, from easy to hard. Choice names are the kind an
 * author gives, so a hard case's tempting name is a real trap.
 */
export const DECISION_BENCH:DecisionCase[] = [
	{
		skill: 'tactics',
		level: 1,
		me: { id: 'Ash', hp: [12, 12] },
		doing: 'shoot',
		others: { EnemyHealer: { away: 8, side: 'ahead', hp: [2, 12] }, EnemyBlade: { away: 4, side: 'left', hp: [17, 20] } },
		goal: 'Kill fast: finish the lowest hp in reach',
		choices: { finish: 'shoot(EnemyHealer)', nearest: 'shoot(EnemyBlade)' },
		answer: 'finish',
	},
	{
		skill: 'survival',
		level: 1,
		me: { id: 'Brune', hp: [3, 28] },
		doing: 'cleave',
		others: { EnemyBlade: { away: 1, side: 'ahead', hp: [20, 20] }, Dawn: { away: 6, side: 'behind', hp: [12, 12] } },
		goal: 'Stay alive: fall back to Dawn, your Healer, when badly hurt, else fight',
		choices: { fight: 'cleave(EnemyBlade)', retreat: 'go_to(Dawn)' },
		answer: 'retreat',
	},
	{
		skill: 'social',
		level: 1,
		me: { id: 'Rook', hp: [10, 10] },
		doing: 'wait',
		others: { Wren: { away: 6, side: 'ahead' } },
		things: { EastGate: { away: 3, side: 'behind' } },
		goal: 'Catch thieves by walking up to them; hold EastGate only while you see none. Wren stole a Loaf',
		choices: { hold: 'go_to(EastGate) && wait()', chase: 'go_to(Wren)' },
		answer: 'chase',
	},
	{
		skill: 'puzzle',
		level: 1,
		me: { id: 'Ren', hp: [10, 10] },
		doing: 'examine',
		things: { BlueKey: { away: 2, side: 'left' }, RedKey: { away: 9, side: 'ahead' }, VaultDoor: { away: 5, side: 'ahead' } },
		goal: 'Open the VaultDoor. Its lock is red',
		choices: { near_key: 'pick_up(BlueKey) && use(BlueKey, VaultDoor)', far_key: 'pick_up(RedKey) && use(RedKey, VaultDoor)' },
		answer: 'far_key',
	},
	{
		skill: 'tactics',
		level: 2,
		me: { id: 'Brune', hp: [26, 28] },
		doing: 'cleave',
		others: { EnemyBlade: { away: 2, side: 'ahead', hp: [20, 20] }, Wisp: { away: 7, side: 'behind', hp: [3, 12] } },
		goal: 'Hold the line: hit the nearest, unless an ally is badly hurt; then guard them',
		choices: { nearest: 'cleave(EnemyBlade)', guard: 'protect(Wisp)' },
		answer: 'guard',
	},
	{
		skill: 'tactics',
		level: 2,
		me: { id: 'Cinder', hp: [12, 12] },
		doing: 'hex',
		others: { EnemyHealer: { away: 7, side: 'ahead', hp: [12, 12] }, EnemyBlade: { away: 3, side: 'left', hp: [1, 20] } },
		goal: 'Kill their Healer first',
		choices: { focus: 'hex(EnemyHealer)', finish: 'hex(EnemyBlade)' },
		answer: 'focus',
	},
	{
		skill: 'survival',
		level: 2,
		me: { id: 'Wisp', hp: [12, 12] },
		doing: 'shoot',
		others: { Dawn: { away: 9, side: 'behind', hp: [12, 12] }, EnemyWitch: { away: 9, side: 'ahead', hp: [6, 12] } },
		goal: 'Stay alive: fall back to Dawn, your Healer, when badly hurt, else fight',
		choices: { retreat: 'go_to(Dawn)', fight: 'shoot(EnemyWitch)' },
		answer: 'fight',
	},
	{
		skill: 'social',
		level: 2,
		me: { id: 'Mia', hp: [10, 10] },
		doing: 'buy',
		last: { name: 'shop', result: { ok: true, reason: 'bought Loaf' } },
		others: { Baker: { away: 2, side: 'ahead' } },
		things: { WestGate: { away: 24, side: 'behind' } },
		goal: 'Buy a Loaf at the BakerStall, then leave by WestGate',
		choices: { shop: 'buy(item=Loaf, from=Baker)', leave: 'go_to(WestGate)' },
		answer: 'leave',
	},
	{
		skill: 'puzzle',
		level: 2,
		me: { id: 'Ren', hp: [10, 10] },
		doing: 'use',
		last: { name: 'pull_left', result: { ok: false, reason: 'LeverA only drains the cistern' } },
		things: { LeverA: { away: 1, side: 'left' }, LeverB: { away: 4, side: 'right' } },
		goal: 'Open the gate',
		choices: { pull_left: 'use(LeverA)', pull_right: 'use(LeverB)' },
		answer: 'pull_right',
	},
	{
		skill: 'tactics',
		level: 3,
		me: { id: 'Wisp', hp: [9, 12] },
		doing: 'shoot',
		last: { name: 'finish', result: { ok: false, reason: 'no line of sight to EnemyWitch' } },
		others: { EnemyWitch: { away: 9, side: 'ahead', hp: [4, 12] }, EnemyKnight: { away: 3, side: 'left', hp: [20, 28] } },
		things: { Boulder: { away: 4, side: 'right' } },
		goal: 'Kill fast: finish the lowest hp in reach. When cover blocks your shot, go to the Boulder: it sees past the cover',
		choices: { finish: 'shoot(EnemyWitch)', nearest: 'shoot(EnemyKnight)', flank: 'go_to(Boulder)' },
		answer: 'flank',
	},
	{
		skill: 'survival',
		level: 3,
		me: { id: 'Cinder', hp: [4, 12] },
		doing: 'hex',
		carrying: ['HealingPotion'],
		last: { name: 'retreat', result: { ok: false, reason: 'path blocked' } },
		others: { Dusk: { away: 15, side: 'ahead', hp: [12, 12] }, EnemyBlade: { away: 2, side: 'left', hp: [18, 20] } },
		goal: 'Stay alive: when badly hurt, get healed by Dusk, your Healer, or by a potion; else fight',
		choices: { retreat: 'go_to(Dusk)', drink: 'use(HealingPotion)', fight: 'hex(EnemyBlade)' },
		answer: 'drink',
	},
	{
		skill: 'social',
		level: 3,
		me: { id: 'Pell', hp: [10, 10] },
		doing: 'buy',
		last: { name: 'shop', result: { ok: true, reason: 'bought Scarf' } },
		others: { Weaver: { away: 1, side: 'ahead' } },
		things: { WestGate: { away: 6, side: 'left' }, EastGate: { away: 30, side: 'behind' } },
		goal: 'Buy a Scarf at the WeaverStall, then go home by EastGate',
		choices: { shop: 'buy(item=Scarf, from=Weaver)', leave: 'go_to(WestGate)', home: 'go_to(EastGate)' },
		answer: 'home',
	},
	{
		skill: 'puzzle',
		level: 3,
		me: { id: 'Kip', hp: [10, 10] },
		doing: 'wait',
		last: { name: 'cross', result: { ok: false, reason: 'the bridge sways; Ana is on it' } },
		others: { Ana: { away: 4, side: 'ahead' } },
		things: { FarBank: { away: 30, side: 'ahead' } },
		goal: 'Cross the rope bridge to FarBank. It holds one person at a time',
		choices: { cross: 'go_to(FarBank)', wait_turn: 'wait(until=!(Ana is "on bridge")) && go_to(FarBank)' },
		answer: 'wait_turn',
	},
	{
		skill: 'puzzle',
		level: 3,
		me: { id: 'Kip', hp: [10, 10] },
		doing: 'go_to',
		carrying: ['Flint'],
		last: { name: 'search', result: { ok: false, reason: 'too dark to see' } },
		things: { Cellar: { away: 3, side: 'ahead' }, Torch: { away: 1, side: 'right' } },
		goal: 'Search the Cellar',
		choices: { search: 'go_to(Cellar)', light: 'use(Flint, Torch) && go_to(Cellar)' },
		answer: 'light',
	},
];

/** The stock verbs and the 5v5 fight's attacks, which the cases' choices use. */
const VERBS = ['shoot', 'cleave', 'hex', 'protect'].reduce(
	(verbs, verb) => verbs.add(verb, { args: { target: 'id' } }),
	registerStockVerbs(new VerbRegistry()),
);

/** [facing, side] of each {@link DecisionSpot} side, as the catalog's geometry kernels read them. */
const SIDES = { ahead: [1, 0], behind: [-1, 0], left: [0, -1], right: [0, 1] } as const;

/** What a System One reads for `c`: its scene in a catalog, worded by {@link choicePrompt}. */
function decisionPrompt(c:DecisionCase):ChoicePrompt {
	const spots = new Map(Object.entries({ ...c.others, ...c.things }));
	const entity = (id:string, hp?:[number, number]):ExprEntity => dummyEntity(id, hp ? {
		fields: { hp: { kind: 'number', value: hp[0] }, maxHP: { kind: 'number', value: hp[1] } },
	} : {});
	const catalog = buildCatalog({
		me: entity(c.me.id, c.me.hp),
		others: Object.entries(c.others ?? {}).map(([id, spot]) => entity(id, spot.hp)),
		items: Object.keys(c.things ?? {}).map((id) => entity(id)),
		cache: new SampleCache(),
		inventory: (who) => (who.id === c.me.id ? (c.carrying ?? []).map((id) => entity(id)) : []),
		distance: (_me, b) => spots.get(b.id)?.away,
		facing: (_me, b) => SIDES[spots.get(b.id)?.side ?? 'ahead'][0],
		side: (_me, b) => SIDES[spots.get(b.id)?.side ?? 'ahead'][1],
	});
	const choices = Object.fromEntries(Object.entries(c.choices).map(([name, arc]) => [name, parseArcText(arc, VERBS)]));
	const prompt = choicePrompt({ id: c.me.id, verb: c.doing, last: c.last, catalog, choices, verbs: VERBS });
	if (!prompt) {
		throw new Error(`decision case for ${c.me.id}: no choice can run`);
	}
	return prompt;
}

/**
 * How well `systemOne` decides: every case in both choice orders, so a model that favors a slot scores half.
 * One untimed pick goes first, so a model that must load first is timed like one already loaded. `onPick` reports
 * `(0, total)` once that warm-up is over, then progress after each scored pick.
 */
export async function benchSystemOne(
	systemOne:SystemOne,
	cases:DecisionCase[] = DECISION_BENCH,
	onPick?:(done:number, total:number)=>void,
):Promise<BenchScore> {
	const skills:Record<string, SkillScore> = {};
	const levels:Record<DecisionLevel, SkillScore> = { 1: { right: 0, total: 0 }, 2: { right: 0, total: 0 }, 3: { right: 0, total: 0 } };
	const asked = cases.map((c) => ({ ...c, ...decisionPrompt(c) }));
	const total = asked.length * 2;
	let done = 0;
	let failed = 0;
	let error:string | undefined;
	let ms = 0;
	if (asked[0]) {
		await systemOne.pick(asked[0].state, asked[0].goal, asked[0].criteria).catch(() => undefined);
	}
	onPick?.(0, total);
	for (const { skill, level, state, goal, criteria, answer } of asked) {
		for (const order of [Object.entries(criteria), Object.entries(criteria).reverse()]) {
			const score = skills[skill] ??= { right: 0, total: 0 };
			const t0 = performance.now();
			let right = 0;
			try {
				const picked = await systemOne.pick(state, goal, Object.fromEntries(order));
				right = picked === answer ? 1 : 0;
				failed += Object.hasOwn(criteria, picked) ? 0 : 1;
			}
			catch (err) {
				failed += 1;
				error = err instanceof Error ? err.message : String(err);
			}
			ms += performance.now() - t0;
			for (const tally of [score, levels[level]]) {
				tally.right += right;
				tally.total += 1;
			}
			done += 1;
			onPick?.(done, total);
		}
	}
	return { skills, levels, msPerPick: ms / total, failed, ...(error ? { error } : {}) };
}
