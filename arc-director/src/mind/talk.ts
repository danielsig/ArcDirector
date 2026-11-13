import type { ArcResult } from '../arc/arc-types.js';
import type { MindEvent } from './mind-types.js';

/**
 * Who hears speech for a mind: the runner it thinks for, a character on its own or a collective (`ArcRunner`).
 * The library never sees coordinates.
 */
export type TalkListener = {
	readonly id:string;
	/** The character that speaks for its mind. Its own lines are not heard back; its other characters' are. */
	readonly voice:{ readonly id:string };
	/** Names other characters as its mind calls them; without one, by id. */
	readonly mind:{ nameOf(id:string):string } | null;
	/** Tell its mind an event. A major one wakes it. */
	tell(event:MindEvent):void;
};

/**
 * Host-owned range, hearing, and pose. The library asks by name; the game
 * measures distance, what a voice carries past, and movement however it wants.
 */
export type TalkSense = {
	inRange:(speakerID:string, listenerID:string)=>boolean;
	/** Named beings this speaker might address. Host lists ids, never coordinates. */
	others:(speakerID:string)=>string[];
	/**
	 * Close enough to catch every word. If omitted, every in-range listener
	 * hears clearly. If false, talk muffles the line and tells them to
	 * get closer to the speaker if they care.
	 */
	clearHear?:(speakerID:string, listenerID:string)=>boolean;
	/**
	 * Whether this listener receives the line at all. If omitted, everyone in
	 * earshot hears it (clear or muffled). False drops them before delivery.
	 */
	hears?:(speakerID:string, listenerID:string)=>boolean;
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
};

export const DEFAULT_TALK_CONFIG:TalkConfig = {
	rehear: 8,
	repeats: false,
};

/** A line as `repeats` compares it: case, spacing and punctuation aside. */
export function wordsOf(spoken:string):string {
	return spoken.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** One addressee, or several when speaking to a group. */
export type SayTo = string | string[];

export type SpeechUtterance = {
	speakerID:string;
	text:string;
	to?:SayTo;
	heardBy:string[];
	timestamp:number;
};

/** A `say` result. `heard`: who heard it clearly. */
export type SayResult = ArcResult & { heard?:string[] };

export type Muffled = { speakerID:string; spoken:string; targets:string[]; until:number };

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

export function saysLine(speaker:string, spoken:string, addressed:boolean, toLabel:string, tail = ''):string {
	if (addressed) {
		return `${speaker} says to you${tail}: "${spoken}"`;
	}
	return toLabel ? `${speaker} says to ${toLabel}${tail}: "${spoken}"` : `${speaker} says${tail}: "${spoken}"`;
}

/** `speaker` and `toLabel` are already the listener's names for those characters. */
export function heardLine(
	speaker:string,
	spoken:string,
	addressed:boolean,
	toLabel:string,
	clear:boolean,
	mentioned:boolean,
):{ text:string; major:boolean } {
	// Wakes the listener only when it is meant for them: to them, naming them, or to everyone and clearly heard.
	// Talk between others is overheard: remembered, read on the next think, but no reason to think now.
	const major = addressed || mentioned || (clear && toLabel === '');
	if (clear) {
		return { major, text: saysLine(speaker, spoken, addressed, toLabel) };
	}
	const muff = muffleSpeech(spoken);
	const hint = `Get closer to ${speaker} to hear clearly.`;
	const named = mentioned && !addressed ? ' You hear yourself spoken of.' : '';
	return {
		major,
		text: addressed
			? `${speaker} is speaking to you, but you only catch: "${muff}". ${hint}`
			: `${speaker} is talking nearby. You catch: "${muff}". ${hint}${named}`,
	};
}

/** Whether any of `targets` is one of `names`, ignoring case. */
export function isNamed(targets:readonly string[], names:readonly string[]):boolean {
	return targets.some((t) => names.some((n) => n.toLowerCase() === t.toLowerCase()));
}

/** Whether `listener`'s own voice said it: a mind already knows what it said, so it does not hear it back. */
export function saidBy(listener:TalkListener, speakerID:string):boolean {
	return listener.voice.id === speakerID;
}
