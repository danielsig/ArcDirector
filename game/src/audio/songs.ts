import type { Audio, Score } from '@arc-director/kindling';
import { flute } from './hostInstruments';
import MIGHT_TRACK from './herosMight.mp3';
import TALE_TRACK from './herosTale.mp3';
import { arpeggio, bar, chord, piece, root, track } from '@arc-director/kindling/score';
import { air, bass, bell, lead, pad, pluck } from '@arc-director/kindling/score';
import { mf, mp, p } from '@arc-director/kindling/score';

export { MENU_SONG_ORCH } from './mainMenuSong';

function dungeonTheme():Score {
	const bed = track(pad, { gain: 0.95, cutoff: 640, dynamic: mf });
	const harp = track(pluck, { gain: 0.55, dynamic: p });
	const low = track(bass, { gain: 0.9, cutoff: 210, dynamic: mf, transpose: -12 });
	const melody = track(lead, { gain: 0.72, dynamic: mf });
	const bells = track(bell, { gain: 0.55, dynamic: p });
	const room = track(air, { gain: 0.55, cutoff: 180, dynamic: mp });
	const row = (ch:string, mel:string, ding?:string) => bar(
		8,
		room('d2:8'),
		bed(chord(ch)),
		harp(arpeggio(ch)),
		low(root(ch)),
		melody(mel),
		...(ding ? [bells(ding)] : []),
	);
	return piece({ bpm: 68, gain: 0.92, id: 'dungeon_vault' }, [
		row('D-', 'd4:3 e4:1 | f4:2 a4:2', 'a5:4'),
		row('C', 'g4:3 e4:1 | f4:2 e4:1 d4:1'),
		row('Bbmaj72', 'a4:2 g4:1 f4:1 | e4:4'),
		row('A-2', 'd4:1 f4:1 a4:2 | g4:2 r:2'),
		row('D-', 'd5:2 a4:2 | g4:3 f4:1', 'd5:3.5'),
		row('F', 'e4:2 d4:2 | a3:4'),
		row('C', 'f4:2 e4:1 d4:1 | c4:2 d4:2'),
		row('G2', 'e4:3 d4:1 | d4:4', 'f5:4'),
	]);
}

function glenTheme():Score {
	const bed = track(pad, { gain: 0.7, cutoff: 1100, dynamic: mf });
	const guitar = track(pluck, { gain: 0.62, dynamic: mp });
	const low = track(bass, { gain: 0.85, cutoff: 240, dynamic: mf, transpose: -12 });
	const wind = track(flute, { gain: 0.85, dynamic: mf });
	const airBed = track(air, { gain: 0.7, cutoff: 920, dynamic: p });
	const sparkle = track(bell, { gain: 0.28, dynamic: p });
	const row = (ch:string, mel:string, ding?:string) => bar(
		8,
		airBed('g5:8'),
		bed(chord(ch)),
		guitar(arpeggio(ch)),
		low(root(ch)),
		wind(mel),
		...(ding ? [sparkle(ding)] : []),
	);
	return piece({ bpm: 92, gain: 0.88, id: 'glen' }, [
		row('G2', 'b4:1 d5:1 g4:2 | a4:2 e4:2'),
		row('E-2', 'd4:1 g4:1 a4:2 | b4:4', 'd6:1.6'),
		row('C', 'd5:2 b4:1 a4:1 | g4:2 e4:2'),
		row('D', 'd4:2 g4:1 a4:1 | b4:3 r:1', 'g5:1.4'),
		row('G2', 'g4:2 b4:2 | a4:2 d5:2'),
		row('B-2', 'e5:1 d5:1 b4:2 | a4:4', 'e6:1.8'),
		row('C', 'b4:1 a4:1 g4:2 | e4:2 d4:2'),
		row('Dsus4', 'g4:3 d4:1 | g4:4', 'd6:2'),
	]);
}

export const SONGS:Record<string, Score> = {
	dungeon_vault: dungeonTheme(),
	glen: glenTheme(),
};

/** 5v5 Combat plays the Hero's Might recording. Other scenes play a score. */
export function startSceneMusic(audio:Audio, sceneID:string):void {
	if (sceneID === 'ruins') {
		void audio.playRecording(MIGHT_TRACK, 1, 'heros_might', { start: 7.35, end: 115.8 });
		return;
	}
	if (sceneID === 'marketplace') {
		void audio.playRecording(TALE_TRACK, 1, 'heros_tale', { start: 24.6, end: 168 });
		return;
	}
	void audio.playMusic(SONGS[sceneID] ?? SONGS.dungeon_vault);
}
