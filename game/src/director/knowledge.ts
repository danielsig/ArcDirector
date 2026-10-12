import { crowdKnowledge, type KnowledgeEntry } from 'arc-director';
import { nameList, STALLS } from '../items/wares';

const TREE = crowdKnowledge({
	name: 'Tree',
	tag: 'tree',
	inside: ['forest', 'woods', 'grove'],
	unitName: 'm',
});

const BOULDER:KnowledgeEntry = {
	name: 'Boulder',
	aliases: ['rock', 'rocks'],
	text: 'Landmark type. filter("Boulder"). Not BridgeStone.',
};

const RIVER:KnowledgeEntry = {
	name: 'River',
	aliases: ['water', 'stream', 'canal'],
	text: 'Water, not reachable with go_to. Stay on land unless the scene names a bridge or gate.',
};

const TRADE:KnowledgeEntry = {
	name: 'Trade',
	aliases: ['trading', 'buy', 'buying', 'purchase', 'sell', 'selling', 'offer', 'price'],
	text: 'offer(to=Baker, give={"gold":5}, get={"Loaf":1}) buys a Loaf when Baker already offers one for 5 gold or less: both sides move at once. Otherwise it waits for their answer: the reverse offer accepts, other terms counter. Every open offer is listed under Open offers. give is a gift: nothing comes back.',
};

const GLEN:KnowledgeEntry[] = [
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
		text: 'Bridge over the river. Raised, no one can cross; lowered, they can. Only BridgeKeeper raises or lowers it, with BridgeCrank on BridgeLever. Handing over the fee does not move it. Sight says whether it is raised or lowered, and who is on it. It cannot be raised while anyone is on it. He does not lower it unpaid: the fee is 10 gold or an item worth that. go_to(Bridge) when the scene shows it.',
	},
	{
		name: 'BridgeLever',
		aliases: ['lever'],
		text: 'Sluice lever by Bridge. Only BridgeKeeper works it, with BridgeCrank. That raises a lowered bridge and lowers a raised one.',
	},
	{
		name: 'BridgeStone',
		aliases: ['stone'],
		text: 'Named bridge stone. Not Boulder.',
	},
	TRADE,
	{
		name: 'FireMushroom',
		aliases: ['mushroom', 'mushrooms', '10 gold'],
		text: 'Item. Worth 10 gold. Forager harvests it outdoors. BridgeKeeper takes it as the bridge fee or sells it.',
		item: true,
	},
	{
		name: 'MoonMushroom',
		aliases: ['moon mushroom', 'blue mushroom'],
		text: 'Item. A blue mushroom. Grows among the trees west of Cottage, outdoors. Forager harvests it.',
		item: true,
	},
	{
		name: 'SilverTrout',
		aliases: ['trout', 'fish', '5 gold'],
		text: 'Item. Worth 5 gold. Angler sells it.',
		item: true,
	},
	{
		name: 'BridgeCrank',
		aliases: ['crank'],
		text: 'Item. BridgeKeeper uses it on BridgeLever to raise or lower the bridge.',
		item: true,
	},
];

const PILLAR:KnowledgeEntry = {
	name: 'Pillar',
	aliases: ['column', 'columns', 'pillars'],
	text: 'Landmark type. filter("Pillar"). A standing stone column of the ruined temple; arrows cannot pass it, so it is cover.',
};

const RUINS:KnowledgeEntry[] = [
	TREE,
	BOULDER,
	PILLAR,
	{
		name: 'Sanctum',
		aliases: ['dais', 'temple', 'ruins'],
		text: 'The ruined temple: broken outer walls with breaches, colonnades of Pillars inside them, and a low-walled sanctum with a raised dais at its center. Walls block arrows and spells.',
	},
];

const MARKETPLACE:KnowledgeEntry[] = [
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
	...STALLS.map((stall):KnowledgeEntry => ({
		name: stall.stall,
		aliases: stall.aliases,
		text: `A stall where ${stall.vendor} sells ${nameList(stall.wares.map((ware) => ware.name))}. Walk to it with go_to(${stall.stall}).`,
	})),
	...STALLS.flatMap((stall) => stall.wares.map((ware):KnowledgeEntry => ({
		name: ware.name,
		aliases: ware.aliases,
		text: `Item. ${stall.vendor} sells it at ${stall.stall} for ${ware.ask} gold.`,
		item: true,
	}))),
	{ name: 'Apple', aliases: ['apples', 'fruit'], text: 'Item. Nobody sells it here; FruitStall is empty today.', item: true },
	{ name: 'Candle', aliases: ['candles'], text: 'Item. Nobody sells it here; CandleStall is empty today.', item: true },
	{
		name: 'Guard',
		aliases: ['guards', 'watch'],
		text: 'The Guards collective. Holt and Pike stand on either side of WestGate, never in the doorway; Brant and Cass stand on either side of EastGate the same way. A guard who reaches a thief takes the stolen goods back. A cry of theft, thief, stole, stealing, robbed, robbery, mugged, or help sends them to the speaker.',
	},
	TRADE,
];

