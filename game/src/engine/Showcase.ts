import { Component, Game as KindlingGame, GameObject, resetAllocID, resetTime } from '@arc-director/kindling';
import { World } from './World';
import { Camera } from './components';
import { PlayerInput } from '../characters/PlayerInput';
import { rendererLook } from '../render/look';
import { sceneByID, type SceneDef } from '../data/scenes';
import { SHADOWS, loadSceneArt, spawnScene } from './Game';
import { WorldStream, WorldView } from './systems';

/** Radians a second the camera circles. */
const ORBIT_SPEED = 0.06;
/** Meters from the middle of the scene: wide enough to show most of it. */
const ORBIT_DISTANCE = 18;

/** Turns the main camera slowly round its target (the hidden player). */
class Orbit extends Component {
	public override update(dt:number):void {
		const cam = this.gameObject.world?.findByID('MainCamera')?.getComponent(Camera);
		if (cam) {
			cam.orbitYaw += dt * ORBIT_SPEED;
		}
	}
}

/**
 * A scene with no one minding it, the camera circling its `orbit` point (else the player's start): the live backdrop behind the main
 * menu. Its cast stand where they spawn (no ArcDirector), and it writes no prefs, URL, save or pose,
 * and plays no sound.
 */
export class Showcase extends KindlingGame<World> {
	private readonly _scene:SceneDef;
	private readonly _view:WorldView;

	constructor(sceneID:string) {
		super(new World());
		this._scene = sceneByID(sceneID);
		resetTime();
		resetAllocID();
		const renderer = this.renderer;
		if (renderer) {
			renderer.applyLook(rendererLook(this._scene.look));
			// Baked shadows: a backdrop should cost little.
			renderer.shadows = SHADOWS.simple.mode;
			renderer.pointShadowMapSize = SHADOWS.simple.point;
			renderer.directionalShadowMapSize = SHADOWS.simple.sun;
		}
		const decoded = spawnScene(this.world, this._scene);
		const player = this.world.findByID('Player');
		if (player) {
			player.transform.object3D.visible = false;
			const input = player.getComponent(PlayerInput);
			if (input) {
				input.enabled = false;
			}
		}
		const cam = this.world.findByID('MainCamera')?.getComponent(Camera);
		if (cam) {
			cam.distance = ORBIT_DISTANCE;
		}
		const systems = new GameObject('Systems', 'Systems');
		this._view = systems.addComponent(WorldView, { getRenderer: () => this.renderer });
		const stream = systems.addComponent(WorldStream, { chunks: decoded.map((d) => d.chunk) });
		systems.addComponent(Orbit);
		this.world.add(systems);
		stream.loadAll();
		stream.stream();
		const orbit = this._scene.orbit;
		if (player && orbit) {
			// The camera follows the player, so the hidden player stands where it circles.
			const p = player.transform.position;
			p.x = orbit.x;
			p.z = orbit.z;
			p.y = this.world.sampleTerrain(orbit.x, orbit.z)?.worldY ?? p.y;
		}
		this.world.audio.muted = true;
	}

	protected override onStart():void {
		void loadSceneArt(this._scene);
	}

	public override dispose():void {
		this._view.present.dispose();
		super.dispose();
	}
}
