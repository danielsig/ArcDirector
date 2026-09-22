import { isCrowdConductor, pascalCase, type ArcResult, type Step } from 'arc-director';
import { NPCInput } from '../actors/NPCInput';
import {
	BODY_SLOTS,
	BoxCollider,
	Bridge,
	HumanBody,
	HumanSprite,
	Lock,
	MillLever,
	Named,
	Companion,
	MarketNPC,
	Merchant,
	Door,
	Wanted,
	Vitals,
	Celebrating,
	type BodySlot,
} from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { Harvest, Pickupable } from '../items/components';
import { getDef } from '../items/defs';
import {
	distXZ,
	findCarried,
	itemMatchesName,
	removeFromBags,
	slotItem,
	tryInsert,
	compactName,
	actorIs,
	healActor,
} from '../items/inventory';
import { cloneItem, type ItemInstance } from '../items/instance';
import { coinsOf, findSaleItem, noteWant, priceFor, transferCoins } from '../items/wallet';
import { dropItem, findChestHolding, pickup, takeFromChest, USE_RANGE } from '../items/pickup';
import { cueAt } from '../audio/cue';
import { equipItem, unequipSlot } from '../items/equip';
import { useItem } from '../items/use';
import type { GameHost } from './adapter';
import { bodyName, findBody } from './names';
import { poseFact } from './kernels';
import { doExamine } from './perception';
import { applyHit } from './hitFeel';
import {
	agilityOf,
	fightLabel,
	fightRole,
	findFightTarget,
	isRivalBody,
	type FightRole,
} from './fight';
import { lineClear } from '../world/path';
import type { HostCtx } from './types';
import {
	formatWanderSeen,
	namesAlongPath,
	pickWanderPoint,
	wanderFilterHint,
	wanderUntilMet,
} from './wander';

function findItem(actor:GameObject, name:string):ItemInstance | null {
	return findCarried(actor, (it) => itemMatchesName(it, name));
}

function asSlot(raw:string):BodySlot | undefined {
	return (BODY_SLOTS as readonly string[]).includes(raw) ? raw as BodySlot : undefined;
}

function heldFromPlayer(ctx:HostCtx, name:string, target?:GameObject):boolean {
	const bond = ctx.actor.getComponent(Companion);
	if (!bond?.hold) {
		return false;
	}
	const dest = target ? bodyName(target) : '';
	return name === bond.targetID || name === 'Player' || dest === bond.targetID || dest === 'Player';
}

function setOverhead(host:GameHost, id:string, text:string, seconds:number):ArcResult {
	const agent = host.agentByID(id);
	if (!agent) {
		return { ok: false, verb: 'set_status', reason: 'no mind' };
	}
	const label = text.trim().slice(0, 72);
	if (!label) {
		return { ok: false, verb: 'set_status', reason: 'nothing to show' };
	}
	const life = Math.min(60, Math.max(1, seconds));
	host.labels.set(agent.id, { text: label, until: host.world.time + life });
	return { ok: true, verb: 'set_status', reason: `${life}s` };
}

