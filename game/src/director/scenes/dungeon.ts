import { GameObject, Time } from '@arc-director/kindling';
import { ArcDirector, parseArc, type CharacterSpec, type CollectiveSpec, type Goal, type LawSpec, type MemoryDraft, type SpeechUtterance } from 'arc-director';
import { Confine } from '../../characters/Confine';
import { Leash } from '../../characters/Leash';
import { Celebrating, Door, Inscription, Lock, Named, Vitals } from '../../engine/components';
import { cueAt } from '../../audio/cue';
import { distXZ, findCarried, itemMatchesName } from '../../items/inventory';
import type { GameHost } from '../adapter';
import { ATTACKS, HEAL } from '../fight';
import { findObject, idOf, isLiving } from '../names';
import { BODY_VERBS, BUILDING_VERB_INSTRUCTIONS, fightVerbs, GAME_VERBS } from '../verbs';
import { roomBounds } from '../../world/spawn';
import type { CharacterCtx, SceneGoals } from '../types';

const PRIZE = 'SunCrown';
const BOSS = 'HollowKing';
const COMPANY = ['Valerius', 'Seraphine', 'Morrigan'];
/** Who solves the crypt's puzzles, and who gives the orders: the first of each still standing. */
const SOLVERS = ['Seraphine', 'Morrigan'];
const LEADERS = ['Valerius', 'Morrigan'];

/** The riddle's answer, as people say it. Spoken this close to SealedDoor, it opens. */
const ANSWER = /\bfoot\s?(steps?|prints?)\b/i;
const ANSWER_REACH = 6;

const FOES_NEAR = 'some(others.filter("enemy").nearby(9))';
const ALLIES = 'others.filter(u => !(u is "enemy"))';
/** The company in a monster's own room. */
const INTRUDERS = 'others.filter(u => u is "enemy" && u is "sameRoom")';
/**
 * A monster's pick of whom to hit, each blow: the nearest, the weakest, or the healer who keeps them all standing.
 * After a miss it tries someone else rather than swinging at one too quick for it.
 */
const HUNT = `choose(goal="Kill the intruders fast. Strike whoever you can hurt; after a miss, pick someone else; their healer first when you can reach her; lure one who comes alone onto the rest of you", nearest=attack(${INTRUDERS}.minBy(u => distance(me, u))), weakest=attack(${INTRUDERS}.minBy(u => u.hp / u.maxHP)), healer=attack(${INTRUDERS}.filter(u => u is "Healer").minBy(u => distance(me, u))), lure=bait(${INTRUDERS}.minBy(u => distance(me, u))))`;
/** The nearest of a monster's own kind not already at its side: where `bait` leads whoever follows. */
const PACK = 'others.filter(u => !(u is "enemy") && !isNear(me, u, 4)).minBy(u => distance(me, u))';
/** Whoever has the smallest share of their health left, the healer included. */
const LOWEST = `me.hp / me.maxHP <= ${ALLIES}.min(u => u.hp / u.maxHP) ? me : ${ALLIES}.minBy(u => u.hp / u.maxHP)`;
const HEALER_UP = 'some(others.filter("Healer"))';
const FOES_ON_HEALER = 'some(others.filter("enemy").filter(u => some(others.filter("Healer").filter(h => isNear(u, h, 6)))))';

/** A fighter of the company strikes back the moment a monster is in sight, whatever it was doing. */
const STRIKE:LawSpec = { name: 'strike', who: 'me', watch: FOES_NEAR, arc: 'loop(attack())', pinned: true };

/** Near death, a fighter runs to the healer (Seraphine). */
const RALLY:LawSpec = {
	name: 'rally',
	who: 'me',
	watch: `me.hp * 4 <= me.maxHP && ${HEALER_UP} && !some(others.filter("Healer").nearby(3))`,
	arc: 'go_to(Seraphine)',
	pinned: true,
};

/** While the healer lives, a fighter fights from her side, first at whoever is closest to her. */
const GUARD:LawSpec = {
	name: 'guard',
	who: 'me',
	watch: `(${FOES_NEAR} && ${HEALER_UP}) || ${FOES_ON_HEALER}`,
	arc: 'loop(protect(Seraphine))',
	pinned: true,
};

/** The healer backs away from a monster at her side, while anyone else is left to hold it. */
const FLEE:LawSpec = {
	name: 'flee',
	who: 'me',
	watch: 'some(others.filter("enemy").nearby(3)) && some(others.filter(u => !(u is "enemy")))',
	arc: 'loop(through=e in others.filter("enemy").nearby(3).sortBy(u => distance(me, u)), arc=flee(e, distance=6), times=1)',
	pinned: true,
};

