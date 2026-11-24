import { parseTextWithIDs } from './text-with-ids.js';
import { internalsOf } from '../internals.js';
import { isRecord } from '../json.js';
import { MemoryStore, nameTags, type MemoryDraft } from '../memory/store.js';
import { NameBook, type Knows, type NameBookJSON } from './NameBook.js';
import type { SightField } from '../perception/sight.js';
import type { FeelingLevels } from './feeling.js';
import { GOAL_PINNED_THINKS, type Identity, type Goal, type WatchInput, type Watches } from './character-types.js';
import {
	applyWatchOps,
	asWatches,
	copyWatches,
	extrasWithoutPins,
	findWatchName,
	hasWatch,
	mergePinnedWatches,
	watchCount,
	watchExprs,
} from './watch.js';
import {
	asFocusList,
	DEFAULT_MAX_SIGHT_FOCUS,
	effectiveSightFocus,
	extrasWithoutPinnedFocus,
	mergePinnedFocus,
} from './focus.js';

/**
 * What the host gives a persona. Pinned watches, sight focus and memories are the host's; the rest a mind may
 * edit. Watches and sight focus are written in ids.
 */
export type PersonaSpec = {
	identity?:Identity;
	/** Each `until` test takes the context of whoever owns the persona, which the persona itself never needs to know. */
	goals?:Goal<never>[];
	maxGoals?:number;
	/** Pinned ones are kept up to date from the spec, matched by their first two tags. */
	memories?:MemoryDraft[];
	/**
	 * What it cares about, in its own words (`I love fishing.`, `Old books are my passion.`): where the director has an
	 * embedding model, memories like these come to mind unbidden more readily, as a mood's do. From the host's spec.
	 */
	interests?:readonly string[];
	/**
	 * What it feels whatever happens, 0 to 1 (`withFeelings`): its feelings never fade below these, which color what comes
	 * to mind without showing on its face. A paranoid one `{ afraid: 0.3, stressed: 0.3 }`. From the host's spec.
	 */
	disposition?:FeelingLevels;
	/**
	 * How strongly it is stirred (`withFeelings`): what memories, sightings, verbs and `stir` do to it is multiplied by
	 * this, per feeling (`{ angry: 2, loving: 0.3 }`: quick to anger, cold) or all at once (`0.3` stoic, `2` emotional); 1
	 * by default. Not what it shows by `express`. From the host's spec.
	 */
	temperament?:number | FeelingLevels;
	watches?:WatchInput;
	pinnedWatches?:WatchInput;
	watchesWritable?:boolean;
	pinnedSightFocus?:string[];
	sightFocus?:string[];
	sightFocusWritable?:boolean;
	maxSightFocus?:number;
	sightLimit?:number;
	/** How wide its look is, over the director's (`withSight({ fieldOfView })`); from the host's spec, never saved. */
	fieldOfView?:SightField;
	/**
	 * Whom it knows from the start, and what of them: by a character's id, a collective's (its characters) or a tag; `true`
	 * for all of it. `{ Bram: true, Hooded: [Knows.Look] }`. On top of what everyone knows (look and name by default, or
	 * what `withAcquaintance`'s rules give), so old friends know each other's voices too. What it learns
	 * in play is saved with its names; this is from the host's spec, never saved.
	 */
	knows?:Readonly<Record<string, readonly Knows[] | true>>;
};

/** A persona as a save keeps it. Its memories are the cast's (`CastJSON.memories`). */
export type PersonaJSON = {
	identity:Identity;
	/** Their `until` tests are not saved: a load takes them from the host's spec again, by the goal's text. */
	goals:Goal<never>[];
	maxGoals:number;
	names?:NameBookJSON;
	watches?:WatchInput;
	pinnedWatches?:WatchInput;
	watchesWritable?:boolean;
	pinnedSightFocus?:string[];
	sightFocus?:string[];
	sightFocusWritable?:boolean;
	maxSightFocus?:number;
	sightLimit?:number;
};

/**
 * Who someone is, what they want and what they know: identity, goals, memories, names for others, watches and
 * sight focus. It belongs to a character or a collective, not to the mind thinking for them, so a mind can be
 * swapped or dropped without losing any of it. Watches and sight focus are stored in ids.
 */