export async function executeStep(host:GameHost, step:Step, ctx:HostCtx):Promise<ArcResult> {
	const npc = ctx.actor.getComponent(NPCInput);
	if (!npc) {
		return { ok: false, verb: step.verb, reason: 'no NPCInput' };
	}
	if ((ctx.actor.getComponent(Vitals)?.hp ?? 1) <= 0) {
		return { ok: false, verb: step.verb, reason: 'down' };
	}
	if (host.bargainDone && fightRole(host, ctx.actor)) {
		return { ok: false, interrupted: true, verb: step.verb, reason: 'won' };
	}
	const hop = ctx.actor.getComponent(Celebrating);
	if (
		hop?.enabled
		&& (ctx.actor.world?.time ?? 0) < hop.until
		&& step.verb !== 'think'
	) {
		return { ok: false, interrupted: true, verb: step.verb, reason: 'celebrating' };
	}
	if (step.verb !== 'think') {
		const agent = host.agentByID(ctx.actor.id) ?? host.agentByID(bodyName(ctx.actor));
		agent?.noteVerb(step.verb);
	}
	switch (step.verb) {
		case 'go_to': {
			const name = String(step.args.name ?? '');
			const target = findFightTarget(host, ctx.actor, name);
			if (!target) {
				return { ok: false, verb: 'go_to', reason: `no such place ${name} — not reachable with go_to. see_map, ask, or wander(until) until the scene names it` };
			}
			if (isRivalBody(host, ctx.actor, target)) {
				return { ok: false, verb: 'go_to', reason: 'go_to is not an attack; use hex, shoot, cleave, slash, or smite' };
			}
			if (heldFromPlayer(ctx, name, target)) {
				return { ok: false, verb: 'go_to', reason: 'held: walking to Player is not the spoken job' };
			}
			return npc.goTo(bodyName(target));
		}
		case 'follow': {
			const name = String(step.args.name ?? '');
			if (heldFromPlayer(ctx, name)) {
				return { ok: false, verb: 'follow', reason: 'held: walking to Player is not the spoken job' };
			}
			return npc.follow(name);
		}
		case 'wander': {
			const until = (typeof step.args.until === 'string' ? step.args.until : '')
				.replace(/\s+/g, ' ')
				.trim();
			const leftover = until ? wanderFilterHint(ctx, host.posedEvents, until) : undefined;
			if (leftover) {
				return { ok: false, verb: 'wander', reason: leftover };
			}
			const seconds = typeof step.args.seconds === 'number'
				? step.args.seconds
				: until ? 20 : 6;
			const seen = new Set<string>();
			const note = () => {
				for (const name of namesAlongPath(ctx.actor)) {
					seen.add(name);
				}
			};
			const guide = until ? {
				stop: () => wanderUntilMet(ctx, host.posedEvents, until),
				dest: () => pickWanderPoint(ctx, host.posedEvents, until),
				note,
			} : { note };
			let result = await npc.wander(seconds, guide);
			for (let n = 0; until && n < 3 && result.ok && !result.interrupted && result.reason !== 'until'; n++) {
				result = await npc.wander(seconds, guide);
			}
			note();
			const saw = formatWanderSeen(seen);
			if (result.reason === 'until') {
				return { ...result, verb: 'wander', reason: saw ? `until — ${saw}` : 'until' };
			}
			return { ...result, verb: 'wander', reason: saw || result.reason };
		}
		case 'wait': {
			const until = typeof step.args.until === 'string' ? step.args.until : '';
			const leftover = until ? wanderFilterHint(ctx, host.posedEvents, until) : undefined;
			if (leftover) {
				return { ok: false, verb: 'wait', reason: leftover };
			}
			const seconds = typeof step.args.seconds === 'number'
				? step.args.seconds
				: until ? 20 : 1;
			return npc.wait(seconds, until ? () => wanderUntilMet(ctx, host.posedEvents, until) : undefined);
		}
		case 'say': {
			const text = String(step.args.text ?? '');
			const to = String(step.args.to ?? '');
			return host.talk.say(
				bodyName(ctx.actor),
				text,
				to || undefined,
				ctx.world.time,
			);
		}
		case 'use':
			return doUse(host, ctx, npc, String(step.args.item ?? ''), String(step.args.target ?? '') || undefined);
		case 'equip':
			return doEquip(ctx, String(step.args.item ?? ''), String(step.args.slot ?? '') || undefined);
		case 'unequip':
			return doUnequip(ctx, String(step.args.slot ?? ''));
		case 'pick_up':
			return doPickUp(host, ctx, npc, String(step.args.name ?? ''));
		case 'drop':
			return doDrop(ctx, String(step.args.name ?? ''));
		case 'give':
			return doGive(host, ctx, npc, String(step.args.item ?? ''), String(step.args.to ?? ''));
		case 'examine':
			return doExamine(ctx, String(step.args.name ?? ''));
		case 'buy':
			return doBuy(
				host,
				ctx,
				npc,
				String(step.args.item ?? ''),
				String(step.args.from ?? ''),
				typeof step.args.offer === 'number' ? step.args.offer : NaN,
			);
		case 'sell':
			return doSell(
				host,
				ctx,
				npc,
				String(step.args.item ?? ''),
				String(step.args.to ?? ''),
				typeof step.args.ask === 'number' ? step.args.ask : NaN,
			);
		case 'steal':
			return doSteal(host, ctx, npc, String(step.args.item ?? ''), String(step.args.from ?? ''));
		case 'set_status':
			return setOverhead(
				host,
				bodyName(ctx.actor),
				String(step.args.text ?? ''),
				typeof step.args.seconds === 'number' ? step.args.seconds : 6,
			);
		case 'rest':
			return {
				ok: true,
				verb: 'rest',
				reason: host.hooks.goalDone?.(host, bodyName(ctx.actor)) ? 'done — still listening' : 'goal still open',
			};
		case 'hex':
		case 'shoot':
		case 'cleave':
		case 'slash':
		case 'smite':
			return doAttack(host, ctx, npc, step.verb, String(step.args.name ?? ''));
		case 'heal':
			return doHeal(host, ctx, npc, String(step.args.name ?? ''));
		default:
			return { ok: false, verb: step.verb, reason: `unhandled verb ${step.verb}` };
	}
}

async function ensureRange(
	npc:NPCInput,
	actor:GameObject,
	target:GameObject,
	name:string,
):Promise<ArcResult> {
	if (distXZ(actor, target) <= USE_RANGE) {
		return { ok: true };
	}
	return npc.goTo(name);
}

function heldWeapon(actor:GameObject):{ damage:number; range:number } | undefined {
	const body = actor.getComponent(HumanBody);
	if (body) {
		for (const slot of ['hands.left.held', 'hands.right.held'] as const) {
			const item = slotItem(body, slot);
			if (item?.Weapon) {
				return item.Weapon;
			}
		}
	}
	const packed = findCarried(actor, (it) => !!it.Weapon);
	return packed?.Weapon;
}