/**
 * The healer heals first, then fights: whoever has the least of their health left, herself included. Only once her
 * heal is ready again, so she smites while it rests instead of standing there waiting for it.
 */
const MEND:LawSpec = {
	name: 'mend',
	who: 'me',
	watch: 'isReady(me, "heal") && (isHurt(me) || some(others.filter(u => !(u is "enemy") && isHurt(u)).nearby(8)))',
	arc: `heal(target=${LOWEST})`,
	pinned: true,
	// Long enough to cast: a heal takes this long, and only a blow to her cuts it short.
	hold: HEAL.castTime + 1,
	holdBreak: 'isHPFalling(me)',
};

/** Tags the pinned memories that only hold while the company is more than one. */
const TEAM = 'team';

/**
 * A teammate walking off somewhere of its own, or fighting: what each of these verbs does. Not `follow`: a follower
 * comes after someone, so whoever it follows never turns back for it.
 */
const WALKING_OFF = ['go_to', 'flee', 'wander', 'pick_up', 'use', 'attack', 'protect', 'heal', 'block', ...Object.keys(ATTACKS)]
	.map((verb) => `doing(u, "${verb}")`).join(' || ');

/** Allies walking off or fighting, out of sight or too far: the ones to catch up with. */
const LEAVING = `${ALLIES}.filter(u => (${WALKING_OFF}) && !(isNear(me, u, 10) && hasSightline(me, u)))`;

/**
 * Whoever an ally walks off from, or fights out of sight or too far away, follows it until it catches up, even with
 * another ally still beside it: nobody stands idle while a friend fights a room away. Not when it wandered off itself
 * and the rest stood still. It holds a while, so a walker who arrives
 * is still caught up with. Last, so a fight, a flight or a heal still comes first.
 */
const REGROUP:LawSpec = {
	name: 'regroup',
	who: 'me',
	watch: `some(${LEAVING})`,
	arc: `follow(target=${LEAVING}.minBy(u => distance(me, u)), distance=4)`,
	pinned: true,
	hold: 8,
};

/**
 * What the whole company knows going in. The crypt has no name to go_to and its rooms are not places to go_to, so
 * neither says otherwise. Kaelen may or may not be with them.
 */
const QUEST_MEMORIES:MemoryDraft[] = [
	{
		text: 'We are already inside the crypt, come for the SunCrown at its far end, a long way off: many rooms, locks and guards stand between. We take them one at a time and think only of the one before us. Rooms are not places to go_to: we go_to the things in them.',
		tags: ['SunCrown', 'quest'],
		pinned: true,
	},
	{
		text: 'Kaelen is our archer, a good shot and a better friend, who may catch up with us. We never wait or look for him, and give him orders only once we see him.',
		tags: ['Kaelen', 'company'],
		pinned: true,
	},
	{
		text: 'We are a team and never go anywhere alone. Whoever leads walks in front, into every new room first; the rest follow close behind. Nobody walks off ahead, not even to solve a puzzle.',
		tags: [TEAM, 'together'],
		pinned: true,
	},
];

/** Morrigan is next in line for both posts. */
const SUCCESSION:MemoryDraft = {
	text: 'I am next in line: if Valerius falls, I lead the company in his place; if Seraphine falls, the crypt\'s puzzles become mine.',
	tags: [TEAM, 'succession'],
	pinned: true,
};

/**
 * A step on the way to the crown: where it is done, what is to be done there, and whether it is the solver's puzzle or
 * everyone's; `label` is what the goal track says of it. `how` is the answer, told only once the puzzle has stalled: until then the company works it out. `room`
 * is the room it is done in, whose monsters stand in the way of it.
 */
type Step = { done:(host:GameHost)=>boolean; where:string; text:string; how?:string; puzzle?:boolean; room?:string; label:string };

