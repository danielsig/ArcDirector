import type { KnowledgeEntry } from 'arc-director';
import { TREE, BOULDER } from '../../director/game-knowledge';

const PILLAR:KnowledgeEntry = {
	name: 'Pillar',
	aliases: ['column', 'columns', 'pillars'],
	text: 'Landmark type. filter("Pillar"). A standing stone column of the ruined temple; arrows cannot pass it, so it is cover.',
};

export const COMBAT_KNOWLEDGE:KnowledgeEntry[] = [
	TREE,
	BOULDER,
	PILLAR,
	{
		name: 'Sanctum',
		aliases: ['dais', 'temple', 'combat'],
		text: 'The ruined temple in the wood: broken outer walls with breaches, colonnades of Pillars inside them, and a low-walled sanctum with a raised dais at its center, where WestBrazier and EastBrazier burn. An old paved road comes out of the wood on the west and on the east and forks to the two breaches on its side. Walls block arrows and spells.',
	},
];
