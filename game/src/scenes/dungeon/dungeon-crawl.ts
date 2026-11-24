import { BoxCollider, GameObject, Time, distanceXZ, inBounds } from '@arc-director/kindling';
import { CharacterMotor } from '../../characters/CharacterMotor';
import { parseArc, type ArcDirector, TalkInstructions, type CollectiveSpec, type Goal, type LawSpec, type MemoryDraft, type RegionSpec, type SpeechUtterance, type TalkStyle } from 'arc-director';
import { Confine } from '../../characters/Confine';
import { Leash } from '../../characters/Leash';
import { Celebrating, Lock, Named, Vitals, idOf } from '../../engine/components';
import { findCarried, itemMatchesName } from '../../items/inventory';
import type { GameHost } from '../../director/adapter';
import { ATTACKS, HEAL } from '../../director/fight';
import { findObject, isLiving } from '../../director/names';
import { BODY_VERBS, BUILDING_VERB_INSTRUCTIONS, GAME_VERBS } from '../../director/game-verbs';
import { fightVerbs } from '../../director/fight-verbs';
import { roomBounds, type NPCSpawnDef } from '../../world/spawn';
import { STAFF, SWORD, lived, mindsOf, type CastMember, type SceneCast } from '../scene';
import type { CharacterCtx, SceneGoals, SceneHooks } from '../../director/game-types';
import { Door } from '../../kit/door/door';
import { Inscription } from '../../kit/inscription/inscription';

const PRIZE = 'SunCrown';

/** Someone in the crypt at map cell `x`, `z`. */
function delver(meshID:string, x:number, z:number, hp:number, extra:Partial<NPCSpawnDef> = {}):Omit<NPCSpawnDef, 'id'> {
	return { meshID, cell: [x, z], hp, ...extra };
}

/**
 * A monster of the Horde, as dangerous as its fight role says. Only the CultWitch and the HollowKing are quick enough to
 * dodge; the rest take every blow that reaches them.
 */
function monster(id:string, role:string, meshID:string, x:number, z:number, hp:number, extra:Partial<NPCSpawnDef> = {}):CastMember {
	return { id, tags: [role], of: 'Horde', body: delver(meshID, x, z, hp, { evasive: false, ...extra }) };
}

const BONE_BOW = ['bone_bow'];

const KING = monster('HollowKing', 'Knight', 'SkeletonKing', 54, 11, 36, {
	evasive: true,
	yaw: Math.PI,
	equip: SWORD,
	weakness: { to: ['hex'], times: 3, others: 0.5 },
	// A dead king: the lowest voice here, slow and flat.
	voice: { pitch: 140, rate: 3.8, range: 0.4 },
});
const BOSS = KING.id;

/** The Horde's monsters, room by room. */
const MONSTERS:CastMember[] = [
	// Pillared Hall.
	monster('Ghoul1', 'Knight', 'Ghoul', 10, 17, 16),
	monster('Ghoul2', 'Blade', 'Ghoul', 13, 21, 10),
	monster('BoneArcher1', 'Archer', 'SkeletonArcher', 16, 13, 8, { equip: BONE_BOW }),
	// Ossuary.
	monster('Skeleton1', 'Blade', 'SkeletonWarrior', 31, 19, 8, { equip: SWORD }),
	monster('Skeleton2', 'Blade', 'SkeletonWarrior', 37, 19, 8, { equip: SWORD }),
	monster('CultWitch', 'Witch', 'Sorceress', 34, 15, 8, { evasive: true, equip: STAFF }),
	// Throne Crypt.
	KING,
	monster('BoneArcher2', 'Archer', 'SkeletonArcher', 56, 11, 8, { yaw: Math.PI, equip: BONE_BOW }),
	monster('Skeleton3', 'Blade', 'SkeletonWarrior', 50, 20, 8, { equip: SWORD }),
	monster('Ghoul3', 'Knight', 'Ghoul', 59, 20, 14),
];

/** The riddle's answer, as people say it. Spoken this close to SealedDoor, it opens. */
const ANSWER = /\bfoot\s?(steps?|prints?)\b/i;
const ANSWER_REACH = 6;

const FOES_NEAR = 'some(others.filter("enemy").nearby(9))';
const ALLIES = 'others.filter(u => !(u is "enemy"))';
/** The party in a monster's own room. */
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

/** A fighter of the party strikes back the moment a monster is in sight, whatever it was doing. */
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
	// A law runs to its end once started, so the cast goes through.
	arc: `heal(target=${LOWEST})`,
	pinned: true,
};

/** Tags the pinned memories that only hold while the party is more than one. */
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
 * and the rest stood still. It follows until no one is left to catch up with (a follow in a law ends with its trigger).
 * Last, so a fight, a flight or a heal still comes first.
 */
const REGROUP:LawSpec = {
	name: 'regroup',
	who: 'me',
	watch: `some(${LEAVING})`,
	arc: `follow(target=${LEAVING}.minBy(u => distance(me, u)), distance=4)`,
	pinned: true,
};

