import { Time, distanceXZ, type GameObject } from '@arc-director/kindling';
import {
	DEFAULT_VERB_INSTRUCTIONS,
	STOCK_VERBS,
	type ArcResult,
	type RPGHost,
	type VerbCall,
	type VerbGate,
} from 'arc-director';
import { BODY_SLOTS, Appearance, MarketplaceGate, MarketplaceNPC, Wanted, Celebrating, type BodySlot, idOf } from '../engine/components';
import { removeFromBags, compactName } from '../items/inventory';
import { equipItem, unequipSlot } from '../items/equip';
import { USE_RANGE } from '../items/pickup';
import { approachSpot, overWater, Seated } from '../characters/Seated';
import type { GameHost } from './adapter';
import { readPage, useItem } from '../items/use';
import { findItem } from './items';
import { findObject, nameList } from './names';
import { ATTACKS, fightRole, isRival } from './fight';
import { STALL_LEASH } from '../world/constants';
import type { CharacterCtx } from './game-types';
import { Door, interactDoor } from '../kit/door/door';
import { Furniture, occupantNames } from '../kit/furniture/furniture';
import { findChestHolding, takeFromChest } from '../kit/chests/chest';

type Call = VerbCall<CharacterCtx>;

/** Every verb this game's NPCs may use, before a scene adds its own. */
export const GAME_VERBS = [...STOCK_VERBS, 'equip', 'unequip'];

/** Verb doctrine for scenes with buildings: going to a door stops outside it. */
export const BUILDING_VERB_INSTRUCTIONS = `${DEFAULT_VERB_INSTRUCTIONS} go_to a doorway is still outside; inside is the building.`;

function asSlot(raw:string):BodySlot | undefined {
	return (BODY_SLOTS as readonly string[]).includes(raw) ? raw as BodySlot : undefined;
}

/** What a fighter does to fight: once the scene is won, none of it. Walking and talking go on. */
const FIGHTING = new Set(['attack', 'block', 'protect', ...Object.keys(ATTACKS)]);

/** Steps this character may not take right now: a fight after its party won, any while it celebrates, or walking into a foe. */
export function verbGate(host:GameHost):VerbGate<CharacterCtx> {
	return ({ verb, ctx, args }) => {
		if (host.sceneState().bargainDone && FIGHTING.has(verb) && fightRole(host, ctx.character)) {
			return { status: 'stopped', verb, reason: 'won' };
		}
		const hop = ctx.character.getComponent(Celebrating);
		if (hop?.enabled && Time.time < hop.until) {
			return { status: 'stopped', verb, reason: 'celebrating' };
		}
		const foe = verb === 'go_to' && typeof args.target === 'string' ? findObject(ctx.world, args.target) : undefined;
		if (foe && isRival(host, ctx.character, foe)) {
			return { status: 'failed', verb, reason: (name) => `${name(idOf(foe))} is an enemy; go_to does not attack` };
		}
		const stall = stallBound(ctx, verb, args);
		if (stall) {
			return stall;
		}
		if (verb === 'go_to' && ctx.character.getComponent(MarketplaceNPC)?.kind === 'guard') {
			const raw = args.target;
			const dest = typeof raw === 'string' && raw ? findObject(ctx.world, raw) : undefined;
			if (dest?.getComponent(MarketplaceGate)) {
				return { status: 'failed', verb, reason: (name) => `stand beside ${name(idOf(dest))}` };
			}
		}
		return undefined;
	};
}

/** A vendor stays at the stall they spawned on. */
function stallBound(ctx:CharacterCtx, verb:string, args:Record<string, unknown>):ArcResult | undefined {
	const npc = ctx.character.getComponent(MarketplaceNPC);
	if (npc?.kind !== 'vendor' || !npc.post) {
		return undefined;
	}
	const roaming = verb === 'follow' || verb === 'wander' || verb === 'flee';
	const stepping = verb === 'go_to' || verb === 'offer';
	if (!roaming && !stepping) {
		return undefined;
	}
	if (roaming) {
		return { status: 'failed', verb, reason: `stay at ${npc.post}` };
	}
	const raw = verb === 'offer' ? args.to : args.target;
	const dest = typeof raw === 'string' && raw ? findObject(ctx.world, raw) : undefined;
	if (!dest) {
		return undefined;
	}
	const place = dest.transform.position;
	if (Math.hypot(place.x - npc.postX, place.z - npc.postZ) > STALL_LEASH) {
		return { status: 'failed', verb, reason: `stay at ${npc.post}` };
	}
	return undefined;
}

