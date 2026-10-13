import type { ExprVal } from 'arc-director';
import { Camera } from './components';
import { Component } from './Component';
import { Order } from './order';
import type { GameHost } from '../director/adapter';

/** Seconds between asks of the focus expression. */
const ASK_EVERY = 0.5;
/** How fast the rig closes on the focus point (1/s). */
const EASE = 1.5;

/**
 * Glides the player, the camera's rig, to the middle of whom a watch expression picks as the player
 * sees them (`others.filter(u => doing(u, "cleave"))`). Pair with `player=camera`, which has no body
 * to bump into walls. Empty `expr` leaves the player alone.
 */
export class CameraFocus extends Component {
	public static override order = Order.camera;
	public director!:GameHost;
	public expr = '';
	private _goal:{ x:number; z:number } | null = null;
	private _wait = 0;

	/** Camera distance from the rig, in meters (clamped to the camera's range). */
	public set zoom(distance:number) {
		const cam = this.gameObject.world?.findByID('MainCamera')?.getComponent(Camera);
		if (cam) {
			cam.distance = Math.min(cam.maxDistance, Math.max(cam.minDistance, distance));
		}
	}

	/** Whom `expr` picks now, by id, or why it cannot say. */
	public picks(expr = this.expr):string[] | { error:string } {
		const r = this.director.arc?.evaluate('Player', expr);
		if (!r) {
			return { error: 'ArcDirector is not running' };
		}
		return r.error ? { error: r.error.message } : idsIn(r.value);
	}

	public override update(dt:number):void {
		const player = this.gameObject.world?.findByID('Player');
		if (!player || !this.expr) {
			this._goal = null;
			return;
		}
		this._wait -= dt;
		if (this._wait <= 0) {
			this._wait = ASK_EVERY;
			this._goal = this.middle() ?? this._goal;
		}
		if (this._goal) {
			const t = 1 - Math.exp(-EASE * dt);
			const p = player.transform.position;
			p.x += (this._goal.x - p.x) * t;
			p.z += (this._goal.z - p.z) * t;
		}
	}

	private middle():{ x:number; z:number } | null {
		const world = this.gameObject.world;
		const ids = this.picks();
		if (!world || !Array.isArray(ids)) {
			return null;
		}
		const points = ids.flatMap((id) => {
			const go = world.findNamed(id) ?? world.findByID(id);
			return go ? [go.transform.position] : [];
		});
		if (points.length === 0) {
			return null;
		}
		return {
			x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
			z: points.reduce((sum, p) => sum + p.z, 0) / points.length,
		};
	}
}

function idsIn(value:ExprVal):string[] {
	if (value.kind === 'entity') {
		return [value.value.id];
	}
	return value.kind === 'list' ? value.value.flatMap(idsIn) : [];
}