function dropDown(host:GameHost, who:GameObject):void {
	who.getComponent(NPCInput)?.interrupt('urgent');
	const npc = who.getComponent(NPCInput);
	if (npc) {
		npc.enabled = false;
		npc.aiOn = false;
	}
	const col = who.getComponent(BoxCollider);
	if (col) {
		col.enabled = false;
	}
	const id = bodyName(who);
	const arc = host.arc;
	for (const agent of arc?.agents() ?? []) {
		if (!isCrowdConductor(agent) || !agent.crowd.has(id)) {
			continue;
		}
		if (agent.commanderID === id) {
			arc?.setCrowdCommander(agent.id, null);
		}
		const alive = agent.crowd.list().some((unit) => {
			const body = findBody(host.world, unit.id);
			return (body?.getComponent(Vitals)?.hp ?? 0) > 0;
		});
		if (!alive) {
			arc?.removeAgent(agent.id);
		}
	}
	host.pushEvent({
		kind: 'Hurt',
		text: `${fightLabel(host, who)} is down`,
		tags: [fightLabel(host, who), 'down'],
		major: false,
	});
}

function combatSight(world:World, a:GameObject, b:GameObject):boolean {
	return lineClear(
		world,
		a.transform.position.x,
		a.transform.position.z,
		b.transform.position.x,
		b.transform.position.z,
		true,
	);
}

type AttackKind = {
	roles:FightRole[];
	range:number;
	damage:number;
	los:boolean;
	word:string;
	/** Wind-up before the hit, seconds of `world.time`. */
	castTime:number;
	/** Recovery after the hit before the next cast, seconds of `world.time`. */
	cooldown:number;
	/** Hit chance at point-blank before target agility, 0..1. */
	accuracy:number;
	/** Ranged only. Accuracy multiplier at max range (1 = no drop). */
	falloff?:number;
};

const ATTACKS:Record<string, AttackKind> = {
	slash: { roles: ['Blade'], range: 1.7, damage: 1, los: false, word: 'slashed', castTime: 0.28, cooldown: 0.72, accuracy: 0.9 },
	smite: { roles: ['Healer'], range: 2.2, damage: 2, los: false, word: 'smote', castTime: 0.4, cooldown: 1.2, accuracy: 0.86 },
	hex: { roles: ['Witch'], range: 8, damage: 3, los: true, word: 'hexed', castTime: 1.8, cooldown: 1.4, accuracy: 0.84, falloff: 0.5 },
	cleave: { roles: ['Knight'], range: 2.2, damage: 4, los: false, word: 'cleaved', castTime: 0.8, cooldown: 1.6, accuracy: 0.74 },
	shoot: { roles: ['Archer'], range: 12, damage: 5, los: true, word: 'shot', castTime: 1.5, cooldown: 3.5, accuracy: 0.78, falloff: 0.28 },
};

/** Slow ritual. Game seconds. `hp` is restored (capped at maxHP). */
const HEAL = { castTime: 5, cooldown: 24, hp: 4 };

function attackOf(verb:string):{ name:string; spec:AttackKind } | undefined {
	const spec = ATTACKS[verb];
	return spec ? { name: verb, spec } : undefined;
}

async function holdReady(
	npc:NPCInput,
	now:number,
	readyAt:number,
	castTime:number,
):Promise<ArcResult> {
	const cool = readyAt - now;
	if (cool > 0.02) {
		const waited = await npc.wait(cool);
		if (!waited.ok || waited.interrupted) {
			return { ok: false, interrupted: waited.interrupted, reason: waited.reason, verb: 'wait' };
		}
	}
	if (castTime > 0.02) {
		const cast = await npc.wait(castTime);
		if (!cast.ok || cast.interrupted) {
			return { ok: false, interrupted: cast.interrupted, reason: cast.reason ?? 'cast', verb: 'wait' };
		}
	}
	return { ok: true };
}

function rangeAccuracy(spec:AttackKind, dist:number):number {
	if (!spec.los) {
		return spec.accuracy;
	}
	const span = Math.max(spec.range, 0.01);
	const t = Math.min(1, Math.max(0, dist / span));
	const far = spec.falloff ?? 0.4;
	return spec.accuracy * (1 - t * (1 - far));
}

function hitChance(spec:AttackKind, dist:number, agility:number):number {
	return Math.min(0.97, Math.max(0.05, rangeAccuracy(spec, dist) - agility));
}

