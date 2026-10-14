import { AudioSource, Component, Time, overInk } from '@arc-director/kindling';
import type * as THREE from 'three';
import { disposeFlame, flameSprite } from '../render/spellFx';
import { SFX } from '../audio/sfx';

/** How far off a fire is heard crackling (m). */
const HEAR = 6;

/**
 * A fire burning on its object, only to look at and listen to (a brazier's): the fireball's flames
 * standing up, `size` m across, their ball `height` m above the object's origin, roaring and crackling.
 */
export class Fire extends Component {
	public size = 1.1;
	public height = 0.92;

	private _flame:{ sprite:THREE.Sprite; burn:(age:number)=>void } | null = null;

	public override onEnable():void {
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

	public override update():void {
		this._flame?.burn(Time.time);
	}

	public override onDisable():void {
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
