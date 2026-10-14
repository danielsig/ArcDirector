import { Time, Component } from '@arc-director/kindling';
import { Order } from '../engine/order';

/** What ArcDirector asks of an NPC body: where to head, whom to face, and its cooldowns. The motor does the moving. */
export class NPCInput extends Component {
	public static override order = Order.npcInput;
	/** Set by ArcDirector every tick while this body moves; `null` stands still. */
	public destinationPoint:{ x:number; z:number } | null = null;
	public faceName:string | null = null;
	public faceUntil = 0;
	public aiOn = true;
	/** Next time `Time.time` this body may start a cast. */
	public attackReadyTimestamp = 0;
	/** Next time `Time.time` this body may start a heal. */
	public healReadyTimestamp = 0;
	/** Next time `Time.time` this body may raise its guard. */
	public blockReadyTimestamp = 0;

	/**
	 * Whether `verb` has rested since its last use; undefined for a verb with no rest of its own. An attack's short
	 * wait between swings is not a rest: the attack waits it out.
	 */
	public isReady(verb:string):boolean | undefined {
		const at = verb === 'block' ? this.blockReadyTimestamp : verb === 'heal' ? this.healReadyTimestamp : undefined;
		return at === undefined ? undefined : Time.time >= at;
	}

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
