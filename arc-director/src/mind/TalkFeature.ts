import { firstStep, type Arc, type ArcResult, type Step } from '../arc/arc-types.js';
import { argBase, groupTargets } from '../arc/stock-verbs.js';
import { sayToOf, type ArcRunner } from '../character/arc-runner.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { callEach } from '../director/director-types.js';
import { Feature, type FeatureTick } from '../director/Feature.js';
import { isRecord } from '../json.js';
import { wayBlocked } from '../world/geometry-kernels.js';
import { noWayTo } from '../world/route.js';
import type { Mind } from './mind.js';
import type { ArcFormat, ConversationTurn, Sense, ToolSpec } from './mind-types.js';
import { blockedAgainHint, sayRangeHint } from './prompt.js';
import {
	addressees,
	DEFAULT_TALK_CONFIG,
	heardLine,
	isNamed,
	listenerNames,
	saidBy,
	saysLine,
	speechMentionsName,
	uniqueNames,
	wordsOf,
	type Muffled,
	type SayResult,
	type SayTo,
	type SpeechUtterance,
	type TalkConfig,
	type TalkListener,
	type TalkSense,
} from './talk.js';

/** Lines kept to tell a repeat from something new. */
const SAID_CAP = 6;
/** Share of a new line's content words an earlier line already had that makes the new line old news. */
const REPEAT_OVERLAP = 0.6;
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

/** What `withTalk` takes: who is in range and how speakers and listeners act (its sense), and who hears every line. */
export type TalkOptions = TalkSense & Partial<TalkConfig> & {
	/** Every line said, as it is said: a bubble, a voice. Adds a listener. */
	onSpoke?:(utterance:SpeechUtterance)=>void;
};

/**
 * NPC-to-NPC talk (`withTalk({ inRange, others, onSpoke })`): `say` reaches whoever the host says is in range, as a
 * `HeardSpeech` event for the mind that listens through them, and speakers and listeners face and approach (`face`, `approach`).
 * Every mind gets the `earshot` sense and tool; a reply's `say` to someone out of earshot with no way there, or a verb
 * toward someone it found no way to while the way is still blocked, goes back to it. Added to a director it listens
 * through the cast's minds; on its own, through those `attach` gave it. The rules: the README's Talk and map.
 */
export class TalkFeature<TCtx = unknown> extends Feature<TCtx> {
	private readonly _listeners = new Map<string, TalkListener>();
	private readonly _muffled = new Map<string, Muffled[]>();
	/** Each speaker's last line, by {@link wordsOf}. */
	private readonly _lastSaid = new Map<string, string>();
	/** The last line each character made out, by {@link wordsOf}, and who said it. */
	private readonly _lastHeard = new Map<string, { speakerID:string; words:string }>();
	private readonly _minds = new WeakMap<Mind<TCtx>, Spoken>();
	private readonly _onSpoke:((utterance:SpeechUtterance)=>void)[] = [];
	public readonly config:TalkConfig = { ...DEFAULT_TALK_CONFIG };

	private _sense:TalkSense;

	constructor(options:TalkOptions) {
		super();
		this._sense = options;
		this.configure(options);
	}

	/** Who is in range, and how speakers and listeners face and approach (`TalkSense`). */
	public get sense():TalkSense {
		return this._sense;
	}

	/** Talk through this sense from now on; the config it names is set, and its listener added once. */
	public configure({ onSpoke, rehear = this.config.rehear, repeats = this.config.repeats, ...sense }:TalkOptions):this {
		this._sense = sense;
		Object.assign(this.config, { rehear, repeats });
		if (onSpoke && !this._onSpoke.includes(onSpoke)) {
			this._onSpoke.push(onSpoke);
		}
		return this;
	}

	public override readonly order = 40;

	public override install():void {
		this.director.withSenses((s) => s.add('earshot', this.earshot)).withTools((t) => t.add('earshot', this.tool));
	}

	public override afterMoves({ now }:FeatureTick):void {
		this.tick(now);
	}

	/**
	 * Listen for `listener` through the character `id` (default its own id), while it is on no director. One listener may
	 * listen through several characters, as a collective does through each of its own; it hears each line once, from
	 * whichever heard it best.
	 */
	public attach(listener:TalkListener, id = listener.id):void {
		this._listeners.set(id, listener);
	}

	public detach(id:string):void {
		this._listeners.delete(id);
	}

	/** Each listener by a character it listens through: on a director, the mind of each in the cast that has one. */
	private listeners():[string, TalkListener][] {
		if (!this.attached) {
			return [...this._listeners];
		}
		return [...this.director.characters(), ...this.director.collectives()].flatMap((runner) => (runner.owner ? [[runner.id, runner.owner] as [string, TalkListener]] : []));
	}

