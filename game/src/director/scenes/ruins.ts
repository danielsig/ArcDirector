import { Time, type GameObject } from '@arc-director/kindling';
import { ArcDirector, DEFAULT_VERB_INSTRUCTIONS, type Character, type Collective, type CollectiveSpec, type Kit, type MemoryDraft, type StandingChoice } from 'arc-director';
import { CharacterMotor } from '../../characters/CharacterMotor';
import { Celebrating } from '../../engine/components';
import type { GameHost, CharacterCtx } from '../adapter';
import { addFightVerbs } from '../verbs';
import { ATTACKS, BACK_STANDOFF, BLOCK, FIGHT_WALK, SPELL_RANGE, attackVerbFor, formatFightRules, seenInFight } from '../fight';
import { idOf, findObject, isLiving } from '../names';

/** What a party's mind may write. */
const FIGHT:Kit = {
	verbs: ['issue', 'when', 'law', 'unlaw', 'loop', 'choose', 'smite', 'heal', 'attack', 'rank', 'say'],
	tools: [],
};

/** Nearest living Healer of the unit's own party. A bare `Healer` is a tag, not a name anyone sees. */
const ALLY_HEALER = 'others.filter(u => u is "Healer" && !(u is "enemy")).minBy(u => distance(me, u))';

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

const PARTY_LAWS = [MEND_LAW, GUARD_LAW, STRIKE_LAW, RANK_LAW];

/** Only while reasoning is off. With it on, the library's own think line stands. */
const NO_THINK = 'IMPORTANT! DO NOT THINK! RESPOND IMMEDIATELY! Thinking is dangerous. The enemy is very likely already killing your units while you think. Do not wait for another think.';

const NEAREST = 'others.filter("enemy").minBy(u => distance(me, u))';
/** The nearest enemy close enough to block, or no one: a `block` choice only exists while it pays. */
const CLOSE_ENEMY = `others.filter(u => u is "enemy" && distance(me, u) < ${BLOCK.near}).minBy(u => distance(me, u))`;
/** The most hurt ally, or no one: `guard` only exists while someone needs it. */
const HURT_ALLY = 'others.filter(u => !(u is "enemy") && isHurt(u)).minBy(u => u.hp)';

/** The lowest-hp enemy within a step of `verb`'s reach, or no one: the choice that finishes kills without walking. */
function lowestInReach(verb:string):string {
	return `others.filter(u => u is "enemy" && distance(me, u) < ${Math.ceil(ATTACKS[verb].range + 1)}).minBy(u => u.hp)`;
}

/**
 * A unit's own program whenever its commander has issued it nothing: its party's System One keeps picking whom to
 * hit from live hp and distance. `finish` and `guard` only exist while they have a target, so focus fire never
 * walks past someone in reach and a Knight never guards the unhurt.
 */
function roleChoice(role:'Knight' | 'Blade' | 'Archer' | 'Witch'):StandingChoice {
	if (role === 'Knight') {
		return { goal: 'Hold the line: hit the nearest; guard a hurt ally; block one up close', nearest: `cleave(${NEAREST})`, guard: `protect(${HURT_ALLY})`, block: `block(${CLOSE_ENEMY})` };
	}
	const verb = attackVerbFor(role)!;
	const block = role === 'Blade' ? { block: `block(${CLOSE_ENEMY})` } : {};
	return { goal: 'Kill fast: finish the lowest hp in reach', finish: `${verb}(${lowestInReach(verb)})`, nearest: `${verb}(${NEAREST})`, ...block };
}

/** A change of tactics in the units' own idiom, laid out as blocks. Gemma copies this; keep it short. */
const FIGHT_EXAMPLE = `
issue(
	who=units.filter("Archer"),
	arc=loop(
		choose(
			"Kill their Healer first",
			healer=shoot(EnemyHealer),
			finish=shoot(${lowestInReach('shoot')}),
		),
	),
)`;

/** Standing 5v5 doctrine. Every name here is one the commander really sees. */
const FIGHT_DOCTRINE = [
	'Teamfight: Knight and Blade hold a line on the nearest. Archer, Witch, and Healer sit behind that line and pick among enemies they can hit. Healer: stay back, heal from range, never walk toward an enemy. Sight is ~10s stale.',
	'Your units start with no program: until you issue one, they only follow their laws. A fast model re-picks each loop(choose(...)) you issue before every swing, from live hp and distance, among the choices you give it.',
	'You are the tactician. Every think, read the enemy and how each unit program is going, then issue the tactic that wins this moment: focus fire on their Healer or the weakest, send an Archer to go_to a Pillar, Tree or Boulder for a clear shot, peel for your Healer with protect, pull the hurt back. Give it as loop(choose(...)) whose choices are the new options, like the Example. Never a fixed target outside choose. A program that keeps failing gets replaced; one that works stays. When it ends, those units fall back to their laws.',
	`Never a weak allUnits. Optional:\nlaw(\n\twho=units,\n\twatch=me.hp/me.maxHP<0.25,\n\tarc=go_to(${ALLY_HEALER}),\n\tname=lastStand,\n)\n`,
	'Arrows need a clear line of sight past pillars, trees, walls, and other characters; spells (hex, heal) through cover are weaker. Flank around cover for a better view of the target.',
	'protect(target?) stands between an ally and the threat, then attacks that threat. Peeling is also protect: when a rival isNear a precious ally, attack that same rival.',
	`Knight and Blade block when protecting: give them a block choice beside protect, for an enemy up close or attacking, like guard=block(${CLOSE_ENEMY}). Block has a cooldown; never loop it alone.`,
].join(' ');

