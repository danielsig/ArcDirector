import { type GameObject } from '@arc-director/kindling';
import { shortTag, type Collective, type SeenName } from 'arc-director';
import type { GameHost, CharacterCtx } from './adapter';
import { Guard, HumanBody, Vitals, Weakness } from '../engine/components';
import { idOf, isLiving } from './names';
import { standableNear } from '../world/path';

export type FightRole = 'Witch' | 'Knight' | 'Archer' | 'Blade' | 'Healer';

export const FIGHT_ROLES:readonly FightRole[] = ['Witch', 'Knight', 'Archer', 'Blade', 'Healer'];

/** Hex and heal reach, meters. Wounded troops hold this close to a Healer. */
export const SPELL_RANGE = 8;

/** Ruins 5v5 motor speed. Default CharacterMotor is 4.2. */
export const FIGHT_WALK = 2.2;

/** Spawn maxHP by role. */
export const FIGHT_HP:Record<FightRole, number> = {
	Knight: 28,
	Blade: 20,
	Healer: 12,
	Witch: 12,
	Archer: 12,
};

/** Chance subtracted from attack accuracy. Blade is slippery; Knight is not. */
export const ROLE_AGILITY:Record<FightRole, number> = {
	Knight: 0.06,
	Healer: 0.1,
	Witch: 0.16,
	Archer: 0.26,
	Blade: 0.4,
};

export type AttackKind = {
	roles:FightRole[];
	range:number;
	damage:number;
	/** `block` = arrows fail without a clear shot. `soften` = spells lose power through cover. */
	cover?:'block' | 'soften';
	word:string;
	castTime:number;
	cooldown:number;
	accuracy:number;
	/** Share of the target's agility that counts against it (1 when unset). Lower is harder to dodge. */
	dodge?:number;
	/** Share of its accuracy it keeps at the edge of its range; closer, more. None for one that loses none. */
	falloff?:number;
	/** Hit shove multiplier. 1 is stab/hex; slice and cleave are heavier. */
	knock?:number;
	/** What differs for these roles: a Knight's slower stab, a Witch's slow, heavy smite. */
	by?:Partial<Record<FightRole, Partial<Pick<AttackKind, 'damage' | 'castTime' | 'cooldown'>>>>;
};

/** Damage and accuracy multiplier when a `soften` attack has no clear shot. */
export const COVER_SOFTEN = 0.4;

export const ATTACKS:Record<string, AttackKind> = {
	stab: { roles: ['Blade', 'Knight'], range: 1.6, damage: 1, word: 'stabbed', castTime: 0.2, cooldown: 0.55, accuracy: 0.92, by: { Knight: { castTime: 0.36, cooldown: 1 } } },
	slice: { roles: ['Blade'], range: 1.9, damage: 2, word: 'sliced', castTime: 0.4, cooldown: 0.95, accuracy: 0.84, dodge: 0.5, knock: 1.4 },
	smite: { roles: ['Healer', 'Witch'], range: 4, damage: 2, cover: 'block', word: 'smote', castTime: 0.4, cooldown: 1.2, accuracy: 0.95, dodge: 0.15, by: { Witch: { damage: 9, castTime: 2.4, cooldown: 14 } } },
	hex: { roles: ['Witch'], range: SPELL_RANGE, damage: 3, cover: 'soften', word: 'hexed', castTime: 1.8, cooldown: 1.4, accuracy: 0.84, dodge: 0.75, falloff: 0.8 },
	cleave: { roles: ['Knight'], range: 2.2, damage: 4, word: 'cleaved', castTime: 0.8, cooldown: 1.6, accuracy: 0.74, knock: 2.2 },
	shoot: { roles: ['Archer'], range: 12, damage: 4, cover: 'block', word: 'shot', castTime: 1.5, cooldown: 0.4, accuracy: 0.9, dodge: 0.75, falloff: 0.8 },
};

/** Each role's own attack, what `attack()` and `protect` swing. */
const ROLE_ATTACK:Record<FightRole, string> = { Blade: 'stab', Knight: 'cleave', Archer: 'shoot', Witch: 'hex', Healer: 'smite' };

/** `verb` as `role` makes it, with what differs for that role. */
export function attackFor(verb:string, role:FightRole | undefined):AttackKind {
	const spec = ATTACKS[verb]!;
	return { ...spec, ...(role && spec.by?.[role]) };
}