/**
 * What the whole party knows going in. The crypt has no name to go_to and its rooms are not places to go_to, so
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
		tags: ['Kaelen', 'party'],
		pinned: true,
	},
	{
		text: 'We are a team and never go anywhere alone. Whoever leads walks in front, into every new room first; the rest follow close behind. Nobody walks off ahead, not even to solve a puzzle.',
		tags: [TEAM, 'together'],
		pinned: true,
	},
];

/** Morrigan is next in line to lead. */
const SUCCESSION:MemoryDraft = {
	text: 'I am next in line: if Valerius falls, I lead the party in his place.',
	tags: [TEAM, 'succession'],
	pinned: true,
};

/**
 * A step on the way to the crown: where it is done and what is to be done there; `label` is what the goal track says of
 * it. `how` makes it a puzzle, anyone's to solve, and is its answer, told only once it has stalled: until then the
 * party works it out. `room` is the room it is done in, whose monsters stand in the way of it. `gather` sends each of the
 * party there on its own instead of behind its leader.
 */
type Step = { done:(host:GameHost)=>boolean; where:string; text:string; how?:string; room?:string; gather?:boolean; label:string };

/** The way to the crown, in order. The first step not done is the party's one goal, so nobody has to ask where to go. */
const STEPS:Step[] = [
	{ done: (host) => !host.world.findNamed('Cobweb'), where: 'Cobweb', text: 'get past Cobweb', label: 'Destroy the cobweb', how: 'pick_up(WoodenTorch) && use(item=WoodenTorch, target=Cobweb)' },
	{ done: (host) => opened(host, 'SealedDoor'), where: 'SealedDoor', room: 'PillaredHall', text: 'open SealedDoor', label: 'Solve the riddle at SealedDoor', how: 'read the riddle on RiddleStone beside it, work out the one thing it describes, and say that thing aloud' },
	{ done: (host) => opened(host, 'CryptGate') || partyHolds(host, 'CryptKey'), where: 'OssuaryChest', room: 'Ossuary', text: 'find CryptKey', label: 'Find CryptKey in the Ossuary', how: 'pick_up(item=CryptKey, from=OssuaryChest)' },
	{ done: (host) => opened(host, 'CryptGate'), where: 'CryptGate', text: 'open CryptGate', label: 'Unlock CryptGate', how: 'use(item=CryptKey, target=CryptGate)' },
	{ done: (host) => !isLiving(host.world.findByID(BOSS)), where: BOSS, room: 'ThroneCrypt', text: `kill the ${BOSS}`, label: `Slay the ${BOSS}` },
	// Won for good once the party is on its way out: gone up the stairs, nobody here holds it.
	{ done: (host) => host.sceneState().bargainDone || partyHolds(host, PRIZE), where: 'HoardChest', text: `take the ${PRIZE}`, label: `Claim the ${PRIZE}`, how: `pick_up(item=${PRIZE}, from=HoardChest)` },
];

/** Meters from a fallen companion's body within which a line said is said over it. */
const FAREWELL_REACH = 5;

/** The companions lying dead in the crypt (not those gone up the stairs). */
function fallen(host:GameHost):string[] {
	return PARTY.filter((id) => {
		const go = findObject(host.world, id);
		return !!go && !isLiving(go);
	});
}

/** Lines said over a fallen companion's body, by anyone, that end its farewell. */
const FAREWELL_LINES = 2;

/** Once the crown is won, the last step before the stairs: `FAREWELL_LINES` lines said over `id`'s body. */
function farewell(id:string):Step {
	return {
		done: (host) => (host.sceneState<Crawl>().mourned?.[id]?.length ?? 0) >= FAREWELL_LINES,
		where: id,
		text: `bid ${id} farewell: gather by the body, and say a line or two over it to them, a last word or a memory of them, never a prayer. Like: say(text="...", to=${id})`,
		gather: true,
		label: `Bid ${id} farewell`,
	};
}

/** The way out of the crypt, in order: the way to the crown, then a farewell to each companion who fell on it. */
function steps(host:GameHost):Step[] {
	return [...STEPS, ...fallen(host).map(farewell)];
}

/** How sad a companion's death makes any of the party, however little they loved them; love makes it more. */
const GRIEF = 0.4;

/**
 * A companion just fell: every survivor knows at once, wherever it is (the fall's own news reaches only who sees it,
 * and this one takes its place), wakes to it, and grieves as much as it loved them.
 */
function heedFalls(host:GameHost):void {
	const state = host.sceneState<Crawl>();
	const news = fallen(host).filter((id) => !state.dead?.includes(id));
	const arc = host.arc;
	if (news.length === 0 || !arc) {
		return;
	}
	state.dead = [...state.dead ?? [], ...news];
	const living = PARTY.filter((id) => isLiving(findObject(host.world, id)));
	for (const id of news) {
		arc.pushEvent({ kind: 'Hurt', key: `fallen:${id}`, text: (name) => `${name(id)} has fallen`, knownBy: living, tags: ['fallen'], major: true });
		for (const other of living) {
			const love = arc.character(other)?.persona.memory.feelingsToward(arc.time).get(id)?.loving ?? 0;
			arc.getFeelings()?.stir(other, { sad: Math.max(GRIEF, love) });
		}
	}
}

