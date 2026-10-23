import { Time, type GameObject } from '@arc-director/kindling';
import { ArcDirector, DEFAULT_VERB_INSTRUCTIONS, type Character, type Collective, type CollectiveSpec, type Kit, type LawSpec, type MemoryDraft, type StandingChoice } from 'arc-director';
import { CharacterMotor } from '../../characters/CharacterMotor';
import { Celebrating, Vitals } from '../../engine/components';
import type { HudGoal } from '../../ui/hudModel';
import type { SceneGoals } from '../types';
import type { GameHost, CharacterCtx } from '../adapter';
import { doRank, fightVerbs, markReach } from '../verbs';
import { SIGHT, lookWorld } from '../perception';
import { ATTACKS, BACK_STANDOFF, BLOCK, FIGHT_WALK, SPELL_RANGE, formatFightRules, seenInFight } from '../fight';
import { HOSTED } from '../hosted';
import { idOf, findObject, isLiving } from '../names';

/** Whether its character sees an enemy: in sight range with nothing in the way. `others` alone is everyone on the map. */
const ENEMY_IN_SIGHT = `some(others.filter("enemy").nearby(${SIGHT}))`;

/**
 * A captain's own two laws, on from the start, so its thinks are all orders: it heals the hurt while no enemy is
 * within knife range, and else keeps behind its front line while it sees an enemy.
 */
const CAPTAIN_LAWS:LawSpec[] = [
	{
		name: 'mend',
		watch: `(isHurt(me) || some(allUnits.filter(u => isHurt(u)))) && !isNear(me, others.filter("enemy"), ${BACK_STANDOFF})`,
		arc: 'loop(heal())',
		pinned: true,
	},
	{
		name: 'keep_back',
		watch: `${ENEMY_IN_SIGHT} && (some(allUnits.filter("Knight")) || some(allUnits.filter("Blade")) || isNear(me, others.filter("enemy"), ${BACK_STANDOFF}))`,
		arc: 'loop(rank())',
		pinned: true,
	},
];

/** What a party's mind may write. */
const FIGHT:Kit = {
	verbs: ['issue', 'when', 'law', 'unlaw', 'loop', 'go_to', 'choose', 'smite', 'heal', 'attack', 'rank', 'say'],
	tools: [],
};

/**
 * What each role fights with besides the party's own verbs (kept, so a unit that takes command can command): walking,
 * its own attacks, and for the front line block and protect. The roster then says what each really does.
 */
function roleKit(...verbs:string[]):Kit {
	return { verbs: [...FIGHT.verbs, ...verbs], tools: [] };
}

const ROLE_KITS = {
	Knight: roleKit('cleave', 'stab', 'block', 'protect'),
	Blade: roleKit('stab', 'slice', 'block', 'protect'),
	Archer: roleKit('shoot'),
	Witch: roleKit('hex'),
};

/** Only while reasoning is off. With it on, the library's own think line stands. */
const NO_THINK = 'Answer at once: the fight goes on while you think.';

/** The nearest enemy close enough to block, or no one: a `block` choice only exists while it pays. */
const CLOSE_ENEMY = `others.filter(u => u is "enemy" && distance(me, u) < ${BLOCK.near}).minBy(u => distance(me, u))`;

/** The lowest-hp enemy within a step of `verb`'s reach, or no one: the choice that finishes kills without walking. */
function lowestInReach(verb:string):string {
	return `others.filter(u => u is "enemy" && distance(me, u) < ${Math.ceil(ATTACKS[verb].range + 1)}).minBy(u => u.hp)`;
}

/**
 * A unit's own program whenever its commander has issued it nothing: it defends, and never attacks or advances. A
 * Knight or Blade raises its guard at an enemy already up close (`block` only exists while one is there), else stands
 * where it is; an Archer or Witch keeps behind its front line, clear of the enemy (`rank`, which for them only ever
 * pulls back). Moving on the enemy and attacking are its captain's to order.
 */
function roleChoice(role:'Knight' | 'Blade' | 'Archer' | 'Witch'):StandingChoice {
	if (role === 'Knight' || role === 'Blade') {
		return { goal: 'Defend: block an enemy up close', block: `block(${CLOSE_ENEMY})` };
	}
	return { goal: 'Stay alive: keep behind your line', back: 'rank()' };
}

/** A change of tactics in the units' own idiom, laid out as blocks. Gemma copies this; keep it short. */
const FIGHT_EXAMPLE = `
issue(
	who=units.filter("Archer"),
	arc=loop(
		choose(
			"Kill their Healer first or finish off the weakest enemy. There are {X} friends and {Y} enemies left. Healer is {Z} units away. Weakest enemy is {W} units away.",
			healer=shoot(EnemyHealer),
			finish=shoot(${lowestInReach('shoot')}),
		),
	),
)`;