/** What this game's characters wear and hold, for `withRPG`. ArcDirector runs the stock world verbs through `withWorld`. */
export const BODY_VERBS:RPGHost<CharacterCtx> = {
	equip: ({ ctx, args }) => doEquip(ctx, args.item, args.slot),
	unequip: ({ ctx, args }) => doUnequip(ctx, args.slot),
};

/** How long a sleep lasts when the verb does not say, game seconds. */
const SLEEP_SECONDS = 300;

/** The `Furniture` of `kind` that fits, free or already its own, nearest `character`. */
function nearestFree(character:GameObject, kind:Furniture['kind'], fits:(seat:GameObject)=>boolean = () => true):GameObject | undefined {
	let best:GameObject | undefined;
	character.world?.forEachComponent(Furniture, (furniture, go) => {
		if (furniture.kind === kind && furniture.placeFor(character) >= 0 && fits(go) && (!best || distanceXZ(character, go) < distanceXZ(character, best))) {
			best = go;
		}
	});
	return best;
}

/**
 * Walks to beside `seat`, on whichever side is nearer, and settles on it from there, unless someone is on it by then.
 * The arc ends here: the body stays, and the mind may rest until something comes up.
 */
async function restOn(call:Call, seat:GameObject, opts:Parameters<Seated['settle']>[1]):Promise<ArcResult> {
	const name = idOf(seat);
	const body = call.ctx.character;
	if (body.getComponent(Seated)?.seatID !== seat.id) {
		const spot = approachSpot(seat, body);
		const walk = await (spot ? call.goToPoint([spot.x, spot.z]) : call.goTo(name));
		// In a tight room there may be no route to step along. Within arm's reach, it needs none.
		if (walk.status !== 'ok' && (walk.status === 'stopped' || distanceXZ(body, seat) > USE_RANGE)) {
			return { ...walk, verb: call.verb };
		}
	}
	if (seat.getComponent(Furniture)!.placeFor(body) < 0) {
		const on = occupantNames(seat);
		return { status: 'failed', verb: call.verb, reason: (who) => `${nameList(on.map(who))} ${on.length > 1 ? 'are' : 'is'} on ${name}` };
	}
	call.ctx.character.getComponent(Seated)?.settle(seat, opts);
	return { status: 'ok', verb: call.verb, reason: `on ${name}` };
}

/** The `Furniture` of `kind` that `name` calls for, or the nearest free one; or why there is none. */
function pickSeat(call:Call, kind:Furniture['kind'], name:string | undefined):GameObject | ArcResult {
	const seat = name ? findObject(call.ctx.world, name) : nearestFree(call.ctx.character, kind);
	if (seat?.getComponent(Furniture)?.kind === kind) {
		return seat;
	}
	return { status: 'failed', verb: call.verb, reason: name ? `${name} is not a ${kind}` : `no free ${kind}` };
}

/** Sitting and sleeping, for `withRPG` in a scene with chairs and beds. */
export const REST_VERBS:Pick<RPGHost<CharacterCtx>, 'sit' | 'sleep'> = {
	sit: (call) => {
		const seat = pickSeat(call, 'chair', call.args.target);
		return 'status' in seat ? seat : restOn(call, seat, {});
	},
	sleep: (call) => {
		const bed = pickSeat(call, 'bed', call.args.target);
		return 'status' in bed ? bed : restOn(call, bed, { seconds: call.args.seconds ?? SLEEP_SECONDS });
	},
};

/** Fishing, for a scene with a chair looking out over water: rod out from the nearest free one until the body walks off. */
export const FISH_VERB = {
	help: 'goes to the chair by the river and fishes until you walk off; a catch goes in your pack',
	seen: 'fishing',
	handler: (call:Call):ArcResult | Promise<ArcResult> => {
		const seat = nearestFree(call.ctx.character, 'chair', overWater);
		return seat ? restOn(call, seat, { rod: true }) : { status: 'failed', verb: 'fish', reason: 'no free chair by the water' };
	},
};