/** A survivor said `utterance` once the crown is won: a line over each fallen companion's body it stands by. */
function mourn(host:GameHost, utterance:SpeechUtterance):void {
	const speaker = findObject(host.world, utterance.speakerID);
	if (!PARTY.includes(utterance.speakerID) || !isLiving(speaker) || !STEPS.every((s) => s.done(host))) {
		return;
	}
	const mourned = host.sceneState<Crawl>().mourned ??= {};
	for (const id of fallen(host)) {
		const body = findObject(host.world, id)!;
		if (distanceXZ(speaker, body) <= FAREWELL_REACH && (mourned[id]?.length ?? 0) < FAREWELL_LINES) {
			(mourned[id] ??= []).push(utterance.speakerID);
		}
	}
}

const NEAREST_FOE = 'others.filter("enemy").minBy(u => distance(me, u))';

/** Alone with monsters: cry for help and run to the nearest ally, wherever they are. */
const HELP_LAW = `law(name=help, watch=some(others.filter("enemy").nearby(9)) && !some(${ALLIES}.nearby(8))) {
	say(text="Help! Monsters!", as=scream)
	go_to(${ALLIES}.minBy(u => distance(me, u)))
}`;

/** How `id` meets danger: a choose law of its own, and one for being caught alone, set before it comes. */
function dangerGoal(id:string):Goal {
	const shield = id === KNIGHT.id ? ' Draw their fire and shield the others: protect the weakest, block, strike.' : '';
	return {
		text: `Set two laws for danger before it comes, and keep them; your laws act without a think. One to fight it, a choose law.${shield} Like:\n${DANGER_LAWS[id]}\nAnd one for when you see monsters but none of your allies: scream for help and run to the nearest ally. Like:\n${HELP_LAW}`,
		priority: 3,
	};
}

/** How the party talks: banter, never of the quest everyone knows. Orders stay the leader's, and only when needed. */
const TALK:TalkStyle = { instructions: TalkInstructions.Banter, avoid: ['the crown', 'the treasure', 'the quest'] };

/** The healer keeps within heal reach of the leader, and heals the lowest first whenever someone near is hurt. */
function healGoal(leader:string):Goal {
	const keep = HEAL.range - 2;
	return {
		text: `Always heal whoever has the lowest health first, yourself included, but do not heal anyone who already has full health like 50/50. Right before you heal, stay within heal reach (${HEAL.range}m): follow with a distance, and let a when heal from there. Like:\nwhen(isHurt(me) || some(${ALLIES}.filter(u => isHurt(u)).nearby(${HEAL.range}))) {\n\theal(target=${LOWEST})\n}\nfollow(${leader}, distance=${keep})`,
		priority: 3,
	};
}

/**
 * How the party works as one: each room cleared, its puzzles talked over, and a friend in danger warned with a shout,
 * which wakes whoever hears it, and acted on at once.
 */
function teamworkGoal(id:string):Goal {
	const friend = PARTY.find((other) => other !== id);
	return {
		text: `Clear every room of its monsters before you go on, and solve its puzzles together: for a hard one, say what you notice and what you think the answer is, and build on what the others say. The moment you see a friend in danger, shout a warning to them at once. Like: say(text="Behind you!", to=${friend}, as=shout) When a friend shouts a warning at you, act on it at once, before anything else.`,
		priority: 3,
	};
}

/** Every mistake becomes a law, so it is never made twice. */
const LEARN:Goal = {
	text: 'You MUST learn from every mistake: each failed step, each time you were caught alone or out of place, set one law at once so it never happens again; a wound in a fight is no mistake. One new law per think at most, and none for what a law of yours already covers. When one of your laws turns out bad (it fails, or makes things worse), unlaw it at once. Never make the same mistake twice.',
	priority: 3,
};

/** Game seconds a puzzle may go unsolved before its answer is told to the party. */
const STALL_SECONDS = 60;

/** How `id` gets to where `step` is done: the leader walks in front, everyone else close behind; to a gathering, each its own way. */
function wayThere(id:string, leader:string, step:Step):string {
	if (step.gather) {
		return `Each of you go_to(${step.where}) yourself, and stay there until it is done.`;
	}
	return id === leader
		? `Lead the way in front: go_to(${step.where}), and wait for anyone who falls behind. Once the fight is over and no monster is left near, never lead on into the next room while anyone of the party has less than half their health: wait where you are, tell Seraphine once, briefly, whom to heal, and go on only once they are healed. In a fight, this does not apply: fight.`
		: `Stay close behind ${leader}, never ahead: follow(${leader}); ${leader} leads you to ${step.where}, so never go_to it yourself.`;
}

