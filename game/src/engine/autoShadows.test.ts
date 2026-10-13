import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { AutoShadows } from './autoShadows';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	value: {
		getItem: (key:string) => store.get(key) ?? null,
		setItem: (key:string, value:string) => void store.set(key, value),
		removeItem: (key:string) => void store.delete(key),
	},
});

/** Runs `auto` for `seconds` of 60 Hz ticks, each reporting `frameMS`. */
function run(auto:AutoShadows, seconds:number, frameMS:number):void {
	for (let t = 0; t < seconds; t += 1 / 60) {
		auto.tick(1 / 60, frameMS);
	}
}

describe('AutoShadows', () => {
	beforeEach(() => {
		store.clear();
	});

	it('climbs to High while frames hold, and remembers it', () => {
		const auto = new AutoShadows();
		assert.equal(auto.tier, 'simple');
		run(auto, 3.1, 16.7);
		assert.equal(auto.tier, 'low');
		run(auto, 6.1, 16.7);
		assert.equal(auto.tier, 'high');
		assert.equal(new AutoShadows().tier, 'high');
	});

	it('steps back below the first tier that drops frames', () => {
		const auto = new AutoShadows();
		run(auto, 3.1, 16.7);
		run(auto, 3.1, 28);
		assert.equal(auto.tier, 'simple');
		run(auto, 10, 16.7);
		assert.equal(auto.tier, 'simple');
	});

	it('never goes below Simple, and waits out stalls', () => {
		const auto = new AutoShadows();
		run(auto, 10, 340);
		assert.equal(new AutoShadows().tier, 'simple');
		run(auto, 3.1, 45);
		assert.equal(auto.tier, 'simple');
		assert.equal(new AutoShadows().tier, 'simple');
	});
});
