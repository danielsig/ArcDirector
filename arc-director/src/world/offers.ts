import type { CountMap } from '../arc/arc-types.js';

/**
 * What a character stands ready to trade: it hands over `give` for `get`. An offer to someone (`to`) is taken whole
 * or not at all. A standing offer, to anyone, is taken in any whole multiple: `Loaf` for `5 gold` sells three loaves
 * for 15. Nothing moves until it is taken, and then both sides move at once.
 */
export type Offer = {
	/** Who makes it. */
	from:string;
	/** Who it is for. Leave out for a standing offer to anyone. */
	to?:string;
	give:CountMap;
	get:CountMap;
};

/** An offer taken: the taker hands `pay` to its maker and receives `receive`. */
export type OfferMatch = { offer:Offer; pay:CountMap; receive:CountMap };

/** `Loaf` and `loaf` are one item. */
function key(name:string):string {
	return name.toLowerCase();
}

/** How many of `name` a bundle holds. */
export function countOf(bundle:CountMap, name:string):number {
	let n = 0;
	for (const [item, count] of Object.entries(bundle)) {
		if (count > 0 && key(item) === key(name)) {
			n += count;
		}
	}
	return n;
}

/** Whether a bundle holds nothing. */
export function isEmpty(bundle:CountMap):boolean {
	return !Object.values(bundle).some((count) => count > 0);
}

/** Whether `have` holds at least everything in `need`. */
export function covers(have:CountMap, need:CountMap):boolean {
	return Object.keys(need).every((name) => countOf(have, name) >= countOf(need, name));
}

export function times(bundle:CountMap, n:number):CountMap {
	const out:CountMap = {};
	for (const [name, count] of Object.entries(bundle)) {
		if (count > 0) {
			out[name] = count * n;
		}
	}
	return out;
}

/**
 * `5 gold`, `1 Loaf`, `3 Egg + 2 Milk`, or `nothing`; zero counts are left out. The count is always written, so a later
 * recall can tell one from many.
 */
export function bundleText(bundle:CountMap):string {
	const parts = Object.entries(bundle).filter(([, count]) => count > 0).map(([name, count]) => `${count} ${name}`);
	return parts.join(' + ') || 'nothing';
}

/** `1 Loaf for 5 gold`: what an offer gives, for what it gets. */
export function offerText(offer:Pick<Offer, 'give' | 'get'>):string {
	return `${bundleText(offer.give)} for ${bundleText(offer.get)}`;
}

/** How many lots of `offer` a taker who gives `give` for `get` takes: the fewest that cover `get`, if `give` pays for them; else 0. */
export function lots(offer:Offer, give:CountMap, get:CountMap):number {
	let n = 1;
	for (const name of Object.keys(get)) {
		const want = countOf(get, name);
		if (want <= 0) {
			continue;
		}
		const each = countOf(offer.give, name);
		if (each <= 0) {
			return 0;
		}
		n = Math.max(n, Math.ceil(want / each));
	}
	if (offer.to !== undefined && n > 1) {
		return 0;
	}
	return covers(give, times(offer.get, n)) ? n : 0;
}

/** Same goods on each side, whatever the counts: a new standing offer of them reprices the old one. */
export function sameGoods(a:Offer, b:Offer):boolean {
	const goods = (bundle:CountMap):string => Object.keys(bundle).filter((name) => bundle[name] > 0).map(key).sort().join(',');
	return goods(a.give) === goods(b.give) && goods(a.get) === goods(b.get);
}
