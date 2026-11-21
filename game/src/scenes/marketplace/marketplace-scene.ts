import { HEROS_TALE } from '../../audio/songs';
import { MARKETPLACE_LOOK } from '../../render/look';
import type { Scene } from '../scene';
import { directMarketplace, MARKETPLACE_HOOKS } from './marketplace-hooks';
import { MARKETPLACE_CAST } from './marketplace-hive';
import { MARKETPLACE_KNOWLEDGE } from './marketplace-knowledge';
import { MARKETPLACE_CHUNKS } from './marketplace-map';

export const MARKETPLACE:Scene = {
	id: 'marketplace',
	title: 'Marketplace',
	blurb: 'Seven sellers with minds of their own, and shoppers who keep coming.',
	look: MARKETPLACE_LOOK,
	music: HEROS_TALE,
	knowledge: MARKETPLACE_KNOWLEDGE,
	requirements: [
		{ verb: 'offer', to: 'SushiChef', condition: 'me is "sitting"', reason: 'sit at SushiStallBench to order' },
		{ verb: 'use', item: 'Sushi', condition: 'me is "sitting"', reason: 'sit down to eat it' },
	],
	lightLevel: 0.1,
	minimapFollow: true,
	carried: 'shoppers',
	inspect: true,
	player: { wallet: 20 },
	chunks: MARKETPLACE_CHUNKS,
	cast: MARKETPLACE_CAST,
	ambient: 'An open-air marketplace split by a canal, crossed by three footbridges.',
	brief: `Seven sellers think for themselves, each with their own voice. Everyone else in the square is steered by one mind that has no character of its own.

The baker, the weaver, the apothecary, the potter, the knife-seller, the sushi chef and the toymaker each stay at their post and never leave it: a stall in the open square, or a counter inside their own shop (the apothecary's and the toymaker's, built to their own shape and roof, bigger and smaller than the stalls around them). Each sells a few goods for a gold price, and answers a lower offer themselves. Shoppers arrive wanting something, with a purse that may not cover it, look around, and buy when the price suits them. New shoppers keep arriving. A single guard holds each gate and takes back anything stolen.

That mind sees what each shopper wants and how much gold they carry, and what the stalls have posted. It sends them to look, to offer, and out by their own gate, and it keeps the guards at their posts. The sellers do not leave their posts. It is working when shoppers leave with their goods, some of them after a haggle, and someone who grabs something without paying gets caught.`,
	hooks: MARKETPLACE_HOOKS,
	direct: directMarketplace,
};
