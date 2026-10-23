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
import { SKALDIC_LAYA, decisionModelOf, thinksWith } from './director/inference';

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
/** The menu's settings, kept current: the scene picker shows what NPCs think with. */
const live = ref(prefs());
/** What NPCs think with, and whether Skaldic Laya makes their quick decisions. */
const mind = computed(() => ({
	model: thinksWith(live.value.model),
	laya: SKALDIC_LAYA.match.test(decisionModelOf(live.value)),
}));
const menuHandle = shallowRef<MenuAudioHandle | null>(null);

/**
 * The demos on the main menu, in order, with a line on each. Card screenshots are `public/menu/<id>.jpg`, full-screen stills of
 * where each backdrop starts circling `public/menu/backdrop/<id>.jpg`; `pnpm --filter @arc-director/game backdrops` shoots both.
 */
const CARDS:{ id:string; blurb:string }[] = [
	{ id: 'ruins', blurb: 'Two squads of five. Each captain thinks; the rest follow orders.' },
	{ id: 'marketplace', blurb: 'Seven sellers with minds of their own, and shoppers who keep coming.' },
	{ id: 'glen', blurb: 'Three strangers, one errand, and a bridge that costs gold.' },
	{ id: 'dungeon_vault', blurb: 'A company of three works its way through a five-room crypt.' },
];
/**
 * Seconds the hovered card's still takes to spread from the card over the screen. Its scene goes live behind the menu only after,
 * since booting one stalls a frame or two.
 */
const REVEAL = 0.8;

/** The card hovered or focused: its details show at once. */
const hovered = ref<string | null>(null);
const hoveredCard = computed(() => CARDS.find((c) => c.id === hovered.value));
/** The scene live behind the menu once its still has spread; null shows the still, or the painted background. */
const backdrop = ref<string | null>(null);
/** Where on screen the still spreads from: the middle of the hovered card. */
const revealFrom = ref({ x: 0, y: 0 });
let backdropTimer = 0;

