import type { Score } from '@arc-director/kindling';
import { brass, flute, violin } from './hostInstruments';
import {
	air,
	bar,
	bass,
	bell,
	chord,
	diminuendo,
	drum,
	f,
	ff,
	mf,
	track,
	mp,
	p,
	piece,
	pp,
	slot,
	stack,
} from '@arc-director/kindling/score';

type Hair = typeof f | typeof ff | typeof mf | typeof mp;

type Punch = 'late' | 'hit' | 'now';

type Wall = {
	beats:number;
	chord:string;
	from:string;
	to:string;
	root:string[];
	punch:Punch;
	tune?:string;
	alto?:string;
	rush?:string;
	flute?:string;
	/** Tune-only mark. */
	melody?:typeof f | typeof ff | typeof mf;
	hair?:Hair;
	shell?:number[];
	brass?:number[];
	shellAt?:number;
	brassAt?:number;
	kit?:string | false;
	chime?:string;
	/** Tuba line. Default is late root or stacked roots. */
	bass?:string;
	/** Extra low octave (the oct track). */
	octaves?:string;
	/** Extra brass line (own track, not the chord horns). */
	call?:string;
};

function mainMenuSong():Score {
	const room = track(air, { gain: 0.1, cutoff: 150, dynamic: pp });
	const tuba = track(bass, { gain: 0.94, cutoff: 200, dynamic: mp });
	const oct = track(bass, { gain: 0.82, cutoff: 180, dynamic: p });
	const spark = track(violin, { gain: 0.52, dynamic: mp });
	const horns = track(brass, { gain: 0.4, dynamic: mp });
	const tune = track(violin, { gain: 0.86, dynamic: mf });
	const alto = track(violin, { gain: 0.7, dynamic: mf });
	const rush = track(violin, { gain: 0.32, dynamic: f });
	const wind = track(flute, { gain: 0.5, dynamic: mf });
	const shine = track(brass, { gain: 0.88, dynamic: f });
	const kit = track(drum, { gain: 0.58, dynamic: mp });
	const bellChime = track(bell, { gain: 0.26, dynamic: p });

	const hold = (pitches:number[], beats:number) => ({ _b: 1 as const, pitches, beats });
	const enter = (tones:{ pitches:number[] }, wait:number, total:number) => {
		const body = hold(tones.pitches, total - wait);
		return wait > 0 ? ([`r:${wait}`, body] as const) : ([body] as const);
	};
	const pulse = (beats:number) => {
		const cells:string[] = [];
		for (let i = 0; i < beats; i++) {
			cells.push(i % 2 === 0 ? 'e1:.16 r:.84' : 'e2:.12 r:.88');
		}
		return cells.join(' ');
	};
	const half = (beats:number) => {
		const cells:string[] = [];
		for (let i = 0; i < beats; i += 2) {
			cells.push('e1:.16 r:1.84');
		}
		return cells.join(' ');
	};

	const wall = (w:Wall) => {
		const { beats, punch } = w;
		const harm = chord(w.chord, beats).range(w.from, w.to);
		const shellN = w.shell ?? [0, 3];
		const brassN = w.brass ?? [1, 2];
		const shellAt = w.shellAt ?? (punch === 'late' && beats >= 6 ? 0.5 : 0);
		const brassAt = w.brassAt ?? (punch === 'late' ? 1.5 : punch === 'hit' ? (beats > 4 ? 2 : 0.5) : 1.5);
		const rootA = w.root[0] ?? 'b1';
		const rootB = w.root[1];
		const hair = w.hair ? [w.hair] as const : [];
		const kick = w.kit === false
			? undefined
			: w.kit ?? (punch === 'hit' ? `e1:.22 r:${beats - 0.22}` : punch === 'late' ? `r:1.5 e1:.2 r:${beats - 1.7}` : undefined);
		const low = w.bass
			? tuba(w.bass, ...hair)
			: punch === 'late'
				? tuba(`r:1.5 ${rootA}:${beats - 1.5}`, ...hair)
				: tuba(stack(w.root, beats), ...hair);
		const fifth = w.octaves
			? oct(w.octaves, ...hair)
			: punch === 'late' && rootB ? oct(`r:1.5 ${rootB}:${beats - 1.5}`) : oct(`r:${beats}`);
		return bar(
			beats,
			room(`${rootA}:${beats}`),
			low,
			fifth,
			spark(...enter(harm.include(...shellN), shellAt, beats), ...hair),
			horns(...enter(harm.include(...brassN), brassAt, beats), ...hair),
			...(w.tune ? [w.melody ? tune(w.tune, w.melody) : w.hair ? tune(w.tune, w.hair) : tune(w.tune)] : []),
			...(w.alto ? [alto(w.alto, ...hair)] : []),
			...(w.rush ? [rush(w.rush, ...hair)] : []),
			...(w.flute ? [wind(w.flute, ...hair)] : []),
			...(w.call ? [shine(w.call, f)] : []),
			...(kick ? [kit(kick, ...hair)] : []),
			...(w.chime ? [bellChime(w.chime)] : []),
		);
	};

	/** Climb harmonics: violin shell only, no tuba/brass/diminuendo (those retrigger like a hiccup). */
	const lift = (s:{
		chord:string;
		from:string;
		to:string;
		root:string;
		tune:string;
		alto:string;
		flute:string;
	}) => {
		const beats = 2;
		const harm = chord(s.chord, beats).range(s.from, s.to);
		return bar(
			beats,
			room(`${s.root}:${beats}`),
			spark(hold(harm.include(0, 3).pitches, beats)),
			tune(s.tune),
			alto(s.alto),
			wind(s.flute),
			kit(pulse(beats)),
		);
	};

	const beltB = (dyn:typeof f | typeof ff, chime?:string) => wall({
		beats: 4, chord: 'B', from: 'b3', to: 'b4', root: ['b1', 'b2'], punch: 'hit',
		melody: dyn, kit: pulse(4), bass: 'b1:1 b2:1 b1:1 b2:1',
		tune: 'r:.5 f#6:1.5 | d#6:1 b5:1',
		alto: 'r:.5 d#6:1.5 | b5:1 f#5:1',
		flute: 'r:.5 f#6:1.5 | d#6:1 b5:1',
		chime,
	});

	const hook = (s:{
		melody?:typeof f | typeof ff;
		tune:string;
		alto:string;
		flute:string;
		rush?:string;
		chime?:string;
		dTune:string;
		dAlto:string;
		eTune:string;
		eAlto:string;
	}) => [
		wall({
			beats: 4, chord: 'F#', from: 'f#3', to: 'f#4', root: ['f#1', 'c#2'], punch: 'hit',
			melody: s.melody ?? f, kit: pulse(4), bass: 'f#1:1 c#2:1 f#1:1 c#2:1',
			tune: s.tune, alto: s.alto, flute: s.flute, rush: s.rush, chime: s.chime,
		}),
		wall({
			beats: 2, chord: 'D', from: 'a3', to: 'a4',
			root: ['a2'], punch: 'now', shellAt: 0, brassAt: 0.5,
			melody: s.melody ?? f, kit: pulse(2),
			tune: s.dTune, alto: s.dAlto, flute: s.dTune,
		}),
		wall({
			beats: 2, chord: 'E', from: 'e3', to: 'e4', root: ['e2'], punch: 'now',
			shellAt: 0, brassAt: 0.5, melody: s.melody ?? f, kit: pulse(2),
			tune: s.eTune, alto: s.eAlto, flute: s.eTune,
		}),
	];

	const gate = slot();
	gate(
		beltB(f, 'f#6:1 r:3'),
		wall({
			beats: 8, chord: 'B', from: 'b3', to: 'b4', root: ['b1', 'b2'], punch: 'late',
			melody: mf, hair: mp, kit: half(8),
			tune: 'f#5:1 r:.5 b4:.5 | d#5:1 f#5:.5 d#5:.5 | b4:.5 r:.5 f#5:1 | d#5:1 b4:1',
			alto: 'd#5:1 r:.5 f#4:.5 | b4:1 d#5:.5 b4:.5 | f#4:.5 r:.5 d#5:1 | b4:1 f#4:1',
			flute: 'r:6 f#5:1 d#5:1',
		}),
		wall({
			beats: 8, chord: 'E-', from: 'e3', to: 'e4', root: ['e1', 'e2'], punch: 'late',
			kit: half(8),
			tune: 'g5:1 r:.5 e5:.5 | b4:1 e5:.5 g5:.5 | e5:.5 r:.5 b4:1 | g4:1 e4:1',
			alto: 'e5:1 r:.5 g4:.5 | e4:1 g4:.5 e4:.5 | b3:.5 r:.5 g4:1 | e4:1 b3:1',
			flute: 'r:6 b4:1 g4:1',
		}),
		wall({
			beats: 3, chord: 'G', from: 'g3', to: 'g4', root: ['g1', 'g2'], punch: 'now',
			shellAt: 0, brassAt: 0.5, kit: pulse(3), bass: 'g1:1 d2:1 g1:1',
			tune: 'b5:1.5 g5:.5 d5:1',
			alto: 'd5:1.5 b4:.5 g4:1',
			flute: 'b5:1.5 g5:.5 d5:1',
		}),
		wall({
			beats: 3, chord: 'G', from: 'g3', to: 'g4', root: ['g1', 'g2'], punch: 'now',
			shellAt: 0, brassAt: 0.5, kit: pulse(3), bass: 'g1:1 d2:1 g1:1',
			tune: 'd6:1.5 b5:.5 g5:1',
			alto: 'g5:1.5 d5:.5 b4:1',
			flute: 'd6:1.5 b5:.5 g5:1',
		}),
		wall({
			beats: 2, chord: 'G', from: 'g3', to: 'g4', root: ['g1', 'g2'], punch: 'now',
			shellAt: 0, brassAt: 0.5, kit: 'e1:.16 r:.34 e2:.12 r:.38 e1:.16 r:.34 e2:.12 r:.38',
			bass: 'g1:1 d2:1',
			tune: 'd6:1 b5:1',
			alto: 'g5:1 d5:1',
			flute: 'd6:1 b5:1',
		}),
		...hook({
			tune: 'r:.5 c#6:1.5 | a#5:1 f#5:1',
			alto: 'r:.5 a#5:1.5 | f#5:1 c#5:1',
			flute: 'r:.5 c#6:1.5 | a#5:1 f#5:1',
			dTune: 'a5:1 f#5:1',
			dAlto: 'f#5:1 d5:1',
			eTune: 'b5:1 g#5:1',
			eAlto: 'g#5:1 e5:1',
		}),
		...hook({
			melody: ff,
			tune: 'r:.5 f#6:1.5 | c#6:1 a#5:1',
			alto: 'r:.5 c#6:1.5 | a#5:1 f#5:1',
			flute: 'r:.5 f#6:1.5 | c#6:1 a#5:1',
			rush: '| f#6 a#6 | r:1 | c#6 f#6 | r:1',
			chime: 'f#6:1 r:3',
			dTune: 'a5:1 d6:1',
			dAlto: 'f#5:1 a5:1',
			eTune: 'b5:1 e6:1',
			eAlto: 'g#5:1 b5:1',
		}),
		wall({
			beats: 4, chord: 'F#-', from: 'f#3', to: 'f#4', root: ['f#1', 'f#2'], punch: 'late',
			melody: mp, kit: false,
			tune: 'c#5:1 r:.5 a4:.5 | f#5:1 c#5:1',
			alto: 'a4:1 r:.5 f#4:.5 | c#5:1 a4:1',
		}),
		wall({
			beats: 4, chord: 'F#-', from: 'f#3', to: 'f#4', root: ['f#1', 'f#2'], punch: 'now',
			shellAt: 0, brassAt: 0.5, kit: pulse(4), bass: 'f#1:1 c#2:1 f#1:1 c#2:1',
			tune: 'a4:.5 r:.5 f#4:1 | a4:1 f#4:1',
			alto: 'f#4:.5 r:.5 c#4:1 | f#4:1 c#4:1',
		}),
		wall({
			beats: 4, chord: 'A', from: 'a2', to: 'a5', root: ['a2'], punch: 'late',
			kit: pulse(4),
			tune: 'e5:1 c#5:1 | a5:.5 e5:.5 c#5:1',
			alto: 'c#5:1 a4:1 | e4:.5 c#5:.5 a4:1',
			flute: 'e5:1 c#5:1 | a5:.5 e5:.5 c#5:1',
		}),
		wall({
			beats: 4, chord: 'C#-', from: 'g#2', to: 'g#5', root: ['g#2'], punch: 'hit',
			melody: f, kit: pulse(4), bass: 'g#2:1 c#3:1 g#2:1 c#3:1',
			tune: 'r:.5 g#5:1.5 | e5:1 c#5:1',
			alto: 'r:.5 e5:1.5 | c#5:1 g#4:1',
			flute: 'r:.5 g#5:1.5 | e5:1 c#5:1',
		}),
		wall({
			beats: 2, chord: 'G#', from: 'g#3', to: 'g#4', root: ['g#1', 'd#2'], punch: 'now',
			shellAt: 0, brassAt: 0, melody: ff, kit: pulse(2), bass: 'g#1:1 d#2:1',
			tune: 'g#5:2',
			alto: 'd#5:2',
			flute: 'g#5:2',
			chime: 'g#5:1 r:1',
		}),
		wall({
			beats: 8, chord: 'G#', from: 'g#2', to: 'g#5', root: ['g#2'], punch: 'hit',
			melody: f, kit: pulse(8), bass: 'g#1:1 d#2:1 g#1:1 d#2:1 g#1:1 d#2:1 g#1:1 d#2:1',
			tune: 'r:.5 d#6:1.5 | g#5:1 c5:1 | r:.5 d#6:1.5 | c5:.5 g#5:1.5',
			alto: 'r:.5 c5:1.5 | d#4:1 g#4:1 | r:.5 c5:1.5 | g#4:.5 d#4:1.5',
			flute: 'r:.5 d#6:1.5 | g#5:1 c5:1 | r:.5 d#6:1.5 | c5:.5 g#5:1.5',
			rush: '| c5 d#6 | r:1 | g#5 c5 | r:1 | d#6 g#5 | r:1 | c6 d#6 | r:1',
		}),
	);

	const climb = slot();
	climb(
		lift({
			chord: 'B', from: 'b3', to: 'b4', root: 'b2',
			tune: 'b5:.5 f#5:.5 d#5:.5 b4:.5',
			alto: 'f#5:.5 d#5:.5 b4:.5 f#4:.5',
			flute: 'b5:.5 f#5:.5 d#5:.5 b4:.5',
		}),
		lift({
			chord: 'F#-', from: 'a3', to: 'a4', root: 'f#2',
			tune: 'a5:.5 f#5:.5 c#5:.5 a4:.5',
			alto: 'c#5:.5 a4:.5 f#4:.5 c#4:.5',
			flute: 'a5:.5 f#5:.5 c#5:.5 a4:.5',
		}),
		lift({
			chord: 'C#-', from: 'g#3', to: 'g#4', root: 'g#2',
			tune: 'g#5:.5 e5:.5 c#5:.5 g#4:.5',
			alto: 'e5:.5 c#5:.5 g#4:.5 e4:.5',
			flute: 'g#5:.5 e5:.5 c#5:.5 g#4:.5',
		}),
		lift({
			chord: 'C#-', from: 'e3', to: 'e4', root: 'e2',
			tune: 'e5:.5 c#5:.5 g#4:.5 e4:.5',
			alto: 'c#5:.5 g#4:.5 e4:.5 c#4:.5',
			flute: 'e5:.5 c#5:.5 g#4:.5 e4:.5',
		}),
		wall({
			beats: 4, chord: 'F#', from: 'c#3', to: 'c#5', brass: [4, 5],
			root: ['c#3'], punch: 'now', shellAt: 0, brassAt: 0.5, hair: ff,
			tune: 'r:.5 c#6:1.5 | a#5:1 f#5:1',
			alto: 'r:.5 a#5:1.5 | f#5:1 c#5:1',
			flute: 'r:.5 c#6:1.5 | a#5:1 f#5:1',
			rush: '| c#6 f#6 | r:1 | a#5 c#6 | r:1',
			kit: pulse(4),
			chime: 'c#6:1 r:3',
			bass: 'f#1:1 c#2:1 f#1:1 c#2:1',
		}),
		wall({
			beats: 2, chord: 'D', from: 'a3', to: 'a4',
			root: ['a2'], punch: 'now', shellAt: 0, brassAt: 0.5,
			tune: 'a5:1 f#5:1',
			alto: 'f#5:1 d5:1',
			flute: 'a5:1 f#5:1',
			kit: pulse(2),
		}),
		wall({
			beats: 2, chord: 'E', from: 'e3', to: 'e4', root: ['e2'], punch: 'now',
			shellAt: 0, brassAt: 0.5,
			tune: 'b5:1 g#5:1',
			alto: 'g#5:1 e5:1',
			flute: 'b5:1 g#5:1',
			kit: pulse(2),
		}),
		wall({
			beats: 1, chord: 'F#sus4', from: 'f#3', to: 'c#5', brass: [3, 4],
			root: ['c#3'], punch: 'now', shellAt: 0, brassAt: 0,
			tune: 'b5:1',
			alto: 'f#5:1',
			flute: 'b5:1',
			kit: pulse(1),
		}),
		wall({
			beats: 7, chord: 'F#', from: 'c#3', to: 'c#5', brass: [4, 5],
			root: ['c#3'], punch: 'now', shellAt: 0, brassAt: 0.5,
			tune: 'a#5:4 r:3',
			alto: 'f#5:4 r:3',
			call: 'r:2.5 c#5:.25 e#5:.25 f#5:4',
			kit: pulse(7),
			chime: 'r:3 f#6:1 r:3',
			bass: 'f#1:1 c#2:1 f#1:1 c#2:1 f#1:1 c#2:1 f#1:1',
		}),
		wall({
			beats: 3, chord: 'D', from: 'a3', to: 'a4',
			root: ['a2'], punch: 'now', shellAt: 0, brassAt: 0,
			kit: pulse(3), bass: 'a2:1 d2:1 a2:1',
			call: 'a5:3',
		}),
		wall({
			beats: 2, chord: 'E', from: 'e3', to: 'e4', root: ['e2'], punch: 'now',
			shellAt: 0, brassAt: 0,
			kit: pulse(2), bass: 'e2:1 b1:1',
			call: 'e5:2',
		}),
		wall({
			beats: 1, chord: 'B-', from: 'b2', to: 'b4', brass: [4, 5],
			root: ['b1'], punch: 'hit', shellAt: 0, brassAt: 0,
			kit: pulse(1), bass: 'b1:1',
			call: 'f#5:1',
		}),
	);

	const rest = slot();
	const boom = chord('D', 4).range('a3', 'f#5');
	rest(
		bar(
			4,
			room('e1:4'),
			tuba('e1:1', ff, 'e1:3', diminuendo(p)),
			oct('d1:1', ff, 'd1:3', diminuendo(p)),
			spark(hold(boom.include(0, 5).pitches, 1), ff, hold(boom.include(0, 5).pitches, 3), diminuendo(p)),
			horns(hold(boom.include(1).pitches, 1), ff, hold(boom.include(1).pitches, 3), diminuendo(p)),
			kit('e1:.5 r:.5', ff, pulse(3), diminuendo(p)),
		),
		wall({
			beats: 4, chord: 'A', from: 'c#3', to: 'c#5', brass: [1, 2],
			root: ['c#3'], punch: 'now', shellAt: 0.5, brassAt: 1.5,
			kit: pulse(4),
			tune: 'e5:1 c#5:1 | a5:1 e5:1',
			alto: 'c#5:1 a4:1 | e5:1 c#5:1',
		}),
		wall({
			beats: 4, chord: 'D', from: 'a2', to: 'a4', brass: [4, 5],
			root: ['a2'], punch: 'now', shellAt: 0.5, brassAt: 1,
			kit: pulse(4),
			tune: 'a5:1 f#5:1 | d6:1 a5:1',
			alto: 'f#5:1 d5:1 | a5:1 f#5:1',
			flute: 'a5:1 f#5:1 | d6:1 a5:1',
		}),
		wall({
			beats: 4, chord: 'E', from: 'e3', to: 'e4', root: ['e2'], punch: 'now',
			shellAt: 0.5, brassAt: 1, kit: pulse(4),
			tune: 'b5:1 g#5:1 | e6:1 b5:1',
			alto: 'g#5:1 e5:1 | b5:1 g#5:1',
			flute: 'b5:1 g#5:1 | e6:1 b5:1',
		}),
		wall({
			beats: 8, chord: 'B', from: 'b2', to: 'b4', brass: [4, 5],
			root: ['b2'], punch: 'now', shellAt: 0, brassAt: 1.5,
			kit: false,
			tune: 'f#4:1 r:.5 d#4:.5 | b3:1 f#4:1 | d#4:.5 r:.5 b3:1 | f#3:2',
			alto: 'd#4:1 r:.5 b3:.5 | f#3:1 d#4:1 | b3:.5 r:.5 f#3:1 | d#3:2',
		}),
		wall({
			beats: 4, chord: 'B', from: 'b2', to: 'f#4', brass: [3, 4],
			root: ['b1', 'b2'], punch: 'now', shell: [0, 1], brass: [2, 3],
			shellAt: 0, brassAt: 1, kit: false,
			tune: 'd#4:1 f#4:1 | b3:2',
			alto: 'b2:1 d#3:1 | f#3:2',
		}),
	);

	return piece({ bpm: 128, gain: 0.9, id: 'menu_orch' }, [
		gate(),
		climb(),
		rest(),
	]);
}

export const MENU_SONG_ORCH:Score = mainMenuSong();
