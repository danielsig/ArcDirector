import { Speaker } from '@arc-director/kindling';
import { SpeechBubble } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { distXZ } from '../items/inventory';
import { prefs } from '../prefs';
import { HEAR_RANGE } from './talkAttend';

/** A breath between one speaker finishing and the next one in earshot starting. */
const TURN_GAP = 0.25;
/** Bubbles stay up as long as the text takes to read, within these bounds (seconds). */
const READ_CHARS_PER_SECOND = 16;
const MIN_SECONDS = 1;
const MAX_SECONDS = 8;

type Line = { go:GameObject; text:string };

/**
 * People in earshot of each other speak in turn. A line waits while anyone within
 * `HEAR_RANGE` is still speaking, or still waiting ahead of it; then its speaker's bubble shows
 * it for as long as it takes to read, and with voices on its babble is fitted to last exactly
 * as long. Only presentation waits: the line was already said (heard, logged, chatted).
 */
export class SpeechQueue {
	private readonly _world:World;
	private readonly _waiting:Line[] = [];
	private _speaking:{ go:GameObject; until:number }[] = [];

	constructor(world:World) {
		this._world = world;
	}

	/** Queue a line. The player never waits: their line starts now, and people in earshot wait for it. */
	public enqueue(go:GameObject, text:string):void {
		if (go.id === 'Player') {
			this.start({ go, text }, this._world.time);
			return;
		}
		this._waiting.push({ go, text });
		this.update();
	}

	/** Start every waiting line that nobody in earshot is in the way of. Call every frame. */
	public update():void {
		const now = this._world.time;
		this._speaking = this._speaking.filter((s) => now < s.until + TURN_GAP && s.go.world === this._world);
		const held:Line[] = [];
		for (const line of this._waiting.splice(0)) {
			if (line.go.world !== this._world) {
				continue;
			}
			const near = (other:GameObject):boolean => distXZ(line.go, other) <= HEAR_RANGE;
			if (this._speaking.some((s) => near(s.go)) || held.some((h) => near(h.go))) {
				held.push(line);
				continue;
			}
			this.start(line, now);
		}
		this._waiting.push(...held);
	}

	private start({ go, text }:Line, now:number):void {
		const seconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, text.length / READ_CHARS_PER_SECOND));
		const bubble = go.getOrAddComponent(SpeechBubble);
		bubble.text = text;
		bubble.timestamp = now;
		bubble.until = now + seconds;
		if (prefs().voices) {
			const speaker = go.getComponent(Speaker);
			speaker?.say(speaker.line(text, seconds));
		}
		this._speaking.push({ go, until: now + seconds });
	}
}
