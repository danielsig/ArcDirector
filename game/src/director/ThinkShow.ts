import { Time, type GameObject } from '@arc-director/kindling';
import type { ThinkEvent } from 'arc-director';
import { cueAt, cueAtPoint } from '../audio/cue';
import { CharacterPose } from '../characters/CharacterPose';
import { stanceOf } from '../characters/moves/pose-body';
import type { DemoWorld } from '../engine/demo-world';
import type { SfxName } from '../audio/sfx';
import { prefs } from '../prefs';
import { orderArcs } from '../render/arc-fx';
import type { Stance } from '../render/spell-fx';
import { toolFx } from '../render/tool-fx';
import type { GoalColor, SlateState } from '../ui/hud-model';
import { findObject, isLiving } from './names';
import type { SceneGoals } from './game-types';
import { idOf } from '../engine/components';

/** How long a slate stays once its think is over (s): an Arc chosen, an error to read, or cut short by a newer think. */
const HOLD_DONE = 2;
const HOLD_FAILED = 2.2;
const HOLD_DROPPED = 0.35;
/** How long a slate shakes when a reply is turned down (s); matches its animation (`HudSlate`). */
const WRONG_SECONDS = 0.6;
/** Most slates up at once: the rest of the minds thinking only show their dots. */
const MAX_SLATES = 4;
/** Least time between the ticks of a slate being written (s). */
const TICK_GAP = 0.07;
/** Most thinks kept for the AI log. */
const THINK_LOG_CAP = 250;
/** How long a tool call shows on whoever made it (s): it takes no time itself, so this is for the eye. */
const TOOL_SECONDS = 3;
/** How far apart the arcs of one order leave (s). */
const ORDER_STAGGER = 0.05;
/** How long a unit does not show the same order again (s): something re-ordering it non-stop is one order on screen. */
const ORDER_REPEAT = 3;

/** One mind's think on show. */
export type ThinkSlate = {
	/** Which think this is, of all those of this scene. */
	seq:number;
	id:string;
	name:string;
	color:GoalColor;
	/** What started it (`rethink`, `heard speech`), or `''`. */
	why:string;
	thought:string;
	arc:string;
	state:SlateState;
	error:string;
	/** Until when it shakes, in game time. */
	wrongUntil:number;
	/** When its think began, on the wall clock (ms): models do not stop for a paused game. */
	began:number;
	/** How long its think took, once over (ms). */
	ms:number;
	/** Which side of its writer it stands, decided once as it first shows. */
	side?:'left' | 'right';
	/** When it goes, in game time. */
	until:number;
	lastTick:number;
};

/**
 * Where a mind's thinks show: over a living character (`go`), or for a bodiless collective (a hive) at the median of its
 * living characters, standing as tall as they do.
 */
export type ThinkAnchor = { name:string; go?:GameObject; stance:Stance };

/** The middle value of `values` (not empty). */
function median(values:number[]):number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Puts what minds do as they think on show (`ArcDirector.onThink`): each Arc written out on a slate by its author's head,
 * each order flying to its units, each tool call in the body of whoever made it. A bodiless collective writes and orders
 * from the middle of its characters ({@link anchorOf}), with no body to hold a tool. Every part has its menu switch, under
 * one that hides them all. The HUD reads {@link slates} and {@link toolOf} each frame, and the AI log {@link thinks}.
 */
export class ThinkShow {
	public readonly slates = new Map<string, ThinkSlate>();
	/** The latest thinks, oldest first, whether or not they got a slate. */
	public readonly thinks:ThinkSlate[] = [];
	private readonly _writing = new Map<string, ThinkSlate>();
	private _seq = 0;
	private readonly _began = new Map<string, { at:number; why:string }>();
	private readonly _tools = new Map<string, { tool:string; until:number }>();
	/** The last order shown reaching each unit, and when. */
	private readonly _orders = new Map<string, { text:string; at:number }>();

	/**
	 * @param crew The characters of the bodiless collective with this id, or undefined for any other mind.
	 */
	constructor(private readonly _world:DemoWorld, private readonly _goals:()=>SceneGoals | undefined, private readonly _crew:(id:string)=>readonly { id:string }[] | undefined) {}

