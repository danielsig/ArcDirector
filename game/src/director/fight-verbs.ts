import { Time, distanceXZ, type GameObject, type XZ } from '@arc-director/kindling';
import type { ArcResult, MOBAHost, Sight, VerbCall } from 'arc-director';
import { Regen } from '../engine/Regen';
import { CharacterAnimation } from '../characters/CharacterAnimation';
import { CharacterPose } from '../characters/CharacterPose';
import { NPCInput } from '../characters/NPCInput';
import { Reading } from '../characters/Reading';
import { Seated } from '../characters/Seated';
import { FIREBALL_SPEED } from '../render/spell-fx';
import { Guard, HumanBody, Moves, Vitals, Weakness, idOf } from '../engine/components';
import type { DemoWorld } from '../engine/demo-world';
import { findCarried, healCharacter, slotItem } from '../items/inventory';
import { inLineOfSight, standableNear } from '../world/path';
import type { CharacterCtx, GameHost } from './adapter';
import { findObject, isLiving } from './names';
import {
	agilityOf, allies, ATTACKS, attackFor, attackVerbFor, BLOCK, COVER_SOFTEN, fightParty, fightRole, fightTags, guardStops, HEAL, isBackRole,
	isFrontRole, isRival, miss, nearestAlly, nearestRival, rankSlot, softened, weaknessDamage, weaponed, wound, type AttackKind, type FightRole, type Struck,
} from './fight';
import { Flammable } from '../kit/cobweb/cobweb';

type Call = VerbCall<CharacterCtx>;

/** A living character other than the one acting. ArcDirector already turned names and expressions into this id. */
function otherCharacter(ctx:CharacterCtx, id:string):GameObject | undefined {
	const go = id ? findObject(ctx.world, id) : undefined;
	return isLiving(go) && go !== ctx.character ? go : undefined;
}

const COVER_HELP:Record<NonNullable<AttackKind['cover']>, string> = {
	block: 'needs a clear line of sight; flank around cover',
	soften: 'weaker through cover; flank for a full hit',
};

/** How this game fights, for `withRPG` and `withMOBA`: attack (your role's), block, heal, protect, and one ability per attack. */
export function fightVerbs(host:GameHost):MOBAHost<CharacterCtx> {
	return {
		attack: (call) => {
			const role = fightRole(host, call.ctx.character);
			const verb = role ? attackVerbFor(role) : undefined;
			return verb
				? doAttack(host, call, verb, call.args.target ?? '', undefined, true)
				: { status: 'failed', verb: 'attack', reason: 'no attack' };
		},
		block: {
			help: `guard up ${BLOCK.seconds}s against them (or the nearest enemy), then ${BLOCK.cooldown}s to ready again; only when an enemy is within ${BLOCK.near}m or attacking you or whom you protect`,
			handler: (call) => doBlock(host, call, call.args.target ?? ''),
		},
		heal: {
			help: 'weaker through cover; flank for a full heal',
			handler: (call) => doHeal(host, call, call.args.target ?? ''),
		},
		protect: (call) => doProtect(host, call, call.args.target ?? ''),
		abilities: Object.fromEntries(Object.entries(ATTACKS).map(([verb, spec]) => [verb, {
			help: spec.cover && COVER_HELP[spec.cover],
			handler: (call:VerbCall<CharacterCtx, { target:string }>) => doAttack(host, call, verb, call.args.target),
		}])),
	};
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

/** What everyone learns of a blow, the player's and every NPC's alike (`DemoWorld.struck`); one that fells takes the body off the director. */
export function onStruck(host:GameHost, blow:Struck):void {
	const { verb, covered } = blow;
	const who = [idOf(blow.by), idOf(blow.target)];
	const cover = covered ? ' through cover' : '';
	const tags = covered ? ['cover'] : [];
	if (blow.how === 'hit') {
		const how = blow.weak ? ' — its weakness, it burns' : blow.target.getComponent(Weakness) ? ', barely a scratch' : '';
		const word = ATTACKS[verb]?.word ?? 'struck';
		const text = (name:(id:string)=>string):string => `${name(who[0])} ${word} ${name(who[1])}${cover}${how}`;
		host.arc?.pushEvent({ kind: 'Hurt', text, tags: ['hurt', verb, ...tags, ...(blow.weak ? ['weakness'] : [])], major: false });
		if (blow.down) {
			dropDown(host, blow.target);
		}
	}
	else if (blow.how === 'blocked') {
		host.arc?.pushEvent({ kind: 'Miss', text: (name) => `${name(who[1])} blocked ${name(who[0])}`, who, tags: ['blocked', verb], major: false });
	}
	else if (blow.how === 'missed') {
		host.arc?.pushEvent({ kind: 'Miss', text: (name) => `${name(who[0])} missed ${name(who[1])}${cover}`, tags: ['miss', verb, ...tags], major: false });
	}
	else {
		host.arc?.pushEvent({ kind: 'Miss', text: (name) => `${name(who[0])} has no shot at ${name(who[1])} — flank`, tags: ['cover', verb], major: false });
	}
}

/** `who` has fallen: its program ends, it leaves the director (and an emptied collective with it), and everyone hears. */
function dropDown(host:GameHost, who:GameObject):void {
	host.arc?.abortArc(idOf(who));
	// No one dies sitting up with a book: the seat is free again and the fall plays.
	who.getComponent(Seated)?.stand();
	who.getComponent(Reading)?.stop();
	const npc = who.getComponent(NPCInput);
	if (npc) {
		npc.enabled = false;
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
		text: (name) => `${name(idOf(who))} has fallen`,
		// A scene that tells it to more minds (a party out of sight) replaces it, so no mind is told twice.
		key: `fallen:${id}`,
		tags: ['fallen'],
		// A fall changes the fight: 5v5 commanders think on it instead of a rethink.
		major: true,
	});
}

