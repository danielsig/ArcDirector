import type { Score } from '@arc-director/kindling';
import { flute } from './hostInstruments';
import { arpeggio, bar, changes, chord, piece, root, track, type Changes } from '@arc-director/kindling/score';
import { air, bass, bell, drum, lead, pad, pluck } from '@arc-director/kindling/score';
import { f, mf, mp, p } from '@arc-director/kindling/score';

export { MENU_SONG_ORCH } from './mainMenuSong';

const gro = 'c2:.12 r:.88 f#2:.12 r:.38 b2:.08 r:.42';
const gro8 = `${gro} ${gro} ${gro} ${gro}`;

function abbey():Score {
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
	return piece({ bpm: 68, gain: 0.92, id: 'abbey_vault' }, [
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

function glenTheme(id:string):Score {
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
	return piece({ bpm: 92, gain: 0.88, id }, [
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

function glen():Score {
	return glenTheme('glen');
}

function ruins():Score {
	return glenTheme('ruins');
}

function market():Score {
	const lute = track(pluck, { gain: 0.7, dynamic: mp });
	const melody = track(lead, { gain: 0.78, dynamic: mf });
	const low = track(bass, { gain: 0.95, cutoff: 280, dynamic: f, transpose: -12 });
	const kit = track(drum, { gain: 0.7, dynamic: mp });
	const bed = track(pad, { gain: 0.4, cutoff: 1600, dynamic: p });
	const row = (ch:Changes, mel:string) => bar(
		8,
		bed(chord(ch)),
		lute(arpeggio(ch)),
		low(root(ch)),
		melody(mel),
		kit(gro8),
	);
	return piece({ bpm: 118, gain: 0.86, id: 'marketplace' }, [
		row(changes(['D-', 4], ['C', 4]), 'd5:.5 f5:.5 g5:.5 a5:.5 | g5:1 f5:.5 d5:.5 | c5:.5 d5:.5 f5:1 | a5:1 g5:1'),
		row(changes(['Bb2', 4], ['A-2', 4]), 'f5:.5 d5:.5 c5:1 | d5:2 | r:1 a4:1 | d5:2'),
		row(changes(['D-', 4], ['F', 4]), 'a5:1 g5:.5 f5:.5 | e5:1 d5:1 | c5:.5 d5:.5 f5:1 | g5:2'),
		row(changes(['G2', 4], ['D-', 4]), 'a5:.5 g5:.5 f5:.5 e5:.5 | d5:1 c5:1 | d5:2 | r:2'),
		row(changes(['D-', 4], ['C', 4]), 'd5:1 f5:1 | g5:.5 a5:.5 g5:1 | f5:1 d5:1 | a4:2'),
		row(changes(['Bb2', 2], ['A', 2], ['D-', 4]), 'bb4:1 d5:1 | c5:1 e5:1 | d5:3 r:1'),
	]);
}

export const SONGS:Record<string, Score> = {
	abbey_vault: abbey(),
	glen: glen(),
	marketplace: market(),
	ruins: ruins(),
};

export function songForScene(sceneID:string):Score {
	return SONGS[sceneID] ?? SONGS.abbey_vault!;
}
