import {
	buildCatalog,
	evaluate,
	isCrowdConductor,
	pascalCase,
	SampleCache,
	type ArcResult,
	type ExprVal,
	type Step,
} from 'arc-director';
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
import { bodyName, findBody, isLiving } from './names';
import { kernelsOf, poseFact } from './kernels';
import { doExamine } from './perception';
import { applyHit } from './hitFeel';
import {
	agilityOf,
	ATTACKS,
	attackVerbFor,
	COVER_SOFTEN,
	fightCompany,
	fightLabel,
	fightRole,
	fightTags,
	fightExprTags,
	findAllyTarget,
	findFightTarget,
	HEAL,
	isBackRole,
	isFrontRole,
	isRivalBody,
	nearestAlly,
	nearestRival,
	rankSlot,
	type AttackKind,
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

function looksLikeTargetExpr(s:string):boolean {
	return /[()]/.test(s) || s.includes('.') || s.includes('=>');
}

function bodyFromExprVal(host:GameHost, observer:GameObject, v:ExprVal):GameObject | undefined {
	if (v.kind === 'entity') {
		return findBody(observer.world ?? host.world, v.value.id);
	}
	if (v.kind === 'string' && v.value) {
		return findAllyTarget(host, observer, v.value) ?? findFightTarget(host, observer, v.value);
	}
	if (v.kind === 'list') {
		for (const row of v.value) {
			const go = bodyFromExprVal(host, observer, row);
			if (go) {
				return go;
			}
		}
	}
	return undefined;
}

function evalTarget(host:GameHost, observer:GameObject, raw:string):GameObject | undefined {
	const trimmed = raw.trim();
	if (!trimmed || !looksLikeTargetExpr(trimmed)) {
		return undefined;
	}
	const catalog = buildCatalog({
		...kernelsOf(
			host.world,
			observer,
			host.posedEvents,
			undefined,
			(go) => fightExprTags(host, observer, go),
		),
		cache: new SampleCache(),
	});
	const r = evaluate(trimmed, catalog);
	if (r.error) {
		return undefined;
	}
	const go = bodyFromExprVal(host, observer, r.value);
	if (!go || go === observer || !isLiving(go)) {
		return undefined;
	}
	return go;
}

function resolveFoe(host:GameHost, observer:GameObject, raw:string):GameObject | undefined {
	const scored = evalTarget(host, observer, raw);
	if (scored && isRivalBody(host, observer, scored)) {
		return scored;
	}
	return findFightTarget(host, observer, raw);
}

function resolveAlly(host:GameHost, observer:GameObject, raw:string):GameObject | undefined {
	const scored = evalTarget(host, observer, raw);
	if (scored && !isRivalBody(host, observer, scored)) {
		return scored;
	}
	return findAllyTarget(host, observer, raw);
}

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
	if (!isLiving(ctx.actor)) {
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
			const target = evalTarget(host, ctx.actor, name)
				?? findAllyTarget(host, ctx.actor, name)
				?? findFightTarget(host, ctx.actor, name);
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
		case 'attack': {
			const role = fightRole(host, ctx.actor);
			const verb = role ? attackVerbFor(role) : undefined;
			if (!verb) {
				return { ok: false, verb: 'attack', reason: 'no attack' };
			}
			return doAttack(host, ctx, npc, verb, String(step.args.name ?? ''));
		}
		case 'rank':
			return doRank(host, ctx, npc);
		case 'protect':
			return doProtect(host, ctx, npc, String(step.args.name ?? ''));
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
	const own = arc?.agent(id);
	if (own && !isCrowdConductor(own)) {
		arc?.removeAgent(id);
	}
	for (const agent of arc?.agents() ?? []) {
		if (!isCrowdConductor(agent) || !agent.crowd.has(id)) {
			continue;
		}
		arc?.removeCrowdUnit(agent.id, id);
		const alive = agent.crowd.list().some((unit) => isLiving(findBody(host.world, unit.id)));
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
	);
}

const RANK_ARRIVE = 1.2;

async function closeTo(
	host:GameHost,
	npc:NPCInput,
	actor:GameObject,
	target:GameObject,
	name:string,
	range:number,
	useRank = true,
):Promise<ArcResult> {
	const role = fightRole(host, actor);
	const slot = useRank ? rankSlot(host, actor) : undefined;
	if (slot && (isBackRole(role) || isFrontRole(role))) {
		const here = actor.transform.position;
		if (Math.hypot(here.x - slot.x, here.z - slot.z) > RANK_ARRIVE) {
			const walk = await npc.goToPoint(slot.x, slot.z);
			if (!walk.ok) {
				return walk;
			}
		}
		if (distXZ(actor, target) <= range + 0.5) {
			return { ok: true };
		}
		if (isBackRole(role)) {
			return { ok: false, reason: 'too far' };
		}
	}
	const close = Math.max(0.9, range - 0.6);
	if (distXZ(actor, target) > close) {
		const walk = await npc.goTo(name, close);
		if (!walk.ok) {
			return walk;
		}
	}
	if (distXZ(actor, target) > range + 0.5) {
		return { ok: false, reason: 'too far' };
	}
	return { ok: true };
}

async function doRank(host:GameHost, ctx:HostCtx, npc:NPCInput):Promise<ArcResult> {
	const slot = rankSlot(host, ctx.actor);
	if (!slot) {
		return { ok: false, verb: 'rank', reason: 'no line' };
	}
	const here = ctx.actor.transform.position;
	if (Math.hypot(here.x - slot.x, here.z - slot.z) <= RANK_ARRIVE) {
		const hold = await npc.wait(0.35);
		if (!hold.ok) {
			return { ...hold, verb: 'rank' };
		}
		return { ok: true, verb: 'rank' };
	}
	const walk = await npc.goToPoint(slot.x, slot.z);
	return { ...walk, verb: 'rank' };
}

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
	if (!spec.cover) {
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
	locked?:GameObject,
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
	let target = locked
		?? (name.trim()
			? resolveFoe(host, ctx.actor, name)
			: nearestRival(host, ctx.actor));
	if (!target) {
		return {
			ok: false,
			verb: attack.name,
			reason: name.trim() ? `no such person ${name}` : 'no one to attack',
		};
	}
	if (target === ctx.actor) {
		return { ok: false, verb: attack.name, reason: `cannot ${attack.name} yourself` };
	}
	const dest = bodyName(target);
	const weapon = heldWeapon(ctx.actor);
	const melee = !attack.spec.cover;
	const range = melee ? Math.max(attack.spec.range, weapon?.range ?? 0) : attack.spec.range;
	const walk = await closeTo(host, npc, ctx.actor, target, dest, range, !locked);
	if (!walk.ok) {
		return { ...walk, verb: attack.name };
	}
	npc.faceToward(dest);
	const held = await holdReady(npc, ctx.world.time, npc.attackReadyAt, attack.spec.castTime);
	if (!held.ok) {
		return { ...held, verb: attack.name };
	}
	target = resolveFoe(host, ctx.actor, name) ?? target;
	if (target === ctx.actor) {
		return { ok: false, verb: attack.name, reason: `cannot ${attack.name} yourself` };
	}
	if (distXZ(ctx.actor, target) > range + 0.5) {
		return { ok: false, verb: attack.name, reason: 'too far' };
	}
	const clear = !attack.spec.cover || combatSight(ctx.world, ctx.actor, target);
	const who = fightLabel(host, ctx.actor);
	const foe = fightLabel(host, target);
	if (attack.spec.cover === 'block' && !clear) {
		host.pushEvent({
			kind: 'Miss',
			text: `${who} has no shot at ${foe} — flank`,
			tags: [who, foe, 'cover', attack.name],
			major: false,
		});
		return { ok: false, verb: attack.name, reason: 'no line of sight — flank for a clear shot' };
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
	const covered = attack.spec.cover === 'soften' && !clear;
	let chance = hitChance(attack.spec, dist, agilityOf(host, target));
	if (covered) {
		chance = Math.min(0.97, Math.max(0.05, chance * COVER_SOFTEN));
	}
	npc.faceToward(bodyName(target));
	if (Math.random() >= chance) {
		host.pushEvent({
			kind: 'Miss',
			text: covered ? `${who} missed ${foe} through cover` : `${who} missed ${foe}`,
			tags: [who, foe, 'miss', attack.name, ...(covered ? ['cover'] : [])],
			major: false,
		});
		return { ok: true, verb: attack.name, reason: covered ? `missed ${foe} through cover` : `missed ${foe}` };
	}
	let dmg = melee ? Math.max(attack.spec.damage, weapon?.damage ?? 0) : attack.spec.damage;
	if (covered) {
		dmg = Math.max(1, Math.round(dmg * COVER_SOFTEN));
	}
	vitals.hp = Math.max(0, vitals.hp - dmg);
	applyHit(ctx.world, ctx.actor, target, attack.spec.knock ?? 1);
	host.pushEvent({
		kind: 'Hurt',
		text: covered
			? `${who} ${attack.spec.word} ${foe} through cover`
			: `${who} ${attack.spec.word} ${foe}`,
		tags: [who, foe, 'hurt', attack.name, ...(covered ? ['cover'] : [])],
		major: false,
	});
	if (vitals.hp <= 0) {
		dropDown(host, target);
		return { ok: true, verb: attack.name, reason: `${foe} is down` };
	}
	return {
		ok: true,
		verb: attack.name,
		reason: covered
			? `${foe} ${vitals.hp}/${vitals.maxHP} through cover`
			: `${foe} ${vitals.hp}/${vitals.maxHP}`,
	};
}

const PROTECT_COVER = 1.2;

function interceptPoint(ward:GameObject, threat:GameObject):{ x:number; z:number } {
	const a = ward.transform.position;
	const t = threat.transform.position;
	const dx = t.x - a.x;
	const dz = t.z - a.z;
	const len = Math.hypot(dx, dz);
	if (len < 0.15) {
		return { x: a.x, z: a.z };
	}
	const cover = Math.min(PROTECT_COVER, len * 0.45);
	return { x: a.x + (dx / len) * cover, z: a.z + (dz / len) * cover };
}

function protectWard(host:GameHost, actor:GameObject, name:string):GameObject | undefined {
	const trimmed = name.trim();
	if (trimmed) {
		return resolveAlly(host, actor, trimmed);
	}
	return nearestAlly(host, actor, isHurtBody);
}

async function doProtect(host:GameHost, ctx:HostCtx, npc:NPCInput, name:string):Promise<ArcResult> {
	const ward = protectWard(host, ctx.actor, name);
	if (!ward) {
		return {
			ok: false,
			verb: 'protect',
			reason: name.trim() ? `no such person ${name}` : 'no one to protect',
		};
	}
	const threat = nearestRival(host, ward);
	if (!threat) {
		const walk = await npc.goTo(bodyName(ward), 1.4);
		if (!walk.ok) {
			return { ...walk, verb: 'protect' };
		}
		const hold = await npc.wait(0.35);
		if (!hold.ok) {
			return { ...hold, verb: 'protect' };
		}
		return { ok: true, verb: 'protect', reason: `guard ${bodyName(ward)}` };
	}
	const screen = interceptPoint(ward, threat);
	const here = ctx.actor.transform.position;
	if (Math.hypot(screen.x - here.x, screen.z - here.z) > 0.55) {
		const walk = await npc.goToPoint(screen.x, screen.z);
		if (!walk.ok) {
			return { ...walk, verb: 'protect' };
		}
	}
	npc.faceToward(bodyName(threat));
	const swing = fightRole(host, ctx.actor);
	const verb = swing ? attackVerbFor(swing) : undefined;
	if (verb) {
		const hit = await doAttack(host, ctx, npc, verb, '', threat);
		return { ...hit, verb: 'protect', reason: hit.reason ?? `peel ${bodyName(threat)}` };
	}
	const hold = await npc.wait(0.35);
	if (!hold.ok) {
		return { ...hold, verb: 'protect' };
	}
	return { ok: true, verb: 'protect', reason: `screen ${bodyName(ward)}` };
}

const HEAL_REST = ['Witch', 'Archer', 'Blade'] as const;

function isHurtBody(go:GameObject):boolean {
	const vitals = go.getComponent(Vitals);
	return !!vitals && vitals.hp > 0 && vitals.hp < vitals.maxHP;
}

function companyLiving(host:GameHost, actor:GameObject):GameObject[] {
	const company = fightCompany(host, actor);
	if (!company) {
		return isLiving(actor) ? [actor] : [];
	}
	const out:GameObject[] = [];
	const seen = new Set<string>();
	for (const unit of company.crowd.list()) {
		const go = findBody(host.world, unit.id);
		if (!isLiving(go) || seen.has(go.id)) {
			continue;
		}
		seen.add(go.id);
		out.push(go);
	}
	if (isLiving(actor) && !seen.has(actor.id)) {
		out.push(actor);
	}
	return out;
}

function hasHealTag(host:GameHost, go:GameObject, tag:string):boolean {
	const tags = fightTags(host, go);
	if (tags.includes(tag)) {
		return true;
	}
	if (tag === 'Captain') {
		return fightCompany(host, go)?.commanderID === bodyName(go);
	}
	return false;
}

function pickHealTarget(host:GameHost, healer:GameObject):GameObject | undefined {
	const hurt = companyLiving(host, healer).filter(isHurtBody);
	if (hurt.length === 0) {
		return undefined;
	}
	const knight = hurt.find((go) => hasHealTag(host, go, 'Knight'));
	if (knight) {
		return knight;
	}
	if (hurt.includes(healer)) {
		return healer;
	}
	const captain = hurt.find((go) => hasHealTag(host, go, 'Captain'));
	if (captain) {
		return captain;
	}
	for (const tag of HEAL_REST) {
		const hit = hurt.find((go) => hasHealTag(host, go, tag));
		if (hit) {
			return hit;
		}
	}
	return hurt.find((go) => go !== healer) ?? hurt[0];
}

function findHealNamed(host:GameHost, healer:GameObject, name:string):GameObject | undefined {
	const trimmed = name.trim();
	if (!trimmed) {
		return undefined;
	}
	const scored = resolveAlly(host, healer, trimmed);
	if (scored) {
		return scored;
	}
	const living = companyLiving(host, healer);
	const tagged = living.filter((go) => hasHealTag(host, go, trimmed));
	if (tagged.length > 0) {
		return tagged.find(isHurtBody) ?? tagged[0];
	}
	const go = findBody(healer.world ?? host.world, trimmed);
	if (!go || isRivalBody(host, healer, go)) {
		return undefined;
	}
	return living.includes(go) ? go : undefined;
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
	let target = name.trim()
		? findHealNamed(host, ctx.actor, name)
		: pickHealTarget(host, ctx.actor);
	if (!target) {
		return {
			ok: false,
			verb: 'heal',
			reason: name.trim() ? `no such person ${name}` : 'no one hurt',
		};
	}
	const id = bodyName(target);
	if (target !== ctx.actor) {
		const walk = await closeTo(host, npc, ctx.actor, target, id, HEAL.range);
		if (!walk.ok) {
			return { ...walk, verb: 'heal' };
		}
		npc.faceToward(id);
	}
	const held = await holdReady(npc, ctx.world.time, npc.healReadyAt, HEAL.castTime);
	if (!held.ok) {
		return { ...held, verb: 'heal' };
	}
	target = findBody(ctx.world, id) ?? target;
	if (!isLiving(target)) {
		return { ok: false, verb: 'heal', reason: 'down' };
	}
	if (target !== ctx.actor) {
		if (isRivalBody(host, ctx.actor, target)) {
			return { ok: false, verb: 'heal', reason: 'heal your company, not the enemy' };
		}
		if (distXZ(ctx.actor, target) > HEAL.range + 0.5) {
			return { ok: false, verb: 'heal', reason: 'too far' };
		}
	}
	const vitals = target.getComponent(Vitals);
	if (!vitals) {
		return { ok: false, verb: 'heal', reason: 'no vitals' };
	}
	const covered = target !== ctx.actor && !combatSight(ctx.world, ctx.actor, target);
	const hp = covered ? Math.max(1, Math.round(HEAL.hp * COVER_SOFTEN)) : HEAL.hp;
	npc.healReadyAt = ctx.world.time + HEAL.cooldown;
	healActor(target, hp);
	const who = fightLabel(host, ctx.actor);
	const ally = fightLabel(host, target);
	host.pushEvent({
		kind: 'Heal',
		text: covered ? `${who} healed ${ally} through cover` : `${who} healed ${ally}`,
		tags: [who, ally, 'heal', ...(covered ? ['cover'] : [])],
		major: false,
	});
	return {
		ok: true,
		verb: 'heal',
		reason: covered
			? `${bodyName(target)} ${vitals.hp}/${vitals.maxHP} through cover`
			: `${bodyName(target)} ${vitals.hp}/${vitals.maxHP}`,
	};
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
