import type { ArcResult } from '../arc/types.js';
import type { AgentEvent } from './types.js';

/** A mind that can receive speech. The library never sees coordinates. */
export type TalkMind = {
	id:string;
	pushEvent(event:AgentEvent):void;
};

/**
 * Host-owned range, sight, and pose. The library asks by name; the game
 * measures distance, LOS, and walking however it wants.
 */
export type TalkSense = {
	inRange:(speakerID:string, listenerID:string)=>boolean;
	/** Named beings this speaker might address. Host lists ids, never coordinates. */
	others:(speakerID:string)=>string[];
	/** Clear view. If omitted, TalkNet treats everyone in range as visible. */
	canSee?:(aID:string, bID:string)=>boolean;
	/**
	 * Close enough to catch every word. If omitted, every in-range listener
	 * hears clearly. If false, TalkNet muffles the line and tells them to
	 * go_to the speaker if they care.
	 */
	clearHear?:(speakerID:string, listenerID:string)=>boolean;
	/** Names that count as this listener (id, chosen name, aliases). Default `[id]`. */
	names?:(listenerID:string)=>string[];
	/** Turn `who` to face `toward`. */
	face?:(who:string, toward:string)=>void;
	/** Close distance / walk into view of `toward`. Fire-and-forget. */
	approach?:(who:string, toward:string)=>void;
};

export type TalkConfig = {
	/** Face the person you speak to or hear, when you can see them. Default true. */
	face:boolean;
	/** Walk closer and seek a clear view of them. Default true. */
	approach:boolean;
};

export const DEFAULT_TALK_CONFIG:TalkConfig = {
	face: true,
	approach: true,
};

/** One addressee, or several when speaking to a group. */
export type SayTo = string | string[];

