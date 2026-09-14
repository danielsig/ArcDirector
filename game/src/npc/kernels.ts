import {
	dummyEntity,
	pascalCase,
	type ExprEntity,
	type ExprVal,
	type StringifierKind,
	type Stringifiers,
} from 'arc-director';
import {
	Bridge,
	Celebrating,
	Chest,
	Door,
	HumanBody,
	Interior,
	Named,
	SpeechBubble,
	Vitals,
	Wanted,
} from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { Item, Pickupable } from '../items/components';
import { listCarried } from '../items/inventory';
import type { ItemInstance } from '../items/instance';
import { yawToForward } from '../engine/math';
import { enclosureAt, interiorContains } from '../world/interior';
import { walkDistance as pathMeters } from '../world/path';
import { CLEAR_RANGE } from './talkAttend';
import { bodyName } from './names';
import { tagsOf } from './perception';
import type { GameHost } from './adapter';

export type PosedFact = {
	id:string;
	tags:string[];
	x:number;
	z:number;
	until?:number;
};

const NEAR_RADIUS = CLEAR_RANGE;

const EXPR_STRINGIFIERS:Stringifiers = {
	person: (v) => (v.kind === 'entity' ? (v.value.name ?? v.value.id) : ''),
	item: (v) => (v.kind === 'entity' ? (v.value.name ?? v.value.id) : ''),
	number: (v) => {
		if (v.kind !== 'number') {
			return '';
		}
		return Number.isInteger(v.value) ? String(v.value) : v.value.toFixed(1);
	},
	bool: (v) => (v.kind === 'bool' ? (v.value ? 'true' : 'false') : ''),
};

function exprKind(entity:{ tags:string[] }):StringifierKind {
	if (entity.tags.includes('agent') || entity.tags.includes('person')) {
		return 'person';
	}
	if (entity.tags.includes('item')) {
		return 'item';
	}
	return 'entity';
}

export function entityOf(go:GameObject):ExprEntity {
	return dummyEntity(bodyName(go), {
		name: go.getComponent(Named)?.id ?? go.id,
		tags: tagsOf(go),
	});
}

function itemEntity(item:ItemInstance):ExprEntity {
	const id = pascalCase(item.name) || item.name;
	const tags = ['item'];
	if (item.Key) {
		tags.push('key');
	}
	return dummyEntity(item.id || id, { name: id, tags });
}

function landmarkEntity(go:GameObject):ExprEntity {
	const tags = tagsOf(go);
	const name = tags.includes('tree') ? 'Tree'
		: tags.includes('waterfall') ? 'Waterfall'
		: tags.includes('boulder') ? 'Boulder'
		: bodyName(go);
	return dummyEntity(go.id, { name, tags });
}

function nearbyLandmarks(world:World, actor:GameObject, here?:{ x:number; z:number }):GameObject[] {
	const p = here ?? actor.transform.position;
	const ranked:{ go:GameObject; dist:number }[] = [];
	for (const go of world.objects) {
		if (go === actor || go.getComponent(HumanBody) || go.getComponent(Pickupable)) {
			continue;
		}
		const tags = tagsOf(go);
		if (
			!tags.includes('tree')
			&& !tags.includes('waterfall')
			&& !tags.includes('boulder')
			&& !go.getComponent(Interior)
			&& !go.getComponent(Bridge)
		) {
			continue;
		}
		const gp = go.transform.position;
		const dist = Math.hypot(gp.x - p.x, gp.z - p.z);
		if (dist > 28) {
			continue;
		}
		ranked.push({ go, dist });
	}
	ranked.sort((a, b) => a.dist - b.dist);
	return ranked.slice(0, 16).map((r) => r.go);
}

function facingToward(from:GameObject, x:number, z:number):number {
	const f = yawToForward(from.transform.yaw);
	const dx = x - from.transform.position.x;
	const dz = z - from.transform.position.z;
	const len = Math.hypot(dx, dz);
	if (len < 1e-6) {
		return 1;
	}
	return Math.max(-1, Math.min(1, (f.x * dx + f.z * dz) / len));
}

function lookupGo(world:World, id:string):GameObject | undefined {
	return world.findNamed(id) ?? world.findByID(id);
}

