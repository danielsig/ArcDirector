import { parseArcText } from '../arc/parse.js';
import { VerbRegistry, registerStockVerbs } from '../arc/stock-verbs.js';
import type { LastChoice } from '../arc/run.js';
import type { SystemOne } from '../inference/systemone.js';
import { choicePrompt, type ChoicePrompt } from '../character/choice.js';
import { FIGHT_VERBS } from '../scenario/combat.js';
import { sceneCatalog, type Scene } from '../scenario/world.js';
import { runBench, type BenchLevel, type BenchOpts, type BenchScore } from './score.js';

/**
 * One decision, its choices rated, as a scene. The bench asks it through {@link choicePrompt}, so a System
 * One reads exactly what the director would write for that scene. Its level: 1 the goal's words point at the answer,
 * 2 a fact in the state decides it, 3 two facts beat a tempting name.
 */
export type DecisionCase = Scene & {
	skill:string;
	level:BenchLevel;
	/** The verb running before this `choose`. */
	doing:string;
	last?:LastChoice;
	/** Choice name to its arc, as an author writes it. */
	choices:Record<string, string>;
	/**
	 * How good each choice is, 0 to 1: 1 for the best, between for one that still helps (a free kill one cast before
	 * the target asked for), 0 for one that fails or does harm. Every choice is rated.
	 */
	ratings:Record<string, number>;
};

/** {@link DECISION_BENCH}'s version. Raised whenever a case or how cases are asked changes, so only scores of one version compare. */
export const DECISION_BENCH_VERSION = 2;

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
		ratings: { finish: 1, nearest: 0.2 },
	},
	{
		skill: 'survival',
		level: 1,
		me: { id: 'Brune', hp: [3, 28] },
		doing: 'cleave',
		others: { EnemyBlade: { away: 1, side: 'ahead', hp: [20, 20] }, Dawn: { away: 6, side: 'behind', hp: [12, 12] } },
		goal: 'Stay alive: fall back to Dawn, your Healer, when badly hurt, else fight',
		choices: { fight: 'cleave(EnemyBlade)', retreat: 'go_to(Dawn)' },
		ratings: { retreat: 1, fight: 0 },
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
		ratings: { chase: 1, hold: 0 },
	},
	{
		skill: 'puzzle',
		level: 1,
		me: { id: 'Ren', hp: [10, 10] },
		doing: 'examine',
		things: { BlueKey: { away: 2, side: 'left' }, RedKey: { away: 9, side: 'ahead' }, VaultDoor: { away: 5, side: 'ahead' } },
		goal: 'Open the VaultDoor. Its lock is red',
		choices: { near_key: 'pick_up(BlueKey) && use(BlueKey, VaultDoor)', far_key: 'pick_up(RedKey) && use(RedKey, VaultDoor)' },
		ratings: { far_key: 1, near_key: 0 },
	},
	{
		skill: 'tactics',
		level: 2,
		me: { id: 'Brune', hp: [26, 28] },
		doing: 'cleave',
		others: { EnemyBlade: { away: 2, side: 'ahead', hp: [20, 20] }, Wisp: { away: 7, side: 'behind', hp: [3, 12] } },
		goal: 'Hold the line: hit the nearest, unless an ally is badly hurt; then guard them',
		choices: { nearest: 'cleave(EnemyBlade)', guard: 'protect(Wisp)' },
		ratings: { guard: 1, nearest: 0.3 },
	},
	{
		skill: 'tactics',
		level: 2,
		me: { id: 'Cinder', hp: [12, 12] },
		doing: 'hex',
		others: { EnemyHealer: { away: 7, side: 'ahead', hp: [12, 12] }, EnemyBlade: { away: 3, side: 'left', hp: [1, 20] } },
		goal: 'Kill their Healer first',
		choices: { focus: 'hex(EnemyHealer)', finish: 'hex(EnemyBlade)' },
		// The goal is bait: the Blade dies to one hex, a sure kill that costs one cast, so it comes first and the Healer next.
		ratings: { finish: 1, focus: 0.7 },
	},
	{
		skill: 'survival',
		level: 2,
		me: { id: 'Wisp', hp: [12, 12] },
		doing: 'shoot',
		others: { Dawn: { away: 9, side: 'behind', hp: [12, 12] }, EnemyWitch: { away: 9, side: 'ahead', hp: [6, 12] } },
		goal: 'Stay alive: fall back to Dawn, your Healer, when badly hurt, else fight',
		choices: { retreat: 'go_to(Dawn)', fight: 'shoot(EnemyWitch)' },
		ratings: { fight: 1, retreat: 0.2 },
	},
	{
		skill: 'social',
		level: 2,
		me: { id: 'Mia', hp: [10, 10] },
		doing: 'offer',
		last: { name: 'shop', result: { ok: true, reason: 'traded 5 gold for Loaf with Baker' } },
		others: { Baker: { away: 2, side: 'ahead' } },
		things: { WestGate: { away: 24, side: 'behind' } },
		goal: 'Buy a Loaf at the BakerStall, then leave by WestGate',
		choices: { shop: 'offer(to=Baker, give={"gold":5}, get={"Loaf":1})', leave: 'go_to(WestGate)' },
		ratings: { leave: 1, shop: 0.1 },
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
		ratings: { pull_right: 1, pull_left: 0 },
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
		ratings: { flank: 1, nearest: 0.4, finish: 0 },
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
		ratings: { drink: 1, fight: 0.1, retreat: 0 },
	},
	{
		skill: 'social',
		level: 3,
		me: { id: 'Pell', hp: [10, 10] },
		doing: 'offer',
		last: { name: 'shop', result: { ok: true, reason: 'traded 6 gold for Scarf with Weaver' } },
		others: { Weaver: { away: 1, side: 'ahead' } },
		things: { WestGate: { away: 6, side: 'left' }, EastGate: { away: 30, side: 'behind' } },
		goal: 'Buy a Scarf at the WeaverStall, then go home by EastGate',
		choices: { shop: 'offer(to=Weaver, give={"gold":6}, get={"Scarf":1})', leave: 'go_to(WestGate)', home: 'go_to(EastGate)' },
		ratings: { home: 1, leave: 0.1, shop: 0 },
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
		ratings: { wait_turn: 1, cross: 0 },
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
		ratings: { light: 1, search: 0 },
	},
];

