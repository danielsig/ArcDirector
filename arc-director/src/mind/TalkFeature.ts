import { firstStep, type Arc, type ArcResult, type Step } from '../arc/arc-types.js';
import { argBase, groupTargets } from '../arc/stock-verbs.js';
import { sayToOf, type ArcRunner } from '../character/arc-runner.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { callEach } from '../director/director-types.js';
import { Feature, type FeatureFields, type FeatureTick } from '../director/Feature.js';
import type { Feeling } from '../character/feeling.js';
import { isRecord } from '../json.js';
import { idsIn, namedText, personOf, showNamingText, textSegments, parseTextWithIDs, showTextWithIDs, voiceOf, type NamingText, type TextWithIDs } from '../character/text-with-ids.js';
import { personSegments, showInPerson } from '../character/person.js';
import { wayBlocked } from '../world/geometry-kernels.js';
import { poseOf } from '../world/lookup.js';
import { noWayTo } from '../world/route.js';
import { cosToward, distance, showsFace } from '../world/vec.js';
import { Knows, type NameBook } from '../character/NameBook.js';
import type { Mind } from './mind.js';
import type { ArcFormat, HeldTurn, Manner, MindEvent, Sense, ToolSpec } from './mind-types.js';
import { hand, internalsOf } from '../internals.js';
import { blockedAgainHint, sayRangeHint } from './prompt.js';
import {
	addressees,
	DEFAULT_TALK_CONFIG,
	heardLine,
	isNamed,
	SAY_TONES,
	listenerNames,
	saidBy,
	saysLine,
	speechMentionsName,
	talkLine,
	uniqueNames,
	wordsOf,
	type Muffled,
	type SayTone,
	type SayToneDef,
	type SayResult,
	type SayTo,
	type SpeechUtterance,
	type TalkConfig,
	type TalkSense,
} from './talk.js';

/** Lines kept to tell a repeat from something new. */
const SAID_CAP = 6;
/** Share of a new line's content words an earlier line already had that makes the new line old news. */
const REPEAT_OVERLAP = 0.8;
/** Content words a line needs before it can be old news: one with fewer is never turned down. */
const REPEAT_MIN_WORDS = 2;
/** How squarely two characters must face each other to be talking face to face: within 45° of each other. */
const FACING = Math.SQRT1_2;
/** Long words that carry no content of their own. */
const FILLER = new Set(['about', 'again', 'already', 'could', 'excuse', 'hello', 'might', 'perhaps', 'please', 'really', 'should', 'sorry', 'still', 'thank', 'thanks', 'their', 'there', 'these', 'those', 'where', 'which', 'while', 'would']);

/**
 * The content words of a line, to tell a repeat from something new however it is reworded. Each word is cut
 * to its first five letters, a crude stem that makes "lowering" and "lower" the same word.
 */
function gistOf(text:string):Set<string> {
	return new Set(text.toLowerCase().split(/[^a-z0-9]+/)
		.filter((w) => w.length >= 5 && !FILLER.has(w))
		.map((w) => w.slice(0, 5)));
}

/** What a mind's voice said lately with who heard each clearly, whom its running arc asked something of, and the `verb id` pairs it found no way for. */
type Spoken = { said:{ gist:Set<string>; text:string; heard:Set<string> }[]; replyTo:string[]; noWay:Set<string> };

/** `text` as `mind` reads it, in its own names. */
function shown(mind:Pick<Mind<unknown>, 'nameOf'>, text:NamingText):string {
	return showNamingText(text, (id) => mind.nameOf(id));
}

/** What `withTalk` takes: who is in range and how speakers and listeners act (its sense), and who hears every line. */
/** A label of the speaker's, as `TalkOptions.labelAloud` is asked to say it: whose it is, and whether it is said to them. */
export type SpokenLabel = { kind:'stranger' | 'voice' | 'figure'; addressed:boolean; speakerID:string; id:string };

/** {@link TalkOptions.labelAloud}'s default. */
function labelAloud({ kind, addressed }:SpokenLabel):string {
	return addressed ? (kind === 'stranger' ? 'stranger' : 'you there') : `that ${kind}`;
}

export type TalkOptions = TalkSense & Partial<TalkConfig> & {
	/** Every line said, as it is said: a bubble, a voice. Adds a listener. */
	onSpoke?:(utterance:SpeechUtterance)=>void;
	/**
	 * Every line as each character in earshot made it out, minded or not, one call per listener: the player's own log
	 * of what they heard, a scripted listener with no model, a recording. `line.text` is display-ready, in that
	 * listener's names (the speaker `someone` when it cannot tell who spoke), its words muffled when `clarity` is
	 * `muffled`, its tone and feeling told as heard: `Old Bram shouts angrily to you: "Run!"`. Adds a listener; with none,
	 * nothing of it is worked out.
	 */
	onHeard?:(listenerID:string, line:Omit<SpeechUtterance, 'heardBy'> & { clarity:'clear' | 'muffled' })=>void;
	/** Tones of the host's own, by name (`growl: { says: 'growls', words: 0.3 }`). Adds to the stock ones ({@link SAY_TONES}) and those set before. */
	tones?:Readonly<Record<string, SayToneDef>>;
	/**
	 * How a label the speaker's mind has for someone (`StrangerA`, `VoiceA`, `FigureA`) is said aloud, for it is no name
	 * anyone else knows: to the one it stands for, and of anyone else. Default: `stranger` / `that stranger`, `you there` /
	 * `that voice` / `that figure`. A game says it its own way (`the woman in red`), or in another language.
	 */
	labelAloud?:(label:SpokenLabel)=>string;
};

/** What talk's constructor hands the library besides a feature's own. */
export type TalkFields<TCtx> = FeatureFields<TCtx> & {
	/** Listen through solo character `runner` while it is on no director (`soloCharacter`). */
	listen(runner:ArcRunner<TCtx>):void;
};