/** The Sunken Crypt, in the order the company meets it. */
const DUNGEON_VAULT:KnowledgeEntry[] = [
	{
		name: 'Crypt',
		aliases: ['dungeon', 'map', 'rooms', 'way', 'route'],
		text: 'The Sunken Crypt, room by room: the Gatehouse where you came in; a passage north choked by Cobweb; the Pillared Hall; SealedDoor on its east wall; the round Ossuary; a winding passage north, east and back south to CryptGate; the Throne Crypt of the HollowKing; HoardGate at its south end; the Treasury with HoardChest. Rooms are not go_to names: go_to the named thing in them. Dead-end side passages may hide potions.',
	},
	{
		name: 'Cobweb',
		aliases: ['web', 'webs', 'spider web'],
		text: 'A thick web blocking the passage north of the Gatehouse. Fire burns it away: pick_up(WoodenTorch) && use(item=WoodenTorch, target=Cobweb).',
	},
	{
		name: 'WoodenTorch',
		aliases: ['torch', 'flame', 'fire'],
		text: 'Item lying in the Gatehouse. use it on Cobweb to burn the web away.',
		item: true,
	},
	{
		name: 'SealedDoor',
		aliases: ['sealed door', 'riddle door', 'door'],
		text: 'Door on the east wall of the Pillared Hall, to the Ossuary. No key opens it. Whoever says the answer to the riddle on RiddleStone aloud, standing near it, opens it: go_to(SealedDoor) && say(text=answer).',
	},
	{
		name: 'RiddleStone',
		aliases: ['riddle', 'inscription', 'stone', 'tablet'],
		text: 'Carved stone beside SealedDoor. Its riddle is the password; sight shows the carving. Answer with one word, aloud.',
	},
	{
		name: 'OssuaryChest',
		aliases: ['chest', 'ossuary'],
		text: 'Unlocked chest in the Ossuary. It holds CryptKey: pick_up(CryptKey).',
	},
	{
		name: 'CryptKey',
		aliases: ['key', 'iron key', 'crypt key'],
		text: 'Item in OssuaryChest. Opens CryptGate: use(item=CryptKey, target=CryptGate).',
		item: true,
	},
	{
		name: 'CryptGate',
		aliases: ['crypt gate', 'gate'],
		text: 'Locked gate into the Throne Crypt, at the end of the winding passage past the Ossuary. Only CryptKey opens it.',
	},
	{
		name: 'HollowKing',
		aliases: ['king', 'boss', 'hollow king', 'weakness'],
		text: 'The dead king of the crypt, in the Throne Crypt. His grave-iron shrugs off steel and arrows: every blow but a hex does half. Witchfire is his weakness: hex does triple. Shield the Witch and let her burn him.',
	},
	{
		name: 'HoardGate',
		aliases: ['hoard gate', 'treasury gate'],
		text: 'Gate at the south end of the Throne Crypt. No key: it opens by itself when the HollowKing falls.',
	},
	{
		name: 'HoardChest',
		aliases: ['hoard', 'treasure', 'treasury'],
		text: 'Unlocked chest in the Treasury behind HoardGate. It holds SunCrown and gold.',
	},
	{
		name: 'SunCrown',
		aliases: ['crown', 'sun crown', 'prize'],
		text: 'Item in HoardChest. What the company came for: pick_up(SunCrown) ends the quest.',
		item: true,
	},
	{
		name: 'Monsters',
		aliases: ['ghoul', 'skeleton', 'monster', 'undead', 'enemy', 'enemies'],
		text: 'Ghouls, Skeletons, BoneArchers and a CultWitch guard the rooms. They wake when they see you and fight to the death. Your fight laws strike back for you; in a fight, stay together and keep Maren behind Bram.',
	},
	{
		name: 'HealthPotion',
		aliases: ['potion', 'heal'],
		text: 'Item. use(item=HealthPotion) drinks it and heals you a little.',
		item: true,
	},
];

export const WORLD_KNOWLEDGE:Record<string, readonly KnowledgeEntry[]> = {
	glen: GLEN,
	ruins: RUINS,
	marketplace: MARKETPLACE,
	dungeon_vault: DUNGEON_VAULT,
};
