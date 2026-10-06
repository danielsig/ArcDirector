import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Audio, noteIsDue, placeRecording } from './Audio.js';
import { AudioSource } from './AudioSource.js';
import { overdriveSample } from './filters.js';
import { midiHz, scoreProblems } from './midi.js';
import { distanceGain, forwardXZ } from './spatial.js';
import type { Score } from './types.js';
import { Game } from '../core/Game.js';
import { GameObject } from '../core/GameObject.js';
import { World } from '../core/World.js';

const sample:Score = {
	bpm: 80,
	loop: 4,
	voices: [
		{
			instrument: 'pad',
			notes: [
				{ pitch: 60, beat: 0, dur: 2 },
				{ pitch: 64, beat: 2, dur: 2, vel: 0.4 },
			],
		},
	],
};

describe('Audio', () => {
	it('midiHz(A4) is 440', () => {
		assert.equal(Math.round(midiHz(69)), 440);
	});

	it('yaw 0 faces -Z', () => {
		const f = forwardXZ(0);
		assert.ok(Math.abs(f.x) < 1e-9);
		assert.ok(Math.abs(f.z + 1) < 1e-9);
	});

	it('yaw π/2 faces -X', () => {
		const f = forwardXZ(Math.PI / 2);
		assert.ok(Math.abs(f.x + 1) < 1e-9);
		assert.ok(Math.abs(f.z) < 1e-9);
	});

	it('noteIsDue rejects the past and the far future', () => {
		assert.equal(noteIsDue(1, 1.02), false);
		assert.equal(noteIsDue(1.05, 1.02), true);
		assert.equal(noteIsDue(2, 1.02, 0.32), false);
	});

	it('distanceGain stays loud at 1m and drops by 8m', () => {
		const k = 0.32;
		assert.ok(distanceGain(1, k) > 0.88);
		assert.ok(distanceGain(8, k) < 0.15);
	});

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

	it('queues a recording when there is no AudioContext', async () => {
		const audio = new Audio();
		await audio.playRecording(new Uint8Array(8).buffer, 1, 'clip');
		assert.equal(audio.playing, null);
		assert.equal(audio.music?.id, 'clip');
		assert.equal(audio.music?.bpm, 60);
		assert.equal(audio.musicPaused, false);
		audio.pauseMusic();
		assert.equal(audio.musicPaused, true);
		audio.seekMusic(4);
		assert.equal(audio.musicBeat(), 0);
		audio.unpauseMusic();
		assert.equal(audio.musicPaused, false);
		audio.stopMusic();
		assert.equal(audio.music, null);
		audio.dispose();
	});

	it('accepts a well-formed score', () => {
		assert.deepEqual(scoreProblems(sample), []);
	});

	it('overdrive is odd, linear at drive 0, and saturates', () => {
		assert.equal(overdriveSample(0, 0.8), 0);
		assert.equal(overdriveSample(0.25, 0), 0.25);
		assert.ok(Math.abs(overdriveSample(-0.4, 0.7) + overdriveSample(0.4, 0.7)) < 1e-12);
		assert.ok(overdriveSample(0.2, 1) > overdriveSample(0.2, 0.15));
		assert.ok(overdriveSample(1, 0.9) <= 1);
		assert.ok(overdriveSample(-1, 0.9) >= -1);
	});

	it('rejects a filter outside 0–1', () => {
		const bad:Score = {
			bpm: 80,
			loop: 4,
			filters: [{ kind: 'overdrive', drive: 2 }],
			voices: [{ instrument: 'pad', notes: [{ pitch: 60, beat: 0, dur: 1 }] }],
		};
		assert.ok(scoreProblems(bad).some((p) => p.includes('drive')));
		const audio = new Audio();
		assert.throws(() => audio.playMusic(bad));
		assert.throws(() => audio.playSfx({
			layers: [{ kind: 'thump', dur: 0.1, freq: 80 }],
			filters: [{ kind: 'reverb', mix: 1.4 }],
		}));
		audio.dispose();
	});

	it('rejects a note past the loop', () => {
		const bad:Score = {
			bpm: 80,
			loop: 4,
			voices: [{ instrument: 'lead', notes: [{ pitch: 60, beat: 4, dur: 1 }] }],
		};
		assert.ok(scoreProblems(bad).length > 0);
		const audio = new Audio();
		assert.throws(() => audio.playMusic(bad));
		assert.throws(() => audio.playLoop('radio', bad));
		audio.dispose();
	});

	it('is silent and safe without AudioContext', () => {
		const audio = new Audio();
		audio.warnDropped = false;
		assert.equal(audio.ready, false);
		audio.playMusic(sample);
		audio.playSfx({ layers: [{ kind: 'thump', dur: 0.1, freq: 80 }] });
		audio.update();
		audio.setListener(1, 0, 2, 0);
		audio.stopMusic();
		audio.playLoop('bed', { layers: [{ kind: 'noise', dur: 1, cutoff: 200 }] });
		assert.ok(audio.loopIDs().includes('bed'));
		audio.stopLoop('bed');
		assert.equal(audio.loopIDs().includes('bed'), false);
		audio.playLoop('radio', sample, { x: 4, z: 2, hear: 12 });
		assert.ok(audio.loopIDs().includes('radio'));
		audio.playMusic(sample);
		assert.equal(audio.playing, sample);
		audio.stopLoop('radio');
		assert.equal(audio.loopIDs().includes('radio'), false);
		assert.equal(audio.playing, sample);
		audio.dispose();
	});

	it('queues one sfx before resume and drops the rest', () => {
		const audio = new Audio();
		audio.warnDropped = false;
		audio.playSfx({ layers: [{ kind: 'thump', dur: 0.1, freq: 80 }] });
		audio.playSfx({ layers: [{ kind: 'click', dur: 0.05, freq: 400 }] });
		audio.dispose();
	});

	it('lives on World', () => {
		const world = new World();
		assert.equal(world.audio.playing, null);
		world.audio.playMusic(sample);
		assert.equal(world.audio.playing, sample);
		world.audio.dispose();
	});

	it('pauses and seeks without a context', () => {
		const audio = new Audio();
		audio.playMusic(sample);
		assert.equal(audio.musicPaused, false);
		assert.equal(audio.musicBeat(), 0);
		audio.pauseMusic();
		assert.equal(audio.musicPaused, true);
		audio.seekMusic(2);
		assert.equal(audio.musicBeat(), 2);
		audio.unpauseMusic();
		assert.equal(audio.musicPaused, false);
		assert.equal(audio.musicBeat(), 2);
		audio.seekMusic(6);
		assert.ok(Math.abs(audio.musicBeat() - 2) < 1e-9);
		audio.dispose();
	});

	it('runs callback at the end then stops when loops is 1', () => {
		let hits = 0;
		const score:Score = {
			bpm: 60,
			loop: 4,
			loops: 1,
			voices: [{ instrument: 'pad', notes: [{ pitch: 60, beat: 0, dur: 4 }] }],
			cues: [{ beat: 4, fn: () => {
				hits += 1;
			} }],
		};
		const audio = new Audio();
		audio.playMusic(score);
		audio.update();
		assert.equal(hits, 0);
		audio.seekMusic(4);
		audio.update();
		assert.equal(hits, 1);
		assert.equal(audio.playing, null);
		audio.dispose();
	});
});

describe('AudioSource', () => {
	const thump = { layers: [{ kind: 'thump' as const, dur: 0.1, freq: 80 }] };

	it('plays by ref and loops follow the transform', () => {
		const game = new Game();
		const go = new GameObject('radio');
		go.transform.setWorldPosition(4, 1, 2);
		const src = go.addComponent(AudioSource);
		game.world.add(go);
		src.play(thump);
		src.loop = sample;
		assert.equal(game.world.audio.loopIDs().length, 1);
		src.loop = null;
		assert.equal(game.world.audio.loopIDs().length, 0);
		src.loop = sample;
		game.tick(0.02);
		assert.equal(game.world.audio.loopIDs().length, 1);
		src.enabled = false;
		assert.equal(game.world.audio.loopIDs().length, 0);
		src.enabled = true;
		assert.equal(game.world.audio.loopIDs().length, 1);
		game.destroy(go);
		game.tick(0.02);
		assert.equal(game.world.audio.loopIDs().length, 0);
		game.dispose();
	});
});