/** `sight` as fighter `viewer` sees it, each fighter of its own side marked, so a captain never takes its own Blade for a foe. */
export function markSides(host:GameHost, viewer:GameObject, sight:Sight):Sight {
	if (!fightRole(host, viewer)) {
		return sight;
	}
	return {
		...sight,
		objects: sight.objects.map((o) => {
			const other = findObject(host.world, o.id);
			return isLiving(other) && other !== viewer && !isRival(host, viewer, other) && fightRole(host, other) ? { ...o, note: o.note ? `yours; ${o.note}` : 'yours' } : o;
		}),
	};
}

/**
 * A clear shot from `a` to `b`: nothing solid between, a wall, a shut door, a pillar. Bodies are no cover: a spell or
 * an arrow goes past a friend's shoulder. The line sound takes, which is light's without the bodies.
 */
function combatSight(world:DemoWorld, a:GameObject, b:GameObject):boolean {
	return inLineOfSight(world, 'sound', a.transform.position, b.transform.position);
}

const RANK_ARRIVE = 1.2;

/**
 * Walks into `range` of `target`: to this character's rank slot first (with `useRank`), then, if the
 * target is still out of range from there (or the slot is out of reach), straight in to range. A shot also needs
 * `clear`: with no clear line, it walks on toward the target until it has one.
 */
async function closeTo(host:GameHost, call:Call, target:GameObject, range:number, useRank = true, clear = ():boolean => true):Promise<ArcResult> {
	const character = call.ctx.character;
	const role = fightRole(host, character);
	const slot = useRank ? rankSlot(host, character) : undefined;
	if (slot && (isBackRole(role) || isFrontRole(role))) {
		const here = character.transform.position;
		if (distanceXZ(here, slot) > RANK_ARRIVE) {
			const walk = await call.goToPoint([slot.x, slot.z]);
			if (walk.status === 'stopped') {
				return walk;
			}
		}
		if (distanceXZ(character, target) <= range + 0.5 && clear()) {
			return { status: 'ok' };
		}
	}
	const close = Math.max(0.9, range - 0.6);
	if (distanceXZ(character, target) > close || !clear()) {
		const shot = ():string | undefined => (distanceXZ(character, target) <= range && clear() ? 'a clear shot' : undefined);
		const walk = await call.goTo(idOf(target), clear() ? { within: close } : { within: 0.9, check: shot });
		if (walk.status !== 'ok') {
			return walk;
		}
	}
	if (distanceXZ(character, target) > range + 0.5) {
		return { status: 'failed', reason: 'too far' };
	}
	return { status: 'ok' };
}