function poseOf(
	world:World,
	posed:PosedFact[],
	id:string,
	now:number,
	here?:{ ids:Set<string>; x:number; z:number },
):{ x:number; z:number } | undefined {
	if (here?.ids.has(id)) {
		return { x: here.x, z: here.z };
	}
	const go = lookupGo(world, id);
	if (go) {
		const p = go.transform.position;
		return { x: p.x, z: p.z };
	}
	const fact = posed.find((e) => e.id === id && (e.until === undefined || e.until > now));
	if (!fact) {
		return undefined;
	}
	return { x: fact.x, z: fact.z };
}

/** World census for watches. Director still injects cache / hasHeard / prev*. `here` poses `me` without moving the body. */
export function kernelsOf(world:World, actor:GameObject, posed:PosedFact[], here?:{ x:number; z:number }) {
	const hidePlayer = world.playerInperceivable;
	const me = entityOf(actor);
	const meAt = here
		? {
			ids: new Set([actor.id, bodyName(actor), actor.getComponent(Named)?.id].filter((id):id is string => !!id)),
			x: here.x,
			z: here.z,
		}
		: undefined;
	const others:ExprEntity[] = [];
	const items:ExprEntity[] = [];
	const bindings:Record<string, ExprVal> = {};
	for (const go of world.objects) {
		if (go.getComponent(HumanBody)) {
			if (go === actor) {
				continue;
			}
			if (hidePlayer && go.id === 'Player') {
				continue;
			}
			others.push(entityOf(go));
		}
		if ((go.getComponent(Pickupable) || go.getComponent(Item)) && !go.getComponent(HumanBody)) {
			items.push(entityOf(go));
		}
		if (
			go.getComponent(Door)
			|| go.getComponent(Bridge)
			|| go.getComponent(Chest)
			|| go.getComponent(Interior)
		) {
			const name = bodyName(go);
			bindings[name] = { kind: 'entity', value: entityOf(go) };
		}
	}
	const landmarks = nearbyLandmarks(world, actor, here);
	bindings.landmarks = {
		kind: 'list',
		value: landmarks.map((go) => ({
			kind: 'entity' as const,
			value: landmarkEntity(go),
		})),
	};
	if (!hidePlayer) {
		const player = world.findByID('Player');
		if (player) {
			bindings.Player = { kind: 'entity', value: entityOf(player) };
		}
	}
	const now = world.time;
	const facts = posed.filter((e) => e.until === undefined || e.until > now);
	bindings.events = {
		kind: 'list',
		value: facts.map((e) => ({
			kind: 'entity' as const,
			value: dummyEntity(e.id, { tags: e.tags }),
		})),
	};
	return {
		me,
		others,
		items,
		bindings,
		distance: (a:ExprEntity, b:ExprEntity) => {
			const pa = poseOf(world, posed, a.id, now, meAt);
			const pb = poseOf(world, posed, b.id, now, meAt);
			if (!pa || !pb) {
				return undefined;
			}
			return Math.hypot(pa.x - pb.x, pa.z - pb.z);
		},
		nearRadius: NEAR_RADIUS,
		walkDistance: (a:ExprEntity, b:ExprEntity) => {
			const pa = poseOf(world, posed, a.id, now, meAt);
			const pb = poseOf(world, posed, b.id, now, meAt);
			if (!pa || !pb) {
				return undefined;
			}
			const ignore = [a.id, b.id];
			if (a.name) {
				ignore.push(a.name);
			}
			if (b.name) {
				ignore.push(b.name);
			}
			return pathMeters(world, pa.x, pa.z, pb.x, pb.z, ignore);
		},
		facing: (a:ExprEntity, b:ExprEntity) => {
			const pb = poseOf(world, posed, b.id, now, meAt);
			if (!pb) {
				return 0;
			}
			if (meAt && meAt.ids.has(a.id)) {
				const f = yawToForward(actor.transform.yaw);
				const dx = pb.x - meAt.x;
				const dz = pb.z - meAt.z;
				const len = Math.hypot(dx, dz);
				if (len < 1e-6) {
					return 1;
				}
				return Math.max(-1, Math.min(1, (f.x * dx + f.z * dz) / len));
			}
			const from = lookupGo(world, a.id);
			if (!from) {
				return 0;
			}
			return facingToward(from, pb.x, pb.z);
		},
		inventory: (who:ExprEntity) => {
			const go = lookupGo(world, who.id);
			if (!go) {
				return [];
			}
			return listCarried(go).map(itemEntity);
		},
		hp: (who:ExprEntity) => {
			const go = lookupGo(world, who.id);
			const vitals = go?.getComponent(Vitals);
			if (!vitals) {
				return undefined;
			}
			return { hp: vitals.hp, maxHP: vitals.maxHP };
		},
		isOpen: (who:ExprEntity) => {
			const go = lookupGo(world, who.id);
			if (!go) {
				return undefined;
			}
			const door = go.getComponent(Door);
			if (door) {
				return door.open;
			}
			const bridge = go.getComponent(Bridge);
			if (bridge) {
				return bridge.open;
			}
			const chest = go.getComponent(Chest);
			if (chest) {
				return chest.open;
			}
			return undefined;
		},
		stringifiers: EXPR_STRINGIFIERS,
		stringifierKind: exprKind,
		hostFns: {
			isInside: (args:ExprVal[], kctx:{ catalog:{ me:ExprEntity } }) => {
				let who = kctx.catalog.me;
				let buildingID:string | undefined;
				const a0 = args[0];
				const a1 = args[1];
				if (a0?.kind === 'entity') {
					const go = lookupGo(world, a0.value.id);
					if (go?.getComponent(Interior)) {
						buildingID = a0.value.id;
					}
					else {
						who = a0.value;
					}
				}
				if (a1?.kind === 'entity') {
					buildingID = a1.value.id;
				}
				else if (a1?.kind === 'string') {
					buildingID = a1.value;
				}
				else if (a0?.kind === 'string') {
					buildingID = a0.value;
				}
				const body = lookupGo(world, who.id);
				if (!body) {
					return { kind: 'bool' as const, value: false };
				}
				const p = meAt && meAt.ids.has(who.id) ? meAt : body.transform.position;
				if (buildingID) {
					const building = world.findNamed(buildingID) ?? world.findByID(buildingID);
					const box = building?.getComponent(Interior);
					return { kind: 'bool' as const, value: !!box && interiorContains(box, p.x, p.z) };
				}
				return { kind: 'bool' as const, value: !!enclosureAt(world, p.x, p.z) };
			},
		},
	};
}