/**
 * NPC-to-NPC talk (`withTalk({ inRange, others, onSpoke })`): `say` reaches whoever the host says is in range, as a
 * `HeardSpeech` event for the mind that listens through them, and speakers and listeners face and approach (`face`, `approach`).
 * Every mind gets the `earshot` sense and tool, the sense ending in how its voice talks unasked (its spec's `talk`, else
 * `withTalk({ instructions })`; `TalkInstructions`); a reply's `say` to someone out of earshot with no way there, or a verb
 * toward someone it found no way to while the way is still blocked, goes back to it. Added to a director it listens
 * through the cast's minds; on its own, through the solo characters handed it ({@link TalkFields.listen}). The rules:
 * the README's Talk and map.
 */
export class TalkFeature<TCtx = unknown> extends Feature<TCtx> {
	/** The solo characters it listens through while on no director, by id. */
	private readonly _listeners = new Map<string, ArcRunner<TCtx>>();
	private readonly _muffled = new Map<string, Muffled[]>();
	/** Each speaker's last line, by {@link wordsOf}. */
	private readonly _lastSaid = new Map<string, string>();
	/** The last line each character made out, by {@link wordsOf}, who said it, and when. */
	private readonly _lastHeard = new Map<string, { speakerID:string; words:string; at:number }>();
	/** When a line to no one in particular last woke each listener. */
	private readonly _wokeAt = new WeakMap<ArcRunner<TCtx>, number>();
	private readonly _minds = new WeakMap<Mind<TCtx>, Spoken>();
	private readonly _onSpoke:((utterance:SpeechUtterance)=>void)[] = [];
	private readonly _onHeard:NonNullable<TalkOptions['onHeard']>[] = [];
	private _labelAloud:NonNullable<TalkOptions['labelAloud']> = labelAloud;
	private readonly _tones = new Map<string, SayToneDef>(Object.entries(SAY_TONES));
	public readonly config:TalkConfig = { ...DEFAULT_TALK_CONFIG };

	private _sense:TalkSense;

	constructor(options:TalkOptions) {
		super();
		this._sense = options;
		this.configure(options);
		hand(this, {
			listen: (runner) => {
				this._listeners.set(runner.id, runner);
			},
		} satisfies Omit<TalkFields<TCtx>, keyof FeatureFields<TCtx>>);
	}

	/** Who is in range, and how speakers and listeners face and approach (`TalkSense`). */
	public get sense():TalkSense {
		return this._sense;
	}

	/** Talk through this sense from now on; the config it names is set, its tones added, and its listener added once. */
	public configure({ onSpoke, onHeard, tones, labelAloud, ...options }:TalkOptions):this {
		this._labelAloud = labelAloud ?? this._labelAloud;
		const config = Object.keys(DEFAULT_TALK_CONFIG);
		// A second call adds to the first, as every `with*` does: `withTalk({ onSpoke })` keeps the range given before.
		this._sense = { ...this._sense, ...Object.fromEntries(Object.entries(options).filter(([key, value]) => !config.includes(key) && value !== undefined)) } as TalkSense;
		Object.assign(this.config, Object.fromEntries(Object.entries(options).filter(([key, value]) => config.includes(key) && value !== undefined)));
		if (onSpoke && !this._onSpoke.includes(onSpoke)) {
			this._onSpoke.push(onSpoke);
		}
		if (onHeard && !this._onHeard.includes(onHeard)) {
			this._onHeard.push(onHeard);
		}
		Object.entries(tones ?? {}).forEach(([name, tone]) => this._tones.set(name, tone));
		if (tones && this.attached) {
			this.verbsChanged();
		}
		return this;
	}

	public override readonly order = 40;

	public override install():void {
		this.director.withSenses((s) => s.add('earshot', this.earshot)).withTools((t) => t.add('earshot', this.tool));
	}

	/** `say`'s `as` is one of the tones registered, stock and the host's, in its help and its reply schema alike. */
	public override verbsChanged():void {
		this.director.verbs.argNames('say', 'as', [...this._tones.keys()]);
	}

	/** What the tone `as` names is, plainly (none) without one or for a name no tone has. */
	private toneOf(as?:SayTone):SayToneDef | undefined {
		return as === undefined ? undefined : this._tones.get(as);
	}

	/** The feeling character `id` shows as it speaks, where there are feelings. */
	private feelingOf(id:string):Feeling | undefined {
		return this.attached ? this.director.getFeelings()?.of(id) : undefined;
	}

	/** How a line said `how` is said, in every feature's words (`Feature.manner`): `shouts angrily`; none said plainly. */
	private mannerOf(how:Manner):string | undefined {
		return (this.attached ? internalsOf(this.director).features : [this]).map((feature) => feature.manner(how)).filter(Boolean).join(' ') || undefined;
	}

	/** A line said in a tone, said so: `Wolf (growls, to you): …`. */
	public override manner(turn:Manner):string | undefined {
		return this.toneOf(turn.as)?.says;
	}

	public override afterMoves({ now }:FeatureTick):void {
		this.tick(now);
	}

	/**
	 * Each listener by a character it listens through: on a director, the runner whose mind thinks for each in the cast
	 * (`ArcRunner.owner`). A collective listens through each of its characters, and hears each line once, from whichever
	 * heard it best.
	 */
	private listeners():[string, ArcRunner<TCtx>][] {
		if (!this.attached) {
			return [...this._listeners];
		}
		return [...this.director.characters(), ...this.director.collectives()].flatMap((runner) => (runner.owner ? [[runner.id, runner.owner] as [string, ArcRunner<TCtx>]] : []));
	}

	/** A character it listens through, or a host-facing name that `names()` maps back to one (`Herbalist` for Fern). */
	private listenerFor(id:string):ArcRunner<TCtx> | undefined {
		const listeners = this.listeners();
		const want = id.trim().toLowerCase();
		return listeners.find(([key]) => key === id)?.[1]
			?? (want ? listeners.find(([key]) => key.toLowerCase() === want || listenerNames(this.sense, key).some((n) => n.trim().toLowerCase() === want))?.[1] : undefined);
	}

