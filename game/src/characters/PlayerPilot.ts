import { Component } from '../engine/Component';
import { NPCInput } from './NPCInput';

/**
 * While claimed, an arc drives this body through `NPCInput` and WASD is ignored.
 * A canvas click calls `interrupt`, which hands the body back and stops the arc.
 */
export class PlayerPilot extends Component {
	private _claimed:(()=>void) | null = null;
	private _yielded = false;

	public get claimed():boolean {
		return this._claimed !== null;
	}

	/** Take the body for one arc. Returns the release for this claim; a newer claim makes it a no-op. */
	public claim(onInterrupt:()=>void):()=>void {
		this._claimed = onInterrupt;
		return () => {
			if (this._claimed === onInterrupt) {
				this.release();
			}
		};
	}

	public interrupt():void {
		const stop = this._claimed;
		if (!stop) {
			return;
		}
		this.release();
		this._yielded = true;
		stop();
	}

	/** True once after `interrupt`, so that click does not also use an item. */
	public consumeYield():boolean {
		const yielded = this._yielded;
		this._yielded = false;
		return yielded;
	}

	private release():void {
		this._claimed = null;
		const npc = this.gameObject.getComponent(NPCInput);
		if (npc) {
			npc.destinationPoint = null;
		}
	}
}
