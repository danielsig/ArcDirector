import { AudioSource, Component, Time, overInk, type GameObject, type SfxPatch } from '@arc-director/kindling';
import * as THREE from 'three';
import { Light } from '../../engine/components';
import { addFlameLight } from './torch';
import { enclosureAt, Interior } from '../houses/interior';
import { disposeFlame, flameSprite } from '../../render/spell-fx';
import { thingAt, type Thing } from '../thing';

/** How far off a fire is heard crackling (m). */
const HEAR = 6;

/** A fire burning (a loop): a low roar of flame with a crackle of wood through it. */
const ROAR:SfxPatch = {
	gain: 0.15,
	layers: [
		{ kind: 'noise', dur: 1, cutoff: 500, gain: 0.4 },
		{ kind: 'crackle', dur: 1, rate: 25, cutoff: 2200, q: 0.8, gain: 0.9 },
	],
};

/** A fire's flickering light `height` m up, `opts` aside. */
export function addFireLight(go:GameObject, height:number, opts:Partial<Light>):Light {
	// Its shadows start past the bowl and coals under the flames, which would shade a disc of floor around the stand.
	return addFlameLight(go, { color: 0xff8a3a, shadowNear: 0.35, offsetY: height, ...opts });
}

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
		const light = this.gameObject.getComponent(Light) ?? addFireLight(this.gameObject, this.height, { intensity: this.glow });
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
		sound.loop = ROAR;
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
		// A room of a place is only a named area: open sky over the temple, rock over the crypt (never daylight).
		const under = world && enclosureAt(world, p.x, p.z);
		return !world?.daylight || (!!under && !under.getComponent(Interior)?.room);
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

/** The fire in a brazier (its bowl and coals are chunk dressing): flames only, which no one sees as a thing, whatever the map calls it. */
export const fire:Thing = {
	defs: ['brazier'],
	spawn: (world, chunk, ents) => ents.forEach((ent) => {
		const go = thingAt(chunk, { ...ent, name: undefined }, `fire_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Fire');
		go.addComponent(Fire);
		world.add(go);
	}),
};
