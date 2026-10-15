<script setup lang="ts">
import { computed, reactive, ref, shallowRef, provide, watch, onMounted, onUnmounted } from 'vue';
import type { Audio } from '@arc-director/kindling';
import KindlingView from './ui/KindlingView.vue';
import HudPickup from './ui/HudPickup.vue';
import HudLayer from './ui/HudLayer.vue';
import CursorLayer from './ui/CursorLayer.vue';
import MusicPlayer from './ui/MusicPlayer.vue';
import SceneBackdrop from './ui/SceneBackdrop.vue';
import InferencePicker from './ui/InferencePicker.vue';
import { emptyHud } from './ui/hudModel';
import { sessionKey } from './ui/sessionKey';
import type { Session } from './engine/Session';
import { SCENES } from './data/scenes';
import { clearURLView } from './engine/urlView';
import { preloadArt } from './render/preloadArt';
import { startMenuAudio, type MenuAudioHandle } from './audio/menu';
import { prefs, setMusicMuted, watchPrefs } from './prefs';

preloadArt();

const params = new URLSearchParams(window.location.search);
const fromURL = params.get('scene');
const hud = reactive(emptyHud());
const session = shallowRef<Session | null>(null);
provide(sessionKey, session);
const sceneID = ref<string | null>(
	fromURL && SCENES[fromURL] ? fromURL : null,
);
/** Where NPCs think is picked: the init screen gives way to the scene cards. A scene deep link skips it. */
const setupDone = ref(sceneID.value !== null);
const picker = ref<HTMLElement | null>(null);
const musicMuted = ref(prefs().musicMuted);
const menuHandle = shallowRef<MenuAudioHandle | null>(null);

/** The demos on the main menu, in order, with a line on each. Screenshots are `public/menu/<id>.jpg`. */
const CARDS:{ id:string; blurb:string }[] = [
	{ id: 'ruins', blurb: 'Two squads of five. Each captain thinks; the rest follow orders.' },
	{ id: 'marketplace', blurb: 'Four sellers with minds of their own, and shoppers who keep coming.' },
	{ id: 'glen', blurb: 'Three strangers, one errand, and a bridge that costs gold.' },
	{ id: 'dungeon_vault', blurb: 'A company of three works its way through a five-room crypt.' },
];
/** Seconds a card must stay hovered before its scene goes live behind the menu (each one boots a scene). */
const BACKDROP_DELAY = 0.35;

/** The card hovered or focused: its details show at once. */
const hovered = ref<string | null>(null);
const hoveredCard = computed(() => CARDS.find((c) => c.id === hovered.value));
/** The scene live behind the menu, a moment after its card is hovered; null shows the painted background. */
const backdrop = ref<string | null>(null);
let backdropTimer = 0;

function preview(id:string):void {
	hovered.value = id;
	window.clearTimeout(backdropTimer);
	backdropTimer = window.setTimeout(() => {
		backdrop.value = id;
	}, BACKDROP_DELAY * 1000);
}

function unpreview():void {
	window.clearTimeout(backdropTimer);
	hovered.value = null;
	backdrop.value = null;
}

let stopPrefs:(()=>void) | null = null;

