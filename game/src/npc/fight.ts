import { isCrowdConductor, shortTag } from 'arc-director';
import type { GameObject } from '../engine/GameObject';
import type { GameHost } from './adapter';
import { bodyName, findBody, isLiving } from './names';

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

/** Standing rules sheet for fight conductors. Numbers match ATTACKS / HEAL / FIGHT_WALK. */
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

export function isFightRole(name:string):name is FightRole {
	return (FIGHT_ROLES as readonly string[]).includes(name);
}

export function fightCompany(host:GameHost, actor:GameObject) {
	if (!isLiving(actor)) {
		return undefined;
	}
	const id = bodyName(actor);
	for (const agent of host.arc?.agents() ?? []) {
		if (!isCrowdConductor(agent)) {
			continue;
		}
		if (agent.id === id || agent.crowd.has(id)) {
			return agent;
		}
	}
	return undefined;
}

export function fightRole(host:GameHost, actor:GameObject):FightRole | undefined {
	if (!isLiving(actor)) {
		return undefined;
	}
	const id = bodyName(actor);
	for (const agent of host.arc?.agents() ?? []) {
		if (!isCrowdConductor(agent)) {
			continue;
		}
		const unit = agent.crowd.get(id);
		if (unit) {
			const tags = unit.tags.map((t) => shortTag(agent.id, t));
			for (const role of FIGHT_ROLES) {
				if (tags.includes(role)) {
					return role;
				}
			}
		}
		if (agent.id === id || agent.commanderID === id) {
			return 'Healer';
		}
	}
	return undefined;
}

export function agilityOf(host:GameHost, actor:GameObject):number {
	const role = fightRole(host, actor);
	return role ? ROLE_AGILITY[role] : 0.1;
}

export function isRivalBody(host:GameHost, actor:GameObject, target:GameObject):boolean {
	const mine = fightCompany(host, actor);
	const theirs = fightCompany(host, target);
	return !!mine && !!theirs && mine !== theirs;
}

/** What `observer` is allowed to call this body. Rival given names become the fight role. */
export function seenFightName(host:GameHost, observer:GameObject, target:GameObject):string {
	const role = fightRole(host, target);
	if (role && isRivalBody(host, observer, target)) {
		return role;
	}
	return bodyName(target);
}

/** Role when the body is in a fight company; otherwise the given name. Shared event text uses this. */
export function fightLabel(host:GameHost, go:GameObject):string {
	return fightRole(host, go) ?? bodyName(go);
}

/** Map an arc / sight id onto a real body name from this observer. */
export function resolveFightName(host:GameHost, observerID:string, name:string):string {
	const observer = findBody(host.world, observerID);
	if (!observer) {
		return name;
	}
	const target = findFightTarget(host, observer, name);
	return target ? bodyName(target) : name;
}

export function fightTags(host:GameHost, actor:GameObject):string[] {
	const company = fightCompany(host, actor);
	if (!company) {
		return [];
	}
	const unit = company.crowd.get(bodyName(actor));
	if (unit) {
		return unit.tags.map((t) => shortTag(company.id, t));
	}
	if (company.id === bodyName(actor) || company.commanderID === bodyName(actor)) {
		return ['Captain', 'Healer'];
	}
	return [];
}

/** Closest living rival to `from`. */
export function nearestRival(host:GameHost, from:GameObject):GameObject | undefined {
	return nearestRivalWhere(host, from);
}

function nearestRivalWithRole(
	host:GameHost,
	observer:GameObject,
	role:FightRole,
):GameObject | undefined {
	return nearestRivalWhere(host, observer, (go) => fightRole(host, go) === role);
}

