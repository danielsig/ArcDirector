import { Regen } from '../engine/Regen';
import { Time, type GameObject } from '@arc-director/kindling';
import { CharacterAnimation } from '../characters/CharacterAnimation';
import { CharacterPose } from '../characters/CharacterPose';
import {
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
	Appearance,
	MarketGate,
	MarketNPC,
	Wanted,
	Vitals,
	Celebrating,
	Guard,
	HurtFlash,
	Weakness,
	type BodySlot,
} from '../engine/components';
import type { World } from '../engine/World';
import {
	distXZ,
	findCarried,
	removeFromBags,
	slotItem,
	tryInsert,
	compactName,
	healCharacter,
} from '../items/inventory';
import { equipItem, unequipSlot } from '../items/equip';
import { NPCInput } from '../characters/NPCInput';
import type { GameHost } from './adapter';
import { findItem, restoreSome, takeSome } from './items';
import { idOf, findObject, isLiving } from './names';
import { applyHit } from './hitFeel';
import { cueAt } from '../audio/cue';
import {
	agilityOf,
	allies,
	ATTACKS,
	attackFor,
	attackVerbFor,
	BLOCK,
	COVER_SOFTEN,
	fightParty,
	seenName,
	fightRole,
	fightTags,
	guardStops,
	HEAL,
	isBackRole,
	isFrontRole,
	isRival,
	nearestAlly,
	nearestRival,
	RANGE_FALLOFF,
	rankSlot,
	weaknessDamage,
	type AttackKind,
	type FightRole,
} from './fight';
import { STALL_LEASH } from '../world/constants';
import { lineClear, standableNear } from '../world/path';
import type { CharacterCtx } from './types';

type Director = ArcDirector<CharacterCtx>;
type Call = VerbCall<CharacterCtx>;

/** Every verb this game's NPCs may use, before a scene adds its own. */
export const GAME_VERBS = [...STOCK_VERBS, 'equip', 'unequip'];

/** Verb doctrine for scenes with buildings: going to a door stops outside it. */
export const BUILDING_VERB_INSTRUCTIONS = `${DEFAULT_VERB_INSTRUCTIONS} go_to a doorway is still outside; inside is the building.`;

/** A living character other than the one acting. ArcDirector already turned names and expressions into this id. */
function otherCharacter(ctx:CharacterCtx, id:string):GameObject | undefined {
	const go = id ? findObject(ctx.world, id) : undefined;
	return isLiving(go) && go !== ctx.character ? go : undefined;
}

function asSlot(raw:string):BodySlot | undefined {
	return (BODY_SLOTS as readonly string[]).includes(raw) ? raw as BodySlot : undefined;
}

/** Steps this character may not take right now: its party already won, it is celebrating, or it would walk into a foe. */
export function verbGate(host:GameHost):VerbGate<CharacterCtx> {
	return ({ verb, ctx, args }) => {
		if (host.bargainDone && fightRole(host, ctx.character)) {
			return { ok: false, interrupted: true, verb, reason: 'won' };
		}
		const hop = ctx.character.getComponent(Celebrating);
		if (hop?.enabled && Time.time < hop.until) {
			return { ok: false, interrupted: true, verb, reason: 'celebrating' };
		}
		const foe = verb === 'go_to' && typeof args.target === 'string' ? findObject(ctx.world, args.target) : undefined;
		if (foe && isRival(host, ctx.character, foe)) {
			return { ok: false, verb, reason: `${seenName(host, ctx.character, foe)} is an enemy; go_to does not attack` };
		}
		const stall = stallBound(ctx, verb, args);
		if (stall) {
			return stall;
		}
		if (verb === 'go_to' && ctx.character.getComponent(MarketNPC)?.kind === 'guard') {
			const raw = args.target;
			const dest = typeof raw === 'string' && raw ? findObject(ctx.world, raw) : undefined;
			if (dest?.getComponent(MarketGate)) {
				return { ok: false, verb, reason: `stand beside ${idOf(dest)}` };
			}
		}
		return undefined;
	};
}

