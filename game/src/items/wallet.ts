import { Crowd, Merchant, Wallet } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { getDef } from './defs';
import { compactName, findCarried, itemMatchesName } from './inventory';
import type { ItemInstance } from './instance';

export function purseOf(go:GameObject):Wallet {
	let wallet = go.getComponent(Wallet);
	if (!wallet) {
		wallet = go.addComponent(new Wallet());
	}
	return wallet;
}

export function coinsOf(go:GameObject):number {
	return go.getComponent(Wallet)?.coins ?? 0;
}

export function transferCoins(from:GameObject, to:GameObject, amount:number):string | null {
	if (amount <= 0 || !Number.isFinite(amount)) {
		return 'bad amount';
	}
	const pay = Math.floor(amount);
	const src = purseOf(from);
	if (src.coins < pay) {
		return `only ${src.coins} gold in purse`;
	}
	src.coins -= pay;
	purseOf(to).coins += pay;
	return null;
}

export function goodsAsk(item:ItemInstance):number | undefined {
	return getDef(item.defID).components.Goods?.ask;
}

export function priceFor(seller:GameObject, item:ItemInstance, buyerID:string):{
	ask:number;
	floor:number;
	agreed:number | undefined;
} | null {
	const askDef = goodsAsk(item);
	const shop = seller.getComponent(Merchant);
	const specialty = !!shop?.specialty
		&& compactName(shop.specialty) === compactName(item.name);
	const ask = specialty && shop ? shop.ask : askDef;
	if (ask === undefined) {
		return null;
	}
	const floor = specialty && shop ? shop.floor : Math.max(1, Math.floor(ask * 0.6));
	const agreed = shop?.deals[buyerID];
	return { ask, floor, agreed };
}

export function findSaleItem(seller:GameObject, name:string):ItemInstance | null {
	return findCarried(seller, (it) => itemMatchesName(it, name) && goodsAsk(it) !== undefined)
		?? findCarried(seller, (it) => itemMatchesName(it, name));
}

export function noteWant(actor:GameObject, itemName:string):boolean {
	const crowd = actor.getComponent(Crowd);
	if (!crowd) {
		return false;
	}
	const want = compactName(itemName);
	const i = crowd.wants.findIndex((w) => compactName(w) === want);
	if (i < 0) {
		return false;
	}
	crowd.wants.splice(i, 1);
	return true;
}