async function doAttack(
	host:GameHost,
	ctx:HostCtx,
	npc:NPCInput,
	verb:string,
	name:string,
):Promise<ArcResult> {
	const role = fightRole(host, ctx.actor);
	const attack = attackOf(verb);
	if (!attack) {
		return { ok: false, verb, reason: `unhandled attack ${verb}` };
	}
	if (role && !attack.spec.roles.includes(role)) {
		const need = attack.spec.roles.join(' or ');
		return { ok: false, verb, reason: `only a ${need} can ${attack.name}` };
	}
	let target = findFightTarget(host, ctx.actor, name);
	if (!target) {
		return { ok: false, verb: attack.name, reason: `no such person ${name}` };
	}
	if (target === ctx.actor) {
		return { ok: false, verb: attack.name, reason: `cannot ${attack.name} yourself` };
	}
	const dest = bodyName(target);
	const weapon = heldWeapon(ctx.actor);
	const melee = !attack.spec.los;
	const range = melee ? Math.max(attack.spec.range, weapon?.range ?? 0) : attack.spec.range;
	const close = Math.max(0.9, range - 0.6);
	if (distXZ(ctx.actor, target) > close) {
		const walk = await npc.goTo(dest, close);
		if (!walk.ok) {
			return { ...walk, verb: attack.name };
		}
	}
	if (distXZ(ctx.actor, target) > range + 0.5) {
		return { ok: false, verb: attack.name, reason: 'too far' };
	}
	if (attack.spec.los && !combatSight(ctx.world, ctx.actor, target)) {
		const squeeze = Math.max(0.9, close * 0.45);
		if (distXZ(ctx.actor, target) > squeeze) {
			const walk = await npc.goTo(dest, squeeze);
			if (!walk.ok) {
				return { ...walk, verb: attack.name };
			}
		}
		if (!combatSight(ctx.world, ctx.actor, target)) {
			return { ok: false, verb: attack.name, reason: 'no line of sight' };
		}
	}
	npc.faceToward(dest);
	const held = await holdReady(npc, ctx.world.time, npc.attackReadyAt, attack.spec.castTime);
	if (!held.ok) {
		return { ...held, verb: attack.name };
	}
	target = findFightTarget(host, ctx.actor, name) ?? target;
	if (target === ctx.actor) {
		return { ok: false, verb: attack.name, reason: `cannot ${attack.name} yourself` };
	}
	if (distXZ(ctx.actor, target) > range + 0.5) {
		return { ok: false, verb: attack.name, reason: 'too far' };
	}
	if (attack.spec.los && !combatSight(ctx.world, ctx.actor, target)) {
		return { ok: false, verb: attack.name, reason: 'no line of sight' };
	}
	const vitals = target.getComponent(Vitals);
	if (!vitals) {
		return { ok: false, verb: attack.name, reason: 'no vitals' };
	}
	npc.attackReadyAt = ctx.world.time + attack.spec.cooldown;
	if (vitals.hp <= 0) {
		return { ok: true, verb: attack.name, reason: 'already down' };
	}
	const dist = distXZ(ctx.actor, target);
	const chance = hitChance(attack.spec, dist, agilityOf(host, target));
	const who = fightLabel(host, ctx.actor);
	const foe = fightLabel(host, target);
	npc.faceToward(bodyName(target));
	if (Math.random() >= chance) {
		host.pushEvent({
			kind: 'Miss',
			text: `${who} missed ${foe}`,
			tags: [who, foe, 'miss', attack.name],
			major: false,
		});
		return { ok: true, verb: attack.name, reason: `missed ${foe}` };
	}
	const dmg = melee ? Math.max(attack.spec.damage, weapon?.damage ?? 0) : attack.spec.damage;
	vitals.hp = Math.max(0, vitals.hp - dmg);
	applyHit(ctx.world, ctx.actor, target);
	host.pushEvent({
		kind: 'Hurt',
		text: `${who} ${attack.spec.word} ${foe}`,
		tags: [who, foe, 'hurt', attack.name],
		major: false,
	});
	if (vitals.hp <= 0) {
		dropDown(host, target);
		return { ok: true, verb: attack.name, reason: `${foe} is down` };
	}
	return { ok: true, verb: attack.name, reason: `${foe} ${vitals.hp}/${vitals.maxHP}` };
}

