import { ArcDirector, isCrowdConductor, type AgentSpec, type Kit } from 'arc-director';
import { CharacterMotor } from '../../actors/CharacterMotor';
import { NPCInput } from '../../actors/NPCInput';
import { Celebrating, Vitals } from '../../engine/components';
import type { GameObject } from '../../engine/GameObject';
import type { GameHost, HostCtx } from '../adapter';
import { findBody } from '../names';

const FIGHT:Kit = {
	verbs: ['issue', 'when', 'law', 'unlaw', 'loop', 'smite', 'heal'],
	tools: [],
};

function woundedLaw(captain:string) {
	return {
		name: 'wounded',
		who: 'units',
		watch: 'isHurt(me)',
		arc: `go_to(${captain})`,
		pinned: true,
	};
}

const BIND_LAW = {
	name: 'bind',
	who: 'me',
	watch: 'isHurt(me)',
	arc: 'heal()',
	pinned: true,
};

const MEND_LAW = {
	name: 'mend',
	who: 'me',
	watch: 'some(units.filter(u => isHurt(u)))',
	arc: 'loop(through=x in units.filter(u => isHurt(u)), arc=heal(x))',
	pinned: true,
};

function companyLaws(captain:string) {
	return [woundedLaw(captain), BIND_LAW, MEND_LAW];
}

function companyRole(name:string):string {
	return [
		'IMPORTANT! DO NOT THINK! RESPOND IMMEDIATELY!',
		`You command ${name}'s company. Win.`,
		'Your units are fully programmable RTS units: sticky programs, laws, when, loop. You are a unit and the commander; issue() never targets you.',
		'The enemy shows as Witch, Knight, Archer, Blade, Healer — never given names. Attack those roles, never an outsider\'s name.',
		'Thinking is dangerous. The enemy is very likely already killing your units while you think. Do not wait for another think. Keep the wounded law. Issue a looping fight program to every unit by YOUR tag (join issue with ;). Never issue(allUnits) a fight — that is one program, so a Witch would slash.',
		'go_to is not a fight — they walk there and stop. Combat verbs walk into range. The verb matches YOUR tag; the name is an enemy role: issue(who=units.filter("Witch"), arc=loop(hex(Witch) && hex(Healer))). Archer shoot, Knight cleave, Blade slash. who=Blade is your Blade, not the enemy Blade.',
		'A program that ends is idle in a knife fight. Inside the issued arc, && is the next step after success (the hit landed or the foe is down). Perhaps || another role, or go_to you, if that step fails. loop the chain. Join several issue with ; — never && between issue().',
		'Hurt troops already have law wounded: isHurt(me) → go_to the commander. You already have bind (heal yourself) and mend (heal hurt troops). Keep them. Never unlaw wounded, bind, or mend.',
		'smite and heal are yours alone (commander body, arm\'s reach). Never issue smite. Never issue heal. Units cannot smite.',
	].join(' ');
}

const DAWN_ROLE = companyRole('Dawn');
const DUSK_ROLE = companyRole('Dusk');

const DAWN:AgentSpec<HostCtx> = {
	id: 'Dawn',
	skipHeartbeat: false,
	skipMajor: true,
	watchesWritable: false,
	kit: FIGHT,
	commander: 'Dawn',
	identity: {
		name: 'Dawn',
		role: DAWN_ROLE,
		traits: ['resolute', 'grim', 'captain'],
	},
	goals: [{
		text: 'Win.',
		priority: 3,
	}],
	units: [
		{ id: 'Dawn', tags: ['Captain', 'Healer', 'Dawn'] },
		{ id: 'Cinder', tags: ['Witch', 'Dawn'] },
		{ id: 'Brune', tags: ['Knight', 'Dawn'] },
		{ id: 'Wisp', tags: ['Archer', 'Dawn'] },
		{ id: 'Cade', tags: ['Blade', 'Dawn'] },
	],
	laws: companyLaws('Dawn'),
};

const DUSK:AgentSpec<HostCtx> = {
	id: 'Dusk',
	skipHeartbeat: false,
	skipMajor: true,
	watchesWritable: false,
	kit: FIGHT,
	commander: 'Dusk',
	identity: {
		name: 'Dusk',
		role: DUSK_ROLE,
		traits: ['cold', 'ruthless', 'captain'],
	},
	goals: [{
		text: 'Win.',
		priority: 3,
	}],
	units: [
		{ id: 'Dusk', tags: ['Captain', 'Healer', 'Dusk'] },
		{ id: 'Nyx', tags: ['Witch', 'Dusk'] },
		{ id: 'Helms', tags: ['Knight', 'Dusk'] },
		{ id: 'Ash', tags: ['Archer', 'Dusk'] },
		{ id: 'Flint', tags: ['Blade', 'Dusk'] },
	],
	laws: companyLaws('Dusk'),
};

/** Farther from the fight outranks. Healer, archer, mage, swordsman, tank. */
const COMMAND_RANK = ['Knight', 'Blade', 'Witch', 'Archer', 'Healer'] as const;

const woke = new WeakSet<GameHost>();

function roleRank(tags:string[]):number {
	let best = 0;
	for (const tag of tags) {
		const short = tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag;
		const at = COMMAND_RANK.indexOf(short as typeof COMMAND_RANK[number]);
		if (at >= 0) {
			best = Math.max(best, at + 1);
		}
	}
	return best;
}

function livingCommand(host:GameHost, id:string):boolean {
	const body = findBody(host.world, id);
	return (body?.getComponent(Vitals)?.hp ?? 0) > 0;
}

