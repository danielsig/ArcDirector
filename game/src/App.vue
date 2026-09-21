<script setup lang="ts">
import { computed, reactive, ref, shallowRef, provide, watch, onUnmounted } from 'vue';
import type { Audio } from '@arc-director/kindling';
import KindlingView from './ui/KindlingView.vue';
import HudPickup from './ui/HudPickup.vue';
import HudLayer from './ui/HudLayer.vue';
import CursorLayer from './ui/CursorLayer.vue';
import MusicPlayer from './ui/MusicPlayer.vue';
import { emptyHud } from './ui/hudModel';
import { sessionKey } from './ui/sessionKey';
import type { Session } from './engine/Session';
import { SCENES } from './data/scenes';
import { clearURLView } from './engine/urlView';
import { preloadArt } from './render/preloadArt';
import { startMenuAudio, type MenuAudioHandle } from './audio/menu';
import { prefs, setMenuMusicMuted } from './prefs';

preloadArt();

const params = new URLSearchParams(window.location.search);
const fromURL = params.get('scene');
const hud = reactive(emptyHud());
const session = shallowRef<Session | null>(null);
provide(sessionKey, session);
const sceneID = ref<string | null>(
	fromURL && SCENES[fromURL] ? fromURL : null,
);
const picker = ref<HTMLElement | null>(null);
const menuMusicMuted = ref(prefs().menuMusicMuted);
const menuHandle = shallowRef<MenuAudioHandle | null>(null);

watch(picker, (el) => {
	menuHandle.value?.stop();
	menuHandle.value = el ? startMenuAudio(el) : null;
	if (el) {
		menuMusicMuted.value = prefs().menuMusicMuted;
	}
});
onUnmounted(() => {
	menuHandle.value?.stop();
	menuHandle.value = null;
});

const liveAudio = computed(():Audio | null => {
	if (!sceneID.value) {
		return menuHandle.value?.audio ?? null;
	}
	return session.value?.gameObject.world?.audio ?? null;
});

function kickLive():void {
	if (!sceneID.value) {
		menuHandle.value?.kick();
		return;
	}
	void session.value?.gameObject.world?.audio.resume();
}

function onMenuMusicCheck(ev:Event):void {
	const on = (ev.target as HTMLInputElement).checked;
	const next = setMenuMusicMuted(!on);
	menuMusicMuted.value = next.menuMusicMuted;
	hud.musicVolume = next.music;
	menuHandle.value?.setMuted(next.menuMusicMuted);
}

function pick(id:string):void {
	sceneID.value = id;
	const url = new URL(window.location.href);
	url.searchParams.set('scene', id);
	window.history.replaceState({}, '', url);
}

function leave():void {
	hud.menuOpen = false;
	hud.menuNotice = '';
	hud.sayOpen = false;
	hud.chatOpen = false;
	hud.aiLogOpen = false;
	sceneID.value = null;
	const url = new URL(window.location.href);
	url.searchParams.delete('scene');
	window.history.replaceState({}, '', url);
	clearURLView();
}
</script>

<template>
	<div v-if="!sceneID" ref="picker" class="picker">
		<img class="brand" src="/logo.png" alt="Arc Director" />
		<h1>Scenes</h1>
		<button type="button" @click="pick('marketplace')">Marketplace</button>
		<button type="button" @click="pick('ruins')">Ruin Fight</button>
		<button type="button" @click="pick('glen')">River Glen</button>
		<button type="button" @click="pick('abbey_vault')">Abbey Vault</button>
		<label class="music-toggle">
			<input
				type="checkbox"
				:checked="!menuMusicMuted"
				@change="onMenuMusicCheck"
			>
			<svg class="vol" viewBox="0 0 24 24" aria-hidden="true">
				<path
					fill="currentColor"
					d="M4 9v6h4l5 4V5L8 9H4zm11.5 3c0-1.8-1-3.3-2.5-4.1v8.2c1.5-.8 2.5-2.3 2.5-4.1zM14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.5 7-8.8S18 4.1 14 3.2z"
				/>
			</svg>
			music
		</label>
	</div>
	<template v-else>
		<KindlingView :hud="hud" :sceneID="sceneID" />
		<HudPickup :hud="hud" />
		<HudLayer :hud="hud" @scenes="leave" />
		<CursorLayer />
	</template>
	<MusicPlayer :audio="liveAudio" :kick="kickLive" :blocked="hud.sayOpen" />
</template>

<style scoped>
.picker {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 12px;
	background: #0e1410;
	color: #e8dfc8;
	font-family: ui-monospace, "Cascadia Code", monospace;
}
.brand {
	width: min(280px, 70vw);
	height: auto;
	margin-bottom: 8px;
}
.picker h1 {
	margin: 0;
	font-size: 28px;
	letter-spacing: 0.08em;
}
.picker button {
	min-width: 220px;
	padding: 10px 18px;
	font: inherit;
	color: #1a1208;
	background: #d4c4a0;
	border: 0;
	cursor: pointer;
}
.picker button:hover {
	background: #f0e6c8;
}
.music-toggle {
	position: absolute;
	left: 16px;
	top: 16px;
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0;
	font-size: 14px;
	letter-spacing: 0.04em;
	color: #e8dfc8;
	cursor: pointer;
	user-select: none;
}
.music-toggle input {
	width: 14px;
	height: 14px;
	margin: 0;
	accent-color: #d4c4a0;
	cursor: pointer;
}
.music-toggle .vol {
	width: 16px;
	height: 16px;
	flex: none;
	opacity: 0.9;
}
</style>
