import { Component, Time } from '@arc-director/kindling';

/** How long a meal keeps hunger away, and how long what it does beyond that lasts, game seconds. */
const FULL_SECONDS = 20 * 60;
const BOOST_SECONDS = 5 * 60;

/**
 * What a body has eaten, and what that does for it: full until `fullUntil`, swifter and luckier for a while. It is
 * hungry from the start only if it spawned with one: anyone else gets theirs with their first meal.
 */
export class Belly extends Component {
	public static override saved = ['ate', 'fullUntil', 'swiftUntil', 'swift', 'luckyUntil', 'lucky'];
	/** The item def of every food it has ever eaten. */
	public ate:string[] = [];
	public fullUntil = 0;
	public swiftUntil = 0;
	public swift = 0;
	public luckyUntil = 0;
	public lucky = 0;

	public get hungry():boolean {
		return Time.time >= this.fullUntil;
	}

	/** How much faster it walks, as a share of its usual speed. */
	public get haste():number {
		return Time.time < this.swiftUntil ? this.swift : 0;
	}

	/** What it adds to a chance that luck can sway. */
	public get luck():number {
		return Time.time < this.luckyUntil ? this.lucky : 0;
	}

	/** A meal of `defID`, with `effect` by `amount` on top. Says what the eater feels. */
	public eat(defID:string, effect:string, amount:number):string {
		this.ate.push(defID);
		this.fullUntil = Time.time + FULL_SECONDS;
		if (effect === 'swift') {
			this.swift = amount;
			this.swiftUntil = Time.time + BOOST_SECONDS;
			return 'ate; you are full, and your feet feel light for a while';
		}
		if (effect === 'lucky') {
			this.lucky = amount;
			this.luckyUntil = Time.time + BOOST_SECONDS;
			return 'ate; you are full, and you feel lucky for a while';
		}
		return 'ate; you are full';
	}
}
