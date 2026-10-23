<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { trainedOnArcDirector } from 'arc-director';
import { HOSTED } from '../director/hosted';
import { SKALDIC_LAYA, decisionChoice, decisionModelName, inferenceSetup, listLMStudioModels, lmStudio, pickDecisionChoice, thinksWith } from '../director/inference';
import { prefs, setPrefs, watchPrefs } from '../prefs';
import type { BenchKind } from '../director/bench';
import { quickBench, quickBenchCurrent } from '../director/quickBench';
import type { HudModelOption } from './hudModel';
import QuickRank from './QuickRank.vue';
import QuickScoreBadge from './QuickScoreBadge.vue';

/**
 * The mind behind every NPC: what they think with, and what makes their quick decisions. With LM Studio it opens a
 * drop-up of its models to pick both from; otherwise it asks to change where NPCs think. A row on the main menu, or
 * `compact`, a small pill along the bottom of the game.
 */
const props = withDefaults(defineProps<{
	/** The model NPCs think with, as the director resolved it; empty until it has, or with no scene running. */
	active?:string;
	compact?:boolean;
}>(), { active: '' });

const emit = defineEmits<{
	/** Asked to change where NPCs think: LM Studio or the browser. */
	change: [];
}>();

const root = ref<HTMLElement | null>(null);
const open = ref(false);
const live = ref(prefs());
const stopPrefs = watchPrefs((next) => {
	live.value = next;
});

const onLMStudio = computed(() => live.value.inference === 'lmstudio');
/** The chat model picked, or else the one LM Studio picked itself: a separate decision model is any other. */
const main = computed(() => live.value.model || props.active);
const name = computed(() => thinksWith(props.active || live.value.model));
const decider = computed(() => decisionModelName(live.value));
/** The browser model NPCs think with, while it downloads or loads: how far, as the picker shows it. */
const preparing = computed(() => {
	const state = live.value.inference === 'browser' ? inferenceSetup.models[live.value.browserModel] : undefined;
	return state?.progress == null ? '' : `${state.cached ? 'Loading' : 'Downloading'} ${Math.round(state.progress * 100)}%`;
});
const decision = computed(() => decisionChoice(live.value, main.value));

/** A model LM Studio did not list, as a row of its own: it is still what was picked. */
function unlisted(id:string):HudModelOption {
	return { id, loaded: false, decision: false, devices: 1 };
}

const chatModels = computed(() => {
	const listed = lmStudio.models.filter((m) => !m.decision);
	const picked = live.value.model;
	return picked && !listed.some((m) => m.id === picked) ? [unlisted(picked), ...listed] : listed;
});

/** What the filter box asks for. */
const query = ref('');

/** Filtering keeps each list as tall as it was, so the panel does not jump as matches thin out. Pre-flush: measured before the filter applies. */
watch(query, (now, was) => {
	if (now && !was) {
		lists().forEach((list) => {
			list.style.minHeight = `${list.clientHeight}px`;
		});
	}
	void nextTick(markScrolling);
});

function lists():HTMLElement[] {
	return [...root.value?.querySelectorAll<HTMLElement>('.list') ?? []];
}

/** Marks the lists that scroll, which alone fade at their edges. */
function markScrolling():void {
	lists().forEach((list) => {
		list.toggleAttribute('data-scrolls', list.scrollHeight > list.clientHeight);
	});
}

/** `models` whose id has every word typed into the filter. */
function shown(models:HudModelOption[]):HudModelOption[] {
	const words = query.value.toLowerCase().split(/\s+/).filter(Boolean);
	return models.filter((m) => words.every((w) => m.id.toLowerCase().includes(w)));
}

/** `models` with those a quick bench ranked first, best first; the rest after, as they were. */
function ranked(kind:BenchKind, models:HudModelOption[]):HudModelOption[] {
	const scores = quickBench.scores[kind];
	const benched = models.filter((m) => scores[m.id]).sort((a, b) => scores[b.id].score - scores[a.id].score);
	return [...benched, ...models.filter((m) => !scores[m.id])];
}