export function poseFact(host:GameHost, fact:PosedFact):void {
	const i = host.posedEvents.findIndex((e) => e.id === fact.id);
	if (i >= 0) {
		host.posedEvents[i] = fact;
		return;
	}
	host.posedEvents.push(fact);
}

export function syncPosedEvents(host:GameHost):void {
	const now = host.world.time;
	const live = new Set<string>();
	host.world.forEachComponent(Wanted, (mark, go) => {
		if (!mark.enabled) {
			return;
		}
		const id = `Theft:${bodyName(go)}`;
		live.add(id);
		const p = go.transform.position;
		poseFact(host, { id, tags: ['theft', 'event'], x: p.x, z: p.z });
	});
	host.posedEvents = host.posedEvents.filter((e) => {
		if (e.until !== undefined && e.until <= now) {
			return false;
		}
		if (e.tags.includes('theft') && !live.has(e.id)) {
			return false;
		}
		return true;
	});
}

export function scanWorld(host:GameHost):void {
	host.world.forEachComponent(Door, (door, go) => {
		const name = go.getComponent(Named)?.id ?? go.id;
		const was = host.doorOpen.get(name);
		if (was === undefined) {
			host.doorOpen.set(name, door.open);
			return;
		}
		if (door.open && !was) {
			host.pushEvent({
				kind: 'DoorOpened',
				text: `${name} opened`,
				tags: ['door', name],
				major: true,
			});
		}
		host.doorOpen.set(name, door.open);
	});
	host.world.forEachComponent(Chest, (chest, go) => {
		const name = go.getComponent(Named)?.id ?? go.id;
		const was = host.chestOpen.get(name);
		if (was === undefined) {
			host.chestOpen.set(name, chest.open);
			return;
		}
		if (chest.open && !was) {
			host.pushEvent({
				kind: 'ChestOpened',
				text: `${name} opened`,
				tags: ['chest', name],
				major: true,
			});
			for (const agent of host.arc?.agents() ?? []) {
				agent.memory.add({
					category: 'episodic',
					text: `${name} opened`,
					tags: ['chest', name],
				}, host.world.time);
			}
		}
		host.chestOpen.set(name, chest.open);
	});
	host.world.forEachComponent(SpeechBubble, (bubble, go) => {
		if (go.getComponent(Celebrating)) {
			return;
		}
		if (bubble.text && host.world.time >= bubble.until) {
			bubble.text = '';
		}
	});
	syncPosedEvents(host);
}
