// Example trial: does one line keep a model from opening its Arc with think()? A slice of the think-fix test.
//
//   node scripts/trial.mjs scripts/trial-example.mjs --fake
//   node scripts/trial.mjs scripts/trial-example.mjs --models google/gemma-4-12b-qat --samples 4 --format text,schema --cap 4
//   node scripts/trial.mjs scripts/trial-example.mjs --models google/gemma-4-12b-qat --tasks seal --resume <its out>
const RULE = 'IMPORTANT: `think` cannot be the first verb, and never at the root: only inside an if/else block or a choose choice.';
const HERBALIST = {
	me: { id: 'Hilde' },
	role: 'Herbalist',
	carrying: ['Basket'],
	gold: 9,
	memories: [{ text: 'You have sold herbs at this market for twenty years.', pinned: true, tags: ['backstory'] }],
	goal: 'Tend your herb stall',
};

export default {
	models: ['google/gemma-4-12b-qat'],
	variants: {
		base: {},
		rule: { append: RULE },
		// The same line at the end of the user message, nearest the reply.
		ruleLast: { in: 'user', at: -1, append: RULE },
	},
	tasks: [
		{
			id: 'seal',
			scene: {
				me: { id: 'Garrick' },
				role: 'Town guard',
				memories: [{ text: 'Last night someone stole the Mayor\'s Seal from the Townhall. Nobody saw the thief.', pinned: true, tags: ['backstory'] }],
				goal: 'Find out who stole the Mayor\'s Seal',
				things: { Townhall: { away: 20, side: 'ahead' }, Market: { away: 40, side: 'left' }, Tavern: { away: 35, side: 'right' } },
			},
			// For --fake: a root think the library turns down, then a valid reply.
			fake: ['think("who stole the Seal")', 'go_to(Townhall)'],
		},
		{
			id: 'ship',
			scene: {
				me: { id: 'Edda' },
				role: 'Fisherwoman',
				memories: [{ text: 'Your brother Oswin sailed for the Cape three days ago. He is all the family you have left.', pinned: true, tags: ['backstory'] }],
				goal: 'Mend the nets before the morning tide',
				others: { Harbormaster: { away: 2, side: 'ahead' } },
				things: { Nets: { away: 1, side: 'behind' }, Pier: { away: 10, side: 'right' } },
				heard: [{ from: 'Harbormaster', text: 'Edda, I am sorry. Oswin\'s ship sank off the Cape last night. They have found no survivors yet.' }],
			},
			fake: ['say("No...", to=Harbormaster)'],
		},
		{
			id: 'bread',
			scene: {
				...HERBALIST,
				others: { Bram: { away: 2, side: 'ahead' } },
				things: { Bread: { away: 4, side: 'right' }, Stall: { away: 1, side: 'behind' } },
				heard: [{ from: 'Bram', text: 'Hilde, fetch me that Bread, please.' }],
			},
		},
	],
	score: (run) => ({
		rootThink: run.repairs.some((reason) => /think\(\)/.test(reason)) || run.steps?.[0]?.verb === 'think',
		guardedThink: run.valid && /(?<![\w.])think\s*\(/.test(run.arc),
	}),
};
