import type { KnowledgeEntry } from 'arc-director';
import { TREE, BOULDER, RIVER, TRADE } from '../../director/game-knowledge';
import { getDef } from '../../items/defs';

/** `seconds` as one would say it: "10 seconds", "2 minutes". */
function duration(seconds:number):string {
	return seconds % 60 === 0 ? `${seconds / 60} minute${seconds === 60 ? '' : 's'}` : `${seconds} seconds`;
}

const COOKS = getDef('silver_trout').components.Cookable!.seconds;
const BURNS = COOKS + getDef('cooked_trout').components.Cookable!.seconds;
/** How long a trout takes on the fire, as the item defs have it. */
const TROUT_ON_FIRE = `On the spit over Campfire, a SilverTrout is CookedTrout after ${duration(COOKS)} and BurntTrout after ${duration(BURNS)}.`;

export const GLEN_KNOWLEDGE:KnowledgeEntry[] = [
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
		text: 'BridgeKeeper\'s house, north of the river. go_to(Cottage) is still outside. Inside is through CottageDoor, with CottageChair and CottageBed.',
	},
	{
		name: 'CottageDoor',
		aliases: ['door', 'front door'],
		text: 'Door into Cottage, locked from outside: from outside only its key opens it, with use, and BridgeKeeper carries CottageKey. From inside anyone opens it by walking up. Anyone can close it. go_to a doorway is still outside; inside is the building.',
	},
	{
		name: 'Hut',
		aliases: ['angler house', 'shack'],
		text: 'Angler\'s house, south of the river. HutDoor is not locked: whoever walks up opens it, and anyone can close it. HutChair and HutBed are inside.',
	},
	{
		name: 'CottageBookshelf',
		aliases: ['book', 'books', 'bookshelf', 'reading', 'shelf'],
		text: 'BridgeKeeper\'s shelf in Cottage, with five books: Almanac, RiverTales, TollBook, MushroomLore and OldSongs. read(item=Almanac) fetches one if need be and settles down with it, until you walk off.',
	},
	{
		name: 'Food',
		aliases: ['eat', 'eating', 'meal', 'hungry', 'hunger', 'dinner'],
		text: 'CookedTrout, FireMushroom and MoonMushroom are food. use(item=CookedTrout) eats what you carry. A meal keeps hunger away for a long time. SilverTrout is raw fish: it must be cooked on Campfire before it is eaten.',
	},
	{
		name: 'Campfire',
		aliases: ['fire', 'cook', 'cooking', 'spit', 'camp', 'raw'],
		text: `Forager's cooking fire, in a clearing among the trees west of Cottage, with a spit over it that holds one food at a time, like a chest. use(item=SilverTrout, target=Campfire) puts a raw fish on the spit. ${TROUT_ON_FIRE} Wait, then pick_up(item=CookedTrout, from=Campfire) before it burns.`,
	},
	{
		name: 'Rest',
		aliases: ['chair', 'chairs', 'seat', 'bed', 'beds', 'sleep', 'sit', 'nap', 'tired'],
		text: 'sit(target=HutChair) sits you on a chair and sleep(target=HutBed) puts you to bed; walking off gets you up. CottageChair, HutChair and RiverChair are the chairs, CottageBed, HutBed and Forager\'s Bedroll by Campfire the beds.',
	},
	{
		name: 'Fishing',
		aliases: ['fish', 'rod', 'angling', 'catch'],
		text: 'Angler fishes from RiverChair, on the south bank. fish sits there with a rod until you walk off. A bite comes about once a minute and lands a SilverTrout about half the time, more often if you are lucky.',
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
		text: 'Item. Worth 10 gold. Forager harvests it outdoors. BridgeKeeper takes it as the bridge fee or sells it. use(item=FireMushroom) eats it: a meal, and your feet feel light for a while.',
		item: true,
	},
	{
		name: 'MoonMushroom',
		aliases: ['moon mushroom', 'blue mushroom'],
		text: 'Item. A blue mushroom, worth only 1 gold: not FireMushroom, and it does not pay the bridge fee. Grows among the trees west of Cottage, outdoors. Forager harvests it. use(item=MoonMushroom) eats it: a meal, and you are luckier for a while, at fishing too.',
		item: true,
	},
	{
		name: 'SilverTrout',
		aliases: ['trout', 'fish', '5 gold'],
		text: `Item. Raw fish, worth 5 gold. Angler sells it, and fishes for more. Cook it on Campfire before eating it: raw, it cannot be eaten. ${TROUT_ON_FIRE}`,
		item: true,
	},
	{
		name: 'CookedTrout',
		aliases: ['cooked fish', 'cooked trout'],
		text: `Item. A SilverTrout cooked on Campfire, worth 6 gold. use(item=CookedTrout) eats it: a meal. ${TROUT_ON_FIRE}`,
		item: true,
	},
	{
		name: 'BurntTrout',
		aliases: ['burnt fish', 'burned trout'],
		text: 'Item. A trout left on Campfire too long: charred, not fit to eat, worth nothing.',
		item: true,
	},
	{
		name: 'BridgeCrank',
		aliases: ['crank'],
		text: 'Item. BridgeKeeper uses it on BridgeLever to raise or lower the bridge.',
		item: true,
	},
];
