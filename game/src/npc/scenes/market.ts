import { pascalCase, STOCK_CROWD_VERBS, STOCK_VERBS, ArcDirector } from 'arc-director';
import { MarketNPC, MarketGate, Merchant, Wanted } from '../../engine/components';
import type { GameObject } from '../../engine/GameObject';
import { NPCInput } from '../../actors/NPCInput';
import { compactName, distXZ, findCarried, itemMatchesName, tryInsert } from '../../items/inventory';
import { dropItem, USE_RANGE } from '../../items/pickup';
import type { GameHost, HostCtx } from '../adapter';
import { customerCount, spawnRandomCustomer, MARKET_SEEDS, HIVE_UNITS } from '../market';
import { bodyName, findBody } from '../names';
import { takeOne, reportTheft } from '../verbs';
import { showSpeech } from '../playerTalk';

const nextMarketNPCAt = new WeakMap<GameHost, number>();

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
	if (actor.getComponent(MarketNPC)?.kind === 'guard') {
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
	host.arc?.removeCrowdUnit('MarketHive', id);
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
	const npc = thief.getComponent(MarketNPC);
	if (npc?.kind === 'customer') {
		npc.wants = [];
		npc.leaving = true;
	}
}

function seizeNearby(host:GameHost):void {
	host.world.forEachComponent(MarketNPC, (npc, guard) => {
		if (npc.kind !== 'guard') {
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

const wokeHive = new WeakSet<GameHost>();

function wakeHive(host:GameHost):void {
	if (wokeHive.has(host) || !host.arc?.ready) {
		return;
	}
	wokeHive.add(host);
	host.arc.mindQueue()?.enqueueMajor('MarketHive', true);
}

function tickMarketNPC(host:GameHost):void {
	wakeHive(host);
	seizeNearby(host);
	const doomed:GameObject[] = [];
	host.world.forEachComponent(MarketGate, (_exit, gate) => {
		host.world.forEachComponent(MarketNPC, (npc, go) => {
			if (npc.kind !== 'customer' || npc.wants.length > 0) {
				return;
			}
			if (go.getComponent(Wanted)?.enabled) {
				return;
			}
			if (npc.leaveGate && bodyName(gate) !== npc.leaveGate) {
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
	const due = nextMarketNPCAt.get(host) ?? 12;
	if (host.world.time < due) {
		return;
	}
	nextMarketNPCAt.set(host, host.world.time + 10 + Math.random() * 12);
	if (customerCount(host.world) >= 10) {
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
		text: `${spawned.id} arrived from the street`,
		tags: [spawned.id, 'market'],
		major: true,
	});
	if (!host.arc?.ready) {
		return;
	}
	host.arc.addCrowdUnit('MarketHive', { id: spawned.id, tags: spawned.tags });
	spawned.go.getComponent(NPCInput)!.aiOn = true;
}

export function createDirector(host:GameHost):ArcDirector<HostCtx> {
	host.hooks = {
		allowTheft: true,
		afterPickUp,
		tickMarketNPC,
	};
	host.kit = { verbs: [...STOCK_VERBS, 'buy', 'sell', 'steal'] };
	const hiveKit = { verbs: [...STOCK_VERBS, ...STOCK_CROWD_VERBS, 'buy', 'steal'] };
	const d = host.configure(new ArcDirector<HostCtx>())
		.addVerb('buy', { item: 'id', from: 'id', offer: 'number?' })
		.addVerb('sell', { item: 'id', to: 'id', ask: 'number?' })
		.addVerb('steal', { item: 'id', from: 'id' })
		.withSight({ limit: 16 })
		.withDefaultKit(host.kit)
		.addCrowdConductor({
			id: 'MarketHive',
			skipHeartbeat: true,
			kit: hiveKit,
			identity: {
				name: 'Market',
				role: 'You are the canal-market hive. You have no body. The upper square is above the steps; the quay and canal sit below. Shoppers are tagged Shopper plus what they came for (Loaf, Scarf, Bowl, Knife, Apple, Candle) and their leave gate (EastGate or WestGate). Guards are tagged Guard. Baker Weaver Potter Cutler keep stalls BakerStall WeaverStall PotterStall CutlerStall. Send idle shoppers to the stall that sells what they tagged, buy, then go_to their leave gate. Guards hold_line at their gate facing the street. Use issue(who, arc). Names, never coordinates.',
				traits: ['busy', 'fair', 'watchful'],
			},
			goals: [{
				text: 'Keep the square moving: shoppers get what they came for and leave; guards hold the gates.',
				priority: 2,
			}],
			pinnedSightFocus: ['isHurt(it)', 'isNear(it, Player)'],
			pinnedWatches: {
				idle: 'some(units.filter(u => !u.busy))',
				theft: 'some(events.filter("theft"))',
			},
			units: HIVE_UNITS,
			laws: [{
				name: 'flee',
				who: 'units.filter("Shopper")',
				watch: 'isHurt(me)',
				arc: 'go_to(WestGate)',
				pinned: true,
			}],
		});
	for (const seed of MARKET_SEEDS) {
		d.addAgent(seed);
	}
	return d;
}
