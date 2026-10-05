import { Component } from '../engine/Component';
import { Order } from '../engine/order';

/** What ArcDirector asks of an NPC body: where to head, whom to face, and its cooldowns. The motor does the moving. */
export class NPCInput extends Component {
	static override order = Order.npcInput;
	/** Set by ArcDirector every tick while this body moves; `null` stands still. */
	destinationPoint:{ x:number; z:number } | null = null;
	faceName:string | null = null;
	faceUntil = 0;
	aiOn = true;
	/** Next time `world.time` this body may start a cast. */
	attackReadyTimestamp = 0;
	/** Next time `world.time` this body may start a heal. */
	healReadyTimestamp = 0;

	faceToward(name:string, until = Number.POSITIVE_INFINITY):void {
		this.faceName = name;
		this.faceUntil = until;
	}

	override update():void {
		if (!this.aiOn) {
			this.destinationPoint = null;
		}
	}
}
