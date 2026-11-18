import { distanceXZ, type GameObject } from '@arc-director/kindling';
import { showNamingText, type NamingText } from 'arc-director';
import { BrewHearth, Bridge, BridgeLever, Chest, Door, Flammable, HumanBody, Lock, Named, Sickbed, Vitals } from '../engine/components';
import { equipItem, itemInHeldSlot } from './equip';
import { characterIs, findCarried, healCharacter, inBackpack, removeFromBags, tryInsert } from './inventory';
import { instantiateDef, type ItemInstance } from './instance';
import { getDef } from './defs';
import { keyNameFor, lockedReason } from './pickup';
import { Belly } from '../engine/Belly';
import { Reading } from '../characters/Reading';
import { cueAt } from '../audio/cue';
import { applyHit } from '../director/hit-feel';
import { idOf } from '../director/names';
import { ATTACKS, guardStops, weaknessDamage } from '../director/fight';

/** A page of the book `item`, if it is one, at random. */
export function readPage(item:ItemInstance):string | undefined {
	const pages = getDef(item.defID).components.Book?.pages;
	return pages?.[Math.floor(Math.random() * pages.length)];
}

export type UseResult = {
	ok:boolean;
	/** What came of it, naming by id: a mind reads it in its own names, the player's HUD as ids (`showNamingText`). */
	reason:NamingText;
};

function fail(reason:NamingText):UseResult {
	return { ok: false, reason };
}

function ok(reason = ''):UseResult {
	return { ok: true, reason };
}

/** A potion goes down without filling anyone; everything else one consumes is a meal. */
function isDrink(item:ItemInstance):boolean {
	return item.Consumable?.effect === 'heal';
}

/** Whether `item` is something to eat. */
export function isFood(item:ItemInstance):boolean {
	return !!item.Consumable && !isDrink(item);
}

function consume(character:GameObject, item:ItemInstance):void {
	item.count -= 1;
	if (item.count > 0) {
		return;
	}
	removeFromBags(character, item);
	const human = character.getComponent(HumanBody);
	if (!human) {
		return;
	}
	for (const slot of Object.keys(human.slots) as Array<keyof typeof human.slots>) {
		if (human.slots[slot] === item) {
			human.slots[slot] = null;
		}
	}
}

function brewAtHearth(character:GameObject, item:ItemInstance):UseResult {
	const brew = item.Ingredient;
	if (!brew) {
		return fail('nothing to brew');
	}
	if (!characterIs(character, brew.brewer)) {
		return fail(`only ${brew.brewer} can brew`);
	}
	const fee = findCarried(character, (it) => it.defID === brew.fee);
	if (!fee) {
		return fail('unpaid — need GoldCoin as the fee');
	}
	const potion = instantiateDef(getDef(brew.brew), brew.yield);
	potion.name = 'MagicPotion';
	potion.id = 'MagicPotion';
	if (!tryInsert(character, potion)) {
		return fail('no room for the brew');
	}
	consume(character, item);
	return ok(`brewed ${brew.yield} MagicPotion`);
}

/** Whether `target` is within reach of weapon `item` swung (or shot) with `verb`: the longer of the two. */
export function inReach(character:GameObject, item:ItemInstance, target:GameObject, verb?:string):boolean {
	const spec = verb ? ATTACKS[verb] : undefined;
	return distanceXZ(character, target) <= Math.max(item.Weapon?.range ?? 0, spec?.range ?? 0);
}

/**
 * One blow of weapon `item` at `target`, now: `verb`'s damage and reach where they beat the
 * weapon's own (a stab, a slice, a cleave, a shot). Says how it went: hit, blocked (a raised guard
 * facing the blow), too far, or missed.
 */
export function strikeWith(character:GameObject, item:ItemInstance, target:GameObject | null, verb?:string):string {
	const world = character.world;
	const hp = target?.getComponent(Vitals);
	if (!world || !target || !hp || !item.Weapon || hp.hp <= 0) {
		return 'missed';
	}
	const spec = verb ? ATTACKS[verb] : undefined;
	if (!inReach(character, item, target, verb)) {
		return 'too far';
	}
	if (guardStops(target, character)) {
		cueAt(world, 'clash', target);
		return 'blocked';
	}
	const dealt = Math.min(hp.hp, weaknessDamage(target, verb, Math.max(item.Weapon.damage, spec?.damage ?? 0)).damage);
	hp.hp -= dealt;
	if (dealt > 0) {
		if (character.id === 'Player') {
			world.playerHits.add(target.getComponent(Named)?.id ?? target.id);
		}
		applyHit(world, character, target, spec?.knock ?? 1);
		if (hp.hp <= 0) {
			world.wentDown(target);
		}
	}
	return 'hit';
}