/** The combat scene: walks to this character's place in its party's line. */
export async function doRank(host:GameHost, call:Call):Promise<ArcResult> {
	const slot = rankSlot(host, call.ctx.character);
	if (!slot) {
		return { status: 'failed', verb: 'rank', reason: 'no line' };
	}
	const here = call.ctx.character.transform.position;
	if (distanceXZ(here, slot) <= RANK_ARRIVE) {
		const hold = await call.wait(0.35);
		if (hold.status !== 'ok') {
			return { ...hold, verb: 'rank' };
		}
		return { status: 'ok', verb: 'rank' };
	}
	const walk = await call.goToPoint([slot.x, slot.z]);
	return { ...walk, verb: 'rank' };
}

/** `verb` as `role` makes it, if it is an attack. */
function attackOf(verb:string, role:FightRole | undefined):{ name:string; spec:AttackKind } | undefined {
	return ATTACKS[verb] ? { name: verb, spec: attackFor(verb, role) } : undefined;
}

/** How often a cast that can be broken off checks that it may go on, game seconds. */
const CAST_CHECK = 0.2;

/**
 * Waits out the cooldown, then the cast. `stop`, asked through the cast, ends it early with its reason (the one healed
 * walked out of reach).
 */
async function holdReady(
	call:Call,
	readyTimestamp:number,
	castTime:number,
	onCast?:()=>void,
	stop?:()=>string | undefined,
):Promise<ArcResult> {
	const cool = readyTimestamp - Time.time;
	if (cool > 0.02) {
		const waited = await call.wait(cool);
		if (waited.status !== 'ok') {
			return { status: waited.status, reason: waited.reason, verb: 'wait' };
		}
	}
	onCast?.();
	const step = stop ? CAST_CHECK : castTime;
	for (let left = castTime; left > 0.02; left -= step) {
		const cast = await call.wait(Math.min(step, left));
		if (cast.status !== 'ok') {
			return { status: cast.status, reason: cast.reason ?? 'cast', verb: 'wait' };
		}
		const why = stop?.();
		if (why) {
			return { status: 'failed', reason: why, verb: 'wait' };
		}
	}
	return { status: 'ok' };
}

function rangeAccuracy(spec:AttackKind, dist:number):number {
	if (spec.falloff === undefined) {
		return spec.accuracy;
	}
	const span = Math.max(spec.range, 0.01);
	const t = Math.min(1, Math.max(0, dist / span));
	return spec.accuracy * (1 - t * (1 - spec.falloff));
}

/** `x` as a chance to hit: never sure, never hopeless. */
function chanceOf(x:number):number {
	return Math.min(0.97, Math.max(0.05, x));
}

function hitChance(spec:AttackKind, dist:number, agility:number):number {
	return chanceOf(rangeAccuracy(spec, dist) - agility * (spec.dodge ?? 1));
}

/** Share of its max health at or below which a foe is low, and worth finishing quickly. */
const LOW_HEALTH = 0.35;

/** What one blow of `verb` by `attacker` does to `target`: with its weapon (`weaponed`), then the target's weakness. */
function blowDamage(host:GameHost, attacker:GameObject, verb:string, target:GameObject):number {
	return weaknessDamage(target, verb, weaponed(attackFor(verb, fightRole(host, attacker)), heldWeapon(attacker)).damage).damage;
}

/**
 * The move a fighter's own `attack()` (and `protect`) swings at `target`, among the close-in moves it has (its role's,
 * and its extra `Moves`): any of them at random; at a foe low on health, the quickest that kills it in one blow, else
 * the quickest. A fighter whose own attack is a shot or a spell keeps it.
 */
function pickMove(host:GameHost, attacker:GameObject, own:string, target:GameObject):string {
	const role = fightRole(host, attacker);
	if (!role || ATTACKS[own]?.cover) {
		return own;
	}
	const extra = attacker.getComponent(Moves)?.extra ?? [];
	const moves = Object.keys(ATTACKS).filter((verb) => !ATTACKS[verb]!.cover && (ATTACKS[verb]!.roles.includes(role) || extra.includes(verb)));
	const vitals = target.getComponent(Vitals);
	if (moves.length === 0) {
		return own;
	}
	if (!vitals || vitals.hp > vitals.maxHP * LOW_HEALTH) {
		return moves[Math.floor(Math.random() * moves.length)]!;
	}
	const quickest = (list:string[]):string | undefined => [...list].sort((a, b) => attackFor(a, role).castTime - attackFor(b, role).castTime)[0];
	return quickest(moves.filter((verb) => blowDamage(host, attacker, verb, target) >= vitals.hp)) ?? quickest(moves)!;
}

