import type { ArcResult } from '../arc/arc-types.js';
import type { Feeling } from '../character/feeling.js';
import { SPEAKING, type Sound } from '../perception/hearing.js';
import type { ArcRunner } from '../character/arc-runner.js';
import { joinTextWithIDs, listIDs, showTextWithIDs, type TextSegment, type TextWithIDs } from '../character/text-with-ids.js';

/**
 * How a line may be said, `say(as)`: declared by the speaker, never read off the text; without `as`, plainly. The
 * stock tones are {@link SAY_TONES}; a host adds its own with `withTalk({ tones })`, and `say`'s `as` lists them all.
 */
export const SayTone = { Whisper: 'whisper', Sing: 'sing', Laugh: 'laugh', Sob: 'sob', Sigh: 'sigh', Scream: 'scream', Shout: 'shout' } as const;
export type SayTone = (typeof SayTone)[keyof typeof SayTone] | (string & {});

/**
 * What a tone is: the verb its line is told with (`whispers`), how loud its words are, 0–1 (plainly {@link SPEAKING}),
 * the `sound` the voice makes besides, heard past the words (a scream carries farther than what it says), and whether it
 * `wakes` everyone who hears it at once, whomever it is said to.
 */
export type SayToneDef = { says:string; words:number; sound?:Sound; wakes?:boolean };

export const SAY_TONES:Readonly<Record<(typeof SayTone)[keyof typeof SayTone], SayToneDef>> = {
	whisper: { says: 'whispers', words: 0.02 },
	sing: { says: 'sings', words: SPEAKING, sound: { name: 'singing', loudness: 0.3 } },
	laugh: { says: 'laughs', words: SPEAKING, sound: { name: 'laughter', loudness: 0.3 } },
	sob: { says: 'sobs', words: 0.08, sound: { name: 'sobbing', loudness: 0.15 }, wakes: true },
	sigh: { says: 'sighs', words: 0.08 },
	scream: { says: 'screams', words: 0.6, sound: { name: 'a scream', loudness: 1 }, wakes: true },
	shout: { says: 'shouts', words: 0.6, wakes: true },
};

/**
 * How often and what a character says unasked: each value is the standing instruction itself, shown with who is in
 * earshot. A game writes its own text where none fits. Set per character (`addCharacter({ talk })`, a
 * {@link TalkStyle}) or for everyone (`withTalk({ instructions })`); with neither, the prompt says nothing of it. A
 * port makes it a constants class (`TalkInstructions.Banter`), its type a plain string. No example lines: a small
 * model says them word for word.
 */
export const TalkInstructions = {
	/** Speaks only when spoken to or when something important happens. */
	Quiet: 'Speak only when spoken to or when something important happens: one short say step of 3 to 7 words, in your own voice. Never boring small talk. Chatter is never an order.',
	/** Answers what just happened or was said, and keeps quiet otherwise. */
	Reactive: 'Speak only when something just happened or someone spoke to you: then add one say step of 3 to 7 words, in your own voice, reacting to it. On a quiet think, say nothing. Never boring small talk. Never repeat a line already said. Chatter is never an order.',
	/** Teases, jokes and frets now and then, as the moment allows: a company on the road. */
	Banter: 'Now and then, banter: one say step of 3 to 7 words, teasing a friend, a dry joke, or a nervous word when danger is close, as your traits would have it. Fit the moment: in danger short and sharp, after it warm or funny, in quiet moments mostly silence. Never boring small talk. Never a line already said. Chatter is never an order.',
} as const;
export type TalkInstructions = (typeof TalkInstructions)[keyof typeof TalkInstructions] | (string & {});

/** How one character talks: its {@link TalkInstructions} (the director's without; `''` for none), and topics it never mentions. */
export type TalkStyle = { instructions?:TalkInstructions; avoid?:readonly string[] };

/** The talk line `style` makes, the director's `instructions` where it has none of its own: nothing without an instruction. */
export function talkLine(style:TalkStyle | undefined, instructions:TalkInstructions | undefined):string | undefined {
	const text = (style?.instructions ?? instructions)?.trim();
	const avoid = style?.avoid ?? [];
	if (!text) {
		return undefined;
	}
	return avoid.length > 0 ? `${text} Never mention ${avoid.length > 1 ? `${avoid.slice(0, -1).join(', ')} or ` : ''}${avoid[avoid.length - 1]}.` : text;
}

