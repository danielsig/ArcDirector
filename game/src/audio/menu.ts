import { Audio } from '@arc-director/kindling';
import { prefs } from '../prefs';
import { preloadArt } from '../render/preloadArt';
import MENU_TRACK from './herosPath.mp3';

const MENU_VOL = 0.4;
const FADE_SEC = 5;

export type MenuAudioHandle = {
	stop:()=>void;
	setMuted:(muted:boolean)=>void;
	kick:()=>void;
	audio:Audio;
};

function waitFrame():Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => resolve());
	});
}

/** Scene-picker title theme. Own mixer; ignores the in-game music slider. */
export function startMenuAudio(target:HTMLElement):MenuAudioHandle {
	const audio = new Audio();
	audio.musicVolume = 0;
	audio.muted = prefs().menuMusicMuted;
	let begun = false;
	let dead = false;
	let arming:Promise<void> | null = null;
	let fadeStart = 0;
	const fadeTick = ():void => {
		if (!begun || audio.muted || fadeStart <= 0) {
			return;
		}
		const u = Math.min(1, (performance.now() - fadeStart) / 1000 / FADE_SEC);
		const eased = 1 - (1 - u) * (1 - u);
		audio.musicVolume = MENU_VOL * eased;
		if (u >= 1) {
			fadeStart = 0;
		}
	};
	const kick = ():void => {
		if (dead) {
			return;
		}
		if (begun) {
			void audio.resume();
			return;
		}
		if (arming) {
			return;
		}
		arming = (async () => {
			try {
				await preloadArt().catch(() => undefined);
				if (dead) {
					return;
				}
				await audio.resume();
				if (dead) {
					return;
				}
				await waitFrame();
				await waitFrame();
				if (dead || begun || audio.muted) {
					return;
				}
				audio.musicVolume = 0;
				await audio.playRecording(MENU_TRACK, 1, 'heros_path', { start: 7.6, end: 178.3 });
				if (dead) {
					return;
				}
				if (audio.muted) {
					audio.stopMusic();
					return;
				}
				begun = true;
				fadeStart = performance.now();
			}
			finally {
				if (!begun) {
					arming = null;
				}
			}
		})();
	};
	const opts = { passive: true } as const;
	target.addEventListener('pointerdown', kick, opts);
	target.addEventListener('keydown', kick, opts);
	target.addEventListener('touchstart', kick, opts);
	let raf = 0;
	const tick = ():void => {
		fadeTick();
		raf = requestAnimationFrame(tick);
	};
	raf = requestAnimationFrame(tick);
	if (!audio.muted) {
		kick();
	}
	return {
		stop: ():void => {
			dead = true;
			cancelAnimationFrame(raf);
			target.removeEventListener('pointerdown', kick);
			target.removeEventListener('keydown', kick);
			target.removeEventListener('touchstart', kick);
			audio.dispose();
		},
		setMuted: (muted:boolean):void => {
			audio.muted = muted;
			if (!muted) {
				if (begun) {
					audio.musicVolume = MENU_VOL;
					fadeStart = 0;
				}
				void kick();
			}
		},
		kick,
		audio,
	};
}

