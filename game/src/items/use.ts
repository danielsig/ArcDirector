import { distanceXZ, type GameObject } from '@arc-director/kindling';
import { showNamingText, type NamingText } from 'arc-director';
import { HumanBody, Vitals } from '../engine/components';
import { equipItem, itemInHeldSlot } from './equip';
import { healCharacter, inBackpack, removeFromBags } from './inventory';
import type { ItemInstance } from './instance';
import { getDef } from './defs';
import { Belly } from '../engine/Belly';
import { Reading } from '../characters/Reading';
import { ATTACKS, guardStops, miss, weaponed, wound } from '../director/fight';

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

export function fail(reason:NamingText):UseResult {
	return { ok: false, reason };
}

export function ok(reason:NamingText = ''):UseResult {
	return { ok: true, reason };
}

/** A component an item can be used on (`useItem`). It says what came of it, or nothing to leave it to the rest. */
export const usable = (c:object):c is { useOn(character:GameObject, item:ItemInstance):UseResult | undefined } => 'useOn' in c && typeof c.useOn === 'function';

/** A potion goes down without filling anyone; everything else one consumes is a meal. */
function isDrink(item:ItemInstance):boolean {
	return item.Consumable?.effect === 'heal';
}

/** What a fire makes of `item`, and how soon (`Campfire`), if it cooks. */
export function cookingOf(item:ItemInstance):{ into:string; seconds:number } | undefined {
	return getDef(item.defID).components.Cookable;
}

/** Whether `item` is food that must be cooked before it is eaten. */
export function isRaw(item:ItemInstance):boolean {
	return !item.Consumable && !!cookingOf(item);
}

/** Whether `item` is something to eat, raw or ready. */
export function isFood(item:ItemInstance):boolean {
	return (!!item.Consumable && !isDrink(item)) || isRaw(item);
}

/** One of `item` used up: off its stack, and out of the bag or hand once the last is gone. */
export function consume(character:GameObject, item:ItemInstance):void {
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

/** Whether `target` is within reach of weapon `item` swung (or shot) with `verb`: the longer of the two. */
export function inReach(character:GameObject, item:ItemInstance, target:GameObject, verb?:string):boolean {
	return distanceXZ(character, target) <= weaponed(verb ? ATTACKS[verb] : undefined, item.Weapon).range;
}

/**
 * One blow of weapon `item` at `target`, now: `verb`'s damage and reach where they beat the
 * weapon's own (a stab, a slice, a cleave, a shot). Says how it went: hit, blocked (a raised guard
 * facing the blow), too far, or missed.
 */
export function strikeWith(character:GameObject, item:ItemInstance, target:GameObject | null, verb = 'strike'):string {
	const hp = target?.getComponent(Vitals);
	if (!character.world || !target || !hp || !item.Weapon || hp.hp <= 0) {
		return 'missed';
	}
	if (!inReach(character, item, target, verb)) {
		return 'too far';
	}
	if (guardStops(target, character)) {
		miss(character, target, verb, 'blocked');
		return 'blocked';
	}
	const spec = ATTACKS[verb];
	wound(character, target, verb, weaponed(spec, item.Weapon).damage, spec?.knock);
	return 'hit';
}

export function useItem(character:GameObject, item:ItemInstance, target:GameObject | null):UseResult {
	const world = character.world;
	if (!world) {
		return fail('no world');
	}

	if (target) {
		for (const c of target.components()) {
			const result = c.enabled && usable(c) ? c.useOn(character, item) : undefined;
			if (result) {
				return result;
			}
		}
	}

	const page = readPage(item);
	if (page) {
		character.getComponent(Reading)?.open(item.defID);
		return ok(`you read: "${page}"`);
	}

	if (isRaw(item)) {
		return fail('it is raw: cook it over a fire first');
	}

	// Food and a torch are for oneself when what they are aimed at takes nothing: eaten, or lit, at a counter too.
	if (item.Consumable) {
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

	if (item.Torch && itemInHeldSlot(character, item)) {
		item.Torch.lit = !item.Torch.lit;
		return ok(item.Torch.lit ? 'lit' : 'doused');
	}

	if (item.Equipable && !itemInHeldSlot(character, item)) {
		const err = equipItem(character, item, world);
		if (err) {
			return fail(err);
		}
		removeFromBags(character, item);
		return item.Torch ? useItem(character, item, null) : ok('equipped');
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