/**
 * The leader's quest, while the king lives and once he has fallen. In his room, the room itself says he dies there
 * (`ThroneCrypt`'s memory in the scene).
 */
const QUESTS = {
	king: `Advance from room to room until you reach the ${BOSS}; then kill him and get the treasure. You need not know where he is or how the rooms join: the goal below is always the way on, so never search, recall or ask for the way.`,
	loot: 'Get the treasure.',
	mourn: 'The treasure is ours. Before we leave the crypt, we bid our fallen farewell.',
};

/**
 * `id`'s goals while `leader` gives the orders and `step` is next: the step alone and first, since a small model reads
 * a goal below the quest as something for after it. A puzzle is anyone's: whoever sees how solves it, and the party
 * works out how by itself until it has `stalled`, when everyone is told. The leader alone carries the quest, above the
 * step.
 */
function roleGoals(id:string, leader:string, step:Step, stalled:boolean, quest:keyof typeof QUESTS):Goal[] {
	const how = stalled && step.how ? `: ${step.how}` : '';
	const anyone = step.how ? ' Any of you may do it, once there: whoever sees how does it, and asks for what they lack.' : '';
	const now = `Now, all together, ${step.text}${how}. ${wayThere(id, leader, step)}${anyone}`;
	const orders = id === leader
		? 'You lead by example, not by words: your friends follow you on their own, so never tell anyone to move on or keep close. Give an order only when someone fails their part, like the hurt left unhealed.'
		: `${leader} leads: do what ${leader} orders.`;
	const goals = [{ text: now, priority: 3 }, dangerGoal(id), teamworkGoal(id), LEARN, { text: orders, priority: 2 }];
	if (id === HEALER.id) {
		goals.splice(1, 0, healGoal(leader));
	}
	return id === leader ? [{ text: QUESTS[quest], priority: 4 }, ...goals] : goals;
}

/** The first of `ids` still standing. */
function firstLiving(host:GameHost, ids:string[]):string | undefined {
	return ids.find((id) => isLiving(findObject(host.world, id)));
}

/**
 * What the crawl keeps as it runs, saved with the game: who leads toward which step (its index in `steps`), since when
 * and whether it has stalled; which companions' deaths the party has heard of, and who said each line over each body;
 * and once the way is done, when the party sets off for the stairs (`null` once it has) and who of it is on the way out.
 */
type Crawl = {
	briefed:{ leader:string; step:number; since:number; stalled:boolean };
	dead?:string[];
	mourned?:Record<string, string[]>;
	leaving:{ at:number | null; ids:string[] };
};

/**
 * Keep every companion's goals on who leads, the next step, and whether it has stalled. When the leader falls, the
 * next in line takes the lead, and the party hears it.
 */
function briefParty(host:GameHost):void {
	const leader = firstLiving(host, LEADERS);
	const way = steps(host);
	const at = way.findIndex((s) => !s.done(host));
	const step = way[at];
	if (!leader || !step) {
		return;
	}
	const state = host.sceneState<Crawl>();
	const before = state.briefed;
	const since = at === before?.step ? before.since : Time.time;
	const stalled = Time.time - since >= STALL_SECONDS;
	if (leader === before?.leader && at === before.step && stalled === before.stalled) {
		return;
	}
	state.briefed = { leader, step: at, since, stalled };
	// The king's step is the last before the treasure, so a new step after his is the leader's quest narrowing.
	const quest = isLiving(host.world.findByID(BOSS)) ? 'king' : partyHolds(host, PRIZE) ? 'mourn' : 'loot';
	for (const id of PARTY) {
		const persona = host.arc?.character(id)?.persona;
		if (persona) {
			persona.goals = roleGoals(id, leader, step, stalled, quest);
		}
	}
	if (before && leader !== before.leader) {
		host.arc?.pushEvent({ kind: 'Orders', text: `${leader} leads now`, who: [], tags: ['party', leader], major: true });
	}
}

/** No companion walks alone where monsters are: each is held within reach of the others while one is near. */
function leashParty(host:GameHost):void {
	const foes = ():GameObject[] => (HORDE.characters ?? []).map(({ id }) => findObject(host.world, id)).filter(isLiving);
	for (const id of PARTY) {
		const go = findObject(host.world, id);
		if (isLiving(go)) {
			const leash = go.getOrAddComponent(Leash);
			leash.party = () => party(host);
			leash.foes = foes;
		}
	}
}

/** The last one standing is no team: the pinned memories that hold only for more than one go. */
function forgetTeam(host:GameHost):void {
	const living = PARTY.filter((id) => isLiving(findObject(host.world, id)));
	const memory = living.length === 1 ? host.arc?.character(living[0])?.persona.memory : undefined;
	for (const record of memory?.pinned().filter((r) => r.tags.includes(TEAM)) ?? []) {
		memory!.remove(record.id);
	}
}

