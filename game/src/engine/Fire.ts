import { AudioSource, Component, MeshRenderer, Time, clamp, overInk } from '@arc-director/kindling';
import * as THREE from 'three';
import { disposeFlame, flameSprite } from '../render/spellFx';
import { flameMaterial, getSheet } from '../render/spritesheet';
import { SFX } from '../audio/sfx';
import { enclosureAt } from '../world/interior';
import { Flammable, Light } from './components';

/** How far off a fire is heard crackling (m). */
const HEAR = 6;

/**
 * A fire burning on its object, only to look at, listen to and see by (a brazier's): the fireball's flames
 * standing up, `size` m across, their ball `height` m above the object's origin, roaring and crackling, and a
 * flickering `Light` over them indoors or out of daylight.
 */
export class Fire extends Component {
	public size = 1.1;
	public height = 0.92;
	/** Intensity of the light it casts, which it only does indoors or out of daylight (`World.daylight`). */
	public glow = 56;

	private _flame:{ sprite:THREE.Sprite; burn:(age:number)=>void } | null = null;

	public override onEnable():void {
		const light = this.gameObject.getComponent(Light) ?? this.gameObject.addComponent(Light, {
			color: 0xff8a3a,
			intensity: this.glow,
			decay: 1.3,
			range: 11,
			castShadow: true,
			// Past the bowl and coals under the flames, which would shade a disc of floor around the stand.
			shadowNear: 0.35,
			offsetY: this.height,
			intensityFlicker: 0.75,
			intensityFlickerSpeed: 0.5,
		});
		light.enabled = this.shines();
		const flame = flameSprite();
		flame.sprite.scale.set(this.size, this.size, 1);
		flame.sprite.position.y = this.height;
		flame.sprite.visible = true;
		overInk(flame.sprite.material);
		this.gameObject.transform.object3D.add(flame.sprite);
		this._flame = flame;
		const sound = this.gameObject.getOrAddComponent(AudioSource);
		sound.hear = HEAR;
		sound.loop = SFX.brazier;
	}

	/** Houses are only built once their chunk's fires are, so whether it is indoors is known from here. */
	public override start():void {
		const light = this.gameObject.getComponent(Light);
		if (light) {
			light.enabled = this.shines();
		}
	}

	public override update(dt:number):void {
		this._flame?.burn(Time.time);
		const light = this.gameObject.getComponent(Light);
		if (light?.enabled) {
			light.intensity = this.glow * light.pulse(dt);
		}
	}

	/** Whether its light is worth seeing: out of daylight, or under a roof where the sun does not reach. */
	private shines():boolean {
		const world = this.gameObject.world;
		const p = this.gameObject.transform.position;
		return !world?.daylight || !!enclosureAt(world, p.x, p.z);
	}

	public override onDisable():void {
		const light = this.gameObject.getComponent(Light);
		if (light) {
			light.enabled = false;
		}
		const sound = this.gameObject.getComponent(AudioSource);
		if (sound) {
			sound.loop = null;
		}
		if (this._flame) {
			this._flame.sprite.removeFromParent();
			disposeFlame(this._flame.sprite);
			this._flame = null;
		}
	}
}

/** How many torch flames lick across a burning web, and how far they reach out from where it caught (m). */
const LICKS = 14;
const LICK_SPREAD = { x: 0.5, y: 2.2 };
/** Torch-flame frames per second, as a held torch's. */
const LICK_FPS = 10;

/**
 * Shows its `Flammable` burning: the fireball's flames (a `Fire`) roaring in the middle, torch flames spreading out
 * from where it caught across its face, and the thing itself fading to nothing as it burns away.
 */
export class Burns extends Component {
	private _licks:{ mesh:THREE.Mesh; at:number }[] = [];
	private _faded:THREE.Material[] = [];
	private _age = 0;

	public override update(dt:number):void {
		const flam = this.gameObject.getComponent(Flammable);
		if (!flam?.burning) {
			return;
		}
		if (!this.gameObject.getComponent(Fire)) {
			this.ignite();
		}
		this._age += dt;
		const u = Math.min(1, this._age / flam.burnSeconds);
		const frames = getSheet().flame;
		for (const [i, lick] of this._licks.entries()) {
			// Each catches as the spreading fire reaches it, flares, and dies down as the web goes.
			const life = clamp((u - lick.at) / (1 - lick.at), 0, 1);
			lick.mesh.visible = life > 0;
			lick.mesh.scale.setScalar(Math.sin(Math.PI * Math.sqrt(life)) * (1.6 + 0.4 * Math.sin(this._age * 9 + i)));
			const map = frames[(Math.floor(this._age * LICK_FPS) + i) % frames.length];
			const mat = lick.mesh.material as THREE.MeshBasicMaterial;
			if (map && mat.map !== map) {
				mat.map = map;
				mat.needsUpdate = true;
			}
		}
		for (const mat of this._faded) {
			mat.opacity = (mat.userData.opacity as number) * (1 - u * u);
		}
	}

	public override onDisable():void {
		for (const lick of this._licks) {
			lick.mesh.removeFromParent();
			lick.mesh.geometry.dispose();
			(lick.mesh.material as THREE.Material).dispose();
		}
		this._licks = [];
		for (const mat of this._faded) {
			mat.dispose();
		}
		this._faded = [];
	}

	private ignite():void {
		this.gameObject.addComponent(Fire, { size: 1.4, height: 1.1 });
		const root = this.gameObject.transform.object3D;
		const sheet = getSheet();
		for (let i = 0; i < LICKS; i++) {
			const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.38), flameMaterial(sheet.flame[0]!));
			mesh.position.set((Math.random() * 2 - 1) * LICK_SPREAD.x, 0.15 + Math.random() * LICK_SPREAD.y, 0.02);
			mesh.renderOrder = 2;
			mesh.visible = false;
			root.add(mesh);
			// Caught from the foot of the web in the middle, the fire climbing it.
			const reach = Math.hypot(mesh.position.x / LICK_SPREAD.x, mesh.position.y / LICK_SPREAD.y);
			this._licks.push({ mesh, at: 0.5 * Math.min(1, reach) });
		}
		// Its own copies of the web's materials, to fade without fading every other web.
		this.gameObject.getComponent(MeshRenderer)?.mesh?.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (mesh.isMesh) {
				const mat = (mesh.material as THREE.Material).clone();
				mat.transparent = true;
				mat.userData.opacity = mat.opacity;
				mesh.material = mat;
				this._faded.push(mat);
			}
		});
	}
}