/** A vendor stays at the stall they spawned on. */
function stallBound(ctx:CharacterCtx, verb:string, args:Record<string, unknown>):ArcResult | undefined {
	const npc = ctx.character.getComponent(MarketNPC);
	if (npc?.kind !== 'vendor' || !npc.post) {
		return undefined;
	}
	const roaming = verb === 'follow' || verb === 'wander' || verb === 'flee';
	const stepping = verb === 'go_to' || verb === 'offer';
	if (!roaming && !stepping) {
		return undefined;
	}
	if (roaming) {
		return { ok: false, verb, reason: `stay at ${npc.post}` };
	}
	const raw = verb === 'offer' ? args.to : args.target;
	const dest = typeof raw === 'string' && raw ? findObject(ctx.world, raw) : undefined;
	if (!dest) {
		return undefined;
	}
	const place = dest.transform.position;
	if (Math.hypot(place.x - npc.postX, place.z - npc.postZ) > STALL_LEASH) {
		return { ok: false, verb, reason: `stay at ${npc.post}` };
	}
	return undefined;
}

/** What this game's characters wear and hold. ArcDirector runs the stock world verbs through `withWorld`. */
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
				host.labels.set(idOf(ctx.character), { text: label, until: Time.time + life });
				return { ok: true, verb: 'set_status', reason: `${life}s` };
			},
		})
		.addVerb('rest', {
			handler: ({ ctx }) => ({
				ok: true,
				verb: 'rest',
				reason: host.hooks.goalDone?.(host, idOf(ctx.character)) ? 'done — still listening' : 'goal still open',
			}),
		});
}

const COVER_HELP:Record<NonNullable<AttackKind['cover']>, string> = {
	block: 'needs a clear line of sight; flank around cover',
	soften: 'weaker through cover; flank for a full hit',
};

