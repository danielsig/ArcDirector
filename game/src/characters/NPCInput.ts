import { Component } from '../engine/Component';
import { Order } from '../engine/order';

/** What ArcDirector asks of an NPC body: where to head, whom to face, and its cooldowns. The motor does the moving. */
export class NPCInput extends Component {
	public static override order = Order.npcInput;
	/** Set by ArcDirector every tick while this body moves; `null` stands still. */
	public destinationPoint:{ x:number; z:number } | null = null;
	public faceName:string | null = null;
	public faceUntil = 0;
	public aiOn = true;
	/** Next time `world.time` this body may start a cast. */
	public attackReadyTimestamp = 0;
	/** Next time `world.time` this body may start a heal. */
	public healReadyTimestamp = 0;

	public faceToward(name:string, until = Number.POSITIVE_INFINITY):void {
		this.faceName = name;
		this.faceUntil = until;
	}

	public override update():void {
		if (!this.aiOn) {
			this.destinationPoint = null;
		}
	}
}
