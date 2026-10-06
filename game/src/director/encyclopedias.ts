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
	text: 'Landmark type. filter("Boulder"). Not BridgeStone.',
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

/** A good one stall sells. */
function ware(name:string, aliases:string[], seller:string, stall:string, ask:number):EncyclopediaEntry {
	return { name, aliases, text: `Item. ${seller} sells it at ${stall}, asking ${ask} gold. buy(item=${name}, from=${seller}).`, item: true };
}

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
		name: 'Bridge',
		aliases: ['sluice'],
		text: 'Bridge over the river, raised unless lowered. Only BridgeKeeper can lower it, for a fee. go_to(Bridge) when the scene shows it.',
	},
	{
		name: 'BridgeLever',
		aliases: ['lever'],
		text: 'Sluice lever by Bridge. Only BridgeKeeper works it, with BridgeCrank.',
	},
	{
		name: 'BridgeStone',
		aliases: ['stone'],
		text: 'Named bridge stone. Not Boulder.',
	},
	BUY,
	{
		name: 'FireMushroom',
		aliases: ['mushroom', 'mushrooms', '10 gold'],
		text: 'Item. Worth 10 gold. Forager harvests it outdoors. BridgeKeeper takes it as the bridge fee or sells it.',
		item: true,
	},
	{
		name: 'SilverTrout',
		aliases: ['trout', 'fish', '5 gold'],
		text: 'Item. Worth 5 gold. Silver trout can be bought from anglers.',
		item: true,
	},
	{
		name: 'BridgeCrank',
		aliases: ['crank'],
		text: 'Item. Used on BridgeLever to work a sluice.',
		item: true,
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
	ware('Loaf', ['bread', 'loaves'], 'Baker', 'BakerStall', 5),
	ware('Scarf', ['scarves'], 'Weaver', 'WeaverStall', 6),
	ware('Bowl', ['bowls', 'pottery'], 'Potter', 'PotterStall', 4),
	ware('Knife', ['knives', 'blade'], 'Cutler', 'CutlerStall', 7),
	{ name: 'Apple', aliases: ['apples', 'fruit'], text: 'Item. Nobody sells it here; FruitStall is empty today.', item: true },
	{ name: 'Candle', aliases: ['candles'], text: 'Item. Nobody sells it here; CandleStall is empty today.', item: true },
	{
		name: 'Guard',
		aliases: ['guards', 'watch'],
		text: 'Guards hold EastGate and WestGate. A Guard who reaches a thief takes the stolen goods back to their stall.',
	},
	BUY,
];

const ABBEY_VAULT:EncyclopediaEntry[] = [
	{
		name: 'EastGate',
		aliases: ['east gate'],
		text: 'The door on the east side of the dungeon vault. Walk to it with go_to(EastGate).',
	},
];

export const WORLD_ENCYCLOPEDIAS:Record<string, readonly EncyclopediaEntry[]> = {
	glen: GLEN,
	ruins: RUINS,
	marketplace: MARKETPLACE,
	abbey_vault: ABBEY_VAULT,
};