/** Ruins combat: one verb per attack, plus attack (your role's), block, heal, protect, and rank. */
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
				const role = fightRole(host, call.ctx.character);
				const verb = role ? attackVerbFor(role) : undefined;
				return verb
					? doAttack(host, call, verb, call.args.target ?? '')
					: { ok: false, verb: 'attack', reason: 'no attack' };
			},
		})
		.addVerb('block', {
			args: { target: 'id?' },
			help: 'guard up against them (or the nearest enemy) for a moment',
			handler: (call) => doBlock(host, call, call.args.target ?? ''),
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

function heldWeapon(character:GameObject):{ damage:number; range:number } | undefined {
	const human = character.getComponent(HumanBody);
	if (human) {
		for (const slot of ['hands.left.held', 'hands.right.held'] as const) {
			const item = slotItem(human, slot);
			if (item?.Weapon) {
				return item.Weapon;
			}
		}
	}
	const packed = findCarried(character, (it) => !!it.Weapon);
	return packed?.Weapon;
}

function dropDown(host:GameHost, who:GameObject):void {
	host.arc?.abortArc(idOf(who));
	const npc = who.getComponent(NPCInput);
	if (npc) {
		npc.enabled = false;
		npc.aiOn = false;
	}
	const col = who.getComponent(BoxCollider);
	if (col && !who.getComponent(HurtFlash)?.active) {
		col.enabled = false;
	}
	const id = idOf(who);
	const arc = host.arc;
	const character = arc?.character(id);
	const party = character?.collective;
	if (character?.mind) {
		arc?.removeCharacter(id);
	}
	if (party && !party.characters.some((c) => isLiving(findObject(host.world, c.id)))) {
		arc?.removeCollective(party.id);
	}
	host.arc?.pushEvent({
		kind: 'Hurt',
		text: '{0} is down',
		who: [idOf(who)],
		tags: ['down'],
		// A fall changes the fight: 5v5 commanders think on it instead of a heartbeat.
		major: true,
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

/**
 * Walks into `range` of `target`: to this character's rank slot first (with `useRank`), then, if the
 * target is still out of range from there (or the slot is out of reach), straight in to range.
 */
async function closeTo(host:GameHost, call:Call, target:GameObject, range:number, useRank = true):Promise<ArcResult> {
	const character = call.ctx.character;
	const role = fightRole(host, character);
	const slot = useRank ? rankSlot(host, character) : undefined;
	if (slot && (isBackRole(role) || isFrontRole(role))) {
		const here = character.transform.position;
		if (Math.hypot(here.x - slot.x, here.z - slot.z) > RANK_ARRIVE) {
			const walk = await call.goToPoint([slot.x, slot.z]);
			if (walk.interrupted) {
				return walk;
			}
		}
		if (distXZ(character, target) <= range + 0.5) {
			return { ok: true };
		}
	}
	const close = Math.max(0.9, range - 0.6);
	if (distXZ(character, target) > close) {
		const walk = await call.goTo(idOf(target), close);
		if (!walk.ok) {
			return walk;
		}
	}
	if (distXZ(character, target) > range + 0.5) {
		return { ok: false, reason: 'too far' };
	}
	return { ok: true };
}

async function doRank(host:GameHost, call:Call):Promise<ArcResult> {
	const slot = rankSlot(host, call.ctx.character);
	if (!slot) {
		return { ok: false, verb: 'rank', reason: 'no line' };
	}
	const here = call.ctx.character.transform.position;
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

/** `verb` as `role` makes it, if it is an attack. */
function attackOf(verb:string, role:FightRole | undefined):{ name:string; spec:AttackKind } | undefined {
	return ATTACKS[verb] ? { name: verb, spec: attackFor(verb, role) } : undefined;
}

async function holdReady(
	call:Call,
	now:number,
	readyTimestamp:number,
	castTime:number,
	onCast?:()=>void,
):Promise<ArcResult> {
	const cool = readyTimestamp - now;
	if (cool > 0.02) {
		const waited = await call.wait(cool);
		if (!waited.ok || waited.interrupted) {
			return { ok: false, interrupted: waited.interrupted, reason: waited.reason, verb: 'wait' };
		}
	}
	onCast?.();
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
	return spec.accuracy * (1 - t * (1 - RANGE_FALLOFF));
}

function hitChance(spec:AttackKind, dist:number, agility:number):number {
	return Math.min(0.97, Math.max(0.05, rangeAccuracy(spec, dist) - agility));
}

async function doAttack(host:GameHost, call:Call, verb:string, name:string, locked?:GameObject):Promise<ArcResult> {
	const { ctx } = call;
	const npc = ctx.npc;
	const role = fightRole(host, ctx.character);
	const attack = attackOf(verb, role);
	if (!attack) {
		return { ok: false, verb, reason: `unhandled attack ${verb}` };
	}
	if (role && !attack.spec.roles.includes(role)) {
		const need = attack.spec.roles.join(' or ');
		return { ok: false, verb, reason: `only a ${need} can ${attack.name}` };
	}
	// Shots and spells go for the nearest foe they can see, not one behind the scrum.
	const seen = attack.spec.cover ? (go:GameObject) => combatSight(ctx.world, ctx.character, go) : undefined;
	const target = locked ?? (name.trim() ? otherCharacter(ctx, name) : nearestRival(host, ctx.character, seen) ?? nearestRival(host, ctx.character));
	if (!target) {
		return {
			ok: false,
			verb: attack.name,
			reason: name.trim() ? `no such person ${name}` : 'no one to attack',
		};
	}
	const dest = idOf(target);
	const weapon = heldWeapon(ctx.character);
	const melee = !attack.spec.cover;
	const range = melee ? Math.max(attack.spec.range, weapon?.range ?? 0) : attack.spec.range;
	const walk = await closeTo(host, call, target, range, !locked);
	if (!walk.ok) {
		return { ...walk, verb: attack.name };
	}
	npc.faceToward(dest);
	const held = await holdReady(call, Time.time, npc.attackReadyTimestamp, attack.spec.castTime, () => {
		ctx.character.getComponent(CharacterAnimation)?.strike(attack.name, attack.spec.castTime, target);
	});
	if (!held.ok) {
		// Cut short before its blow: the shot or spell never goes.
		ctx.character.getComponent(CharacterPose)?.resolve('cut');
		return { ...held, verb: attack.name };
	}
	const pose = ctx.character.getComponent(CharacterPose);
	const flight = pose?.flightTime() ?? 0;
	const blow = rollBlow(host, ctx, attack, target, range, melee, weapon);
	// The shot or spell flies now, at the target or wide of it; a hit does its harm once it gets there.
	pose?.resolve(blow.landed ? 'hit' : 'miss');
	// A miss (an attack that went, `ok`, but never reached) is dodged as it arrives.
	if (!blow.landed && 'result' in blow && blow.result.ok) {
		target.getComponent(CharacterPose)?.dodge(ctx.character.transform.position, flight);
	}
	if ('result' in blow) {
		return blow.result;
	}
	if (flight > 0) {
		await new Promise<void>((arrived) => ctx.world.after(flight, arrived));
	}
	return blow.lands();
}

/**
 * How an attack's blow goes, once its wind-up is done: `landed` is whether it reaches the target at
 * all (a hit, or a block). One that misses, is blocked or cannot be made has its `result` now; a hit
 * `lands` when the blow (or the shot or spell, once it arrives) strikes home, doing its harm then.
 */
type Blow = { landed:boolean; result:ArcResult } | { landed:true; lands:()=>ArcResult };

/** Rolls the blow of an attack whose wind-up is done: whether it reaches, gets past cover and a guard, and hits. */
function rollBlow(
	host:GameHost,
	ctx:CharacterCtx,
	attack:{ name:string; spec:AttackKind },
	target:GameObject,
	range:number,
	melee:boolean,
	weapon:{ damage:number; range:number } | undefined,
):Blow {
	const npc = ctx.npc;
	if (distXZ(ctx.character, target) > range + 0.5) {
		return { landed: false, result: { ok: false, verb: attack.name, reason: 'too far' } };
	}
	const clear = !attack.spec.cover || combatSight(ctx.world, ctx.character, target);
	const who = [idOf(ctx.character), idOf(target)];
	const foe = seenName(host, ctx.character, target);
	if (attack.spec.cover === 'block' && !clear) {
		host.arc?.pushEvent({
			kind: 'Miss',
			text: '{0} has no shot at {1} — flank',
			who,
			tags: ['cover', attack.name],
			major: false,
		});
		return { landed: false, result: { ok: false, verb: attack.name, reason: 'no line of sight — flank for a clear shot' } };
	}
	const vitals = target.getComponent(Vitals);
	if (!vitals) {
		return { landed: false, result: { ok: false, verb: attack.name, reason: 'no vitals' } };
	}
	npc.attackReadyTimestamp = Time.time + attack.spec.cooldown;
	if (vitals.hp <= 0) {
		return { landed: true, result: { ok: true, verb: attack.name, reason: 'already down' } };
	}
	if (attack.spec.cover !== 'soften' && guardStops(target, ctx.character)) {
		host.arc?.pushEvent({ kind: 'Miss', text: '{1} blocked {0}', who, tags: ['blocked', attack.name], major: false });
		cueAt(ctx.world, 'clash', target);
		return { landed: true, result: { ok: true, verb: attack.name, reason: `${foe} blocked it` } };
	}
	const dist = distXZ(ctx.character, target);
	const covered = attack.spec.cover === 'soften' && !clear;
	let chance = hitChance(attack.spec, dist, agilityOf(host, target));
	if (covered) {
		chance = Math.min(0.97, Math.max(0.05, chance * COVER_SOFTEN));
	}
	npc.faceToward(idOf(target));
	if (Math.random() >= chance) {
		host.arc?.pushEvent({
			kind: 'Miss',
			text: covered ? '{0} missed {1} through cover' : '{0} missed {1}',
			who,
			tags: ['miss', attack.name, ...(covered ? ['cover'] : [])],
			major: false,
		});
		return { landed: false, result: { ok: true, verb: attack.name, reason: covered ? `missed ${foe} through cover` : `missed ${foe}` } };
	}
	let dmg = melee ? Math.max(attack.spec.damage, weapon?.damage ?? 0) : attack.spec.damage;
	if (covered) {
		dmg = Math.max(1, Math.round(dmg * COVER_SOFTEN));
	}
	return { landed: true, lands: () => strikeHome(host, ctx, attack, target, dmg, covered) };
}

/** A hit striking home on `target` for `dmg` (softened by cover when `covered`): the wound, the knock, and a fall. */
function strikeHome(host:GameHost, ctx:CharacterCtx, attack:{ name:string; spec:AttackKind }, target:GameObject, dmg:number, covered:boolean):ArcResult {
	const vitals = target.getComponent(Vitals);
	const foe = seenName(host, ctx.character, target);
	if (!vitals || vitals.hp <= 0) {
		return { ok: true, verb: attack.name, reason: 'already down' };
	}
	const who = [idOf(ctx.character), idOf(target)];
	const struck = weaknessDamage(target, attack.name, dmg);
	vitals.hp = Math.max(0, vitals.hp - struck.damage);
	applyHit(ctx.world, ctx.character, target, attack.spec.knock ?? 1);
	const how = struck.weak ? ' — its weakness, it burns' : target.getComponent(Weakness) ? ', barely a scratch' : '';
	host.arc?.pushEvent({
		kind: 'Hurt',
		text: `{0} ${attack.spec.word} {1}${covered ? ' through cover' : ''}${how}`,
		who,
		tags: ['hurt', attack.name, ...(covered ? ['cover'] : []), ...(struck.weak ? ['weakness'] : [])],
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

/** Guard up against `name` (or the nearest rival) for {@link BLOCK}'s seconds, facing them. */
async function doBlock(host:GameHost, call:Call, name:string):Promise<ArcResult> {
	const { ctx } = call;
	const role = fightRole(host, ctx.character);
	if (role && !BLOCK.roles.includes(role)) {
		return { ok: false, verb: 'block', reason: `only a ${BLOCK.roles.join(' or ')} can block` };
	}
	const threat = name.trim() ? otherCharacter(ctx, name) : nearestRival(host, ctx.character);
	if (name.trim() && !threat) {
		return { ok: false, verb: 'block', reason: `no such person ${name}` };
	}
	if (threat) {
		ctx.npc.faceToward(idOf(threat));
	}
	const guard = ctx.character.getOrAddComponent(Guard);
	guard.raise(BLOCK.seconds);
	ctx.character.getComponent(CharacterPose)?.guard(BLOCK.seconds);
	const held = await call.wait(BLOCK.seconds);
	guard.lower();
	ctx.character.getComponent(CharacterPose)?.guard(0);
	if (!held.ok) {
		return { ...held, verb: 'block' };
	}
	return { ok: true, verb: 'block', reason: guard.blocked ? `blocked ${guard.blocked}` : 'nothing came' };
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

function protectWard(host:GameHost, ctx:CharacterCtx, name:string):GameObject | undefined {
	if (!name.trim()) {
		return nearestAlly(host, ctx.character, isHurt);
	}
	const go = otherCharacter(ctx, name);
	return go && !isRival(host, ctx.character, go) ? go : undefined;
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
		const walk = await call.goTo(idOf(ward), 1.4);
		if (!walk.ok) {
			return { ...walk, verb: 'protect' };
		}
		const hold = await call.wait(0.35);
		if (!hold.ok) {
			return { ...hold, verb: 'protect' };
		}
		return { ok: true, verb: 'protect', reason: `guard ${idOf(ward)}` };
	}
	const screen = standableNear(host.world, ctx.character, interceptPoint(ward, threat));
	const here = ctx.character.transform.position;
	if (Math.hypot(screen.x - here.x, screen.z - here.z) > 0.55) {
		const walk = await call.goToPoint([screen.x, screen.z]);
		if (!walk.ok) {
			return { ...walk, verb: 'protect' };
		}
	}
	ctx.npc.faceToward(idOf(threat));
	const swing = fightRole(host, ctx.character);
	const verb = swing ? attackVerbFor(swing) : undefined;
	if (verb) {
		const hit = await doAttack(host, call, verb, '', threat);
		return { ...hit, verb: 'protect', reason: hit.reason ?? `peel ${idOf(threat)}` };
	}
	const hold = await call.wait(0.35);
	if (!hold.ok) {
		return { ...hold, verb: 'protect' };
	}
	return { ok: true, verb: 'protect', reason: `screen ${idOf(ward)}` };
}

const HEAL_REST = ['Witch', 'Archer', 'Blade'] as const;

function isHurt(go:GameObject):boolean {
	const vitals = go.getComponent(Vitals);
	return !!vitals && vitals.hp > 0 && vitals.hp < vitals.maxHP;
}

function partyLiving(host:GameHost, character:GameObject):GameObject[] {
	const side = allies(host, character);
	return side.length > 0 ? side : isLiving(character) ? [character] : [];
}

function hasHealTag(host:GameHost, go:GameObject, tag:string):boolean {
	const tags = fightTags(host, go);
	if (tags.includes(tag)) {
		return true;
	}
	if (tag === 'Captain') {
		return fightParty(host, go)?.commander?.id === idOf(go);
	}
	return false;
}

function pickHealTarget(host:GameHost, healer:GameObject):GameObject | undefined {
	const hurt = partyLiving(host, healer).filter(isHurt);
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

/** Someone in the healer's party, the healer included. */
function findHealNamed(host:GameHost, healer:GameObject, name:string):GameObject | undefined {
	const go = findObject(healer.world ?? host.world, name.trim());
	return go && partyLiving(host, healer).includes(go) ? go : undefined;
}

async function doHeal(host:GameHost, call:Call, name:string):Promise<ArcResult> {
	const { ctx } = call;
	const npc = ctx.npc;
	const role = fightRole(host, ctx.character);
	if (role && role !== 'Healer') {
		return { ok: false, verb: 'heal', reason: 'only a healer can heal' };
	}
	const target = name.trim()
		? findHealNamed(host, ctx.character, name)
		: pickHealTarget(host, ctx.character);
	if (!target) {
		return {
			ok: false,
			verb: 'heal',
			reason: name.trim() ? `no such person ${name}` : 'no one hurt',
		};
	}
	const id = idOf(target);
	if (target !== ctx.character) {
		const walk = await closeTo(host, call, target, HEAL.range);
		if (!walk.ok) {
			return { ...walk, verb: 'heal' };
		}
		npc.faceToward(id);
	}
	const healed = target;
	const held = await holdReady(call, Time.time, npc.healReadyTimestamp, HEAL.castTime, () => {
		ctx.character.getComponent(CharacterAnimation)?.strike('heal', HEAL.castTime, healed);
	});
	const result = held.ok ? landHeal(host, ctx, id, healed) : { ...held, verb: 'heal' };
	// Its light blooms on the healed, or goes out.
	ctx.character.getComponent(CharacterPose)?.resolve(result.ok ? 'hit' : held.ok ? 'miss' : 'cut');
	return result;
}

/** A heal whose cast is done: whether `healed` (`id`) can still take it, and how much it mends. */
function landHeal(host:GameHost, ctx:CharacterCtx, id:string, healed:GameObject):ArcResult {
	const npc = ctx.npc;
	const target = findObject(ctx.world, id) ?? healed;
	if (!isLiving(target)) {
		return { ok: false, verb: 'heal', reason: 'down' };
	}
	if (target !== ctx.character) {
		if (isRival(host, ctx.character, target)) {
			return { ok: false, verb: 'heal', reason: 'heal your party, not the enemy' };
		}
		if (distXZ(ctx.character, target) > HEAL.range + 0.5) {
			return { ok: false, verb: 'heal', reason: 'too far' };
		}
	}
	const vitals = target.getComponent(Vitals);
	if (!vitals) {
		return { ok: false, verb: 'heal', reason: 'no vitals' };
	}
	const covered = target !== ctx.character && !combatSight(ctx.world, ctx.character, target);
	const hp = covered ? Math.max(1, Math.round(HEAL.hp * COVER_SOFTEN)) : HEAL.hp;
	npc.healReadyTimestamp = Time.time + HEAL.cooldown;
	healCharacter(target, hp);
	target.getComponent(Regen)?.add(hp, HEAL.regen);
	const ally = idOf(target);
	host.arc?.pushEvent({
		kind: 'Heal',
		text: covered ? '{0} healed {1} through cover' : '{0} healed {1}',
		who: [idOf(ctx.character), ally],
		tags: ['heal', ...(covered ? ['cover'] : [])],
		major: false,
	});
	return {
		ok: true,
		verb: 'heal',
		reason: covered
			? `${ally} ${vitals.hp}/${vitals.maxHP} through cover, +${hp} more over ${HEAL.regen}s`
			: `${ally} ${vitals.hp}/${vitals.maxHP}, +${hp} more over ${HEAL.regen}s`,
	};
}

async function doEquip(ctx:CharacterCtx, itemName:string, slotName?:string):Promise<ArcResult> {
	const item = findItem(ctx.character, itemName);
	if (!item) {
		return { ok: false, verb: 'equip', reason: `not carrying ${itemName}` };
	}
	const slot = slotName ? asSlot(slotName) : undefined;
	if (slotName && !slot) {
		return { ok: false, verb: 'equip', reason: `no slot ${slotName}` };
	}
	const err = equipItem(ctx.character, item, ctx.world, slot);
	if (err) {
		return { ok: false, verb: 'equip', reason: err };
	}
	removeFromBags(ctx.character, item);
	return { ok: true, verb: 'equip' };
}

async function doUnequip(ctx:CharacterCtx, slotName:string):Promise<ArcResult> {
	const slot = asSlot(slotName);
	if (!slot) {
		return { ok: false, verb: 'unequip', reason: `no slot ${slotName}` };
	}
	unequipSlot(ctx.character, slot, ctx.world);
	return { ok: true, verb: 'unequip' };
}

async function doSteal(host:GameHost, call:Call, itemName:string, fromName:string):Promise<ArcResult> {
	const { ctx } = call;
	if (!fromName) {
		return { ok: false, verb: 'steal', reason: 'steal from whom?' };
	}
	if (ctx.character.getComponent(MarketNPC)?.kind === 'guard') {
		return { ok: false, verb: 'steal', reason: 'the watch does not steal' };
	}
	const victim = findObject(ctx.world, fromName);
	if (!victim) {
		return { ok: false, verb: 'steal', reason: `no such person ${fromName}` };
	}
	if (victim === ctx.character) {
		return { ok: false, verb: 'steal', reason: 'cannot steal from yourself' };
	}
	const walk = await call.goTo(fromName);
	if (!walk.ok) {
		return { ...walk, verb: 'steal' };
	}
	const stock = findItem(victim, itemName);
	if (!stock) {
		return { ok: false, verb: 'steal', reason: `${fromName} has no ${itemName}` };
	}
	const gift = takeSome(victim, stock);
	if (!tryInsert(ctx.character, gift)) {
		restoreSome(victim, gift, stock);
		return { ok: false, verb: 'steal', reason: 'no room' };
	}
	const label = pascalCase(gift.name) || gift.name;
	ctx.character.getComponent(Appearance)?.playClip('take', Time.time);
	reportTheft(host, ctx.character, label, fromName, 'stole without paying');
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
	const who = idOf(thief);
	host.arc?.pushEvent({
		kind: 'Theft',
		text: `${who} ${reason}: ${item}${fromID ? ` from ${fromID}` : ''}`,
		tags: ['steal', item, who, fromID],
		major: true,
	});
	host.world.setMessage(`Theft — ${who} took ${item}`);
}
