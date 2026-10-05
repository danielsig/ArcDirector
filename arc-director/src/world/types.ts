/**
 * A position or a direction in world space, as many numbers as the game has dimensions (1D, 2D, 3D); the
 * game uses the same count everywhere. Units are the game's own; ArcDirector only compares and adds them.
 * A position is always called `point`; a direction is named for where it points (`facing`, `right`, `up`)
 * and is a unit vector.
 */
export type Vec = number[];

/** Where a body or thing is and, if it faces, which way. */
export interface Pose {
	/** Where it is. */
	point:Vec;
	/** Unit direction it faces. Leave out for things that do not face. */
	facing?:Vec;
	/** Unit direction of its right hand, so left and right mean what the game means. Leave out for things that do not face. */
	right?:Vec;
}

/** One step a body can take. */
export interface PathStep {
	/** Where the step lands. */
	point:Vec;
	/**
	 * What the step costs. Default: its length. Never less than its length, so the search stays exact;
	 * raise it to route around crowds or rough ground.
	 */
	cost?:number;
	/**
	 * What stops this step right now, for this body ("EastDoor is locked — you carry IronKey"). The search
	 * avoids it; with no open way, the move fails naming each blocker that leads there, cheapest first.
	 */
	blocked?:string;
}

/** What the world says to a command. */
export interface Outcome {
	/** Done, or refused. */
	ok:boolean;
	/** Why, in words the agent can act on: "Chest is locked", "no room". */
	reason?:string;
}

/** One item changing hands, or put down. */
export interface ItemMove<TEntity> {
	/** The body doing it. */
	actor:TEntity;
	/** The item's id. Items stay ids: which one is meant depends on whose pack it is in, and that is the game's call. */
	item:string;
	/** The new holder. Leave out to put the item down where `actor` is. */
	to?:TEntity;
}

/** One sale, asked for by one side. Both sides are in reach. */
export interface Deal<TEntity> {
	/** The side that asked. */
	actor:TEntity;
	/** What `actor` does: pays and gets the items (`buy`), or gives them and gets paid (`sell`). */
	side:'buy' | 'sell';
	/** The other side. */
	other:TEntity;
	/** The item's id. */
	item:string;
	/** How many of `item` change hands, at least 1. */
	quantity:number;
	/** Total for all of them that `actor` offers or asks, if it named one. Without it the game's own price stands. */
	price?:number;
}

/**
 * The game's world, as the stock verbs need it. `TEntity` is whatever the game uses for things in its world
 * (a GameObject, an entity id, a record); ArcDirector never looks inside one. `find` is the only place an id
 * becomes an entity, and every other part receives entities.
 *
 * Each part unlocks verbs; a kit that grants a verb whose part is missing fails at `start()`. Queries
 * (`find`, `get…`, `up`) only read the world and may be called any time, often. Commands (the rest) change
 * the world; they announce what happened with `pushEvent`, as the game does when the player acts.
 *
 * | Part | Unlocks |
 * |--|--|
 * | `find`, `getPose` | watch geometry: `distance`, `nearby`, `isFacing`, `isLeft` / `isRight`, `manhattan`, … |
 * | `getPathGraph`, `steerToward` | `go_to`, `follow`, `wander`, crowd formations, `pathDistance` / `isReachable`, `call.goTo` |
 * | `moveItem` | `pick_up`, `drop`, `give` |
 * | `useItem` | `use` |
 * | `getDescription` | `examine` |
 * | `trade` | `buy`, `sell` |
 */
export interface HostWorld<TEntity> {
	// Queries

	/**
	 * The entity an id names: a body, a thing, a place, or an item (an item in a chest or a pack is found as
	 * its holder, since that is where it is).
	 * @returns `undefined` when there is no such thing, or it is gone. The library then fails the verb with
	 * "no such …" or "… is gone", so no other part needs to check.
	 */
	find(id:string):TEntity | undefined;
	/**
	 * Where `entity` is now.
	 * @returns `undefined` when it has no place right now.
	 */
	getPose(entity:TEntity):Pose | undefined;
	/**
	 * The steps `actor` can take, for one search. Called once per search, so it can gather what it needs
	 * (blocked cells, crowded ones) before the search asks. Bodies differ: a child fits a gap a knight does not.
	 * @returns Steps from any `point`: grid neighbors, navmesh neighbors, or the waypoints of a network in
	 * sight of it, as many as there are. `point` need not be one a step named: a route starts where the body
	 * stands and ends through the steps out of the destination, taken backwards.
	 */
	getPathGraph?(actor:TEntity):(point:Vec)=>PathStep[];
	/**
	 * How close `actor` must be to `target` to act on it, and to count as there.
	 * @returns A distance. Default 1.
	 */
	getReach?(actor:TEntity, target:TEntity):number;
	/**
	 * What `actor` learns by examining `target`.
	 * @param target An id, not an entity: it may name an item, and which one is meant depends on whose pack it is in.
	 * @returns `undefined` when it cannot be examined from here.
	 */
	getDescription?(actor:TEntity, target:string):string | undefined;
	/** World up, a unit direction, for formations in 3D. Default `[0, 1, 0]`. Unused in 1D and 2D. */
	up?:Vec;

	// Commands

	/**
	 * Move `actor` toward `point`, or stand still. Called every tick while a body moves, with the next
	 * waypoint. The game owns speed, collisions, animation, and how close counts as there.
	 * @param point A position, not a direction. `null` = stand still.
	 * @returns Whether the body is at `point` by the motor's own measure; that sends it on to the next waypoint.
	 */
	steerToward?(actor:TEntity, point:Vec | null):boolean;
	/** Hand an item over, or put it down. Refuse with a reason the agent can act on. */
	moveItem?(move:ItemMove<TEntity>):Outcome;
	/**
	 * Use a carried `item`, on `target` if given.
	 * @param target Already in reach of `actor`.
	 */
	useItem?(actor:TEntity, item:string, target?:TEntity):Outcome;
	/** Buy or sell. Say the price in the reason ("bought 2 Bread from Mira for 10 gold"). */
	trade?(deal:Deal<TEntity>):Outcome;
}