/** The way to the crown, in order. The first step not done is the company's one goal, so nobody has to ask where to go. */
const STEPS:Step[] = [
	{ done: (host) => !host.world.findNamed('Cobweb'), where: 'Cobweb', puzzle: true, text: 'get past Cobweb', label: 'Destroy the cobweb', how: 'pick_up(WoodenTorch) && use(item=WoodenTorch, target=Cobweb)' },
	{ done: (host) => opened(host, 'SealedDoor'), where: 'SealedDoor', room: 'PillaredHall', puzzle: true, text: 'open SealedDoor', label: 'Solve the riddle at SealedDoor', how: 'read the riddle on RiddleStone beside it, work out the one thing it describes, and say that thing aloud' },
	{ done: (host) => opened(host, 'CryptGate') || companyHolds(host, 'CryptKey'), where: 'OssuaryChest', room: 'Ossuary', puzzle: true, text: 'find CryptKey', label: 'Find CryptKey in the Ossuary', how: 'pick_up(item=CryptKey, from=OssuaryChest)' },
	{ done: (host) => opened(host, 'CryptGate'), where: 'CryptGate', puzzle: true, text: 'open CryptGate', label: 'Unlock CryptGate', how: 'use(item=CryptKey, target=CryptGate)' },
	{ done: (host) => !isLiving(host.world.findByID(BOSS)), where: BOSS, room: 'ThroneCrypt', text: `kill the ${BOSS}`, label: `Slay the ${BOSS}` },
	{ done: (host) => companyHolds(host, PRIZE), where: 'HoardChest', puzzle: true, text: `take the ${PRIZE}`, label: `Claim the ${PRIZE}`, how: `pick_up(item=${PRIZE}, from=HoardChest)` },
];

const NEAREST_FOE = 'others.filter("enemy").minBy(u => distance(me, u))';

/** The choose law each companion is asked to set for danger, in its own idiom: the fast model picks each reaction. */
const DANGER_LAWS:Record<string, string> = {
	Valerius: `law(name=shield, watch=${FOES_NEAR}, arc=loop(choose(goal="Draw their fire off my friends", guard=protect(), block=block(), strike=attack())))`,
	Seraphine: `law(name=mend, watch=${FOES_NEAR}, arc=loop(choose(goal="Keep everyone alive", heal=heal(), back_off=flee(${NEAREST_FOE}, distance=6), strike=attack())))`,
	Morrigan: `law(name=burn, watch=${FOES_NEAR}, arc=loop(choose(goal="Burn them from behind Valerius", weakest=hex(others.filter("enemy").minBy(u => u.hp)), nearest=hex(${NEAREST_FOE}), back_off=flee(${NEAREST_FOE}, distance=6))))`,
};


/** Alone with monsters: cry for help and run to the nearest ally, wherever they are. */
const HELP_LAW = `law(name=help, watch=some(others.filter("enemy").nearby(9)) && !some(${ALLIES}.nearby(8)), arc=say(text="Help! Monsters!") && go_to(${ALLIES}.minBy(u => distance(me, u))))`;

/** How `id` meets danger: a choose law of its own, and one for being caught alone, set before it comes. */
function dangerGoal(id:string):Goal {
	const shield = id === 'Valerius' ? ' Draw their fire and shield the others: protect the weakest, block, strike.' : '';
	return {
		text: `Set two laws for danger before it comes, and keep them; your laws act without a think. One to fight it, a choose law.${shield} Like: ${DANGER_LAWS[id]} And one for when you see monsters but none of your allies: scream for help and run to the nearest ally. Like: ${HELP_LAW}`,
		priority: 3,
	};
}

/** How the company talks: often, in character, never at length. Orders stay the leader's, and only when needed. */
const TALK = 'Say something in your own voice on most thinks: add a say step to your arc, one short sentence of 3 to 7 words. Talk about what is right here and now: this room, a sound, a smell, a friend, your nerves, a joke. Never the crown, the treasure or the quest: everyone knows. Never repeat a line already said, and never claim what you have not seen. Chatter is never an order.';

/** The healer keeps within heal reach of the leader, and heals the lowest first whenever someone near is hurt. */
function healGoal(leader:string):Goal {
	const keep = HEAL.range - 2;
	return {
		text: `Always heal whoever has the lowest health first, yourself included, but do not heal anyone who already has full health like 50/50. Right before you heal, stay within heal reach (${HEAL.range}m): follow with a distance, and let a when heal from there. Like: when(watch=isHurt(me) || some(${ALLIES}.filter(u => isHurt(u)).nearby(${HEAL.range})), arc=heal(target=${LOWEST})) && follow(${leader}, distance=${keep})`,
		priority: 3,
	};
}

/** Every mistake becomes a law, so it is never made twice. */
const LEARN:Goal = {
	text: 'You MUST learn from every mistake: each failed step, each time you were caught alone or out of place, set one law at once so it never happens again; a wound in a fight is no mistake. One new law per think at most, and none for what a law of yours already covers. When one of your laws turns out bad (it fails, or makes things worse), unlaw it at once. Never make the same mistake twice.',
	priority: 3,
};

