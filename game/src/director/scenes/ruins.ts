import { ArcDirector, DEFAULT_VERB_INSTRUCTIONS, type Character, type Collective, type CollectiveSpec, type Kit, type MemoryDraft } from 'arc-director';
import { CharacterMotor } from '../../characters/CharacterMotor';
import { Celebrating } from '../../engine/components';
import type { GameObject } from '../../engine/GameObject';
import type { GameHost, CharacterCtx } from '../adapter';
import { addFightVerbs } from '../verbs';
import { BACK_STANDOFF, FIGHT_WALK, SPELL_RANGE, formatFightRules, seenInFight } from '../fight';
import { idOf, findObject, isLiving } from '../names';

/** What a party's mind may write. */
const FIGHT:Kit = {
	verbs: ['issue', 'when', 'law', 'unlaw', 'loop', 'smite', 'heal', 'attack', 'rank'],
	tools: [],
};

/** Nearest living Healer of the unit's own party. A bare `Healer` is a tag, not a name anyone sees. */
const ALLY_HEALER = 'others.filter(u => u is "Healer" && !(u is "enemy")).minBy(u => distance(me, u))';

const WOUNDED_LAW = {
	name: 'wounded',
	who: 'units',
	watch: `isHurt(me) && some(allUnits.filter("Healer")) && !isNear(me, allUnits.filter("Healer"), ${SPELL_RANGE})`,
	arc: `go_to(${ALLY_HEALER})`,
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

const PARTY_LAWS = [WOUNDED_LAW, MEND_LAW, GUARD_LAW, STRIKE_LAW, RANK_LAW];

/** Only while reasoning is off. With it on, the library's own think line stands. */
const NO_THINK = 'IMPORTANT! DO NOT THINK! RESPOND IMMEDIATELY! Thinking is dangerous. The enemy is very likely already killing your units while you think. Do not wait for another think.';

/** First-think fight programs. Gemma copies this; keep it short and paren-balanced. */
const FIGHT_OPENING = [
	'issue(who=units.filter("Knight"), arc=loop(cleave(others.filter("enemy").minBy(u => distance(me, u)))))',
	'issue(who=units.filter("Blade"), arc=loop(slash(others.filter("enemy").minBy(u => distance(me, u)))))',
	'issue(who=units.filter("Archer"), arc=loop(shoot(others.filter("enemy").minBy(u => u.hp + distance(me, u)))))',
	'issue(who=units.filter("Witch"), arc=loop(hex(others.filter("enemy").minBy(u => u.hp + distance(me, u)))))',
].join(' ; ');

/** Standing 5v5 doctrine. Every name here is one the commander really sees. */
const FIGHT_DOCTRINE = [
	'Teamfight: Knight and Blade hold a line on the nearest. Archer, Witch, and Healer sit behind that line and pick among enemies they can hit. Healer: stay back, heal from range, never walk toward an enemy. Live minBy every swing — do not hex(EnemyHealer) from this snapshot. Sight is ~10s stale.',
	'First think: emit the four issue loops in the Example. Match parens. Do not nest when or law on that first think. Guard already protect()s while someone is hurt and a Healer lives. Peel later inside an issued arc: attack the rival that isNear your Healer.',
	`Later thinks only edit. Never a weak allUnits. Optional: law(who=units, watch=me.hp/me.maxHP<0.25, arc=go_to(${ALLY_HEALER}), name=lastStand).`,
	'Arrows need a clear line of sight past trees, walls, and other characters; spells (hex, heal) through cover are weaker. Flank around cover for a better view of the target.',
	'protect(target?) stands between an ally and the threat, then attacks that threat. Peeling is also protect: when a rival isNear a precious ally, attack that same rival.',
].join(' ');

/** Scene facts only: stats, what each pinned law does, and what the enemy looks like. Doctrine is {@link FIGHT_DOCTRINE}. */
function partyStory(party:string):MemoryDraft {
	const text = [
		`You command ${party}. Win.`,
		formatFightRules(),
		'Your units are fully programmable RTS units: sticky programs, laws, when, loop. You are a unit and the commander; issue() never targets you.',
		'The enemy shows as EnemyWitch, EnemyKnight, EnemyArcher, EnemyBlade, EnemyHealer. A Player who strikes your units is then EnemyPlayer. In programs, enemies are others.filter("enemy").',
		'go_to is not a fight — they walk there and stop. Issued combat verbs walk those units into range. You stay behind the line. The verb matches YOUR tag. who=units.filter("Blade") is your Blade; EnemyBlade is theirs.',
		'Flank with spread, circle, or go_to a Tree or Boulder so shoot has a clear view.',
		'A program that ends is idle in a knife fight. Inside the issued arc, && is the next step after success (the hit landed or the foe is down). loop the chain. Join several issue with ; — never && between issue().',
		'If someone is almost dead and under fire they are probably down — do not program around that snapshot.',
		'Hurt troops already have law wounded: out of heal range of a Healer, they walk to yours until they are in range, then they keep fighting. You already have mend: heal() loops Knight, then yourself, then Captain, then the rest — only while you are a Healer and no rival is in knife range. Guard protect()s whoever is hurt while a Healer lives: the Knight screens them and attacks that threat, then goes back to their program. Strike is attack() with your tag when you are not a Healer. Rank holds you behind the Knight and Blade, clear of knife range. If a rival is close, rank() away — do not heal or smite in a scrum. Keep wounded, mend, guard, strike, and rank. Never unlaw them.',
		`smite, heal, attack(), and rank() are yours as commander. smite is arm's reach — never walk in for it while a Knight or Blade lives. heal from ${SPELL_RANGE}m like hex. Never go_to an enemy. Never issue smite, heal, attack, or rank. Units cannot smite.`,
	].join(' ');
	return { text, tags: ['backstory', party], pinned: true };
}


const DAWN:CollectiveSpec<CharacterCtx> = {
	id: 'DawnParty',
	mind: { skipHeartbeat: false, skipMajor: true },
	watchesWritable: false,
	pinnedSightFocus: ['isHurt(it)'],
	kit: FIGHT,
	commander: 'Dawn',
	identity: { role: 'Commander', traits: ['resolute', 'grim', 'captain'] },
	memories: [partyStory('DawnParty')],
	goals: [{
		text: 'Win.',
		priority: 3,
	}],
	characters: [
		{ id: 'Dawn', tags: ['Captain', 'Healer'] },
		{ id: 'Cinder', tags: ['Witch'] },
		{ id: 'Brune', tags: ['Knight'] },
		{ id: 'Wisp', tags: ['Archer'] },
		{ id: 'Cade', tags: ['Blade'] },
	],
	laws: PARTY_LAWS,
};

const DUSK:CollectiveSpec<CharacterCtx> = {
	id: 'DuskParty',
	mind: { skipHeartbeat: false, skipMajor: true },
	watchesWritable: false,
	pinnedSightFocus: ['isHurt(it)'],
	kit: FIGHT,
	commander: 'Dusk',
	identity: { role: 'Commander', traits: ['cold', 'ruthless', 'captain'] },
	memories: [partyStory('DuskParty')],
	goals: [{
		text: 'Win.',
		priority: 3,
	}],
	characters: [
		{ id: 'Dusk', tags: ['Captain', 'Healer'] },
		{ id: 'Nyx', tags: ['Witch'] },
		{ id: 'Helms', tags: ['Knight'] },
		{ id: 'Ash', tags: ['Archer'] },
		{ id: 'Flint', tags: ['Blade'] },
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
		hop.until = host.world.time + 48;
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
	winner.kit = { verbs: [...FIGHT.verbs, 'say'], tools: [] };
	host.kit.verbs = [...host.kit.verbs, 'say'];
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
	// Characters also run what the party laws do, which their minds do not write.
	host.kit = { verbs: [...FIGHT.verbs, 'go_to', 'protect'], tools: [] };
	return addFightVerbs(host.configure(new ArcDirector<CharacterCtx>()), host)
		.onCommanderVacant((party) => succeedCommand(host, party))
		.withSight({ limit: 16 })
		.withNames({ seen: seenInFight })
		.withThinkInstructions({ off: NO_THINK })
		.withVerbInstructions(`${DEFAULT_VERB_INSTRUCTIONS} ${FIGHT_DOCTRINE}`)
		.withArcExample(FIGHT_OPENING)
		.withDefaultKit(host.kit)
		.addCollective(DAWN)
		.addCollective(DUSK);
}
