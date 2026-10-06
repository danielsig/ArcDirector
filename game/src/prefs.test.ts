import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
	clampContextLength,
	coercePrefsPatch,
	nudgeContextLength,
	prefs,
	prefsDetached,
	reloadPrefs,
	setPrefs,
	watchPrefs,
} from './prefs.ts';

const store = new Map<string, string>();

const memory = {
	getItem(key:string):string | null {
		return store.get(key) ?? null;
	},
	setItem(key:string, value:string):void {
		store.set(key, value);
	},
	removeItem(key:string):void {
		store.delete(key);
	},
	clear():void {
		store.clear();
	},
	key():string | null {
		return null;
	},
	get length():number {
		return store.size;
	},
};

const KEY = 'arc-director.prefs.v1';

function stored():Record<string, unknown> {
	return JSON.parse(store.get(KEY) ?? '{}') as Record<string, unknown>;
}

beforeEach(() => {
	store.clear();
	Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true });
	reloadPrefs();
});

describe('setPrefs', () => {
	it('persist true writes storage', () => {
		setPrefs({ observer: false });
		assert.equal(stored().observer, false);
	});

	it('persist false detaches the page: later changes stay in memory too', () => {
		setPrefs({ model: 'probe' }, false);
		setPrefs({ observer: false });
		assert.equal(prefsDetached(), true);
		assert.equal(prefs().model, 'probe');
		assert.equal(prefs().observer, false);
		assert.equal(store.has(KEY), false);
	});

	it('reload clears the detached mode and the memory-only values', () => {
		setPrefs({ observer: false });
		setPrefs({ model: 'probe' }, false);
		reloadPrefs();
		assert.equal(prefsDetached(), false);
		assert.equal(prefs().model, '');
		assert.equal(prefs().observer, false);
	});

	it('keeps the current value for an unusable field and drops unknown keys', () => {
		setPrefs({ music: 0.4, maxParallel: 3 });
		const next = setPrefs(coercePrefsPatch({ music: 'loud', maxParallel: 99, bogus: 1 }));
		assert.equal(next.music, 0.4);
		assert.equal(next.maxParallel, 10);
		assert.equal('bogus' in stored(), false);
	});

	it('tells watchers what changed', () => {
		const seen:[boolean, boolean][] = [];
		const stop = watchPrefs((next, prev) => {
			seen.push([prev.observer, next.observer]);
		});
		setPrefs({ observer: false });
		stop();
		setPrefs({ observer: true });
		assert.deepEqual(seen, [[true, false]]);
	});

	it('snaps contextLength to a power-of-two step', () => {
		assert.equal(clampContextLength(7000), 8192);
		assert.equal(clampContextLength(10000), 8192);
		assert.equal(clampContextLength(12000), 8192);
		assert.equal(clampContextLength(14000), 16384);
		assert.equal(nudgeContextLength(8192, 1), 16384);
		assert.equal(nudgeContextLength(2048, -1), 2048);
		assert.equal(nudgeContextLength(131072, 1), 131072);
	});
});
