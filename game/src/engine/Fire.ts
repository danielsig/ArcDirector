import { AudioSource, Component, Time, overInk } from '@arc-director/kindling';
import type * as THREE from 'three';
import { disposeFlame, flameSprite } from '../render/spellFx';
import { SFX } from '../audio/sfx';
import { Light } from './components';

/** How far off a fire is heard crackling (m). */
const HEAR = 6;

/**
 * A fire burning on its object, only to look at, listen to and see by (a brazier's): the fireball's flames
 * standing up, `size` m across, their ball `height` m above the object's origin, roaring and crackling, and a
 * flickering `Light` over them out of daylight.
 */
export class Fire extends Component {
	public size = 1.1;
	public height = 0.92;
	/** Intensity of the light it casts, which it only does out of daylight (`World.daylight`). */
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
		light.enabled = !this.gameObject.world?.daylight;
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

	public override update(dt:number):void {
		this._flame?.burn(Time.time);
		const light = this.gameObject.getComponent(Light);
		if (light?.enabled) {
			light.intensity = this.glow * light.pulse(dt);
		}
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