/** Fetches the book `name` from the shelf that holds it and comes back to the seat it got up from, if any. Says why not, if it cannot. */
async function fetchBook(call:Call, name:string):Promise<ArcResult | undefined> {
	const { character, world } = call.ctx;
	const held = findChestHolding(world, name);
	if (!held) {
		return { status: 'failed', verb: 'read', reason: `no book called ${name} here` };
	}
	const seatID = character.getComponent(Seated)?.seatID;
	const walk = await call.goTo(idOf(held.chest));
	if (walk.status !== 'ok') {
		return { ...walk, verb: 'read' };
	}
	const taken = takeFromChest(character, held);
	if (!findItem(character, name)) {
		return { status: 'failed', verb: 'read', reason: taken };
	}
	character.getComponent(Appearance)?.playClip('take', Time.time, held.chest);
	const seat = seatID ? world.findByID(seatID) : undefined;
	return seat ? restOn(call, seat, {}).then((back) => (back.status === 'ok' ? undefined : back)) : undefined;
}

/**
 * Settles down with the book `name`, fetching it first if it is not carried, and says what the page said. It reads on
 * until it walks off or the sitting is over, and owes no next think: the mind stays with the book until a watch wakes it.
 */
export async function doRead(call:Call, name:string):Promise<ArcResult> {
	const fetching = findItem(call.ctx.character, name) ? undefined : await fetchBook(call, name);
	if (fetching) {
		return fetching;
	}
	const book = findItem(call.ctx.character, name);
	if (!book || !readPage(book)) {
		return { status: 'failed', verb: 'read', reason: `${name} is not a book` };
	}
	const read = useItem(call.ctx.character, book, null);
	return { status: read.ok ? 'ok' : 'failed', verb: 'read', reason: read.reason };
}

/** Walks to the door `name` and shuts it. Anyone can: a lock only has a say in opening it. */
export async function doClose(call:Call, name:string):Promise<ArcResult> {
	const door = findObject(call.ctx.world, name);
	if (!door?.getComponent(Door)) {
		return { status: 'failed', verb: 'close', reason: `${name} is not a door` };
	}
	if (!door.getComponent(Door)?.open) {
		return { status: 'ok', verb: 'close', reason: `${name} is already shut` };
	}
	const walk = await call.goTo(name);
	if (walk.status !== 'ok') {
		return { ...walk, verb: 'close' };
	}
	interactDoor(call.ctx.character, door);
	return { status: 'ok', verb: 'close' };
}

async function doEquip(ctx:CharacterCtx, itemName:string, slotName?:string):Promise<ArcResult> {
	const item = findItem(ctx.character, itemName);
	if (!item) {
		return { status: 'failed', verb: 'equip', reason: `not carrying ${itemName}` };
	}
	const slot = slotName ? asSlot(slotName) : undefined;
	if (slotName && !slot) {
		return { status: 'failed', verb: 'equip', reason: `no slot ${slotName}` };
	}
	const err = equipItem(ctx.character, item, ctx.world, slot);
	if (err) {
		return { status: 'failed', verb: 'equip', reason: err };
	}
	removeFromBags(ctx.character, item);
	return { status: 'ok', verb: 'equip' };
}

async function doUnequip(ctx:CharacterCtx, slotName:string):Promise<ArcResult> {
	const slot = asSlot(slotName);
	if (!slot) {
		return { status: 'failed', verb: 'unequip', reason: `no slot ${slotName}` };
	}
	unequipSlot(ctx.character, slot, ctx.world);
	return { status: 'ok', verb: 'unequip' };
}

/** Marks `thief` wanted for taking `item` from `fromID`, where the scene allows theft and it is no guard; whether it did. */
export function markThief(host:GameHost, thief:GameObject, item:string, fromID:string, reason:string):boolean {
	if (!host.hooks.allowTheft || thief.getComponent(MarketplaceNPC)?.kind === 'guard') {
		return false;
	}
	const mark = thief.getOrAddComponent(Wanted);
	mark.enabled = true;
	mark.reason = reason;
	if (fromID) {
		mark.fromID = fromID;
	}
	if (!mark.items.some((it) => compactName(it) === compactName(item))) {
		mark.items.push(item);
	}
	host.world.setMessage(`Theft — ${idOf(thief)} took ${item}`);
	return true;
}