/**
 * Host-owned range, hearing, and pose. The library asks by name; the game measures distance and movement however it
 * wants, and how clearly a line is heard is hearing's unless it says otherwise (`heardAs`).
 */
export type TalkSense = {
	inRange:(speakerID:string, listenerID:string)=>boolean;
	/** Named beings this speaker might address. Host lists ids, never coordinates. */
	others:(speakerID:string)=>string[];
	/**
	 * How a listener in range hears a line said `as` a tone (plainly without one): its `words`, only `muffled`
	 * (talk tells them to get closer if they care), or nothing. Default: hearing's measure (`withHearing`), the line's
	 * level at the listener against the noise there; without hearing, every word.
	 */
	heardAs?:(speakerID:string, listenerID:string, as?:SayTone)=>'words' | 'muffled' | undefined;
	/**
	 * Whether this listener receives the line at all. If omitted, everyone in
	 * earshot hears it (clear or muffled). False drops them before delivery.
	 */
	hears?:(speakerID:string, listenerID:string)=>boolean;
	/**
	 * Whether `speakerID` would speak to `listenerID` at all: not to a foe. A line said to no one in particular names
	 * only those it would among the hearers too far to make out its words. Default: everyone.
	 */
	addresses?:(speakerID:string, listenerID:string)=>boolean;
	/** Names that count as this listener (id, role, aliases). Default `[id]`. */
	names?:(listenerID:string)=>string[];
	/** Turn `who` to face `toward`, when one speaks to or hears the other. Omitted: nobody turns. */
	face?:(who:string, toward:string)=>void;
	/** Close distance / move into view of `toward`. Fire-and-forget. Omitted: nobody moves. */
	approach?:(who:string, toward:string)=>void;
};

/**
 * Whether a line flagged as a repeat may be said: `true` lets it through, `false` refuses it. A function decides each
 * one, given the speaker's id and the line: `true` lets it through, `false` refuses it, a string refuses it with that
 * string as the reason.
 */
export type Repeats = boolean | ((speakerID:string, text:string)=>boolean | string);

export type TalkConfig = {
	/** Seconds a muffled line stays catchable: come close enough in that time and it arrives in full. 0 = never. Default 8. */
	rehear:number;
	/**
	 * Let a character say the line it said last again, or echo word for word the line it last heard. Default false:
	 * either is refused, so nobody parrots itself or anyone else. See {@link Repeats}.
	 */
	repeats:Repeats;
	/**
	 * Seconds after a line someone said near a character in which that character's line to no one in particular is said
	 * to them, while they are in earshot; past it, such a line is said to the only one in earshot, if just one is. 0 = to
	 * the only one only. Default 20.
	 */
	replyWindow:number;
	/** Seconds in which lines said to no one in particular wake a listener at most once. Default 20. */
	untargetedWakeCooldown:number;
	/** Meters within which two characters facing each other talk to each other: each one's lines wake the other at once. 0 = never. Default 4. */
	faceToFaceRange:number;
	/** How every character without a {@link TalkStyle} of its own talks unasked ({@link TalkInstructions}). Default none: the prompt says nothing of it. */
	instructions?:TalkInstructions;
};

export const DEFAULT_TALK_CONFIG:TalkConfig = {
	rehear: 8,
	repeats: false,
	replyWindow: 20,
	untargetedWakeCooldown: 20,
	faceToFaceRange: 4,
	instructions: undefined,
};

