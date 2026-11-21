import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Recording, placeRecording } from './Recording.js';

/** A context that only starts buffer sources, recording each start's offset; its clock is set by hand. */
function fakeContext():{ currentTime:number; started:number[] } {
	const ctx = {
		currentTime: 0,
		started: [] as number[],
		createBufferSource: () => ({
			connect: () => undefined,
			disconnect: () => undefined,
			stop: () => undefined,
			start: (when:number, offset:number) => ctx.started.push(offset),
		}),
	};
	return ctx;
}

/** `song` given a decoded file `duration` seconds long. */
function attach(song:Recording, ctx:{ currentTime:number }, duration:number):void {
	song.attach(ctx as unknown as BaseAudioContext, {} as AudioNode, { duration } as AudioBuffer);
}

describe('Recording', () => {
	it('plays an intro once, then loops a later span', () => {
		const at = (position:number, expect:number):void => {
			assert.ok(Math.abs(placeRecording(position, 7.2, 115.8) - expect) < 1e-9);
		};
		at(0, 0);
		at(7.2, 7.2);
		at(115.8, 7.2);
		at(115.8 + 10, 17.2);
		at(50 + 70, 11.4);
		at(115.8 + (115.8 - 7.2), 7.2);
		assert.equal(placeRecording(10, 0, 100), 10);
		assert.equal(placeRecording(100, 0, 100), 0);
		assert.equal(placeRecording(250, 0, 100), 50);
	});

	it('wraps the playhead into its loop, which the file bounds', () => {
		const ctx = fakeContext();
		const song = new Recording('song', 1, { start: 10, end: 100 });
		assert.deepEqual(song.bounds, { start: 0, end: 0 });
		attach(song, ctx, 120);
		assert.deepEqual(song.bounds, { start: 10, end: 100 });
		ctx.currentTime = 130;
		assert.equal(song.sec(), 40);
		const long = new Recording('long', 1, { start: 10, end: 500 });
		attach(long, ctx, 120);
		assert.deepEqual(long.bounds, { start: 10, end: 120 });
		const backward = new Recording('backward', 1, { start: 50, end: 20 });
		attach(backward, ctx, 120);
		assert.deepEqual(backward.bounds, { start: 0, end: 120 });
	});

	it('holds its place paused, and seeks into the loop', () => {
		const ctx = fakeContext();
		const song = new Recording('song', 1, { start: 10, end: 100 });
		attach(song, ctx, 120);
		ctx.currentTime = 30;
		song.pause();
		assert.equal(song.paused, true);
		ctx.currentTime = 80;
		assert.equal(song.sec(), 30);
		song.seek(250);
		assert.equal(song.sec(), 50);
		assert.deepEqual(ctx.started, [0]);
		song.unpause();
		assert.deepEqual(ctx.started, [0, 50]);
		ctx.currentTime = 90;
		assert.equal(song.sec(), 60);
		song.seek(5);
		assert.deepEqual(ctx.started, [0, 50, 5]);
		assert.equal(song.sec(), 5);
	});
});