/**
 * The party, in the Gatehouse. Their goals come with the cast (`DUNGEON_CAST`). Seraphine has loved Valerius for years; he
 * has not the faintest idea, and Morrigan has noticed. Kaelen, the party's archer, is the player.
 */
export const KNIGHT:CastMember = {
	id: 'Valerius',
	body: delver('KnightMale', 8, 40.9, 90, { yaw: 0, streams: true, equip: SWORD, moves: ['cleave'] }),
	mind: {},
	watchesWritable: false,
	// A knight by title who fights as a Blade: quick stabs and slices, not slow cleaves.
	tags: ['Blade'],
	identity: { role: 'Knight', traits: ['meek', 'brave', 'very strategic', 'soft-spoken', 'terrified of spiders'] },
	talk: TALK,
	memories: [
		{
			text: 'I am Valerius, a knight twenty years past my prime, and no boaster: the party is the strength, not me. I swore to Morrigan\'s late mother I would keep the girl alive, and I will. I plan much and say it plainly: I think a step ahead, put each friend where they do best, and give the credit to them. When it comes to it, I stand between my friends and whatever comes. Spiders, though: I will not touch a web.',
			tags: ['backstory', 'Valerius', 'Morrigan', 'spiders'],
			pinned: true,
		},
		...QUEST_MEMORIES,
		lived((name) => `I held the hand of ${name('Morrigan')}'s mother as she died, and I swore on my sword I would keep her girl alive.`, { loving: 0.8, sad: 0.6 }),
		lived((name) => `A cave spider as big as a hound dragged my squire Tobin into the dark at Blackmere, and my legs would not move. Every ${name('Cobweb')} brings back his call.`, { afraid: 0.9, sad: 0.7 }),
		lived((name) => `${name('Seraphine')} sat up with me three nights when the marsh fever took me. A truer friend I never had.`, { loving: 0.5, happy: 0.4 }),
		lived((name) => `${name('Seraphine')} tucked a sprig of heather into my glove before the Ashford fight. Healers and their herbs: it kept the moths off, I suppose.`, { happy: 0.3 }),
		lived((name) => `${name('Player')} and I held the old bridge at Farrow a whole night, back to back, and laughed about it at dawn.`, { loving: 0.5, stressed: 0.6 }),
	],
	laws: [RALLY, GUARD, STRIKE, REGROUP],
};

export const HEALER:CastMember = {
	id: 'Seraphine',
	body: delver('Shaman', 6, 41, 50, { yaw: 0, streams: true, equip: ['shaman_staff'], packLoot: [{ defID: 'health_potion', name: 'HealthPotion', count: 2 }] }),
	mind: {},
	watchesWritable: false,
	tags: ['Healer'],
	identity: { role: 'Healer', traits: ['warm', 'stern when it matters', 'keeps a tally of every wound she mends', 'hums hymns when afraid'] },
	talk: TALK,
	memories: [
		{
			text: 'I am Seraphine, a healer of the Dawn chapel. I have patched these fools up for six years and I keep a tally of every wound: Valerius owes me forty-one. I scold them for taking risks because I love them. I have the steadiest hands and the clearest head of us. I stay behind Valerius in a fight and heal whoever is hurt; I carry two HealthPotion for the worst of it.',
			tags: ['backstory', 'Seraphine', 'HealthPotion'],
			pinned: true,
		},
		...QUEST_MEMORIES,
		lived((name) => `${name('Valerius')} gave me his cloak in the snow at Harrowpass and never asked for it back. I still sleep under it.`, { loving: 0.9 }),
		lived((name) => `I tucked a sprig of heather into ${name('Valerius')}'s glove before the Ashford fight, and he thanked me for keeping the moths off. He has no idea.`, { loving: 0.8, sad: 0.3 }),
		lived((name) => `When ${name('Valerius')} fell at the ford, my hands shook for the first time in six years of healing.`, { afraid: 0.8, loving: 0.7 }),
		lived((name) => `${name('Morrigan')} set my apron alight with her very first hex and laughed until she cried. So did I.`, { happy: 0.8, loving: 0.4 }),
		lived('I lost a little girl to the gray fever at the chapel, and no prayer of mine could hold her.', { sad: 0.8 }),
	],
	laws: [FLEE, MEND, STRIKE, REGROUP],
};

