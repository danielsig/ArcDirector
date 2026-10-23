import type { VerbDef } from '../arc/stock-verbs.js';

/** What lasts on a fighter for a while. */
export type StatusKind = 'stun' | 'root' | 'slow' | 'silence' | 'shield' | 'taunt' | 'burn';

/**
 * What an ability does to whoever it hits, besides damage and healing: a status for `seconds` (a stun stops all
 * acting and breaks a cast; a root, moving; a silence, all but the basic attack; a slow takes `amount` of the speed;
 * a shield soaks `amount` damage; a taunt makes the hit foe go for whoever taunted; a burn hurts `amount` a second),
 * or a cleanse, which ends every stun, root, slow, silence and burn.
 */
export type Effect = { status:StatusKind; seconds:number; amount?:number } | { cleanse:true };

/** One thing a fighter can do: its verb's name is the key it is listed under. */
export type Ability = {
	/** Paces it reaches. */
	range:number;
	damage?:number;
	heal?:number;
	/** Seconds before it can be used again. */
	cooldown:number;
	/** Seconds it takes to land. A stun in that time breaks it, and everyone sees it coming. */
	cast?:number;
	/** It also hits everyone on the target's side within these paces of the target. */
	splash?:number;
	effects?:Effect[];
	/** More damage on a foe already under status `against`: the payoff of a combo another ability sets up. */
	bonus?:{ against:StatusKind; damage:number };
	/** Whom it is for: a foe (default), an ally (heals, wards) or its user alone. */
	on?:'foe' | 'ally' | 'self';
	/** A basic attack: it keeps striking until the target is down. Anything else is one use. */
	repeat?:true;
	/** Its user is spent when it lands, as a burster blowing up. */
	spends?:true;
};

/** Every ability, once: its name is its verb, and means the same whoever has it. */
export const ABILITIES:Record<string, Ability> = {
	// Basic attacks.
	shoot: { range: 12, damage: 5, cooldown: 1.5, repeat: true },
	hex: { range: 8, damage: 3, cooldown: 1, cast: 0.5, repeat: true },
	cleave: { range: 2, damage: 4, cooldown: 1.5, splash: 1.5, repeat: true },
	stab: { range: 1.5, damage: 3, cooldown: 1, repeat: true },
	smash: { range: 2, damage: 6, cooldown: 2, repeat: true },
	smite: { range: 6, damage: 2, cooldown: 1, repeat: true },
	fire: { range: 9, damage: 2, cooldown: 1, repeat: true },
	// One use, then a cooldown.
	protect: { range: 8, cooldown: 8, on: 'ally', effects: [{ status: 'shield', seconds: 6, amount: 8 }] },
	mend: { range: 8, heal: 3, cooldown: 4, cast: 1, on: 'ally' },
	patch: { range: 9, heal: 6, cooldown: 1.5, on: 'ally' },
	purify: { range: 8, cooldown: 6, on: 'ally', effects: [{ cleanse: true }] },
	taunt: { range: 6, cooldown: 10, effects: [{ status: 'taunt', seconds: 5 }] },
	bash: { range: 2, damage: 2, cooldown: 8, effects: [{ status: 'stun', seconds: 2 }] },
	kick: { range: 1.5, cooldown: 8, effects: [{ status: 'stun', seconds: 1.5 }] },
	frost: { range: 8, damage: 2, cooldown: 12, splash: 3, effects: [{ status: 'root', seconds: 3 }] },
	inferno: { range: 9, damage: 9, cooldown: 30, cast: 1.5, splash: 4 },
	firestorm: { range: 10, damage: 14, cooldown: 20, cast: 4, splash: 5 },
	venom: { range: 7, damage: 1, cooldown: 6, effects: [{ status: 'burn', seconds: 8, amount: 1 }, { status: 'slow', seconds: 8, amount: 0.5 }] },
	burst: { range: 1, damage: 12, cooldown: 1, splash: 2.5, spends: true },
	potion: { range: 0, heal: 12, cooldown: 30, on: 'self' },
	// Aimed: wasted if its target is down before it lands.
	snipe: { range: 14, damage: 10, cooldown: 8, cast: 2 },
	impale: { range: 2, damage: 2, cooldown: 6, bonus: { against: 'root', damage: 14 } },
};