/** An attack by `verb` on `name` (or `locked`). With `pick`, `verb` is only the fighter's own: {@link pickMove} picks the move. */
async function doAttack(host:GameHost, call:Call, verb:string, name:string, locked?:GameObject, pick = false):Promise<ArcResult> {
	const { ctx } = call;
	const npc = ctx.npc;
	const role = fightRole(host, ctx.character);
	let attack = attackOf(verb, role);
	if (!attack) {
		return { status: 'failed', verb, reason: `unhandled attack ${verb}` };
	}
	if (role && !attack.spec.roles.includes(role) && !ctx.character.getComponent(Moves)?.extra.includes(attack.name)) {
		const need = attack.spec.roles.join(' or ');
		return { status: 'failed', verb, reason: `only a ${need} can ${attack.name}` };
	}
	// Shots and spells go for the nearest foe they can see, not one behind the scrum.
	const seen = attack.spec.cover ? (go:GameObject) => combatSight(ctx.world, ctx.character, go) : undefined;
	const target = locked ?? (name.trim() ? otherCharacter(ctx, name) : nearestRival(host, ctx.character, seen) ?? nearestRival(host, ctx.character));
	if (!target) {
		return {
			status: 'failed',
			verb: attack.name,
			reason: name.trim() ? `no such person ${name}` : 'no one to attack',
		};
	}
	const fuel = attack.spec.burns ? target.getComponent(Flammable) : undefined;
	if (fuel && !fuel.burning) {
		return burnWith(host, call, attack, target, fuel);
	}
	if (!isRival(host, ctx.character, target)) {
		return { status: 'failed', verb: attack.name, reason: (name) => `${name(idOf(target))} is not an enemy` };
	}
	if (pick) {
		attack = attackOf(pickMove(host, ctx.character, attack.name, target), role) ?? attack;
	}
	const dest = idOf(target);
	const { damage, range } = weaponed(attack.spec, heldWeapon(ctx.character));
	const walk = await closeTo(host, call, target, range, !locked, attack.spec.cover === 'block' ? () => combatSight(ctx.world, ctx.character, target) : undefined);
	if (walk.status !== 'ok') {
		return { ...walk, verb: attack.name };
	}
	npc.faceToward(dest);
	const held = await holdReady(call, npc.attackReadyTimestamp, attack.spec.castTime, () => {
		ctx.character.getComponent(CharacterAnimation)?.strike(attack.name, attack.spec.castTime, target);
	});
	if (held.status !== 'ok') {
		// Cut short before its blow: the shot or spell never goes.
		ctx.character.getComponent(CharacterPose)?.resolve('cut');
		return { ...held, verb: attack.name };
	}
	const pose = ctx.character.getComponent(CharacterPose);
	const flight = pose?.flightTime() ?? 0;
	const blow = rollBlow(host, ctx, attack, target, range, damage);
	// The shot or spell flies now, at the target or wide of it; a hit does its harm once it gets there.
	pose?.resolve(blow.landed ? 'hit' : 'miss');
	// A miss (an attack that went, `ok`, but never reached) is dodged as it arrives.
	if (!blow.landed && 'result' in blow && blow.result.status === 'ok') {
		target.getComponent(CharacterPose)?.dodge.from(ctx.character.transform.position, flight);
	}
	if ('result' in blow) {
		return blow.result;
	}
	if (flight > 0) {
		await new Promise<void>((arrived) => ctx.world.after(flight, arrived));
	}
	return blow.lands();
}

