import { Time, type GameObject } from '@arc-director/kindling';
import { ArcDirector, type CharacterSpec, type CollectiveSpec, type LawSpec, type MemoryDraft, type SpeechUtterance } from 'arc-director';
import { Celebrating, Door, Lock } from '../../engine/components';
import { cueAt } from '../../audio/cue';
import { distXZ, findCarried, itemMatchesName } from '../../items/inventory';
import type { GameHost } from '../adapter';
import { ATTACKS } from '../fight';
import { findObject, isLiving } from '../names';
import { addFightVerbs, addStatusVerbs, BUILDING_VERB_INSTRUCTIONS, GAME_VERBS } from '../verbs';
import { withReceived, type CharacterCtx } from '../types';

const PRIZE = 'SunCrown';
const BOSS = 'HollowKing';
const COMPANY = ['Bram', 'Maren', 'Wren'];

/** The riddle's answer, as people say it. Spoken this close to SealedDoor, it opens. */
const ANSWER = /\bfoot\s?(steps?|prints?)\b/i;
const ANSWER_REACH = 6;

const FOES_NEAR = 'some(others.filter("enemy").nearby(9))';
const HEALER_UP = 'some(others.filter("Healer"))';
const FOES_ON_HEALER = 'some(others.filter("enemy").filter(u => some(others.filter("Healer").filter(h => isNear(u, h, 6)))))';

/** A fighter of the company strikes back the moment a monster is in sight, whatever it was doing. */
const STRIKE:LawSpec = { name: 'strike', who: 'me', watch: FOES_NEAR, arc: 'loop(attack())', pinned: true };

/** Near death, a fighter runs to the healer (Maren). */
const RALLY:LawSpec = {
	name: 'rally',
	who: 'me',
	watch: `me.hp * 4 <= me.maxHP && ${HEALER_UP} && !some(others.filter("Healer").nearby(3))`,
	arc: 'go_to(Maren)',
	pinned: true,
};

