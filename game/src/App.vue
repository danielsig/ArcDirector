<script setup lang="ts">
import { computed, reactive, ref, shallowRef, provide, watch, onMounted, onUnmounted } from 'vue';
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
import { prefs, setPrefs, watchPrefs } from './prefs';

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
const menuEl = ref<HTMLElement | null>(null);
const musicMuted = ref(prefs().musicMuted);
const menuHandle = shallowRef<MenuAudioHandle | null>(null);

/** `public/main_menu_background.jpg` — 2560×1440. */
const MENU_BG_W = 2560;
const MENU_BG_H = 1440;
/** Raven tail, plus a sliver of sky, as a fraction of image width. */
const RAVEN_RIGHT = 2140 / MENU_BG_W;
/** Middle of the knight and the witch. */
const ADVENTURER_X = 1680 / MENU_BG_W;
/** Visible width of this 16:9 plate inside a 9:16 viewport. */
const PORTRAIT_VIS = (9 / 16) / (MENU_BG_W / MENU_BG_H);

const frame = ref(menuBackgroundFrame(window.innerWidth, window.innerHeight));
const menuLeft = ref(menuAnchorX(window.innerWidth, Math.min(220, window.innerWidth - 48)));

/** Cover the viewport. Taller than 16:9 crops in from the right, holding the left
 *  edge, until the raven would leave; narrower than that eases onto the adventurers. */
function menuBackgroundFrame(viewW:number, viewH:number):{ width:number, height:number, x:number, y:number } {
	const scale = Math.max(viewW / MENU_BG_W, viewH / MENU_BG_H);
	const width = MENU_BG_W * scale;
	const height = MENU_BG_H * scale;
	const visX = width > 0 ? viewW / width : 1;
	const visY = height > 0 ? viewH / height : 1;
	let focusX:number;
	if (visX >= RAVEN_RIGHT) {
		focusX = visX / 2;
	} else {
		const span = RAVEN_RIGHT - PORTRAIT_VIS;
		const t = span <= 0 ? 1 : Math.min(1, (RAVEN_RIGHT - visX) / span);
		const from = RAVEN_RIGHT / 2;
		focusX = from + (ADVENTURER_X - from) * t;
	}
	let left = focusX - visX / 2;
	left = Math.min(Math.max(left, 0), Math.max(0, 1 - visX));
	let top = 0.5 - visY / 2;
	top = Math.min(Math.max(top, 0), Math.max(0, 1 - visY));
	return { width, height, x: -left * width, y: -top * height };
}

/** Center of the left half. Once that would clip the column, ease toward the screen center. */
function menuAnchorX(viewW:number, menuW:number):number {
	const pad = 24;
	const ideal = viewW * 0.25;
	const screen = viewW / 2;
	const minCenter = menuW / 2 + pad;
	if (minCenter <= ideal) {
		return ideal;
	}
	const fitsAt = minCenter * 4;
	const centeredAt = Math.max(menuW * 2, 1);
	const span = fitsAt - centeredAt;
	const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (fitsAt - viewW) / span));
	const center = ideal + (screen - ideal) * t;
	const maxCenter = viewW - minCenter;
	if (maxCenter < minCenter) {
		return screen;
	}
	return Math.min(maxCenter, Math.max(minCenter, center));
}

function layoutPicker():void {
	const root = picker.value;
	if (!root) {
		return;
	}
	const viewW = root.clientWidth;
	const viewH = root.clientHeight;
	if (viewW <= 0 || viewH <= 0) {
		return;
	}
	frame.value = menuBackgroundFrame(viewW, viewH);
	const menuW = menuEl.value?.offsetWidth ?? Math.min(220, viewW - 48);
	menuLeft.value = menuAnchorX(viewW, menuW);
}

let pickerObserver:ResizeObserver | null = null;
let stopPrefs:(()=>void) | null = null;

watch(picker, (el) => {
	menuHandle.value?.stop();
	menuHandle.value = el ? startMenuAudio(el) : null;
	pickerObserver?.disconnect();
	pickerObserver = null;
	if (el) {
		musicMuted.value = prefs().musicMuted;
		pickerObserver = new ResizeObserver(() => layoutPicker());
		pickerObserver.observe(el);
		layoutPicker();
	}
});
onMounted(() => {
	layoutPicker();
	stopPrefs = watchPrefs((p) => {
		musicMuted.value = p.musicMuted;
		if (!sceneID.value) {
			hud.musicVolume = p.music;
		}
	});
});
onUnmounted(() => {
	stopPrefs?.();
	pickerObserver?.disconnect();
	pickerObserver = null;
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
	menuHandle.value?.setMuted(setPrefs({ musicMuted: !on }).musicMuted);
}

function pick(id:string):void {
	sceneID.value = id;
	const url = new URL(window.location.href);
	url.searchParams.set('scene', id);
	window.history.replaceState({}, '', url);
}

function leave():void {
	hud.menuOpen = false;
	hud.briefOpen = false;
	hud.keysOpen = false;
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
		<img
			class="bg"
			src="/main_menu_background.jpg"
			alt=""
			:style="{
				width: `${frame.width}px`,
				height: `${frame.height}px`,
				transform: `translate(${frame.x}px, ${frame.y}px)`,
			}"
		/>
		<div ref="menuEl" class="menu" :style="{ left: `${menuLeft}px` }">
			<img class="text-logo" src="/text-logo.png" alt="Arc Director" />
			<h1>Demos</h1>
			<button type="button" @click="pick('ruins')">5v5 Combat</button>
			<button type="button" @click="pick('marketplace')">Marketplace</button>
			<button type="button" @click="pick('glen')">River Glen</button>
			<button type="button" @click="pick('dungeon_vault')">Dungeon Crawl</button>
		</div>
		<label class="music-toggle">
			<input
				type="checkbox"
				:checked="!musicMuted"
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
		<KindlingView :key="hud.boots" :hud="hud" :sceneID="sceneID" />
		<HudPickup :hud="hud" />
		<HudLayer :hud="hud" :sceneID="sceneID ?? ''" @scenes="leave" />
		<CursorLayer />
	</template>
	<MusicPlayer :audio="liveAudio" :kick="kickLive" :blocked="hud.sayOpen" />
</template>

<style scoped>
.picker {
	position: absolute;
	inset: 0;
	overflow: hidden;
	background: #0e1410;
	color: #e8dfc8;
	font-family: ui-monospace, "Cascadia Code", monospace;
}
.bg {
	position: absolute;
	left: 0;
	top: 0;
	max-width: none;
	transform-origin: top left;
	pointer-events: none;
	user-select: none;
}
.menu {
	position: absolute;
	top: 50%;
	z-index: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 12px;
	width: max-content;
	max-width: calc(100% - 48px);
	transform: translate(-50%, -50%);
}
.text-logo {
	width: 520px;
	max-width: 80dvw;
	margin-bottom: 8dvh;
	filter: drop-shadow(#EB99 0px 0px 16px);
}
.picker h1 {
	margin: 0;
	font-size: 28px;
	letter-spacing: 0.08em;
	text-shadow: 0 1px 2px rgba(14, 20, 16, 0.85), 0 0 12px rgba(14, 20, 16, 0.55);
}
.picker button {
	width: min(220px, calc(100vw - 48px));
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
	text-shadow: 0 1px 2px rgba(8, 6, 4, 0.9);
	cursor: pointer;
	user-select: none;
	z-index: 1;
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