	/** `id` as `observerID`'s mind names it. */
	private label(observerID:string, id:string):string {
		return this.listenerFor(observerID)?.mind?.nameOf(id) ?? id;
	}

	/** Ids currently close enough to talk to `speakerID`. */
	public nearby(speakerID:string):string[] {
		return this.sense.others(speakerID).filter((id) => id && id !== speakerID && this.sense.inRange(speakerID, id));
	}

	/** Whether `listenerID` would make out `speakerID`'s words said `as` a tone, not just hear them muffled. */
	public clear(speakerID:string, listenerID:string, as?:SayTone):boolean {
		return this.heardAs(speakerID, listenerID, as) === 'words';
	}

	/** How `listenerID` hears a line `speakerID` says `as` a tone: the host's `heardAs`, else hearing's, else every word. */
	private heardAs(speakerID:string, listenerID:string, as?:SayTone):'words' | 'muffled' | undefined {
		const hearing = this.hearing();
		return this.sense.heardAs ? this.sense.heardAs(speakerID, listenerID, as) : hearing ? hearing.speech(speakerID, listenerID, this.toneOf(as)) : 'words';
	}

	/** Hearing, where there is a world for it to measure lines in. */
	private hearing():ReturnType<ArcDirector<TCtx>['getHearing']> {
		return this.attached && this.director.world ? this.director.getHearing() : undefined;
	}

	/**
	 * Whether character `from` can tell who `id` is: it makes them out by sight now (or nothing sees), or they spoke
	 * within hearing of its `mind` lately, a voice it can answer by its name for that voice ({@link NameBook.hear}).
	 */
	private canTell(from:string, id:string, mind?:Mind<TCtx>):boolean {
		return this.sees(from, id) || !!mind?.memory.heardFrom(id);
	}

	/** Whether `from` makes `id` out by sight now; where nothing sees, yes. */
	private sees(from:string, id:string):boolean {
		return !this.attached || this.director.getSight()?.sees(from, id) !== false;
	}

	/** `id` in talking range of `mind`'s voice, as it names them: by sight while it makes them out, else by their voice. */
	private nameIn(mind:Mind<TCtx>, id:string):string {
		return mind.nameOf(this.sees(mind.thinkThread(), id) ? id : voiceOf(id));
	}