async function doHeal(
	host:GameHost,
	ctx:HostCtx,
	npc:NPCInput,
	name:string,
):Promise<ArcResult> {
	const role = fightRole(host, ctx.actor);
	if (role && role !== 'Healer') {
		return { ok: false, verb: 'heal', reason: 'only a healer can heal' };
	}
	let target = name ? findFightTarget(host, ctx.actor, name) : ctx.actor;
	if (!target) {
		return { ok: false, verb: 'heal', reason: `no such person ${name}` };
	}
	if (target !== ctx.actor) {
		if (isRivalBody(host, ctx.actor, target)) {
			return { ok: false, verb: 'heal', reason: 'heal your company, not the enemy' };
		}
		const walk = await ensureRange(npc, ctx.actor, target, bodyName(target));
		if (!walk.ok) {
			return { ...walk, verb: 'heal' };
		}
	}
	if (target !== ctx.actor) {
		npc.faceToward(bodyName(target));
	}
	const held = await holdReady(npc, ctx.world.time, npc.healReadyAt, HEAL.castTime);
	if (!held.ok) {
		return { ...held, verb: 'heal' };
	}
	target = name ? findFightTarget(host, ctx.actor, name) ?? target : ctx.actor;
	if (target !== ctx.actor) {
		if (isRivalBody(host, ctx.actor, target)) {
			return { ok: false, verb: 'heal', reason: 'heal your company, not the enemy' };
		}
		if (distXZ(ctx.actor, target) > USE_RANGE) {
			return { ok: false, verb: 'heal', reason: 'too far' };
		}
	}
	const vitals = target.getComponent(Vitals);
	if (!vitals) {
		return { ok: false, verb: 'heal', reason: 'no vitals' };
	}
	if (vitals.hp <= 0) {
		return { ok: false, verb: 'heal', reason: 'down' };
	}
	npc.healReadyAt = ctx.world.time + HEAL.cooldown;
	healActor(target, HEAL.hp);
	return { ok: true, verb: 'heal', reason: `${bodyName(target)} ${vitals.hp}/${vitals.maxHP}` };
}

async function doUse(
	host:GameHost,
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	targetName?:string,
):Promise<ArcResult> {
	const item = findItem(ctx.actor, itemName);
	if (!item) {
		return { ok: false, verb: 'use', reason: `not carrying ${itemName}` };
	}
	let target:GameObject | null = null;
	if (targetName) {
		target = ctx.world.findNamed(targetName) ?? null;
		if (!target) {
			return { ok: false, verb: 'use', reason: `no such target ${targetName}` };
		}
		const walk = await ensureRange(npc, ctx.actor, target, targetName);
		if (!walk.ok) {
			return { ...walk, verb: 'use' };
		}
	}
	const result = useItem(ctx.actor, item, target);
	if (result.ok && result.reason === 'unlocked' && target?.getComponent(Door)) {
		const name = target.getComponent(Named)?.id ?? target.id;
		host.doorOpen.set(name, true);
		host.pushEvent({
			kind: 'DoorOpened',
			text: `${name} opened`,
			tags: ['door', name],
			major: false,
		});
	}
	return { ok: result.ok, verb: 'use', reason: result.reason };
}

async function doEquip(ctx:HostCtx, itemName:string, slotName?:string):Promise<ArcResult> {
	const item = findItem(ctx.actor, itemName);
	if (!item) {
		return { ok: false, verb: 'equip', reason: `not carrying ${itemName}` };
	}
	const slot = slotName ? asSlot(slotName) : undefined;
	if (slotName && !slot) {
		return { ok: false, verb: 'equip', reason: `no slot ${slotName}` };
	}
	const err = equipItem(ctx.actor, item, ctx.world, slot);
	if (err) {
		return { ok: false, verb: 'equip', reason: err };
	}
	removeFromBags(ctx.actor, item);
	return { ok: true, verb: 'equip' };
}

async function doUnequip(ctx:HostCtx, slotName:string):Promise<ArcResult> {
	const slot = asSlot(slotName);
	if (!slot) {
		return { ok: false, verb: 'unequip', reason: `no slot ${slotName}` };
	}
	unequipSlot(ctx.actor, slot, ctx.world);
	return { ok: true, verb: 'unequip' };
}

async function doPickUp(host:GameHost, ctx:HostCtx, npc:NPCInput, name:string):Promise<ArcResult> {
	const loot = ctx.world.findNamed(name);
	if (loot?.getComponent(Pickupable)) {
		const crop = loot.getComponent(Harvest);
		if (crop && !actorIs(ctx.actor, crop.harvester)) {
			return { ok: false, verb: 'pick_up', reason: `only ${crop.harvester} can harvest that` };
		}
		const walk = await ensureRange(npc, ctx.actor, loot, name);
		if (!walk.ok) {
			return { ...walk, verb: 'pick_up' };
		}
		const reason = pickup(ctx.actor, loot);
		const ok = reason !== 'no room' && reason !== 'no world';
		if (ok) {
			ctx.actor.getComponent(HumanSprite)?.playClip('take', ctx.world.time);
			host.pushEvent({
				kind: 'PickedUp',
				text: `${bodyName(ctx.actor)} picked up ${name}`,
				tags: ['item', name, bodyName(ctx.actor)],
				major: false,
			});
			host.hooks.afterPickUp?.(host, ctx.actor, name);
		}
		return { ok, verb: 'pick_up', reason };
	}
	const held = findChestHolding(ctx.world, name);
	if (held) {
		const chestName = held.chest.getComponent(Named)?.id ?? held.chest.id;
		const lock = held.chest.getComponent(Lock);
		if (lock?.locked) {
			return { ok: false, verb: 'pick_up', reason: `${chestName} is locked — unlock it first` };
		}
		const walk = await ensureRange(npc, ctx.actor, held.chest, chestName);
		if (!walk.ok) {
			return { ...walk, verb: 'pick_up' };
		}
		const reason = takeFromChest(ctx.actor, held);
		const ok = reason.startsWith('took ');
		if (ok) {
			ctx.actor.getComponent(HumanSprite)?.playClip('take', ctx.world.time);
			host.pushEvent({
				kind: 'PickedUp',
				text: `${bodyName(ctx.actor)} picked up ${name}`,
				tags: ['item', name, bodyName(ctx.actor)],
				major: false,
			});
			host.hooks.afterPickUp?.(host, ctx.actor, name);
		}
		return { ok, verb: 'pick_up', reason };
	}
	const named = ctx.world.findNamed(name);
	if (named?.getComponent(MillLever)) {
		return {
			ok: false,
			verb: 'pick_up',
			reason: `${name} is a sluice, not loot. Only Miller uses MillCrank on MillLever`,
		};
	}
	if (named?.getComponent(HumanBody) || named?.getComponent(MarketNPC)) {
		return { ok: false, verb: 'pick_up', reason: `cannot pick up ${name}` };
	}
	if (named) {
		const kind = named.getComponent(Door)
			? 'a door'
			: named.getComponent(Bridge)
				? 'a bridge'
				: 'not loot';
		return { ok: false, verb: 'pick_up', reason: `${name} is ${kind}` };
	}
	return { ok: false, verb: 'pick_up', reason: `no such item ${name}` };
}