/** A kind of fighter: how much it takes, how fast it walks (paces a second), and what it can do. */
export type FighterKind = { hp:number; speed:number; abilities:readonly (keyof typeof ABILITIES)[] };

/** The fighters a scene can field, by kind. */
export const FIGHTERS:Record<string, FighterKind> = {
	Archer: { hp: 12, speed: 3, abilities: ['shoot'] },
	Witch: { hp: 12, speed: 3, abilities: ['hex', 'frost', 'inferno'] },
	Knight: { hp: 28, speed: 2.5, abilities: ['cleave', 'taunt', 'bash', 'protect'] },
	Cleric: { hp: 14, speed: 3, abilities: ['smite', 'mend', 'purify', 'protect'] },
	Rogue: { hp: 14, speed: 4, abilities: ['stab', 'kick', 'venom'] },
	Blade: { hp: 20, speed: 3, abilities: ['stab'] },
	Brute: { hp: 40, speed: 2, abilities: ['smash'] },
	Shaman: { hp: 14, speed: 2.5, abilities: ['smite', 'firestorm'] },
	Assassin: { hp: 14, speed: 5, abilities: ['stab'] },
	Medic: { hp: 10, speed: 3, abilities: ['patch'] },
	Rifleman: { hp: 10, speed: 3, abilities: ['fire'] },
	Raider: { hp: 14, speed: 3.5, abilities: ['stab'] },
	Lurker: { hp: 18, speed: 2, abilities: ['smash'] },
	Burster: { hp: 6, speed: 4.5, abilities: ['burst'] },
	Marksman: { hp: 10, speed: 3, abilities: ['snipe'] },
	Harpooner: { hp: 20, speed: 3, abilities: ['stab', 'impale'] },
};

/** How a fighter nobody commands fights. */
export type Tactic =
	/** Goes for the nearest foe (or its `focus`), with whatever is ready. */
	| 'charge'
	/** As `charge`, but never moves. */
	| 'hold'
	/** Mends and wards the most hurt ally; fights only when no one needs it. */
	| 'healer'
	/** Runs at where its foes stand thickest and blows up there. */
	| 'burster'
	/** Heads for its `toward` (a place, a thing or someone), fighting what comes into its reach on the way; fights on there. */
	| 'march'
	/** Holds its post, going for foes that come within its `guard` paces of it; back to its post once none is. */
	| 'guard';

/** Every ability as a verb: whom it is used on. The verb's help is the ability's numbers. */
export const FIGHT_VERBS:Record<string, VerbDef> = Object.fromEntries(Object.entries(ABILITIES).map(([name, ability]):[string, VerbDef] => [
	name,
	{ args: ability.on === 'self' ? {} : { target: 'id' } },
]));

/** One line on what `ability` does, as its verb's help. */
export function abilityHelp(ability:Ability):string {
	const parts = [
		ability.damage && `${ability.damage} damage`,
		ability.heal && `heals ${ability.heal}`,
		...(ability.effects ?? []).map((e) => ('cleanse' in e ? 'ends stuns, roots, slows and burns'
			: `${e.status}${e.amount !== undefined ? ` ${e.amount}` : ''} for ${e.seconds}s${e.status === 'stun' ? ', which breaks a cast' : ''}`)),
		ability.bonus && `${ability.bonus.damage} more on a ${STATUS_WORDS[ability.bonus.against]} foe`,
		ability.splash && `hits all within ${ability.splash} paces of the target`,
		ability.range > 0 && `${ability.range} paces`,
		ability.cast && `${ability.cast}s to cast`,
		ability.repeat ? `every ${ability.cooldown}s until the target is down` : `then ${ability.cooldown}s before again`,
		ability.on === 'ally' && 'on an ally or you',
		ability.spends && 'you are spent',
	];
	return parts.filter(Boolean).join(', ');
}

/** How a fighter under each status is seen: `stunned`, `rooted`. A taunt shows on no one. */
const STATUS_WORDS:Record<StatusKind, string> = { stun: 'stunned', root: 'rooted', slow: 'slowed', silence: 'silenced', shield: 'shielded', burn: 'burning', taunt: 'taunted' };

/** A status on a fighter, until game time `until`; a taunt remembers who taunted. */
type Status = { kind:StatusKind; until:number; amount:number; by?:string };