	public handle = (event:ThinkEvent):void => {
		// The dead write nothing, though a think of theirs may yet come back from the model; nor does a collective with none left standing.
		const anchor = event.kind === 'start' ? null : this.anchorOf(event.who);
		switch (event.kind) {
			case 'start':
				this._began.set(event.who, { at: performance.now(), why: event.why ?? '' });
				return;
			case 'reply':
				this.write(event.who, event.thought, event.arc, anchor);
				return;
			case 'tool':
				this.tool(event.who, event.tool, anchor);
				return;
			case 'retry':
				this.turnDown(event.who, event.reason, anchor);
				return;
			case 'end':
				if (event.skipped) {
					this.write(event.who, 'Nothing changed since the last think: skipped.', '', anchor);
				}
				this.finish(event.who, !!event.arc, event.error, anchor);
				return;
			case 'command':
				this.order(event.to, event.text, anchor);
				return;
		}
	};

	/** Where `who`'s thinks show now, or null when it is down (or, a collective, has no one living). */
	public anchorOf(who:string):ThinkAnchor | null {
		const crew = this._crew(who);
		if (!crew) {
			const go = findObject(this._world, who);
			return isLiving(go) ? { name: idOf(go), go, stance: stanceOf(go) } : null;
		}
		const stances = crew.map((c) => findObject(this._world, c.id)).filter(isLiving).map(stanceOf);
		if (stances.length === 0) {
			return null;
		}
		const feet = stances[0]!.feet.clone().set(median(stances.map((s) => s.feet.x)), median(stances.map((s) => s.feet.y)), median(stances.map((s) => s.feet.z)));
		return { name: who, stance: { feet, height: median(stances.map((s) => s.height)) } };
	}

	/** The tool `id` is showing now, or `''`. */
	public toolOf(id:string):string {
		const shown = this._tools.get(id);
		return shown && Time.time < shown.until ? shown.tool : '';
	}

	/** Takes down what has had its time, or has just been switched off. */
	public update():void {
		const slates = this.on('arcSlates');
		for (const [who, slate] of this.slates) {
			if (Time.time >= slate.until || !slates || !this.anchorOf(who)) {
				this.slates.delete(who);
			}
		}
		if (!this.on('toolIcons')) {
			this._tools.clear();
		}
	}

	/** Whether this part of the show is on: its own switch, and the one over them all. */
	private on(part:'arcSlates' | 'orderArcs' | 'toolIcons' | 'toolPoses' | 'toolFx'):boolean {
		const p = prefs();
		return p.mindVisuals && p[part];
	}

	private colorOf(id:string):GoalColor {
		const goals = this._goals();
		return [goals?.left, goals?.right].find((side) => side?.who?.includes(id))?.color ?? 'gold';
	}

	/** The think `who` is writing, a fresh one if its last is over, up on a slate unless slates are off or too many are up. */
	private thinkOf(who:string, anchor:ThinkAnchor):ThinkSlate {
		const writing = this._writing.get(who);
		if (writing) {
			return writing;
		}
		const began = this._began.get(who);
		const fresh:ThinkSlate = { seq: ++this._seq, id: who, name: anchor.name, color: this.colorOf(who), why: began?.why ?? '', thought: '', arc: '', state: 'writing', error: '', wrongUntil: 0, began: began?.at ?? performance.now(), ms: 0, until: Infinity, lastTick: 0 };
		this._writing.set(who, fresh);
		this.thinks.push(fresh);
		this.thinks.splice(0, this.thinks.length - THINK_LOG_CAP);
		if (this.on('arcSlates') && (this.slates.has(who) || this.slates.size < MAX_SLATES)) {
			this.slates.set(who, fresh);
		}
		return fresh;
	}

	/** Whether `think` is up on a slate, to be heard being written. */
	private shown(think:ThinkSlate):boolean {
		return this.slates.get(think.id) === think;
	}