/** A line as `repeats` compares it: case, spacing and punctuation aside. */
export function wordsOf(spoken:string):string {
	return spoken.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** One addressee, or several when speaking to a group. */
export type SayTo = string | string[];

export type SpeechUtterance = {
	speakerID:string;
	/** The line as a screen shows it, in its speaker's names: `Old Bram` for a character, `silver trout` for a thing. */
	text:string;
	/** {@link text} in pieces, each naming someone or something by `id` apart from plain text. Built when asked. */
	segments():TextSegment[];
	to?:SayTo;
	heardBy:string[];
	timestamp:number;
	/** The tone it was said in; plainly without one. */
	as?:SayTone;
	/** The feeling its speaker showed as it was said (`withFeelings`), so a voice and a gesture carry it with the tone. */
	feeling?:Feeling;
};

/** A `say` result. `heard`: who heard it clearly; `to`: whom it was said to, as written or as talk addressed it. */
export type SayResult = ArcResult & { heard?:string[]; to?:string[] };

export type Muffled = { speakerID:string; spoken:string; said:TextWithIDs; targets:string[]; until:number; as?:SayTone; feeling?:Feeling };

export function addressees(to?:SayTo):string[] {
	if (to == null) {
		return [];
	}
	const list = Array.isArray(to) ? to : [to];
	const out:string[] = [];
	for (const name of list) {
		const n = name.trim();
		if (n && !out.includes(n)) {
			out.push(n);
		}
	}
	return out;
}

/** Keep word shape but hide most letters so a far listener must move closer. */
function muffleSpeech(spoken:string):string {
	return spoken.replace(/[A-Za-z]+/g, (word) => {
		if (word.length <= 2) {
			return word;
		}
		const keep = word.length <= 4 ? 1 : 2;
		return word.slice(0, keep) + '—'.repeat(Math.min(word.length - keep, 6));
	});
}

/** True when `spoken` names someone (word boundary, optional `'s`). */
export function speechMentionsName(spoken:string, names:readonly string[]):boolean {
	for (const raw of names) {
		const name = raw.trim();
		if (name.length < 3) {
			continue;
		}
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const re = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:'s)?(?![A-Za-z0-9])`, 'i');
		if (re.test(spoken)) {
			return true;
		}
	}
	return false;
}

export function listenerNames(sense:TalkSense, id:string):string[] {
	const listed = sense.names?.(id);
	if (listed && listed.length > 0) {
		return listed;
	}
	return [id];
}

export function uniqueNames(names:readonly string[]):string[] {
	const out:string[] = [];
	for (const raw of names) {
		const name = raw.trim();
		if (!name) {
			continue;
		}
		if (out.some((row) => row.toLowerCase() === name.toLowerCase())) {
			continue;
		}
		out.push(name);
	}
	return out;
}

/**
 * A line as heard clearly, told as it was said (`manner`): `[Ann] shouts angrily to [Bob]: "Run!"`, plainly `says`.
 * Speaker, listeners and whom the line names are ids, for each reader to name: Bob reads `to you`.
 */
export function saysLine(speaker:string, spoken:TextWithIDs, to:readonly string[], tail = '', manner?:string):TextWithIDs {
	const says = manner ?? 'says';
	const toWhom = to.length > 0 ? joinTextWithIDs(' to ', listIDs(to)) : '';
	return joinTextWithIDs(listIDs([speaker]), ` ${says}`, toWhom, `${tail}: "`, spoken, '"');
}

/** How a listener hears `spoken`, `speaker` and `to` by id. */
export function heardLine(
	speaker:string,
	spoken:TextWithIDs,
	addressed:boolean,
	to:readonly string[],
	clear:boolean,
	mentioned:boolean,
	manner?:string,
):TextWithIDs {
	if (clear) {
		return saysLine(speaker, spoken, to, '', manner);
	}
	const muff = muffleSpeech(showTextWithIDs(spoken));
	const who = listIDs([speaker]);
	const named = mentioned && !addressed ? ' You hear yourself spoken of.' : '';
	return addressed
		? joinTextWithIDs(who, ` ${manner ?? 'is speaking'} to you, but you only catch: "${muff}". Get closer to `, who, ' to hear clearly.')
		: joinTextWithIDs(who, ` ${manner ?? 'is talking'} nearby. You catch: "${muff}". Get closer to `, who, ` to hear clearly.${named}`);
}

/** Whether any of `targets` is one of `names`, ignoring case. */
export function isNamed(targets:readonly string[], names:readonly string[]):boolean {
	return targets.some((t) => names.some((n) => n.toLowerCase() === t.toLowerCase()));
}

/**
 * Whether `listener`'s own voice said it: a mind already knows what it said, so it does not hear it back. A listener is
 * the runner a mind thinks for (`ArcRunner.owner`): a character on its own, or a collective, which hears through each of
 * its characters and its voice's lines through none.
 */
export function saidBy<TCtx>(listener:ArcRunner<TCtx>, speakerID:string):boolean {
	return listener.voice.id === speakerID;
}