	/**
	 * `spoken` with each label of `book`'s (the speaker's) as it is said aloud ({@link TalkOptions.labelAloud}): no one else
	 * knows it. `StrangerA, meet Joe.` said to StrangerA is `Stranger, meet Joe.`; capitalized where a sentence starts.
	 */
	private aloud(speakerID:string, spoken:string, book:NameBook, targets:readonly string[]):string {
		return spoken.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (word:string, at:number) => {
			const label = book.labelOf(word);
			if (!label) {
				return word;
			}
			const said = this._labelAloud({ ...label, addressed: targets.includes(label.id), speakerID });
			return /(^|[.!?])\s*$/.test(spoken.slice(0, at)) ? said.charAt(0).toUpperCase() + said.slice(1) : said;
		});
	}

	/** `line`, by id from the words of the speaker whose book is `book`, as `listener` takes it (`AcquaintanceFields.hearsay`). */
	private saidTo(listener:ArcRunner<TCtx>, line:TextWithIDs, book:NameBook | undefined):TextWithIDs {
		const acquaintance = this.attached ? this.director.getAcquaintance() : undefined;
		const hears = listener.mind?.persona.names;
		return acquaintance && hears && book ? internalsOf(acquaintance).hearsay(line, book, hears) : line;
	}

	/**
	 * Whether `from` sees `id`'s face: makes them out by sight while they face it (or which way they face is unknown).
	 * Where nothing sees, yes.
	 */
	private seesFace(from:string, id:string):boolean {
		const world = this.attached && this.director.getSight() ? this.director.world : undefined;
		const [them, me] = world ? [poseOf(world, id), poseOf(world, from)] : [];
		return this.sees(from, id) && (!them || !me || showsFace(them.facing, them.point, me.point));
	}

	/**
	 * What each mind that hears `speakerID` (through `heardBy`), and each of its characters that does, makes of the voice
	 * ({@link NameBook.hear}): its own character's, always theirs; another's, tied to their look where it sees their face,
	 * and to their name where the line introduces them (`introduced`) and that one made out the words (`clear`); others the
	 * line introduces, it learns by name where it also sees their face. What each mind is to be told of a name it learned,
	 * once, after the line (`AcquaintanceFields.learning`).
	 */
	private place(speakerID:string, heardBy:readonly string[], clear:(id:string)=>boolean = () => false, introduced:readonly string[] = []):(()=>void)[] {
		const acquaintance = this.attached ? this.director.getAcquaintance() : undefined;
		const tells:(()=>void)[] = [];
		const hear = (book:NameBook, by:readonly string[], own:boolean, learner:string):(()=>void)[] => {
			const heard = by.filter(clear);
			const learn = ():Knows[] => book.hear(speakerID, { face: own || by.some((id) => this.seesFace(id, speakerID)), named: !own && heard.length > 0 && introduced.includes(speakerID) });
			if (!acquaintance) {
				learn();
				return [];
			}
			// Others it introduces: whoever made out the words, and sees their face, learns their name, tied to it.
			const others = introduced.filter((other) => other !== speakerID && !by.includes(other) && heard.some((id) => this.seesFace(id, other)));
			return [
				internalsOf(acquaintance).learning(learner, book, speakerID, learn),
				...others.map((other) => internalsOf(acquaintance).learning(learner, book, other, () => book.learn(other, [Knows.Name, Knows.Look]))),
			].filter((tell) => tell !== undefined);
		};
		for (const listener of new Set(heardBy.map((id) => this.listenerFor(id)))) {
			const its = heardBy.filter((id) => this.listenerFor(id) === listener);
			// A character no mind listens through is no one's own.
			const own = !!listener && this.listenerFor(speakerID) === listener;
			if (listener?.mind) {
				tells.push(...hear(listener.mind.persona.names, its, own, listener.id));
			}
			for (const id of its) {
				const persona = (this.attached ? this.director.character(id) : this._listeners.get(id))?.persona;
				if (persona && persona !== listener?.mind?.persona) {
					hear(persona.names, [id], own, id);
				}
			}
		}
		return tells;
	}

	/** Who of `nearby` (in talking range of `mind`'s voice) it can tell, and how many more it cannot make out, in words. */
	private named(mind:Mind<TCtx>, nearby:readonly string[]):{ known:string[]; strangers:string[] } {
		const known = nearby.filter((id) => !this.attached || this.canTell(mind.thinkThread(), id, mind));
		const n = nearby.length - known.length;
		return { known, strangers: n === 0 ? [] : [n === 1 ? 'someone you cannot make out' : `${n} people you cannot make out`] };
	}

	/** Whether `say` would deliver, without speaking: whoever it is `to` in range, or for a line to all, someone. */
	public canSay(speakerID:string, to?:SayTo):{ ok:boolean; reason?:string; nearby:string[] } {
		const check = this.sayCheck(speakerID, to);
		return { ...check, reason: check.reason && showNamingText(check.reason, (id) => this.label(speakerID, id)) };
	}

	/** As {@link canSay}, its reason naming by id. */
	private sayCheck(speakerID:string, to?:SayTo):{ ok:boolean; reason?:NamingText; nearby:string[] } {
		const nearby = this.nearby(speakerID);
		const targets = addressees(to);
		if (targets.includes(speakerID)) {
			return { ok: false, reason: 'talking to yourself', nearby };
		}
		if (targets.length === 0) {
			if (nearby.length === 0) {
				return { ok: false, reason: 'no one in earshot', nearby };
			}
			return { ok: true, nearby };
		}
		const mind = this.attached ? this.director.character(speakerID)?.mind : undefined;
		for (const name of targets) {
			if (!this.sense.inRange(speakerID, name)) {
				return { ok: false, reason: (named) => `${named(name)} is not in earshot`, nearby };
			}
			if (mind && !this.canTell(mind.thinkThread(), name, mind)) {
				return { ok: false, reason: `no one you can make out here answers to ${mind.persona.names.peek(name) ?? name}; get closer first`, nearby };
			}
		}
		return { ok: true, nearby };
	}

	public say(speakerID:string, text:string, to?:SayTo, timestamp = 0, as?:SayTone):SayResult {
		const spoken = text.trim();
		if (!spoken) {
			return { status: 'failed', verb: 'say', reason: 'nothing to say' };
		}
		const check = this.sayCheck(speakerID, to);
		if (!check.ok) {
			return { status: 'failed', verb: 'say', reason: check.reason };
		}
		const parrot = this.parrot(speakerID, spoken);
		if (parrot) {
			return { status: 'failed', verb: 'say', reason: parrot };
		}
		const targets = addressees(to ?? this.addressee(speakerID, timestamp));
		const heardBy = this.hearers(speakerID, targets, as);
		// Asked before anyone turns to anyone for this line.
		const facing = heardBy.filter((id) => this.faceToFace(speakerID, id));
		const tone = this.toneOf(as);
		const feeling = this.feelingOf(speakerID);
		const how = { ...tone ? { as } : {}, ...feeling ? { feeling } : {} };
		// Kept by id from the speaker's words once: each listener hears its own names, a screen the speaker's.
		const book = this.attached ? this.director.character(speakerID)?.mind?.persona.names : undefined;
		// A voice's name stays a word: said aloud, it names no one the listener could tell.
		const line = book ? parseTextWithIDs(this.aloud(speakerID, spoken, book, targets), (word) => [book.idOf(word)].find((id) => id === undefined || personOf(id) === id)) : [spoken];
		const display = (id:string):string => book?.display(id) ?? id;
		const utterance:SpeechUtterance = {
			speakerID, text: showTextWithIDs(line, display), segments: () => textSegments(line, display), to: targets.length > 1 ? targets : targets[0], heardBy, timestamp, ...how,
		};
		this.attend(utterance);
		const clearness = new Map(heardBy.map((id) => [id, this.clear(speakerID, id, as)]));
		// Whom the line introduces, its speaker or others it points out: whoever makes out the words learns their names.
		const acquaintance = this.attached ? this.director.getAcquaintance() : undefined;
		const introduced = acquaintance ? internalsOf(acquaintance).introduced(speakerID, spoken, targets) : [];
		const tells = this.place(speakerID, heardBy, (id) => clearness.get(id) === true, introduced);
		callEach('onSpoke', this._onSpoke, [utterance], this.attached ? (entry) => this.director.log(entry) : undefined);
		const clearly:string[] = [];
		const reached = new Set<ArcRunner<TCtx>>();
		// Clear hearers first, so a mind listening through several characters takes the clearest.
		for (const id of [...heardBy].sort((a, b) => Number(clearness.get(b)) - Number(clearness.get(a)))) {
			const clear = clearness.get(id) === true;
			if (clear && id !== speakerID) {
				clearly.push(id);
			}
			if (this._onHeard.length > 0 && id !== speakerID) {
				this.tellHeard(id, utterance, line, spoken, clear);
			}
			const listener = this.listenerFor(id);
			if (!listener || reached.has(listener) || saidBy(listener, speakerID)) {
				continue;
			}
			reached.add(listener);
			const names = this.namesFor(listener);
			const mentioned = speechMentionsName(spoken, names.ours);
			const addressed = isNamed(targets, names.you);
			const said = this.saidTo(listener, line, book);
			const heard = heardLine(voiceOf(speakerID), said, addressed, targets, clear, mentioned, this.mannerOf(how));
			// Said to any of its characters, it is meant for this mind, though only its voice is "you".
			const meant = addressed || mentioned || isNamed(targets, names.ours) || !!tone?.wakes || facing.includes(id);
			// Its characters that heard it as this one did, clearly or muffled, and its speaker, when it is one of them and the
			// line is clear: what others caught of it muffled is never what it said.
			const knownBy = [...clear && this.listenerFor(speakerID) === listener ? [speakerID] : [], ...heardBy.filter((other) => other !== speakerID && clearness.get(other) === clear && this.listenerFor(other) === listener)];
			this.hear(listener, knownBy, speakerID, targets, heard, this.wakes(listener, meant, targets, clear, timestamp), timestamp, clear ? { speakerID, to: targets, text: said, ...how } : undefined);
			if (!clear && this.config.rehear > 0) {
				const list = this._muffled.get(id) ?? [];
				list.push({ speakerID, spoken, said: line, targets, until: timestamp + this.config.rehear, ...how });
				this._muffled.set(id, list);
			}
		}
		// Told after the line that taught it.
		tells.forEach((tell) => tell());
		this.hearing()?.spoke(speakerID, spoken, tone);
		const words = wordsOf(spoken);
		this._lastSaid.set(speakerID, words);
		for (const id of clearly) {
			this._lastHeard.set(id, { speakerID, words, at: timestamp });
		}
		// Who it was for and could not make out the words, so the speaker knows the line did not land.
		const muffled = (targets.length > 0 ? targets : heardBy.filter((id) => this.sense.addresses?.(speakerID, id) ?? true)).filter((id) => id !== speakerID && heardBy.includes(id) && !clearly.includes(id));
		const reason = (name:(id:string)=>string):string => {
			const names = (ids:string[]):string => ids.map(name).join(', ');
			const said = targets.length > 0 ? `to ${names(targets)}` : clearly.length > 0 ? `heard by ${names(clearly)}` : 'no one made out the words';
			return muffled.length > 0 ? `${said}; too far for ${names(muffled)} to make out the words: get closer` : said;
		};
		return { status: 'ok', verb: 'say', reason, heard: clearly, to: targets };
	}

	/**
	 * An offer `speakerID` makes aloud (`offer`), told as `event`: to whom it is `to`, else to everyone who makes out its
	 * words. It wakes them as a line would ({@link wakes}): one to them at once, an open one at most once a cooldown.
	 */
	public offered(speakerID:string, to:string | undefined, event:MindEvent, timestamp = 0):void {
		const targets = to === undefined ? [] : [to];
		const reached = new Set<ArcRunner<TCtx>>();
		const hearers = to === undefined ? this.hearers(speakerID, []).filter((id) => this.clear(speakerID, id)) : targets;
		// Said aloud: its speaker by voice, as a line names them; whom it is about stays who they are.
		const tells = this.place(speakerID, hearers);
		const text:NamingText = (name) => showNamingText(event.text, (id) => name(id === speakerID ? voiceOf(id) : id));
		const who = event.who ?? [...new Set(idsIn(namedText(event.text)))];
		for (const id of hearers) {
			const listener = this.listenerFor(id);
			if (listener?.mind && !reached.has(listener) && !saidBy(listener, speakerID)) {
				reached.add(listener);
				// Every character of its that heard it.
				const knownBy = hearers.filter((other) => this.listenerFor(other) === listener);
				listener.mind.pushEvent({ ...event, text, who, knownBy, timestamp, major: this.wakes(listener, targets.length > 0, targets, true, timestamp) });
			}
		}
		tells.forEach((tell) => tell());
	}

	/**
	 * Whom `speakerID`'s line to no one in particular is said to (`TalkConfig.replyWindow`): whoever it last heard say
	 * something lately, still in earshot, else the only one in earshot; no one when neither, or it could not say it to them.
	 */
	private addressee(speakerID:string, now:number):string | undefined {
		const nearby = this.nearby(speakerID);
		const last = this._lastHeard.get(speakerID);
		const to = last && now - last.at < this.config.replyWindow && nearby.includes(last.speakerID) ? last.speakerID : nearby.length === 1 ? nearby[0] : undefined;
		return to && this.sayCheck(speakerID, to).ok ? to : undefined;
	}

	/**
	 * Whether a line wakes `listener` (`TalkConfig`): at once when it is `meant` for it (to it, naming it, in a tone that
	 * wakes, or face to face); one to no one in particular, heard `clear`ly, at most once a cooldown; one to others, never.
	 */
	private wakes(listener:ArcRunner<TCtx>, meant:boolean, targets:readonly string[], clear:boolean, now:number):boolean {
		if (meant) {
			return true;
		}
		if (targets.length > 0 || !clear || now - (this._wokeAt.get(listener) ?? -Infinity) < this.config.untargetedWakeCooldown) {
			return false;
		}
		this._wokeAt.set(listener, now);
		return true;
	}

	/** Whether `a` and `b` stand within `TalkConfig.faceToFaceRange` of each other, each facing the other: talking to each other. */
	private faceToFace(a:string, b:string):boolean {
		const world = this.attached && this.config.faceToFaceRange > 0 ? this.director.world : undefined;
		const [pa, pb] = world ? [poseOf(world, a), poseOf(world, b)] : [];
		return !!pa?.facing && !!pb?.facing && distance(pa.point, pb.point) <= this.config.faceToFaceRange
			&& cosToward(pa.facing, pa.point, pb.point) >= FACING && cosToward(pb.facing, pb.point, pa.point) >= FACING;
	}

	/**
	 * `onHeard` for character `id`, if the library knows it: `utterance` as it made it out, in its names, `line` (what
	 * was `spoken`, by id) told as it heard it, clearly or not, as its mind is told.
	 */
	private tellHeard(id:string, { heardBy, ...said }:SpeechUtterance, line:TextWithIDs, spoken:string, clear:boolean):void {
		const runner = this.attached ? this.director.character(id) : this._listeners.get(id);
		if (!runner) {
			return;
		}
		const { speakerID } = said;
		const targets = addressees(said.to);
		const own = this.namesOf([id]);
		const heard = heardLine(voiceOf(speakerID), line, isNamed(targets, own), targets, clear, speechMentionsName(spoken, own), this.mannerOf(said));
		const thinker = runner.owner ?? runner;
		// A mind's book names the voice; with none, a voice is someone unless it sees them.
		const shown = (who:string):string | undefined => (thinker.mind || personOf(who) === who ? who : this.sees(id, speakerID) ? speakerID : undefined);
		const name = (who:string, start:boolean):string => {
			const as = shown(who);
			return as === undefined ? (start ? 'Someone' : 'someone') : thinker.persona.names.display(as);
		};
		const made = { ...said, text: showInPerson(heard, (who) => who === id, name), segments: () => personSegments(heard, (who) => who === id, name), clarity: clear ? 'clear' as const : 'muffled' as const };
		callEach('onHeard', this._onHeard, [id, made], this.attached ? (entry) => this.director.log(entry) : undefined);
	}

	/** Deliver muffled lines in full to listeners who came close enough. On a director, every tick does. */
	public tick(now:number):void {
		for (const [id, list] of this._muffled) {
			const keep = list.filter((row) => {
				if (now >= row.until) {
					return false;
				}
				const listener = this.listenerFor(id);
				if (listener && saidBy(listener, row.speakerID)) {
					return false;
				}
				if (!listener || !this.clear(row.speakerID, id, row.as)) {
					return !!listener;
				}
				const names = this.namesFor(listener);
				const addressed = isNamed(row.targets, names.you);
				const meant = addressed || isNamed(row.targets, names.ours) || speechMentionsName(row.spoken, names.ours) || !!this.toneOf(row.as)?.wakes || this.faceToFace(row.speakerID, id);
				this._lastHeard.set(id, { speakerID: row.speakerID, words: wordsOf(row.spoken), at: now });
				const acquaintance = this.attached ? this.director.getAcquaintance() : undefined;
				const book = this.attached ? this.director.character(row.speakerID)?.mind?.persona.names : undefined;
				const tells = this.place(row.speakerID, [id], () => true, acquaintance ? internalsOf(acquaintance).introduced(row.speakerID, row.spoken, row.targets) : []);
				const said = this.saidTo(listener, row.said, book);
				const text = saysLine(voiceOf(row.speakerID), said, row.targets, ', now clear', this.mannerOf(row));
				this.hear(listener, [id], row.speakerID, row.targets, text, this.wakes(listener, meant, row.targets, true, now), now, { speakerID: row.speakerID, to: row.targets, text: said, ...row.as ? { as: row.as } : {}, ...row.feeling ? { feeling: row.feeling } : {} });
				tells.forEach((tell) => tell());
				return false;
			});
			if (keep.length > 0) {
				this._muffled.set(id, keep);
			}
			else {
				this._muffled.delete(id);
			}
		}
	}

	/** Why `spoken` would only parrot: `speakerID`'s own last line again, or the last line it heard. None while `repeats`. */
	private parrot(speakerID:string, spoken:string):NamingText | undefined {
		const rule = this.config.repeats;
		if (rule === true) {
			return undefined;
		}
		const words = wordsOf(spoken);
		const heard = this._lastHeard.get(speakerID);
		const flagged = !words
			? undefined
			: this._lastSaid.get(speakerID) === words
				? 'you already said this, and it was heard: saying it again changes nothing, it was not wrong. You are not a parrot: say something new, or nothing. Remember, actions speak louder than words.'
				: heard?.words === words && heard.speakerID !== speakerID
					? (name:(id:string)=>string) => `${name(heard.speakerID)} just said this, and it was heard: saying it again changes nothing, it was not wrong. You are not a parrot: say something of your own, or nothing. Remember, actions speak louder than words.`
					: undefined;
		const verdict = flagged && typeof rule === 'function' ? rule(speakerID, spoken) : false;
		return verdict === true ? undefined : typeof verdict === 'string' ? verdict : flagged;
	}

	/** The names a line uses when it is for `listener`: any character it listens through (`ours`), or its voice (`you`). */
	private namesFor(listener:ArcRunner<TCtx>):{ ours:string[]; you:string[] } {
		const listening = this.listeners().filter(([, m]) => m === listener).map(([id]) => id);
		return { ours: this.namesOf([listener.id, ...listening]), you: this.namesOf([listener.voice.id, listener.id]) };
	}

	/** `ids` and every name the host gives them (`names`). */
	private namesOf(ids:string[]):string[] {
		return uniqueNames(ids.flatMap((id) => [id, ...listenerNames(this.sense, id)]));
	}

	/** Tell `listener`'s mind a line its characters `knownBy` heard, kept by id as the library keeps it. */
	private hear(listener:ArcRunner<TCtx>, knownBy:string[], speakerID:string, targets:string[], text:TextWithIDs, major:boolean, timestamp:number, turn?:HeldTurn):void {
		if (listener.mind) {
			internalsOf(listener.mind).hold({ kind: 'HeardSpeech', text, who: [speakerID, ...targets], knownBy, tags: ['speech'], major, timestamp, remember: true, turn });
		}
	}

	/** Who hears a line `speakerID` says `as` a tone: in range, let by the host's `hears`, and not drowned or out of earshot. */
	private hearers(speakerID:string, targets:string[], as?:SayTone):string[] {
		const nearby = this.nearby(speakerID);
		const allow = this.sense.hears;
		return [...nearby, ...targets.filter((name) => !nearby.includes(name))]
			.filter((id) => (!allow || allow(speakerID, id)) && (id === speakerID || this.heardAs(speakerID, id, as) !== undefined));
	}

	/** Whom a line is to (everyone who heard it, when to no one) and its speaker turn to each other; others who heard it, to the speaker. */
	private attend({ speakerID, to, heardBy }:SpeechUtterance):void {
		const targets = addressees(to);
		for (const id of targets.length > 0 ? targets : heardBy) {
			this.oneWay(speakerID, id);
			this.oneWay(id, speakerID);
		}
		for (const id of targets.length > 0 ? heardBy.filter((other) => !targets.includes(other)) : []) {
			this.oneWay(id, speakerID);
		}
	}

	private oneWay(who:string, toward:string):void {
		if (!who || !toward || who === toward) {
			return;
		}
		this.sense.face?.(who, toward);
		this.sense.approach?.(who, toward);
	}

	// ---- Each mind's half ----

	/** Who a mind's voice can talk to now. */
	public readonly earshot:Sense<TCtx> = (ctx, mind) => (mind.voice.embodied ? [this.earshotText(mind), this.talkOf(mind)].filter(Boolean).join('\n') : undefined);

	/** How its voice talks unasked: its own {@link TalkStyle}, else the director's instructions; none without either. */
	private talkOf(mind:Mind<TCtx>):string | undefined {
		return talkLine(this.attached ? internalsOf(this.director).cast.specs.get(mind.thinkThread())?.talk : undefined, this.config.instructions);
	}

	public get tool():ToolSpec<TCtx> {
		return {
			description: 'Who is in range right now. Who you can say(to) is this list. Pass to to check one name before you arc a say. Out of range: error, no speech; get closer first. Omit to to list everyone in range.',
			parameters: { type: 'object', additionalProperties: false, properties: { to: { type: 'string' } } },
			offered: (mind) => mind.voice.embodied,
			handler: (ctx, args, mind) => {
				const to = isRecord(args) && typeof args.to === 'string' ? args.to.trim() : '';
				const { known, strangers } = this.named(mind, this.nearby(mind.thinkThread()));
				const nearby = [...known.map((id) => this.nameIn(mind, id)), ...strangers];
				if (!to) {
					return nearby.length > 0 ? nearby : 'No one in talking range.';
				}
				const check = this.canSay(mind.thinkThread(), mind.persona.names.resolve(to));
				return check.ok ? { ok: true, inRange: true, nearby } : { error: check.reason, inRange: false, nearby };
			},
		};
	}

	/** Its last verb found no way: the same verb toward the same one is refused while the way stays blocked. */
	public override promptPart(mind:Mind<TCtx>):undefined {
		const { verb, unreachable } = mind.lastResult ?? {};
		if (verb && unreachable) {
			this.spoken(mind).noWay.add(`${verb} ${unreachable}`);
		}
		return undefined;
	}

	public override replyCheck(mind:Mind<TCtx>, arc:Arc, format:ArcFormat):{ reason:string; hint:string } | undefined {
		const say = this.unreachableSay(mind, arc);
		const again = say ? undefined : this.blockedAgain(mind, arc);
		return say ? { reason: say.reason, hint: sayRangeHint(say.reason, say.nearby, format) } : again === undefined ? undefined : { reason: again, hint: blockedAgainHint(again, format) };
	}

	/**
	 * `step`, a `say`, as `runner` says it (`ArcRunner.speak`). A voice does not say again what everyone it is meant for
	 * (the addressees, or everyone in earshot) heard clearly, which telling someone new or adding something is not; its
	 * mind keeps the line in its conversation.
	 */
	public async speak(runner:ArcRunner<TCtx>, step:Step):Promise<SayResult> {
		const mind = runner.isVoice ? runner.mind! : undefined;
		const text = String(step.args.text ?? '').trim();
		const gist = gistOf(text);
		const meantFor = mind && gist.size >= REPEAT_MIN_WORDS ? [sayToOf(step.args) ?? this.nearby(mind.thinkThread())].flat() : [];
		const echo = mind && this.spoken(mind).said.find((line) => [...gist].filter((w) => line.gist.has(w)).length / gist.size >= REPEAT_OVERLAP
			&& meantFor.length > 0 && meantFor.every((id) => line.heard.has(id)))?.text;
		if (echo) {
			return { status: 'failed', verb: 'say', reason: `they already heard you say that ("${echo}"). Saying it again changes nothing: act on it, or say something new` };
		}
		const result = await runner.speak(step);
		if (mind && result.status === 'ok' && text) {
			const spoken = this.spoken(mind);
			spoken.said = [...spoken.said, { gist, text, heard: new Set(result.heard ?? []) }].slice(-SAID_CAP);
			const as = typeof step.args.as === 'string' ? step.args.as : undefined;
			const feeling = this.feelingOf(mind.thinkThread());
			mind.memory.noteConversation({ speakerID: mind.thinkThread(), to: result.to ?? [], text,...as ? { as } : {}, ...feeling ? { feeling } : {} });
		}
		return result;
	}

	/** A finished step of `voice`'s that asks other characters something (`VerbDef.reply`): its arc's end waits for their answer. */
	public noteReply(voice:ArcRunner<TCtx>, step:Step):void {
		// A line to a group, like one to no one, waits for no answer.
		if (!voice.verbs.get(step.verb)?.reply || groupTargets(step, voice.verbs)) {
			return;
		}
		const replyTo = this.spoken(voice.mind!).replyTo;
		const people = otherCharacters(voice, this);
		for (const [key, arg] of Object.entries(voice.verbs.get(step.verb)?.args ?? {})) {
			const id = step.args[key];
			if (argBase(arg.kind) === 'id' && typeof id === 'string' && id !== voice.id && people.has(id) && !replyTo.includes(id)) {
				replyTo.push(id);
			}
		}
	}

	/** `voice`'s arc waits for no answer: a new one began, or what asked ran beside its program. */
	public forgetReplies(voice:ArcRunner<TCtx>):void {
		this.spoken(voice.mind!).replyTo = [];
	}

	/** After `voice`'s arc, unless it was stopped, it waits for whoever it asked something of and is still in earshot. */
	public async awaitReplies(voice:ArcRunner<TCtx>, result:ArcResult):Promise<void> {
		const spoken = this.spoken(voice.mind!);
		const asked = result.status === 'stopped' ? [] : spoken.replyTo;
		const near = asked.length > 0 ? new Set(this.nearby(voice.id)) : undefined;
		const who = asked.filter((id) => near!.has(id));
		spoken.replyTo = [];
		if (who.length > 0 && voice.execute) {
			await voice.execute({ verb: 'wait', args: { seconds: 20, reply: who.length === 1 ? who[0] : who } }, voice.context());
		}
	}

	/** In earshot is not in reach (across a river) or clear (a mumble); unmarked, the voice walks into the river or talks to no avail. */
	private earshotText(mind:Mind<TCtx>):string {
		const voiceID = mind.thinkThread();
		const { known, strangers } = this.named(mind, this.nearby(voiceID));
		const ways = this.ways(voiceID, known);
		const names = [...known.map((id, i) => {
			const blocked = ways?.[i];
			const marks = [
				!this.clear(voiceID, id) && 'too far to make out your words',
				blocked !== undefined && (blocked ? `unreachable, blocked on the way: ${shown(mind, blocked)}` : 'unreachable'),
			].filter(Boolean);
			return marks.length > 0 ? `${this.nameIn(mind, id)} (${marks.join('; ')})` : this.nameIn(mind, id);
		}), ...strangers];
		// Where the world can tell whether there is a way, say(to) walks up to them first.
		const walks = ways !== undefined;
		if (mind.compact) {
			// Only what this host does differently: say(to) cannot walk up to anyone.
			const range = names.length > 0 ? `In talking range: ${names.join(', ')}.` : 'No one in talking range.';
			return walks ? range : `${range} say(to) only those names.`;
		}
		if (names.length === 0) {
			return walks ? 'No one in talking range. say(to) walks up to them first.' : 'No one in talking range. say(to) will fail until you are closer.';
		}
		return walks
			? `In talking range: ${names.join(', ')}. say(to) walks up to them first. Far-off speech is muffled.`
			: `In talking range: ${names.join(', ')}. say(to) only those names; get closer to anyone else first. Far-off speech is muffled.`;
	}

	/** Why the arc's first step would fail again: the same verb toward someone it found no way to, asked of the live world, so a lowered bridge lets it through. */
	private blockedAgain(mind:Mind<TCtx>, arc:Arc):string | undefined {
		const head = firstStep(arc);
		const noWay = this.spoken(mind).noWay;
		for (const arg of Object.values(head?.args ?? {})) {
			const id = typeof arg === 'string' ? arg : '';
			const key = `${head?.verb} ${id}`;
			if (!noWay.has(key)) {
				continue;
			}
			const [why] = this.ways(mind.thinkThread(), [id]) ?? [];
			if (why === undefined) {
				noWay.delete(key);
				continue;
			}
			return shown(mind, noWayTo((name) => name(id), why));
		}
		return undefined;
	}

	/** Why the arc's first step, a `say` to someone, cannot reach them, with who is in earshot: out of earshot is only a walk away, unless there is no way there. */
	private unreachableSay(mind:Mind<TCtx>, arc:Arc):{ reason:string; nearby:string[] } | undefined {
		const head = firstStep(arc);
		if (head?.verb !== 'say') {
			return undefined;
		}
		const aimed = mind.voice.aimGroup(head);
		// A group is not refused here: running, it speaks to whoever of them it can, or says why it cannot.
		if ('status' in aimed || groupTargets(aimed, mind.voice.verbs)) {
			return undefined;
		}
		const voiceID = mind.thinkThread();
		const to = sayToOf(aimed.args);
		const check = this.canSay(voiceID, to);
		if (check.ok) {
			return undefined;
		}
		const { known, strangers } = this.named(mind, check.nearby);
		const nearby = [...known.map((id) => this.nameIn(mind, id)), ...strangers];
		const ids = [to ?? []].flat();
		const ways = to !== undefined && !ids.includes(voiceID) ? this.ways(voiceID, ids) : undefined;
		if (ways) {
			const i = ways.findIndex((why) => why !== undefined);
			return i < 0 ? undefined : { reason: shown(mind, noWayTo((name) => name(ids[i]), ways[i]!)), nearby };
		}
		return { reason: check.reason ?? 'not in earshot', nearby };
	}

	/** Why there is no way from `from` to each of `ids` (`wayBlocked`), one look for all; unknown while it is on no director. */
	protected ways(from:string, ids:readonly string[]):(NamingText | undefined)[] | undefined {
		const world = this.attached ? this.director.world : undefined;
		return !this.attached ? undefined : world ? wayBlocked(world, from, ids) : ids.map(() => undefined);
	}

	private spoken(mind:Mind<TCtx>):Spoken {
		const spoken = this._minds.get(mind) ?? { said: [], replyTo: [], noWay: new Set<string>() };
		this._minds.set(mind, spoken);
		return spoken;
	}
}

/** Living characters besides the one acting: the catalog's `others`, and anyone talk can address. */
function otherCharacters<TCtx>(voice:ArcRunner<TCtx>, talk:TalkFeature<TCtx>):Set<string> {
	const listed = voice.catalog?.()?.names.get('others');
	const seen = listed?.kind === 'list' ? listed.value.flatMap((row) => (row.kind === 'entity' ? [row.value.id] : [])) : [];
	return new Set([...seen, ...talk.sense.others(voice.id)].filter((id) => id && id !== voice.id));
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link TalkFeature}: `withTalk({ inRange, others, face, onSpoke, onHeard, rehear: 5 })`. */
		withTalk(options:TalkOptions):this;
		getTalk():TalkFeature<TCtx> | undefined;
	}
}
export function withTalk<TCtx>(this:ArcDirector<TCtx>, options:TalkOptions):ArcDirector<TCtx> {
	return this.configureFeature(TalkFeature<TCtx>, () => new TalkFeature<TCtx>(options), (talk) => talk.configure(options));
}
