import type { ArcRunner } from './arc-runner.js';
import type { Character } from './Character.js';
import { KNOWS_ALL, Knows, type NameBook, type NameTarget } from './NameBook.js';
import { displayName, joinTextWithIDs, voiceOf, type TextWithIDs } from './text-with-ids.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { callEach, type NameObserver } from '../director/director-types.js';
import { Feature, type FeatureFields } from '../director/Feature.js';
import { hand } from '../internals.js';

/** What `withAcquaintance` takes. */
export type AcquaintanceOptions<TCtx = unknown> = {
	/**
	 * Who know each other wholly: everyone in a circle knows everyone else in it. An entry is a character's id, a
	 * collective's (its characters) or a tag (whoever has it): `[['Mira', 'Bram'], ['villager']]`.
	 */
	circles?:readonly (readonly string[])[];
	/** What `observer` knows of `target` besides: some of it, `true` for all of it, nothing for none. */
	knows?:(observer:NameObserver<TCtx>, target:NameTarget)=>readonly Knows[] | boolean | undefined;
	/** Each time a character learns something of another in play. Adds a listener. */
	onLearned?:(learnerID:string, ofID:string, learned:readonly Knows[])=>void;
};

/** What talk asks of acquaintance (`internalsOf`). */
export type AcquaintanceFields<TCtx> = FeatureFields<TCtx> & {
	/**
	 * `line`, by id from a speaker's words (`book` their name book), as a listener whose book is `hears` takes it: a name
	 * the speaker said, of one the listener cannot tell on sight, stays the word it heard (`Bram stole it`), so hearsay
	 * neither points at whom the listener sees nor tells it more than was said; a label the speaker said (the stranger it
	 * points at) stays who that is.
	 */
	hearsay(line:TextWithIDs, book:NameBook, hears:NameBook):TextWithIDs;
	/**
	 * `learn`, what `learnerID` (whose book is `book`) learns of `ofID`, done: each `onLearned` hears of it. Where it tied a
	 * label it had (`StrangerA`, `VoiceA`) to a name, how to tell its mind, once, when the caller is done.
	 */
	learning(learnerID:string, book:NameBook, ofID:string, learn:()=>Knows[]):(()=>void) | undefined;
	/** {@link AcquaintanceFeature.introduced}. */
	introduced(speakerID:string, spoken:string, to:readonly string[]):string[];
};

/**
 * Who knows whom (`withAcquaintance({ circles })`): each character knows another's look, voice and name apart
 * ({@link Knows}). Without it, everyone knows everyone's look and name. With it, characters are strangers but for those
 * of one collective, its circles, what a spec's `knows` and the `knows` rule say, and what they learn in play: a look
 * from seeing a face, a voice tied to it from seeing them speak, a name from hearing them say it of themselves (`I'm
 * Bram`) or from {@link introduce}. Whom a mind cannot tell it sees under a label of its own (`StrangerA`), kept until it
 * learns whose look that is, and a name it learns it remembers (`You learned that StrangerA is Bram.`). A real name it
 * could not tell on sight or by voice, written in a reply, is sent back. What each learned is saved in its name book.
 */
export class AcquaintanceFeature<TCtx = unknown> extends Feature<TCtx> {
	private _circles:readonly (readonly string[])[] = [];
	private _knows:AcquaintanceOptions<TCtx>['knows'];
	private readonly _onLearned:((learnerID:string, ofID:string, learned:readonly Knows[])=>void)[] = [];
	/** What each knows of each by the rules ({@link ruled}), as asked this tick: naming asks it many times a frame. */
	private readonly _ruled = new Map<string, readonly Knows[]>();

	constructor() {
		super();
		hand(this, {
			hearsay: (line, book, hears) => joinTextWithIDs(...line.map((part, i) => {
				const word = i % 2 === 1 && !hears.tells(part) ? book.knownName(part) : undefined;
				return i % 2 === 0 ? part : word ?? ['', part, ''];
			})),
			learning: (learnerID, book, ofID, learn) => this.learning(learnerID, book, ofID, learn),
			introduced: (speakerID, spoken, to) => this.introduced(speakerID, spoken, to),
		} satisfies Omit<AcquaintanceFields<TCtx>, keyof FeatureFields<TCtx>>);
	}