export function useItem(character:GameObject, item:ItemInstance, target:GameObject | null):UseResult {
	const world = character.world;
	if (!world) {
		return fail('no world');
	}

	if (target) {
		const lock = target.getComponent(Lock);
		if (lock) {
			if (item.Key) {
				if (inBackpack(character, item)) {
					const err = equipItem(character, item, world);
					if (err) {
						return fail(err);
					}
					removeFromBags(character, item);
				}
				if (lock.keyID !== item.Key.keyID) {
					const lockID = target.getComponent(Named)?.id;
					return fail((name) => `wrong key — ${lockID ? name(lockID) : 'it'} needs ${showNamingText(keyNameFor(world, lock, character), name)}`);
				}
				// A lock on one side only: its key opens the door, and it stays locked for the next one out there.
				lock.locked &&= lock.lockedFrom === 'outside';
				const door = target.getComponent(Door);
				if (door) {
					door.open = true;
					door.syncCollision();
					cueAt(world, 'unlock', target);
					cueAt(world, 'doorOpen', target);
				}
				const chest = target.getComponent(Chest);
				if (chest) {
					chest.open = true;
					cueAt(world, 'unlock', target);
					cueAt(world, 'chestOpen', target);
				}
				if (!door && !chest) {
					cueAt(world, 'unlock', target);
				}
				return ok(lock.locked ? 'opened' : 'unlocked');
			}
			if (lock.locked) {
				return fail(lockedReason(world, lock, character));
			}
		}
		const flam = target.getComponent(Flammable);
		if (flam && item.Flame?.canIgnite) {
			flam.burning = true;
			return ok('ignited');
		}
		// Anything else only tangles in it: a hint that it takes something else, never what.
		if (flam && !flam.burning) {
			return fail('nothing happens; it only tangles in the sticky strands');
		}
		if (target.getComponent(BrewHearth) && item.Ingredient) {
			return brewAtHearth(character, item);
		}
		const bed = target.getComponent(Sickbed);
		if (bed && item.defID === 'magic_potion') {
			if (!characterIs(character, bed.caretaker)) {
				return fail(`only ${bed.caretaker} can tend ${target.getComponent(Named)?.id ?? target.id}`);
			}
			if (bed.tended) {
				return fail('already tended');
			}
			if (!item.Consumable) {
				return fail('not a draught');
			}
			consume(character, item);
			bed.tended = true;
			return ok('tended');
		}
		const lever = target.getComponent(BridgeLever);
		if (lever) {
			if (!characterIs(character, 'BridgeKeeper')) {
				return fail('only BridgeKeeper can work the sluice');
			}
			if (item.defID !== 'bridge_crank') {
				return fail('use BridgeCrank on BridgeLever');
			}
			let bridge:GameObject | undefined;
			world.forEachComponent(Bridge, (b, go) => {
				bridge = go;
			});
			if (!bridge) {
				return fail('no Bridge');
			}
			const span = bridge.getComponent(Bridge);
			if (span?.moving) {
				return fail(`${idOf(bridge)} is still moving`);
			}
			if (span?.open && span.paidDown()) {
				return fail(`${idOf(bridge)} is lowered and paid for, so it stays down: leave it`);
			}
			const on = span?.open ? span.occupants().map(idOf) : [];
			if (on.length > 0) {
				return fail(`${on.join(' and ')} ${on.length > 1 ? 'are' : 'is'} on ${idOf(bridge)}; raising it now would drop them in the river`);
			}
			span?.toggle();
			const lock = bridge.getComponent(Lock);
			if (lock) {
				lock.locked = span ? !span.open : false;
			}
			return ok(span?.open === false ? 'raised Bridge' : 'lowered Bridge');
		}
	}

	if (item.Ingredient) {
		return fail('use Bitterroot on BrewHearth');
	}

	const page = readPage(item);
	if (page) {
		character.getComponent(Reading)?.open(item.defID);
		return ok(`you read: "${page}"`);
	}

	if (!target && item.defID === 'magic_potion') {
		return fail('use MagicPotion on NollCot or LinaCot');
	}

	if (!target && item.Consumable) {
		const { effect, amount, consumeOnUse } = item.Consumable;
		const felt = isDrink(item) ? 'drank' : character.getOrAddComponent(Belly).eat(item.defID, effect, amount);
		if (effect === 'heal') {
			healCharacter(character, amount);
		}
		if (consumeOnUse) {
			consume(character, item);
		}
		return ok(felt);
	}

	if (!target && item.Torch && itemInHeldSlot(character, item)) {
		item.Torch.lit = !item.Torch.lit;
		return ok(item.Torch.lit ? 'lit' : 'doused');
	}

	if (item.Equipable && !itemInHeldSlot(character, item)) {
		const err = equipItem(character, item, world);
		if (err) {
			return fail(err);
		}
		removeFromBags(character, item);
		return ok('equipped');
	}

	if (target && item.Weapon && (target.getComponent(Vitals) || target.getComponent(HumanBody))) {
		const result = strikeWith(character, item, target);
		return result === 'too far' ? fail(result) : ok(result);
	}

	if (item.Key && !target) {
		return fail('use on what?');
	}
	return fail('nothing happens');
}
