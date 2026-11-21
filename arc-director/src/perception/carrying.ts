import type { ArcDirector } from '../director/ArcDirector.js';
import { Feature } from '../director/Feature.js';

export type Inventory = {
	worn?:Record<string, string>;
	purse?:number;
	pockets?:string[];
	pack?:{ name:string; items:string[] };
};

const ALL = 'Nothing else: what is not listed, you do not have.';

/**
 * Ends by saying the list is all there is, so a mind does not carry what its role says it often has.
 * `currency` (the `currency` setting, `withMind`) counts the purse.
 */
export function formatInventory(bag:Inventory = {}, currency?:string):string {
	const lines:string[] = [];
	if (bag.worn) {
		for (const [slot, label] of Object.entries(bag.worn)) {
			if (label) {
				lines.push(`${slot}: ${label}`);
			}
		}
	}
	if (bag.purse !== undefined) {
		lines.push(currency ? `Purse: ${bag.purse} ${currency}` : `Purse: ${bag.purse}`);
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

/** What characters wear and carry: the host's `look` from a character's context, shown to its mind as the `carrying` sense. */
export class InventoryFeature<TCtx = unknown> extends Feature<TCtx> {
	constructor(private _look:(ctx:TCtx)=>Inventory) {
		super();
	}

	/** Look with `look` from now on. */
	public configure(look:(ctx:TCtx)=>Inventory):this {
		this._look = look;
		return this;
	}

	public override install():void {
		// A collective with no commander carries nothing of its own: its units do.
		this.director.withSenses((s) => s.add('carrying', (ctx) => (ctx === undefined ? undefined : formatInventory(this.inventoryOf(ctx), this.director.mindDefaults.currency))));
	}

	/** What the character whose context is `ctx` wears and carries. */
	public inventoryOf(ctx:TCtx):Inventory {
		return this._look(ctx);
	}

	/** Everything the character whose context is `ctx` wears and carries, its purse aside. */
	public carried(ctx:TCtx):string[] {
		const bag = this.inventoryOf(ctx);
		return [...bag.pockets ?? [], ...bag.pack?.items ?? [], ...Object.values(bag.worn ?? {})];
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link InventoryFeature}. */
		withInventory(look:(ctx:TCtx)=>Inventory):this;
		getInventory():InventoryFeature<TCtx> | undefined;
	}
}
export function withInventory<TCtx>(this:ArcDirector<TCtx>, look:(ctx:TCtx)=>Inventory):ArcDirector<TCtx> {
	return this.configureFeature(InventoryFeature<TCtx>, () => new InventoryFeature<TCtx>(look), (inventory) => inventory.configure(look));
}