export const WITCH:CastMember = {
	id: 'Morrigan',
	body: delver('Witch', 7, 40, 50, { yaw: 0, streams: true, equip: STAFF }),
	mind: {},
	watchesWritable: false,
	tags: ['Witch'],
	identity: { role: 'Witch', traits: ['brilliant', 'cocky', 'sharp-tongued', 'loves riddles', 'braver than she feels', 'hates the very sight of cobwebs'] },
	talk: TALK,
	memories: [
		{
			text: 'I am Morrigan, a fire witch, nineteen and the cleverest person in any room, as I like to remind Valerius. My hex is witchfire. I adore riddles. I tease Valerius about spiders, but I would walk into fire for him and Seraphine. I keep my distance in a fight and burn things from behind Valerius.',
			tags: ['backstory', 'Morrigan', 'hex', 'riddle'],
			pinned: true,
		},
		SUCCESSION,
		...QUEST_MEMORIES,
		lived('My mother taught me witchfire by candlelight, the winter before the sickness took her.', { sad: 0.6, loving: 0.8 }),
		lived((name) => `${name('Valerius')} once fled from a spider the size of a coin, and I will never let him forget it.`, { happy: 0.8, loving: 0.4 }),
		lived((name) => `${name('Seraphine')} hums louder whenever ${name('Valerius')} walks past. She is sweet on him, and the great oaf has not noticed a thing.`, { happy: 0.6 }),
		lived('I burned down the old library at Vell showing off a hex. Nobody knows it was me.', { sad: 0.6, stressed: 0.6 }),
		lived((name) => `${name('Player')} shot an apple off my head on a dare, and I never told anyone my knees were shaking.`, { stressed: 0.6, happy: 0.6 }),
	],
	// No GUARD: protect pulled her into the melee, behind Valerius. She hexes from where she stands.
	laws: [RALLY, STRIKE, REGROUP],
};

const COMPANIONS = [KNIGHT, HEALER, WITCH];
const PARTY = COMPANIONS.map(({ id }) => id);
/** Who gives the orders: the first still standing. */
const LEADERS = [KNIGHT.id, WITCH.id];

/** The choose law each companion is asked to set for danger, in its own idiom: the fast model picks each reaction. */
const DANGER_LAWS:Record<string, string> = {
	[KNIGHT.id]: dangerLaw('shield', 'Draw their fire off my friends', ['guard: protect()', 'block: block()', 'strike: attack()']),
	[HEALER.id]: dangerLaw('mend', 'Keep everyone alive', ['heal: heal()', `back_off: flee(${NEAREST_FOE}, distance=6)`, 'strike: attack()']),
	[WITCH.id]: dangerLaw('burn', 'Burn them from behind Valerius', ['weakest: hex(others.filter("enemy").minBy(u => u.hp))', `nearest: hex(${NEAREST_FOE})`, `back_off: flee(${NEAREST_FOE}, distance=6)`]),
};

/** A law `name` that keeps choosing among `choices` while foes are near, laid out in indented blocks. */
function dangerLaw(name:string, goal:string, choices:string[]):string {
	return `law(name=${name}, watch=${FOES_NEAR}) {\n\tloop {\n\t\tchoose("${goal}") {\n${choices.map((choice) => `\t\t\t${choice}\n`).join('')}\t\t}\n\t}\n}`;
}

/** The party and Kaelen (`Player`), years on the road together: each knows the others' voices too. */
const OLD_FRIENDS = Object.fromEntries([...PARTY, 'Player'].map((id) => [id, true as const]));

/** Everyone in the crypt but Kaelen: the party, each set on the first step behind its leader, and the Horde. */
export const DUNGEON_CAST:SceneCast = [
	...COMPANIONS.map((member) => ({ ...member, knows: OLD_FRIENDS, goals: roleGoals(member.id, LEADERS[0], STEPS[0], false, 'king') })),
	...MONSTERS,
];