function nearestWhere(
	from:GameObject,
	bodies:Iterable<GameObject>,
	ok:(go:GameObject)=>boolean = () => true,
):GameObject | undefined {
	const here = from.transform.position;
	let best:GameObject | undefined;
	let bestDist = Infinity;
	for (const go of bodies) {
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

function companyBodies(host:GameHost, actor:GameObject):GameObject[] {
	const mine = fightCompany(host, actor);
	if (!mine) {
		return [];
	}
	const out:GameObject[] = [];
	for (const unit of mine.crowd.list()) {
		const go = findBody(host.world, unit.id);
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

function livingOfRoles(host:GameHost, actor:GameObject, roles:readonly FightRole[]):GameObject[] {
	const out:GameObject[] = [];
	for (const go of companyBodies(host, actor)) {
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
		return bodyName(a).localeCompare(bodyName(b));
	});
	return out;
}

function centroidOf(bodies:GameObject[]):{ x:number; z:number } {
	let x = 0;
	let z = 0;
	for (const go of bodies) {
		x += go.transform.position.x;
		z += go.transform.position.z;
	}
	return { x: x / bodies.length, z: z / bodies.length };
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

/** Push a backline slot off the actor's nearest rival, and off a path through that rival. */
function keepClearOfRival(
	host:GameHost,
	actor:GameObject,
	slot:{ x:number; z:number },
):{ x:number; z:number } {
	const threat = nearestRival(host, actor);
	if (!threat) {
		return slot;
	}
	const foe = threat.transform.position;
	const here = actor.transform.position;
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

/** Rank slot for this body: melee line on the rival, backline behind that line. */
export function rankSlot(host:GameHost, actor:GameObject):{ x:number; z:number } | undefined {
	const role = fightRole(host, actor);
	if (!role) {
		return undefined;
	}
	const front = livingOfRoles(host, actor, FRONT_ROLES);
	const back = livingOfRoles(host, actor, BACK_ROLES);
	const origin = front.length > 0 ? centroidOf(front) : undefined;
	const probe = front[0] ?? actor;
	const foe = nearestRival(host, probe);
	if (!foe) {
		return undefined;
	}
	const from = origin ?? actor.transform.position;
	const dx = foe.transform.position.x - from.x;
	const dz = foe.transform.position.z - from.z;
	const len = Math.hypot(dx, dz);
	if (len < 0.15) {
		if (isBackRole(role)) {
			const here = actor.transform.position;
			return keepClearOfRival(host, actor, { x: here.x, z: here.z });
		}
		return undefined;
	}
	const fx = dx / len;
	const fz = dz / len;
	const px = -fz;
	const pz = fx;
	if (isFrontRole(role) && front.length > 0) {
		const i = front.findIndex((go) => bodyName(go) === bodyName(actor));
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
			const i = back.findIndex((go) => bodyName(go) === bodyName(actor));
			if (i >= 0) {
				const behind = {
					x: origin.x - fx * RANK_GAP,
					z: origin.z - fz * RANK_GAP,
				};
				slot = slotOnLine(behind, px, pz, i, back.length);
			}
		}
		const here = actor.transform.position;
		return keepClearOfRival(host, actor, slot ?? { x: here.x, z: here.z });
	}
	return undefined;
}

/** Expr tags so `others.filter("enemy")` / `u is "Healer"` work on living fight bodies. */
export function fightExprTags(host:GameHost, observer:GameObject, go:GameObject):string[] {
	const tags:string[] = [];
	const role = fightRole(host, go);
	if (role) {
		tags.push(role);
	}
	if (isRivalBody(host, observer, go)) {
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
	const pool = isRivalBody(host, observer, go)
		? companyBodies(host, observer)
		: rivalBodies(host, observer);
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
			best = { name: seenFightName(host, observer, other), dist };
		}
	}
	if (!best) {
		return undefined;
	}
	return `${best.name} ${Math.max(1, Math.round(best.dist))}m away`;
}

function rivalBodies(host:GameHost, actor:GameObject):GameObject[] {
	const mine = fightCompany(host, actor);
	if (!mine) {
		return [];
	}
	const out:GameObject[] = [];
	for (const agent of host.arc?.agents() ?? []) {
		if (!isCrowdConductor(agent) || agent === mine) {
			continue;
		}
		for (const unit of agent.crowd.list()) {
			const go = findBody(host.world, unit.id);
			if (go) {
				out.push(go);
			}
		}
	}
	return out;
}

function nearestRivalWhere(
	host:GameHost,
	from:GameObject,
	ok:(go:GameObject)=>boolean = () => true,
):GameObject | undefined {
	return nearestWhere(from, rivalBodies(host, from), ok);
}

/** Closest living company member matching `ok`. */
export function nearestAlly(
	host:GameHost,
	from:GameObject,
	ok:(go:GameObject)=>boolean = () => true,
):GameObject | undefined {
	return nearestWhere(from, companyBodies(host, from), ok);
}

/** Resolve an ally name from this observer. Rival given names do not resolve. */
export function findAllyTarget(
	host:GameHost,
	observer:GameObject,
	name:string,
):GameObject | undefined {
	const trimmed = name.trim();
	if (!trimmed) {
		return undefined;
	}
	const go = findBody(observer.world ?? host.world, trimmed);
	if (go) {
		if (!isLiving(go) || go === observer) {
			return undefined;
		}
		if (isRivalBody(host, observer, go)) {
			return undefined;
		}
		return go;
	}
	return nearestAlly(host, observer, (ally) => fightTags(host, ally).includes(trimmed));
}

function isOtherCompanyName(host:GameHost, observer:GameObject, name:string):boolean {
	const mine = fightCompany(host, observer);
	if (!mine) {
		return false;
	}
	for (const agent of host.arc?.agents() ?? []) {
		if (!isCrowdConductor(agent) || agent === mine) {
			continue;
		}
		if (agent.id === name || agent.commanderID === name || agent.crowd.has(name)) {
			return true;
		}
	}
	return false;
}

/** Resolve an arc name from this observer. Rival given names do not resolve. */
export function findFightTarget(
	host:GameHost,
	observer:GameObject,
	name:string,
):GameObject | undefined {
	const trimmed = name.trim();
	if (!trimmed) {
		return undefined;
	}
	if (fightCompany(host, observer)) {
		if (isFightRole(trimmed)) {
			return nearestRivalWithRole(host, observer, trimmed);
		}
		if (isOtherCompanyName(host, observer, trimmed)) {
			return undefined;
		}
	}
	return findBody(observer.world ?? host.world, trimmed);
}