/** When the commander is down, the farthest living role takes the body. */
function succeedCommand(host:GameHost, conductorID:string):void {
	if (host.bargainDone) {
		return;
	}
	const agent = host.arc?.agent(conductorID);
	if (!isCrowdConductor(agent)) {
		return;
	}
	if (agent.commanderID && livingCommand(host, agent.commanderID)) {
		return;
	}
	let best: { id:string; rank:number } | undefined;
	for (const unit of agent.crowd.list()) {
		if (!livingCommand(host, unit.id)) {
			continue;
		}
		const rank = roleRank(unit.tags);
		if (!best || rank > best.rank) {
			best = { id: unit.id, rank };
		}
	}
	if (!best) {
		return;
	}
	host.arc?.setCrowdCommander(conductorID, best.id);
	agent.addLaw(woundedLaw(best.id), true);
	agent.crowd.get(best.id)?.interrupt();
	findBody(host.world, best.id)?.getComponent(NPCInput)?.interrupt('attack');
}

/** Battlefield slog. Default motor speed is 4.2. */
const RUINS_WALK = 2.2;

function paceRuins(host:GameHost):void {
	for (const go of host.world.objects) {
		const motor = go.getComponent(CharacterMotor);
		if (motor) {
			motor.maxSpeed = RUINS_WALK;
		}
	}
}

function hardenFight(host:GameHost):void {
	paceRuins(host);
	for (const spec of [DAWN, DUSK]) {
		const agent = host.arc?.agent(spec.id);
		if (!isCrowdConductor(agent)) {
			continue;
		}
		agent.identity = {
			...spec.identity,
			traits: spec.identity.traits ? [...spec.identity.traits] : undefined,
		};
		if (spec.goals) {
			agent.goals = spec.goals.map((g) => ({ ...g }));
		}
		agent.kit = spec.kit;
		agent.pinnedWatches = {};
		agent.watches = {};
		agent.watchesWritable = false;
		agent.heartbeat = 0;
		agent.laws = [];
		for (const law of spec.laws ?? []) {
			agent.addCrowdLaw(law, law.pinned);
		}
		if (spec.commander) {
			agent.setCommander(spec.commander);
		}
		for (const unit of agent.crowd.list()) {
			unit.interrupt();
			findBody(host.world, unit.id)?.getComponent(NPCInput)?.interrupt('attack');
		}
		findBody(host.world, spec.id)?.getComponent(NPCInput)?.interrupt('attack');
		host.arc?.mindQueue()?.ensure(spec.id, { skipHeartbeat: false, skipMajor: true });
		host.arc?.mindQueue()?.setWatches(spec.id, []);
	}
}

function roster(spec:AgentSpec<HostCtx>):string[] {
	return [...new Set([spec.id, ...(spec.units ?? []).map((unit) => unit.id)])];
}

function livingOf(host:GameHost, spec:AgentSpec<HostCtx>):GameObject[] {
	const out:GameObject[] = [];
	for (const id of roster(spec)) {
		const go = findBody(host.world, id);
		if (!go || (go.getComponent(Vitals)?.hp ?? 0) <= 0) {
			continue;
		}
		out.push(go);
	}
	return out;
}

function hopWin(host:GameHost, winners:GameObject[], name:string):void {
	host.bargainDone = true;
	host.world.setMessage(`${name} holds the colonnade`);
	for (const go of winners) {
		go.getComponent(NPCInput)?.interrupt('win');
		let hop = go.getComponent(Celebrating);
		if (!hop) {
			hop = go.addComponent(new Celebrating());
		}
		hop.until = host.world.time + 48;
		hop.enabled = true;
	}
	const queue = host.arc?.mindQueue();
	queue?.setAiOn(name === DAWN.id ? DUSK.id : DAWN.id, false);
	const winner = host.arc?.agent(name);
	queue?.ensure(name, { skipHeartbeat: true, skipMajor: true });
	queue?.setWatches(name, [
		'some(others.nearby().approaching())',
		'count(me.inventory) > count(prev.me.inventory)',
	]);
	if (!isCrowdConductor(winner)) {
		return;
	}
	winner.replaceProgram();
	winner.goals = [{ text: 'You won. Stay. Speak when someone approaches or gives you something.', priority: 2 }];
	winner.kit = { verbs: [...FIGHT.verbs, 'say'], tools: [] };
	for (const unit of winner.crowd.list()) {
		unit.interrupt();
	}
}

function tickFight(host:GameHost):void {
	if (!host.arc?.ready) {
		return;
	}
	if (!woke.has(host)) {
		woke.add(host);
		hardenFight(host);
	}
	if (host.bargainDone) {
		return;
	}
	succeedCommand(host, DAWN.id);
	succeedCommand(host, DUSK.id);
	const dawn = livingOf(host, DAWN);
	const dusk = livingOf(host, DUSK);
	if (dawn.length > 0 && dusk.length === 0) {
		hopWin(host, dawn, 'Dawn');
	}
	else if (dusk.length > 0 && dawn.length === 0) {
		hopWin(host, dusk, 'Dusk');
	}
}

export function createDirector(host:GameHost):ArcDirector<HostCtx> {
	host.hooks = { checkBargain: tickFight };
	host.kit = { ...FIGHT };
	return host.configure(new ArcDirector<HostCtx>())
		.onCommanderVacant((conductorID) => succeedCommand(host, conductorID))
		.addVerb('hex', { name: 'id' })
		.addVerb('shoot', { name: 'id' })
		.addVerb('cleave', { name: 'id' })
		.addVerb('slash', { name: 'id' })
		.addVerb('smite', { name: 'id' })
		.addVerb('heal', { name: 'id?' })
		.withSight({ limit: 16 })
		.withDefaultKit(host.kit)
		.addCrowdConductor(DAWN)
		.addCrowdConductor(DUSK);
}
