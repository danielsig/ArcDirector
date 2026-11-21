import { Component, Rigidbody } from '@arc-director/kindling';
import { FollowCamera } from './components';
import { Order } from './order';
import { PlayerInput } from '../characters/PlayerInput';
import { prefs } from '../prefs';
import { loadViewPose, packViewPose, saveViewPose, type ViewPose } from './view-persist';
import { applyURLView, writeURLView, type URLView } from './url-view';

/** The player and the camera behind it: read, put somewhere, and kept in localStorage and the URL's `view` every 0.3 s. */
export class PlayerPose extends Component {
	public static override order = Order.persist;
	public sceneID!:string;
	/** Where Reset location puts the player: the scene's spawn, as built. */
	public home:ViewPose | null = null;
	private _persistAcc = 0;
	private _lastPacked = '';

	public override lateUpdate(dt:number):void {
		this._persistAcc += dt;
		if (this._persistAcc < 0.3) {
			return;
		}
		this._persistAcc = 0;
		this.persist();
		this.syncURL();
	}

	/** Back to `home`, kept at once. */
	public reset():void {
		if (this.home) {
			this.apply(this.home);
		}
		this.persist();
		this.syncURL();
	}

	/** The last pose this scene kept, if any. */
	public applyLast():void {
		const pose = loadViewPose(this.sceneID);
		if (pose) {
			this.apply(pose);
		}
	}

	/** Puts the player at a URL `view`'s spot, facing its yaw, the camera behind. */
	public snapTo(view:URLView | null):void {
		const pose = view && this.read();
		if (view && pose) {
			this.apply(applyURLView(pose, view));
		}
	}

	public read():ViewPose | null {
		const world = this.gameObject.world;
		const player = world?.findByID('Player');
		const cam = world?.findByID('MainCamera')?.getComponent(FollowCamera);
		if (!player || !cam) {
			return null;
		}
		const look = player.getComponent(PlayerInput);
		return {
			x: player.transform.position.x,
			y: player.transform.position.y,
			z: player.transform.position.z,
			yaw: look?.lookYaw ?? player.transform.yaw,
			camYaw: cam.yaw,
			pitch: cam.pitch,
			distance: cam.distance,
		};
	}

	public apply(pose:ViewPose):void {
		const world = this.gameObject.world;
		const player = world?.findByID('Player');
		const cam = world?.findByID('MainCamera')?.getComponent(FollowCamera);
		if (!player || !cam) {
			return;
		}
		player.transform.position.x = pose.x;
		player.transform.position.y = pose.y;
		player.transform.position.z = pose.z;
		player.transform.yaw = pose.yaw;
		const look = player.getComponent(PlayerInput);
		if (look) {
			look.lookYaw = pose.yaw;
			look.moveX = 0;
			look.moveZ = 0;
		}
		const rb = player.getComponent(Rigidbody);
		if (rb) {
			rb.velocity.x = 0;
			rb.velocity.z = 0;
			rb.prevX = pose.x;
			rb.prevZ = pose.z;
		}
		cam.orbitYaw = pose.yaw;
		cam.pitch = pose.pitch;
		cam.distance = Math.max(cam.minDistance, Math.min(cam.maxDistance, pose.distance));
		cam.snap();
	}

	/** Keeps the pose in localStorage when it moved. */
	public persist():void {
		const pose = this.read();
		const packed = pose && packViewPose(pose);
		if (packed && packed !== this._lastPacked) {
			this._lastPacked = packed;
			saveViewPose(this.sceneID, packed);
		}
	}

	/** Keeps the URL's `player` and `ai` in step, and its `view` when it has one. */
	public syncURL():void {
		const pose = this.read();
		if (pose) {
			writeURLView(pose, prefs());
		}
	}
}
