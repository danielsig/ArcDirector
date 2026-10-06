import { Component } from '../engine/Component';
import { NPCInput } from './NPCInput';

/**
 * While claimed, an arc drives this body through `NPCInput` and WASD is ignored.
 * A canvas click calls `interrupt`, which hands the body back and stops the arc.
 */
export class PlayerPilot extends Component {
	private onInterrupt:(()=>void) | null = null;
	private yielded = false;

	get claimed():boolean {
		return this.onInterrupt !== null;
	}

	/** Take the body for one arc. Returns the release for this claim; a newer claim makes it a no-op. */
	claim(onInterrupt:()=>void):()=>void {
		this.onInterrupt = onInterrupt;
		return () => {
			if (this.onInterrupt === onInterrupt) {
				this.release();
			}
		};
	}

	interrupt():void {
		const stop = this.onInterrupt;
		if (!stop) {
			return;
		}
		this.release();
		this.yielded = true;
		stop();
	}

	/** True once after `interrupt`, so that click does not also use an item. */
	consumeYield():boolean {
		const yielded = this.yielded;
		this.yielded = false;
		return yielded;
	}

	private release():void {
		this.onInterrupt = null;
		const npc = this.gameObject.getComponent(NPCInput);
		if (npc) {
			npc.destinationPoint = null;
		}
	}
}
