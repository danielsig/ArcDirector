import type { GameObject } from '@arc-director/kindling';
import { DEFAULT_VERB_INSTRUCTIONS, type Character, type Collective, type CollectiveSpec, type Kit, type LawSpec, type MemoryDraft, type StandingChoice } from 'arc-director';
import { CharacterMotor } from '../../characters/CharacterMotor';
import { Celebrating, Vitals, idOf } from '../../engine/components';
import type { HudGoal } from '../../ui/hud-model';
import type { SceneGoals } from '../../director/game-types';
import type { GameHost, CharacterCtx } from '../../director/adapter';
import { doRank, fightVerbs, markSides } from '../../director/fight-verbs';
import { SIGHT, lookWorld } from '../../director/perception';
import { ATTACKS, BACK_STANDOFF, BLOCK, FIGHT_WALK, SPELL_RANGE, formatFightRules, seenInFight } from '../../director/fight';
import { findObject, isLiving } from '../../director/names';
import { COMBAT_PLACES, COMBAT_PLACES_ABOUT } from './combat-places';
import { COMBAT_CHUNKS } from './combat-map';
import { COMBAT_KNOWLEDGE } from './combat-knowledge';
import { HEROS_MIGHT } from '../../audio/songs';
import { GLEN_LOOK } from '../../render/look';
import { BOW, STAFF, SWORD, SWORD_KEYS, mindsOf, type CastMember, type Scene, type SceneCast } from '../scene';

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

/** How soon a captain is woken again while one of its units still has no orders (s). */
const IDLE_AGAIN = 5;

/** What a party's mind may write. */
const FIGHT:Kit = {
	verbs: ['command', 'if', 'when', 'law', 'unlaw', 'loop', 'go_to', 'choose', 'smite', 'heal', 'attack', 'rank', 'say', 'wait', 'pass'],
	tools: [],
};

/**
 * What wakes a captain while its orders run, each once as it happens: one of its own falling, a unit left with no orders
 * (they ended or failed), and someone of its own getting badly hurt; and every few seconds for as long as a unit stands
 * idle, should a think leave it so. Anything else waits for a rethink.
 */
const PARTY_WATCHES = {
	fallen: 'hasFallen("standing", count(allUnits))',
	orderless: 'hasRisen("orderless", count(units.filter(u => !u.ordered)))',
	idle: `some(units.filter(u => !u.ordered)) && prev.secondsAgo > ${IDLE_AGAIN}`,
	wounded: 'hasRisen("wounded", count(allUnits.filter(u => isBadlyHurt(u))))',
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

/**
 * A unit's own program whenever its commander has issued it nothing: it defends, and never attacks or advances. A
 * Knight or Blade raises its guard at an enemy already up close (`block` only exists while one is there), else stands
 * where it is; an Archer or Witch keeps behind its front line, clear of the enemy (`rank`, which for them only ever
 * pulls back). Moving on the enemy and attacking are its captain's to order.
 */
function roleChoice(role:'Knight' | 'Blade' | 'Archer' | 'Witch'):StandingChoice {
	if (role === 'Knight' || role === 'Blade') {
		return { goal: 'Defend: block an enemy up close', choices: { block: `block(${CLOSE_ENEMY})` } };
	}
	return { goal: 'Stay alive: keep behind your line', choices: { back: 'rank()' } };
}

/** Every hurt enemy: a law's trigger for focusing the weakest. */
const HURT_ENEMIES = 'others.filter(u => u is "enemy" && isHurt(u))';

/**
 * A change of tactics in the units' own idiom, laid out as blocks: one program for the whole squad now (`attack` is
 * each unit's own blow) and a law for the next likely turn. Gemma copies this; keep it short.
 */
const FIGHT_EXAMPLE = `
command(who=units, group=Vanguard) {
	loop(until=!some(others.filter("enemy"))) {
		choose("Kill their Healer first or finish off the weakest enemy. There are {X} friends and {Y} enemies left. Healer is {Z} units away. Weakest enemy is {W} units away.") {
			healer: attack(EnemyHealer)
			finish: attack(others.filter("enemy").minBy(u => u.hp))
		}
	}
}
law(who=units.filter("Blade"), watch=count(${HURT_ENEMIES}) > 1, name=blade_finish) {
	loop {
		stab(${HURT_ENEMIES}.minBy(u => u.hp))
	}
}`;

/** Standing 5v5 doctrine: how to command, once each. Every name here is one the commander really sees. */
const FIGHT_DOCTRINE = [
	'This fight is fast and to the death: an idle unit bleeds your side. Decide and command. Orders that still fit keep running without you: when nothing needs to change, reply pass().',
	'Your units never move on the enemy or attack unless you order it: on their own they only stand, block, and keep the back line back. Order all four units to attack in the same think, and keep them attacking: all on their Healer or their weakest, or a Knight to protect a hurt ally. attack is each unit\'s own blow (Knight cleave, Blade stab, Archer shoot, Witch hex), so one command(who=units) orders the whole squad; split them only where their programs differ. You already heal and keep back by your own laws.',
	'Each think, read the roster: order a unit that is idle or keeps failing, and leave one that works, never re-issuing it. Give a program as loop { choose(…) { … } } like the Example, so it runs until the enemy is gone; a fast model re-picks each swing from live hp and distance.',
	'Be relentlessly aggressive and play ahead, never behind: give each unit a state machine. Its command is what it does now; add a law for its next likely turn, before it happens: an enemy falls (count(others.filter("enemy")) drops), one of yours falls (count(allUnits) drops), or two or more enemies are hurt (finish the weakest first). Laws fire without a think; once a law\'s turn has come, unlaw it and lay the next.',
	'Inside an issued arc, me is that unit, never you. Units have only attack and their own attacks, block and protect (Knight and Blade), go_to, loop and choose: never command wait or flee.',
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
		`You are the Healer and the commander: command() never reaches you. Your own laws heal from ${SPELL_RANGE}m and keep you back; smite yourself only a foe already within ${ATTACKS.smite!.range}m. Never heal, attack or rank yourself, and never command heal or rank; command smite only to your Witch.`,
		COMBAT_PLACES_ABOUT,
		'go_to only walks there; an issued attack walks the unit into range itself. Inside an issued arc, && runs the next step after a hit lands or the foe has fallen. Each command is its own step, never joined by &&.',
	].join(' ');
	return { text, tags: ['backstory', party], pinned: true };
}

