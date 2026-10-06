import type { Inventory } from './inventory.js';

export type { Inventory };

const ALL = 'Nothing else: what is not listed, you do not have.';

/** Ends by saying the list is all there is, so a mind does not carry what its role says it often has. */
export function formatInventory(bag:Inventory = {}):string {
	const lines:string[] = [];
	if (bag.worn) {
		for (const [slot, label] of Object.entries(bag.worn)) {
			if (label) {
				lines.push(`${slot}: ${label}`);
			}
		}
	}
	if (bag.purse !== undefined) {
		lines.push(`Purse: ${bag.purse} gold`);
	}
	if (bag.pockets && bag.pockets.length > 0) {
		lines.push(`Pockets: ${bag.pockets.join(', ')}`);
	}
	if (bag.pack) {
		lines.push(`Backpack ${bag.pack.name}: ${bag.pack.items.join(', ')}`);
	}
	if (lines.length === 0) {
		return 'You carry nothing.';
	}
	return [...lines, ALL].join('\n');
}
