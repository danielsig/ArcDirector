import { crowdEncyclopedia, type EncyclopediaEntry } from 'arc-director';

const TREE = crowdEncyclopedia({
	name: 'Tree',
	tag: 'tree',
	inside: ['forest', 'woods', 'grove'],
	unitName: 'm',
});

const BOULDER:EncyclopediaEntry = {
	name: 'Boulder',
	aliases: ['rock', 'rocks'],
	text: 'Landmark type. filter("Boulder"). Not MillStone.',
};

const RIVER:EncyclopediaEntry = {
	name: 'River',
	aliases: ['water', 'stream', 'canal'],
	text: 'Water, not reachable with go_to. Stay on land unless the scene names a bridge or gate.',
};

const BUY:EncyclopediaEntry = {
	name: 'Buy',
	aliases: ['buying', 'purchase', 'sell', 'selling'],
	text: 'Buying is done like this: `buy(item=What, from=Seller)`. Selling is `sell(item=What, to=Buyer)`.',
};

const GLEN:EncyclopediaEntry[] = [
	TREE,
	{
		name: 'Waterfall',
		aliases: ['falls', 'cascade'],
		text: 'Landmark type. filter("Waterfall"). *Falls* can be reached with go_to when the scene names it.',
	},
	BOULDER,
	RIVER,
	{
		name: 'Cottage',
		aliases: ['house', 'home', 'cabin'],
		text: 'Building. go_to(Cottage) is still outside. Inside is through CottageDoor.',
	},
	{
		name: 'CottageDoor',
		aliases: ['door', 'front door'],
		text: 'Door into Cottage. go_to a doorway is still outside; inside is the building.',
	},
	{
		name: 'MillBridge',
		aliases: ['bridge', 'sluice'],
		text: 'Named bridge. go_to(MillBridge) when the scene shows it. MillLever and MillCrank work the sluice.',
	},
	{
		name: 'MillLever',
		aliases: ['lever'],
		text: 'Named sluice lever by MillBridge. A miller works it with MillCrank.',
	},
	{
		name: 'MillStone',
		aliases: ['mill'],
		text: 'Named mill stone. Not Boulder.',
	},
	BUY,
	{
		name: 'FireMushroom',
		aliases: ['mushroom', 'mushrooms'],
		text: 'Item. Worth 10 gold. Foragers harvest it outdoors. Millers take it as a mill-fee or sell it.',
	},
	{
		name: 'SilverTrout',
		aliases: ['trout', 'fish'],
		text: 'Item. Worth 5 gold. Silver trout can be bought from anglers.',
	},
	{
		name: 'MillCrank',
		aliases: ['crank'],
		text: 'Item. Used on MillLever to work a sluice.',
	},
];

const RUINS:EncyclopediaEntry[] = [
	TREE,
	BOULDER,
];

const MARKETPLACE:EncyclopediaEntry[] = [
	RIVER,
	{
		name: 'EastGate',
		aliases: ['east gate'],
		text: 'The east exit of the marketplace. Walk to it with go_to(EastGate).',
	},
	{
		name: 'WestGate',
		aliases: ['west gate'],
		text: 'The west exit of the marketplace. Walk to it with go_to(WestGate).',
	},
	{
		name: 'BakerStall',
		aliases: ['bakery', 'baker stall'],
		text: 'A stall where a baker sells loaves of bread. Walk to it with go_to(BakerStall).',
	},
	{
		name: 'WeaverStall',
		aliases: ['weaver stall'],
		text: 'A stall where a weaver sells scarves. Walk to it with go_to(WeaverStall).',
	},
	{
		name: 'PotterStall',
		aliases: ['potter stall'],
		text: 'A stall where a potter sells bowls. Walk to it with go_to(PotterStall).',
	},
	{
		name: 'CutlerStall',
		aliases: ['cutler stall'],
		text: 'A stall where a cutler sells knives. Walk to it with go_to(CutlerStall).',
	},
	BUY,
];

const ABBEY_VAULT:EncyclopediaEntry[] = [
	{
		name: 'EastGate',
		aliases: ['east gate'],
		text: 'The door on the east side of the abbey vault. Walk to it with go_to(EastGate).',
	},
];

export const WORLD_ENCYCLOPEDIAS:Record<string, readonly EncyclopediaEntry[]> = {
	glen: GLEN,
	ruins: RUINS,
	marketplace: MARKETPLACE,
	abbey_vault: ABBEY_VAULT,
};