/** The stock verbs and the 5v5 fight's attacks, which the cases' choices use. */
const VERBS = Object.entries(FIGHT_VERBS).reduce((verbs, [name, def]) => verbs.add(name, def), registerStockVerbs(new VerbRegistry()));

/** What a System One reads for `c`: its scene in a catalog, worded by {@link choicePrompt}. */
function decisionPrompt(c:DecisionCase):ChoicePrompt {
	const choices = Object.fromEntries(Object.entries(c.choices).map(([name, arc]) => [name, parseArcText(arc, VERBS)]));
	const prompt = choicePrompt({ id: c.me.id, verb: c.doing, last: c.last, catalog: sceneCatalog(c), choices, verbs: VERBS });
	if (!prompt) {
		throw new Error(`decision case for ${c.me.id}: no choice can run`);
	}
	return prompt;
}

/**
 * How well `systemOne` decides: each case asked in both choice orders, and rated by the worse of the two picks'
 * ratings, so a model that favors a slot scores only its worst choice's. A case is a success when both picks are rated
 * 1, harmful when one is rated 0, neutral between. A pick that names no choice fails. `onTrial` reports progress as
 * {@link runBench} does.
 */
export function benchSystemOne(
	systemOne:SystemOne,
	cases:DecisionCase[] = DECISION_BENCH,
	{ onTrial, repeats, quick }:Pick<BenchOpts, 'onTrial' | 'repeats' | 'quick'> = {},
):Promise<BenchScore> {
	return runBench(cases.map((c, i) => {
		const { state, criteria } = decisionPrompt(c);
		const orders = [Object.entries(criteria), Object.entries(criteria).reverse()];
		return {
			name: `${i} ${c.me.id}`,
			skill: c.skill,
			level: c.level,
			run: async (time) => {
				let score = 1;
				for (const order of orders) {
					const picked = await time(systemOne.pick(state, c.goal, Object.fromEntries(order)));
					if (!Object.hasOwn(criteria, picked)) {
						throw new Error(`picked ${picked || 'nothing'}, not a choice`);
					}
					score = Math.min(score, c.ratings[picked] ?? 0);
				}
				return { outcome: score >= 1 ? 'success' : score > 0 ? 'neutral' : 'harmful', score };
			},
		};
	}), { onTrial, repeats, quick });
}
