import { shortTag, type Collective, type SeenName } from 'arc-director';
import type { GameObject } from '../engine/GameObject';
import type { GameHost, CharacterCtx } from './adapter';
import { idOf, findObject, isLiving } from './names';

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
	falloff?:number;
	/** Hit shove multiplier. 1 is slash/hex; cleave is heavier. */
	knock?:number;
};

/** Damage and accuracy multiplier when a `soften` attack has no clear shot. */
export const COVER_SOFTEN = 0.4;

export const ATTACKS:Record<string, AttackKind> = {
	slash: { roles: ['Blade'], range: 1.7, damage: 1, word: 'slashed', castTime: 0.28, cooldown: 0.72, accuracy: 0.9 },
	smite: { roles: ['Healer'], range: 2.2, damage: 2, word: 'smote', castTime: 0.4, cooldown: 1.2, accuracy: 0.86 },
	hex: { roles: ['Witch'], range: SPELL_RANGE, damage: 3, cover: 'soften', word: 'hexed', castTime: 1.8, cooldown: 1.4, accuracy: 0.84, falloff: 0.5 },
	cleave: { roles: ['Knight'], range: 2.2, damage: 4, word: 'cleaved', castTime: 0.8, cooldown: 1.6, accuracy: 0.74, knock: 2.2 },
	shoot: { roles: ['Archer'], range: 12, damage: 5, cover: 'block', word: 'shot', castTime: 1.5, cooldown: 3.5, accuracy: 0.78, falloff: 0.28 },
};

/** Combat verb for this fight role. Healer smites; heal is separate. */
export function attackVerbFor(role:FightRole):string | undefined {
	for (const [verb, spec] of Object.entries(ATTACKS)) {
		if (spec.roles.includes(role)) {
			return verb;
		}
	}
	return undefined;
}

export const HEAL = { castTime: 5, cooldown: 24, hp: 4, range: SPELL_RANGE };

function hitCycle(castTime:number, cooldown:number):number {
	return castTime + cooldown;
}

function dpsOf(spec:AttackKind):string {
	return (spec.damage / hitCycle(spec.castTime, spec.cooldown)).toFixed(1);
}

function attackLine(verb:string, role:FightRole):string {
	const spec = ATTACKS[verb];
	const every = hitCycle(spec.castTime, spec.cooldown).toFixed(1);
	return `${role} ${FIGHT_HP[role]} hp, ${verb} ${spec.damage} dmg, ${spec.range}m, every ${every}s (~${dpsOf(spec)} dps)`;
}

/** Standing rules sheet for the parties' minds. Numbers match ATTACKS / HEAL / FIGHT_WALK. */
export function formatFightRules():string {
	const healEvery = hitCycle(HEAL.castTime, HEAL.cooldown).toFixed(0);
	const cover = Math.round(COVER_SOFTEN * 100);
	const smite = ATTACKS.smite;
	const smiteEvery = hitCycle(smite.castTime, smite.cooldown).toFixed(1);
	return [
		`Walk ${FIGHT_WALK} m/s.`,
		`${attackLine('slash', 'Blade')}.`,
		`${attackLine('cleave', 'Knight')}.`,
		`${attackLine('shoot', 'Archer')}; arrows need a clear shot.`,
		`${attackLine('hex', 'Witch')}; ${cover}% through cover.`,
		`Healer ${FIGHT_HP.Healer} hp, smite ${smite.damage} dmg, ${smite.range}m, every ${smiteEvery}s (~${dpsOf(smite)} dps); heal ${HEAL.hp} hp, ${HEAL.range}m, every ${healEvery}s, ${cover}% through cover. Stay ${BACK_STANDOFF}m from enemies; heal from ${HEAL.range}m, never walk in for smite.`,
		'Blade is hardest to hit, Knight easiest. shoot and hex lose accuracy at range.',
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

export function isRival(host:GameHost, character:GameObject, target:GameObject):boolean {
	const mine = fightParty(host, character);
	const theirs = fightParty(host, target);
	if (mine && theirs && mine !== theirs) {
		return true;
	}
	if (!mine || target.id !== 'Player') {
		return false;
	}
	for (const unit of mine.characters) {
		if (host.world.playerHits.has(unit.id)) {
			return true;
		}
	}
	return false;
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

/** A character's tags as its party reads them. A commander with no role tag fights as a Healer captain. */
export function fightTags(host:GameHost, character:GameObject):string[] {
	const party = fightParty(host, character);
	const member = party?.character(idOf(character));
	if (!party || !member) {
		return [];
	}
	const tags = member.tags.map((t) => shortTag(party.id, t));
	if (member === party.commander && !FIGHT_ROLES.some((role) => tags.includes(role))) {
		return ['Captain', 'Healer'];
	}
	return tags;
}

/** Closest living rival to `from`. */
export function nearestRival(host:GameHost, from:GameObject):GameObject | undefined {
	return nearestRivalWhere(host, from);
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

function partyOf(host:GameHost, character:GameObject):GameObject[] {
	const mine = fightParty(host, character);
	if (!mine) {
		return [];
	}
	const out:GameObject[] = [];
	for (const unit of mine.characters) {
		const go = findObject(host.world, unit.id);
		if (go) {
			out.push(go);
		}
	}
	return out;
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
	for (const go of partyOf(host, character)) {
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

/** Rank slot for this character: melee line on the rival, backline behind that line. */
export function rankSlot(host:GameHost, character:GameObject):{ x:number; z:number } | undefined {
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
		? partyOf(host, observer)
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
	const mine = fightParty(host, character);
	if (!mine) {
		return [];
	}
	const out:GameObject[] = [];
	for (const party of host.arc?.collectives() ?? []) {
		if (party === mine) {
			continue;
		}
		for (const unit of party.characters) {
			const go = findObject(host.world, unit.id);
			if (go) {
				out.push(go);
			}
		}
	}
	const player = host.world.findByID('Player');
	if (player && isRival(host, character, player)) {
		out.push(player);
	}
	return out;
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
	return nearestWhere(from, partyOf(host, from), ok);
}