/** Decision models first, then every other chat model; the one picked stays listed even when LM Studio does not list it. */
const deciders = computed(() => {
	const listed = [...lmStudio.models.filter((m) => m.decision), ...lmStudio.models.filter((m) => !m.decision && m.id !== main.value)];
	const picked = decision.value.startsWith('model:') ? decision.value.slice('model:'.length) : '';
	// Skaldic Laya in the browser has a row of its own.
	return picked && picked !== SKALDIC_LAYA.model && !listed.some((m) => m.id === picked) ? [unlisted(picked), ...listed] : listed;
});

/** What picking Skaldic Laya in the browser costs, or how its download goes. */
const browserLayaNote = computed(() => {
	const state = inferenceSetup.laya;
	if (state.progress !== null) {
		return `Downloading ${Math.round(state.progress * 100)}%`;
	}
	return state.cached ? 'Downloaded · beside LM Studio' : `Download ${SKALDIC_LAYA.sizeGB} GB · beside LM Studio`;
});

const loadedCount = computed(() => lmStudio.models.filter((m) => m.loaded).length);
const offline = computed(() => lmStudio.listed && !lmStudio.listing && lmStudio.models.length === 0);

/** An id as `publisher/name`: the name to read, and who made it in small. */
function parts(id:string):{ name:string; by:string } {
	const slash = id.lastIndexOf('/');
	return slash < 0 ? { name: id, by: '' } : { name: id.slice(slash + 1), by: id.slice(0, slash) };
}

function toggle():void {
	if (!onLMStudio.value) {
		emit('change');
		return;
	}
	open.value = !open.value;
	if (open.value) {
		query.value = '';
		void nextTick(revealPicked);
		void listLMStudioModels().then(() => nextTick(revealPicked));
	}
}

/** Scrolls each list to its picked model, which may sit far down a long one. */
function revealPicked():void {
	root.value?.querySelectorAll('.list .row.on').forEach((row) => row.scrollIntoView({ block: 'nearest' }));
	markScrolling();
}

function change():void {
	open.value = false;
	emit('change');
}

function pickMain(id:string):void {
	setPrefs({ model: id });
}

function onPointer(ev:PointerEvent):void {
	if (open.value && !root.value?.contains(ev.target as Node)) {
		open.value = false;
	}
}

function onKey(ev:KeyboardEvent):void {
	if (open.value && ev.key === 'Escape') {
		open.value = false;
	}
}

onMounted(() => {
	document.addEventListener('pointerdown', onPointer, true);
	document.addEventListener('keydown', onKey);
});
onUnmounted(() => {
	stopPrefs();
	document.removeEventListener('pointerdown', onPointer, true);
	document.removeEventListener('keydown', onKey);
});
</script>