/** Game seconds a puzzle may go unsolved before its answer is told: to the solver, and to the leader to pass on. */
const STALL_SECONDS = 60;

/** How `id` gets to where `step` is done: the leader walks in front, everyone else close behind. */
function wayThere(id:string, leader:string, step:Step):string {
	return id === leader
		? `Lead the way in front: go_to(${step.where}), and wait for anyone who falls behind. Once the fight is over and no monster is left near, never lead on into the next room while anyone of the company has less than half their health: wait where you are, tell Seraphine once, briefly, whom to heal, and go on only once they are healed. In a fight, this does not apply: fight.`
		: `Stay close behind ${leader}, never ahead: follow(${leader}).`;
}

/**
 * The leader's quest, while the king lives and once he has fallen. In his room, the room itself says he dies there
 * (`ThroneCrypt`'s memory in the scene).
 */
const QUESTS = {
	king: `Advance from room to room until you reach the ${BOSS}; then kill him and get the treasure. You need not know where he is or how the rooms join: the goal below is always the way on, so never search, recall or ask for the way.`,
	loot: 'Get the treasure.',
};

/**
 * `id`'s goals while `leader` gives the orders, `solver` solves the puzzles, and `step` is next: the step alone and
 * first, since a small model reads a goal below the quest as something for after it. Only the solver is told what a
 * puzzle is, so no one else has an order to give about it, and it works out how by itself, until it has `stalled`:
 * then the solver is told how, and the leader may tell it too. The leader alone carries the quest, above the step.
 */
function roleGoals(id:string, leader:string, solver:string, step:Step, stalled:boolean, quest:keyof typeof QUESTS):Goal[] {
	const way = wayThere(id, leader, step);
	const how = stalled && step.how ? `: ${step.how}` : '';
	const now = !step.puzzle
		? `Now, all together, ${step.text}. ${way}`
		: id === solver
			? `Now, yourself: ${step.text}${how}. Never walk ahead alone into a room with monsters in it.`
			: id === leader && stalled
				? `${way} ${solver} has made no headway for a while: if no monster is near, tell ${solver} once, briefly: ${step.text}${how}.`
				: `${way} ${solver} works on what is there: leave it to ${solver}, never do it, never tell ${solver} how. Keep ${solver} alive.`;
	const orders = id === leader
		? 'You lead by example, not by words: your friends follow you on their own, so never tell anyone to move on or keep close. Give an order only when someone fails their part, like the hurt left unhealed.'
		: `${leader} leads: do what ${leader} orders.`;
	const goals = [{ text: now, priority: 3 }, { text: TALK, priority: 3 }, dangerGoal(id), LEARN, { text: orders, priority: 2 }];
	if (id === 'Seraphine') {
		goals.splice(1, 0, healGoal(leader));
	}
	return id === leader ? [{ text: QUESTS[quest], priority: 4 }, ...goals] : goals;
}

/** The first of `ids` still standing. */
function firstLiving(host:GameHost, ids:string[]):string | undefined {
	return ids.find((id) => isLiving(findObject(host.world, id)));
}

const briefed = new WeakMap<GameHost, { roles:string; step:Step; since:number; stalled:boolean }>();

/**
 * Keep every companion's goals on who leads, who solves, the next step, and whether it has stalled. When the leader
 * or the solver falls, the next in line takes the post, and the company hears it.
 */
function briefCompany(host:GameHost):void {
	const leader = firstLiving(host, LEADERS);
	const solver = firstLiving(host, SOLVERS);
	const step = STEPS.find((s) => !s.done(host));
	if (!leader || !solver || !step) {
		return;
	}
	const roles = `${leader}/${solver}`;
	const before = briefed.get(host);
	const since = step === before?.step ? before.since : Time.time;
	const stalled = Time.time - since >= STALL_SECONDS;
	if (roles === before?.roles && step === before.step && stalled === before.stalled) {
		return;
	}
	briefed.set(host, { roles, step, since, stalled });
	// The king's step is the last before the treasure, so a new step after his is the leader's quest narrowing.
	const quest = isLiving(host.world.findByID(BOSS)) ? 'king' : 'loot';
	for (const id of COMPANY) {
		const persona = host.arc?.character(id)?.persona;
		if (persona) {
			persona.goals = roleGoals(id, leader, solver, step, stalled, quest);
		}
	}
	if (before && roles !== before.roles) {
		host.arc?.pushEvent({ kind: 'Orders', text: `${leader} leads now, and ${solver} solves the puzzles`, who: [], tags: ['company', leader, solver], major: true });
	}
}