export class Persona {
	public identity:Identity;
	public goals:Goal<never>[];
	public maxGoals:number;
	public readonly memory:MemoryStore;
	/** Names for other characters. Saved, because memories quote them. */
	public readonly names = new NameBook();
	public watches:Watches;
	public pinnedWatches:Watches;
	public watchesWritable:boolean;
	public pinnedSightFocus:string[];
	public sightFocus:string[];
	public sightFocusWritable:boolean;
	public maxSightFocus:number;
	public sightLimit:number | undefined;
	public fieldOfView:SightField | undefined;
	public knows:PersonaSpec['knows'];
	public interests:readonly string[];
	public disposition:FeelingLevels | undefined;
	public temperament:number | FeelingLevels | undefined;

	constructor(spec:PersonaSpec, memory:MemoryStore) {
		this.identity = spec.identity
			? { ...spec.identity, traits: spec.identity.traits ? [...spec.identity.traits] : undefined }
			: {};
		this.goals = spec.goals ? spec.goals.map((g) => ({ ...g })) : [];
		this.maxGoals = spec.maxGoals ?? 5;
		this.memory = memory;
		this.interests = spec.interests ?? [];
		this.disposition = spec.disposition;
		this.temperament = spec.temperament;
		// Every caller with spec memories builds it fresh: a loaded persona adds its pinned ones itself (`fromJSON`).
		this.addSpecMemories(spec.memories ?? [], true);
		this.pinnedWatches = asWatches(spec.pinnedWatches);
		this.watches = extrasWithoutPins(asWatches(spec.watches), this.pinnedWatches);
		this.watchesWritable = spec.watchesWritable ?? true;
		this.pinnedSightFocus = asFocusList(spec.pinnedSightFocus, Number.POSITIVE_INFINITY);
		this.maxSightFocus = spec.maxSightFocus ?? DEFAULT_MAX_SIGHT_FOCUS;
		this.sightFocus = extrasWithoutPinnedFocus(asFocusList(spec.sightFocus, this.maxSightFocus), this.pinnedSightFocus);
		this.sightFocusWritable = spec.sightFocusWritable ?? true;
		this.sightLimit = spec.sightLimit;
		this.fieldOfView = spec.fieldOfView;
		this.knows = spec.knows;
		if (spec.maxGoals !== undefined) {
			this.trimGoals();
		}
	}

	/**
	 * The host's memories, notes of whose they are (`writer`, else this persona's owner): their words for that one, `I`
	 * or `you`, kept as its id. Pinned ones replace the pinned memory with the same first two tags, or are
	 * added; the rest are added only to a `fresh` persona, not to a loaded one.
	 */
	public addSpecMemories(drafts:readonly MemoryDraft[], fresh:boolean):void {
		for (const mem of drafts) {
			const tags = mem.tags ?? [];
			const kept = { category: mem.category ?? 'episodic', text: mem.text, knownBy: mem.knownBy, writer: mem.writer ?? this.memory.owner, tags, weight: mem.weight, stability: mem.stability, feelings: mem.feelings };
			if (!mem.pinned) {
				if (fresh) {
					this.memory.add({ ...kept, pinned: false }, mem.timestamp ?? 0);
				}
				continue;
			}
			const keyTags = tags.slice(0, 2);
			const existing = this.memory.pinned().find((row) => (
				keyTags.length > 0 && keyTags.every((tag) => row.tags.includes(tag))
			));
			if (existing) {
				const row = this.memory.rewrite(existing.id, mem.text);
				if (row) {
					row.tags = [...tags];
				}
				continue;
			}
			this.memory.add({ ...kept, pinned: true }, mem.timestamp ?? 0);
		}
	}

	public effectiveWatches():string[] {
		return watchExprs(this.watchList());
	}

	/** Pins first, then extra, de-duplicated by name. */
	public watchList():Watches {
		return { ...this.pinnedWatches, ...extrasWithoutPins(this.watches, this.pinnedWatches) };
	}

	/** Host or tests. Fails if the name is taken (pinned or extra) or empty. */
	public addWatch(name:string, expr:string):boolean {
		const next = applyWatchOps(this.watches, this.pinnedWatches, {
			add: asWatches({ [name]: expr }),
			edit: {},
			remove: [],
		});
		if (watchCount(next) === watchCount(this.watches)) {
			return false;
		}
		this.watches = next;
		return true;
	}

