import { ArcDirector, isCrowdConductor, type AgentSpec, type Kit } from 'arc-director';
import { CharacterMotor } from '../../actors/CharacterMotor';
import { NPCInput } from '../../actors/NPCInput';
import { Celebrating } from '../../engine/components';
import type { GameObject } from '../../engine/GameObject';
import type { GameHost, HostCtx } from '../adapter';
import { BACK_STANDOFF, FIGHT_WALK, SPELL_RANGE, formatFightRules } from '../fight';
import { findBody, isLiving } from '../names';

const FIGHT:Kit = {
	verbs: ['issue', 'when', 'law', 'unlaw', 'loop', 'smite', 'heal', 'attack', 'rank'],
	tools: [],
};

const WOUNDED_LAW = {
	name: 'wounded',
	who: 'units',
	watch: `isHurt(me) && some(allUnits.filter("Healer")) && !isNear(me, allUnits.filter("Healer"), ${SPELL_RANGE})`,
	arc: 'go_to(Healer)',
	pinned: true,
};

const MEND_LAW = {
	name: 'mend',
	who: 'me',
	watch: `me is "Healer" && (isHurt(me) || some(allUnits.filter(u => isHurt(u)))) && !isNear(me, others.filter("enemy"), ${BACK_STANDOFF})`,
	arc: 'loop(heal())',
	pinned: true,
};

const GUARD_LAW = {
	name: 'guard',
	who: 'units.filter("Knight")',
	watch: 'some(allUnits.filter("Healer")) && some(allUnits.filter(u => isHurt(u)))',
	arc: 'loop(protect())',
	pinned: true,
};

const STRIKE_LAW = {
	name: 'strike',
	who: 'me',
	watch: 'some(others.filter("enemy")) && !(me is "Healer")',
	arc: 'loop(attack())',
	pinned: true,
};

const RANK_LAW = {
	name: 'rank',
	who: 'me',
	watch: `me is "Healer" && some(others.filter("enemy")) && (some(allUnits.filter("Knight")) || some(allUnits.filter("Blade")) || isNear(me, others.filter("enemy"), ${BACK_STANDOFF}))`,
	arc: 'loop(rank())',
	pinned: true,
};

const COMPANY_LAWS = [WOUNDED_LAW, MEND_LAW, GUARD_LAW, STRIKE_LAW, RANK_LAW];

function companyRole(name:string):string {
	return [
		'IMPORTANT! DO NOT THINK! RESPOND IMMEDIATELY!',
		`You command ${name}'s company. Win.`,
		formatFightRules(),
		'Your units are fully programmable RTS units: sticky programs, laws, when, loop. You are a unit and the commander; issue() never targets you.',
		'The enemy shows as Witch, Knight, Archer, Blade, Healer — never given names. Attack those roles, never an outsider\'s name.',
		'Thinking is dangerous. The enemy is very likely already killing your units while you think. Do not wait for another think. Keep the wounded law. First think: four looping issue joined with ; — copy the Example. Later thinks only edit. Prefer law for anything that should apply to more than one unit. Never issue(allUnits) a fight — that is one program, so a Witch would slash.',
		'go_to is not a fight — they walk there and stop. Issued combat verbs walk those units into range. You stay behind the line. The verb matches YOUR tag. who=Blade is your Blade, not the enemy Blade. Enemies in programs are others.filter("enemy") — never an outsider\'s given name.',
		'Flank with spread, circle, or go_to a Tree or Boulder so shoot has a clear view.',
		'A program that ends is idle in a knife fight. Inside the issued arc, && is the next step after success (the hit landed or the foe is down). loop the chain. Join several issue with ; — never && between issue().',
		'Sight is about 10 seconds old. If someone is almost dead and under fire they are probably down — do not program around that snapshot. First think: emit the four looping issue in the Example — one score per tag, parens matched. Do not nest when or law on that think.',
		'Hurt troops already have law wounded: out of heal range of a Healer → go_to(Healer) until they are in range, then they keep fighting. You already have mend: heal() loops Knight, then yourself, then Captain, then the rest — only while you are a Healer and no rival is in knife range. Guard protect()s whoever is hurt while a Healer lives: the Knight screens them and attacks that threat, then goes back to their program. Strike is attack() with your tag when you are not a Healer. Rank holds you behind the Knight and Blade, clear of knife range. If a rival is close, rank() away — do not heal or smite in a scrum. Keep wounded, mend, guard, strike, and rank. Never unlaw them. Peel later inside an issued arc: attack the rival that isNear your Healer.',
		`smite, heal, attack(), and rank() are yours (commander body). smite is arm's reach — never walk in for it while a Knight or Blade lives. heal from ${SPELL_RANGE}m like hex. Never go_to an enemy. Never issue smite, heal, attack, or rank. Units cannot smite.`,
		'You may law(who=units, watch=me.hp/me.maxHP<0.25, arc=go_to(Healer), name=lastStand).',
	].join(' ');
}

const DAWN_ROLE = companyRole('Dawn');
const DUSK_ROLE = companyRole('Dusk');

const DAWN:AgentSpec<HostCtx> = {
	id: 'Dawn',
	skipHeartbeat: false,
	skipMajor: true,
	watchesWritable: false,
	pinnedSightFocus: ['isHurt(it)'],
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
	laws: COMPANY_LAWS,
};

const DUSK:AgentSpec<HostCtx> = {
	id: 'Dusk',
	skipHeartbeat: false,
	skipMajor: true,
	watchesWritable: false,
	pinnedSightFocus: ['isHurt(it)'],
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
	laws: COMPANY_LAWS,
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
	return isLiving(findBody(host.world, id));
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
	agent.crowd.get(best.id)?.interrupt();
	findBody(host.world, best.id)?.getComponent(NPCInput)?.interrupt('attack');
}

function paceRuins(host:GameHost):void {
	for (const go of host.world.objects) {
		const motor = go.getComponent(CharacterMotor);
		if (motor) {
			motor.maxSpeed = FIGHT_WALK;
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
		if (!isLiving(go)) {
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
	winner.kit = { verbs: [...(FIGHT.verbs ?? []), 'say'], tools: [] };
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
		.addVerb('protect', { name: 'id?' })
		.addVerb('attack', { name: 'id?' })
		.addVerb('rank', {})
		.withSight({ limit: 16 })
		.withDefaultKit(host.kit)
		.addCrowdConductor(DAWN)
		.addCrowdConductor(DUSK);
}