/** No companion walks alone where monsters are: each is held within reach of the others while one is near. */
function leashCompany(host:GameHost):void {
	const foes = ():GameObject[] => (HORDE.characters ?? []).map(({ id }) => findObject(host.world, id)).filter(isLiving);
	for (const id of COMPANY) {
		const go = findObject(host.world, id);
		if (isLiving(go)) {
			const leash = go.getOrAddComponent(Leash);
			leash.company = () => company(host);
			leash.foes = foes;
		}
	}
}

/** The last one standing is no team: the pinned memories that hold only for more than one go. */
function forgetTeam(host:GameHost):void {
	const living = COMPANY.filter((id) => isLiving(findObject(host.world, id)));
	const memory = living.length === 1 ? host.arc?.character(living[0])?.persona.memory : undefined;
	for (const record of memory?.pinned().filter((r) => r.tags.includes(TEAM)) ?? []) {
		memory!.remove(record.id);
	}
}

const KNIGHT:CharacterSpec = {
	id: 'Valerius',
	mind: {},
	watchesWritable: false,
	// A knight by title who fights as a Blade: quick stabs and slices, not slow cleaves.
	tags: ['Blade'],
	identity: { role: 'Knight', traits: ['meek', 'brave', 'very strategic', 'soft-spoken', 'terrified of spiders'] },
	goals: roleGoals('Valerius', LEADERS[0], SOLVERS[0], STEPS[0], false, 'king'),
	memories: [
		{
			text: 'I am Valerius, a knight twenty years past my prime, and no boaster: the company is the strength, not me. I swore to Morrigan\'s late mother I would keep the girl alive, and I will. I plan much and say it plainly: I think a step ahead, put each friend where they do best, and give the credit to them. When it comes to it, I stand between my friends and whatever comes. Spiders, though: I will not touch a web.',
			tags: ['backstory', 'Valerius', 'Morrigan', 'spiders'],
			pinned: true,
		},
		...QUEST_MEMORIES,
	],
	laws: [RALLY, GUARD, STRIKE, REGROUP],
};

const HEALER:CharacterSpec = {
	id: 'Seraphine',
	mind: {},
	watchesWritable: false,
	tags: ['Healer'],
	identity: { role: 'Healer', traits: ['warm', 'stern when it matters', 'keeps a tally of every wound she mends', 'hums hymns when afraid'] },
	goals: roleGoals('Seraphine', LEADERS[0], SOLVERS[0], STEPS[0], false, 'king'),
	memories: [
		{
			text: 'I am Seraphine, a healer of the Dawn chapel. I have patched these fools up for six years and I keep a tally of every wound: Valerius owes me forty-one. I scold them for taking risks because I love them. I have the steadiest hands and the clearest head of us, so locks, webs and riddles are mine. I stay behind Valerius in a fight and heal whoever is hurt; I carry two HealthPotion for the worst of it.',
			tags: ['backstory', 'Seraphine', 'HealthPotion'],
			pinned: true,
		},
		...QUEST_MEMORIES,
	],
	laws: [FLEE, MEND, STRIKE, REGROUP],
};

const WITCH:CharacterSpec = {
	id: 'Morrigan',
	mind: {},
	watchesWritable: false,
	tags: ['Witch'],
	identity: { role: 'Witch', traits: ['brilliant', 'cocky', 'sharp-tongued', 'loves riddles', 'braver than she feels', 'hates the very sight of cobwebs'] },
	goals: roleGoals('Morrigan', LEADERS[0], SOLVERS[0], STEPS[0], false, 'king'),
	memories: [
		{
			text: 'I am Morrigan, a fire witch, nineteen and the cleverest person in any room, as I like to remind Valerius. My hex is witchfire. I adore riddles, but the crypt\'s puzzles are Seraphine\'s while she lives. I tease Valerius about spiders, but I would walk into fire for him and Seraphine. I keep my distance in a fight and burn things from behind Valerius.',
			tags: ['backstory', 'Morrigan', 'hex', 'riddle'],
			pinned: true,
		},
		SUCCESSION,
		...QUEST_MEMORIES,
	],
	// No GUARD: protect pulled her into the melee, behind Valerius. She hexes from where she stands.
	laws: [RALLY, STRIKE, REGROUP],
};

