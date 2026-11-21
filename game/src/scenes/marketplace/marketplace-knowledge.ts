import type { KnowledgeEntry } from 'arc-director';
import { RIVER, TRADE } from '../../director/game-knowledge';
import { nameList } from '../../director/names';
import { placeOf, SELLERS } from './wares';

export const MARKETPLACE_KNOWLEDGE:KnowledgeEntry[] = [
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
		name: 'ApothecaryShop',
		aliases: ['apothecary', 'apothecary shop', 'herb shop'],
		text: 'A shop on the north square, slate-roofed, bigger than the stalls beside it. go_to(ApothecaryShop) is still outside; ApothecaryCounter inside is where Apothecary sells.',
	},
	{
		name: 'ToyShop',
		aliases: ['toy shop', 'toymaker shop'],
		text: 'A thatched shop on the south square, smaller than ApothecaryShop. go_to(ToyShop) is still outside; ToyCounter inside is where Toymaker sells.',
	},
	...SELLERS.map((seller):KnowledgeEntry => ({
		name: seller.post,
		aliases: seller.aliases,
		text: `${seller.shop ? `The counter inside ${seller.shop}` : 'A stall'} where ${seller.vendor} sells ${nameList(seller.wares.map((ware) => ware.name))}. Walk to it with go_to(${seller.post}).`,
	})),
	...SELLERS.flatMap((seller) => seller.wares.map((ware):KnowledgeEntry => ({
		name: ware.name,
		aliases: ware.aliases,
		text: `Item. ${seller.vendor} sells it at ${placeOf(seller)} for ${ware.ask} gold.`,
		item: true,
	}))),
	{
		name: 'Guard',
		aliases: ['guards', 'watch'],
		text: 'The Guards collective. Holt stands beside WestGate; Brant stands beside EastGate. A guard who reaches a thief takes the stolen goods back. A cry of theft, thief, stole, stealing, robbed, robbery, mugged, or help sends them to the speaker.',
	},
	TRADE,
];
