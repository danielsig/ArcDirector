import type { KindSpec } from '../rts/types.js';
import { acceptOffer, answerSpeech, sceneSearch } from '../scenario/play.js';
import { THEM, US, type SceneSpot, type SceneWorld } from '../scenario/world.js';
import type { ArcCase } from './arc.js';
import { everydayMemories } from './memories.js';

/** Game seconds in an hour, for when a case's memories were made. */
const HOUR = 3600;

/** How many of `kind` stand on `me`'s side. */
function unitsOf(w:SceneWorld, kind:string):number {
	return w.placed.filter((id) => w.kindOf(id) === kind && w.sideOf(id) === US).length;
}

/** `name`'s meter, or `start` before anything set it. */
function meter(w:SceneWorld, name:string, start = 0):number {
	return w.meters.get(name) ?? start;
}

/** `count` fighters of one kind named `name1`, `name2`, …, from `away` paces on `side`, a pace apart. */
function band(name:string, count:number, spot:Omit<SceneSpot, 'away'> & { away:number }):Record<string, SceneSpot> {
	return Object.fromEntries(Array.from({ length: count }, (_, i) => [`${name}${i + 1}`, { ...spot, away: spot.away + i }]));
}

/** A village's kinds: its buildings, workers, soldiers, a tech and two resources. */
const VILLAGE:Record<string, KindSpec> = {
	Hall: { provides: 5, tags: ['Building', 'DropOff:Wood', 'DropOff:Gold'] },
	House: { cost: { Wood: 50 }, seconds: 6, provides: 5, tags: ['Building'] },
	Barracks: { cost: { Wood: 100 }, seconds: 8, tags: ['Building'] },
	Stable: { cost: { Wood: 120 }, seconds: 8, tags: ['Building'] },
	Worker: { cost: { Gold: 50 }, seconds: 4, supply: 1, madeAt: ['Hall'], tags: ['Worker'] },
	Spearman: { cost: { Gold: 40, Wood: 20 }, seconds: 4, supply: 1, madeAt: ['Barracks'], requires: ['Barracks'], range: 1.5 },
	Lancer: { cost: { Gold: 80 }, seconds: 6, supply: 2, madeAt: ['Stable'], requires: ['Stable', 'Horseshoes'], range: 1.5 },
	Horseshoes: { cost: { Gold: 60 }, seconds: 5, madeAt: ['Stable'], tags: ['Tech'] },
	Grove: { tags: ['Node:Wood'] },
	GoldVein: { tags: ['Node:Gold'] },
};

/** A village's Hall, behind its commander, and `workers` workers by name around it. */
function village(workers:string[], more:Record<string, SceneSpot> = {}):Record<string, SceneSpot> {
	const sides = ['left', 'right', 'behind'] as const;
	return {
		Hall: { away: 3, side: 'behind', kind: 'Hall' },
		...Object.fromEntries(workers.map((id, i) => [id, { away: 1 + Math.floor(i / 3), side: sides[i % 3], kind: 'Worker' } satisfies SceneSpot])),
		...more,
	};
}

/** Where the game of Stones stands: stones left, and whose move. */
type Pile = { left:number; mine:boolean };

/** What the Rune holds, and casts spent. */
type Charge = { charge:number; casts:number };

const RUNE_CASTS = 4;
const RUNE_SPELLS:Record<string, (charge:number)=>number> = { infuse: (c) => c + 3, amplify: (c) => c * 2, drain: (c) => c - 1 };

/** One of the Rune's spells: it changes the charge, until the casts run out. */
function runeSpell(name:string, help:string) {
	return {
		help,
		run: (w:SceneWorld) => {
			const casts = meter(w, 'casts');
			if (casts >= RUNE_CASTS) {
				return { ok: false, reason: 'the Rune is spent: no casts left' };
			}
			const charge = RUNE_SPELLS[name](meter(w, 'charge'));
			w.meters.set('charge', charge);
			w.meters.set('casts', casts + 1);
			return `the Rune's charge is ${charge} (${RUNE_CASTS - casts - 1} casts left)`;
		},
	};
}

/** A raider that runs at the nearest foe, or at its `focus`. */
const RAIDER:Pick<SceneSpot, 'as' | 'tactic'> = { as: 'Raider', tactic: 'charge' };

/**
 * Goals as games set them, from easy to hard: chaining deeds, trading, dealing with people, looking up what no prompt
 * shows, keeping promises, reacting while busy, fighting, commanding squads, running an economy, and planning with the
 * verbs and tools a game adds. Things past the sight radius (24) are out of sight: only the map shows them.
 */
