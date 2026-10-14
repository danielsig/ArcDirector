<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import type { Audio } from '@arc-director/kindling';
import { prefs, setPrefs, watchPrefs } from '../prefs';

const props = defineProps<{
	audio:Audio | null;
	kick?:()=>void;
	blocked?:boolean;
}>();

const open = ref(prefs().musicPlayerOpen);
const beat = ref(0);
const loop = ref(0);
const bpm = ref(0);
const paused = ref(true);
const title = ref('—');
const dragging = ref(false);
let raf = 0;
let stopPrefs:(()=>void) | null = null;

const TITLES:Record<string, string> = {
	pretty_harm: 'Harmonics',
	menu_orch: 'Menu',
	heros_path: "Hero's Path",
	menu: 'Hymn',
	dungeon_vault: 'Dungeon Crawl',
	glen: 'River Glen',
	marketplace: 'Marketplace',
	heros_tale: "Hero's Tale",
	ruins: '5v5 Combat',
	heros_might: "Hero's Might",
};

function isTyping(target:EventTarget | null):boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
		return true;
	}
	if (target.isContentEditable) {
		return true;
	}
	return target.closest('input, textarea, [contenteditable="true"]') !== null;
}

function snap():void {
	const a = props.audio;
	const music = a?.music ?? null;
	if (!dragging.value) {
		beat.value = a?.musicBeat() ?? 0;
	}
	loop.value = music?.loop ?? 0;
	bpm.value = music?.bpm ?? 0;
	title.value = music?.id ? (TITLES[music.id] ?? music.id) : '—';
	paused.value = !music || !!a?.musicPaused;
}

function setOpen(next:boolean):void {
	open.value = next;
	setPrefs({ musicPlayerOpen: next });
}

function toggleOpen():void {
	setOpen(!open.value);
}

async function togglePlay():Promise<void> {
	const a = props.audio;
	const first = !a?.music;
	props.kick?.();
	if (!a) {
		return;
	}
	await a.resume();
	if (first || !a.music) {
		return;
	}
	if (a.musicPaused) {
		a.unpauseMusic();
	}
	else {
		a.pauseMusic();
	}
}

function restart():void {
	props.kick?.();
	props.audio?.seekMusic(0);
}

function skip(delta:number):void {
	const a = props.audio;
	if (!a?.music) {
		props.kick?.();
		return;
	}
	a.seekMusic(a.musicBeat() + delta);
}

function onSeek(ev:Event):void {
	const a = props.audio;
	if (!a?.music) {
		return;
	}
	const value = Number((ev.target as HTMLInputElement).value);
	if (!Number.isFinite(value)) {
		return;
	}
	beat.value = value;
	a.seekMusic(value);
}

function fmtBeat(n:number):string {
	if (!(n > 0) && n !== 0) {
		return '0.0';
	}
	return n.toFixed(1);
}

function fmtTime(beats:number, tempo:number):string {
	if (!(tempo > 0)) {
		return '0:00';
	}
	const sec = Math.max(0, beats * 60 / tempo);
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return `${m}:${s.toString().padStart(2, '0')}`;
}

function onKey(ev:KeyboardEvent):void {
	if (ev.repeat || ev.altKey || ev.ctrlKey || ev.metaKey) {
		return;
	}
	if (props.blocked || isTyping(ev.target)) {
		return;
	}
	if (ev.code === 'KeyP') {
		ev.preventDefault();
		toggleOpen();
		return;
	}
	if (!open.value) {
		return;
	}
	if (ev.code === 'Space') {
		ev.preventDefault();
		void togglePlay();
	}
}

watch(open, (next) => {
	if (next && document.pointerLockElement) {
		document.exitPointerLock();
	}
});

onMounted(() => {
	stopPrefs = watchPrefs((p) => {
		open.value = p.musicPlayerOpen;
	});
	const tick = ():void => {
		snap();
		raf = requestAnimationFrame(tick);
	};
	raf = requestAnimationFrame(tick);
	window.addEventListener('keydown', onKey);
});

onUnmounted(() => {
	stopPrefs?.();
	cancelAnimationFrame(raf);
	window.removeEventListener('keydown', onKey);
});
</script>

