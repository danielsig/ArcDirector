import type { CountMap } from '../arc/types.js';
import type { Vec } from '../world/types.js';
import type { StockRTSVerb } from './verbs.js';

/** A game's own name for a stock RTS verb, and for its args: `gather(from)` as `harvest(source)`. */
export type VerbName = { name:string; args?:Readonly<Record<string, string>>; help?:string };

/**
 * One kind of thing in an RTS (a unit, building, tech or resource node), as plain data. The library reads it to check
 * prerequisites and costs, run queues, count supply and pick each unit's verbs; the game writes no code for any of that.
 */
export type KindSpec = {
	cost?:CountMap;
	/** Seconds to train, research, or build. */
	seconds?:number;
	/** Supply it takes. */
	supply?:number;
	/** Supply cap it adds once built. */
	provides?:number;
	/** Building kinds that train or research it. */
	madeAt?:readonly string[];
	/** Kinds or techs it needs first. */
	requires?:readonly string[];
	/** How far it attacks. Units with a range get the fighting verbs. */
	range?:number;
	/** A building or transport units go into. */
	holds?:{ capacity:number; kinds?:readonly string[] };
	/** Jobs a building has for `staff`. */
	slots?:number;
	/**
	 * `Worker`, `Building`, `Tech`, `Wall` (what `wall` lays), `Gate` (a wall piece its own side walks through),
	 * `Bridge` (what `bridge` lays over water),
	 * `DropOff:<resource>` (takes that resource back), `Node:<resource>` (that resource is gathered from it). Tags other than `DropOff:` / `Node:` are the unit's tags in `units.filter("…")`.
	 */
	tags?:readonly string[];
	/** The game's own verbs units of this kind have (abilities), beside the stock ones. */
	verbs?:readonly string[];
};

/** How one tick of work went. `stop` ends the work with that reason ("GoldMine3 is empty", "out of Wood"). */
export type WorkDone = { full?:boolean; done?:boolean; stop?:string };

/** A policy `set_policy` can change, and what it needs first. */
export type PolicySpec = { options:readonly string[]; requires?:readonly string[] };

/**
 * What an RTS gives ArcDirector (`withRTS`): its kinds as data and a few primitives, each acting once, right now. The
 * library runs every stock RTS verb on top of them: who does the work, routes, queues, timers, supply, target picking,
 * and the reasons a failure gives. Sides are named by their collective's id.
 */
export type RTSHost = {
	kinds:Readonly<Record<string, KindSpec>>;
	/** What `id` is and whose: any unit, building, site, node or thing. `undefined` when it is gone. */
	describe(id:string):{ kind:string; owner?:string } | undefined;
	/** Everything `side` knows of now, seen or explored: where it looks for nodes. */
	known(side:string):readonly string[];
	getStock(side:string):CountMap;
	/** Add `bundle` to `side`'s stock; a negative count takes it away. */
	addStock(side:string, bundle:CountMap):void;
	/**
	 * Lay out a site for `kind` near `near` (or near `builder`), built by nobody yet; or exactly `at`, a cell of a wall
	 * the library traces. Its id, or why not (blocked, taken).
	 */
	placeSite(kind:string, near:string | undefined, builder:string, at?:Vec):string | { reason:string };
	/** Take an unfinished site down. Without it, only queued things can be cancelled. */
	removeSite?(site:string):void;
	/** `seconds` of `unit`'s work at `target`: harvest a node, build a site, repair, or work a job. */
	work(unit:string, target:string, seconds:number):WorkDone;
	/** `unit` hands over what it carries at `at`: to its side's stock, or into a building. What it handed over. */
	deposit(unit:string, at:string):CountMap;
	/** A new `kind` out of `building`. Its id. */
	spawn(building:string, kind:string):string;
	applyTech(side:string, tech:string):void;
	/** `seconds` of `unit` attacking `target`. Whether `target` was in range. */
	attack(unit:string, target:string, seconds:number):boolean;
	enter(unit:string, container:string):void;
	exit(unit:string, container:string):void;
	/** Default: no two sides are allies. */
	areAllies?(a:string, b:string):boolean;
	/** `unit` takes up to a load of `good` out of `from`. How many it took. For `haul`. */
	withdraw?(unit:string, from:string, good:string):number;
	/** How many of `good` `building` holds. For `haul`. */
	holding?(building:string, good:string):number;
	policies?:Readonly<Record<string, PolicySpec>>;
	setPolicy?(side:string, name:string, value:string):void;
	/** Highest supply cap, whatever is built. */
	maxSupply?:number;
	/**
	 * What the game calls the cap on its units (`Supply`, `Population`, `Energy`, `Farms`): the commander's status
	 * line, the watch bindings (`energy`, `energyCap`), and `supply_ahead`'s help. Default `Supply`. A game whose
	 * kinds `provide` none has no cap: no line, no bindings, no `supply_ahead`.
	 */
	supplyName?:string;
	/** Share of an unfinished building's cost a `cancel` gives back. Default 0.5. */
	salvage?:number;
	/** How far a unit leaves its way to fight what it meets, beyond its range. Default 6. */
	chase?:number;
	/** Share of a `tribute` that arrives. Default 1. */
	tributeShare?:number;
	/**
	 * The game's own names for stock verbs (`gather` → `harvest`). The model sees only these; each runs its stock verb,
	 * and units' kits carry the game's names.
	 */
	verbNames?:Readonly<Partial<Record<StockRTSVerb, VerbName>>>;
};