/** Who lies in wait, room by room. They have no voice and never think: their one law wakes them. */
const HORDE:CollectiveSpec<CharacterCtx> = {
	id: 'Horde',
	mind: { rethinkingThreshold: 0, skipMajor: true, skipStart: true, skipStrategic: true },
	watchesWritable: false,
	// No mind of its own, but the fast model picks each blow: it reads how the last went ("missed Valerius") and switches.
	kit: { verbs: ['loop', 'attack', 'choose', 'wander', 'go_to', 'bait'], tools: [] },
	identity: { role: 'Horde', traits: ['undead', 'cunning'] },
	goals: [{ text: 'Kill whoever comes in.', priority: 1 }],
	characters: mindsOf(MONSTERS, 'Horde'),
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

/** The monsters room `name` starts with: who stands between the party and that room's step. */
function lairOf(host:GameHost, name:string):CastMember[] {
	const room = host.scene.rooms?.find((r) => r.name === name);
	const bounds = room && roomBounds(room);
	return bounds ? MONSTERS.filter(({ body: { cell: [x, z] } }) => inBounds(bounds, x + 0.5, z + 0.5)) : [];
}

/** Each room the horde starts in, as a lair: its monsters kept in it, and a region warning the party of them. */
function lairRegions(host:GameHost):Record<string, RegionSpec<CharacterCtx>> {
	const regions:Record<string, RegionSpec<CharacterCtx>> = {};
	for (const room of host.scene.rooms ?? []) {
		const bounds = roomBounds(room);
		const { minX, maxX, minZ, maxZ } = bounds;
		const lair = lairOf(host, room.name);
		if (lair.length === 0) {
			continue;
		}
		for (const { id } of lair) {
			const go = findObject(host.world, id);
			if (go) {
				go.getOrAddComponent(Confine).bounds = bounds;
			}
		}
		const living = ():typeof lair => lair.filter(({ id }) => isLiving(findObject(host.world, id)));
		regions[`${room.name}Lair`] = {
			from: [minX, minZ],
			to: [maxX, maxZ],
			who: ({ character }) => PARTY.includes(idOf(character)),
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
		};
	}
	return regions;
}

function openDoor(host:GameHost, name:string, message:string):void {
	const go = host.world.findNamed(name);
	const door = go?.getComponent(Door);
	if (!go || !door || door.open) {
		return;
	}
	door.setOpen(true, true);
	host.world.setMessage(message);
	host.arc?.pushEvent({ kind: 'Opened', text: message, who: [], tags: ['door', name], major: true });
}

/** The party, the player among them while NPCs can see them. */
function party(host:GameHost):GameObject[] {
	const player = host.world.findByID('Player');
	const ids = player && host.world.npcCanSee(player) ? [...PARTY, 'Player'] : PARTY;
	return ids.map((id) => findObject(host.world, id)).filter(isLiving);
}

/** Each of the party always knows what the others carry, so whoever holds what a puzzle takes is asked for it. */
function knowsCarried(host:GameHost, viewer:GameObject, holder:GameObject):boolean | undefined {
	const members = party(host);
	return (members.includes(viewer) && members.includes(holder)) || undefined;
}

function partyHolds(host:GameHost, name:string):boolean {
	return party(host).some((go) => !!findCarried(go, (it) => itemMatchesName(it, name)));
}

/** Open, or unlocked: a walker shuts an unlocked door behind it, and anyone opens it again. */
function opened(host:GameHost, name:string):boolean {
	const go = host.world.findNamed(name);
	return !!go?.getComponent(Door)?.open || go?.getComponent(Lock)?.locked === false;
}

/** How much of a room's monsters is destroyed, 0 to 1: each one counts alike, the hurt in part. */
function roomCleared(host:GameHost, room:string):number {
	const ids = lairOf(host, room).map(({ id }) => id);
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
		left: { color: 'gold', goals: steps(host).map((step) => {
			const foes = step.room ? lairOf(host, step.room).length : 0;
			return {
				name: step.label,
				progress: step.done(host) ? 1 : step.room ? roomCleared(host, step.room) * foes / (foes + 1) : 0,
			};
		}) },
	};
}

function onSpoke(host:GameHost, utterance:SpeechUtterance):void {
	mourn(host, utterance);
	const speaker = findObject(host.world, utterance.speakerID);
	const door = host.world.findNamed('SealedDoor');
	if (!speaker || !door || !ANSWER.test(utterance.text) || distanceXZ(speaker, door) > ANSWER_REACH) {
		return;
	}
	openDoor(host, 'SealedDoor', 'The riddle is answered. SealedDoor grinds open');
	// Solved, the stone stops asking: nobody keeps answering a riddle behind an open door.
	const stone = host.world.findNamed('RiddleStone')?.getComponent(Inscription);
	if (stone) {
		stone.answered = 'answered; SealedDoor stands open';
	}
}

/** Where the party came down, at the foot of the Gatehouse stairs: where it climbs out again once the crown is won. */
const EXIT = 'Stairs';
const EXIT_AT = { x: 8, z: 44.4 };
/**
 * Meters from the foot of the stairs within which one on the way out starts up them: a `go_to` stops at reach, and
 * the party crowds round the spot.
 */
const EXIT_REACH = 3;
/** Up the stairwell, past its top step: where a climber heads. */
const STAIRS_TOP = { x: 8.5, z: 46.8 };
/** How far up the stairwell a climber is gone under its ceiling. */
const CLIMBED_Z = 45.9;
/** Game seconds the party celebrates the crown before it heads for the stairs. */
const CELEBRATE = 6;

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
	const out = host.sceneState<Crawl>().leaving;
	if (!out || out.at === null || Time.time < out.at) {
		return;
	}
	// Once: they are on their way.
	out.at = null;
	for (const id of PARTY) {
		const character = host.arc?.character(id);
		if (!character || !isLiving(findObject(host.world, id))) {
			continue;
		}
		out.ids.push(id);
		host.arc?.queue.setAiOn(id, false);
		character.laws = [];
		void character.enact(parseArc(`go_to(${EXIT})`, character.verbs));
	}
}

/**
 * One of the party reached the stairs on the way out: no longer a mind, it walks up them, through the stairwell's rock
 * walls (nothing else can reach them), until `goneUp` takes it.
 */
function climbOut(host:GameHost, go:GameObject):void {
	host.arc?.removeCharacter(idOf(go));
	go.getComponent(BoxCollider)!.solid = false;
	go.getComponent(CharacterMotor)!.destinationPoint = STAIRS_TOP;
}