	/** Plays `name` at `anchor`: from a character's own voice, or at a collective's middle. */
	private cue(name:SfxName, anchor:ThinkAnchor):void {
		if (anchor.go) {
			cueAt(this._world, name, anchor.go);
		}
		else {
			cueAtPoint(this._world, name, anchor.stance.feet);
		}
	}

	private write(who:string, thought:string, arc:string, anchor:ThinkAnchor | null):void {
		if (!anchor || !(thought || arc)) {
			return;
		}
		const slate = this.thinkOf(who, anchor);
		if (this.shown(slate) && arc.length > slate.arc.length && Time.time - slate.lastTick >= TICK_GAP) {
			slate.lastTick = Time.time;
			this.cue('arcTick', anchor);
		}
		// Each request of a think (after a tool, or a repair) starts its reasoning anew, often empty: the last words stay above the Arc until new ones come.
		slate.thought = thought || slate.thought;
		slate.arc = arc;
	}

	/** A reply would not do: the slate shakes, says why, and the model writes on. */
	private turnDown(who:string, reason:string, anchor:ThinkAnchor | null):void {
		if (!anchor) {
			return;
		}
		const slate = this.thinkOf(who, anchor);
		slate.error = reason;
		slate.wrongUntil = Time.time + WRONG_SECONDS;
		if (this.shown(slate)) {
			this.cue('arcWrong', anchor);
		}
	}

	private finish(who:string, chose:boolean, error:string | undefined, anchor:ThinkAnchor | null):void {
		const slate = error && anchor ? this.thinkOf(who, anchor) : this._writing.get(who);
		this._writing.delete(who);
		if (!slate) {
			return;
		}
		slate.state = chose ? 'done' : error ? 'failed' : 'dropped';
		slate.ms = performance.now() - slate.began;
		slate.until = Time.time + (chose ? HOLD_DONE : error ? HOLD_FAILED : HOLD_DROPPED);
		if (error) {
			slate.error = error;
			slate.wrongUntil = Time.time + WRONG_SECONDS;
		}
		else if (chose) {
			// Fixed in a repair turn: the slate stops shaking and hides the turned-down reason; the AI log keeps it.
			slate.wrongUntil = 0;
		}
		if (anchor && (chose || error) && this.shown(slate)) {
			this.cue(chose ? 'arcDone' : 'arcWrong', anchor);
		}
	}

	/** A tool call: its icon and a free arm on a body, its light on a body or a collective's middle. */
	private tool(who:string, tool:string, anchor:ThinkAnchor | null):void {
		if (!anchor) {
			return;
		}
		const go = anchor.go;
		const icon = !!go && this.on('toolIcons');
		const pose = !!go && this.on('toolPoses');
		const fx = this.on('toolFx');
		if (icon) {
			this._tools.set(anchor.name, { tool, until: Time.time + TOOL_SECONDS });
		}
		if (pose) {
			go.getComponent(CharacterPose)?.tool.show(tool, TOOL_SECONDS);
		}
		if (fx) {
			toolFx(this._world.native, tool, () => this.anchorOf(who)?.stance ?? null, TOOL_SECONDS);
		}
		if (icon || pose || fx) {
			this.cue('toolUse', anchor);
		}
	}

	private order(to:string[], text:string, anchor:ThinkAnchor | null):void {
		if (!this.on('orderArcs') || !anchor) {
			return;
		}
		const units = to.map((id) => findObject(this._world, id)).filter((unit):unit is GameObject => {
			const last = unit && this._orders.get(unit.id);
			return !!unit && !(last?.text === text && Time.time - last.at < ORDER_REPEAT);
		});
		if (units.length === 0) {
			return;
		}
		for (const unit of units) {
			this._orders.set(unit.id, { text, at: Time.time });
		}
		this.cue('arcLaunch', anchor);
		orderArcs(this._world.native, anchor.stance, units.map((unit) => () => (isLiving(unit) ? stanceOf(unit) : null)), text, this.colorOf(anchor.name), ORDER_STAGGER, (i) => {
			cueAt(this._world, 'arcLand', units[i]!);
		});
	}
}
