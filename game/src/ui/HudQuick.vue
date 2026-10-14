<script setup lang="ts">
import { computed, inject } from 'vue';
import type { HudModel } from './hudModel';
import { sessionKey } from './sessionKey';
import { setPrefs } from '../prefs';

const props = defineProps<{
	hud:HudModel;
}>();

const emit = defineEmits<{
	scenes: [];
}>();

const session = inject(sessionKey);

/** What the sound button shows: everything on, music muted, or everything muted. */
const sound = computed(() => (props.hud.audioMuted ? 'muted' : props.hud.musicMuted ? 'music-muted' : 'on'));

const SOUND_LABEL = {
	'on': 'Sound on (click to mute music)',
	'music-muted': 'Music muted (click to mute all)',
	'muted': 'All muted (click to unmute)',
} as const;

/** On, then music muted, then all muted, then on again. */
function cycleSound():void {
	if (sound.value === 'on') {
		setPrefs({ musicMuted: true });
	}
	else if (sound.value === 'music-muted') {
		setPrefs({ muted: true });
	}
	else {
		// Music at zero would leave "on" silent.
		setPrefs({ muted: false, musicMuted: false, ...(props.hud.musicVolume > 0 ? {} : { music: 0.5 }) });
	}
}
</script>

<template>
	<div class="quick-root">
		<button
			type="button"
			class="quick-btn back"
			:class="{ away: hud.menuOpen }"
			aria-label="Main menu"
			title="Main menu"
			@click.stop="emit('scenes')"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path fill="currentColor" d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z" />
			</svg>
		</button>
		<button
			type="button"
			class="quick-btn back restart"
			:class="{ away: hud.menuOpen }"
			aria-label="Restart scene"
			title="Restart scene"
			@click.stop="session?.restart()"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path
					fill="currentColor"
					d="M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"
				/>
			</svg>
		</button>
		<button
			type="button"
			class="quick-btn sound"
			:class="{ away: hud.menuOpen }"
			:aria-label="SOUND_LABEL[sound]"
			:title="SOUND_LABEL[sound]"
			@click.stop="cycleSound"
		>
			<svg v-if="sound === 'on'" viewBox="0 0 24 24" aria-hidden="true">
				<path
					fill="currentColor"
					d="M4 9v6h4l5 4V5L8 9H4zm11.5 3c0-1.8-1-3.3-2.5-4.1v8.2c1.5-.8 2.5-2.3 2.5-4.1zM14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.5 7-8.8S18 4.1 14 3.2z"
				/>
			</svg>
			<svg v-else-if="sound === 'music-muted'" viewBox="0 0 24 24" aria-hidden="true">
				<path fill="currentColor" d="M12 3v10.6A4 4 0 1 0 14 17V7h4V3h-6z" />
				<path d="M4 4l16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
			</svg>
			<svg v-else viewBox="0 0 24 24" aria-hidden="true">
				<path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z" />
				<path d="M16 9l5 6m0-6l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
			</svg>
		</button>
	</div>
</template>

<style scoped>
.quick-root {
	--cream: #f0e6c8;
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.quick-btn {
	position: absolute;
	top: 14px;
	/* Sound sits left of ?; the back button overrides this. */
	right: 282px;
	width: var(--btn);
	height: var(--btn);
	padding: 0;
	pointer-events: auto;
	z-index: 3;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--ink);
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-radius: 50%;
	box-shadow: var(--shadow);
	cursor: pointer;
}

.back {
	top: 10px;
	left: 10px;
	right: auto;
	width: 40px;
	height: 40px;
}

.restart {
	left: 58px;
}

.quick-btn svg {
	width: 26px;
	height: 26px;
	display: block;
}

.quick-btn:focus {
	outline: none;
}

.quick-btn:focus-visible {
	outline: 2px solid var(--ink);
	outline-offset: 2px;
}

.quick-btn:hover {
	background: var(--cream);
}

.quick-btn.away {
	visibility: hidden;
}
</style>