	public configure({ circles, knows, onLearned }:AcquaintanceOptions<TCtx>):this {
		this._circles = circles ?? this._circles;
		this._knows = knows ?? this._knows;
		this._ruled.clear();
		if (onLearned && !this._onLearned.includes(onLearned)) {
			this._onLearned.push(onLearned);
		}
		return this;
	}

	public override runnerAdded(runner:ArcRunner<TCtx>):void {
		runner.persona.names.knowsByRule = (id) => this.ruled(runner.id, id);
		this._ruled.clear();
	}

	public override characterMoved():void {
		this._ruled.clear();
	}

	public override beforeWatches():void {
		this._ruled.clear();
	}

	/** What `observerID`, a character or a collective, knows of `targetID`: by the rules, and what it learned. */
	public of(observerID:string, targetID:string):Knows[] {
		const runner = this.director.character(observerID) ?? this.director.collective(observerID);
		return [...runner?.persona.names.knows(targetID) ?? this.ruled(observerID, targetID)];
	}

	/**
	 * `to` learns `knows` of `who` (all of it by default), tied to what it knew as a learning ties it
	 * ({@link NameBook.learn}): the host's own way to introduce them (a handshake verb, a cutscene). Its mind remembers a
	 * name it learns.
	 */
	public introduce(who:string, to:string, knows:readonly Knows[] = KNOWS_ALL):void {
		const book = (this.director.character(to) ?? this.director.collective(to))?.persona.names;
		if (book) {
			this.learning(to, book, who, () => book.learn(who, knows))?.();
		}
	}

	/**
	 * Whether `spoken`, a line `speakerID` says, names them of themselves: their name right after `I am`, `I'm`, `my name
	 * is`, `name's`, `call me`, `I go by` or `it's me`, outside quotes and with nothing between, so "the guard captain
	 * wants you" and "I am the guard" name no one Guard. A name of several words (`JoeTheBaker`) may be written apart, in
	 * any case (`I'm Joe the baker`).
	 */
	public introduces(speakerID:string, spoken:string):boolean {
		return nameAfter(spoken, speakerID, INTRODUCTION);
	}

	/**
	 * Whom a line (`spoken` by `speakerID`, said `to` them) introduces: the speaker, where it says
	 * its own name ({@link introduces}); and each other character it names by their name the speaker knows, right after
	 * `that's`, `this is`, `he's`, `she's` or `meet` (`That is my friend Joe`, `meet Joe`), or said to them (`Joe, come
	 * here`). Who learns which face is theirs is the listener's to see.
	 */
	private introduced(speakerID:string, spoken:string, to:readonly string[]):string[] {
		// What the speaker knows, whether a mind thinks for it or the game speaks for it.
		const speaker = this.director.character(speakerID);
		const book = speaker?.mind?.persona.names ?? speaker?.persona.names;
		const others = this.director.characters().map((character) => character.id).filter((id) => id !== speakerID && book?.knowsByName(id));
		return [
			...this.introduces(speakerID, spoken) ? [speakerID] : [],
			...others.filter((id) => nameAfter(spoken, book!.knownName(id)!, POINTING) || (to.includes(id) && nameAfter(spoken, book!.knownName(id)!, WORD_START))),
		];
	}

	/** {@link AcquaintanceFields.learning}. */
	private learning(learnerID:string, book:NameBook, ofID:string, learn:()=>Knows[]):(()=>void) | undefined {
		// The labels it went by, that a name may come to stand behind.
		const look = book.tells(ofID) ? undefined : book.peek(ofID);
		const voice = book.ties(ofID, Knows.Voice, Knows.Name) ? undefined : book.peek(voiceOf(ofID));
		const learned = learn();
		if (learned.length === 0) {
			return undefined;
		}
		callEach('onLearned', this._onLearned, [learnerID, ofID, learned], (entry) => this.director.log(entry));
		const name = book.knownName(ofID);
		const was = look !== undefined && book.tells(ofID) ? look : voice !== undefined && book.ties(ofID, Knows.Voice, Knows.Name) ? voice : undefined;
		const mind = (this.director.character(learnerID) ?? this.director.collective(learnerID))?.mind;
		// Plain words, as told: it is the label that is now that name, wherever else it reads them still.
		return mind && was && name && was !== name ? () => mind.pushEvent({ kind: 'learned', text: `You learned that ${was} is ${name}.`, knownBy: [learnerID], tags: ['learned'] }) : undefined;
	}