	/** Host or tests. Fails if missing or pinned. */
	public editWatch(name:string, expr:string):boolean {
		if (!hasWatch(this.watches, name) || hasWatch(this.pinnedWatches, name)) {
			return false;
		}
		const patched = asWatches({ [name]: expr });
		if (watchCount(patched) === 0) {
			return false;
		}
		this.watches = applyWatchOps(this.watches, this.pinnedWatches, {
			add: {},
			edit: patched,
			remove: [],
		});
		return true;
	}

	/** Host or tests. Fails if missing or pinned. */
	public removeWatch(name:string):boolean {
		const next = applyWatchOps(this.watches, this.pinnedWatches, {
			add: {},
			edit: {},
			remove: [name],
		});
		if (watchCount(next) === watchCount(this.watches)) {
			return false;
		}
		this.watches = next;
		return true;
	}

	/** Dev-authored pin. Overwrites a pin of the same name; drops a colliding extra. */
	public addPinnedWatch(name:string, expr:string):boolean {
		const row = asWatches({ [name]: expr });
		const n = Object.keys(row)[0];
		if (!n) {
			return false;
		}
		const extra = findWatchName(this.watches, n);
		if (extra) {
			const next = { ...this.watches };
			delete next[extra];
			this.watches = next;
		}
		const pin = findWatchName(this.pinnedWatches, n);
		this.pinnedWatches = { ...this.pinnedWatches, [pin ?? n]: row[n] };
		return true;
	}

	public effectiveSightFocus():string[] {
		return effectiveSightFocus(this.pinnedSightFocus, this.sightFocus);
	}

	public trimGoals():void {
		if (this.goals.length <= this.maxGoals) {
			return;
		}
		this.goals = [...this.goals]
			.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
			.slice(0, this.maxGoals);
	}

	/**
	 * Change who it is, the host's way and a model's (`set_identity`) alike: a new `role`, new `traits` (`[]` clears
	 * them), or both; what is left out stays. Returns whether anything changed. A change restamps the identity memory at
	 * `now` (`director.time`).
	 */
	public setIdentity(identity:Identity, now:number):boolean {
		const role = identity.role?.trim();
		const traits = identity.traits?.map((t) => t.trim()).filter((t) => t.length > 0);
		let changed = false;
		if (role && role !== this.identity.role) {
			this.identity.role = role;
			changed = true;
		}
		if (traits && traits.join('\n') !== (this.identity.traits ?? []).join('\n')) {
			this.identity.traits = traits;
			changed = true;
		}
		if (changed) {
			this.stampIdentity(now);
		}
		return changed;
	}

	/** A model's `{ role, traits }`, read as {@link setIdentity} takes it. Returns whether anything changed. */
	public applyIdentityPatch(raw:unknown, now:number):boolean {
		if (!isRecord(raw)) {
			return false;
		}
		return this.setIdentity({
			role: typeof raw.role === 'string' ? raw.role : undefined,
			traits: Array.isArray(raw.traits) ? raw.traits.filter((x):x is string => typeof x === 'string') : undefined,
		}, now);
	}

	/** It is reached: no longer a goal, pinned for a few thinks, and after that only `recall` finds it. Known by `knownBy`, by default the owner. */
	public finishGoal(goal:Goal<never>, now:number, knownBy?:string[], writer = this.memory.owner):void {
		this.goals = this.goals.filter((g) => g !== goal);
		internalsOf(this.memory).add({
			// The goal is in its mind's words, a note of its writer's: kept by id, as every memory.
			text: parseTextWithIDs(`Goal reached: ${goal.text}`, (word) => this.names.idOf(word)),
			knownBy,
			writer,
			tags: ['goal', ...nameTags(goal.text)],
			pinned: true,
			pinnedThinks: GOAL_PINNED_THINKS,
		}, now);
	}