/** Who lies in wait, room by room. They have no voice and never think: their one law wakes them. */
const HORDE:CollectiveSpec<CharacterCtx> = {
	id: 'Horde',
	mind: { skipHeartbeat: true, skipMajor: true, skipStart: true, skipStrategic: true },
	watchesWritable: false,
	// No mind of its own, but the fast model picks each blow: it reads how the last went ("missed Valerius") and switches.
	kit: { verbs: ['loop', 'attack', 'choose', 'wander', 'go_to', 'bait'], tools: [] },
	identity: { role: 'Horde', traits: ['undead', 'cunning'] },
	goals: [{ text: 'Kill whoever comes in.', priority: 1 }],
	characters: [
		{ id: 'Ghoul1', tags: ['Knight'] },
		{ id: 'Ghoul2', tags: ['Blade'] },
		{ id: 'BoneArcher1', tags: ['Archer'] },
		{ id: 'Skeleton1', tags: ['Blade'] },
		{ id: 'Skeleton2', tags: ['Blade'] },
		{ id: 'CultWitch', tags: ['Witch'] },
		{ id: BOSS, tags: ['Knight'] },
		{ id: 'BoneArcher2', tags: ['Archer'] },
		{ id: 'Skeleton3', tags: ['Blade'] },
		{ id: 'Ghoul3', tags: ['Knight'] },
	],
	// Whoever comes into its room, it hunts down; seen through a doorway, it lets be. It never leaves its room (`Confine`).
	laws: [{ name: 'wake', who: 'units', watch: `some(${INTRUDERS})`, arc: `loop(${HUNT})`, pinned: true }],
};

/** How each kind of monster is dangerous, by its fight role: what they do, said of more than one. */
const THREATS:Record<string, string> = {
	Knight: 'hit hard up close',
	Blade: 'slash fast up close',
	Archer: 'shoot from afar',
	Witch: 'curse from afar',
};

/** `threat` said of one: `hit hard` → `hits hard`. */
function oneDoes(threat:string):string {
	const [verb, ...rest] = threat.split(' ');
	return [`${verb}${verb.endsWith('sh') ? 'es' : 's'}`, ...rest].join(' ');
}

/**
 * Every room monsters lie in wait in, as a region: whoever of the company stands in it knows which of them still live
 * and how each is dangerous, until the last of them is down. Each monster is kept in its room.
 */
/** The monsters each room starts with, by room name: who stands between the company and that room's step. */
const lairs = new WeakMap<GameHost, Map<string, string[]>>();

function lairsOf(host:GameHost):Map<string, string[]> {
	let rooms = lairs.get(host);
	if (!rooms) {
		rooms = new Map();
		lairs.set(host, rooms);
	}
	return rooms;
}

function addLairs(host:GameHost, director:ArcDirector<CharacterCtx>):void {
	for (const room of host.rooms) {
		const { minX, maxX, minZ, maxZ } = roomBounds(room);
		const lair = (HORDE.characters ?? []).filter(({ id }) => {
			const p = findObject(host.world, id)?.transform.position;
			return !!p && p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ;
		});
		if (lair.length === 0) {
			continue;
		}
		lairsOf(host).set(room.name, lair.map(({ id }) => id));
		for (const { id } of lair) {
			const go = findObject(host.world, id);
			if (go) {
				Object.assign(go.getOrAddComponent(Confine), { minX, maxX, minZ, maxZ });
			}
		}
		const living = ():typeof lair => lair.filter(({ id }) => isLiving(findObject(host.world, id)));
		director.addRegion(`${room.name}Lair`, {
			from: [minX, minZ],
			to: [maxX, maxZ],
			who: ({ character }) => COMPANY.includes(idOf(character)),
			memory: () => {
				// By kind, never by name: "2 ghouls, who hit hard up close".
				const kinds = new Map<string, { count:number; threat:string }>();
				for (const { id, tags } of living()) {
					const kind = id.replace(/\d+$/, '').replace(/(?<=[a-z])(?=[A-Z])/g, ' ').toLowerCase();
					const seen = kinds.get(kind);
					kinds.set(kind, { count: (seen?.count ?? 0) + 1, threat: seen?.threat ?? THREATS[tags?.[0] ?? ''] ?? 'fight' });
				}
				const foes = [...kinds].map(([kind, { count, threat }]) => (count > 1 ? `${count} ${kind}s, who ${threat}` : `1 ${kind}, who ${oneDoes(threat)}`));
				return `Danger: ${foes.join('; ')}. Every one of them must be destroyed before this room is safe: they fight to the death, and one of us caught alone here dies.`;
			},
			until: () => living().length === 0,
		});
	}
}

