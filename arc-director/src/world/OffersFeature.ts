import type { CountMap } from '../arc/arc-types.js';
import type { ArcRunner } from '../character/arc-runner.js';
import { Collective } from '../collective/Collective.js';
import { Feature, type PromptPart } from '../director/Feature.js';
import type { Mind } from '../mind/mind.js';
import { SightFeature } from '../perception/SightFeature.js';
import { inLineOfSight } from './lookup.js';
import { isEmpty, lots, offerText, sameGoods, times, type Offer, type OfferMatch } from './offers.js';

/**
 * Every open offer in the scene (`director.offers`, saved with the cast). Characters make them with the `offer` verb, a
 * character spec's `offers` stand from the start, and the host may post its own. Each mind is shown every standing
 * offer and each one by or to a character it thinks for.
 */
export class OffersFeature<TCtx = unknown> extends Feature<TCtx> {
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

	public toJSON():Offer[] {
		return this._offers.map((offer) => ({ ...offer, give: { ...offer.give }, get: { ...offer.get } }));
	}

	/** Every offer in `offers`, and no other. */
	public load(offers:readonly Offer[]):void {
		this._offers = [];
		for (const offer of offers) {
			this.post(offer);
		}
	}

	/** Whether character `fromID` may make an offer to `toID`: the host's `canOffer`, else in its sight, else in its line of sight, else yes. */
	public canOffer(fromID:string, toID:string):boolean {
		const world = this.director.world;
		if (world?.canOffer) {
			const from = world.find(fromID);
			const to = world.find(toID);
			return from !== undefined && to !== undefined && world.canOffer(from, to);
		}
		return this.director.getFeature(SightFeature)?.sees(fromID, toID) ?? inLineOfSight(world, fromID, toID);
	}

	/** The offers, without those to someone their maker may no longer make. */
	public live():this {
		this.prune((offer) => offer.to === undefined || this.canOffer(offer.from, offer.to));
		return this;
	}

	/** Its offers go with a character that left the scene. */
	public override runnerRemoved(runner:ArcRunner<TCtx>):void {
		this.prune((offer) => offer.from !== runner.id && offer.to !== runner.id);
	}

	/** A collective with no body of its own does not have `offer` (its units do), and it still has to see the prices to send them. */
	public override promptPart(mind:Mind<TCtx>):PromptPart {
		const owner = mind.owner;
		const traders = owner instanceof Collective ? [owner, ...owner.characters] : [owner];
		if (!traders.some((runner) => runner.activeVerbs().has('offer'))) {
			return {};
		}
		const mine = new Set(traders.map((runner) => runner.id));
		const voice = mind.voice.id;
		const name = (id:string):string => (id === voice ? 'you' : mind.nameOf(id));
		const offers = this.live().all
			.filter((offer) => offer.to === undefined || mine.has(offer.from) || mine.has(offer.to))
			.map((offer) => {
				const who = offer.from === voice ? 'You offer' : `${name(offer.from)} offers`;
				return offer.to === undefined
					? `- ${who} ${offerText(offer)} to anyone`
					: `- ${who} ${name(offer.to)} ${offerText(offer)}`;
			});
		return { offers: offers.join('\n') };
	}
}
