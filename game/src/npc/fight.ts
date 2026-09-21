import { isCrowdConductor, shortTag } from 'arc-director';
import { Vitals } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { GameHost } from './adapter';
import { bodyName, findBody } from './names';

export type FightRole = 'Witch' | 'Knight' | 'Archer' | 'Blade' | 'Healer';

export const FIGHT_ROLES:readonly FightRole[] = ['Witch', 'Knight', 'Archer', 'Blade', 'Healer'];

/** Chance subtracted from attack accuracy. Blade is slippery; Knight is not. */
export const ROLE_AGILITY:Record<FightRole, number> = {
	Knight: 0.06,
	Healer: 0.1,
	Witch: 0.16,
	Archer: 0.26,
	Blade: 0.4,
};

export function isFightRole(name:string):name is FightRole {
	return (FIGHT_ROLES as readonly string[]).includes(name);
}

export function fightCompany(host:GameHost, actor:GameObject) {
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

/** Map a plan / sight id onto a real body name from this observer. */
export function resolveFightName(host:GameHost, observerID:string, name:string):string {
	const observer = findBody(host.world, observerID);
	if (!observer) {
		return name;
	}
	const target = findFightTarget(host, observer, name);
	return target ? bodyName(target) : name;
}

function nearestRivalWithRole(
	host:GameHost,
	observer:GameObject,
	role:FightRole,
):GameObject | undefined {
	const mine = fightCompany(host, observer);
	if (!mine) {
		return undefined;
	}
	const here = observer.transform.position;
	let best:GameObject | undefined;
	let bestDist = Infinity;
	for (const agent of host.arc?.agents() ?? []) {
		if (!isCrowdConductor(agent) || agent === mine) {
			continue;
		}
		for (const unit of agent.crowd.list()) {
			const go = findBody(host.world, unit.id);
			if (!go || (go.getComponent(Vitals)?.hp ?? 0) <= 0) {
				continue;
			}
			if (fightRole(host, go) !== role) {
				continue;
			}
			const p = go.transform.position;
			const dist = Math.hypot(p.x - here.x, p.z - here.z);
			if (dist < bestDist) {
				bestDist = dist;
				best = go;
			}
		}
	}
	return best;
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

/** Resolve a plan name from this observer. Rival given names do not resolve. */
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