/** How a captain sounds when it speaks: its own memory, in its own words, so what it says is never generic. */
function voice(party:string, text:string):MemoryDraft {
	return { text, tags: ['backstory', 'voice', party], pinned: true };
}

/** A party fights, and its captain leads out loud: it calls every order and answers whoever speaks to it. */
const PARTY_GOALS = [
	{ text: 'Win.', priority: 3 },
	{ text: 'Be a talkative leader. Whenever you give orders, shout one rallying line with say that tells your units what they are doing. Cheer them when it goes well and warn them when it goes badly. Leave out to, so you stay where you are. Never say the same line twice. If someone speaks to you, answer with say, then fight on.', priority: 2 },
];


/** The parties' colors: Dawn gold and crimson, Dusk teal and indigo. */
const DAWN_COLORS = { band: 0xf2c14e, rim: 0xb3262e };
const DUSK_COLORS = { band: 0x2bb3a6, rim: 0x3b2a8c };

/**
 * A fighter in the temple at map cell `x`, `z`, with `equip` in hand: Dawn's party on the west half, Dusk's on the
 * east. A captain keeps its own laws; a unit defends on its own (`roleChoice`) whenever its captain has issued it
 * nothing: it holds its line and blocks, and attacks only on its orders.
 */
function fighter(id:string, role:'Captain' | 'Witch' | 'Knight' | 'Archer' | 'Blade', meshID:string, x:number, z:number, hp:number, equip:string[]):CastMember {
	const dawn = x < 32;
	const mind = role === 'Captain' ? { tags: ['Captain', 'Healer'], laws: CAPTAIN_LAWS } : { tags: [role], kit: ROLE_KITS[role], choose: roleChoice(role) };
	const body = { meshID, cell: [x, z] as [number, number], yaw: dawn ? -Math.PI / 2 : Math.PI / 2, equip, hp, team: dawn ? DAWN_COLORS : DUSK_COLORS };
	return { id, ...mind, of: dawn ? 'DawnParty' : 'DuskParty', body };
}

/**
 * Each party starts in its colonnade a couple of paces behind its places by the sanctum's gap: Dawn in the west, Dusk in
 * the east. The sanctum and its dais lie between them.
 */
const CAST:SceneCast = [
	fighter('Dawn', 'Captain', 'Shaman', 22, 16, 12, ['shaman_staff']),
	fighter('Cinder', 'Witch', 'Witch', 23, 19, 12, STAFF),
	fighter('Brune', 'Knight', 'KnightMale', 24, 14, 28, SWORD),
	fighter('Wisp', 'Archer', 'Scout', 23, 12, 12, BOW),
	fighter('Cade', 'Blade', 'Blacksmith', 24, 17, 20, SWORD),
	fighter('Dusk', 'Captain', 'Robe', 41, 16, 12, ['shaman_staff']),
	fighter('Nyx', 'Witch', 'Sorceress', 40, 19, 12, STAFF),
	fighter('Helms', 'Knight', 'KnightFemale', 39, 14, 28, SWORD),
	fighter('Ash', 'Archer', 'Rogue', 40, 12, 12, BOW),
	fighter('Flint', 'Blade', 'VillagerMale', 39, 17, 20, SWORD),
];

