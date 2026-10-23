import type { Deal } from './deal.js';

/**
 * A position or a direction in world space, as many numbers as the game has dimensions (1D, 2D, 3D); the
 * game uses the same count everywhere. Units are the game's own; ArcDirector only compares and adds them.
 * A position is always called `point`; a direction is named for where it points (`facing`, `right`, `up`)
 * and is a unit vector.
 */
export type Vec = number[];

/** Where a character or thing is and, if it faces, which way. */
export interface Pose {
	/** Where it is. */
	point:Vec;
	/** Unit direction it faces. Leave out for things that do not face. */
	facing?:Vec;
	/** Unit direction of its right hand, so left and right mean what the game means. Leave out for things that do not face. */
	right?:Vec;
}

/** What `canPass` says of a way it lets through, or of one something stops for now. */
export interface PathStep {
	/**
	 * What the step costs. Default: its length. Never less than its length, so the search stays exact;
	 * raise it to route around crowds or rough ground.
	 */
	cost?:number;
	/**
	 * What stops this step right now, for this character ("EastDoor is locked — you carry IronKey"). The search
	 * avoids it; with no open way, the move fails naming each blocker that leads there, cheapest first.
	 */
	blocked?:string;
	/** The character or thing that blocks it, when one does (a foe's wall): a failed move lists it in `blockedBy`. */
	by?:string;
}

/** What the world says to a command. */
export interface Outcome {
	/** Done, or refused. */
	ok:boolean;
	/** Why, in words the agent can act on: "Chest is locked", "no room". */
	reason?:string;
}

/**
 * One thing changing hands: picked up, put down, given, paid, traded or stolen. A thing is whatever the game lets
 * move: an item, gold, a house deed, a promise of work. What each name means is the game's call.
 */
export interface Transfer<TEntity> {
	/** The verb that moves it, which says who acts: `pick_up`, `drop`, `give`, `offer`, or the game's own, such as `steal`. */
	verb:string;
	/** The thing's id, as the model wrote it. Which one is meant depends on where it is, and that is the game's call. */
	thing:string;
	/**
	 * What holds it now: a character, a chest, or the thing itself where it lies. For `pick_up`, the holder the model
	 * named, else the one the character sees it in, else `find(thing)`.
	 */
	from:TEntity;
	/** Who or what holds it after: a character, or a chest it is put in. Left out, it is put down where `from` is. */
	to?:TEntity;
	/** How many. Default 1. */
	quantity?:number;
}

/**
 * Tags that mean the same to every part of the library, in every sight row. A host adds any others it likes; these it
 * should not use for anything else.
 */