	/** Attach key, or a host-facing name that `names()` maps back to one (`Herbalist` for Fern). */
	private listenerFor(id:string):TalkListener | undefined {
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

	/** Whether `listenerID` would make out `speakerID`'s words, not just hear them muffled. */
	public clear(speakerID:string, listenerID:string):boolean {
		return this.sense.clearHear?.(speakerID, listenerID) ?? true;
	}

	/** Whether `say` would deliver, without speaking: whoever it is `to` in range, or for a line to all, someone. */
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
			return { status: 'failed', verb: 'say', reason: 'nothing to say' };
		}
		const check = this.canSay(speakerID, to);
		if (!check.ok) {
			return { status: 'failed', verb: 'say', reason: check.reason };
		}
		const parrot = this.parrot(speakerID, spoken);
		if (parrot) {
			return { status: 'failed', verb: 'say', reason: parrot };
		}
		const targets = addressees(to);
		const heardBy = this.hearers(speakerID, targets);
		const utterance:SpeechUtterance = { speakerID, text: spoken, to: targets.length > 1 ? targets : targets[0], heardBy, timestamp };
		this.attend(utterance);
		callEach('onSpoke', this._onSpoke, [utterance], this.attached ? (entry) => this.director.log(entry) : undefined);
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
			this.hear(listener, speaker, heardTo, heard.text, heard.major || isNamed(targets, names.ours), timestamp, clear ? { speakerID, to: targets, text: spoken } : undefined);
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
		return { status: 'ok', verb: 'say', reason: `${said}${far}`, heard: clearly };
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
				if (!listener || !this.clear(row.speakerID, id)) {
					return !!listener;
				}
				const names = this.namesFor(listener);
				const addressed = isNamed(row.targets, names.you);
				const heardTo = row.targets.map((t) => this.label(id, t));
				const speaker = this.label(id, row.speakerID);
				const meant = isNamed(row.targets, names.ours) || row.targets.length === 0 || speechMentionsName(row.spoken, names.ours);
				this._lastHeard.set(id, { speakerID: row.speakerID, words: wordsOf(row.spoken) });
				const text = saysLine(speaker, row.spoken, addressed, heardTo.join(', '), ', now clear');
				this.hear(listener, speaker, heardTo, text, meant, now, { speakerID: row.speakerID, to: row.targets, text: row.spoken });
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
		const listening = this.listeners().filter(([, m]) => m === listener).map(([id]) => id);
		return { ours: named([listener.id, ...listening]), you: named([listener.voice.id, listener.id]) };
	}

	private hear(listener:TalkListener, speaker:string, heardTo:string[], text:string, major:boolean, timestamp:number, turn?:ConversationTurn):void {
		listener.tell({ kind: 'HeardSpeech', text, tags: ['speech', speaker, ...heardTo], major, timestamp, remember: true, turn });
	}

	private hearers(speakerID:string, targets:string[]):string[] {
		const nearby = this.nearby(speakerID);
		const heard = [...nearby, ...targets.filter((name) => !nearby.includes(name))];
		const allow = this.sense.hears;
		return allow ? heard.filter((id) => allow(speakerID, id)) : heard;
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
	public readonly earshot:Sense<TCtx> = (_ctx, mind) => (mind.voice.embodied ? this.earshotText(mind) : undefined);

	public get tool():ToolSpec<TCtx> {
		return {
			description: 'Who is in range right now. Who you can say(to) is this list. Pass to to check one name before you arc a say. Out of range: error, no speech; get closer first. Omit to to list everyone in range.',
			parameters: { type: 'object', additionalProperties: false, properties: { to: { type: 'string' } } },
			offered: (mind) => mind.voice.embodied,
			handler: (_ctx, args, mind) => {
				const to = isRecord(args) && typeof args.to === 'string' ? args.to.trim() : '';
				const nearby = this.nearby(mind.thinkThread()).map((id) => mind.nameOf(id));
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
		const meantFor = mind && gist.size >= 3 ? [sayToOf(step.args) ?? this.nearby(mind.thinkThread())].flat() : [];
		const echo = mind && this.spoken(mind).said.find((line) => [...gist].filter((w) => line.gist.has(w)).length / gist.size >= REPEAT_OVERLAP
			&& meantFor.length > 0 && meantFor.every((id) => line.heard.has(id)))?.text;
		if (echo) {
			return { status: 'failed', verb: 'say', reason: `they already heard you say that ("${echo}"). Saying it again changes nothing: act on it, or say something new` };
		}
		const result = await runner.speak(step);
		if (mind && result.status === 'ok' && text) {
			const spoken = this.spoken(mind);
			spoken.said = [...spoken.said, { gist, text, heard: new Set(result.heard ?? []) }].slice(-SAID_CAP);
			mind.noteConversation({ speakerID: mind.thinkThread(), to: [sayToOf(step.args) ?? []].flat(), text });
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
		const nearby = this.nearby(voiceID);
		const ways = this.ways(voiceID, nearby);
		const names = nearby.map((id, i) => {
			const blocked = ways?.[i];
			const marks = [
				!this.clear(voiceID, id) && 'too far to make out your words',
				blocked !== undefined && (blocked ? `unreachable, blocked on the way: ${blocked}` : 'unreachable'),
			].filter(Boolean);
			return marks.length > 0 ? `${mind.nameOf(id)} (${marks.join('; ')})` : mind.nameOf(id);
		});
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
			return noWayTo(mind.nameOf(id), why);
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
		const nearby = check.nearby.map((id) => mind.nameOf(id));
		const ids = [to ?? []].flat();
		const ways = to !== undefined && !ids.includes(voiceID) ? this.ways(voiceID, ids) : undefined;
		if (ways) {
			const i = ways.findIndex((why) => why !== undefined);
			return i < 0 ? undefined : { reason: noWayTo(mind.nameOf(ids[i]), ways[i]!), nearby };
		}
		return { reason: check.reason ?? 'not in earshot', nearby };
	}

	/** Why there is no way from `from` to each of `ids` (`wayBlocked`), one look for all; unknown while it is on no director. */
	protected ways(from:string, ids:readonly string[]):(string | undefined)[] | undefined {
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
		/** {@link TalkFeature}: `withTalk({ inRange, others, face, onSpoke, rehear: 5 })`. */
		withTalk(options:TalkOptions):this;
		getTalk():TalkFeature<TCtx> | undefined;
	}
}
export function withTalk<TCtx>(this:ArcDirector<TCtx>, options:TalkOptions):ArcDirector<TCtx> {
	return this.configureFeature(TalkFeature<TCtx>, () => new TalkFeature<TCtx>(options), (talk) => talk.configure(options));
}
