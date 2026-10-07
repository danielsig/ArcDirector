import { isRecord } from '../json.js';
import { MemoryStore, type MemoryDraft, type MemoryRecord } from '../memory/store.js';
import { NameBook, type NameBookJSON } from './names.js';
import type { Identity, Goal, WatchInput, Watches } from './types.js';
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
	goals?:Goal[];
	maxGoals?:number;
	/** Pinned ones are kept up to date from the spec, matched by their first two tags. */
	memories?:MemoryDraft[];
	watches?:WatchInput;
	pinnedWatches?:WatchInput;
	watchesWritable?:boolean;
	pinnedSightFocus?:string[];
	sightFocus?:string[];
	sightFocusWritable?:boolean;
	maxSightFocus?:number;
	sightLimit?:number;
};

export type PersonaJSON = {
	identity:Identity;
	goals:Goal[];
	maxGoals:number;
	memories:MemoryRecord[];
	maxEpisodic:number;
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
	public goals:Goal[];
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

	constructor(spec:PersonaSpec = {}, memory = new MemoryStore()) {
		this.identity = spec.identity
			? { ...spec.identity, traits: spec.identity.traits ? [...spec.identity.traits] : undefined }
			: {};
		this.goals = spec.goals ? spec.goals.map((g) => ({ ...g })) : [];
		this.maxGoals = spec.maxGoals ?? 5;
		this.memory = memory;
		this.addSpecMemories(spec.memories ?? [], memory.all().length === 0);
		this.pinnedWatches = asWatches(spec.pinnedWatches);
		this.watches = extrasWithoutPins(asWatches(spec.watches), this.pinnedWatches);
		this.watchesWritable = spec.watchesWritable ?? true;
		this.pinnedSightFocus = asFocusList(spec.pinnedSightFocus, Number.POSITIVE_INFINITY);
		this.maxSightFocus = spec.maxSightFocus ?? DEFAULT_MAX_SIGHT_FOCUS;
		this.sightFocus = extrasWithoutPinnedFocus(asFocusList(spec.sightFocus, this.maxSightFocus), this.pinnedSightFocus);
		this.sightFocusWritable = spec.sightFocusWritable ?? true;
		this.sightLimit = spec.sightLimit;
		if (spec.maxGoals !== undefined) {
			this.trimGoals();
		}
	}

	/**
	 * The host's memories. Pinned ones replace the pinned memory with the same first two tags, or are added;
	 * the rest are added only to a `fresh` persona, not to a loaded one.
	 */
	public addSpecMemories(drafts:readonly MemoryDraft[], fresh:boolean):void {
		for (const mem of drafts) {
			const tags = mem.tags ?? [];
			if (!mem.pinned) {
				if (fresh) {
					this.memory.add({ category: mem.category ?? 'episodic', text: mem.text, tags, pinned: false }, mem.timestamp ?? 0);
				}
				continue;
			}
			const keyTags = tags.slice(0, 2);
			const existing = this.memory.pinned().find((row) => (
				keyTags.length > 0 && keyTags.every((tag) => row.tags.includes(tag))
			));
			if (existing) {
				existing.text = mem.text;
				existing.tags = [...tags];
				continue;
			}
			this.memory.add({ category: mem.category ?? 'episodic', text: mem.text, tags, pinned: true }, mem.timestamp ?? 0);
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

	/** A model's `{ role, traits }`. Returns whether anything changed; a change restamps the identity memory. */
	public applyIdentityPatch(raw:unknown, id:string, now:number):boolean {
		if (!isRecord(raw)) {
			return false;
		}
		const nextRole = typeof raw.role === 'string' ? raw.role.trim() : '';
		let changed = false;
		if (nextRole.length > 0 && nextRole !== this.identity.role) {
			this.identity.role = nextRole;
			changed = true;
		}
		if (Array.isArray(raw.traits)) {
			this.identity.traits = raw.traits.filter((x):x is string => (
				typeof x === 'string' && x.trim().length > 0
			));
			changed = true;
		}
		if (changed) {
			this.stampIdentity(id, now);
		}
		return changed;
	}

	/** A model's goal list. Ignored unless it holds at least one goal. */
	public applyGoalList(raw:unknown):void {
		if (!Array.isArray(raw)) {
			return;
		}
		const goals:Goal[] = [];
		for (const g of raw) {
			if (isRecord(g) && typeof g.text === 'string' && g.text.trim()) {
				goals.push({
					text: g.text.trim(),
					priority: typeof g.priority === 'number' ? g.priority : undefined,
				});
			}
		}
		if (goals.length > 0) {
			this.goals = goals;
			this.trimGoals();
		}
	}

	private stampIdentity(id:string, now:number):void {
		const text = this.identity.role ? `I am ${id}. Role: ${this.identity.role}.` : `I am ${id}.`;
		const existing = this.memory.pinned().find((row) => (
			row.category === 'identity' || row.tags.includes('identity')
		));
		if (existing) {
			existing.text = text;
			existing.category = 'identity';
			if (!existing.tags.includes('identity')) {
				existing.tags = [...existing.tags, 'identity'];
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
			goals: this.goals.map((g) => ({ ...g })),
			maxGoals: this.maxGoals,
			memories: this.memory.toJSON(),
			maxEpisodic: this.memory.maxEpisodic,
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
	 * A saved persona under the host's current spec: its pins come first (saved pins that repeat them are
	 * dropped), its pinned memories are refreshed, and its writable flags and sight limit win when set.
	 */
	public static fromJSON(json:PersonaJSON, host:PersonaSpec = {}):Persona {
		const persona = new Persona({ identity: json.identity, goals: json.goals }, MemoryStore.fromJSON(json.memories));
		persona.addSpecMemories(host.memories ?? [], false);
		persona.memory.maxEpisodic = json.maxEpisodic;
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
		persona.trimGoals();
		return persona;
	}
}