/** One fighter in a scene: what it is, whose side, and how it stands now. */
export class Fighter {
	public readonly kind:FighterKind;
	/** Its kind's name in {@link FIGHTERS}, if it is one. */
	public readonly kindName:string | undefined;
	public readonly team:string;
	public readonly tactic:Tactic | undefined;
	public readonly focus:string | undefined;
	public hp:number;
	public readonly maxHP:number;
	/** The ability being cast, at whom, landing at game time `lands`. */
	public casting:{ ability:string; target:string; lands:number } | undefined;
	/** The ability it used last, and when: what it is seen doing, for a moment after. */
	public lastUsed:{ ability:string; at:number } | undefined;
	private readonly _readyAt = new Map<string, number>();
	private _statuses:Status[] = [];

	constructor(kind:FighterKind, team:string, opts:{ hp?:[number, number]; tactic?:Tactic; focus?:string; kindName?:string } = {}) {
		this.kind = kind;
		this.kindName = opts.kindName;
		this.team = team;
		this.tactic = opts.tactic;
		this.focus = opts.focus;
		this.maxHP = opts.hp?.[1] ?? kind.hp;
		this.hp = opts.hp?.[0] ?? this.maxHP;
	}

	public has(kind:StatusKind, now:number):Status | undefined {
		return this._statuses.find((s) => s.kind === kind && s.until > now);
	}

	public canAct(now:number):boolean {
		return !this.has('stun', now);
	}

	public canMove(now:number):boolean {
		return !this.has('stun', now) && !this.has('root', now);
	}

	/** Paces a second it walks now. */
	public speed(now:number):number {
		return this.kind.speed * (1 - (this.has('slow', now)?.amount ?? 0));
	}

	/** Seconds until `ability` is ready again. */
	public wait(ability:string, now:number):number {
		return Math.max(0, (this._readyAt.get(ability) ?? 0) - now);
	}

	/** Whether it may use `ability` now, cooldown aside: not stunned, and not silenced unless a basic attack. */
	public allowed(ability:string, now:number):boolean {
		return this.canAct(now) && (ABILITIES[ability].repeat === true || !this.has('silence', now));
	}

	public used(ability:string, now:number):void {
		this.lastUsed = { ability, at: now };
		this._readyAt.set(ability, now + ABILITIES[ability].cooldown);
	}

	/** `effect` from `by`, at game time `now`. A stun breaks a cast. */
	public suffer(effect:Effect, now:number, by:string):void {
		if ('cleanse' in effect) {
			this._statuses = this._statuses.filter((s) => s.kind === 'shield' || s.kind === 'taunt');
			return;
		}
		this._statuses = [...this._statuses.filter((s) => s.kind !== effect.status), { kind: effect.status, until: now + effect.seconds, amount: effect.amount ?? 0, by }];
		if (effect.status === 'stun') {
			this.casting = undefined;
		}
	}

	/** Takes `damage`, its shield first; the damage that got through. */
	public hurt(damage:number, now:number):number {
		const shield = this.has('shield', now);
		const soaked = shield ? Math.min(shield.amount, damage) : 0;
		if (shield) {
			shield.amount -= soaked;
		}
		this.hp = Math.max(0, this.hp - (damage - soaked));
		return damage - soaked;
	}

	public heal(amount:number):void {
		this.hp = Math.min(this.maxHP, this.hp + amount);
	}

	/** Burns over `dt` seconds. */
	public burn(now:number, dt:number):void {
		const burn = this.has('burn', now);
		if (burn) {
			this.hp = Math.max(0, this.hp - burn.amount * dt);
		}
	}

	/** Whoever taunted it, while the taunt lasts. */
	public tauntedBy(now:number):string | undefined {
		return this.has('taunt', now)?.by;
	}

	/** What others see on it: casting, stunned, rooted, shielded. */
	public note(now:number):string[] {
		return [
			this.casting && `casting ${this.casting.ability}`,
			...(['stun', 'root', 'slow', 'silence', 'shield', 'burn'] as const)
				.filter((kind) => this.has(kind, now))
				.map((kind) => STATUS_WORDS[kind]),
		].filter((s):s is string => !!s);
	}
}