/** Standing 5v5 doctrine: how to command, once each. Every name here is one the commander really sees. */
const FIGHT_DOCTRINE = [
	'This fight is fast and to the death: every second you wait, your side bleeds. Never wait and never think twice about the same thing: decide and issue.',
	'Your units never move on the enemy or attack unless you order it: on their own they only stand, block, and keep the back line back. Order every unit to attack at once, and keep them attacking: all on their Healer or their weakest, or a Knight to protect a hurt ally. You already heal and keep back by your own laws.',
	'Each think, read the roster: re-issue a unit that is idle or keeps failing; leave one that works. Give a program as loop(choose(...)) like the Example, so it never ends; a fast model re-picks each swing from live hp and distance.',
	'Inside an issued arc, me is that unit, never you. Units have only their attacks, block and protect (Knight and Blade), go_to, loop and choose: never issue wait or flee.',
	'Arrows and smite need a clear shot; hex and heal are weaker through cover. A unit with no shot: go_to an ally who has one.',
	`Knight and Blade block only as one choice beside others, for an enemy within ${BLOCK.near}m; block has a cooldown, so never loop it alone.`,
].join(' ');

/** Scene facts only: stats, who is whose, and what is yours to do. Doctrine is {@link FIGHT_DOCTRINE}. */
function partyStory(party:string, units:{ id:string; tags?:string[] }[]):MemoryDraft {
	const yours = units.filter((u) => !u.tags?.includes('Captain')).map((u) => `${u.id} (${u.tags?.[0]})`).join(', ');
	const text = [
		`You command ${party}. Win.`,
		formatFightRules(),
		`Your units: ${yours}. Never target them.`,
		'Every enemy shows as Enemy and its kind: EnemyWitch, EnemyKnight, EnemyArcher, EnemyBlade, EnemyHealer, and a Player who strikes your units as EnemyPlayer; in programs, enemies are others.filter("enemy"). who=units.filter("Blade") is your Blade; EnemyBlade is theirs.',
		`You are the Healer and the commander: issue() never reaches you. Your own laws heal from ${SPELL_RANGE}m and keep you back; smite yourself only a foe already within ${ATTACKS.smite!.range}m. Never issue heal, attack or rank; issue smite only to your Witch.`,
		'go_to only walks there; an issued attack walks the unit into range itself. Inside an issued arc, && runs the next step after a hit lands or the foe is down. Each issue is its own step, never joined by &&.',
	].join(' ');
	return { text, tags: ['backstory', party], pinned: true };
}

/** A party fights, but answers whoever speaks to it. */
const PARTY_GOALS = [
	{ text: 'Win.', priority: 3 },
	{ text: 'When someone speaks to you, answer them with say, then fight on. Never talk otherwise: issue() commands your units.', priority: 2 },
];


/**
 * A party's fighters: its captain with its own laws, and four units that defend on their own (`roleChoice`) whenever
 * their captain has issued them nothing: they hold their line and block, and attack only on its orders.
 */
function partyUnits(captain:string, units:Record<'Witch' | 'Knight' | 'Archer' | 'Blade', string>):NonNullable<CollectiveSpec<CharacterCtx>['characters']> {
	return [
		{ id: captain, tags: ['Captain', 'Healer'], laws: CAPTAIN_LAWS },
		...(Object.entries(units) as [keyof typeof units, string][]).map(([role, id]) => ({
			id,
			tags: [role],
			kit: ROLE_KITS[role],
			choose: roleChoice(role),
		})),
	];
}

const DAWN_UNITS = partyUnits('Dawn', { Witch: 'Cinder', Knight: 'Brune', Archer: 'Wisp', Blade: 'Cade' });
const DUSK_UNITS = partyUnits('Dusk', { Witch: 'Nyx', Knight: 'Helms', Archer: 'Ash', Blade: 'Flint' });

const DAWN:CollectiveSpec<CharacterCtx> = {
	id: 'DawnParty',
	// Its commander plans the tactics on every heartbeat; its units' System One picks each swing.
	mind: { skipHeartbeat: false, model: 'quick' },
	watchesWritable: false,
	pinnedSightFocus: ['isHurt(it)'],
	kit: FIGHT,
	commander: 'Dawn',
	identity: { role: 'Commander', traits: ['resolute', 'grim', 'captain'] },
	memories: [partyStory('DawnParty', DAWN_UNITS)],
	goals: PARTY_GOALS,
	characters: DAWN_UNITS,
};

const DUSK:CollectiveSpec<CharacterCtx> = {
	id: 'DuskParty',
	// Its commander plans the tactics on every heartbeat; its units' System One picks each swing.
	mind: { skipHeartbeat: false, model: 'quick' },
	watchesWritable: false,
	pinnedSightFocus: ['isHurt(it)'],
	kit: FIGHT,
	commander: 'Dusk',
	identity: { role: 'Commander', traits: ['cold', 'ruthless', 'captain'] },
	memories: [partyStory('DuskParty', DUSK_UNITS)],
	goals: PARTY_GOALS,
	characters: DUSK_UNITS,
};

/** The scene's parties and the name the player sees for each. */
const PARTIES = [{ spec: DAWN, name: 'Dawn' }, { spec: DUSK, name: 'Dusk' }];

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
	return isLiving(findObject(host.world, id));
}

