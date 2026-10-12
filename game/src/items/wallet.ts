import { MarketNPC, Wallet } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { compactName } from './inventory';

export function coinsOf(go:GameObject):number {
	return go.getComponent(Wallet)?.coins ?? 0;
}

export function transferCoins(from:GameObject, to:GameObject, amount:number):string | null {
	if (amount <= 0 || !Number.isFinite(amount)) {
		return 'bad amount';
	}
	const pay = Math.floor(amount);
	const src = from.getOrAddComponent(Wallet);
	if (src.coins < pay) {
		return `only ${src.coins} gold in purse`;
	}
	src.coins -= pay;
	to.getOrAddComponent(Wallet).coins += pay;
	return null;
}

export function noteWant(character:GameObject, itemName:string):boolean {
	const npc = character.getComponent(MarketNPC);
	if (!npc) {
		return false;
	}
	const want = compactName(itemName);
	const i = npc.wants.findIndex((w) => compactName(w) === want);
	if (i < 0) {
		return false;
	}
	npc.wants.splice(i, 1);
	return true;
}