export const RESERVED_TAGS = {
	/** Carried and picked up. */
	item: 'item',
	/** Fixed in place: what other things are placed relative to. */
	landmark: 'landmark',
	/** Someone who acts: listed first in sight, and never what other things are placed relative to. */
	character: 'character',
} as const;

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
 * | `getNeighbors`, `canPass`, `steerToward` | `go_to`, `follow`, `wander`, crowd formations, `pathDistance` / `isReachable`, `call.goTo` |
 * | `canPass` | what sight sees and what sounds are muffled; the watch function `hasSightline` |
 * | `transfer` (and `validateTransfer`, for the game's rules) | `pick_up`, `drop`, `give`, `offer` |
 * | `useItem` | `use` |
 * | `getDescription` | `examine` |
 */
export interface HostWorld<TEntity> {
	// Queries

	/**
	 * The entity an id names: a character, a thing, a place, or an item (an item in a chest or a pack is found as
	 * its holder, since that is where it is).
	 * @returns `undefined` when there is no such thing, or it is gone. The library then fails the verb with
	 * "no such …" or "… is gone", so no other part needs to check.
	 */
	find(id:string):TEntity | undefined;
	/**
	 * Where `entity` is now. `from`: who is going there, so a thing spread over many cells (a forest, a wall) can answer
	 * with its part nearest them; ignore it for a thing in one place.
	 * @returns `undefined` when it has no place right now.
	 */
	getPose(entity:TEntity, from?:TEntity):Pose | undefined;
	/**
	 * Whether the character `id` names is down: dead, knocked out or destroyed. A collective's `units` and roster leave
	 * it out (its prompt lists it under "Down:"), and a verb aimed at it fails with "… is down", not "… is gone".
	 * Default: no one is ever down, and only `find` says who is gone.
	 */
	isDown?(id:string):boolean;
	/**
	 * The points one step from `point`: a grid's cells around it, a navmesh's adjacent polygons, a waypoint network's
	 * links. Only the shape of the world, the same whoever asks and whatever stands open: `canPass` says which steps
	 * are open, and to whom. `point` need not be one it named, since a route starts wherever a character stands.
	 */
	getNeighbors?(point:Vec):Vec[];
	/**
	 * Whether `what` gets straight from `a` to `b` now: a character walking (the character itself, so its size and
	 * what it carries count), or `light` (sight) or `sound` (hearing). The one place the game decides what stops
	 * what. A walk asks it of each step to a neighbor, the way it is walked, so a ledge one may drop off but not climb
	 * answers each way differently; sight and sound ask it across a room. Nothing standing at `a` stops it, and for
	 * light and sound nothing standing at `b` either: no one hides themselves, or the one looking.
	 * @returns `{ cost }` when open (more than its length for a crowd or rough ground), `{ blocked, by }` when
	 * something stops it for now and says how to get past, `undefined` when it never gets through. Without it, nothing
	 * stops sight or sound, and no one walks.
	 */
	canPass?(what:'light' | 'sound' | TEntity, a:Vec, b:Vec):PathStep | undefined;
	/**
	 * How close `character` must be to `target` to act on it, and to count as there.
	 * @returns A distance. Default 1.
	 */
	getReach?(character:TEntity, target:TEntity):number;
	/**
	 * What `character` learns by examining `target`.
	 * @param target An id, not an entity: it may name an item, and which one is meant depends on whose pack it is in.
	 * @returns `undefined` when it cannot be examined from here.
	 */
	getDescription?(character:TEntity, target:string):string | undefined;
	/**
	 * Why `move` cannot happen, or nothing when it can: the game's rules for what may change hands, such as who owns
	 * a house, a locked chest, or a full pack. Every move is checked just before it is made, so the world already
	 * holds the moves before it in its `deal`. An offer is checked when it is posted too, as a dry run.
	 * @returns The reason, in words the agent can act on: "Mira's pack is full", "Realtor does not own Bridge".
	 * Default: every move may happen.
	 */
	validateTransfer?(move:Transfer<TEntity>, deal:Deal<TEntity>):string | undefined;
	/**
	 * Whether `character` may make an offer to `other`, and that offer still stands. Default: `other` is in its sight
	 * (`withSight`), else light passes between them (`canPass`).
	 */
	canOffer?(character:TEntity, other:TEntity):boolean;
	/**
	 * Whether `character` may go and pick up `item` from `from`: the item where it lies, or what holds it. Default:
	 * `item` is in its sight there (`withSight`), else light passes between it and `from` (`canPass`).
	 * Return true to let characters fetch what they cannot see (what is in a shut chest), and undefined to leave it to
	 * the default.
	 */
	canPickUp?(character:TEntity, item:string, from:TEntity):boolean | undefined;
	/** World up, a unit direction, for formations in 3D. Default `[0, 1, 0]`. Unused in 1D and 2D. */
	up?:Vec;

	// Commands

	/**
	 * Move `character` toward `point`, or stand still. Called every tick while a character moves, with the next
	 * waypoint. The game owns speed, collisions, animation, and how close counts as there.
	 * @param point A position, not a direction. `null` = stand still.
	 * @returns Whether the character is at `point` by the motor's own measure; that sends it on to the next waypoint.
	 */
	steerToward?(character:TEntity, point:Vec | null):boolean;
	/**
	 * Make `move`, which `validateTransfer` allowed. Throw only on a real error: the rules are already checked.
	 * @returns How to take it back. The library calls it only when a later move in the same deal fails, so the
	 * deal moves whole or not at all.
	 */
	transfer?(move:Transfer<TEntity>):()=>void;
	/**
	 * Use a carried `item`, on `target` if given. Both are ids as the model wrote them, so a target in someone's hands
	 * is still that thing, not its holder (`find` gives the holder): the world tells what is meant, as for `item`.
	 * @param target Already in reach of `character`.
	 */
	useItem?(character:TEntity, item:string, target?:string):Outcome;
}
