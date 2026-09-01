import { pascalCase, STOCK_VERBS, type AgentSpec, ArcDirector } from 'arc-director';
import { Crowd, CrowdExit, Merchant, Wanted } from '../../engine/components';
import type { GameObject } from '../../engine/GameObject';
import { compactName, distXZ, findCarried, itemMatchesName, tryInsert } from '../../items/inventory';
import { dropItem, USE_RANGE } from '../../items/pickup';
import type { GameHost, HostCtx } from '../adapter';
import { customerCount, spawnRandomCustomer, MARKET_SEEDS } from '../market';
import { bodyName, findBody } from '../names';
import { takeOne, reportTheft } from '../verbs';
import { showSpeech } from '../playerTalk';

const nextCrowdAt = new WeakMap<GameHost, number>();

function stallOwner(host:GameHost, itemName:string):GameObject | undefined {
	let owner:GameObject | undefined;
	host.world.forEachComponent(Merchant, (shop, go) => {
		if (compactName(shop.specialty) === compactName(itemName)) {
			owner = go;
		}
	});
	return owner;
}

function afterPickUp(host:GameHost, actor:GameObject, name:string):void {
	if (actor.getComponent(Crowd)?.kind === 'guard') {
		return;
	}
	const owner = stallOwner(host, name);
	if (!owner) {
		return;
	}
	if (bodyName(actor) === bodyName(owner)) {
		return;
	}
	reportTheft(host, actor, name, bodyName(owner), 'took unpaid stall goods');
}

function despawn(host:GameHost, go:GameObject):void {
	const id = bodyName(go);
	host.talk.detach(id);
	host.arc?.removeAgent(id);
	host.world.remove(go);
	host.pushEvent({
		kind: 'Left',
		text: `${id} left through the gate`,
		tags: [id, 'gate'],
		major: true,
	});
	host.world.setMessage(`${id} left the market`);
}

function catchThief(host:GameHost, guard:GameObject, thief:GameObject):void {
	const mark = thief.getComponent(Wanted);
	if (!mark?.enabled) {
		return;
	}
	const seized:string[] = [];
	for (const name of [...mark.items]) {
		const stock = findCarried(thief, (it) => itemMatchesName(it, name));
		if (!stock) {
			continue;
		}
		const gift = takeOne(thief, stock);
		const owner = (mark.fromID ? findBody(host.world, mark.fromID) : undefined) ?? stallOwner(host, gift.name);
		if (owner && owner !== guard && tryInsert(owner, gift)) {
			seized.push(pascalCase(gift.name) || gift.name);
			continue;
		}
		if (!tryInsert(guard, gift)) {
			dropItem(guard, gift);
		}
		seized.push(pascalCase(gift.name) || gift.name);
	}
	mark.enabled = false;
	mark.items = [];
	mark.reason = '';
	const who = bodyName(thief);
	const watch = bodyName(guard);
	const loot = seized.length > 0 ? seized.join(' and ') : 'the goods';
	showSpeech(host, guard, `That's stolen. ${loot} goes back.`);
	host.pushEvent({
		kind: 'Caught',
		text: `${watch} caught ${who} and took ${loot} back`,
		tags: ['steal', watch, who],
		major: true,
	});
	host.world.setMessage(`${watch} caught ${who} stealing`);
	const crowd = thief.getComponent(Crowd);
	if (crowd?.kind === 'customer') {
		crowd.wants = [];
		crowd.leaving = true;
	}
}

function seizeNearby(host:GameHost):void {
	host.world.forEachComponent(Crowd, (crowd, guard) => {
		if (crowd.kind !== 'guard') {
			return;
		}
		host.world.forEachComponent(Wanted, (mark, thief) => {
			if (!mark.enabled) {
				return;
			}
			if (distXZ(guard, thief) <= USE_RANGE) {
				catchThief(host, guard, thief);
			}
		});
	});
}

function tickCrowd(host:GameHost):void {
	seizeNearby(host);
	const doomed:GameObject[] = [];
	host.world.forEachComponent(CrowdExit, (_exit, gate) => {
		host.world.forEachComponent(Crowd, (crowd, go) => {
			if (crowd.kind !== 'customer' || crowd.wants.length > 0) {
				return;
			}
			if (go.getComponent(Wanted)?.enabled) {
				return;
			}
			if (crowd.leaveGate && bodyName(gate) !== crowd.leaveGate) {
				return;
			}
			if (distXZ(go, gate) <= USE_RANGE) {
				doomed.push(go);
			}
		});
	});
	for (const go of doomed) {
		despawn(host, go);
	}
	const due = nextCrowdAt.get(host) ?? 12;
	if (host.world.time < due) {
		return;
	}
	nextCrowdAt.set(host, host.world.time + 10 + Math.random() * 12);
	if (customerCount(host.world) >= 4) {
		return;
	}
	if (Math.random() < 0.35) {
		return;
	}
	const spawned = spawnRandomCustomer(host.world);
	if (!spawned) {
		return;
	}
	host.pushEvent({
		kind: 'Arrived',
		text: `${spawned.seed.id} arrived from the street`,
		tags: [spawned.seed.id, 'crowd'],
		major: true,
	});
	if (!host.arc?.ready) {
		return;
	}
	const seed:AgentSpec<HostCtx> = spawned.seed;
	host.arc.addAgent(seed);
	host.wireBody(seed.id);
}

export function createDirector(host:GameHost):ArcDirector<HostCtx> {
	host.hooks = {
		allowTheft: true,
		afterPickUp,
		tickCrowd,
	};
	host.kit = { verbs: [...STOCK_VERBS, 'buy', 'sell', 'steal'] };
	const d = host.configure(new ArcDirector<HostCtx>())
		.addVerb('buy', { item: 'id', from: 'id', offer: 'number?' })
		.addVerb('sell', { item: 'id', to: 'id', ask: 'number?' })
		.addVerb('steal', { item: 'id', from: 'id' })
		.withDefaultKit(host.kit);
	for (const seed of MARKET_SEEDS) {
		d.addAgent(seed);
	}
	return d;
}
