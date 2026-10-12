import {
	dummyEntity,
	pascalCase,
	type ExprEntity,
	type ExprVal,
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
	alarmActive,
} from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { Item, Pickupable } from '../items/components';
import { listCarried } from '../items/inventory';
import type { ItemInstance } from '../items/instance';
import { coinsOf } from '../items/wallet';
import { enclosureAt, interiorContains } from '../world/interior';
import { CLEAR_RANGE } from './talkAttend';
import { idOf, isLiving } from './names';
import { tagsOf } from './perception';
import type { GameHost } from './adapter';

/** Id of the open theft `thief` is wanted for, as watches see it in `events`. */
export function theftID(thief:GameObject):string {
	return `Theft:${idOf(thief)}`;
}

/** The wanted thief a theft id names: the event is wherever the thief is, for as long as the mark is on. */
export function thiefOf(world:World, id:string):GameObject | undefined {
	let thief:GameObject | undefined;
	world.forEachComponent(Wanted, (mark, go) => {
		if (mark.enabled && theftID(go) === id) {
			thief = go;
		}
	});
	return thief;
}

const NEAR_RADIUS = CLEAR_RANGE;

const EXPR_STRINGIFIERS:Stringifiers = {
	number: (v) => {
		if (v.kind !== 'number') {
			return '';
		}
		return Number.isInteger(v.value) ? String(v.value) : v.value.toFixed(1);
	},
	bool: (v) => (v.kind === 'bool' ? (v.value ? 'true' : 'false') : ''),
};

export function entityOf(go:GameObject, extraTags?:string[]):ExprEntity {
	const tags = tagsOf(go);
	if (extraTags) {
		for (const tag of extraTags) {
			if (tag && !tags.includes(tag)) {
				tags.push(tag);
			}
		}
	}
	return dummyEntity(idOf(go), { tags });
}

function itemEntity(item:ItemInstance):ExprEntity {
	const id = pascalCase(item.name) || item.name;
	const tags = ['item'];
	if (item.Key) {
		tags.push('key');
	}
	if (/mushroom/i.test(item.name)) {
		tags.push('mushroom');
	}
	return dummyEntity(id, { tags });
}

const LANDMARK_KINDS = ['Tree', 'Waterfall', 'Boulder', 'Pillar'];

/** A landmark also carries its kind as a name-cased tag, so `landmarks.filter("Tree")` matches. */
function landmarkEntity(go:GameObject):ExprEntity {
	const e = entityOf(go);
	e.tags.push(...LANDMARK_KINDS.filter((kind) => e.tags.includes(kind.toLowerCase())));
	return e;
}

function nearbyLandmarks(world:World, character:GameObject, here?:{ x:number; z:number }):GameObject[] {
	const p = here ?? character.transform.position;
	const ranked:{ go:GameObject; dist:number }[] = [];
	for (const go of world.objects) {
		if (go === character || go.getComponent(HumanBody) || go.getComponent(Pickupable)) {
			continue;
		}
		const tags = tagsOf(go);
		if (
			!tags.includes('tree')
			&& !tags.includes('waterfall')
			&& !tags.includes('boulder')
			&& !tags.includes('pillar')
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

function lookupGo(world:World, id:string):GameObject | undefined {
	return world.findNamed(id) ?? world.findByID(id);
}

/** World census for watches. ArcDirector adds geometry from `withWorld` and its own cache / hasHeard / prev. `here` poses `me` without moving the character. */
export function kernelsOf(
	world:World,
	character:GameObject,
	here?:{ x:number; z:number },
	extraTags?:(go:GameObject)=>string[],
) {
	const hidePlayer = world.playerInperceivable && world.playerHits.size === 0;
	const me = entityOf(character);
	me.fields = { gold: { kind: 'number', value: coinsOf(character) } };
	const meAt = here
		? {
			ids: new Set([character.id, idOf(character), character.getComponent(Named)?.id].filter((id):id is string => !!id)),
			x: here.x,
			z: here.z,
		}
		: undefined;
	const others:ExprEntity[] = [];
	const items:ExprEntity[] = [];
	const bindings:Record<string, ExprVal> = {};
	for (const go of world.objects) {
		if (go.getComponent(HumanBody)) {
			if (go === character) {
				continue;
			}
			if (hidePlayer && go.id === 'Player' && !alarmActive(go, world.time)) {
				continue;
			}
			if (!isLiving(go)) {
				continue;
			}
			others.push(entityOf(go, extraTags?.(go)));
		}
		const item = (go.getComponent(Pickupable) || go.getComponent(Item)) && !go.getComponent(HumanBody);
		if (item) {
			items.push(entityOf(go));
		}
		// Places a watch may name: openable things, and every named one (`BakerStall`, `WestGate`).
		if (
			go.getComponent(Door)
			|| go.getComponent(Bridge)
			|| go.getComponent(Chest)
			|| go.getComponent(Interior)
			|| (go.getComponent(Named) && !item && !go.getComponent(HumanBody))
		) {
			const name = idOf(go);
			bindings[name] = { kind: 'entity', value: entityOf(go) };
		}
	}
	const landmarks = nearbyLandmarks(world, character, here);
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
	const events:ExprVal[] = [];
	world.forEachComponent(Wanted, (mark, go) => {
		if (mark.enabled) {
			events.push({ kind: 'entity', value: dummyEntity(theftID(go), { tags: ['theft', 'event'] }) });
		}
	});
	bindings.events = { kind: 'list', value: events };
	return {
		me,
		others,
		items,
		bindings,
		nearRadius: NEAR_RADIUS,
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
				const whoGo = lookupGo(world, who.id);
				if (!whoGo) {
					return { kind: 'bool' as const, value: false };
				}
				const p = meAt && meAt.ids.has(who.id) ? meAt : whoGo.transform.position;
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

export function scanWorld(host:GameHost):void {
	host.world.forEachComponent(Door, (door, go) => {
		const name = go.getComponent(Named)?.id ?? go.id;
		const was = host.doorOpen.get(name);
		if (was === undefined) {
			host.doorOpen.set(name, door.open);
			return;
		}
		if (door.open && !was) {
			host.arc?.pushEvent({
				kind: 'DoorOpened',
				text: `${name} opened`,
				tags: ['door', name],
				major: false,
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
			host.arc?.pushEvent({
				kind: 'ChestOpened',
				text: `${name} opened`,
				tags: ['chest', name],
				major: false,
				remember: true,
			});
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
}