/** Whoever has climbed out of sight under the stairwell's ceiling is gone; the last one out says the party has left. */
function goneUp(host:GameHost):void {
	const out = host.sceneState<Crawl>().leaving!;
	const up = out.ids.filter((id) => (findObject(host.world, id)?.transform.position.z ?? Infinity) >= CLIMBED_Z);
	if (up.length === 0) {
		return;
	}
	up.forEach((id) => {
		const go = findObject(host.world, id);
		if (go) {
			host.world.destroy(go);
		}
	});
	out.ids = out.ids.filter((id) => !up.includes(id));
	if (out.ids.length === 0) {
		host.world.setMessage(`The party climbs out of the crypt with the ${PRIZE}`);
	}
}

function tickCrypt(host:GameHost):void {
	if (host.sceneState().bargainDone) {
		leaveCrypt(host);
		goneUp(host);
		return;
	}
	heedFalls(host);
	briefParty(host);
	forgetTeam(host);
	leashParty(host);
	if (!isLiving(host.world.findByID(BOSS))) {
		openDoor(host, 'HoardGate', `The ${BOSS} falls, and HoardGate swings open`);
	}
	// The crown won and every fallen friend bid farewell: the stairs, after a cheer if nobody fell.
	if (!steps(host).every((step) => step.done(host))) {
		return;
	}
	host.sceneState().bargainDone = true;
	host.world.setMessage(`The ${PRIZE} is won`);
	const cheer = fallen(host).length === 0 ? CELEBRATE : 0;
	if (cheer) {
		for (const go of party(host)) {
			go.getOrAddComponent(Celebrating).celebrateFor(cheer);
		}
	}
	host.sceneState<Crawl>().leaving = { at: Time.time + cheer, ids: [] };
}

export const DUNGEON_HOOKS:SceneHooks<GameHost> = { tick: tickCrypt, onSpoke, goals, canSeeInventoryOf: knowsCarried };

/** The horde, the crypt's own verbs and its rooms, onto the host's director. */
export function directDungeon(host:GameHost, director:ArcDirector<CharacterCtx, GameObject>):ArcDirector<CharacterCtx, GameObject> {
	spawnExit(host);
	return director
		.withRPG({ ...BODY_VERBS, ...fightVerbs(host) })
		// The crypt's own: an overhead status line, and rest once the prize is won.
		.withVerbs((v) => v
			.add('set_status', {
				args: { text: 'text', seconds: 'number?' },
				handler: ({ ctx, args }) => {
					const label = args.text.trim().slice(0, 72);
					if (!label) {
						return { status: 'failed', verb: 'set_status', reason: 'nothing to show' };
					}
					const life = Math.min(60, Math.max(1, args.seconds ?? 6));
					host.labels.set(idOf(ctx.character), { text: label, until: Time.time + life });
					return { status: 'ok', verb: 'set_status', reason: `${life}s` };
				},
			})
			.add('rest', {
				handler: () => ({ status: 'ok', verb: 'rest', reason: partyHolds(host, PRIZE) ? 'done — still listening' : 'goal still open' }),
			})
			// A monster's trick: show itself, and once they come after it, draw them onto the rest of its pack.
			.addAlias('bait', {
				args: { target: 'id' },
				help: 'walk up to them; once they come after you, lead them to the nearest of your own kind',
				arc: `go_to({target}) && wait(seconds=6, until=isApproaching({target}, me)) && go_to(${PACK})`,
			}))
		.withMind({
			skipStrategic: true,
			verbInstructions: BUILDING_VERB_INSTRUCTIONS,
			// The crypt moves fast: a short think, then the answer.
			thinkInstructions: { on: 'Think very quickly, in at most 3 short sentences: what is before you, and what you do now. Then answer.' },
		})
		// A law's watch is false this long before it starts again: a foe just at the edge of a watch no longer flips them.
		.withRearm(1.5)
		// What they lived stirs as they see each other (and the cobwebs), and shows in their faces and voices.
		.withFeelings()
		.withDefaultKit({ verbs: [...GAME_VERBS, 'set_status', 'rest', 'attack', 'block', 'heal', 'protect', ...Object.keys(ATTACKS)] })
		// Monsters go by what they are; the player goes by the scene's name for them, the party's archer.
		.withNames((observer, target) => (target.id === 'Player' ? host.scene.player?.name ?? target.id : target.id))
		.addRegions({
			// Where the party sets out: the leader's pep talk is said here, and the first step away from it ends it.
			Setout: {
				center: [7, 40.6],
				radius: 1.5,
				who: ({ character }) => idOf(character) === LEADERS[0],
				memory: 'We are about to set off: time for my one short pep talk to the party, naming no task.',
			},
			// The foot of the stairs: a companion on its way out who reaches it climbs out of the crypt.
			Exit: {
				center: [EXIT_AT.x, EXIT_AT.z],
				radius: EXIT_REACH,
				who: ({ character }) => !!host.sceneState<Crawl>().leaving?.ids.includes(idOf(character)),
				onEnter: ({ character }) => climbOut(host, character),
			},
			...lairRegions(host),
		})
		.addCollective(HORDE);
}