	/** What `observerID` knows of `targetID` by the rules: itself, its collective, its circles, its spec's `knows`, the `knows` rule. */
	private ruled(observerID:string, targetID:string):readonly Knows[] {
		const key = `${observerID}>${targetID}`;
		const had = this._ruled.get(key);
		if (had) {
			return had;
		}
		const knows = this.ruledNow(observerID, targetID);
		this._ruled.set(key, knows);
		return knows;
	}

	/** {@link ruled}, asked anew. */
	private ruledNow(observerID:string, targetID:string):readonly Knows[] {
		const target = this.director.character(targetID);
		const collective = this.director.collective(observerID);
		if (!target || observerID === targetID || target.collective?.id === observerID) {
			return KNOWS_ALL;
		}
		if (collective) {
			return union(collective.characters.map((character) => this.ruled(character.id, targetID)), collective.persona.knows, target);
		}
		const observer = this.director.character(observerID);
		if (!observer || (observer.collective && observer.collective === target.collective) || this._circles.some((circle) => circle.some((e) => is(observer, e)) && circle.some((e) => is(target, e)))) {
			return KNOWS_ALL;
		}
		const director = this.director;
		const told = this._knows?.({ id: observerID, get ctx() {
			return director.contextOf(observerID);
		} }, { id: targetID, tags: target.tags });
		return union([told === true ? KNOWS_ALL : told || []], observer.persona.knows, target);
	}
}

/** What a speaker says its own name right after, of itself. */
const INTRODUCTION = /\b(?:i\s+am|i['’]?m|my\s+name\s+is|(?:my\s+)?name['’]s|call\s+me|i\s+go\s+by|it\s+is\s+me|it['’]s\s+me)(?:\s*,\s*|\s+)/gi;

/** What a speaker names someone else right after, pointing them out: `that is my friend`, `this is`, `she's`, `meet our`. */
const POINTING = /\b(?:(?:that|this|he|she)(?:\s+over\s+there)?(?:['’]s|\s+is)|meet)(?:\s+(?:my|our))?(?:\s+old)?(?:\s+friend)?(?:\s*,\s*|\s+)/gi;

/** Where any word starts: the name anywhere in the line, said to them. */
const WORD_START = /\b/g;

/**
 * Whether `spoken`, outside quotes, says `name` right after one of `frames` (nothing between). A name of several words
 * (`JoeTheBaker`) may be written apart, in any case (`Joe the baker`).
 */
function nameAfter(spoken:string, name:string, frames:RegExp):boolean {
	const words = displayName(name).split(' ');
	const found = words.length > 1 ? new RegExp(`${words.map(escape).join('\\s*')}\\b`, 'iy') : new RegExp(`${escape(name)}\\b`, 'y');
	const said = spoken.replace(/"[^"]*"|“[^”]*”/g, ' ');
	for (const frame of said.matchAll(frames)) {
		found.lastIndex = frame.index + frame[0].length;
		if (found.test(said)) {
			return true;
		}
	}
	return false;
}

function escape(text:string):string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether `character` is what a circle's or a spec's entry names: it, its collective, or a tag it has. */
function is<TCtx>(character:Character<TCtx>, entry:string):boolean {
	return entry === character.id || entry === character.collective?.id || character.tags.includes(entry);
}

/** `lists` together, with what `spec` (a persona's `knows`) says of `target`. */
function union<TCtx>(lists:readonly (readonly Knows[])[], spec:Readonly<Record<string, readonly Knows[] | true>> | undefined, target:Character<TCtx>):Knows[] {
	const said = Object.entries(spec ?? {}).filter(([entry]) => is(target, entry)).map(([, knows]) => (knows === true ? KNOWS_ALL : knows));
	return [...new Set([...lists, ...said].flat())];
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link AcquaintanceFeature}: `withAcquaintance({ circles: [['Mira', 'Bram']] })`. */
		withAcquaintance(options?:AcquaintanceOptions<TCtx>):this;
		getAcquaintance():AcquaintanceFeature<TCtx> | undefined;
	}
}
export function withAcquaintance<TCtx>(this:ArcDirector<TCtx>, options:AcquaintanceOptions<TCtx> = {}):ArcDirector<TCtx> {
	return this.configureFeature(AcquaintanceFeature<TCtx>, () => new AcquaintanceFeature<TCtx>().configure(options), (feature) => feature.configure(options));
}
