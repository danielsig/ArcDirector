import type { CountMap } from '../arc/types.js';

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

function times(bundle:CountMap, n:number):CountMap {
	const out:CountMap = {};
	for (const [name, count] of Object.entries(bundle)) {
		if (count > 0) {
			out[name] = count * n;
		}
	}
	return out;
}

/** `5 gold`, `1 Loaf`, `3 Egg and 2 Milk`, or `nothing`. The count is always written, so a later recall can tell one from many. */
export function bundleText(bundle:CountMap):string {
	const parts = Object.entries(bundle).filter(([, count]) => count > 0).map(([name, count]) => `${count} ${name}`);
	return parts.join(' and ') || 'nothing';
}

/** `1 Loaf for 5 gold`: what an offer gives, for what it gets. */
export function offerText(offer:Pick<Offer, 'give' | 'get'>):string {
	return `${bundleText(offer.give)} for ${bundleText(offer.get)}`;
}

/** How many lots of `offer` a taker who gives `give` for `get` takes: the fewest that cover `get`, if `give` pays for them; else 0. */
function lots(offer:Offer, give:CountMap, get:CountMap):number {
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
function sameGoods(a:Offer, b:Offer):boolean {
	const goods = (bundle:CountMap):string => Object.keys(bundle).filter((name) => bundle[name] > 0).map(key).sort().join(',');
	return goods(a.give) === goods(b.give) && goods(a.get) === goods(b.get);
}

/** Every open offer in the scene. Characters make them with the `offer` verb; the host may post standing ones too. */
export class OfferBook {
	private _offers:Offer[] = [];

	/** Every offer, standing ones and ones to someone. */
	public get all():readonly Offer[] {
		return this._offers;
	}

	/**
	 * Make `offer`, in place of what its maker offered the same one before: an offer to someone replaces the last one
	 * to them, and a standing offer replaces the standing one of the same goods. Giving and getting nothing withdraws
	 * every such offer: to `to`, or each standing one.
	 */
	public post(offer:Offer):void {
		const withdraw = isEmpty(offer.give) && isEmpty(offer.get);
		this._offers = this._offers.filter((old) => old.from !== offer.from || old.to !== offer.to
			|| (offer.to === undefined && !withdraw && !sameGoods(old, offer)));
		if (!withdraw) {
			this._offers.push({ ...offer, give: { ...offer.give }, get: { ...offer.get } });
		}
	}

	/**
	 * `maker`'s offer that a taker who gives `give` for `get` agrees to: the one it made to `taker`, else a standing one.
	 * Undefined when none does.
	 */
	public match(taker:string, maker:string, give:CountMap, get:CountMap):OfferMatch | undefined {
		const theirs = this._offers.filter((offer) => offer.from === maker && (offer.to === taker || offer.to === undefined));
		theirs.sort((a, b) => Number(a.to === undefined) - Number(b.to === undefined));
		for (const offer of theirs) {
			const n = lots(offer, give, get);
			if (n > 0) {
				return { offer, pay: times(offer.get, n), receive: times(offer.give, n) };
			}
		}
		return undefined;
	}

	/** `taker` took `match`: an offer made to them is used up, and so is theirs back. A standing offer stays. */
	public settle(taker:string, match:OfferMatch):void {
		const maker = match.offer.from;
		this._offers = this._offers.filter((offer) => offer !== match.offer || offer.to === undefined)
			.filter((offer) => offer.from !== taker || offer.to !== maker);
	}

	/** Keep only the offers `live` passes. */
	public prune(live:(offer:Offer)=>boolean):void {
		this._offers = this._offers.filter(live);
	}

	/** Forget every offer by or to `id`: it left the scene. */
	public drop(id:string):void {
		this.prune((offer) => offer.from !== id && offer.to !== id);
	}

	public clear():void {
		this._offers = [];
	}

	public toJSON():Offer[] {
		return this._offers.map((offer) => ({ ...offer, give: { ...offer.give }, get: { ...offer.get } }));
	}

	public load(offers:readonly Offer[]):void {
		this.clear();
		for (const offer of offers) {
			this.post(offer);
		}
	}
}
