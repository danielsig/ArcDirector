import { BrewHearth, Bridge, BridgeLever, Chest, Door, Flammable, HumanBody, Lock, Named, Sickbed, Vitals } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { equipItem, itemInHeldSlot } from './equip';
import { characterIs, distXZ, findCarried, healCharacter, inBackpack, removeFromBags, tryInsert } from './inventory';
import { instantiateDef, type ItemInstance } from './instance';
import { getDef } from './defs';
import { keyNameFor, lockedReason } from './pickup';
import { cueAt } from '../audio/cue';
import { applyHit } from '../director/hitFeel';
import { idOf } from '../director/names';
import { weaknessDamage } from '../director/fight';

export type UseResult = {
	ok:boolean;
	reason:string;
};

function fail(reason:string):UseResult {
	return { ok: false, reason };
}

function ok(reason = ''):UseResult {
	return { ok: true, reason };
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
					return fail(`wrong key — ${target.getComponent(Named)?.id ?? 'it'} needs ${keyNameFor(world, lock)}`);
				}
				lock.locked = false;
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
				return ok('unlocked');
			}
			if (lock.locked) {
				return fail(lockedReason(world, lock));
			}
		}
		const flam = target.getComponent(Flammable);
		if (flam && item.Flame?.canIgnite) {
			flam.burning = true;
			return ok('ignited');
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

	if (!target && item.defID === 'magic_potion') {
		return fail('use MagicPotion on NollCot or LinaCot');
	}

	if (!target && item.Consumable) {
		if (item.Consumable.effect === 'heal') {
			healCharacter(character, item.Consumable.amount);
		}
		if (item.Consumable.consumeOnUse) {
			consume(character, item);
		}
		return ok('drank');
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
		if (distXZ(character, target) > item.Weapon.range) {
			return fail('too far');
		}
		const hp = target.getComponent(Vitals);
		if (hp) {
			const dealt = Math.min(hp.hp, weaknessDamage(target, undefined, item.Weapon.damage).damage);
			hp.hp -= dealt;
			if (dealt > 0) {
				if (character.id === 'Player') {
					world.playerHits.add(target.getComponent(Named)?.id ?? target.id);
				}
				applyHit(world, character, target);
			}
		}
		return ok('hit');
	}

	if (target && item.Blade) {
		return ok('cut');
	}

	if (item.Key && !target) {
		return fail('use on what?');
	}
	return fail('nothing happens');
}