/** A fire spell cast at something that burns: walk into range, cast, and it goes up in flames. */
async function burnWith(host:GameHost, call:Call, attack:{ name:string; spec:AttackKind }, target:GameObject, fuel:Flammable):Promise<ArcResult> {
	const { ctx } = call;
	const walk = await closeTo(host, call, target, attack.spec.range, false);
	if (walk.status !== 'ok') {
		return { ...walk, verb: attack.name };
	}
	ctx.npc.faceToward(idOf(target));
	const held = await holdReady(call, ctx.npc.attackReadyTimestamp, attack.spec.castTime, () => {
		ctx.character.getComponent(CharacterAnimation)?.strike(attack.name, attack.spec.castTime, target);
	});
	const pose = ctx.character.getComponent(CharacterPose);
	if (held.status !== 'ok') {
		pose?.resolve('cut');
		return { ...held, verb: attack.name };
	}
	ctx.npc.attackReadyTimestamp = Time.time + attack.spec.cooldown;
	pose?.resolve('hit');
	// It catches once the fireball lands: as long as one takes to fly the spell's whole reach, so never before.
	await new Promise<void>((landed) => ctx.world.after(attack.spec.range / FIREBALL_SPEED, landed));
	fuel.burning = true;
	return { status: 'ok', verb: attack.name, reason: 'ignited' };
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
	damage:number,
):Blow {
	const npc = ctx.npc;
	if (distanceXZ(ctx.character, target) > range + 0.5) {
		return { landed: false, result: { status: 'failed', verb: attack.name, reason: 'too far', retry: true } };
	}
	const clear = !attack.spec.cover || combatSight(ctx.world, ctx.character, target);
	const foe = idOf(target);
	if (attack.spec.cover === 'block' && !clear) {
		miss(ctx.character, target, attack.name, 'no shot');
		return { landed: false, result: { status: 'failed', verb: attack.name, reason: 'no line of sight — flank for a clear shot', retry: true } };
	}
	const vitals = target.getComponent(Vitals);
	if (!vitals) {
		return { landed: false, result: { status: 'failed', verb: attack.name, reason: 'no vitals' } };
	}
	npc.attackReadyTimestamp = Time.time + attack.spec.cooldown;
	if (vitals.hp <= 0) {
		return { landed: true, result: { status: 'ok', verb: attack.name, reason: 'already fallen' } };
	}
	if (attack.spec.cover !== 'soften' && guardStops(target, ctx.character)) {
		miss(ctx.character, target, attack.name, 'blocked');
		return { landed: true, result: { status: 'ok', verb: attack.name, reason: (name) => `${name(foe)} blocked it` } };
	}
	const dist = distanceXZ(ctx.character, target);
	const covered = attack.spec.cover === 'soften' && !clear;
	let chance = vitals.evasive ? hitChance(attack.spec, dist, agilityOf(host, target)) : 1;
	// Cover makes a spell easier to dodge, so it only weakens one cast at whoever cannot dodge.
	if (covered && vitals.evasive) {
		chance = chanceOf(chance * COVER_SOFTEN);
	}
	npc.faceToward(idOf(target));
	if (Math.random() >= chance) {
		miss(ctx.character, target, attack.name, 'missed', covered);
		return { landed: false, result: { status: 'ok', verb: attack.name, reason: (name) => `missed ${name(foe)}${covered ? ' through cover' : ''}` } };
	}
	const dmg = covered ? softened(damage) : damage;
	return { landed: true, lands: () => strikeHome(ctx, attack, target, dmg, covered) };
}

/** A hit striking home on `target` for `dmg` (softened by cover when `covered`): the wound, and a fall. */
function strikeHome(ctx:CharacterCtx, attack:{ name:string; spec:AttackKind }, target:GameObject, dmg:number, covered:boolean):ArcResult {
	const vitals = target.getComponent(Vitals);
	const foe = idOf(target);
	if (!vitals || vitals.hp <= 0) {
		return { status: 'ok', verb: attack.name, reason: 'already fallen' };
	}
	if (wound(ctx.character, target, attack.name, dmg, attack.spec.knock, covered).down) {
		return { status: 'ok', verb: attack.name, reason: (name) => `${name(foe)} has fallen` };
	}
	return {
		status: 'ok',
		verb: attack.name,
		reason: (name) => `${name(foe)} ${vitals.hp}/${vitals.maxHP}${covered ? ' through cover' : ''}`,
	};
}

