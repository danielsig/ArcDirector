<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import type { Audio } from '@arc-director/kindling';
import { prefs, setPrefs } from '../prefs';

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

const TITLES:Record<string, string> = {
	pretty_harm: 'Harmonics',
	menu_orch: 'Menu',
	heros_path: "Hero's Path",
	menu: 'Hymn',
	abbey_vault: 'Dungeon Vault',
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
	if (next && document.pointerLockElement) {
		document.exitPointerLock();
	}
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
	const tick = ():void => {
		snap();
		raf = requestAnimationFrame(tick);
	};
	raf = requestAnimationFrame(tick);
	window.addEventListener('keydown', onKey);
});

onUnmounted(() => {
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
.music-player {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	z-index: 20;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px 10px;
	pointer-events: auto;
	background: rgba(12, 10, 8, 0.86);
	box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.4);
	color: #f0e6c8;
	font-family: ui-monospace, "Cascadia Code", monospace;
}
.icon {
	flex: none;
	width: 32px;
	height: 32px;
	padding: 0;
	border: 0;
	background: transparent;
	color: inherit;
	font: inherit;
	font-size: 14px;
	cursor: pointer;
	opacity: 0.88;
}
.icon:hover {
	opacity: 1;
}
.play {
	width: 36px;
	font-size: 16px;
}
.close {
	opacity: 0.55;
}
.meta {
	flex: 0 0 auto;
	min-width: 140px;
}
.title {
	font-size: 13px;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: #d4c4a0;
}
.clock {
	font-size: 11px;
	opacity: 0.85;
}
.dim {
	opacity: 0.55;
}
.seek {
	flex: 1 1 auto;
	min-width: 80px;
	height: 6px;
	margin: 0 4px;
	accent-color: #d4c4a0;
	cursor: pointer;
}
.hint {
	flex: none;
	font-size: 11px;
	letter-spacing: 0.08em;
	opacity: 0.45;
}
</style>
