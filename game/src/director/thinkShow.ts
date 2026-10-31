import { Time, type GameObject } from '@arc-director/kindling';
import type { ThinkEvent } from 'arc-director';
import { cueAt } from '../audio/cue';
import { CharacterPose, stanceOf } from '../characters/CharacterPose';
import type { World } from '../engine/World';
import { prefs } from '../prefs';
import { orderArcs } from '../render/arcFx';
import { toolFx } from '../render/toolFx';
import type { GoalColor, SlateState } from '../ui/hudModel';
import { findObject, idOf, isLiving } from './names';
import type { SceneGoals } from './types';

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
/** How long a tool call shows on whoever made it (s): it takes no time itself, so this is for the eye. */
const TOOL_SECONDS = 3;
/** How far apart the arcs of one order leave (s). */
const ORDER_STAGGER = 0.05;
/** How long a unit does not show the same order again (s): something re-ordering it non-stop is one order on screen. */
const ORDER_REPEAT = 3;

/** One mind's think on show. */
export type ThinkSlate = {
	id:string;
	color:GoalColor;
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
	/** When it goes, in game time. */
	until:number;
	lastTick:number;
};

/**
 * Puts what minds do as they think on show (`ArcDirector.onThink`): each Arc written out on a slate by its author's head,
 * each order flying to its units, each tool call in the body of whoever made it. Every part has its menu switch, under
 * one that hides them all. The HUD reads {@link slates} and {@link toolOf} each frame.
 */
export class ThinkShow {
	public readonly slates = new Map<string, ThinkSlate>();
	private readonly _began = new Map<string, number>();
	private readonly _tools = new Map<string, { tool:string; until:number }>();
	/** The last order shown reaching each unit, and when. */
	private readonly _orders = new Map<string, { text:string; at:number }>();

	constructor(private readonly world:World, private readonly goals:()=>SceneGoals | undefined) {}

	public handle = (event:ThinkEvent):void => {
		const go = findObject(this.world, event.who);
		switch (event.kind) {
			case 'start':
				this._began.set(event.who, performance.now());
				return;
			case 'reply':
				this.write(event.who, event.thought, event.arc, go);
				return;
			case 'tool':
				this.tool(event.tool, go);
				return;
			case 'retry':
				this.turnDown(event.who, event.reason, go);
				return;
			case 'end':
				this.finish(event.who, !!event.arc, event.error, go);
				return;
			case 'issue':
				this.order(event.to, event.text, go);
				return;
		}
	};

	/** The tool `id` is showing now, or `''`. */
	public toolOf(id:string):string {
		const shown = this._tools.get(id);
		return shown && Time.time < shown.until ? shown.tool : '';
	}

	/** Takes down what has had its time, or has just been switched off. */
	public update():void {
		const slates = this.on('arcSlates');
		for (const [who, slate] of this.slates) {
			if (Time.time >= slate.until || !slates) {
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
		const goals = this.goals();
		return [goals?.left, goals?.right].find((side) => side?.who?.includes(id))?.color ?? 'gold';
	}

	/** The slate `who` is writing on, a fresh one if its last is over; none if slates are off or too many are up. */
	private slateOf(who:string):ThinkSlate | undefined {
		const slate = this.slates.get(who);
		if (slate?.state === 'writing') {
			return slate;
		}
		if (!this.on('arcSlates') || (!slate && this.slates.size >= MAX_SLATES)) {
			return undefined;
		}
		const fresh:ThinkSlate = { id: who, color: this.colorOf(who), thought: '', arc: '', state: 'writing', error: '', wrongUntil: 0, began: this._began.get(who) ?? performance.now(), ms: 0, until: Infinity, lastTick: 0 };
		this.slates.set(who, fresh);
		return fresh;
	}

	private write(who:string, thought:string, arc:string, go:GameObject | undefined):void {
		const slate = go && (thought || arc) ? this.slateOf(who) : undefined;
		if (!slate) {
			return;
		}
		if (arc.length > slate.arc.length && Time.time - slate.lastTick >= TICK_GAP) {
			slate.lastTick = Time.time;
			cueAt(this.world, 'arcTick', go!);
		}
		slate.thought = thought;
		slate.arc = arc;
		if (arc) {
			slate.error = '';
		}
	}

	/** A reply would not do: the slate shakes, says why, and the model writes on. */
	private turnDown(who:string, reason:string, go:GameObject | undefined):void {
		const slate = go ? this.slateOf(who) : undefined;
		if (!slate) {
			return;
		}
		slate.error = reason;
		slate.wrongUntil = Time.time + WRONG_SECONDS;
		cueAt(this.world, 'arcWrong', go!);
	}

	private finish(who:string, chose:boolean, error:string | undefined, go:GameObject | undefined):void {
		const slate = error && go ? this.slateOf(who) : this.slates.get(who);
		if (!slate || slate.state !== 'writing') {
			return;
		}
		slate.state = chose ? 'done' : error ? 'failed' : 'dropped';
		slate.ms = performance.now() - slate.began;
		slate.until = Time.time + (chose ? HOLD_DONE : error ? HOLD_FAILED : HOLD_DROPPED);
		if (error) {
			slate.error = error;
			slate.wrongUntil = Time.time + WRONG_SECONDS;
		}
		if (go && (chose || error)) {
			cueAt(this.world, chose ? 'arcDone' : 'arcWrong', go);
		}
	}

	private tool(tool:string, go:GameObject | undefined):void {
		if (!go || !isLiving(go)) {
			return;
		}
		const icon = this.on('toolIcons');
		const pose = this.on('toolPoses');
		const fx = this.on('toolFx');
		if (icon) {
			this._tools.set(idOf(go), { tool, until: Time.time + TOOL_SECONDS });
		}
		if (pose) {
			go.getComponent(CharacterPose)?.useTool(tool, TOOL_SECONDS);
		}
		if (fx) {
			toolFx(this.world.native, tool, () => (isLiving(go) ? stanceOf(go) : null), TOOL_SECONDS);
		}
		if (icon || pose || fx) {
			cueAt(this.world, 'toolUse', go);
		}
	}

	private order(to:string[], text:string, go:GameObject | undefined):void {
		if (!this.on('orderArcs') || !go) {
			return;
		}
		const units = to.map((id) => findObject(this.world, id)).filter((unit):unit is GameObject => {
			const last = unit && this._orders.get(unit.id);
			return !!unit && !(last?.text === text && Time.time - last.at < ORDER_REPEAT);
		});
		if (units.length === 0) {
			return;
		}
		for (const unit of units) {
			this._orders.set(unit.id, { text, at: Time.time });
		}
		cueAt(this.world, 'arcLaunch', go);
		orderArcs(this.world.native, stanceOf(go), units.map((unit) => () => (isLiving(unit) ? stanceOf(unit) : null)), text, this.colorOf(idOf(go)), ORDER_STAGGER, (i) => {
			cueAt(this.world, 'arcLand', units[i]!);
		});
	}
}
