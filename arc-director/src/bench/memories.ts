import type { MemoryDraft } from '../memory/store.js';

/** Who and what an everyday memory is about. None of them is in a bench case, so none of them helps. */
const FOLK = ['Aldous', 'Brielle', 'Cedric', 'Dunstan', 'Eira', 'Godric', 'Imelda', 'Jocelyn', 'Leofric', 'Mildred', 'Osric', 'Prudence'];
const SPOTS = ['Orchard', 'Chapel', 'Pond', 'Tannery', 'Crossroads', 'Meadow', 'Stable', 'Quarry'];
const GOODS = ['Turnips', 'Candles', 'Nails', 'Cheese', 'Wool', 'Rope', 'Apples', 'Honey'];
const SAYINGS = ['the harvest will be late', 'wolves were heard past the Meadow', 'the well water tastes of iron', 'a peddler is coming next week', 'the roads are muddy again'];
const CHORES = ['mended a fence', 'chopped firewood', 'swept the yard', 'fed the hens', 'patched a coat', 'carried water'];

/**
 * `count` memories of an ordinary life, made the same way every time: trades, gossip, weather and chores, none of
 * which a case's goal needs. A case buries what matters among them, as a long-running NPC's memory would, oldest
 * first and an hour apart, ending `endsAt` seconds of game time.
 */
export function everydayMemories(count:number, endsAt = 0):MemoryDraft[] {
	const at = (i:number) => endsAt - (count - i) * 3600;
	const pick = <T>(items:readonly T[], i:number, step:number):T => items[(i * step + Math.floor(i / items.length)) % items.length];
	return Array.from({ length: count }, (_, i) => {
		const who = pick(FOLK, i, 5);
		const where = pick(SPOTS, i, 3);
		const lines = [
			{ text: `Sold ${2 + (i % 4)} ${pick(GOODS, i, 7)} to ${who}.`, tags: [who, 'trade'] },
			{ text: `${who} said ${pick(SAYINGS, i, 2)}.`, tags: [who, 'gossip'] },
			{ text: `It rained hard by the ${where}.`, tags: [where, 'weather'] },
			{ text: `I ${pick(CHORES, i, 5)} near the ${where}.`, tags: [where, 'chore'] },
			{ text: `${who} and ${pick(FOLK, i + 3, 7)} argued at the ${where}.`, tags: [who, where] },
		];
		return { ...lines[i % lines.length], timestamp: at(i) };
	});
}
