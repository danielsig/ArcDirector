import type { ArcResult } from '../arc/arc-types.js';
import type { ConversationTurn, MindEvent } from './mind-types.js';

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
	 * hears clearly. If false, TalkNet muffles the line and tells them to
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
	/** Turn `who` to face `toward`. */
	face?:(who:string, toward:string)=>void;
	/** Close distance / move into view of `toward`. Fire-and-forget. */
	approach?:(who:string, toward:string)=>void;
};

/**
 * Whether a line flagged as a repeat may be said: `true` lets it through, `false` refuses it. A function decides each
 * one, given who says it (`TWho`: its id here; its context through the director's `withTalk`) and the line: `true`
 * lets it through, `false` refuses it, a string refuses it with that string as the reason.
 */
export type Repeats<TWho = string> = boolean | ((who:TWho, text:string)=>boolean | string);

export type TalkConfig<TWho = string> = {
	/** Seconds a muffled line stays catchable: come close enough in that time and it arrives in full. 0 = never. Default 8. */
	rehear:number;
	/** Face the person you speak to or hear, when you can see them. Default true. */
	face:boolean;
	/** Move closer and seek a clear view of them. Default true. */
	approach:boolean;
	/**
	 * Let a character say the line it said last again, or echo word for word the line it last heard. Default false:
	 * either is refused, so nobody parrots itself or anyone else. See {@link Repeats}.
	 */
	repeats:Repeats<TWho>;
};

export const DEFAULT_TALK_CONFIG:TalkConfig = {
	rehear: 8,
	face: true,
	approach: true,
	repeats: false,
};

