import { crowdKnowledge, type KnowledgeEntry } from 'arc-director';

export const TREE = crowdKnowledge({
	name: 'Tree',
	tag: 'tree',
	inside: ['forest', 'woods', 'grove'],
	unitName: 'm',
});

export const BOULDER:KnowledgeEntry = {
	name: 'Boulder',
	aliases: ['rock', 'rocks'],
	text: 'Landmark type. filter("Boulder"). Not BridgeStone.',
};

export const RIVER:KnowledgeEntry = {
	name: 'River',
	aliases: ['water', 'stream', 'canal'],
	text: 'Water, not reachable with go_to. Stay on land unless the scene names a bridge or gate.',
};

export const TRADE:KnowledgeEntry = {
	name: 'Trade',
	aliases: ['trading', 'buy', 'buying', 'purchase', 'sell', 'selling', 'offer', 'price'],
	text: 'offer(to=Baker, give={"gold":5}, get={"Loaf":1}) buys a Loaf when Baker already offers one for 5 gold or less: both sides move at once. Otherwise it waits for their answer: the reverse offer accepts, other terms counter. Every open offer is listed under Open offers. give is a gift: nothing comes back.',
};