/** When the commander is down, the farthest living role takes command. */
function succeedCommand(host:GameHost, party:Collective<CharacterCtx>):void {
	if (host.bargainDone) {
		return;
	}
	if (party.commander && livingCommand(host, party.commander.id)) {
		return;
	}
	let best:{ character:Character<CharacterCtx>; rank:number } | undefined;
	for (const character of party.characters) {
		if (!livingCommand(host, character.id)) {
			continue;
		}
		const rank = roleRank(character.tags);
		if (!best || rank > best.rank) {
			best = { character, rank };
		}
	}
	if (!best) {
		return;
	}
	party.commander = best.character;
	best.character.replaceProgram();
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
}

function livingOf(host:GameHost, spec:CollectiveSpec<CharacterCtx>):GameObject[] {
	const out:GameObject[] = [];
	for (const { id } of host.arc?.collective(spec.id)?.characters ?? []) {
		const go = findObject(host.world, id);
		if (isLiving(go)) {
			out.push(go);
		}
	}
	return out;
}

function hopWin(host:GameHost, winners:GameObject[], spec:CollectiveSpec<CharacterCtx>, name:string):void {
	host.bargainDone = true;
	host.world.setMessage(`${name} holds the colonnade`);
	for (const go of winners) {
		host.arc?.abortArc(idOf(go));
		const hop = go.getOrAddComponent(Celebrating);
		hop.until = Time.time + 48;
		hop.enabled = true;
	}
	const queue = host.arc?.mindQueue();
	queue?.setAiOn(spec === DAWN ? DUSK.id : DAWN.id, false);
	queue?.ensure(spec.id, { skipHeartbeat: true, skipMajor: true });
	queue?.setWatches(spec.id, [
		'some(others.nearby().approaching())',
		'count(me.inventory) > count(prev.me.inventory)',
	]);
	const winner = host.arc?.collective(spec.id);
	if (!winner) {
		return;
	}
	winner.replaceProgram();
	winner.persona.goals = [{ text: 'You won. Stay. Speak when someone approaches or gives you something.', priority: 2 }];
	for (const character of winner.characters) {
		character.replaceProgram();
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
	for (const { spec } of PARTIES) {
		const party = host.arc.collective(spec.id);
		if (party) {
			succeedCommand(host, party);
		}
	}
	const [dawn, dusk] = PARTIES.map(({ spec }) => livingOf(host, spec));
	if (dawn.length > 0 && dusk.length === 0) {
		hopWin(host, dawn, DAWN, PARTIES[0].name);
	}
	else if (dusk.length > 0 && dawn.length === 0) {
		hopWin(host, dusk, DUSK, PARTIES[1].name);
	}
}

/**
 * One orb per enemy downed, so the two sides race toward the middle: the downed fill theirs, and the next orb fills as
 * the most hurt enemy still standing weakens.
 */
function downed(host:GameHost, foes:CollectiveSpec<CharacterCtx>):HudGoal[] {
	const vitals = (foes.characters ?? []).map(({ id }) => findObject(host.world, id)?.getComponent(Vitals));
	const down = vitals.filter((v) => !v || v.hp <= 0).length;
	const next = Math.max(0, ...vitals.map((v) => (v && v.hp > 0 ? 1 - v.hp / v.maxHP : 0)));
	return vitals.map((v, i) => ({
		name: `Defeat ${i + 1} of ${vitals.length} ${PARTIES.find((p) => p.spec === foes)?.name} fighters`,
		progress: i < down ? 1 : i === down ? next : 0,
	}));
}

/** Each party's orbs fill as the other falls: Dawn's gold, Dusk's blue, each on the end its party stands on screen. */
function goals(host:GameHost):SceneGoals {
	const who = (party:CollectiveSpec<CharacterCtx>):string[] => (party.characters ?? []).map(({ id }) => id);
	return {
		left: { color: 'gold', goals: downed(host, DUSK), who: who(DAWN) },
		right: { color: 'blue', goals: downed(host, DAWN), who: who(DUSK) },
	};
}

export function createDirector(host:GameHost):ArcDirector<CharacterCtx> {
	host.hooks = { checkBargain: tickFight, goals };
	return host.configure(new ArcDirector<CharacterCtx>())
		.withMOBA(fightVerbs(host))
		// The ruins' own line: Knight and Blade on the nearest enemy, the rest behind them.
		.addVerb('rank', { handler: (call) => doRank(host, call) })
		.onCommanderVacant((party) => succeedCommand(host, party))
		// Each rival is marked in reach or not, so its commander's roster says who can hit whom.
		.withSight({ limit: 16, look: (ctx) => markReach(host, ctx.character, lookWorld(ctx.character, host.ambient, host)) })
		.withNames({ seen: seenInFight })
		.withThinkInstructions({ off: NO_THINK })
		.withVerbInstructions(`${DEFAULT_VERB_INSTRUCTIONS} ${FIGHT_DOCTRINE}`)
		.withArcExample(FIGHT_EXAMPLE)
		// Characters run the programs their commander issues them: their role's attack among them.
		.withDefaultKit({ verbs: [...FIGHT.verbs, 'protect', 'block', ...Object.keys(ATTACKS)], tools: [] })
		.addCollective(DAWN)
		.addCollective(DUSK);
}
