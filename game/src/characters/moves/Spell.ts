import { isLiving } from '../../director/names';
import { fireball, FIREBALL_SPEED, healLight, lightning, RELEASE_GRACE, type Cast, type Outcome } from '../../render/spell-fx';
import { THREE, MeshRenderer, aimHeld, ease, humanBone, palmOf, reach, type GameObject, type SfxHandle, HeldProps, cueAt, cueAtPoint, type SfxName, UP, aheadOf, heightOf, pointOn, stanceOf, PoseMove } from './pose-body';

type SpellSounds = { gather:SfxName; loose?:SfxName; hit:SfxName; miss:SfxName };
/**
 * Spells by verb: the effect each plays from the staff's head (or the casting hand), how fast it
 * flies to the target once loosed (m/s; none strikes at once), and how the right hand holds the staff
 * while the spell gathers: ahead of the shoulder (`out`) and above it (`up`, fractions of height),
 * the head pointing at the target and `rise` up (1 is 45°), or held high and upright for a heal.
 * Its sounds: gathering, as it is loosed (at the caster), and where it lands on a hit or a miss.
 */
const SPELLS:Record<string, { fx:(scene:THREE.Object3D, cast:Cast)=>void; speed?:number; out:number; up:number; rise:number; sound:SpellSounds }> = {
	hex: { fx: fireball, speed: FIREBALL_SPEED, out: 0.3, up: 0.05, rise: 0.4, sound: { gather: 'fireCast', loose: 'fireThrow', hit: 'fireHit', miss: 'fireHit' } },
	smite: { fx: lightning, out: 0.32, up: 0, rise: 0.2, sound: { gather: 'sparkCast', hit: 'thunder', miss: 'thunder' } },
	heal: { fx: healLight, out: 0.2, up: 0.2, rise: 3, sound: { gather: 'healCast', hit: 'healLand', miss: 'fizzle' } },
};
/** Seconds the casting arm takes to come up (at most half the cast), holds on after the spell lands, and takes to go back down. */
const CAST_RAISE = 0.35;
const CAST_HOLD = 0.15;
const CAST_LOWER = 0.4;
/** A held staff's own axes: its head up its +Y, its side along ±X. */
const STAFF_HEAD = new THREE.Vector3(0, 1, 0);
const STAFF_SIDE = new THREE.Vector3(1, 0, 0);

/** A spell under way; `gathering` is its gathering sound, playing until it is settled. */
type Casting = { spell:(typeof SPELLS)[string]; t0:number; windUp:number; target:GameObject; outcome?:Outcome; gathering?:SfxHandle | null };

/**
 * Casting with the staff in the right hand: the hand comes up ahead of the shoulder, the staff's head toward the
 * target (or high), and the spell gathers at its head and flies or strikes.
 */
export class Spell extends PoseMove<Casting> {
	/** Where the spell under way leaves from, as of the last pose (a staff's head). */
	private readonly _castFrom = new THREE.Vector3();

	/**
	 * Casts the spell for `verb` at `target` (this character, healing itself) so it lands `windUp`
	 * seconds from now, and returns true: the staff comes up and the spell plays from its head. Any
	 * other verb does nothing: false.
	 */
	/** Stops the gathering sound of a spell still under way. */
	public override dispose():void {
		this.current?.gathering?.stop();
	}

	public cast(verb:string, windUp:number, target:GameObject):boolean {
		const spell = SPELLS[verb];
		const world = this.go.world;
		if (!spell || !world) {
			return false;
		}
		const casting:Casting = { spell, t0: this.now, windUp, target };
		// One spell at a time: one still unsettled is cut short, and its effect goes.
		if (this.current) {
			this.current.outcome ??= 'cut';
			this.current.gathering?.stop();
		}
		this.current = casting;
		this._castFrom.copy(this.castFrom());
		// Its gathering sound runs the whole cast, and stops as it is loosed or cut short.
		casting.gathering = cueAt(world, spell.sound.gather, this.go, undefined, windUp + RELEASE_GRACE);
		spell.fx(world.native, {
			from: () => (isLiving(this.go) ? this._castFrom.clone() : null),
			caster: () => (isLiving(this.go) ? stanceOf(this.go) : null),
			target: () => stanceOf(target),
			seconds: windUp,
			outcome: () => casting.outcome,
		});
		return true;
	}

	/** How the spell under way turned out (see `CharacterPose.resolve`): its sound as it goes, then where it lands; a fizzle when cut. */
	public resolve(outcome:Outcome):void {
		const cast = this.current;
		if (!cast || cast.outcome !== undefined) {
			return;
		}
		cast.gathering?.stop();
		const world = this.go.world;
		const sound = cast.spell.sound;
		if (world && outcome === 'cut') {
			cueAt(world, 'fizzle', this.go);
		}
		else if (world) {
			if (sound.loose) {
				cueAt(world, sound.loose, this.go);
			}
			world.after(this.flightTime(), () => cueAtPoint(world, outcome === 'hit' ? sound.hit : sound.miss, pointOn(cast.target, 0.5)));
		}
		cast.outcome = outcome;
	}

	/** Seconds the spell under way will take to reach its target once loosed: 0 for a bolt or a heal, or with none. */
	public flightTime():number {
		const speed = this.current?.spell.speed;
		return this.current && speed ? pointOn(this.go, 0.6).distanceTo(pointOn(this.current.target, 0.55)) / speed : 0;
	}

	public override update(root:THREE.Object3D, alive:boolean):void {
		const cast = this.current;
		if (!cast) {
			return;
		}
		const t = this.now - cast.t0;
		const end = cast.windUp + CAST_HOLD;
		if (!alive || t > end + CAST_LOWER) {
			cast.gathering?.stop();
			this.current = null;
			return;
		}
		const shoulder = humanBone(root, 'rightUpperArm');
		if (!shoulder) {
			return;
		}
		const height = heightOf(this.go);
		const weight = Math.min(
			ease.inOutSine(Math.min(1, t / Math.min(CAST_RAISE, cast.windUp / 2))),
			1 - ease.inOutSine(THREE.MathUtils.clamp((t - end) / CAST_LOWER, 0, 1)),
		);
		const toward = pointOn(cast.target, 0).sub(pointOn(this.go, 0)).setY(0);
		const ahead = toward.lengthSq() > 0.01 ? toward.normalize() : aheadOf(this.go, 1);
		const right = new THREE.Vector3().crossVectors(ahead, UP);
		const { spell } = cast;
		root.updateMatrixWorld(true);
		const hand = shoulder.getWorldPosition(new THREE.Vector3()).addScaledVector(ahead, spell.out * height).addScaledVector(UP, spell.up * height);
		reach(root, 'right', hand, weight, UP.clone().negate().addScaledVector(right, 0.6));
		const staff = this.go.getComponent(HeldProps)?.prop('right');
		if (staff) {
			aimHeld(root, 'right', staff, STAFF_HEAD, STAFF_SIDE, ahead.clone().addScaledVector(UP, spell.rise).normalize(), right, weight);
		}
		this._castFrom.copy(this.castFrom());
	}

	/** Where a spell leaves from: the head of the staff in the right hand, or the hand itself. */
	private castFrom():THREE.Vector3 {
		const root = this.go.getComponent(MeshRenderer)?.mesh;
		return this.go.getComponent(HeldProps)?.tip('right')
			?? (root && palmOf(root, 'right'))
			?? pointOn(this.go, 0.6);
	}
}