/** While the healer lives, a fighter fights from her side, first at whoever is closest to her. */
const GUARD:LawSpec = {
	name: 'guard',
	who: 'me',
	watch: `(${FOES_NEAR} && ${HEALER_UP}) || ${FOES_ON_HEALER}`,
	arc: 'loop(protect(Maren))',
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

/** The healer heals first, then fights. */
const MEND:LawSpec = {
	name: 'mend',
	who: 'me',
	watch: 'isHurt(me) || some(others.filter(u => !(u is "enemy") && isHurt(u)).nearby(8))',
	arc: 'heal()',
	pinned: true,
};

/** What the whole company knows going in. Derek may or may not be with them. */
const QUEST_MEMORIES:MemoryDraft[] = [
	{
		text: 'We came down into the Sunken Crypt for the SunCrown in its Treasury. Its dead king, the HollowKing, guards it. His weakness is no secret: steel and arrows barely scratch him, but witchfire burns, so Wren\'s hex does triple damage. When he falls, HoardGate opens.',
		tags: ['SunCrown', 'HollowKing', 'quest', 'weakness'],
		pinned: true,
	},
	{
		text: 'Derek is our archer, a good shot and a better friend. Derek promised to catch up; if Derek is with us, we fight as four. If not, we do not wait.',
		tags: ['Derek', 'company'],
		pinned: true,
	},
];

const GOAL = { text: `Get the ${PRIZE} from HoardChest, deep in the crypt, with the company alive. Do the next step yourself; do not wait to be asked.`, priority: 2 };

const KNIGHT:CharacterSpec = {
	id: 'Bram',
	mind: {},
	tags: ['Knight'],
	identity: { role: 'Knight', traits: ['gruff', 'loyal to the bone', 'secretly soft-hearted', 'tells terrible jokes', 'terrified of spiders'] },
	goals: [GOAL],
	memories: [
		{
			text: 'I am Bram, a knight twenty years past my prime. I swore to Wren\'s late mother I would keep the girl alive, and I will, though she makes it hard. I go first through every door and I stand between my friends and whatever comes. I hide my fear behind bad jokes. Spiders, though: I will not touch a web. Someone else can burn it.',
			tags: ['backstory', 'Bram', 'Wren', 'spiders'],
			pinned: true,
		},
		...QUEST_MEMORIES,
	],
	laws: [RALLY, GUARD, STRIKE],
};

const HEALER:CharacterSpec = {
	id: 'Maren',
	mind: {},
	tags: ['Healer'],
	identity: { role: 'Healer', traits: ['warm', 'stern when it matters', 'keeps a tally of every wound she mends', 'hums hymns when afraid'] },
	goals: [GOAL],
	memories: [
		{
			text: 'I am Maren, a healer of the Dawn chapel. I have patched these fools up for six years and I keep a tally of every wound: Bram owes me forty-one. I scold them for taking risks because I love them. I stay behind Bram in a fight and heal whoever is hurt; I carry two HealthPotion for the worst of it.',
			tags: ['backstory', 'Maren', 'HealthPotion'],
			pinned: true,
		},
		...QUEST_MEMORIES,
	],
	laws: [FLEE, MEND, STRIKE],
};

const WITCH:CharacterSpec = {
	id: 'Wren',
	mind: {},
	tags: ['Witch'],
	identity: { role: 'Witch', traits: ['brilliant', 'cocky', 'sharp-tongued', 'loves riddles', 'braver than she feels'] },
	goals: [GOAL],
	memories: [
		{
			text: 'I am Wren, a fire witch, nineteen and the cleverest person in any room, as I like to remind Bram. My hex is witchfire. I adore riddles and solve them out loud. I tease Bram about spiders, but I would walk into fire for him and Maren. I keep my distance in a fight and burn things from behind Bram.',
			tags: ['backstory', 'Wren', 'hex', 'riddle'],
			pinned: true,
		},
		...QUEST_MEMORIES,
	],
	laws: [RALLY, GUARD, STRIKE],
};

/** Who lies in wait, room by room. They have no voice and never think: their one law wakes them. */
const HORDE:CollectiveSpec<CharacterCtx> = {
	id: 'Horde',
	mind: { skipHeartbeat: true, skipMajor: true, skipStart: true, skipStrategic: true },
	watchesWritable: false,
	systemOne: null,
	kit: { verbs: ['loop', 'attack'], tools: [] },
	identity: { role: 'Horde', traits: ['undead', 'mindless'] },
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
	laws: [{ name: 'wake', who: 'units', watch: 'some(others.filter("enemy").nearby(8))', arc: 'loop(attack())', pinned: true }],
};

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

function prizeTaken(host:GameHost):boolean {
	return company(host).some((go) => !!findCarried(go, (it) => itemMatchesName(it, PRIZE)));
}

function onSpoke(host:GameHost, utterance:SpeechUtterance):void {
	const speaker = findObject(host.world, utterance.speakerID);
	const door = host.world.findNamed('SealedDoor');
	if (!speaker || !door || !ANSWER.test(utterance.text) || distXZ(speaker, door) > ANSWER_REACH) {
		return;
	}
	openDoor(host, 'SealedDoor', 'The riddle is answered. SealedDoor grinds open');
}

function tickCrypt(host:GameHost):void {
	if (host.bargainDone) {
		return;
	}
	if (!isLiving(host.world.findByID(BOSS))) {
		openDoor(host, 'HoardGate', `The ${BOSS} falls, and HoardGate swings open`);
	}
	if (!prizeTaken(host)) {
		return;
	}
	host.bargainDone = true;
	host.world.setMessage(`The ${PRIZE} is won`);
	for (const go of company(host)) {
		const hop = go.getOrAddComponent(Celebrating);
		hop.until = Time.time + 48;
		hop.enabled = true;
	}
}

export function createDirector(host:GameHost):ArcDirector<CharacterCtx> {
	host.hooks = { checkBargain: tickCrypt, onSpoke, goalDone: (h) => prizeTaken(h) };
	host.kit = { verbs: [...GAME_VERBS, 'set_status', 'rest', 'attack', 'block', 'heal', 'protect', ...Object.keys(ATTACKS)] };
	return addFightVerbs(addStatusVerbs(host.configure(new ArcDirector<CharacterCtx>()), host), host)
		.withMindDefaults({ skipHeartbeat: true, skipStrategic: true })
		.withDefaultKit(host.kit)
		.withVerbInstructions(BUILDING_VERB_INSTRUCTIONS)
		// Monsters go by what they are; the player is Derek, the company's archer.
		.withNames({ seen: (observer, target) => (target.id === 'Player' ? 'Derek' : target.id) })
		.addCharacter(withReceived(KNIGHT))
		.addCharacter(withReceived(HEALER))
		.addCharacter(withReceived(WITCH))
		.addCollective(HORDE);
}