function openDoor(host:GameHost, name:string, message:string):void {
	const go = host.world.findNamed(name);
	const door = go?.getComponent(Door);
	const lock = go?.getComponent(Lock);
	if (!go || !door || door.open) {
		return;
	}
	if (lock) {
		lock.locked = false;
	}
	door.open = true;
	door.syncCollision();
	cueAt(host.world, 'unlock', go);
	cueAt(host.world, 'doorOpen', go);
	host.world.setMessage(message);
	host.arc?.pushEvent({ kind: 'Opened', text: message, who: [], tags: ['door', name], major: true });
}

/** The company, the player among them while NPCs can see them. */
function company(host:GameHost):GameObject[] {
	const player = host.world.findByID('Player');
	const ids = player && host.world.npcCanSee(player) ? [...COMPANY, 'Player'] : COMPANY;
	return ids.map((id) => findObject(host.world, id)).filter(isLiving);
}

function companyHolds(host:GameHost, name:string):boolean {
	return company(host).some((go) => !!findCarried(go, (it) => itemMatchesName(it, name)));
}

function opened(host:GameHost, name:string):boolean {
	return !!host.world.findNamed(name)?.getComponent(Door)?.open;
}

/** How much of a room's monsters is destroyed, 0 to 1: each one counts alike, the hurt in part. */
function roomCleared(host:GameHost, room:string):number {
	const ids = lairsOf(host).get(room) ?? [];
	const left = ids.map((id) => {
		const vitals = findObject(host.world, id)?.getComponent(Vitals);
		return vitals && vitals.hp > 0 ? vitals.hp / vitals.maxHP : 0;
	});
	return ids.length === 0 ? 0 : 1 - left.reduce((a, b) => a + b, 0) / ids.length;
}

/**
 * The way to the crown on the goal track: each step, filling as its room's monsters fall. They are all but the last
 * share of it; the step itself is the last.
 */
function goals(host:GameHost):SceneGoals {
	return {
		left: { color: 'gold', goals: STEPS.map((step) => {
			const foes = step.room ? lairsOf(host).get(step.room)?.length ?? 0 : 0;
			return {
				name: step.label,
				progress: step.done(host) ? 1 : step.room ? roomCleared(host, step.room) * foes / (foes + 1) : 0,
			};
		}) },
	};
}

function onSpoke(host:GameHost, utterance:SpeechUtterance):void {
	const speaker = findObject(host.world, utterance.speakerID);
	const door = host.world.findNamed('SealedDoor');
	if (!speaker || !door || !ANSWER.test(utterance.text) || distXZ(speaker, door) > ANSWER_REACH) {
		return;
	}
	openDoor(host, 'SealedDoor', 'The riddle is answered. SealedDoor grinds open');
	// Solved, the stone stops asking: nobody keeps answering a riddle behind an open door.
	const stone = host.world.findNamed('RiddleStone')?.getComponent(Inscription);
	if (stone) {
		stone.answered = 'answered; SealedDoor stands open';
	}
}

/** Where the company came down, at the foot of the Gatehouse stairs: where it climbs out again once the crown is won. */
const EXIT = 'Stairs';
const EXIT_AT = { x: 8, z: 44.4 };
/** Game seconds the company celebrates the crown before it heads for the stairs. */
const CELEBRATE = 6;

/** When each scene's company sets off for the stairs, and who of it is on the way out. */
const leaving = new WeakMap<GameHost, { at:number; ids:Set<string> }>();

/** The foot of the stairs, a thing to go_to. */
function spawnExit(host:GameHost):void {
	if (host.world.findNamed(EXIT)) {
		return;
	}
	const go = new GameObject(EXIT, 'Marker');
	go.transform.position.x = EXIT_AT.x;
	go.transform.position.z = EXIT_AT.z;
	go.addComponent(Named, { id: EXIT });
	host.world.add(go);
}

/**
 * Once the celebration is over, every companion still standing stops thinking, drops its laws, and walks to the
 * stairs, where the `Exit` region takes it out of the crypt.
 */
function leaveCrypt(host:GameHost):void {
	const out = leaving.get(host);
	if (!out || Time.time < out.at) {
		return;
	}
	// Once: they are on their way.
	out.at = Infinity;
	for (const id of COMPANY) {
		const character = host.arc?.character(id);
		if (!character || !isLiving(findObject(host.world, id))) {
			continue;
		}
		out.ids.add(id);
		host.arc?.mindQueue()?.setAiOn(id, false);
		character.laws = [];
		void character.enact(parseArc(`go_to(${EXIT})`, character.verbs));
	}
}