export type SpeechUtterance = {
	speakerID:string;
	text:string;
	to?:SayTo;
	heardBy:string[];
	at:number;
};

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
export function muffleSpeech(spoken:string):string {
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

const ROLE_STOP = new Set([
	'the', 'a', 'an', 'you', 'are', 'i', 'am', 'not', 'and', 'for', 'with', 'your',
	'their', 'this', 'that', 'from', 'into', 'do', 'don', 'street', 'pay',
]);

/**
 * Short titles from a role string. Ignores the long instruction blob; keeps
 * "names you X", "You are Name, miller of the cottage", and brief revised roles.
 */
export function roleMentionTitles(role:string):string[] {
	const text = role.trim();
	if (!text) {
		return [];
	}
	const out:string[] = [];
	const add = (raw:string | undefined):void => {
		const title = raw?.trim().replace(/[.,;:]+$/u, '');
		if (!title || title.length < 3 || title.length > 48) {
			return;
		}
		if (out.some((row) => row.toLowerCase() === title.toLowerCase())) {
			return;
		}
		out.push(title);
	};
	for (const m of text.matchAll(/\bnames you ([A-Za-z][A-Za-z0-9]*)/gi)) {
		add(m[1]);
	}
	const youAre = text.match(/^You are ([A-Za-z][A-Za-z0-9]*)\b/i);
	if (youAre && !ROLE_STOP.has(youAre[1].toLowerCase())) {
		add(youAre[1]);
	}
	const appositive = text.match(/^You are [A-Za-z][A-Za-z0-9]*,\s+(?:a |an )?([^.]{3,48})/i);
	if (appositive) {
		add(appositive[1]);
		const head = appositive[1].trim().split(/\s+/)[0]?.replace(/[^A-Za-z0-9-]/g, '');
		if (head && !ROLE_STOP.has(head.toLowerCase())) {
			add(head);
		}
	}
	if (text.length <= 80) {
		const first = text.split(/[.!?]/)[0];
		if (first && first.split(/\s+/).length <= 6 && !/^You are\b/i.test(first)) {
			add(first);
		}
		if (text.split(/\s+/).length <= 6 && !/^You are\b/i.test(text)) {
			add(text);
		}
	}
	return out;
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

function heardLine(
	speakerID:string,
	spoken:string,
	listenerID:string,
	targets:string[],
	clear:boolean,
	mentioned:boolean,
	aliases:readonly string[] = [],
):{ text:string; major:boolean } {
	const known = uniqueNames([listenerID, ...aliases]);
	const addressed = targets.some((t) => known.some((n) => n.toLowerCase() === t.toLowerCase()));
	const toLabel = targets.join(', ');
	const major = clear || addressed || mentioned;
	if (clear) {
		return {
			major,
			text: addressed
				? `${speakerID} says to you: "${spoken}"`
				: toLabel
					? `${speakerID} says to ${toLabel}: "${spoken}"`
					: `${speakerID} says: "${spoken}"`,
		};
	}
	const muff = muffleSpeech(spoken);
	const hint = `go_to(${speakerID}) if you want to hear clearly.`;
	const named = mentioned && !addressed ? ' You hear yourself spoken of.' : '';
	return {
		major,
		text: addressed
			? `${speakerID} is speaking to you, but you only catch: "${muff}". ${hint}`
			: `${speakerID} is talking nearby. You catch: "${muff}". ${hint}${named}`,
	};
}

/**
 * Native NPC-to-NPC talk. `say` reaches whoever the host says is in range.
 * Attach agents so they receive `HeardSpeech` events; unattached names can
 * still be addressed if `inRange` is true (mute bodies, the player, …).
 *
 * After a successful `say`, TalkNet asks the host to face and approach so
 * speakers and listeners huddle into line of sight. Default on; pass
 * `{ face: false, approach: false }` to disable.
 */
export class TalkNet {
	private readonly minds = new Map<string, TalkMind>();
	readonly config:TalkConfig;

	constructor(
		readonly sense:TalkSense,
		private readonly onSpoke?:(utterance:SpeechUtterance)=>void,
		config:Partial<TalkConfig> = {},
	) {
		this.config = { ...DEFAULT_TALK_CONFIG, ...config };
	}

	attach(mind:TalkMind):void {
		this.minds.set(mind.id, mind);
	}

	detach(id:string):void {
		this.minds.delete(id);
	}

	has(id:string):boolean {
		return this.mindFor(id) !== undefined;
	}

	/**
	 * Attach key, or a host-facing name that `names()` maps back to one.
	 * After a chosen-name reveal the world may list "Oat" while the mind
	 * is still attached as "Miller".
	 */
	private mindFor(id:string):TalkMind | undefined {
		const direct = this.minds.get(id);
		if (direct) {
			return direct;
		}
		const want = id.trim().toLowerCase();
		if (!want) {
			return undefined;
		}
		for (const [key, mind] of this.minds) {
			if (key.toLowerCase() === want) {
				return mind;
			}
			if (listenerNames(this.sense, key).some((n) => n.trim().toLowerCase() === want)) {
				return mind;
			}
		}
		return undefined;
	}

	/** Names currently close enough to talk to `speakerID`. */
	nearby(speakerID:string):string[] {
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

	/**
	 * Whether `say` would deliver. Does not speak. Directed `to` must be in
	 * range; a broadcast needs at least one listener. Use this before committing
	 * a say arc, or from the `earshot` tool.
	 */
	canSay(speakerID:string, to?:SayTo):{ ok:boolean; reason?:string; nearby:string[] } {
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
				return { ok: false, reason: `${name} is not in earshot`, nearby };
			}
		}
		return { ok: true, nearby };
	}

	say(speakerID:string, text:string, to?:SayTo, at = 0):ArcResult {
		const spoken = text.trim();
		if (!spoken) {
			return { ok: false, verb: 'say', reason: 'nothing to say' };
		}
		const check = this.canSay(speakerID, to);
		if (!check.ok) {
			return { ok: false, verb: 'say', reason: check.reason };
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
			at,
		};
		this.attend(utterance);
		this.onSpoke?.(utterance);
		const toLabel = targets.join(', ');
		for (const id of heardBy) {
			const mind = this.mindFor(id);
			if (!mind) {
				continue;
			}
			const names = uniqueNames([
				id,
				mind.id,
				...listenerNames(this.sense, id),
				...listenerNames(this.sense, mind.id),
			]);
			const clear = this.sense.clearHear?.(speakerID, id) ?? true;
			const mentioned = speechMentionsName(spoken, names);
			const heard = heardLine(speakerID, spoken, id, targets, clear, mentioned, names);
			mind.pushEvent({
				kind: 'HeardSpeech',
				text: heard.text,
				tags: ['speech', speakerID, ...targets],
				major: heard.major,
				at,
			});
		}
		if (targets.length > 0) {
			return { ok: true, verb: 'say', reason: `to ${toLabel}` };
		}
		return { ok: true, verb: 'say', reason: `heard by ${heardBy.join(', ')}` };
	}

	private hearers(speakerID:string, targets:string[]):string[] {
		const nearby = this.nearby(speakerID);
		if (targets.length === 0) {
			return nearby;
		}
		const extra = targets.filter((name) => !nearby.includes(name));
		return extra.length === 0 ? nearby : [...nearby, ...extra];
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