/** A party of the cast, led by its captain, who sounds as its `manner` says. */
function party(id:string, traits:string[], manner:string):CollectiveSpec<CharacterCtx> {
	const units = mindsOf(CAST, id);
	return {
		id,
		// Its commander plans when its watches say something changed; its units' System One picks each swing.
		mind: { model: 'quick' },
		watchesWritable: false,
		pinnedWatches: PARTY_WATCHES,
		pinnedSightFocus: ['isHurt(it)'],
		kit: FIGHT,
		commander: units.find((unit) => unit.tags?.includes('Captain'))!.id,
		identity: { role: 'Commander', traits },
		memories: [partyStory(id, units), voice(id, manner)],
		goals: PARTY_GOALS,
		characters: units,
	};
}

const DAWN = party('DawnParty', ['booming', 'boastful', 'warm', 'stubbornly optimistic', 'captain'], 'I am Dawn, and I fight like a bonfire: loud, hot, and impossible to ignore. I bellow orders as if the whole ruin were my audience and I call my units by name, always as if they were the finest soldiers alive. I brag before a charge and laugh at a wound, even my own. I never admit a fight is lost; a setback is only a bad morning. I lecture Dusk across the sanctum like an old rival I secretly respect.');
const DUSK = party('DuskParty', ['sardonic', 'theatrical', 'gloating', 'ruthless', 'captain'], 'I am Dusk, and I love the sound of my own voice. I narrate the fight like a cruel play and I am the villain who enjoys it: every order comes with a sneer, a taunt or a sly joke at the enemy\'s expense. I name each unit I send like I am casting them in a tragedy, and I gloat over every kill and mock every miss, theirs and mine. I flatter my units when they please me and pity them when they fail. I trade barbs with Dawn across the sanctum, because I cannot let that sunrise-worshipping loudmouth have the last word.');

/** The scene's parties and the name the player sees for each. */
const PARTIES = [{ spec: DAWN, name: 'Dawn' }, { spec: DUSK, name: 'Dusk' }];

/** Farther from the fight outranks. Healer, archer, mage, swordsman, tank. */
const COMMAND_RANK = ['Knight', 'Blade', 'Witch', 'Archer', 'Healer'] as const;

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