<template>
	<section
		v-if="open"
		class="music-player"
		aria-label="Song"
	>
		<button type="button" class="icon" title="Restart" @click="restart">⏮</button>
		<button type="button" class="icon" title="Back 4 beats" @click="skip(-4)">⏪</button>
		<button
			type="button"
			class="icon play"
			:title="paused ? 'Play' : 'Pause'"
			:aria-label="paused ? 'Play' : 'Pause'"
			@click="togglePlay"
		>
			{{ paused ? '▶' : '❚❚' }}
		</button>
		<button type="button" class="icon" title="Ahead 4 beats" @click="skip(4)">⏩</button>
		<div class="meta">
			<div class="title">{{ title }}</div>
			<div class="clock">
				{{ fmtTime(beat, bpm) }}
				<span class="dim"> / {{ fmtTime(loop, bpm) }}</span>
				<span class="dim"> · {{ fmtBeat(beat) }} / {{ fmtBeat(loop) }}</span>
			</div>
		</div>
		<input
			class="seek"
			type="range"
			min="0"
			:max="loop || 1"
			step="0.01"
			:value="beat"
			:disabled="!loop"
			@pointerdown="dragging = true"
			@pointerup="dragging = false"
			@pointercancel="dragging = false"
			@input="onSeek"
		>
		<span class="hint">P</span>
		<button type="button" class="icon close" title="Hide player" @click="setOpen(false)">✕</button>
	</section>
</template>

<style scoped>
/* The song player: a parchment strip up from the bottom edge, round outlined buttons, the pause menu's slider. */
.music-player {
	position: absolute;
	left: 14px;
	right: 14px;
	bottom: 0;
	z-index: 20;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 14px 12px;
	pointer-events: auto;
	color: var(--ink);
	font-family: var(--font);
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-bottom: 0;
	border-radius: var(--radius) var(--radius) 0 0;
	box-shadow: var(--shadow-panel);
}

.icon {
	flex: none;
	width: 36px;
	height: 36px;
	padding: 0;
	display: grid;
	place-items: center;
	color: var(--ink);
	font: inherit;
	font-size: 14px;
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: 50%;
	box-shadow: var(--shadow);
	cursor: pointer;
	transition: transform var(--quick) var(--ease-out);
}

.icon:hover {
	background: var(--parchment-deep);
}

.icon:active {
	transform: translateY(2px);
	box-shadow: none;
}

/* Play stands out: bigger, and gold. */
.play {
	width: 44px;
	height: 44px;
	font-size: 16px;
	background: var(--gold);
}

.play:hover {
	background: var(--gold);
	filter: brightness(1.05);
}

.close {
	margin-left: 4px;
	border-color: transparent;
	box-shadow: none;
	background: none;
	opacity: 0.6;
}

.meta {
	flex: 0 0 auto;
	min-width: 150px;
	margin-left: 6px;
}

.title {
	font-size: 16px;
	font-weight: 700;
}

.clock {
	font-size: 12px;
	font-variant-numeric: tabular-nums;
	opacity: 0.85;
}

.dim {
	opacity: 0.6;
}

/* Slider: a thin ink track, a gold thumb outlined in ink. */
.seek {
	flex: 1 1 auto;
	min-width: 80px;
	height: 6px;
	margin: 0 6px;
	padding: 0;
	cursor: pointer;
	background: var(--ink);
	border-radius: 3px;
	-webkit-appearance: none;
	appearance: none;
}

.seek::-webkit-slider-thumb {
	-webkit-appearance: none;
	width: 16px;
	height: 26px;
	background: var(--gold);
	border: var(--line-thin) solid var(--ink);
	border-radius: 6px;
	cursor: pointer;
}

.seek::-moz-range-thumb {
	width: 12px;
	height: 22px;
	background: var(--gold);
	border: var(--line-thin) solid var(--ink);
	border-radius: 6px;
	cursor: pointer;
}

.seek:disabled {
	opacity: 0.4;
	cursor: default;
}

.hint {
	flex: none;
	font-size: 12px;
	font-weight: 700;
	opacity: 0.5;
}

button:focus-visible,
.seek:focus-visible {
	outline: var(--line-thin) solid var(--gold-deep);
	outline-offset: 2px;
}
</style>