/**
 * Guard up against `name` (or the nearest rival) for {@link BLOCK}'s seconds, facing them. A guard just lowered
 * refuses at once instead of waiting out its cooldown, so the program moves on to its next choice.
 */
async function doBlock(host:GameHost, call:Call, name:string):Promise<ArcResult> {
	const { ctx } = call;
	const role = fightRole(host, ctx.character);
	if (role && !BLOCK.roles.includes(role)) {
		return { status: 'failed', verb: 'block', reason: `only a ${BLOCK.roles.join(' or ')} can block` };
	}
	const cool = ctx.npc.blockReadyTimestamp - Time.time;
	if (cool > 0) {
		return { status: 'failed', verb: 'block', reason: `guard ready in ${Math.ceil(cool)}s` };
	}
	const threat = name.trim() ? otherCharacter(ctx, name) : nearestRival(host, ctx.character);
	if (name.trim() && !threat) {
		return { status: 'failed', verb: 'block', reason: `no such person ${name}` };
	}
	if (threat) {
		ctx.npc.faceToward(idOf(threat));
	}
	const guard = ctx.character.getOrAddComponent(Guard);
	guard.raise(BLOCK.seconds);
	ctx.character.getComponent(CharacterPose)?.sword.guard(BLOCK.seconds);
	const held = await call.wait(BLOCK.seconds);
	guard.lower();
	ctx.character.getComponent(CharacterPose)?.sword.guard(0);
	ctx.npc.blockReadyTimestamp = Time.time + BLOCK.cooldown;
	if (held.status !== 'ok') {
		return { ...held, verb: 'block' };
	}
	return { status: 'ok', verb: 'block', reason: guard.blocked ? `blocked ${guard.blocked}` : 'nothing came' };
}

const PROTECT_COVER = 1.2;
/** Meters off the line between ward and threat that still screens it. */
const SCREEN_SLACK = 0.8;
/** Meters from the ward within which another foe pulls a protector off the one it is fighting. */
const WARD_DANGER = 3;

/**
 * Where to stand to screen `ward` from `threat`: anywhere on the line between them will do, at least a step out
 * from the ward. Standing on it already, where it stands; else the nearest point on it.
 */
function screenPoint(ward:GameObject, threat:GameObject, from:XZ):XZ {
	const a = ward.transform.position;
	const t = threat.transform.position;
	const dx = t.x - a.x;
	const dz = t.z - a.z;
	const len = Math.hypot(dx, dz);
	if (len < 0.15) {
		return { x: a.x, z: a.z };
	}
	const along = Math.min(len, Math.max(Math.min(PROTECT_COVER, len * 0.45), ((from.x - a.x) * dx + (from.z - a.z) * dz) / len));
	const on = { x: a.x + (dx / len) * along, z: a.z + (dz / len) * along };
	return distanceXZ(from, on) <= SCREEN_SLACK ? { x: from.x, z: from.z } : on;
}