async function doDrop(ctx:HostCtx, name:string):Promise<ArcResult> {
	const item = findItem(ctx.actor, name);
	if (!item) {
		return { ok: false, verb: 'drop', reason: `not carrying ${name}` };
	}
	removeFromBags(ctx.actor, item);
	const body = ctx.actor.getComponent(HumanBody);
	if (body) {
		for (const slot of BODY_SLOTS) {
			if (slotItem(body, slot) === item) {
				body.slots[slot] = null;
			}
		}
	}
	dropItem(ctx.actor, item);
	return { ok: true, verb: 'drop', reason: `dropped ${item.name}` };
}

export function takeOne(actor:GameObject, item:ItemInstance):ItemInstance {
	const gift = item.count > 1 ? cloneItem(item, 1) : item;
	if (gift === item) {
		removeFromBags(actor, item);
		const body = actor.getComponent(HumanBody);
		if (body) {
			for (const slot of BODY_SLOTS) {
				if (slotItem(body, slot) === item) {
					body.slots[slot] = null;
				}
			}
		}
	}
	else {
		item.count -= 1;
	}
	return gift;
}

function restoreOne(actor:GameObject, item:ItemInstance, original:ItemInstance):void {
	if (item === original) {
		tryInsert(actor, item);
		return;
	}
	original.count += 1;
}

export function tooFar(actor:GameObject, target:GameObject, name:string):string | null {
	if (distXZ(actor, target) > USE_RANGE) {
		return `too far — walk closer to ${name}`;
	}
	return null;
}

function purseGoldAmount():number {
	return getDef('fire_mushroom').components.Goods?.ask ?? 3;
}

export function settleGive(from:GameObject, to:GameObject, itemName:string, host:GameHost):ArcResult {
	if (to === from) {
		return { ok: false, verb: 'give', reason: 'cannot give to yourself' };
	}
	if (compactName(itemName) === 'gold' && !findItem(from, itemName)) {
		return settlePay(from, to, purseGoldAmount(), host);
	}
	const item = findItem(from, itemName);
	if (!item) {
		return { ok: false, verb: 'give', reason: `not carrying ${itemName}` };
	}
	const gift = takeOne(from, item);
	if (!tryInsert(to, gift)) {
		const followedID = from.getComponent(Companion)?.targetID;
		if (to.id === 'Player' || bodyName(to) === followedID) {
			dropItem(to, gift);
			const label = pascalCase(gift.name) || gift.name;
			const t = from.world?.time ?? 0;
			from.getComponent(HumanSprite)?.playClip('give', t);
			to.getComponent(HumanSprite)?.playClip('take', t);
			cueAt(from.world, 'give', from);
			host.pushEvent({
				kind: 'Given',
				text: `${bodyName(from)} gave ${label} to ${bodyName(to)}`,
				tags: ['give', label, bodyName(from), bodyName(to)],
				major: false,
			});
			return {
				ok: true,
				verb: 'give',
				reason: `gave ${label} to ${bodyName(to)} (left at their feet — no room)`,
			};
		}
		restoreOne(from, gift, item);
		return { ok: false, verb: 'give', reason: `${bodyName(to)} has no room` };
	}
	const label = pascalCase(gift.name) || gift.name;
	const t = from.world?.time ?? 0;
	from.getComponent(HumanSprite)?.playClip('give', t);
	to.getComponent(HumanSprite)?.playClip('take', t);
	cueAt(from.world, 'give', from);
	host.pushEvent({
		kind: 'Given',
		text: `${bodyName(from)} gave ${label} to ${bodyName(to)}`,
		tags: ['give', label, bodyName(from), bodyName(to)],
		major: false,
	});
	return { ok: true, verb: 'give', reason: `gave ${label} to ${bodyName(to)}` };
}