/** One of the company reached the stairs on the way out: gone up them. */
function climbOut(host:GameHost, go:GameObject):void {
	const id = idOf(go);
	leaving.get(host)?.ids.delete(id);
	host.arc?.removeCharacter(id);
	host.world.destroy(go);
	if (!COMPANY.some((other) => isLiving(findObject(host.world, other)) && other !== id)) {
		host.world.setMessage(`The company climbs out of the crypt with the ${PRIZE}`);
	}
}

function tickCrypt(host:GameHost):void {
	if (host.bargainDone) {
		leaveCrypt(host);
		return;
	}
	briefCompany(host);
	forgetTeam(host);
	leashCompany(host);
	if (!isLiving(host.world.findByID(BOSS))) {
		openDoor(host, 'HoardGate', `The ${BOSS} falls, and HoardGate swings open`);
	}
	if (!companyHolds(host, PRIZE)) {
		return;
	}
	host.bargainDone = true;
	host.world.setMessage(`The ${PRIZE} is won`);
	for (const go of company(host)) {
		const hop = go.getOrAddComponent(Celebrating);
		hop.until = Time.time + CELEBRATE;
		hop.enabled = true;
	}
	leaving.set(host, { at: Time.time + CELEBRATE, ids: new Set() });
}

export function createDirector(host:GameHost):ArcDirector<CharacterCtx> {
	host.hooks = { checkBargain: tickCrypt, onSpoke, goals };
	spawnExit(host);
	const director = host.configure(new ArcDirector<CharacterCtx>())
		.withRPG({ ...BODY_VERBS, ...fightVerbs(host) })
		// The crypt's own: an overhead status line, and rest once the prize is won.
		.addVerb('set_status', {
			args: { text: 'text', seconds: 'number?' },
			handler: ({ ctx, args }) => {
				const label = args.text.trim().slice(0, 72);
				if (!label) {
					return { ok: false, verb: 'set_status', reason: 'nothing to show' };
				}
				const life = Math.min(60, Math.max(1, args.seconds ?? 6));
				host.labels.set(idOf(ctx.character), { text: label, until: Time.time + life });
				return { ok: true, verb: 'set_status', reason: `${life}s` };
			},
		})
		.addVerb('rest', {
			handler: () => ({ ok: true, verb: 'rest', reason: companyHolds(host, PRIZE) ? 'done — still listening' : 'goal still open' }),
		})
		// A monster's trick: show itself, and once they come after it, draw them onto the rest of its pack.
		.addVerb('bait', {
			args: { target: 'id' },
			help: 'walk up to them; once they come after you, lead them to the nearest of your own kind',
			arc: `go_to({target}) && wait(seconds=6, until=isApproaching({target}, me)) && go_to(${PACK})`,
		})
		.withMindDefaults({ skipStrategic: true })
		// A law stays on at least this long once it starts: a foe just at the edge of a watch no longer flips them every frame.
		.withLawHold(1.5)
		.withDefaultKit({ verbs: [...GAME_VERBS, 'set_status', 'rest', 'attack', 'block', 'heal', 'protect', ...Object.keys(ATTACKS)] })
		.withVerbInstructions(BUILDING_VERB_INSTRUCTIONS)
		// The crypt moves fast: a short think, then the answer.
		.withThinkInstructions({ on: 'Think very quickly, in at most 3 short sentences: what is before you, and what you do now. Then answer.' })
		// Monsters go by what they are; the player is Kaelen, the company's archer.
		.withNames({ seen: (observer, target) => (target.id === 'Player' ? 'Kaelen' : target.id) })
		// Where the company sets out: the leader's pep talk is said here, and the first step away from it ends it.
		.addRegion('Setout', {
			center: [7, 40.6],
			radius: 1.5,
			who: ({ character }) => idOf(character) === LEADERS[0],
			memory: 'We are about to set off: time for my one short pep talk to the company, naming no task.',
		})
		// The foot of the stairs: a companion on its way out who reaches it climbs out of the crypt.
		.addRegion('Exit', {
			center: [EXIT_AT.x, EXIT_AT.z],
			radius: 1,
			who: ({ character }) => !!leaving.get(host)?.ids.has(idOf(character)),
			onEnter: ({ character }) => climbOut(host, character),
		})
		.addCharacter(KNIGHT)
		.addCharacter(HEALER)
		.addCharacter(WITCH)
		.addCollective(HORDE);
	addLairs(host, director);
	return director;
}