/** The foe each protector is fighting, so it keeps at it rather than walking back to screen between swings. */
const engaged = new WeakMap<GameObject, GameObject>();

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
			status: 'failed',
			verb: 'protect',
			reason: name.trim() ? `no such person ${name}` : 'no one to protect',
		};
	}
	const nearest = nearestRival(host, ward);
	const swing = fightRole(host, ctx.character);
	const verb = swing ? attackVerbFor(swing) : undefined;
	// Still on the foe it engaged, in reach, and no other foe at the ward: keep swinging there.
	const fighting = engaged.get(ctx.character);
	const reach = verb ? weaponed(ATTACKS[verb], heldWeapon(ctx.character)).range + 0.5 : 0;
	const stay = verb && fighting && isLiving(fighting) && distanceXZ(ctx.character, fighting) <= reach
		&& !(nearest && nearest !== fighting && distanceXZ(ward, nearest) <= WARD_DANGER);
	const threat = stay ? fighting : nearest;
	if (!threat) {
		const walk = await call.goTo(idOf(ward), { within: 1.4 });
		if (walk.status !== 'ok') {
			return { ...walk, verb: 'protect' };
		}
		const hold = await call.wait(0.35);
		if (hold.status !== 'ok') {
			return { ...hold, verb: 'protect' };
		}
		return { status: 'ok', verb: 'protect', reason: (name) => `guard ${name(idOf(ward))}` };
	}
	const here = ctx.character.transform.position;
	const screen = stay ? here : standableNear(host.world, ctx.character, screenPoint(ward, threat, here));
	if (distanceXZ(screen, here) > 0.55) {
		const walk = await call.goToPoint([screen.x, screen.z]);
		if (walk.status !== 'ok') {
			return { ...walk, verb: 'protect' };
		}
	}
	ctx.npc.faceToward(idOf(threat));
	if (verb) {
		engaged.set(ctx.character, threat);
		const hit = await doAttack(host, call, verb, '', threat, true);
		return { ...hit, verb: 'protect', reason: hit.reason ?? ((name) => `peel ${name(idOf(threat))}`) };
	}
	const hold = await call.wait(0.35);
	if (hold.status !== 'ok') {
		return { ...hold, verb: 'protect' };
	}
	return { status: 'ok', verb: 'protect', reason: (name) => `screen ${name(idOf(ward))}` };
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
		return { status: 'failed', verb: 'heal', reason: 'only a healer can heal' };
	}
	const target = name.trim()
		? findHealNamed(host, ctx.character, name)
		: pickHealTarget(host, ctx.character);
	if (!target) {
		return {
			status: 'failed',
			verb: 'heal',
			reason: name.trim() ? `no such person ${name}` : 'no one hurt',
		};
	}
	const id = idOf(target);
	if (target !== ctx.character) {
		const walk = await closeTo(host, call, target, HEAL.range);
		if (walk.status !== 'ok') {
			return { ...walk, verb: 'heal' };
		}
		npc.faceToward(id);
	}
	// Walked out of reach while it is cast, the heal is broken off then, not wasted at the end.
	const outOfRange = ():string | undefined => (target !== ctx.character && distanceXZ(ctx.character, target) > HEAL.range + 0.5 ? 'out of range' : undefined);
	const held = await holdReady(call, npc.healReadyTimestamp, HEAL.castTime, () => {
		ctx.character.getComponent(CharacterAnimation)?.strike('heal', HEAL.castTime, target);
	}, outOfRange);
	const result = held.status === 'ok' ? landHeal(host, ctx, target) : { ...held, verb: 'heal' };
	// Its light blooms on the healed, or goes out.
	ctx.character.getComponent(CharacterPose)?.resolve(result.status === 'ok' ? 'hit' : held.status === 'ok' ? 'miss' : 'cut');
	return result;
}

/** A heal whose cast is done: whether `target` can still take it, and how much it mends. */
function landHeal(host:GameHost, ctx:CharacterCtx, target:GameObject):ArcResult {
	const npc = ctx.npc;
	if (!isLiving(target)) {
		return { status: 'failed', verb: 'heal', reason: 'fallen' };
	}
	if (target !== ctx.character) {
		if (isRival(host, ctx.character, target)) {
			return { status: 'failed', verb: 'heal', reason: 'heal your party, not the enemy' };
		}
		if (distanceXZ(ctx.character, target) > HEAL.range + 0.5) {
			return { status: 'failed', verb: 'heal', reason: 'too far' };
		}
	}
	const vitals = target.getComponent(Vitals);
	if (!vitals) {
		return { status: 'failed', verb: 'heal', reason: 'no vitals' };
	}
	const covered = target !== ctx.character && !combatSight(ctx.world, ctx.character, target);
	const hp = covered ? softened(HEAL.hp) : HEAL.hp;
	npc.healReadyTimestamp = Time.time + HEAL.cooldown;
	healCharacter(target, hp);
	target.getComponent(Regen)?.add(hp, HEAL.regen);
	const ally = idOf(target);
	host.arc?.pushEvent({
		kind: 'Heal',
		text: (name) => `${name(idOf(ctx.character))} healed ${name(ally)}${covered ? ' through cover' : ''}`,
		tags: ['heal', ...(covered ? ['cover'] : [])],
		major: false,
	});
	return {
		status: 'ok',
		verb: 'heal',
		reason: (name) => `${name(ally)} ${vitals.hp}/${vitals.maxHP}${covered ? ' through cover' : ''}, +${hp} more over ${HEAL.regen}s`,
	};
}

