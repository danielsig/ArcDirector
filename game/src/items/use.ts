import { BoxCollider, BrewHearth, Bridge, Chest, Door, Flammable, HumanBody, Lock, MillLever, Named, Sickbed, Vitals } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { equipItem, itemInHeldSlot } from './equip';
import { actorIs, distXZ, findCarried, healActor, inBackpack, removeFromBags, tryInsert } from './inventory';
import { instantiateDef, type ItemInstance } from './instance';
import { getDef } from './defs';
import { cueAt } from '../audio/cue';

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

function consume(actor:GameObject, item:ItemInstance):void {
	item.count -= 1;
	if (item.count > 0) {
		return;
	}
	removeFromBags(actor, item);
	const body = actor.getComponent(HumanBody);
	if (!body) {
		return;
	}
	for (const slot of Object.keys(body.slots) as Array<keyof typeof body.slots>) {
		if (body.slots[slot] === item) {
			body.slots[slot] = null;
		}
	}
}

function brewAtHearth(actor:GameObject, item:ItemInstance):UseResult {
	const brew = item.Ingredient;
	if (!brew) {
		return fail('nothing to brew');
	}
	if (!actorIs(actor, brew.brewer)) {
		return fail(`only ${brew.brewer} can brew`);
	}
	const fee = findCarried(actor, (it) => it.defID === brew.fee);
	if (!fee) {
		return fail('unpaid — need GoldCoin as the fee');
	}
	const potion = instantiateDef(getDef(brew.brew), brew.yield);
	potion.name = 'MagicPotion';
	potion.id = 'MagicPotion';
	if (!tryInsert(actor, potion)) {
		return fail('no room for the brew');
	}
	consume(actor, item);
	return ok(`brewed ${brew.yield} MagicPotion`);
}

export function useItem(actor:GameObject, item:ItemInstance, target:GameObject | null):UseResult {
	const world = actor.world;
	if (!world) {
		return fail('no world');
	}

	if (target) {
		const lock = target.getComponent(Lock);
		if (lock) {
			if (item.Key) {
				if (inBackpack(actor, item)) {
					const err = equipItem(actor, item, world);
					if (err) {
						return fail(err);
					}
					removeFromBags(actor, item);
				}
				if (lock.keyID !== item.Key.keyID) {
					return fail('wrong key');
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
				return fail(lock.keyID ? `locked — needs a ${lock.keyID} key` : 'locked');
			}
		}
		const flam = target.getComponent(Flammable);
		if (flam && item.Flame?.canIgnite) {
			flam.burning = true;
			return ok('ignited');
		}
		if (target.getComponent(BrewHearth) && item.Ingredient) {
			return brewAtHearth(actor, item);
		}
		const bed = target.getComponent(Sickbed);
		if (bed && item.defID === 'magic_potion') {
			if (!actorIs(actor, bed.caretaker)) {
				return fail(`only ${bed.caretaker} can tend ${target.getComponent(Named)?.id ?? target.id}`);
			}
			if (bed.tended) {
				return fail('already tended');
			}
			if (!item.Consumable) {
				return fail('not a draught');
			}
			consume(actor, item);
			bed.tended = true;
			return ok('tended');
		}
		const lever = target.getComponent(MillLever);
		if (lever) {
			if (!actorIs(actor, 'Miller')) {
				return fail('only Miller can work the sluice');
			}
			if (item.defID !== 'mill_crank') {
				return fail('use MillCrank on MillLever');
			}
			let bridge:GameObject | undefined;
			world.forEachComponent(Bridge, (_b, go) => {
				bridge = go;
			});
			if (!bridge) {
				return fail('no mill bridge');
			}
			const span = bridge.getComponent(Bridge);
			if (span) {
				span.open = true;
			}
			const lock = bridge.getComponent(Lock);
			if (lock) {
				lock.locked = false;
			}
			const col = bridge.getComponent(BoxCollider);
			if (col) {
				col.solid = false;
				col.isTrigger = true;
			}
			return ok('lowered MillBridge');
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
			healActor(actor, item.Consumable.amount);
		}
		if (item.Consumable.consumeOnUse) {
			consume(actor, item);
		}
		return ok('drank');
	}

	if (!target && item.Torch && itemInHeldSlot(actor, item)) {
		item.Torch.lit = !item.Torch.lit;
		return ok(item.Torch.lit ? 'lit' : 'doused');
	}

	if (item.Equipable && !itemInHeldSlot(actor, item)) {
		const err = equipItem(actor, item, world);
		if (err) {
			return fail(err);
		}
		removeFromBags(actor, item);
		return ok('equipped');
	}

	if (target && item.Weapon && (target.getComponent(Vitals) || target.getComponent(HumanBody))) {
		if (distXZ(actor, target) > item.Weapon.range) {
			return fail('too far');
		}
		const hp = target.getComponent(Vitals);
		if (hp) {
			hp.hp = Math.max(0, hp.hp - item.Weapon.damage);
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