	/** A model's goal list. Ignored unless it holds at least one goal. A goal it keeps keeps its `until`. */
	public applyGoalList(raw:unknown):void {
		if (!Array.isArray(raw)) {
			return;
		}
		const goals:Goal<never>[] = [];
		for (const g of raw) {
			if (isRecord(g) && typeof g.text === 'string' && g.text.trim()) {
				const text = g.text.trim();
				const until = this.goals.find((kept) => kept.text === text)?.until;
				goals.push({
					text,
					priority: typeof g.priority === 'number' ? g.priority : undefined,
					...until ? { until } : {},
				});
			}
		}
		if (goals.length > 0) {
			this.goals = goals;
			this.trimGoals();
		}
	}

	private stampIdentity(now:number):void {
		// Kept by id, read as `You are Bob.` by its own mind.
		const id = this.memory.owner;
		const text = (name:(id:string)=>string):string => `${name(id)} is ${id}.${this.identity.role ? ` Role: ${this.identity.role}.` : ''}`;
		const existing = this.memory.pinned().find((row) => (
			row.category === 'identity' || row.tags.includes('identity')
		));
		if (existing) {
			const row = this.memory.rewrite(existing.id, text)!;
			row.category = 'identity';
			if (!row.tags.includes('identity')) {
				row.tags = [...row.tags, 'identity'];
			}
			return;
		}
		this.memory.add({
			category: 'identity',
			text,
			tags: ['identity'],
			pinned: true,
		}, now);
	}

	public toJSON():PersonaJSON {
		return {
			identity: { ...this.identity, traits: this.identity.traits ? [...this.identity.traits] : undefined },
			goals: this.goals.map(({ until, ...goal }) => (typeof until === 'string' ? { ...goal, until } : goal)),
			maxGoals: this.maxGoals,
			names: this.names.toJSON(),
			watches: copyWatches(this.watches),
			pinnedWatches: copyWatches(this.pinnedWatches),
			watchesWritable: this.watchesWritable,
			pinnedSightFocus: [...this.pinnedSightFocus],
			sightFocus: [...this.sightFocus],
			sightFocusWritable: this.sightFocusWritable,
			maxSightFocus: this.maxSightFocus,
			sightLimit: this.sightLimit,
		};
	}

	/**
	 * A saved persona under the host's current spec, with `memory` (its view of the cast's pool, read back): its pins
	 * come first (saved pins that repeat them are dropped), its pinned memories are refreshed, and its writable flags
	 * and sight limit win when set.
	 */
	public static fromJSON(json:PersonaJSON, host:PersonaSpec, memory:MemoryStore):Persona {
		const test = (goal:Goal<never>):Goal<never>['until'] => goal.until ?? host.goals?.find((g) => g.text === goal.text)?.until;
		const goals = json.goals.map((goal) => {
			const until = test(goal);
			return until ? { ...goal, until } : goal;
		});
		const persona = new Persona({ identity: json.identity, goals, interests: host.interests, disposition: host.disposition, temperament: host.temperament }, memory);
		persona.addSpecMemories(host.memories ?? [], false);
		persona.maxGoals = json.maxGoals;
		persona.names.load(json.names);
		persona.pinnedWatches = mergePinnedWatches(asWatches(host.pinnedWatches), asWatches(json.pinnedWatches));
		persona.watches = extrasWithoutPins(asWatches(json.watches), persona.pinnedWatches);
		persona.watchesWritable = host.watchesWritable ?? json.watchesWritable ?? true;
		persona.pinnedSightFocus = mergePinnedFocus(
			asFocusList(host.pinnedSightFocus, Number.POSITIVE_INFINITY),
			asFocusList(json.pinnedSightFocus, Number.POSITIVE_INFINITY),
		);
		persona.maxSightFocus = json.maxSightFocus ?? host.maxSightFocus ?? DEFAULT_MAX_SIGHT_FOCUS;
		persona.sightFocus = extrasWithoutPinnedFocus(
			asFocusList(json.sightFocus, persona.maxSightFocus),
			persona.pinnedSightFocus,
		);
		persona.sightFocusWritable = host.sightFocusWritable ?? json.sightFocusWritable ?? true;
		persona.sightLimit = host.sightLimit ?? json.sightLimit;
		persona.fieldOfView = host.fieldOfView;
		persona.knows = host.knows;
		persona.trimGoals();
		return persona;
	}
}