export const ARC_BENCH:ArcCase[] = [
	// ── chain: deeds in order, each one opening the next ───────────────────
	{
		skill: 'chain',
		level: 1,
		me: { id: 'Vashti' },
		things: { BrassKey: { away: 4, side: 'left' }, Floodgate: { away: 7, side: 'ahead' } },
		goal: 'Open the Floodgate. It opens with the BrassKey',
		uses: { 'BrassKey>Floodgate': (w) => (w.flags.add('Floodgate open'), 'the Floodgate swings open') },
		done: (w) => w.flags.has('Floodgate open'),
		solution: 'pick_up(BrassKey) && use(item=BrassKey, target=Floodgate)',
		naive: 'use(item=BrassKey, target=Floodgate)',
	},
	{
		// One trip is not the job: four are, back and forth.
		skill: 'chain',
		level: 2,
		me: { id: 'Hedda' },
		carrying: ['Bucket'],
		things: { Spring: { away: 12, side: 'ahead' }, Cistern: { away: 10, side: 'behind' } },
		goal: 'Fill the Cistern: carry 4 Buckets of water to it from the Spring',
		seconds: 90,
		uses: {
			'Bucket>Spring': (w) => {
				if (w.flags.has('Bucket full')) {
					return { ok: false, reason: 'the Bucket is already full' };
				}
				w.flags.add('Bucket full');
				return 'the Bucket fills with water';
			},
			'Bucket>Cistern': (w) => {
				if (!w.flags.delete('Bucket full')) {
					return { ok: false, reason: 'the Bucket is empty: fill it at the Spring' };
				}
				w.meters.set('water', meter(w, 'water') + 1);
				return `the Cistern holds ${meter(w, 'water')} of 4 Buckets`;
			},
		},
		done: (w) => meter(w, 'water') >= 4,
		solution: 'loop(arc=use(item=Bucket, target=Spring) && use(item=Bucket, target=Cistern), times=4)',
		naive: 'use(item=Bucket, target=Spring) && use(item=Bucket, target=Cistern)',
	},
	{
		// The code is in the world, not the prompt: read it, then think again with it.
		skill: 'chain',
		level: 2,
		me: { id: 'Petra' },
		things: {
			Lockbox: { away: 3, side: 'ahead', description: 'An iron Lockbox with a three-digit dial.' },
			Plaque: { away: 5, side: 'right', description: 'The Plaque reads: "The Lockbox code is 4-1-7."' },
		},
		goal: 'Open the Lockbox. Its code is written somewhere nearby',
		verbs: {
			dial: {
				args: { target: 'id', code: 'string' },
				help: 'enters a code on a lock; three wrong codes jam it for good',
				run: (w, { args }) => {
					if (args.target !== 'Lockbox') {
						return { ok: false, reason: `${String(args.target)} has no dial` };
					}
					if (meter(w, 'wrong') < 3 && String(args.code).replace(/\D/g, '') === '417') {
						w.flags.add('Lockbox open');
						return 'the Lockbox clicks open';
					}
					w.meters.set('wrong', meter(w, 'wrong') + 1);
					return { ok: false, reason: meter(w, 'wrong') >= 3 ? 'the Lockbox is jammed for good' : 'wrong code; the Lockbox stays shut' };
				},
			},
		},
		done: (w) => w.flags.has('Lockbox open'),
		harm: (w) => meter(w, 'wrong') >= 3,
		solution: ['examine(Plaque)', 'dial(target=Lockbox, code=417)'],
		naive: 'dial(target=Lockbox, code=123)',
	},
	{
		// The near key is the wrong one, and what the Sluice needs is locked away until the right one opens the Shed.
		skill: 'chain',
		level: 3,
		me: { id: 'Wulf' },
		things: {
			IronKey: { away: 3, side: 'left' },
			BronzeKey: { away: 9, side: 'right' },
			Shed: { away: 8, side: 'left', description: 'A locked Shed. Its lock is bronze.' },
			Crank: { away: 8, side: 'left' },
			Sluice: { away: 6, side: 'ahead', description: 'A rusted Sluice gate. It turns only with its Crank.' },
		},
		goal: 'Open the Sluice. Its Crank is locked in the Shed',
		uses: {
			'IronKey>Shed': () => ({ ok: false, reason: 'the IronKey does not fit; the Shed\'s lock is bronze' }),
			'BronzeKey>Shed': (w) => (w.flags.add('Shed open'), 'the Shed door swings open; the Crank hangs inside'),
			'Crank>Sluice': (w) => (w.flags.add('Sluice open'), 'the Sluice grinds open'),
		},
		sees: (w, _from, to) => to !== 'Crank' || w.flags.has('Shed open'),
		done: (w) => w.flags.has('Sluice open'),
		solution: 'pick_up(BronzeKey) && use(item=BronzeKey, target=Shed) && pick_up(Crank) && use(item=Crank, target=Sluice)',
		naive: 'pick_up(IronKey) && use(item=IronKey, target=Shed) && pick_up(Crank) && use(item=Crank, target=Sluice)',
	},

	// ── trade: offers, prices, and deals that take two ───────────────────
	{
		skill: 'trade',
		level: 1,
		me: { id: 'Odda' },
		gold: 10,
		others: { Ysmay: { away: 2, side: 'ahead', carrying: ['Candle', 'Candle', 'Candle'], offers: [{ give: { Candle: 1 }, get: { gold: 3 } }] } },
		goal: 'Buy a Candle from Ysmay',
		done: (w) => w.holds('Odda', 'Candle') && w.count('Odda', 'gold') >= 7,
		solution: 'offer(to=Ysmay, give={"gold":3}, get={"Candle":1})',
		naive: 'give(item=gold, to=Ysmay, quantity=3)',
	},
	{
		// Maelis opens low, and pays 6 when asked.
		skill: 'trade',
		level: 2,
		me: { id: 'Wilmer' },
		role: 'Weaver',
		carrying: ['Scarf', 'Scarf'],
		others: { Maelis: { away: 2, side: 'ahead', gold: 12, offers: [{ give: { gold: 4 }, get: { Scarf: 1 } }] } },
		heard: [{ from: 'Maelis', text: 'I will give you 4 gold for a Scarf.' }],
		goal: 'Sell your Scarves, never for less than 6 gold each',
		act: (w, director) => acceptOffer(w, director, 'Maelis', (o) => {
			const scarves = o.give.Scarf ?? 0;
			return Object.keys(o.give).length === 1 && scarves >= 1 && scarves <= 2 && (o.get.gold ?? Infinity) <= 6 * scarves;
		}),
		done: (w) => w.count('Wilmer', 'Scarf') < 2 && w.count('Wilmer', 'gold') === 6 * (2 - w.count('Wilmer', 'Scarf')),
		// Sold below the price it set.
		harm: (w) => w.count('Wilmer', 'gold') < 6 * (2 - w.count('Wilmer', 'Scarf')),
		solution: 'offer(to=Maelis, give={"Scarf":2}, get={"gold":12})',
		naive: 'offer(to=Maelis, give={"Scarf":1}, get={"gold":4})',
	},
	{
		// Too poor to buy: sell first, to someone else, then buy.
		skill: 'trade',
		level: 3,
		me: { id: 'Fennick' },
		gold: 3,
		carrying: ['Pelt', 'Pelt', 'Pelt'],
		others: {
			Merrin: { away: 3, side: 'ahead', carrying: ['Lute'], offers: [{ give: { Lute: 1 }, get: { gold: 8 } }] },
			Thibault: { away: 6, side: 'left', gold: 20, offers: [{ give: { gold: 2 }, get: { Pelt: 1 } }] },
		},
		goal: 'Buy the Lute from Merrin',
		done: (w) => w.holds('Fennick', 'Lute'),
		solution: 'offer(to=Thibault, give={"Pelt":3}, get={"gold":6}) && offer(to=Merrin, give={"gold":8}, get={"Lute":1})',
		naive: 'offer(to=Merrin, give={"gold":3}, get={"Lute":1})',
	},

	// ── social: what people ask, said or done ───────────────────
	{
		skill: 'social',
		level: 1,
		me: { id: 'Bryn' },
		others: { Player: { away: 2, side: 'ahead' } },
		things: { Ladle: { away: 4, side: 'left' } },
		heard: [{ from: 'Player', text: 'Could you hand me that Ladle, please?' }],
		goal: 'Help whoever asks you',
		done: (w) => w.holds('Player', 'Ladle'),
		solution: 'pick_up(Ladle) && give(item=Ladle, to=Player)',
		naive: 'pick_up(Ladle)',
	},
	{
		skill: 'social',
		level: 2,
		me: { id: 'Galdor' },
		role: 'Messenger',
		others: { Reeve: { away: 2, side: 'ahead' }, Odo: { away: 20, side: 'right' } },
		heard: [{ from: 'Reeve', text: 'Go tell Odo the smith that I need 3 Spears by dusk.' }],
		goal: 'Carry messages for the Reeve',
		done: (w) => w.heard('Odo', 'spears'),
		solution: 'say(text=The Reeve needs 3 Spears by dusk., to=Odo)',
		naive: 'say(text=I will tell him right away., to=Reeve)',
	},
	{
		skill: 'social',
		level: 3,
		me: { id: 'Tilde' },
		gold: 5,
		others: {
			Player: { away: 2, side: 'ahead' },
			Harrow: { away: 15, side: 'right', carrying: ['Hatchet'], offers: [{ give: { Hatchet: 1 }, get: { gold: 5 } }] },
		},
		heard: [{ from: 'Player', text: 'I gave you 5 gold. Buy me a Hatchet from Harrow and bring it here, please.' }],
		goal: 'Help whoever asks you',
		done: (w) => w.holds('Player', 'Hatchet'),
		solution: 'offer(to=Harrow, give={"gold":5}, get={"Hatchet":1}) && give(item=Hatchet, to=Player)',
		naive: 'give(item=gold, to=Harrow, quantity=5)',
	},
	{
		// Only the shepherd knows where the thief went, and says so only when asked.
		skill: 'social',
		level: 3,
		me: { id: 'Eamon' },
		memories: everydayMemories(20),
		others: { Marit: { away: 3, side: 'ahead' }, Pellam: { away: 16, side: 'left' } },
		things: { Ravine: { away: 42, side: 'behind' }, Brooch: { away: 43, side: 'behind' }, Byre: { away: 6, side: 'right' } },
		heard: [{ from: 'Marit', text: 'A thief stole my Brooch last night! Pellam the shepherd saw where he ran. Please, bring it back to me.' }],
		goal: 'Help whoever asks you',
		thinks: 3,
		seconds: 120,
		act: (w, director) => answerSpeech(w, director, 'Pellam', 'Eamon', (text) => (/thief|brooch|ran|where|saw/i.test(text)
			? 'The thief ran to the Ravine behind the village and dropped something there.'
			: 'Hm? I only mind my sheep.')),
		done: (w) => w.holds('Marit', 'Brooch'),
		solution: ['say(text=Where did the thief run?, to=Pellam)', 'pick_up(Brooch) && give(item=Brooch, to=Marit)'],
		naive: 'say(text=Where did the thief run?, to=Marit)',
	},

	// ── lookup: what no prompt shows, found with a tool ───────────────────
	{
		skill: 'lookup',
		level: 1,
		me: { id: 'Wynn' },
		gold: 10,
		others: { Gisele: { away: 41, side: 'left', carrying: ['Salt', 'Salt'] } },
		things: { Statue: { away: 5, side: 'ahead' }, Saltworks: { away: 40, side: 'left' } },
		know: [{ name: 'Gisele', aliases: ['salt', 'Saltworks'], text: 'Gisele sells Salt at the Saltworks, 2 gold a pouch.' }],
		goal: 'Buy a pouch of Salt',
		act: (w, director) => acceptOffer(w, director, 'Gisele', (o) => o.get.Salt === 1 && (o.give.gold ?? 0) >= 2),
		done: (w) => w.holds('Wynn', 'Salt'),
		solution: 'go_to(Gisele) && offer(to=Gisele, give={"gold":2}, get={"Salt":1})',
		naive: 'go_to(Statue)',
	},
	{
		skill: 'lookup',
		level: 2,
		me: { id: 'Corran', hp: [3, 12] },
		know: [{ name: 'Hesketh', aliases: ['healer', 'heal', 'wounds', 'hurt', 'herbalist'], text: 'Hesketh the herbalist mends wounds for free. He lives at the Apiary.' }],
		things: { Granary: { away: 30, side: 'left' }, Apiary: { away: 45, side: 'behind' } },
		goal: 'You are badly hurt. Get healed',
		act: (w) => w.near('Corran', 'Apiary') && w.heal('Corran'),
		done: (w) => w.hp('Corran') === 12,
		solution: 'go_to(Apiary)',
		naive: 'go_to(Granary)',
	},
	{
		skill: 'lookup',
		level: 3,
		me: { id: 'Odalric' },
		others: { Gudrun: { away: 3, side: 'ahead' } },
		things: { Emberkap: { away: 40, side: 'left' }, Hollowbeech: { away: 41, side: 'left' } },
		know: [{ name: 'Emberkap', text: 'A glowing red mushroom. It grows by the Hollowbeech in the woods.' }],
		heard: [{ from: 'Gudrun', text: 'Fetch me one of those glowing red mushrooms from the woods, dear.' }],
		goal: 'Do what Gudrun asks',
		done: (w) => w.holds('Gudrun', 'Emberkap'),
		solution: 'pick_up(Emberkap) && give(item=Emberkap, to=Gudrun)',
		naive: 'say(text=Which mushrooms do you mean?, to=Gudrun)',
	},

	// ── questing: jobs and promises kept in memory ───────────────────
	{
		skill: 'questing',
		level: 1,
		me: { id: 'Sabeth' },
		carrying: ['Letter'],
		memories: [
			{ text: 'The Prior gave me a Letter to deliver to Ottilie at the Weir.', tags: ['Letter', 'Ottilie', 'Weir', 'errand'] },
			...everydayMemories(4),
		],
		others: { Ottilie: { away: 41, side: 'left' }, Ansel: { away: 4, side: 'right' } },
		things: { Weir: { away: 40, side: 'left' }, Pump: { away: 6, side: 'ahead' } },
		goal: 'Deliver the Letter you carry',
		done: (w) => w.holds('Ottilie', 'Letter'),
		solution: 'give(item=Letter, to=Ottilie)',
		naive: 'give(item=Letter, to=Ansel)',
	},
	{
		// A long-running NPC: the job is one memory among sixty.
		skill: 'questing',
		level: 2,
		me: { id: 'Runa' },
		memories: [
			...everydayMemories(30, -30 * HOUR),
			{ text: 'Osgood the brewer asked me to bring him a MaltSack from the Malthouse.', tags: ['Osgood', 'MaltSack', 'Malthouse', 'errand'], timestamp: -30 * HOUR },
			...everydayMemories(30),
		],
		others: { Osgood: { away: 4, side: 'behind' } },
		things: { Malthouse: { away: 35, side: 'right' }, MaltSack: { away: 36, side: 'right' }, Stile: { away: 8, side: 'left' } },
		goal: 'Do the jobs people asked of you',
		done: (w) => w.holds('Osgood', 'MaltSack'),
		solution: 'pick_up(MaltSack) && give(item=MaltSack, to=Osgood)',
		naive: 'say(text=Do you need anything?, to=Osgood)',
	},
	{
		// What it remembered first is no longer true: the newer memory wins.
		skill: 'questing',
		level: 2,
		me: { id: 'Tarvos' },
		carrying: ['Tongs'],
		memories: [
			{ text: 'Garrick the smith works at the Anvilhall.', tags: ['Garrick', 'Anvilhall', 'smith'], timestamp: -60 * HOUR },
			{ text: 'Garrick lent me his Tongs. I promised to bring them back to him.', tags: ['Garrick', 'Tongs', 'promise'], timestamp: -50 * HOUR },
			...everydayMemories(40, -10 * HOUR),
			{ text: 'Garrick moved his smithy down to the Wharf. The Anvilhall stands empty now.', tags: ['Garrick', 'Wharf', 'Anvilhall', 'smith'], timestamp: -10 * HOUR },
			...everydayMemories(8),
		],
		others: { Garrick: { away: 38, side: 'right' } },
		things: { Anvilhall: { away: 30, side: 'left' }, Wharf: { away: 36, side: 'right' } },
		goal: 'Keep your promises',
		done: (w) => w.holds('Garrick', 'Tongs'),
		solution: 'give(item=Tongs, to=Garrick)',
		naive: 'go_to(Anvilhall)',
	},
	{
		// Half the job is done already. Its memory says which half.
		skill: 'questing',
		level: 3,
		me: { id: 'Liesel' },
		carrying: ['Wool', 'Wool', 'Thatch'],
		memories: [
			...everydayMemories(40, -20 * HOUR),
			{ text: 'Berit asked me for 2 Wool and 1 Thatch to mend her roof.', tags: ['Berit', 'Wool', 'Thatch', 'roof', 'errand'], timestamp: -20 * HOUR },
			...everydayMemories(30, -6 * HOUR),
			{ text: 'I gave Berit the 2 Wool. She still needs the Thatch.', tags: ['Berit', 'Wool', 'Thatch', 'roof'], timestamp: -6 * HOUR },
			...everydayMemories(10),
		],
		others: { Berit: { away: 5, side: 'ahead', carrying: ['Wool', 'Wool'] }, Joss: { away: 7, side: 'left' } },
		goal: 'Finish the jobs people asked of you',
		done: (w) => w.holds('Berit', 'Thatch') && w.count('Berit', 'Wool') === 2 && w.count('Liesel', 'Wool') === 2,
		solution: 'give(item=Thatch, to=Berit)',
		naive: 'give(item=Wool, to=Berit, quantity=2) ; give(item=Thatch, to=Berit)',
	},

	// ── reactions: what to do when something happens mid-job, set up before it does ───────────────────
	{
		// The Lynx comes while she picks, long before the job is done: only a reaction set up beforehand saves her.
		skill: 'reactions',
		level: 1,
		me: { id: 'Halla', hp: [10, 10] },
		others: { Lynx: { away: 34, side: 'ahead', as: 'Brute', tactic: 'hold' } },
		things: {
			Hut: { away: 6, side: 'behind' },
			Morel1: { away: 12, side: 'ahead' },
			Morel2: { away: 16, side: 'left' },
			Morel3: { away: 18, side: 'ahead' },
			Morel4: { away: 16, side: 'right' },
		},
		goal: 'Pick the four Morels. A Lynx roams these woods: if it comes near you, run to the Hut until it leaves',
		seconds: 90,
		// It lumbers at her after a while, and leaves for good once she is at the Hut.
		act: (w) => {
			if (w.flags.has('Lynx gone')) {
				return;
			}
			if (w.near('Halla', 'Hut', 3)) {
				w.flags.add('Lynx gone');
				w.remove('Lynx');
			}
			else if (w.time >= 6) {
				w.walk('Lynx', 'Halla', 2.5);
			}
		},
		done: (w) => !w.isDown('Halla') && ['Morel1', 'Morel2', 'Morel3', 'Morel4'].every((m) => w.holds('Halla', m)),
		solution: 'when(watch=distance(me, Lynx) < 10, arc=go_to(Hut)) ; pick_up(Morel1) && pick_up(Morel2) && pick_up(Morel3) && pick_up(Morel4)',
		naive: 'pick_up(Morel1) && pick_up(Morel2) && pick_up(Morel3) && pick_up(Morel4)',
	},
	{
		// The Kiln cools while he hauls: a standing law keeps it fed, through the case's own alias verb.
		skill: 'reactions',
		level: 2,
		me: { id: 'Brandr' },
		role: 'Potter',
		carrying: Array<string>(8).fill('Charcoal'),
		things: {
			Kiln: { away: 3, side: 'ahead' },
			Wheel: { away: 4, side: 'right' },
			Clay1: { away: 20, side: 'left' },
			Clay2: { away: 20, side: 'behind' },
			Clay3: { away: 20, side: 'right' },
		},
		goal: 'Bring the three lumps of Clay to the Wheel, and never let the Kiln go cold: below 300 heat it cracks',
		verbs: {
			stoke: {
				args: { kiln: 'id' },
				help: 'feeds a Charcoal to a kiln, +300 heat; as a law: whenever its heat is below 400',
				arc: 'use(item=Charcoal, target={kiln})',
				watch: '{kiln}.heat < 400',
			},
		},
		uses: {
			'Charcoal>Kiln': (w) => {
				w.meters.set('heat', Math.min(900, meter(w, 'heat', 600) + 300));
				w.add('Brandr', 'Charcoal', -1);
				return `the Kiln roars: heat ${Math.round(meter(w, 'heat'))}`;
			},
		},
		fields: (w, id) => (id === 'Kiln' ? { heat: Math.round(meter(w, 'heat', 600)) } : undefined),
		seconds: 75,
		act: (w) => {
			w.meters.set('heat', meter(w, 'heat', 600) - 7.5);
			if (meter(w, 'heat') < 300) {
				w.flags.add('Kiln cracked');
			}
		},
		done: (w) => ['Clay1', 'Clay2', 'Clay3'].every((clay) => w.holds('Wheel', clay)) && !w.flags.has('Kiln cracked'),
		harm: (w) => w.flags.has('Kiln cracked'),
		solution: 'law(name=hot, arc=stoke(kiln=Kiln)) ; pick_up(Clay1) && drop(item=Clay1, to=Wheel) && pick_up(Clay2) && drop(item=Clay2, to=Wheel) && pick_up(Clay3) && drop(item=Clay3, to=Wheel)',
		naive: 'pick_up(Clay1) && drop(item=Clay1, to=Wheel) && pick_up(Clay2) && drop(item=Clay2, to=Wheel) && pick_up(Clay3) && drop(item=Clay3, to=Wheel)',
	},
	{
		// The shaman casts again and again: only a reaction that breaks every cast keeps the medic alive.
		skill: 'reactions',
		level: 3,
		me: { id: 'Vesna', as: 'Knight' },
		others: {
			Tilla: { away: 4, side: 'behind', as: 'Medic', team: US, tactic: 'healer' },
			Morwen: { away: 6, side: 'ahead', as: 'Shaman', hp: [80, 80], tactic: 'hold', focus: 'Tilla' },
		},
		goal: 'Kill Morwen and keep Tilla alive. Morwen\'s firestorm would kill Tilla: never let one land',
		done: (w) => w.isDown('Morwen') && w.lost(US) === 0,
		solution: 'when(watch=Morwen.casting, arc=bash(target=Morwen)) ; cleave(target=Morwen)',
		naive: 'bash(target=Morwen) && cleave(target=Morwen)',
	},

	// ── fight: one hero's abilities, in the right order ───────────────────
	{
		skill: 'fight',
		level: 1,
		me: { id: 'Corvus', as: 'Archer', hp: [30, 30] },
		others: { Grisk: { away: 14, side: 'ahead', as: 'Cleric', tactic: 'healer' }, Varga: { away: 7, side: 'left', as: 'Blade', tactic: 'charge' } },
		goal: 'Kill Grisk, their healer, first',
		done: (w) => w.downed[0] === 'Grisk',
		solution: 'shoot(target=Grisk)',
		naive: 'shoot(target=Varga) ; shoot(target=Grisk)',
	},
	{
		skill: 'fight',
		level: 2,
		me: { id: 'Ysra', as: 'Witch', hp: [3, 12] },
		carrying: ['Elixir'],
		others: { Brakk: { away: 4, side: 'left', as: 'Blade', hp: [6, 20], tactic: 'charge' } },
		goal: 'You are badly hurt. Defeat Brakk, and never die',
		uses: { Elixir: (w) => (w.heal('Ysra'), 'your wounds close') },
		done: (w) => w.isDown('Brakk') && !w.isDown('Ysra'),
		solution: 'use(item=Elixir) && hex(target=Brakk)',
		naive: 'hex(target=Brakk)',
	},
	{
		skill: 'fight',
		level: 2,
		me: { id: 'Ruadh', as: 'Archer', hp: [9, 12] },
		last: { ok: false, verb: 'shoot', reason: 'no line of sight to Mirela' },
		others: {
			Mirela: { away: 9, side: 'ahead', as: 'Witch', hp: [4, 12], tactic: 'hold' },
			Torsk: { away: 14, side: 'left', as: 'Knight', hp: [20, 28], tactic: 'charge' },
		},
		things: { Cairn: { away: 4, side: 'right' } },
		goal: 'Kill Mirela. From the Cairn you can see past the cover',
		// Cover stands between them both ways.
		sees: (w, from, to) => (to === 'Mirela' ? w.near(from, 'Cairn') : from === 'Mirela' ? w.near(to, 'Cairn') : true),
		done: (w) => w.isDown('Mirela'),
		solution: 'go_to(Cairn) && shoot(target=Mirela)',
		naive: 'shoot(target=Mirela)',
	},
	{
		// Four raiders swarm the knight. Root them while they stand together, then burn them all at once.
		skill: 'fight',
		level: 3,
		me: { id: 'Oriel', as: 'Witch' },
		others: {
			// A knight who holds them, not one who kills them.
			Bertolf: { away: 3, side: 'ahead', as: 'Knight', team: US, hp: [34, 34] },
			Skarn1: { away: 16, side: 'ahead', ...RAIDER, hp: [10, 14], focus: 'Bertolf' },
			Skarn2: { away: 14, side: 'left', ...RAIDER, hp: [10, 14], focus: 'Bertolf' },
			Skarn3: { away: 14, side: 'right', ...RAIDER, hp: [10, 14], focus: 'Bertolf' },
			Skarn4: { away: 17, side: 'ahead', ...RAIDER, hp: [10, 14], focus: 'Bertolf' },
		},
		goal: 'Raiders are closing on Bertolf from all sides. Wipe them out before they overrun him',
		done: (w) => w.routed(THEM) && w.lost(US) === 0,
		solution: 'wait(until=distance(Bertolf, Skarn4) < 3) ; frost(target=Skarn4) ; inferno(target=Skarn4)',
		naive: 'inferno(target=Skarn1)',
	},
	{
		// Low on health, an assassin on her: stun it, and run to the knight who can fight it.
		skill: 'fight',
		level: 3,
		me: { id: 'Nim', as: 'Rogue', hp: [6, 14] },
		others: {
			Gunnar: { away: 10, side: 'left', as: 'Knight', team: US, tactic: 'charge' },
			Shrike: { away: 3, side: 'ahead', as: 'Assassin', tactic: 'charge', focus: 'Nim' },
		},
		goal: 'Survive. Shrike is faster than you and hits harder than you can take',
		done: (w) => w.isDown('Shrike') && w.lost(US) === 0,
		solution: 'kick(target=Shrike) && go_to(Gunnar) && stab(target=Shrike)',
		naive: 'flee(from=Shrike)',
	},

	// ── tactics: a squad, ordered as one ───────────────────
	{
		// Their Medic keeps their raiders standing. Pros shoot the support first.
		skill: 'tactics',
		level: 1,
		me: { id: 'Brannoc', as: 'Rifleman' },
		rts: {},
		squad: {
			Aske: { away: 1, side: 'left', as: 'Rifleman' },
			Birk: { away: 1, side: 'right', as: 'Rifleman' },
			Colm: { away: 2, side: 'left', as: 'Rifleman' },
			Dagny: { away: 2, side: 'right', as: 'Rifleman' },
		},
		// Its raiders stand nearer, so whoever shoots the nearest never shoots it first.
		others: { ...band('Reaver', 2, { away: 9, side: 'ahead', ...RAIDER, hp: [10, 14] }), Sawbones: { away: 11, side: 'left', as: 'Medic', tactic: 'healer' } },
		goal: 'Win the fight. Take out their Medic first',
		done: (w) => w.firstDown(THEM) === 'Sawbones' && w.routed(THEM) && w.lost(US) <= 1,
		solution: 'issue(who=units, arc=attack(target=Sawbones) ; attack(target=others.filter(u => u.foe))) ; attack(target=Sawbones) ; attack(target=others.filter(u => u.foe))',
		naive: 'issue(who=units, arc=attack(target=others.filter(u => u.foe))) ; attack(target=others.filter(u => u.foe))',
		alone: 'attack(target=Sawbones)',
	},
	{
		// A fight not worth taking: everyone inside, where they cannot be hit.
		skill: 'tactics',
		level: 1,
		me: { id: 'Ostrom', as: 'Rifleman' },
		rts: { kinds: { Blockhouse: { holds: { capacity: 6 }, tags: ['Building'] } } },
		squad: {
			Ebbe: { away: 1, side: 'left', as: 'Rifleman' },
			Frode: { away: 1, side: 'right', as: 'Rifleman' },
			Hakon: { away: 2, side: 'left', as: 'Rifleman' },
		},
		others: band('Ravager', 10, { away: 26, side: 'ahead', ...RAIDER }),
		things: { Blockhouse: { away: 15, side: 'behind', kind: 'Blockhouse' } },
		goal: 'Their army is far bigger than yours. Get everyone inside the Blockhouse, and lose no one',
		done: (w) => w.lost(US) === 0 && ['Ostrom', 'Ebbe', 'Frode', 'Hakon'].every((id) => w.isSheltered(id)),
		solution: 'issue(who=units, arc=garrison(in=Blockhouse)) ; garrison(in=Blockhouse)',
		naive: 'issue(who=units, arc=go_to(Blockhouse)) ; go_to(Blockhouse)',
		alone: 'garrison(in=Blockhouse)',
	},
	{
		// Bursters roll into the thickest crowd and blow up. Pros spread their units before they land.
		skill: 'tactics',
		level: 2,
		me: { id: 'Elowen', as: 'Rifleman' },
		rts: {},
		squad: {
			Ivar: { away: 1, side: 'left', as: 'Rifleman' },
			Jorund: { away: 1, side: 'right', as: 'Rifleman' },
			Ketil: { away: 1, side: 'behind', as: 'Rifleman' },
			Cerys: { away: 2, side: 'left', as: 'Rifleman' },
			Mord: { away: 2, side: 'right', as: 'Rifleman' },
		},
		// Each one that reaches them takes one unit spread out, and every unit standing close.
		others: {
			Roller1: { away: 32, side: 'ahead', as: 'Burster', hp: [26, 26], tactic: 'burster' },
			Roller2: { away: 40, side: 'ahead', as: 'Burster', hp: [26, 26], tactic: 'burster' },
			Roller3: { away: 48, side: 'ahead', as: 'Burster', hp: [26, 26], tactic: 'burster' },
		},
		goal: 'Bursters roll into the thickest crowd of your units and blow up. Destroy them, and lose no more than three of your units',
		done: (w) => w.routed(THEM) && w.lost(US) <= 3,
		solution: 'issue(who=units, arc=spread_out(paces=6))',
		naive: 'issue(who=units, arc=hold()) ; hold()',
		alone: 'spread_out(paces=6)',
	},
	{
		// Slow lurkers that hit hard: pros kite, backing off whenever one comes close and shooting while it follows.
		skill: 'tactics',
		level: 2,
		me: { id: 'Ranulf', as: 'Rifleman' },
		rts: {},
		squad: {
			Nils: { away: 8, side: 'right', as: 'Rifleman' },
			Odd: { away: 9, side: 'right', as: 'Rifleman' },
			Peder: { away: 10, side: 'right', as: 'Rifleman' },
		},
		others: band('Mirebeast', 3, { away: 21, side: 'right', as: 'Lurker', tactic: 'charge' }),
		goal: 'Your units must destroy the lurkers without losing anyone. Lurkers are slower than you, but hit hard',
		seconds: 120,
		done: (w) => w.routed(THEM) && w.lost(US) === 0,
		solution: 'law(name=kite, arc=keep_distance(keep=6)) ; issue(who=units, arc=attack(target=others.filter(u => u.foe)))',
		naive: 'issue(who=units, arc=attack(target=others.filter(u => u.foe)))',
		alone: 'attack(target=others.filter(u => u.foe))',
	},
	{
		// One unit is nearly dead and their raiders are on it. Pros pull it back behind the line.
		skill: 'tactics',
		level: 2,
		me: { id: 'Sigmar', as: 'Rifleman' },
		squad: {
			Quinn: { away: 4, side: 'ahead', as: 'Rifleman', hp: [3, 10] },
			Merek: { away: 1, side: 'left', as: 'Rifleman' },
			Saoirse: { away: 1, side: 'right', as: 'Rifleman' },
			Toke: { away: 2, side: 'left', as: 'Rifleman' },
		},
		others: band('Gnasher', 2, { away: 13, side: 'ahead', ...RAIDER, focus: 'Quinn' }),
		things: { Handcart: { away: 6, side: 'behind' } },
		goal: 'Win the fight without losing anyone',
		done: (w) => w.routed(THEM) && w.lost(US) === 0,
		solution: 'issue(who=units.filter("Quinn"), arc=go_to(Handcart))',
		naive: 'issue(who=units, arc=fire(target=Gnasher1))',
		alone: 'fire(target=Gnasher1)',
	},
	{
		// Raiders come at both towers at once. Pros split the squad to hold both fronts.
		skill: 'tactics',
		level: 3,
		me: { id: 'Ottar', as: 'Rifleman' },
		squad: {
			Bryony: { away: 1, side: 'ahead', as: 'Rifleman', tags: ['Red'] },
			Arne: { away: 1, side: 'left', as: 'Rifleman', tags: ['Blue'] },
			Vidar: { away: 2, side: 'ahead', as: 'Rifleman', tags: ['Red'] },
			Yngve: { away: 1, side: 'right', as: 'Rifleman', tags: ['Blue'] },
			Wenche: { away: 1, side: 'behind', as: 'Rifleman', tags: ['Red'] },
			Bjorn: { away: 2, side: 'behind', as: 'Rifleman', tags: ['Blue'] },
		},
		others: {
			...band('Westraider', 3, { away: 30, side: 'left', ...RAIDER, focus: 'WestTower' }),
			...band('Eastraider', 3, { away: 36, side: 'right', ...RAIDER, focus: 'EastTower' }),
		},
		things: { WestTower: { away: 16, side: 'left', team: US, hp: [75, 75] }, EastTower: { away: 16, side: 'right', team: US, hp: [75, 75] } },
		goal: 'Raiders are coming for both towers. Keep both towers standing and destroy the raiders',
		done: (w) => w.routed(THEM) && !w.isDown('WestTower') && !w.isDown('EastTower'),
		solution: 'issue(who=units.filter("Red"), arc=go_to(WestTower)) ; issue(who=units.filter("Blue"), arc=go_to(EastTower))',
		naive: 'issue(who=units, arc=go_to(WestTower)) ; go_to(WestTower)',
		alone: 'go_to(WestTower)',
	},

	// ── economy: an RTS side's workers, buildings and stock ───────────────────
	{
		skill: 'economy',
		level: 1,
		me: { id: 'Aldwyn' },
		rts: { kinds: VILLAGE, stock: { [US]: { Wood: 0, Gold: 0 } } },
		squad: village(['Harrik', 'Bodil', 'Cuthred']),
		things: { Grove: { away: 10, side: 'ahead', kind: 'Grove', amount: 400 } },
		goal: 'Get 100 Wood into your stock',
		done: (w) => (w.stockOf(US).Wood ?? 0) >= 100,
		solution: 'gather(from=Wood)',
		naive: 'gather(from=Wood, workers=1)',
	},
	{
		// The gold is not there yet: wait for it, then send it.
		skill: 'economy',
		level: 2,
		me: { id: 'Brannagh' },
		rts: { kinds: VILLAGE, stock: { [US]: { Gold: 40 } }, allies: ['Varn'] },
		squad: village(['Dunstal', 'Elfrida', 'Fulk']),
		others: { Varn: { away: 20, side: 'left' } },
		things: { GoldVein: { away: 8, side: 'ahead', kind: 'GoldVein', amount: 500 } },
		goal: 'Your ally Varn needs 150 Gold. Gather it and send it to him',
		done: (w) => (w.stockOf('Varn').Gold ?? 0) >= 150,
		solution: 'gather(from=Gold) ; wait(until=stock.Gold >= 150, seconds=50) && tribute(to=Varn, give={"Gold":150})',
		naive: 'tribute(to=Varn, give={"Gold":150})',
	},
	{
		// Six do not fit under the cap: a house first, or the training stops at five.
		skill: 'economy',
		level: 2,
		me: { id: 'Corwen' },
		rts: { kinds: VILLAGE, stock: { [US]: { Gold: 300, Wood: 200 } } },
		squad: village(['Gyda', 'Harek'], { Barracks: { away: 6, side: 'right', kind: 'Barracks' } }),
		goal: 'Have 6 Spearmen',
		done: (w) => unitsOf(w, 'Spearman') >= 6,
		solution: 'build(what=House) ; train(what=Spearman, count=6)',
		naive: 'train(what=Spearman, count=6)',
	},
	{
		// Lancers need a Stable, the Horseshoes researched there, and room under the cap.
		skill: 'economy',
		level: 3,
		me: { id: 'Dagfinn' },
		rts: { kinds: VILLAGE, stock: { [US]: { Gold: 400, Wood: 200 } } },
		squad: village(['Ingvild', 'Jarl', 'Kolbein'], { Barracks: { away: 6, side: 'right', kind: 'Barracks' } }),
		goal: 'Have 2 Lancers',
		thinks: 3,
		seconds: 90,
		done: (w) => unitsOf(w, 'Lancer') >= 2,
		solution: 'build(what=Stable) ; build(what=House) ; research(what=Horseshoes) ; train(what=Lancer, count=2)',
		naive: 'train(what=Lancer, count=2)',
	},
	{
		// A growing village: train as gold comes in, put every new worker on gold, and make room before the cap.
		skill: 'economy',
		level: 3,
		me: { id: 'Eirik' },
		rts: { kinds: VILLAGE, stock: { [US]: { Gold: 150, Wood: 60 } } },
		squad: village(['Lothar', 'Magna', 'Njal']),
		things: {
			GoldVein: { away: 8, side: 'ahead', kind: 'GoldVein', amount: 2000 },
			Grove: { away: 10, side: 'left', kind: 'Grove', amount: 1000 },
		},
		goal: 'Grow your village: have 9 Workers and at least 150 Gold in stock',
		seconds: 90,
		done: (w) => unitsOf(w, 'Worker') >= 9 && (w.stockOf(US).Gold ?? 0) >= 150,
		solution: 'build(what=House) ; gather(from=Gold) ; law(name=grow, arc=keep_training(what=Worker, until=9)) ; law(name=work, arc=share_workers(on=Gold, of=9))',
		naive: 'train(what=Worker, count=6) ; gather(from=Gold)',
	},

	// ── planning: the verbs and tools a game adds ───────────────────
	{
		// The case's own verbs: one only works at the Scree, the other costs more Stone than it has.
		skill: 'planning',
		level: 1,
		me: { id: 'Wystan' },
		role: 'Mason',
		carrying: ['Stone', 'Stone'],
		things: { Scree: { away: 10, side: 'left' }, Crossroads: { away: 8, side: 'ahead' } },
		goal: 'Raise a Wall',
		verbs: {
			quarry: {
				help: 'breaks 2 Stone loose; only at the Scree',
				run: (w, { who }) => {
					if (!w.near(who, 'Scree', 3)) {
						return { ok: false, reason: 'there is no stone to quarry here; go to the Scree' };
					}
					w.add(who, 'Stone', 2);
					return 'you break 2 Stone loose';
				},
			},
			raise: {
				args: { what: 'string' },
				help: 'builds a Cairn (4 Stone) or a Wall (6 Stone) where you stand',
				run: (w, { who, args }) => {
					const what = String(args.what);
					const cost = ({ Cairn: 4, Wall: 6 } as Record<string, number>)[what];
					if (!cost) {
						return { ok: false, reason: `you cannot raise a ${what}` };
					}
					if (w.count(who, 'Stone') < cost) {
						return { ok: false, reason: `short ${cost - w.count(who, 'Stone')} Stone` };
					}
					w.add(who, 'Stone', -cost);
					w.flags.add(`${what} raised`);
					return `the ${what} stands`;
				},
			},
		},
		done: (w) => w.flags.has('Wall raised'),
		solution: 'go_to(Scree) && quarry() && quarry() && raise(what=Wall)',
		naive: 'raise(what=Wall)',
	},
	{
		// A game against a perfect player: one wrong move loses it. The look-ahead tool says which move wins.
		skill: 'planning',
		level: 2,
		me: { id: 'Fenwyn' },
		others: { Ilsabet: { away: 2, side: 'ahead' } },
		goal: 'Win the game of Stones against Ilsabet: you take turns taking 1 to 3 stones from a pile of 6, you first, and whoever takes the last stone wins',
		thinks: 3,
		verbs: {
			take: {
				args: { stones: 'number' },
				help: 'takes 1 to 3 stones from the pile on your turn; Ilsabet answers at once',
				run: (w, { args }) => {
					if (w.flags.has('game over')) {
						return { ok: false, reason: 'the game is over' };
					}
					const n = Math.round(Number(args.stones));
					const left = meter(w, 'pile', 6);
					if (!(n >= 1 && n <= 3) || n > left) {
						return { ok: false, reason: `take 1, 2 or 3, and no more than the ${left} left` };
					}
					if (n === left) {
						w.flags.add('won').add('game over');
						return 'you take the last stone and win';
					}
					// Ilsabet leaves a multiple of 4 when it can.
					const reply = (left - n) % 4 || 1;
					w.meters.set('pile', left - n - reply);
					if (left - n === reply) {
						w.flags.add('game over');
						return `you take ${n}; Ilsabet takes the last ${reply} and wins`;
					}
					return `you take ${n}, leaving ${left - n}; Ilsabet takes ${reply}, leaving ${left - n - reply}. Your move`;
				},
			},
		},
		search: sceneSearch<Pile>('plan_stones', (w) => ({
			help: 'Look ahead in the game of Stones with Ilsabet.',
			state: () => ({ left: meter(w, 'pile', 6), mine: true }),
			toMove: (s) => (s.mine ? 'Fenwyn' : 'Ilsabet'),
			moves: (s) => [1, 2, 3].filter((n) => n <= s.left).map((n) => ({ name: `take(stones=${n})`, next: { left: s.left - n, mine: !s.mine } })),
			// Whoever took the last stone, the one not to move now, won.
			score: (s, player) => (s.left > 0 ? 0 : (s.mine ? 'Ilsabet' : 'Fenwyn') === player ? 1 : -1),
			playout: 8,
		})),
		done: (w) => w.flags.has('won'),
		solution: ['take(stones=2)', 'take(stones=3)'],
		naive: 'take(stones=3)',
	},
	{
		// Four casts, one exact number: greed overshoots. The look-ahead tool finds a line that lands on it.
		skill: 'planning',
		level: 3,
		me: { id: 'Selka' },
		things: { Rune: { away: 2, side: 'ahead' } },
		goal: 'Charge the Rune to exactly 10 in at most 4 casts. It starts at 0',
		verbs: {
			infuse: runeSpell('infuse', '+3 to the Rune\'s charge'),
			amplify: runeSpell('amplify', 'doubles the Rune\'s charge'),
			drain: runeSpell('drain', '-1 to the Rune\'s charge'),
		},
		search: sceneSearch<Charge>('plan_rune', (w) => ({
			help: 'Look ahead at casts on the Rune.',
			state: () => ({ charge: meter(w, 'charge'), casts: meter(w, 'casts') }),
			moves: (s) => (s.casts >= RUNE_CASTS || s.charge === 10 ? [] : Object.entries(RUNE_SPELLS).map(([name, cast]) => ({ name: `${name}()`, next: { charge: cast(s.charge), casts: s.casts + 1 } }))),
			score: (s) => (s.charge === 10 ? 1 : -Math.min(1, Math.abs(10 - s.charge) / 10)),
		})),
		done: (w) => meter(w, 'charge') === 10,
		solution: 'infuse() && amplify() && drain() && amplify()',
		naive: 'infuse() && infuse() && infuse()',
	},
];
