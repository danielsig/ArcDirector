import type { Inventory } from './inventory.js';

export type { Inventory };

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
		return 'Nothing worn.';
	}
	return lines.join('\n');
}