/** Scene facts only: stats, what each pinned law does, and what the enemy looks like. Doctrine is {@link FIGHT_DOCTRINE}. */
function partyStory(party:string):MemoryDraft {
	const text = [
		`You command ${party}. Win.`,
		formatFightRules(),
		'Your units are fully programmable RTS units: sticky programs, laws, when, loop. You are a unit and the commander; issue() never targets you.',
		'The enemy shows as EnemyWitch, EnemyKnight, EnemyArcher, EnemyBlade, EnemyHealer. A Player who strikes your units is then EnemyPlayer. In programs, enemies are others.filter("enemy").',
		'go_to is not a fight — they walk there and stop. Issued combat verbs walk those units into range. You stay behind the line. The verb matches YOUR tag. who=units.filter("Blade") is your Blade; EnemyBlade is theirs.',
		'Flank with spread, circle, or go_to a Pillar, Tree or Boulder so shoot has a clear view.',
		'A program that ends hands the unit back to its laws. Inside the issued arc, && is the next step after success (the hit landed or the foe is down). loop the chain. Each issue is its own block — never && between issue().',
		'If someone is almost dead and under fire they are probably down — do not program around that snapshot.',
		'You already have mend: heal() walks you into range of the hurt and loops Knight, then yourself, then Captain, then the rest — only while you are a Healer and no rival is in knife range. Guard protect()s whoever is hurt while a Healer lives: the Knight screens them and attacks that threat, then goes back to their program. Strike is attack() with your tag when you are not a Healer. Rank holds you behind the Knight and Blade, clear of knife range. If a rival is close, rank() away — do not heal or smite in a scrum. Keep mend, guard, strike, and rank. Never unlaw them.',
		`smite, heal, attack(), and rank() are yours as commander. smite reaches ${ATTACKS.smite!.range}m — never walk in for it while a Knight or Blade lives. heal from ${SPELL_RANGE}m like hex. Never go_to an enemy. Never issue heal, attack, or rank. Issue smite only to a Witch: slow and heavy, for a foe already within ${ATTACKS.smite!.range}m.`,
	].join(' ');
	return { text, tags: ['backstory', party], pinned: true };
}

/** A party fights, but answers whoever speaks to it. */
const PARTY_GOALS = [
	{ text: 'Win.', priority: 3 },
	{ text: 'When someone speaks to you, answer them with say, then fight on. Never talk otherwise: issue() commands your units.', priority: 2 },
];


const DAWN:CollectiveSpec<CharacterCtx> = {
	id: 'DawnParty',
	// Its commander plans the tactics on every heartbeat; its units' System One picks each swing.
	mind: { skipHeartbeat: false, model: 'quick' },
	watchesWritable: false,
	pinnedSightFocus: ['isHurt(it)'],
	kit: FIGHT,
	// Its units pick `choose` with Jev, whatever the menu's default.
	systemOne: 'jev',
	commander: 'Dawn',
	identity: { role: 'Commander', traits: ['resolute', 'grim', 'captain'] },
	memories: [partyStory('DawnParty')],
	goals: PARTY_GOALS,
	characters: [
		{ id: 'Dawn', tags: ['Captain', 'Healer'] },
		{ id: 'Cinder', tags: ['Witch'] /* , choose: roleChoice('Witch') */ },
		{ id: 'Brune', tags: ['Knight'] /* , choose: roleChoice('Knight') */ },
		{ id: 'Wisp', tags: ['Archer'] /* , choose: roleChoice('Archer') */ },
		{ id: 'Cade', tags: ['Blade'] /* , choose: roleChoice('Blade') */ },
	],
	laws: PARTY_LAWS,
};

const DUSK:CollectiveSpec<CharacterCtx> = {
	id: 'DuskParty',
	// Its commander plans the tactics on every heartbeat; its units' System One picks each swing.
	mind: { skipHeartbeat: false, model: 'quick' },
	watchesWritable: false,
	pinnedSightFocus: ['isHurt(it)'],
	kit: FIGHT,
	// Its units pick `choose` with the local model, whatever the menu's default.
	systemOne: 'local',
	commander: 'Dusk',
	identity: { role: 'Commander', traits: ['cold', 'ruthless', 'captain'] },
	memories: [partyStory('DuskParty')],
	goals: PARTY_GOALS,
	characters: [
		{ id: 'Dusk', tags: ['Captain', 'Healer'] },
		{ id: 'Nyx', tags: ['Witch'] /* , choose: roleChoice('Witch') */ },
		{ id: 'Helms', tags: ['Knight'] /* , choose: roleChoice('Knight') */ },
		{ id: 'Ash', tags: ['Archer'] /* , choose: roleChoice('Archer') */ },
		{ id: 'Flint', tags: ['Blade'] /* , choose: roleChoice('Blade') */ },
	],
	laws: PARTY_LAWS,
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
	for (const { spec } of PARTIES) {
		for (const character of host.arc?.collective(spec.id)?.characters ?? []) {
			character.replaceProgram();
		}
	}
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

export function createDirector(host:GameHost):ArcDirector<CharacterCtx> {
	host.hooks = { checkBargain: tickFight };
	// Characters run what the party laws and the issued programs do: their role's attack among them.
	host.kit = { verbs: [...FIGHT.verbs, 'go_to', 'protect', 'block', ...Object.keys(ATTACKS)], tools: [] };
	return addFightVerbs(host.configure(new ArcDirector<CharacterCtx>()), host)
		.onCommanderVacant((party) => succeedCommand(host, party))
		.withSight({ limit: 16 })
		.withNames({ seen: seenInFight })
		.withThinkInstructions({ off: NO_THINK })
		.withVerbInstructions(`${DEFAULT_VERB_INSTRUCTIONS} ${FIGHT_DOCTRINE}`)
		.withArcExample(FIGHT_EXAMPLE)
		.withDefaultKit(host.kit)
		.addCollective(DAWN)
		.addCollective(DUSK);
}