/** A line as `repeats` compares it: case, spacing and punctuation aside. */
function wordsOf(spoken:string):string {
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

type Muffled = { speakerID:string; spoken:string; targets:string[]; until:number };

function addressees(to?:SayTo):string[] {
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
function speechMentionsName(spoken:string, names:readonly string[]):boolean {
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

function listenerNames(sense:TalkSense, id:string):string[] {
	const listed = sense.names?.(id);
	if (listed && listed.length > 0) {
		return listed;
	}
	return [id];
}

function uniqueNames(names:readonly string[]):string[] {
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

function saysLine(speaker:string, spoken:string, addressed:boolean, toLabel:string, tail = ''):string {
	if (addressed) {
		return `${speaker} says to you${tail}: "${spoken}"`;
	}
	return toLabel ? `${speaker} says to ${toLabel}${tail}: "${spoken}"` : `${speaker} says${tail}: "${spoken}"`;
}

/** `speaker` and `toLabel` are already the listener's names for those characters. */
function heardLine(
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
function isNamed(targets:readonly string[], names:readonly string[]):boolean {
	return targets.some((t) => names.some((n) => n.toLowerCase() === t.toLowerCase()));
}

/** Whether `listener`'s own voice said it: a mind already knows what it said, so it does not hear it back. */
function saidBy(listener:TalkListener, speakerID:string):boolean {
	return listener.voice.id === speakerID;
}

/**
 * Native NPC-to-NPC talk. `say` reaches whoever the host says is in range.
 * Attach listeners so their minds receive `HeardSpeech` events; unattached names can
 * still be addressed if `inRange` is true (mute characters, the player, …).
 *
 * After a successful `say`, TalkNet asks the host to face and approach so
 * speakers and listeners huddle into line of sight. Default on; pass
 * `{ face: false, approach: false }` to disable.
 */
export class TalkNet {
	private readonly _listeners = new Map<string, TalkListener>();
	private readonly _muffled = new Map<string, Muffled[]>();
	/** Each speaker's last line, by {@link wordsOf}. */
	private readonly _lastSaid = new Map<string, string>();
	/** The last line each character made out, by {@link wordsOf}, and who said it. */
	private readonly _lastHeard = new Map<string, { speakerID:string; words:string }>();
	public readonly config:TalkConfig;

	constructor(
		public readonly sense:TalkSense,
		private readonly _onSpoke?:(utterance:SpeechUtterance)=>void,
		config:Partial<TalkConfig> = {},
	) {
		this.config = { ...DEFAULT_TALK_CONFIG, ...config };
	}

	/**
	 * Listen for `listener` through the character `id` (default its own id). One listener may listen through several
	 * characters, as a collective does through each of its own; it hears each line once, from whichever heard it best.
	 */
	public attach(listener:TalkListener, id = listener.id):void {
		this._listeners.set(id, listener);
	}

	public detach(id:string):void {
		this._listeners.delete(id);
	}

	public has(id:string):boolean {
		return this.listenerFor(id) !== undefined;
	}

	/** Attach key, or a host-facing name that `names()` maps back to one (`Herbalist` for Fern). */
	private listenerFor(id:string):TalkListener | undefined {
		const direct = this._listeners.get(id);
		if (direct) {
			return direct;
		}
		const want = id.trim().toLowerCase();
		if (!want) {
			return undefined;
		}
		for (const [key, listener] of this._listeners) {
			if (key.toLowerCase() === want) {
				return listener;
			}
			if (listenerNames(this.sense, key).some((n) => n.trim().toLowerCase() === want)) {
				return listener;
			}
		}
		return undefined;
	}

	/** `id` as `observerID`'s mind names it. */
	private label(observerID:string, id:string):string {
		return this.listenerFor(observerID)?.mind?.nameOf(id) ?? id;
	}

	/** Ids currently close enough to talk to `speakerID`. */
	public nearby(speakerID:string):string[] {
		const out:string[] = [];
		for (const id of this.sense.others(speakerID)) {
			if (!id || id === speakerID) {
				continue;
			}
			if (this.sense.inRange(speakerID, id)) {
				out.push(id);
			}
		}
		return out;
	}

	/** Whether `listenerID` would make out `speakerID`'s words, not just hear them muffled. */
	public clear(speakerID:string, listenerID:string):boolean {
		return this.sense.clearHear?.(speakerID, listenerID) ?? true;
	}

	/**
	 * Whether `say` would deliver. Does not speak. Directed `to` must be in
	 * range; a broadcast needs at least one listener. Use this before committing
	 * a say arc, or from the `earshot` tool.
	 */
	public canSay(speakerID:string, to?:SayTo):{ ok:boolean; reason?:string; nearby:string[] } {
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
		for (const name of targets) {
			if (!this.sense.inRange(speakerID, name)) {
				return { ok: false, reason: `${this.label(speakerID, name)} is not in earshot`, nearby };
			}
		}
		return { ok: true, nearby };
	}

	public say(speakerID:string, text:string, to?:SayTo, timestamp = 0):SayResult {
		const spoken = text.trim();
		if (!spoken) {
			return { ok: false, verb: 'say', reason: 'nothing to say' };
		}
		const check = this.canSay(speakerID, to);
		if (!check.ok) {
			return { ok: false, verb: 'say', reason: check.reason };
		}
		const parrot = this.parrot(speakerID, spoken);
		if (parrot) {
			return { ok: false, verb: 'say', reason: parrot };
		}
		const targets = addressees(to);
		const heardBy = this.hearers(speakerID, targets);
		const addressedTo:SayTo | undefined = targets.length === 0
			? undefined
			: targets.length === 1
				? targets[0]
				: targets;
		const utterance:SpeechUtterance = {
			speakerID,
			text: spoken,
			to: addressedTo,
			heardBy,
			timestamp,
		};
		this.attend(utterance);
		this._onSpoke?.(utterance);
		const clearly:string[] = [];
		const reached = new Set<TalkListener>();
		const clearness = new Map(heardBy.map((id) => [id, this.clear(speakerID, id)]));
		// Clear hearers first, so a mind listening through several characters takes the clearest.
		for (const id of [...heardBy].sort((a, b) => Number(clearness.get(b)) - Number(clearness.get(a)))) {
			const clear = clearness.get(id) === true;
			if (clear && id !== speakerID) {
				clearly.push(id);
			}
			const listener = this.listenerFor(id);
			if (!listener || reached.has(listener) || saidBy(listener, speakerID)) {
				continue;
			}
			reached.add(listener);
			const names = this.namesFor(listener);
			const mentioned = speechMentionsName(spoken, names.ours);
			const heardTo = targets.map((t) => this.label(id, t));
			const speaker = this.label(id, speakerID);
			const heard = heardLine(speaker, spoken, isNamed(targets, names.you), heardTo.join(', '), clear, mentioned);
			// Said to any of its characters, it is meant for this mind, though only its voice is "you".
			this.hear(
				listener,
				speaker,
				heardTo,
				heard.text,
				heard.major || isNamed(targets, names.ours),
				timestamp,
				clear ? { speakerID, to: targets, text: spoken } : undefined,
			);
			if (!clear && this.config.rehear > 0) {
				const list = this._muffled.get(id) ?? [];
				list.push({ speakerID, spoken, targets, until: timestamp + this.config.rehear });
				this._muffled.set(id, list);
			}
		}
		const words = wordsOf(spoken);
		this._lastSaid.set(speakerID, words);
		for (const id of clearly) {
			this._lastHeard.set(id, { speakerID, words });
		}
		const names = (ids:string[]):string => ids.map((t) => this.label(speakerID, t)).join(', ');
		// Who it was for and could not make out the words, so the speaker knows the line did not land.
		const muffled = (targets.length > 0 ? targets : heardBy).filter((id) => id !== speakerID && heardBy.includes(id) && !clearly.includes(id));
		const said = targets.length > 0 ? `to ${names(targets)}` : clearly.length > 0 ? `heard by ${names(clearly)}` : 'no one made out the words';
		const far = muffled.length > 0 ? `; too far for ${names(muffled)} to make out the words: get closer` : '';
		return { ok: true, verb: 'say', reason: `${said}${far}`, heard: clearly };
	}

	/** Deliver muffled lines in full to listeners who came close enough. Call once per frame. */
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
				if (!listener || !(this.sense.clearHear?.(row.speakerID, id) ?? true)) {
					return !!listener;
				}
				const names = this.namesFor(listener);
				const addressed = isNamed(row.targets, names.you);
				const heardTo = row.targets.map((t) => this.label(id, t));
				const speaker = this.label(id, row.speakerID);
				const meant = isNamed(row.targets, names.ours) || row.targets.length === 0 || speechMentionsName(row.spoken, names.ours);
				this._lastHeard.set(id, { speakerID: row.speakerID, words: wordsOf(row.spoken) });
				this.hear(
					listener,
					speaker,
					heardTo,
					saysLine(speaker, row.spoken, addressed, heardTo.join(', '), ', now clear'),
					meant,
					now,
					{ speakerID: row.speakerID, to: row.targets, text: row.spoken },
				);
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
	private parrot(speakerID:string, spoken:string):string | undefined {
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
					? `${this.label(speakerID, heard.speakerID)} just said this, and it was heard: saying it again changes nothing, it was not wrong. You are not a parrot: say something of your own, or nothing. Remember, actions speak louder than words.`
					: undefined;
		const verdict = flagged && typeof rule === 'function' ? rule(speakerID, spoken) : false;
		return verdict === true ? undefined : typeof verdict === 'string' ? verdict : flagged;
	}

	/** The names a line uses when it is for `listener`: any character it listens through (`ours`), or its voice (`you`). */
	private namesFor(listener:TalkListener):{ ours:string[]; you:string[] } {
		const named = (ids:string[]):string[] => uniqueNames(ids.flatMap((id) => [id, ...listenerNames(this.sense, id)]));
		const listening = [...this._listeners].filter(([, m]) => m === listener).map(([id]) => id);
		return { ours: named([listener.id, ...listening]), you: named([listener.voice.id, listener.id]) };
	}

	private hear(
		listener:TalkListener,
		speaker:string,
		heardTo:string[],
		text:string,
		major:boolean,
		timestamp:number,
		turn?:ConversationTurn,
	):void {
		listener.tell({
			kind: 'HeardSpeech',
			text,
			tags: ['speech', speaker, ...heardTo],
			major,
			timestamp,
			remember: true,
			turn,
		});
	}

	private hearers(speakerID:string, targets:string[]):string[] {
		const nearby = this.nearby(speakerID);
		const heard = targets.length === 0
			? nearby
			: [...nearby, ...targets.filter((name) => !nearby.includes(name))];
		const allow = this.sense.hears;
		return allow ? heard.filter((id) => allow(speakerID, id)) : heard;
	}

	private attend(utterance:SpeechUtterance):void {
		if (!this.config.face && !this.config.approach) {
			return;
		}
		const speaker = utterance.speakerID;
		const targets = addressees(utterance.to);
		if (targets.length > 0) {
			for (const name of targets) {
				this.pair(speaker, name);
			}
			for (const id of utterance.heardBy) {
				if (!targets.includes(id)) {
					this.oneWay(id, speaker);
				}
			}
			return;
		}
		for (const peer of utterance.heardBy) {
			this.pair(speaker, peer);
		}
	}

	private pair(a:string, b:string):void {
		this.oneWay(a, b);
		this.oneWay(b, a);
	}

	private oneWay(who:string, toward:string):void {
		if (!who || !toward || who === toward) {
			return;
		}
		if (this.config.face) {
			this.sense.face?.(who, toward);
		}
		if (this.config.approach) {
			this.sense.approach?.(who, toward);
		}
	}
}