export function settlePay(from:GameObject, to:GameObject, amount:number, host:GameHost):ArcResult {
	if (to === from) {
		return { ok: false, verb: 'give', reason: 'cannot give to yourself' };
	}
	const err = transferCoins(from, to, amount);
	if (err) {
		return { ok: false, verb: 'give', reason: err };
	}
	const t = from.world?.time ?? 0;
	from.getComponent(HumanSprite)?.playClip('give', t);
	to.getComponent(HumanSprite)?.playClip('take', t);
	cueAt(from.world, 'give', from);
	host.pushEvent({
		kind: 'Given',
		text: `${bodyName(from)} gave ${amount} gold to ${bodyName(to)}`,
		tags: ['give', 'gold', bodyName(from), bodyName(to)],
		major: false,
	});
	return { ok: true, verb: 'give', reason: `gave ${amount} gold to ${bodyName(to)}` };
}

export function settleBuy(
	buyer:GameObject,
	seller:GameObject,
	itemName:string,
	offer:number,
	host:GameHost,
):ArcResult {
	const fromName = bodyName(seller);
	const stock = findSaleItem(seller, itemName);
	if (!stock) {
		return { ok: false, verb: 'buy', reason: `${fromName} has no ${itemName}` };
	}
	const buyerID = bodyName(buyer);
	const quote = priceFor(seller, stock, buyerID);
	if (!quote) {
		return { ok: false, verb: 'buy', reason: `${itemName} is not for sale` };
	}
	const offered = Number.isFinite(offer);
	let price = quote.agreed ?? quote.ask;
	if (offered) {
		if (offer + 1e-6 < quote.floor) {
			return { ok: false, verb: 'buy', reason: `${fromName} will not go below ${quote.floor} gold` };
		}
		price = Math.floor(offer);
	}
	const err = transferCoins(buyer, seller, price);
	if (err) {
		return { ok: false, verb: 'buy', reason: err };
	}
	const gift = takeOne(seller, stock);
	if (!tryInsert(buyer, gift)) {
		restoreOne(seller, gift, stock);
		transferCoins(seller, buyer, price);
		return { ok: false, verb: 'buy', reason: 'no room' };
	}
	const shop = seller.getComponent(Merchant);
	if (shop) {
		delete shop.deals[buyerID];
	}
	const label = pascalCase(gift.name) || gift.name;
	const t = buyer.world?.time ?? 0;
	buyer.getComponent(HumanSprite)?.playClip('take', t);
	seller.getComponent(HumanSprite)?.playClip('give', t);
	cueAt(seller.world, 'give', seller);
	if (price > 0) {
		host.pushEvent({
			kind: 'Bought',
			text: `${bodyName(buyer)} bought ${label} from ${bodyName(seller)} for ${price} gold`,
			tags: ['buy', label, bodyName(buyer), bodyName(seller)],
			major: false,
		});
	}
	noteWant(buyer, label);
	return { ok: true, verb: 'buy', reason: `bought ${label} from ${fromName} for ${price} gold` };
}

export function settleSell(
	seller:GameObject,
	buyer:GameObject,
	itemName:string,
	ask:number,
	host:GameHost,
):ArcResult {
	const toName = bodyName(buyer);
	const stock = findSaleItem(seller, itemName) ?? findItem(seller, itemName);
	if (!stock) {
		return { ok: false, verb: 'sell', reason: `not carrying ${itemName}` };
	}
	const quote = priceFor(seller, stock, toName);
	const price = Number.isFinite(ask) ? Math.floor(ask) : (quote?.ask ?? quote?.floor);
	if (price === undefined || price <= 0) {
		return { ok: false, verb: 'sell', reason: `${itemName} has no price — name an ask` };
	}
	const npc = buyer.getComponent(MarketNPC);
	if (npc && npc.wants.length > 0) {
		const want = npc.wants.some((w) => compactName(w) === compactName(itemName));
		if (!want && toName !== 'Player') {
			return { ok: false, verb: 'sell', reason: `${toName} does not want ${itemName}` };
		}
	}
	if (coinsOf(buyer) < price) {
		return { ok: false, verb: 'sell', reason: `${toName} has only ${coinsOf(buyer)} gold` };
	}
	const err = transferCoins(buyer, seller, price);
	if (err) {
		return { ok: false, verb: 'sell', reason: err };
	}
	const gift = takeOne(seller, stock);
	if (!tryInsert(buyer, gift)) {
		restoreOne(seller, gift, stock);
		transferCoins(seller, buyer, price);
		return { ok: false, verb: 'sell', reason: `${toName} has no room` };
	}
	const label = pascalCase(gift.name) || gift.name;
	const t = seller.world?.time ?? 0;
	seller.getComponent(HumanSprite)?.playClip('give', t);
	buyer.getComponent(HumanSprite)?.playClip('take', t);
	cueAt(seller.world, 'give', seller);
	if (price > 0) {
		host.pushEvent({
			kind: 'Bought',
			text: `${bodyName(buyer)} bought ${label} from ${bodyName(seller)} for ${price} gold`,
			tags: ['buy', label, bodyName(buyer), bodyName(seller)],
			major: false,
		});
	}
	noteWant(buyer, label);
	return { ok: true, verb: 'sell', reason: `sold ${label} to ${toName} for ${price} gold` };
}

