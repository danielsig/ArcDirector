import {
	isCrowdConductor,
	pascalCase,
	DEFAULT_VERB_INSTRUCTIONS,
	STOCK_VERBS,
	type ArcDirector,
	type ArcResult,
	type VerbCall,
	type VerbGate,
} from 'arc-director';
import {
	BODY_SLOTS,
	BoxCollider,
	HumanBody,
	HumanSprite,
	MarketNPC,
	Wanted,
	Vitals,
	Celebrating,
	HurtFlash,
	type BodySlot,
} from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import {
	distXZ,
	findCarried,
	removeFromBags,
	slotItem,
	tryInsert,
	compactName,
	healActor,
} from '../items/inventory';
import { findSaleItem } from '../items/wallet';
import { equipItem, unequipSlot } from '../items/equip';
import { NPCInput } from '../actors/NPCInput';
import type { GameHost } from './adapter';
import { findItem, restoreSome, takeSome } from './items';
import { bodyName, findBody, isLiving } from './names';
import { applyHit } from './hitFeel';
import {
	agilityOf,
	ATTACKS,
	attackVerbFor,
	COVER_SOFTEN,
	fightCompany,
	seenName,
	fightRole,
	fightTags,
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
import type { AgentCtx } from './types';

type Director = ArcDirector<AgentCtx>;
type Call = VerbCall<AgentCtx>;

/** Every verb this game's NPCs may use, before a scene adds its own. */
export const GAME_VERBS = [...STOCK_VERBS, 'equip', 'unequip'];

/** Verb doctrine for scenes with buildings: going to a door stops outside it. */
export const BUILDING_VERB_INSTRUCTIONS = `${DEFAULT_VERB_INSTRUCTIONS} go_to a doorway is still outside; inside is the building.`;

/** A living body other than the actor. ArcDirector already turned names and expressions into this id. */
function bodyOf(ctx:AgentCtx, id:string):GameObject | undefined {
	const go = id ? findBody(ctx.world, id) : undefined;
	return isLiving(go) && go !== ctx.actor ? go : undefined;
}

function asSlot(raw:string):BodySlot | undefined {
	return (BODY_SLOTS as readonly string[]).includes(raw) ? raw as BodySlot : undefined;
}

/** Steps this body may not take right now: its company already won, it is celebrating, or it would walk into a foe. */
export function verbGate(host:GameHost):VerbGate<AgentCtx> {
	return ({ verb, ctx, args }) => {
		if (host.bargainDone && fightRole(host, ctx.actor)) {
			return { ok: false, interrupted: true, verb, reason: 'won' };
		}
		const hop = ctx.actor.getComponent(Celebrating);
		if (hop?.enabled && ctx.world.time < hop.until) {
			return { ok: false, interrupted: true, verb, reason: 'celebrating' };
		}
		const foe = verb === 'go_to' && typeof args.target === 'string' ? findBody(ctx.world, args.target) : undefined;
		if (foe && isRivalBody(host, ctx.actor, foe)) {
			return { ok: false, verb, reason: `${seenName(host, ctx.actor, foe)} is an enemy; go_to does not attack` };
		}
		return undefined;
	};
}

/** What this game's bodies wear and hold. ArcDirector runs the stock world verbs through `withWorld`. */
export function addBodyVerbs(director:Director):Director {
	return director
		.addVerb('equip', {
			args: { item: 'id', slot: 'string?' },
			handler: ({ ctx, args }) => doEquip(ctx, args.item, args.slot),
		})
		.addVerb('unequip', {
			args: { slot: 'string' },
			handler: ({ ctx, args }) => doUnequip(ctx, args.slot),
		});
}

/** Taking without paying. Register it; a scene's kit grants it where theft is possible. */
export function addStealVerb(director:Director, host:GameHost):Director {
	return director.addVerb('steal', {
		args: { item: 'id', from: 'id' },
		help: 'goes to them first',
		handler: (call) => doSteal(host, call, call.args.item, call.args.from),
	});
}

/** Dungeon: an overhead status line, and rest once the scene's goal is met. */
export function addStatusVerbs(director:Director, host:GameHost):Director {
	return director
		.addVerb('set_status', {
			args: { text: 'text', seconds: 'number?' },
			handler: ({ ctx, args }) => {
				const label = args.text.trim().slice(0, 72);
				if (!label) {
					return { ok: false, verb: 'set_status', reason: 'nothing to show' };
				}
				const life = Math.min(60, Math.max(1, args.seconds ?? 6));
				host.labels.set(bodyName(ctx.actor), { text: label, until: ctx.world.time + life });
				return { ok: true, verb: 'set_status', reason: `${life}s` };
			},
		})
		.addVerb('rest', {
			handler: ({ ctx }) => ({
				ok: true,
				verb: 'rest',
				reason: host.hooks.goalDone?.(host, bodyName(ctx.actor)) ? 'done — still listening' : 'goal still open',
			}),
		});
}

const COVER_HELP:Record<NonNullable<AttackKind['cover']>, string> = {
	block: 'needs a clear line of sight; flank around cover',
	soften: 'weaker through cover; flank for a full hit',
};

/** Ruins combat: one verb per attack, plus attack (your role's), heal, protect, and rank. */
export function addFightVerbs(director:Director, host:GameHost):Director {
	for (const [verb, spec] of Object.entries(ATTACKS)) {
		director.addVerb(verb, {
			args: { target: 'id' },
			help: spec.cover && COVER_HELP[spec.cover],
			handler: (call) => doAttack(host, call, verb, call.args.target),
		});
	}
	return director
		.addVerb('attack', {
			args: { target: 'id?' },
			handler: (call) => {
				const role = fightRole(host, call.ctx.actor);
				const verb = role ? attackVerbFor(role) : undefined;
				return verb
					? doAttack(host, call, verb, call.args.target ?? '')
					: { ok: false, verb: 'attack', reason: 'no attack' };
			},
		})
		.addVerb('heal', {
			args: { target: 'id?' },
			help: 'weaker through cover; flank for a full heal',
			handler: (call) => doHeal(host, call, call.args.target ?? ''),
		})
		.addVerb('protect', {
			args: { target: 'id?' },
			help: 'stand between an ally and the threat, then attack that threat',
			handler: (call) => doProtect(host, call, call.args.target ?? ''),
		})
		.addVerb('rank', { handler: (call) => doRank(host, call) });
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
	host.arc?.abortArc(bodyName(who));
	const npc = who.getComponent(NPCInput);
	if (npc) {
		npc.enabled = false;
		npc.aiOn = false;
	}
	const col = who.getComponent(BoxCollider);
	if (col && !who.getComponent(HurtFlash)?.active) {
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
	host.arc?.pushEvent({
		kind: 'Hurt',
		text: '{0} is down',
		who: [bodyName(who)],
		tags: ['down'],
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

async function closeTo(host:GameHost, call:Call, target:GameObject, range:number, useRank = true):Promise<ArcResult> {
	const actor = call.ctx.actor;
	const role = fightRole(host, actor);
	const slot = useRank ? rankSlot(host, actor) : undefined;
	if (slot && (isBackRole(role) || isFrontRole(role))) {
		const here = actor.transform.position;
		if (Math.hypot(here.x - slot.x, here.z - slot.z) > RANK_ARRIVE) {
			const walk = await call.goToPoint([slot.x, slot.z]);
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
		const walk = await call.goTo(bodyName(target), close);
		if (!walk.ok) {
			return walk;
		}
	}
	if (distXZ(actor, target) > range + 0.5) {
		return { ok: false, reason: 'too far' };
	}
	return { ok: true };
}

async function doRank(host:GameHost, call:Call):Promise<ArcResult> {
	const slot = rankSlot(host, call.ctx.actor);
	if (!slot) {
		return { ok: false, verb: 'rank', reason: 'no line' };
	}
	const here = call.ctx.actor.transform.position;
	if (Math.hypot(here.x - slot.x, here.z - slot.z) <= RANK_ARRIVE) {
		const hold = await call.wait(0.35);
		if (!hold.ok) {
			return { ...hold, verb: 'rank' };
		}
		return { ok: true, verb: 'rank' };
	}
	const walk = await call.goToPoint([slot.x, slot.z]);
	return { ...walk, verb: 'rank' };
}

function attackOf(verb:string):{ name:string; spec:AttackKind } | undefined {
	const spec = ATTACKS[verb];
	return spec ? { name: verb, spec } : undefined;
}

async function holdReady(
	call:Call,
	now:number,
	readyTimestamp:number,
	castTime:number,
):Promise<ArcResult> {
	const cool = readyTimestamp - now;
	if (cool > 0.02) {
		const waited = await call.wait(cool);
		if (!waited.ok || waited.interrupted) {
			return { ok: false, interrupted: waited.interrupted, reason: waited.reason, verb: 'wait' };
		}
	}
	if (castTime > 0.02) {
		const cast = await call.wait(castTime);
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

async function doAttack(host:GameHost, call:Call, verb:string, name:string, locked?:GameObject):Promise<ArcResult> {
	const { ctx } = call;
	const npc = ctx.npc;
	const role = fightRole(host, ctx.actor);
	const attack = attackOf(verb);
	if (!attack) {
		return { ok: false, verb, reason: `unhandled attack ${verb}` };
	}
	if (role && !attack.spec.roles.includes(role)) {
		const need = attack.spec.roles.join(' or ');
		return { ok: false, verb, reason: `only a ${need} can ${attack.name}` };
	}
	const target = locked ?? (name.trim() ? bodyOf(ctx, name) : nearestRival(host, ctx.actor));
	if (!target) {
		return {
			ok: false,
			verb: attack.name,
			reason: name.trim() ? `no such person ${name}` : 'no one to attack',
		};
	}
	const dest = bodyName(target);
	const weapon = heldWeapon(ctx.actor);
	const melee = !attack.spec.cover;
	const range = melee ? Math.max(attack.spec.range, weapon?.range ?? 0) : attack.spec.range;
	const walk = await closeTo(host, call, target, range, !locked);
	if (!walk.ok) {
		return { ...walk, verb: attack.name };
	}
	npc.faceToward(dest);
	const held = await holdReady(call, ctx.world.time, npc.attackReadyTimestamp, attack.spec.castTime);
	if (!held.ok) {
		return { ...held, verb: attack.name };
	}
	if (distXZ(ctx.actor, target) > range + 0.5) {
		return { ok: false, verb: attack.name, reason: 'too far' };
	}
	const clear = !attack.spec.cover || combatSight(ctx.world, ctx.actor, target);
	const who = [bodyName(ctx.actor), bodyName(target)];
	const foe = seenName(host, ctx.actor, target);
	if (attack.spec.cover === 'block' && !clear) {
		host.arc?.pushEvent({
			kind: 'Miss',
			text: '{0} has no shot at {1} — flank',
			who,
			tags: ['cover', attack.name],
			major: false,
		});
		return { ok: false, verb: attack.name, reason: 'no line of sight — flank for a clear shot' };
	}
	const vitals = target.getComponent(Vitals);
	if (!vitals) {
		return { ok: false, verb: attack.name, reason: 'no vitals' };
	}
	npc.attackReadyTimestamp = ctx.world.time + attack.spec.cooldown;
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
		host.arc?.pushEvent({
			kind: 'Miss',
			text: covered ? '{0} missed {1} through cover' : '{0} missed {1}',
			who,
			tags: ['miss', attack.name, ...(covered ? ['cover'] : [])],
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
	host.arc?.pushEvent({
		kind: 'Hurt',
		text: covered ? `{0} ${attack.spec.word} {1} through cover` : `{0} ${attack.spec.word} {1}`,
		who,
		tags: ['hurt', attack.name, ...(covered ? ['cover'] : [])],
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

function protectWard(host:GameHost, ctx:AgentCtx, name:string):GameObject | undefined {
	if (!name.trim()) {
		return nearestAlly(host, ctx.actor, isHurtBody);
	}
	const go = bodyOf(ctx, name);
	return go && !isRivalBody(host, ctx.actor, go) ? go : undefined;
}

async function doProtect(host:GameHost, call:Call, name:string):Promise<ArcResult> {
	const { ctx } = call;
	const ward = protectWard(host, ctx, name);
	if (!ward) {
		return {
			ok: false,
			verb: 'protect',
			reason: name.trim() ? `no such person ${name}` : 'no one to protect',
		};
	}
	const threat = nearestRival(host, ward);
	if (!threat) {
		const walk = await call.goTo(bodyName(ward), 1.4);
		if (!walk.ok) {
			return { ...walk, verb: 'protect' };
		}
		const hold = await call.wait(0.35);
		if (!hold.ok) {
			return { ...hold, verb: 'protect' };
		}
		return { ok: true, verb: 'protect', reason: `guard ${bodyName(ward)}` };
	}
	const screen = interceptPoint(ward, threat);
	const here = ctx.actor.transform.position;
	if (Math.hypot(screen.x - here.x, screen.z - here.z) > 0.55) {
		const walk = await call.goToPoint([screen.x, screen.z]);
		if (!walk.ok) {
			return { ...walk, verb: 'protect' };
		}
	}
	ctx.npc.faceToward(bodyName(threat));
	const swing = fightRole(host, ctx.actor);
	const verb = swing ? attackVerbFor(swing) : undefined;
	if (verb) {
		const hit = await doAttack(host, call, verb, '', threat);
		return { ...hit, verb: 'protect', reason: hit.reason ?? `peel ${bodyName(threat)}` };
	}
	const hold = await call.wait(0.35);
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

/** Someone in the healer's company, the healer included. */
function findHealNamed(host:GameHost, healer:GameObject, name:string):GameObject | undefined {
	const go = findBody(healer.world ?? host.world, name.trim());
	return go && companyLiving(host, healer).includes(go) ? go : undefined;
}

async function doHeal(host:GameHost, call:Call, name:string):Promise<ArcResult> {
	const { ctx } = call;
	const npc = ctx.npc;
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
		const walk = await closeTo(host, call, target, HEAL.range);
		if (!walk.ok) {
			return { ...walk, verb: 'heal' };
		}
		npc.faceToward(id);
	}
	const held = await holdReady(call, ctx.world.time, npc.healReadyTimestamp, HEAL.castTime);
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
	npc.healReadyTimestamp = ctx.world.time + HEAL.cooldown;
	healActor(target, hp);
	const ally = bodyName(target);
	host.arc?.pushEvent({
		kind: 'Heal',
		text: covered ? '{0} healed {1} through cover' : '{0} healed {1}',
		who: [bodyName(ctx.actor), ally],
		tags: ['heal', ...(covered ? ['cover'] : [])],
		major: false,
	});
	return {
		ok: true,
		verb: 'heal',
		reason: covered
			? `${ally} ${vitals.hp}/${vitals.maxHP} through cover`
			: `${ally} ${vitals.hp}/${vitals.maxHP}`,
	};
}

async function doEquip(ctx:AgentCtx, itemName:string, slotName?:string):Promise<ArcResult> {
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

async function doUnequip(ctx:AgentCtx, slotName:string):Promise<ArcResult> {
	const slot = asSlot(slotName);
	if (!slot) {
		return { ok: false, verb: 'unequip', reason: `no slot ${slotName}` };
	}
	unequipSlot(ctx.actor, slot, ctx.world);
	return { ok: true, verb: 'unequip' };
}

async function doSteal(host:GameHost, call:Call, itemName:string, fromName:string):Promise<ArcResult> {
	const { ctx } = call;
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
	const walk = await call.goTo(fromName);
	if (!walk.ok) {
		return { ...walk, verb: 'steal' };
	}
	const stock = findSaleItem(victim, itemName) ?? findItem(victim, itemName);
	if (!stock) {
		return { ok: false, verb: 'steal', reason: `${fromName} has no ${itemName}` };
	}
	const gift = takeSome(victim, stock);
	if (!tryInsert(ctx.actor, gift)) {
		restoreSome(victim, gift, stock);
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
	const mark = thief.getOrAddComponent(Wanted);
	mark.enabled = true;
	mark.reason = reason;
	if (fromID) {
		mark.fromID = fromID;
	}
	if (!mark.items.some((it) => compactName(it) === compactName(item))) {
		mark.items.push(item);
	}
	const who = bodyName(thief);
	host.arc?.pushEvent({
		kind: 'Theft',
		text: `${who} ${reason}: ${item}${fromID ? ` from ${fromID}` : ''}`,
		tags: ['steal', item, who, fromID],
		major: true,
	});
	host.world.setMessage(`Theft — ${who} took ${item}`);
}