watch(picker, (el) => {
	menuHandle.value?.stop();
	menuHandle.value = el ? startMenuAudio(el) : null;
	if (el) {
		musicMuted.value = prefs().musicMuted;
	}
});
onMounted(() => {
	stopPrefs = watchPrefs((p) => {
		musicMuted.value = p.musicMuted;
		if (!sceneID.value) {
			hud.musicVolume = p.music;
		}
	});
});
onUnmounted(() => {
	stopPrefs?.();
	window.clearTimeout(backdropTimer);
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

function toggleMenuMusic():void {
	menuHandle.value?.setMuted(setMusicMuted(!musicMuted.value).musicMuted);
}

function pick(id:string):void {
	window.clearTimeout(backdropTimer);
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
		<img class="bg" src="/main_menu_background.jpg" alt="">
		<SceneBackdrop v-if="backdrop" :key="backdrop" :sceneID="backdrop" />
		<div class="column" :class="{ wide: !setupDone }">
			<div class="title">
				<img class="logo" src="/text-logo.png" alt="Arc Director">
				<p class="slogan">Where NPCs write their own destiny.</p>
			</div>
			<section v-if="!setupDone" class="setup" aria-labelledby="setup-title">
				<h2 id="setup-title">Where should NPCs think?</h2>
				<p>In LM Studio, or right here in your browser.</p>
				<InferencePicker @chosen="setupDone = true" />
			</section>
			<template v-else>
				<div class="cards" @mouseleave="unpreview">
					<button
						v-for="card in CARDS"
						:key="card.id"
						type="button"
						class="card"
						:aria-label="SCENES[card.id]?.title"
						@mouseenter="preview(card.id)"
						@focus="preview(card.id)"
						@blur="unpreview"
						@click="pick(card.id)"
					>
						<img :src="`/menu/${card.id}.jpg`" alt="">
					</button>
				</div>
				<div class="details" :class="{ shown: hoveredCard }" aria-live="polite">
					<template v-if="hoveredCard">
						<b>{{ SCENES[hoveredCard.id]?.title }}</b>
						<span>{{ hoveredCard.blurb }}</span>
					</template>
				</div>
			</template>
		</div>
		<button
			type="button"
			class="music"
			:aria-label="musicMuted ? 'Music off (click to play)' : 'Music on (click to mute)'"
			:title="musicMuted ? 'Music off' : 'Music on'"
			:aria-pressed="!musicMuted"
			@click="toggleMenuMusic"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z" />
				<path
					v-if="!musicMuted"
					fill="currentColor"
					d="M15.5 12c0-1.8-1-3.3-2.5-4.1v8.2c1.5-.8 2.5-2.3 2.5-4.1zM14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.5 7-8.8S18 4.1 14 3.2z"
				/>
				<path v-else d="M16 9l5 6m0-6l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
			</svg>
		</button>
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
/*
 * The main menu: the painted background, or a hovered demo's scene live over it; the logo, a grid of
 * frameless screenshots, and a parchment box with the hovered one's name and a line about it.
 */
.picker {
	position: absolute;
	inset: 0;
	overflow: hidden;
	background: var(--health-track);
	font-family: var(--font);
	color: var(--ink);
}

/* Covers the screen; narrower than 16:9 keeps the knight and the witch in view. */
.bg {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
	object-position: 66% 50%;
	pointer-events: none;
	user-select: none;
}

/* Darkens the left a little so the column reads over the picture or the scene. */
.picker::before {
	content: "";
	position: absolute;
	inset: 0;
	z-index: 1;
	pointer-events: none;
	background: linear-gradient(90deg, var(--backdrop), transparent 55%);
}

.column {
	position: absolute;
	z-index: 2;
	left: 56px;
	top: 40px;
	bottom: 40px;
	width: min(520px, calc(100% - 32px));
	display: flex;
	flex-direction: column;
	justify-content: center;
	gap: 22px;
}

/* The init screen needs room for LM Studio beside the two browser models, and scrolls when its steps run long. */
.column.wide {
	width: min(640px, calc(100% - 32px));
	justify-content: safe center;
	overflow-y: auto;
}

/* The init screen: a parchment box asking where NPCs think. */
.setup {
	padding: 18px 22px 22px;
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-radius: var(--radius-panel);
	box-shadow: var(--shadow-panel);
}

.setup h2 {
	margin: 0;
	font-size: 24px;
}

.setup p {
	margin: 2px 0 14px;
	font-size: 15px;
}

/* The logo with the slogan under it, centered over the previews. */
.title {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
}

.logo {
	width: min(440px, 100%);
	filter: drop-shadow(var(--shadow)) drop-shadow(0 0 18px rgba(255, 240, 200, 0.5));
}

.slogan {
	margin: 0;
	font-size: 20px;
	font-weight: 700;
	font-style: italic;
	letter-spacing: 0.03em;
	color: var(--on-world);
	text-shadow: var(--on-world-edge);
}

.cards {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 14px;
}

/* Just the screenshot; hovered or focused, it lifts and grows a little. */
.card {
	padding: 0;
	border: 0;
	background: none;
	border-radius: var(--radius-small);
	overflow: hidden;
	box-shadow: var(--shadow-panel);
	cursor: pointer;
	transition: transform var(--quick) var(--ease-out);
}

.card:hover,
.card:focus-visible {
	outline: none;
	transform: translateY(-4px) scale(1.04);
}

.card:active {
	transform: scale(1.01);
}

.card img {
	display: block;
	width: 100%;
	aspect-ratio: 16 / 10;
	object-fit: cover;
}

/* The hovered demo's name and line; keeps its room when empty, so the grid does not jump. */
.details {
	min-height: 76px;
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 12px 18px;
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-radius: var(--radius);
	box-shadow: var(--shadow);
	opacity: 0;
	transform: translateY(6px);
	transition: opacity var(--quick) var(--ease-out), transform var(--quick) var(--ease-out);
}

.details.shown {
	opacity: 1;
	transform: none;
}

.details b {
	font-size: 22px;
}

.details span {
	font-size: 15px;
	line-height: 1.3;
}

/* Music on or off: a round button in the corner, as the HUD's. */
.music {
	position: absolute;
	z-index: 2;
	top: 14px;
	right: 14px;
	width: var(--btn);
	height: var(--btn);
	padding: 0;
	display: grid;
	place-items: center;
	color: var(--ink);
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-radius: 50%;
	box-shadow: var(--shadow);
	cursor: pointer;
}

.music svg {
	width: 26px;
	height: 26px;
}

.music:focus-visible {
	outline: var(--line-thin) solid var(--gold-deep);
	outline-offset: 2px;
}

@media (max-width: 700px) {
	.column,
	.column.wide {
		left: 16px;
		right: 16px;
		top: 16px;
		bottom: 16px;
		width: auto;
		justify-content: flex-start;
		gap: 12px;
	}

	.logo {
		width: min(320px, 70%);
	}

	.slogan {
		font-size: 16px;
	}

	.cards {
		gap: 10px;
	}
}
</style>