export async function doGive(
	host:GameHost,
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	toName:string,
):Promise<ArcResult> {
	if (!toName) {
		return { ok: false, verb: 'give', reason: 'give to whom?' };
	}
	const target = findBody(ctx.world, toName);
	if (!target) {
		return { ok: false, verb: 'give', reason: `no such person ${toName}` };
	}
	const walk = await ensureRange(npc, ctx.actor, target, toName);
	if (!walk.ok) {
		return { ...walk, verb: 'give' };
	}
	return settleGive(ctx.actor, target, itemName, host);
}

export async function doBuy(
	host:GameHost,
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	fromName:string,
	offer:number,
):Promise<ArcResult> {
	if (!fromName) {
		return { ok: false, verb: 'buy', reason: 'buy from whom?' };
	}
	const seller = findBody(ctx.world, fromName);
	if (!seller) {
		return { ok: false, verb: 'buy', reason: `no such person ${fromName}` };
	}
	const walk = await ensureRange(npc, ctx.actor, seller, fromName);
	if (!walk.ok) {
		return { ...walk, verb: 'buy' };
	}
	return settleBuy(ctx.actor, seller, itemName, offer, host);
}

export async function doSell(
	host:GameHost,
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	toName:string,
	ask:number,
):Promise<ArcResult> {
	if (!toName) {
		return { ok: false, verb: 'sell', reason: 'sell to whom?' };
	}
	const buyer = findBody(ctx.world, toName);
	if (!buyer) {
		return { ok: false, verb: 'sell', reason: `no such person ${toName}` };
	}
	const walk = await ensureRange(npc, ctx.actor, buyer, toName);
	if (!walk.ok) {
		return { ...walk, verb: 'sell' };
	}
	return settleSell(ctx.actor, buyer, itemName, ask, host);
}

export async function doSteal(
	host:GameHost,
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	fromName:string,
):Promise<ArcResult> {
	if (!fromName) {
		return { ok: false, verb: 'steal', reason: 'steal from whom?' };
	}
	if (ctx.actor.getComponent(MarketNPC)?.kind === 'guard') {
		return { ok: false, verb: 'steal', reason: 'the watch does not steal' };
	}
	const victim = findBody(ctx.world, fromName);
	if (!victim) {
		return { ok: false, verb: 'steal', reason: `no such person ${fromName}` };
	}
	if (victim === ctx.actor) {
		return { ok: false, verb: 'steal', reason: 'cannot steal from yourself' };
	}
	const walk = await ensureRange(npc, ctx.actor, victim, fromName);
	if (!walk.ok) {
		return { ...walk, verb: 'steal' };
	}
	const stock = findSaleItem(victim, itemName) ?? findItem(victim, itemName);
	if (!stock) {
		return { ok: false, verb: 'steal', reason: `${fromName} has no ${itemName}` };
	}
	const gift = takeOne(victim, stock);
	if (!tryInsert(ctx.actor, gift)) {
		restoreOne(victim, gift, stock);
		return { ok: false, verb: 'steal', reason: 'no room' };
	}
	const label = pascalCase(gift.name) || gift.name;
	ctx.actor.getComponent(HumanSprite)?.playClip('take', ctx.world.time);
	reportTheft(host, ctx.actor, label, fromName, 'stole without paying');
	return { ok: true, verb: 'steal', reason: `stole ${label} from ${fromName}` };
}

export function reportTheft(
	host:GameHost,
	thief:GameObject,
	item:string,
	fromID:string,
	reason:string,
):void {
	if (!host.hooks.allowTheft) {
		return;
	}
	if (thief.getComponent(MarketNPC)?.kind === 'guard') {
		return;
	}
	let mark = thief.getComponent(Wanted);
	if (!mark) {
		mark = thief.addComponent(new Wanted());
	}
	mark.enabled = true;
	mark.reason = reason;
	if (fromID) {
		mark.fromID = fromID;
	}
	if (!mark.items.some((it) => compactName(it) === compactName(item))) {
		mark.items.push(item);
	}
	const who = bodyName(thief);
	host.pushEvent({
		kind: 'Theft',
		text: `${who} ${reason}: ${item}${fromID ? ` from ${fromID}` : ''}`,
		tags: ['steal', item, who, fromID],
		major: true,
	});
	const p = thief.transform.position;
	poseFact(host, { id: `Theft:${who}`, tags: ['theft', 'event'], x: p.x, z: p.z });
	host.world.setMessage(`Theft — ${who} took ${item}`);
}