<template>
	<div ref="root" class="mind-menu" :class="{ compact, open }">
		<Transition name="pop">
			<div v-if="open" class="pop" role="menu" aria-label="Models NPCs think with">
				<header class="server">
					<img src="/lmstudio/logo.png" alt="">
					<span class="who">
						<b>LM Studio</b>
						<span v-if="lmStudio.listing && !lmStudio.listed">Looking…</span>
						<span v-else-if="offline">Not answering on port 1234</span>
						<span v-else>{{ chatModels.length }} model{{ chatModels.length === 1 ? '' : 's' }} · {{ loadedCount }} loaded</span>
					</span>
					<label v-if="lmStudio.models.length > 6" class="filter">
						<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></svg>
						<input v-model="query" type="search" placeholder="Find a model" aria-label="Find a model">
					</label>
					<button type="button" class="refresh" :class="{ spinning: lmStudio.listing }" title="Ask LM Studio again" aria-label="Ask LM Studio again" @click="listLMStudioModels()">
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5" /></svg>
					</button>
				</header>

				<div class="columns">
					<section>
						<div class="head">
							<h3>
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2.5l1.9 5.6 5.6 1.9-5.6 1.9L10 17.5l-1.9-5.6L2.5 10l5.6-1.9z" /></svg>
								Thinks with
							</h3>
							<QuickRank kind="arc" />
						</div>
						<button type="button" class="row" role="menuitemradio" :aria-checked="!live.model" :class="{ on: !live.model }" @click="pickMain('')">
							<span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" /></svg></span>
							<span class="id">
								<b>LM Studio's pick</b>
								<span class="by">{{ active ? parts(active).name : 'Whichever model it has loaded' }}</span>
							</span>
						</button>
						<div class="list">
							<button
								v-for="m in ranked('arc', shown(chatModels))"
								:key="m.id"
								type="button"
								class="row"
								role="menuitemradio"
								:aria-checked="m.id === live.model"
								:class="{ on: m.id === live.model, skaldic: trainedOnArcDirector(m.id), testing: quickBenchCurrent('arc') === m.id }"
								:title="m.id"
								@click="pickMain(m.id)"
							>
								<span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" /></svg></span>
								<span class="id">
									<b>{{ parts(m.id).name }}</b>
									<span v-if="parts(m.id).by" class="by">{{ parts(m.id).by }}</span>
								</span>
								<span v-if="m.devices > 1" class="tag">×{{ m.devices }}</span>
								<span v-if="m.loaded" class="loaded" title="Loaded in LM Studio: answers at once"><i />Loaded</span>
								<QuickScoreBadge kind="arc" :id="m.id" />
							</button>
							<p v-if="!shown(chatModels).length && !lmStudio.listing" class="empty">{{ query ? 'No model by that name.' : 'No chat models yet. Load one in LM Studio.' }}</p>
						</div>
					</section>

					<section>
						<div class="head">
							<h3>
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
								Quick decisions
							</h3>
							<QuickRank kind="decision" />
						</div>
						<button type="button" class="row" role="menuitemradio" :aria-checked="decision === 'model:'" :class="{ on: decision === 'model:' }" @click="pickDecisionChoice('model:')">
							<span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" /></svg></span>
							<span class="id">
								<b>Same as thinking</b>
								<span class="by">The main model scores its own choices</span>
							</span>
						</button>
						<button
							type="button"
							class="row skaldic laya"
							role="menuitemradio"
							:aria-checked="decision === `model:${SKALDIC_LAYA.model}`"
							:class="{ on: decision === `model:${SKALDIC_LAYA.model}` }"
							:disabled="!!inferenceSetup.unsupported || inferenceSetup.laya.progress !== null"
							:title="inferenceSetup.unsupported || undefined"
							@click="pickDecisionChoice(`model:${SKALDIC_LAYA.model}`)"
						>
							<span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" /></svg></span>
							<span class="id">
								<span class="eyebrow">Trained for ArcDirector</span>
								<b>{{ SKALDIC_LAYA.label }} · in your browser</b>
								<span class="by">{{ browserLayaNote }}</span>
							</span>
						</button>
						<div class="list">
							<button
								v-for="m in ranked('decision', shown(deciders))"
								:key="m.id"
								type="button"
								class="row"
								role="menuitemradio"
								:aria-checked="decision === `model:${m.id}`"
								:class="{ on: decision === `model:${m.id}`, skaldic: trainedOnArcDirector(m.id), laya: m.decision, testing: quickBenchCurrent('decision') === m.id }"
								:title="m.id"
								@click="pickDecisionChoice(`model:${m.id}`)"
							>
								<span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" /></svg></span>
								<span class="id">
									<span v-if="m.decision" class="eyebrow">Decision model</span>
									<b>{{ parts(m.id).name }}</b>
									<span v-if="parts(m.id).by" class="by">{{ parts(m.id).by }}</span>
								</span>
								<span v-if="m.loaded" class="loaded" title="Loaded in LM Studio: answers at once"><i />Loaded</span>
								<QuickScoreBadge kind="decision" :id="m.id" />
							</button>
							<p v-if="!shown(deciders).length && query && !lmStudio.listing" class="empty">No model by that name.</p>
						</div>
						<div class="quiet">
							<button v-if="HOSTED.jev" type="button" role="menuitemradio" :aria-checked="decision === 'jev'" :class="{ on: decision === 'jev' }" @click="pickDecisionChoice('jev')">Jev (hosted)</button>
							<button type="button" role="menuitemradio" :aria-checked="decision === 'off'" :class="{ on: decision === 'off' }" @click="pickDecisionChoice('off')">Off</button>
						</div>
					</section>
				</div>

				<footer>
					<button type="button" class="elsewhere" @click="change">Think somewhere else<span aria-hidden="true"> ›</span></button>
				</footer>
			</div>
		</Transition>

		<button type="button" class="trigger" :aria-expanded="onLMStudio ? open : undefined" :aria-haspopup="onLMStudio ? 'menu' : undefined" @click="toggle">
			<svg class="spark" viewBox="0 0 24 24" aria-hidden="true">
				<path d="M10 2.5l1.9 5.6 5.6 1.9-5.6 1.9L10 17.5l-1.9-5.6L2.5 10l5.6-1.9z" />
				<path d="M18.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" />
			</svg>
			<span class="what">
				<span v-if="!compact" class="eyebrow">The mind behind every NPC</span>
				<span class="name">
					<b>{{ name }}</b>
					<span v-if="decider" class="chip">+ {{ decider }}</span>
					<span v-if="preparing" class="chip preparing">{{ preparing }}</span>
				</span>
			</span>
			<span v-if="onLMStudio" class="caret" aria-hidden="true">
				<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" /></svg>
			</span>
			<span v-else-if="!compact" class="change">Change<span aria-hidden="true"> ›</span></span>
		</button>
	</div>