/** When the commander has fallen, the farthest living role takes command. */
function succeedCommand(host:GameHost, party:Collective<CharacterCtx>):void {
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

/** Everyone at the fight's walk, every tick, as the marketplace does: nothing else sets it, and nothing is kept. */
function paceCombat(host:GameHost):void {
	for (const go of host.world.objects) {
		const motor = go.getComponent(CharacterMotor);
		if (motor) {
			motor.maxSpeed = FIGHT_WALK;
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
	host.sceneState().bargainDone = true;
	host.world.setMessage(`${name} holds the colonnade`);
	for (const go of winners) {
		host.arc?.abortArc(idOf(go));
		go.getOrAddComponent(Celebrating).celebrateFor(48);
	}
	const queue = host.arc?.queue;
	queue?.setAiOn(spec === DAWN ? DUSK.id : DAWN.id, false);
	queue?.ensure(spec.id, { rethinks: false, skipMajor: true });
	queue?.abortThink(spec.id);
	const winner = host.arc?.collective(spec.id);
	if (!winner) {
		return;
	}
	winner.replaceProgram();
	// The fight is over: no more orders, and nothing that wakes a captain for a fight.
	winner.kit = { verbs: ['say', 'wait'], tools: [] };
	// What it was told for the fight would only have it write orders it can no longer give.
	winner.mind.settings.verbInstructions = 'The fight is over and you won. You can only speak or wait.';
	winner.mind.settings.arcExample = 'say("It is done.")';
	winner.persona.watches = {};
	winner.persona.pinnedWatches = {
		approaching: 'hasHeard || some(others.filter(u => u is "Player").nearby().approaching())',
		given: 'count(me.inventory) > count(prev.me.inventory)',
	};
	queue?.setWatches(spec.id, winner.persona.watchList());
	winner.persona.goals = [{ text: 'You won. Stay. Speak when someone approaches or gives you something.', priority: 2 }];
	for (const character of winner.characters) {
		character.kit = winner.kit;
		character.replaceProgram();
	}
}

function tickFight(host:GameHost):void {
	if (!host.arc) {
		return;
	}
	paceCombat(host);
	if (host.sceneState().bargainDone) {
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
 * One orb per fallen enemy, so the two sides race toward the middle: the fallen fill theirs, and the next orb fills as
 * the most hurt enemy still standing weakens.
 */
function fallenGoals(host:GameHost, foes:CollectiveSpec<CharacterCtx>):HudGoal[] {
	const vitals = (foes.characters ?? []).map(({ id }) => findObject(host.world, id)?.getComponent(Vitals));
	const fallen = vitals.filter((v) => !v || v.hp <= 0).length;
	const next = Math.max(0, ...vitals.map((v) => (v && v.hp > 0 ? 1 - v.hp / v.maxHP : 0)));
	return vitals.map((v, i) => ({
		name: `Defeat ${i + 1} of ${vitals.length} ${PARTIES.find((p) => p.spec === foes)?.name} fighters`,
		progress: i < fallen ? 1 : i === fallen ? next : 0,
	}));
}

/** Each party's orbs fill as the other falls: Dawn's gold, Dusk's blue, each on the end its party stands on screen. */
function goals(host:GameHost):SceneGoals {
	const who = (party:CollectiveSpec<CharacterCtx>):string[] => (party.characters ?? []).map(({ id }) => id);
	return {
		left: { color: 'gold', goals: fallenGoals(host, DUSK), who: who(DAWN) },
		right: { color: 'blue', goals: fallenGoals(host, DAWN), who: who(DUSK) },
	};
}

export const COMBAT:Scene = {
	id: 'combat',
	title: '5v5 Combat',
	blurb: 'Two squads of five. Each captain thinks; the rest follow orders.',
	look: GLEN_LOOK,
	music: HEROS_MIGHT,
	knowledge: COMBAT_KNOWLEDGE,
	healthBars: true,
	minimapFollow: true,
	player: { equip: ['iron_sword'] },
	chunks: COMBAT_CHUNKS,
	rooms: COMBAT_PLACES,
	cast: CAST,
	ravens: [{ x: 31.5, z: 3.5, yaw: 2.4 }, { x: 32.4, z: 4.1 }],
	// The middle of the 4×2 map: the sanctum and its dais.
	orbit: { x: 32, z: 16 },
	// Back far enough to see the temple whole, south of the dais.
	camera: { zoom: 20 },
	ambient: 'Two parties fight to the death in a ruined forest temple. No quarter.',
	keys: SWORD_KEYS,
	brief: `Dawn and Dusk are the two captains. Each leads a squad of five: a knight, a swordsman, an archer, a witch, and the captain, who also heals. Both squads start in the ruined temple's colonnades, each a few steps from its line by the sanctum, and hold their ground: nobody moves on the enemy or attacks until their captain orders it. On their own they only block, keep the back line back, and the captain heals.

A captain writes orders the squad keeps following, who to hit and who stays back, and standing rules for the whole fight, and changes those orders as the fight moves. The usual way a side wins is the knight and the swordsman hold the nearest enemies, the archer and the witch shoot from behind them, and the captain stays clear and heals.

If a captain dies, someone else in the squad takes over. It ends when one squad is gone.`,
	// Once it is won only being spoken to or given something wakes a mind: a line ending must not lead to the next line.
	hooks: { tick: tickFight, goals, mayThink: (h, m, reason) => !h.sceneState().bargainDone || reason === 'watch' },
	direct: (host, director) => director
		// A captain stays where its doctrine and its own laws keep it: a line to its units reaches those in earshot.
		.withWorldVerbs({ groupWalk: (character) => character.collective?.commander !== character })
		.withMOBA(fightVerbs(host))
		// This scene's own line: Knight and Blade on the nearest enemy, the rest behind them.
		.withVerbs((v) => v.add('rank', { handler: (call) => doRank(host, call) }))
		.onCommanderVacant((party) => succeedCommand(host, party))
		// Each of its own side is marked; its commander's roster says who is in reach of whose attack (`getReach`).
		.withSight({ limit: 16, look: (ctx) => markSides(host, ctx.character, lookWorld(ctx.character, host.scene.ambient, host)) })
		.withNames(seenInFight)
		.withMind({
			thinkInstructions: { off: NO_THINK },
			verbInstructions: `${DEFAULT_VERB_INSTRUCTIONS} ${FIGHT_DOCTRINE}`,
			arcExample: FIGHT_EXAMPLE,
		})
		// Characters run the programs their commander issues them: their role's attack among them.
		.withDefaultKit({ verbs: [...FIGHT.verbs, 'protect', 'block', ...Object.keys(ATTACKS)], tools: [] })
		.addCollective(DAWN)
		.addCollective(DUSK),
};