/**
 * Raising a sword to guard: it stays up `seconds`, and melee blows and arrows from within `arc` radians of where the
 * guard faces do nothing. Spells pass. The short `cooldown` before it goes up again only keeps a guard from being
 * held for good against a stream of fast blows. Worth raising only when an enemy is within `near` meters or attacking.
 */
export const BLOCK = { roles: ['Knight', 'Blade'] as FightRole[], seconds: 1.6, cooldown: 1.5, arc: 1.3, near: 3 };

/** Whether `target`'s raised guard stops a blow from `attacker`, who stands in front of it; counts the block. */
export function guardStops(target:GameObject, attacker:GameObject):boolean {
	const guard = target.getComponent(Guard);
	if (!guard?.up) {
		return false;
	}
	const yaw = target.transform.yaw;
	const dx = attacker.transform.position.x - target.transform.position.x;
	const dz = attacker.transform.position.z - target.transform.position.z;
	const len = Math.hypot(dx, dz);
	if (len > 1e-3 && (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / len < Math.cos(BLOCK.arc)) {
		return false;
	}
	guard.blocked++;
	return true;
}

/** Damage after the target's weakness, if it has one, and whether the blow found it. Never below 1. */
export function weaknessDamage(target:GameObject, verb:string | undefined, damage:number):{ damage:number; weak:boolean } {
	const weakness = target.getComponent(Weakness);
	if (!weakness) {
		return { damage, weak: false };
	}
	const weak = !!verb && weakness.to.includes(verb);
	return { damage: Math.max(1, Math.round(damage * (weak ? weakness.times : weakness.others))), weak };
}

/** Combat verb for this fight role. Healer smites; heal is separate. */
export function attackVerbFor(role:FightRole):string {
	return ROLE_ATTACK[role];
}

/** A heal gives `hp` at once as its cast ends, then the same again trickling back over `regen` s (`Regen`). */
export const HEAL = { castTime: 5, cooldown: 24, hp: 4, regen: 8, range: SPELL_RANGE };

function hitCycle(castTime:number, cooldown:number):number {
	return castTime + cooldown;
}

/** One attack as `role` swings it: damage, reach, how often, and damage per second. */
function attackNote(verb:string, role:FightRole):string {
	const spec = attackFor(verb, role);
	const every = hitCycle(spec.castTime, spec.cooldown);
	return `${verb} ${spec.damage} dmg, ${spec.range}m, every ${every.toFixed(1)}s (~${(spec.damage / every).toFixed(1)} dps)`;
}

/** A role's hp and its attacks, its own first. */
function roleLine(role:FightRole):string {
	const verbs = Object.keys(ATTACKS).filter((verb) => ATTACKS[verb]!.roles.includes(role))
		.sort((a, b) => Number(b === ROLE_ATTACK[role]) - Number(a === ROLE_ATTACK[role]));
	return `${role} ${FIGHT_HP[role]} hp, ${verbs.map((verb) => attackNote(verb, role)).join('; ')}`;
}

/** Standing rules sheet for the parties' minds. Numbers match ATTACKS / HEAL / FIGHT_WALK. */
export function formatFightRules():string {
	const healEvery = hitCycle(HEAL.castTime, HEAL.cooldown).toFixed(0);
	const cover = Math.round(COVER_SOFTEN * 100);
	return [
		`Walk ${FIGHT_WALK} m/s.`,
		`${roleLine('Blade')}.`,
		`${roleLine('Knight')}.`,
		`${BLOCK.roles.join(' and ')} can block: guard up ${BLOCK.seconds}s, then ${BLOCK.cooldown}s before it can again; melee and arrows from the front do nothing, spells pass.`,
		`${roleLine('Archer')}; arrows need a clear shot.`,
		`${roleLine('Witch')}; hex ${cover}% through cover.`,
		`${roleLine('Healer')}; smite needs a clear shot; heal ${HEAL.hp} hp at once and ${HEAL.hp} more over ${HEAL.regen}s, ${HEAL.range}m, every ${healEvery}s, ${cover}% through cover. Stay ${BACK_STANDOFF}m from enemies; heal from ${HEAL.range}m, never walk in for smite.`,
		'Blade is hardest to hit, Knight easiest. slice is hard to dodge, smite almost impossible. shoot and hex lose accuracy at range.',
	].join(' ');
}

/** The party a living character fights for: its collective. */
export function fightParty(host:GameHost, character:GameObject):Collective<CharacterCtx> | undefined {
	return isLiving(character) ? host.arc?.character(idOf(character))?.collective ?? undefined : undefined;
}

export function fightRole(host:GameHost, character:GameObject):FightRole | undefined {
	const tags = fightTags(host, character);
	return FIGHT_ROLES.find((role) => tags.includes(role));
}

export function agilityOf(host:GameHost, character:GameObject):number {
	const role = fightRole(host, character);
	return role ? ROLE_AGILITY[role] : 0.1;
}

/** Fighters outside every collective who still have a fight role fight together, as the company. */
const COMPANY = 'company';

/** Who a living fighter stands with: its collective's id, or the company. None for a non-fighter. */
function sideOf(host:GameHost, character:GameObject):string | undefined {
	const party = fightParty(host, character);
	if (party) {
		return party.id;
	}
	return fightTags(host, character).some((tag) => (FIGHT_ROLES as readonly string[]).includes(tag)) ? COMPANY : undefined;
}

/** Every living body that can fight or be fought. */
function fighters(host:GameHost):GameObject[] {
	return host.world.objects.filter((go) => !!go.getComponent(Vitals) && !!go.getComponent(HumanBody) && isLiving(go));
}

export function isRival(host:GameHost, character:GameObject, target:GameObject):boolean {
	const mine = sideOf(host, character);
	const theirs = sideOf(host, target);
	if (mine && theirs) {
		return mine !== theirs;
	}
	if (!mine || target.id !== 'Player') {
		return false;
	}
	// A player outside the fight turns rival by striking someone on this side.
	return allies(host, character).some((go) => host.world.playerHits.has(idOf(go)));
}

/** The living fighters on the same side as `character`, itself included. */
export function allies(host:GameHost, character:GameObject):GameObject[] {
	const side = sideOf(host, character);
	return side ? fighters(host).filter((go) => sideOf(host, go) === side) : [];
}

/** Naming policy: a rival is `Enemy<Role>`, never its given name. Reads only the tags from {@link fightExprTags}. */
export const seenInFight:SeenName<CharacterCtx> = (observer, target) => {
	const enemy = target.tags?.includes('enemy');
	const role = enemy && FIGHT_ROLES.find((r) => target.tags?.includes(r));
	if (role) {
		return `Enemy${role}`;
	}
	return enemy && target.id === 'Player' ? 'EnemyPlayer' : target.id;
};

/** What `observer`'s mind calls `target`, for text the host writes itself. */
export function seenName(host:GameHost, observer:GameObject, target:GameObject):string {
	const id = idOf(target);
	const party = fightParty(host, observer);
	return party && host.arc
		? host.arc.seen(party.id, { id, tags: fightExprTags(host, observer, target) })
		: id;
}

/**
 * A character's tags as its party reads them. A commander with no role tag fights as a Healer captain. Outside a
 * collective, its own tags; the player's only while NPCs can see the player.
 */
export function fightTags(host:GameHost, character:GameObject):string[] {
	const party = fightParty(host, character);
	const member = party?.character(idOf(character));
	if (!party || !member) {
		const own = isLiving(character) && host.world.npcCanSee(character) ? host.arc?.character(idOf(character)) : undefined;
		return own && !own.collective ? [...own.tags] : [];
	}
	const tags = member.tags.map((t) => shortTag(party.id, t));
	if (member === party.commander && !FIGHT_ROLES.some((role) => tags.includes(role))) {
		return ['Captain', 'Healer'];
	}
	return tags;
}

/** Closest living rival to `from` (that passes `ok`). */
export function nearestRival(host:GameHost, from:GameObject, ok?:(go:GameObject)=>boolean):GameObject | undefined {
	return nearestRivalWhere(host, from, ok);
}

function nearestWhere(
	from:GameObject,
	characters:Iterable<GameObject>,
	ok:(go:GameObject)=>boolean = () => true,
):GameObject | undefined {
	const here = from.transform.position;
	let best:GameObject | undefined;
	let bestDist = Infinity;
	for (const go of characters) {
		if (go === from || !isLiving(go) || !ok(go)) {
			continue;
		}
		const p = go.transform.position;
		const dist = Math.hypot(p.x - here.x, p.z - here.z);
		if (dist < bestDist) {
			bestDist = dist;
			best = go;
		}
	}
	return best;
}

/** Knight and Blade hold this line. Archer, Witch, and Healer sit behind it. */
export const FRONT_ROLES:readonly FightRole[] = ['Knight', 'Blade'];
export const BACK_ROLES:readonly FightRole[] = ['Archer', 'Witch', 'Healer'];
/** Meters behind the live melee centroid. Hex/heal still reach a target on the front. */
export const RANK_GAP = 4;
/** Backline stays at least this far from the nearest rival. Beyond cleave, inside heal. */
export const BACK_STANDOFF = 5;
const RANK_SPACING = 1.8;
/** Front line stands this far from the nearest rival. */
const FRONT_HOLD = 2;

export function isFrontRole(role:FightRole | undefined):boolean {
	return !!role && (FRONT_ROLES as readonly string[]).includes(role);
}

export function isBackRole(role:FightRole | undefined):boolean {
	return !!role && (BACK_ROLES as readonly string[]).includes(role);
}

function livingOfRoles(host:GameHost, character:GameObject, roles:readonly FightRole[]):GameObject[] {
	const out:GameObject[] = [];
	for (const go of allies(host, character)) {
		if (!isLiving(go)) {
			continue;
		}
		const role = fightRole(host, go);
		if (role && roles.includes(role)) {
			out.push(go);
		}
	}
	out.sort((a, b) => {
		const ra = fightRole(host, a);
		const rb = fightRole(host, b);
		const ia = ra ? roles.indexOf(ra) : 0;
		const ib = rb ? roles.indexOf(rb) : 0;
		if (ia !== ib) {
			return ia - ib;
		}
		return idOf(a).localeCompare(idOf(b));
	});
	return out;
}

function centroidOf(characters:GameObject[]):{ x:number; z:number } {
	let x = 0;
	let z = 0;
	for (const go of characters) {
		x += go.transform.position.x;
		z += go.transform.position.z;
	}
	return { x: x / characters.length, z: z / characters.length };
}

function slotOnLine(
	origin:{ x:number; z:number },
	px:number,
	pz:number,
	index:number,
	count:number,
):{ x:number; z:number } {
	const mid = (count - 1) / 2;
	return {
		x: origin.x + px * (index - mid) * RANK_SPACING,
		z: origin.z + pz * (index - mid) * RANK_SPACING,
	};
}

function awayFrom(
	from:{ x:number; z:number },
	foe:{ x:number; z:number },
	dist:number,
	fallback?:{ x:number; z:number },
):{ x:number; z:number } {
	let dx = from.x - foe.x;
	let dz = from.z - foe.z;
	let len = Math.hypot(dx, dz);
	if (len < 0.15 && fallback) {
		dx = fallback.x - foe.x;
		dz = fallback.z - foe.z;
		len = Math.hypot(dx, dz);
	}
	if (len < 0.15) {
		return { x: foe.x - dist, z: foe.z };
	}
	const s = dist / len;
	return { x: foe.x + dx * s, z: foe.z + dz * s };
}

/** Push a backline slot off the character's nearest rival, and off a path through that rival. */
function keepClearOfRival(
	host:GameHost,
	character:GameObject,
	slot:{ x:number; z:number },
):{ x:number; z:number } {
	const threat = nearestRival(host, character);
	if (!threat) {
		return slot;
	}
	const foe = threat.transform.position;
	const here = character.transform.position;
	const ax = here.x - foe.x;
	const az = here.z - foe.z;
	const sx = slot.x - foe.x;
	const sz = slot.z - foe.z;
	const opposite = ax * sx + az * sz < 0;
	if (!opposite && Math.hypot(sx, sz) >= BACK_STANDOFF) {
		return slot;
	}
	const from = opposite || Math.hypot(sx, sz) < 0.15 ? here : slot;
	return awayFrom(from, foe, BACK_STANDOFF, here);
}

/** Rank slot for this character: melee line on the rival, backline behind that line, on ground it can stand on. */
export function rankSlot(host:GameHost, character:GameObject):{ x:number; z:number } | undefined {
	const slot = lineSlot(host, character);
	return slot && standableNear(host.world, character, slot);
}

/** Where the rank line puts this character, wherever that falls: a wall, a pillar. */
function lineSlot(host:GameHost, character:GameObject):{ x:number; z:number } | undefined {
	const role = fightRole(host, character);
	if (!role) {
		return undefined;
	}
	const front = livingOfRoles(host, character, FRONT_ROLES);
	const back = livingOfRoles(host, character, BACK_ROLES);
	const origin = front.length > 0 ? centroidOf(front) : undefined;
	const probe = front[0] ?? character;
	const foe = nearestRival(host, probe);
	if (!foe) {
		return undefined;
	}
	const from = origin ?? character.transform.position;
	const dx = foe.transform.position.x - from.x;
	const dz = foe.transform.position.z - from.z;
	const len = Math.hypot(dx, dz);
	if (len < 0.15) {
		if (isBackRole(role)) {
			const here = character.transform.position;
			return keepClearOfRival(host, character, { x: here.x, z: here.z });
		}
		return undefined;
	}
	const fx = dx / len;
	const fz = dz / len;
	const px = -fz;
	const pz = fx;
	if (isFrontRole(role) && front.length > 0) {
		const i = front.findIndex((go) => idOf(go) === idOf(character));
		if (i < 0) {
			return undefined;
		}
		const hold = {
			x: foe.transform.position.x - fx * FRONT_HOLD,
			z: foe.transform.position.z - fz * FRONT_HOLD,
		};
		return slotOnLine(hold, px, pz, i, front.length);
	}
	if (isBackRole(role)) {
		let slot:{ x:number; z:number } | undefined;
		if (origin) {
			const i = back.findIndex((go) => idOf(go) === idOf(character));
			if (i >= 0) {
				const behind = {
					x: origin.x - fx * RANK_GAP,
					z: origin.z - fz * RANK_GAP,
				};
				slot = slotOnLine(behind, px, pz, i, back.length);
			}
		}
		const here = character.transform.position;
		return keepClearOfRival(host, character, slot ?? { x: here.x, z: here.z });
	}
	return undefined;
}

/** Expr tags so `others.filter("enemy")` / `u is "Healer"` work on living fight characters. */
export function fightExprTags(host:GameHost, observer:GameObject, go:GameObject):string[] {
	const tags:string[] = [];
	const role = fightRole(host, go);
	if (role) {
		tags.push(role);
	}
	if (isRival(host, observer, go)) {
		tags.push('enemy');
	}
	return tags;
}

const THREAT_NOTE_M = 8;

/** Closest rival-or-ally pair within melee/spell peel range, for sight. */
export function fightProximityNote(host:GameHost, observer:GameObject, go:GameObject):string | undefined {
	if (!isLiving(go)) {
		return undefined;
	}
	const here = go.transform.position;
	const pool = isRival(host, observer, go)
		? allies(host, observer)
		: rivalsOf(host, observer);
	let best:{ name:string; dist:number } | undefined;
	for (const other of pool) {
		if (other === go || !isLiving(other)) {
			continue;
		}
		const p = other.transform.position;
		const dist = Math.hypot(p.x - here.x, p.z - here.z);
		if (dist > THREAT_NOTE_M) {
			continue;
		}
		if (!best || dist < best.dist) {
			best = { name: seenName(host, observer, other), dist };
		}
	}
	if (!best) {
		return undefined;
	}
	return `${best.name} ${Math.max(1, Math.round(best.dist))}m away`;
}

function rivalsOf(host:GameHost, character:GameObject):GameObject[] {
	return fighters(host).filter((go) => go !== character && isRival(host, character, go));
}

function nearestRivalWhere(
	host:GameHost,
	from:GameObject,
	ok:(go:GameObject)=>boolean = () => true,
):GameObject | undefined {
	return nearestWhere(from, rivalsOf(host, from), ok);
}

/** Closest living party member matching `ok`. */
export function nearestAlly(
	host:GameHost,
	from:GameObject,
	ok:(go:GameObject)=>boolean = () => true,
):GameObject | undefined {
	return nearestWhere(from, allies(host, from), ok);
}