function preview(id:string, card:EventTarget | null):void {
	if (hovered.value === id) {
		return;
	}
	if (card instanceof HTMLElement) {
		const r = card.getBoundingClientRect();
		revealFrom.value = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	}
	hovered.value = id;
	backdrop.value = null;
	window.clearTimeout(backdropTimer);
	backdropTimer = window.setTimeout(() => {
		backdrop.value = id;
	}, REVEAL * 1000);
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
		live.value = p;
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
	<div
		v-if="!sceneID"
		ref="picker"
		class="picker"
		:style="{ '--reveal-x': `${revealFrom.x}px`, '--reveal-y': `${revealFrom.y}px`, '--reveal-time': `${REVEAL}s` }"
	>
		<img class="bg" src="/main_menu_background.jpg" alt="">
		<img
			v-for="card in CARDS"
			:key="card.id"
			class="still"
			:class="{ shown: hovered === card.id }"
			:src="`/menu/backdrop/${card.id}.jpg`"
			alt=""
		>
		<SceneBackdrop v-if="backdrop" :key="backdrop" class="live" :sceneID="backdrop" />
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
						@mouseenter="preview(card.id, $event.currentTarget)"
						@focus="preview(card.id, $event.currentTarget)"
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
				<button type="button" class="mind" @click="setupDone = false">
					<svg class="spark" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M10 2.5l1.9 5.6 5.6 1.9-5.6 1.9L10 17.5l-1.9-5.6L2.5 10l5.6-1.9z" />
						<path d="M18.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" />
					</svg>
					<span class="what">
						<span class="eyebrow">The mind behind every NPC</span>
						<span class="name">
							<b>{{ mind.model }}</b>
							<span v-if="mind.laya" class="chip">+ {{ SKALDIC_LAYA.label }}</span>
						</span>
					</span>
					<span class="change">Change<span aria-hidden="true"> ›</span></span>
				</button>
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
 * The main menu: the painted background, or a hovered demo's still spreading from its card and then its scene live over it; the logo, a grid of
 * frameless screenshots, and a parchment box with the hovered one's name and a line about it.
 */
.picker {
	position: absolute;
	inset: 0;
	overflow: hidden;
	isolation: isolate;
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

/* The radius of a still's soft-edged circle, animatable (a plain custom property would jump). */
@property --reveal {
	syntax: "<length>";
	inherits: false;
	initial-value: 0px;
}

/*
 * The hovered demo's still, where its scene starts: it spreads out of the card in a soft circle while it comes into focus,
 * and fades when left. All four load with the menu so a hover shows one at once.
 */
.still {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
	pointer-events: none;
	user-select: none;
	opacity: 0;
	transform: scale(1.12);
	filter: blur(10px) saturate(1.4);
	mask-image: radial-gradient(circle at var(--reveal-x) var(--reveal-y), #000 calc(var(--reveal) - 160px), transparent var(--reveal));
	transform-origin: var(--reveal-x) var(--reveal-y);
	/* Leaving: fade, then reset out of sight. */
	transition: opacity var(--slow) var(--ease-out), --reveal 0s var(--slow), transform 0s var(--slow), filter 0s var(--slow);
}

.still.shown {
	z-index: 1;
	opacity: 1;
	--reveal: 200vmax;
	transform: none;
	filter: none;
	transition:
		--reveal var(--reveal-time) cubic-bezier(0.55, 0, 0.25, 1),
		transform var(--reveal-time) var(--ease-out),
		filter var(--reveal-time) var(--ease-out);
}

/* The live scene, over the still it starts from. */
.live {
	z-index: 1;
}

/* Darkens the left a little so the column reads over the picture or the scene. */
.picker::before {
	content: "";
	position: absolute;
	inset: 0;
	z-index: 2;
	pointer-events: none;
	background: linear-gradient(90deg, var(--backdrop), transparent 55%);
}

/* The menu, centered in the left half of the screen, over the darkened side of the picture. */
.column {
	--column-width: 520px;
	position: absolute;
	z-index: 3;
	left: 0;
	width: 50%;
	top: 40px;
	bottom: 40px;
	padding: 0 32px;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 22px;
}

.column > * {
	width: min(var(--column-width), 100%);
}

/* The init screen needs room for LM Studio beside the browser models, and scrolls when its steps run long. */
.column.wide {
	--column-width: 700px;
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

/* What NPCs think with, under the demos, and the way back to choosing it: a quiet parchment row, as the menu's own. */
.mind {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 16px;
	font: inherit;
	text-align: left;
	color: var(--ink);
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-radius: var(--radius);
	box-shadow: var(--shadow);
	cursor: pointer;
	transition: transform var(--quick) var(--ease-out);
}

.mind:hover,
.mind:focus-visible {
	outline: none;
	background: var(--parchment-deep);
	transform: translateY(-2px);
}

.mind:active {
	transform: translateY(1px);
}

.spark {
	flex: 0 0 auto;
	width: 26px;
	height: 26px;
	fill: var(--gold-deep);
}

.what {
	flex: 1 1 auto;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 1px;
}

.eyebrow {
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	opacity: 0.7;
}

/* The model's name in full; the chip goes to the next line before the name is cut. */
.name {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 2px 8px;
}

.what b {
	font-size: 17px;
}

/* Skaldic Laya, when it makes the quick decisions: a gold chip, as the picker's add-on badge. */
.chip {
	flex: 0 0 auto;
	padding: 2px 8px;
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	white-space: nowrap;
	color: var(--ink);
	background: var(--gold);
	border-radius: 999px;
}

.change {
	flex: 0 0 auto;
	font-weight: 700;
}

/* Music on or off: a round button in the corner, as the HUD's. */
.music {
	position: absolute;
	z-index: 3;
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
		padding: 0;
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
