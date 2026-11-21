import { Component, Game, Camera } from '@arc-director/kindling';
import { DemoWorld } from './demo-world';
import { CAMERA_DISTANCE, FollowCamera } from './components';
import { PlayerInput } from '../characters/PlayerInput';
import { sceneByID } from '../scenes/scene-registry';
import type { Scene } from '../scenes/scene';
import { SHADOWS, loadSceneArt, spawnScene } from './demo-game';

/** Radians a second the camera circles. */
const ORBIT_SPEED = 0.06;
/** Meters from the middle of the scene: wide enough to show most of it. */
const ORBIT_DISTANCE = 18;
/** Width over height of the menu's stills of each backdrop (`game/scripts/shoot-backdrops.mjs` shoots at this). */
export const STILL_ASPECT = 16 / 9;
/** Frames drawn after the scene's art loads before it counts as ready: shadows and lighting take a few to settle. */
const SETTLE_FRAMES = 12;

/**
 * A fixed shot instead of the circling one: the hidden player's world `x`, `z`, the camera's `yaw` behind it (0 looks north), and its
 * `zoom` (distance in meters; the camera's default when unset).
 */
export type ShowcaseView = { x:number; z:number; yaw:number; zoom?:number };

/** Turns the main camera slowly round its target (the hidden player). */
class Orbit extends Component {
	public override update(dt:number):void {
		const cam = this.gameObject.world?.findByID('MainCamera')?.getComponent(FollowCamera);
		if (cam) {
			cam.orbitYaw += dt * ORBIT_SPEED;
		}
	}
}

/**
 * A scene with no one minding it, the camera circling its `orbit` point (else the player's start): the live backdrop behind the main
 * menu. Its cast stand where they spawn (no ArcDirector), and it writes no prefs, URL, save or pose,
 * and plays no sound. The view is framed as its still is shown (covering the screen), and the camera holds still until `ready`.
 * With a fixed view, the camera looks from there and never circles (the menu's card pictures).
 */
export class Showcase extends Game<DemoWorld> {
	/** Resolves once the scene's art has loaded and a few frames are drawn; the camera starts circling then. */
	public readonly ready:Promise<void>;
	private readonly _scene:Scene;
	private readonly _orbit:Orbit;
	private readonly _lens:Camera | null;
	private readonly _fov:number;
	private _artLoaded = false;
	private _settleFrames = SETTLE_FRAMES;
	private _settled:()=>void = () => {};

	constructor(sceneID:string, private readonly _fixed?:ShowcaseView) {
		super(new DemoWorld());
		// The menu stays smooth beside another window.
		this.unfocusedHz = Infinity;
		this._scene = sceneByID(sceneID);
		const { systems, stream } = spawnScene(this.world, this._scene);
		const renderer = this.renderer;
		if (renderer) {
			// Baked shadows: a backdrop should cost little.
			renderer.shadows = SHADOWS.simple.mode;
			renderer.pointShadowMapSize = SHADOWS.simple.point;
			renderer.directionalShadowMapSize = SHADOWS.simple.sun;
		}
		const player = this.world.findByID('Player');
		if (player) {
			player.transform.object3D.visible = false;
			const input = player.getComponent(PlayerInput);
			if (input) {
				input.enabled = false;
			}
		}
		const camera = this.world.findByID('MainCamera');
		const cam = camera?.getComponent(FollowCamera);
		if (cam) {
			cam.distance = _fixed ? _fixed.zoom ?? CAMERA_DISTANCE : ORBIT_DISTANCE;
			if (_fixed) {
				cam.yaw = cam.orbitYaw = _fixed.yaw;
			}
		}
		this._lens = camera?.getComponent(Camera) ?? null;
		this._fov = this._lens?.fov ?? 0;
		this.ready = new Promise((resolve) => {
			this._settled = resolve;
		});
		this._orbit = systems.addComponent(Orbit, { enabled: false });
		this.world.add(systems);
		const at = _fixed ?? this._scene.orbit;
		if (player && at) {
			// The camera follows the player, so the hidden player stands where it looks from.
			const p = player.transform.position;
			p.x = at.x;
			p.z = at.z;
			p.y = this.world.terrain.sample(at.x, at.z)?.worldY ?? p.y;
		}
		stream.stream();
		this.world.audio.muted = true;
	}

	protected override onStart():void {
		void loadSceneArt(this._scene).then(() => {
			this._artLoaded = true;
		});
	}

	public override tick(dt:number):void {
		this.coverStill();
		super.tick(dt);
		if (this._artLoaded && this._settleFrames > 0 && --this._settleFrames === 0) {
			this._orbit.enabled = !this._fixed;
			this._settled();
		}
	}

	/**
	 * Wider than the still, narrows the lens so the view crops top and bottom as the still does when it covers the screen; narrower,
	 * the lens's own height already crops the sides alike.
	 */
	private coverStill():void {
		const canvas = this.canvas;
		if (!this._lens || !canvas || canvas.clientHeight === 0) {
			return;
		}
		const aspect = canvas.clientWidth / canvas.clientHeight;
		const half = this._fov * Math.PI / 360;
		this._lens.fov = aspect > STILL_ASPECT ? Math.atan(Math.tan(half) * STILL_ASPECT / aspect) * 360 / Math.PI : this._fov;
	}
}