</template>

<style scoped>
.mind-menu {
	/* Skaldic models under their gold, as in the inference picker: midnight blue, crimson for a decision model. */
	--skaldic-bg: linear-gradient(135deg, #24345a, #0f1626);
	--laya-bg: linear-gradient(135deg, #5c1d26, #24090e);
	position: relative;
	font-family: var(--font);
	color: var(--ink);
}

button {
	font: inherit;
	color: inherit;
	cursor: pointer;
}

button:focus-visible {
	outline: var(--line-thin) solid var(--gold-deep);
	outline-offset: 2px;
}

/* The main menu's row: a quiet parchment bar, as the menu's own. */
.trigger {
	width: 100%;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 16px;
	text-align: left;
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-radius: var(--radius);
	box-shadow: var(--shadow);
	transition: transform var(--quick) var(--ease-out);
}

.trigger:hover,
.open .trigger {
	background: var(--parchment-deep);
	transform: translateY(-2px);
}

.trigger:active {
	transform: translateY(1px);
}

.spark {
	flex: 0 0 auto;
	width: 26px;
	height: 26px;
	fill: var(--gold-deep);
	transition: transform var(--slow) var(--ease-pop);
}

.trigger:hover .spark,
.open .spark {
	transform: rotate(18deg) scale(1.12);
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

/* What makes the quick decisions, when it is not the main model: a gold chip. */
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

/* A download or load under way: an ink chip, so it reads apart from the gold one. */
.chip.preparing {
	color: var(--parchment);
	background: var(--ink);
	font-variant-numeric: tabular-nums;
}

.change {
	flex: 0 0 auto;
	font-weight: 700;
}

/* Points up to the drop-up, and flips while it is open. */
.caret {
	flex: 0 0 auto;
	display: grid;
	place-items: center;
	width: 30px;
	height: 30px;
	border: var(--line-thin) solid var(--ink);
	border-radius: 50%;
	background: var(--gold);
}

.caret svg {
	width: 18px;
	height: 18px;
	fill: none;
	stroke: var(--ink);
	stroke-width: 3;
	stroke-linecap: round;
	stroke-linejoin: round;
	transition: transform var(--slow) var(--ease-pop);
}

.open .caret svg {
	transform: rotate(180deg);
}

/* In the game: words on the world along the bottom edge, which become a parchment pill to the touch. */
.compact .trigger {
	width: auto;
	gap: 6px;
	padding: 3px 6px 3px 10px;
	color: var(--on-world);
	text-shadow: var(--on-world-edge);
	background: transparent;
	border: var(--line-thin) solid transparent;
	border-radius: 999px;
	box-shadow: none;
	opacity: 0.85;
	transition: background var(--quick) var(--ease-out), opacity var(--quick) var(--ease-out), transform var(--quick) var(--ease-out);
}

.compact .trigger:hover,
.compact.open .trigger {
	color: var(--ink);
	text-shadow: none;
	background: var(--parchment);
	border-color: var(--ink);
	box-shadow: var(--shadow);
	opacity: 1;
}

.compact .spark {
	width: 16px;
	height: 16px;
	fill: var(--gold);
	filter: drop-shadow(0 1px 0 #2a1a0c);
}

.compact .trigger:hover .spark,
.compact.open .spark {
	fill: var(--gold-deep);
	filter: none;
}

.compact .what b {
	font-size: 13px;
	white-space: nowrap;
}

.compact .name {
	flex-wrap: nowrap;
}

.compact .chip {
	padding: 1px 6px;
	font-size: 10px;
	text-shadow: none;
}

.compact .caret {
	width: 20px;
	height: 20px;
	border-width: 0;
	background: transparent;
}

.compact .caret svg {
	width: 14px;
	height: 14px;
	stroke: currentColor;
}

/* The drop-up: a parchment panel over the row, with a tail pointing down at it. */
.pop {
	position: absolute;
	z-index: 10;
	left: 0;
	bottom: calc(100% + 14px);
	width: min(800px, calc(100vw - 32px));
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 14px;
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-radius: var(--radius-panel);
	box-shadow: var(--shadow-panel);
	transform-origin: 40px calc(100% + 14px);
}

.compact .pop {
	left: 50%;
	translate: -50% 0;
	transform-origin: 50% calc(100% + 14px);
}

/* What NPCs think with beside what makes their quick decisions, each list scrolling on its own. */
.columns {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 16px;
	min-height: 0;
}

.list {
	display: flex;
	flex-direction: column;
	gap: 6px;
	max-height: min(44vh, 400px);
	margin: 0 -6px;
	padding: 4px 6px;
	overflow-y: auto;
	overscroll-behavior: contain;
	scrollbar-width: thin;
	scrollbar-color: var(--ink-soft) transparent;
}

/* Rows fade out at the edges of the scroll rather than cut off. */
.list[data-scrolls] {
	mask-image: linear-gradient(transparent, #000 8px, #000 calc(100% - 14px), transparent);
}

@media (max-width: 700px) {
	.columns {
		grid-template-columns: 1fr;
	}

	.list {
		max-height: 24vh;
	}
}

/* Finds a model among many, in LM Studio's header. */
.filter {
	flex: 0 1 220px;
	min-width: 0;
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 0 10px;
	height: 34px;
	background: rgba(255, 255, 255, 0.16);
	border-radius: 999px;
	transition: background var(--quick) var(--ease-out);
}

.filter:focus-within {
	background: rgba(255, 255, 255, 0.28);
	box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6);
}

.filter svg {
	flex: 0 0 auto;
	width: 16px;
	height: 16px;
	fill: none;
	stroke: #fff;
	stroke-width: 2.6;
	stroke-linecap: round;
}

.filter input {
	flex: 1 1 auto;
	min-width: 0;
	font: inherit;
	font-size: 14px;
	color: #fff;
	background: none;
	border: 0;
	outline: none;
}

.filter input::placeholder {
	color: rgba(255, 255, 255, 0.7);
}

.pop-enter-active {
	transition: opacity var(--slow) var(--ease-out), transform var(--slow) var(--ease-pop);
}

.pop-leave-active {
	transition: opacity var(--quick) var(--ease-out), transform var(--quick) var(--ease-out);
}

.pop-enter-from,
.pop-leave-to {
	opacity: 0;
	transform: translateY(10px) scale(0.94);
}

/* LM Studio, in its blue, heading the panel: how many models it has, and a button to ask it again. */
.server {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 10px;
	color: #fff;
	background: linear-gradient(135deg, #6b74ed, #5018c0);
	border: var(--line-thin) solid var(--ink);
	border-radius: var(--radius);
	box-shadow: var(--shadow);
}

.server img {
	width: 34px;
	height: 34px;
	border-radius: 9px;
	box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
}

.who {
	flex: 1 1 auto;
	display: flex;
	flex-direction: column;
	font-size: 13px;
}

.who b {
	font-size: 16px;
}

.who span {
	opacity: 0.85;
}

.refresh {
	width: 34px;
	height: 34px;
	display: grid;
	place-items: center;
	padding: 0;
	background: rgba(255, 255, 255, 0.16);
	border: 0;
	border-radius: 50%;
}

.refresh:hover {
	background: rgba(255, 255, 255, 0.3);
}

.refresh svg {
	width: 20px;
	height: 20px;
	fill: none;
	stroke: #fff;
	stroke-width: 2.6;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.refresh.spinning svg {
	animation: spin 0.8s linear infinite;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}

section {
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 6px;
}

/* A column's name, and its quick ranking on the right. */
.head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	min-height: 28px;
	margin-bottom: 2px;
}

/* The model a quick bench tests now: its outline marches, gold. */
.row.testing {
	border: var(--line-thin) dashed var(--gold-deep);
	animation: march 0.8s linear infinite;
	background:
		linear-gradient(var(--parchment), var(--parchment)) padding-box,
		repeating-linear-gradient(45deg, var(--gold-deep) 0 6px, var(--gold) 6px 12px) border-box;
	border-color: transparent;
	border-style: solid;
	background-size: auto, 34px 34px;
}

.row.skaldic.testing {
	background:
		var(--skaldic-bg) padding-box,
		repeating-linear-gradient(45deg, var(--gold-deep) 0 6px, var(--gold) 6px 12px) border-box;
	background-size: auto, 34px 34px;
}

@keyframes march {
	to {
		background-position: 0 0, 34px 0;
	}
}

h3 {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 0 0 0 4px;
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	opacity: 0.75;
}

h3 svg {
	width: 15px;
	height: 15px;
	fill: var(--gold-deep);
}

/* A model: a tick in a ring, its name over its maker, and whether LM Studio has it loaded. */
.row {
	flex: 0 0 auto;
	position: relative;
	overflow: hidden;
	display: flex;
	align-items: center;
	gap: 10px;
	min-height: 46px;
	padding: 5px 12px;
	text-align: left;
	background: transparent;
	border: var(--line-thin) dashed var(--ink-soft);
	border-radius: var(--radius-small);
	transition: transform var(--quick) var(--ease-out), background var(--quick) var(--ease-out);
}

.row:hover {
	background: var(--parchment-deep);
	border-style: solid;
	border-color: var(--ink);
	transform: translateX(3px);
}

.row.on {
	background: color-mix(in srgb, var(--gold) 30%, var(--parchment));
	border-style: solid;
	border-color: var(--ink);
	box-shadow: 0 0 0 var(--line-thin) var(--gold), var(--shadow);
}

.tick {
	flex: 0 0 auto;
	width: 24px;
	height: 24px;
	display: grid;
	place-items: center;
	border: var(--line-thin) solid var(--ink);
	border-radius: 50%;
	background: var(--parchment);
	transition: background var(--quick) var(--ease-out);
}

.tick svg {
	width: 16px;
	height: 16px;
	fill: none;
	stroke: var(--ink);
	stroke-width: 3.2;
	stroke-linecap: round;
	stroke-linejoin: round;
	stroke-dasharray: 22;
	stroke-dashoffset: 22;
	transition: stroke-dashoffset var(--slow) var(--ease-out);
}

/* Picked: the ring fills gold and the tick draws itself in. */
.row.on .tick {
	background: var(--gold);
}

.row.on .tick svg {
	stroke-dashoffset: 0;
}

.id {
	flex: 1 1 auto;
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.id b {
	font-size: 15px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.by {
	font-size: 12px;
	opacity: 0.65;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.id .eyebrow {
	font-size: 10px;
	letter-spacing: 0.12em;
}

.tag {
	flex: 0 0 auto;
	font-size: 12px;
	font-weight: 700;
	opacity: 0.7;
}

/* Loaded in LM Studio: a green light that breathes. */
.loaded {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	gap: 5px;
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--ink-good);
}

.loaded i {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #5fd35a;
	box-shadow: 0 0 0 0 rgba(95, 211, 90, 0.7);
	animation: breathe 2s ease-out infinite;
}

@keyframes breathe {
	70%,
	100% {
		box-shadow: 0 0 0 7px rgba(95, 211, 90, 0);
	}
}

/* Trained for ArcDirector: dark and gilded, with a sheen crossing on hover, as in the inference picker. */
.row.skaldic {
	color: var(--parchment);
	background: var(--skaldic-bg);
	border: var(--line-thin) solid var(--gold);
	box-shadow: var(--shadow), inset 0 0 14px rgba(255, 200, 90, 0.14);
}

.row.skaldic.laya {
	background: var(--laya-bg);
}

.row.skaldic::after {
	content: "";
	position: absolute;
	inset: 0;
	background: linear-gradient(100deg, transparent 30%, rgba(255, 225, 150, 0.25) 50%, transparent 70%);
	transform: translateX(-120%);
	pointer-events: none;
}

.row.skaldic:hover::after {
	transform: translateX(120%);
	transition: transform 0.9s var(--ease-out);
}

.row.skaldic:hover {
	box-shadow: var(--shadow), 0 0 18px rgba(255, 196, 80, 0.45), inset 0 0 14px rgba(255, 200, 90, 0.2);
}

.row.skaldic.on {
	box-shadow: 0 0 0 var(--line-thin) var(--gold), 0 0 22px rgba(255, 196, 80, 0.5), inset 0 0 14px rgba(255, 200, 90, 0.2);
}

.row.skaldic .eyebrow,
.row.skaldic .by {
	color: var(--gold);
	opacity: 0.9;
}

.row.skaldic .tick {
	border-color: var(--gold);
	background: transparent;
}

.row.skaldic .tick svg {
	stroke: var(--ink);
}

.row.skaldic.on .tick {
	background: var(--gold);
}

.row.skaldic .loaded {
	color: #8fe88a;
}

.empty {
	margin: 0 4px;
	font-size: 13px;
	opacity: 0.75;
}

/* The System One's other picks, small under the models: a hosted one, or none. */
.quiet {
	display: flex;
	gap: 6px;
	margin-top: 2px;
}

.quiet button {
	padding: 3px 12px;
	font-size: 13px;
	font-weight: 700;
	background: transparent;
	border: var(--line-thin) solid var(--ink-soft);
	border-radius: 999px;
}

.quiet button:hover {
	border-color: var(--ink);
}

.quiet button.on {
	background: var(--ink);
	border-color: var(--ink);
	color: var(--parchment);
}

footer {
	display: flex;
	justify-content: flex-end;
	padding-top: 10px;
	border-top: var(--line-thin) solid var(--ink-soft);
}

.elsewhere {
	padding: 4px 6px;
	font-size: 14px;
	font-weight: 700;
	background: none;
	border: 0;
	border-radius: var(--radius-small);
}

.elsewhere:hover {
	text-decoration: underline;
}

@media (prefers-reduced-motion: reduce) {
	.loaded i,
	.refresh.spinning svg {
		animation: none;
	}

	.row.skaldic:hover::after {
		transition: none;
	}
}
</style>
