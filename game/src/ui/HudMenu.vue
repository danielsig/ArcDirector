<script setup lang="ts">
import { inject, ref, watch } from 'vue';
import { fmtMem, type HudModel, type MenuPage } from './hud-model';
import { sessionKey } from './session-key';
import HudBench from './HudBench.vue';
import HudDialog from './HudDialog.vue';
import HudSwitch from './HudSwitch.vue';
import InferencePicker from './InferencePicker.vue';
import MindMenu from './MindMenu.vue';
import { usePref, usePrefs } from './use-prefs';
import { inferenceSetup } from '../director/inference';
import {
	MAX_CONTEXT_LENGTH,
	MAX_PARALLEL_THINKERS,
	MIN_CONTEXT_LENGTH,
	MIN_PARALLEL_THINKERS,
	contextLabel,
	nudgeContextLength,
	nudgeThinkingBudget,
	thinkingLabel,
	THINKING_BUDGETS,
	setMusicMuted,
	setMusicVolume,
	setPrefs,
} from '../prefs';

const props = defineProps<{
	hud:HudModel;
}>();

const emit = defineEmits<{
	scenes: [];
}>();

const session = inject(sessionKey);
const live = usePrefs();
const player = usePref('player');
const shadows = usePref('shadows');
const arcFormat = usePref('arcFormat');

/** Where NPCs think, picked over the menu at the init screen's size. */
const pickerOpen = ref(false);
/** The temperature while its slider is held: it applies on release, since a change re-adds the models. */
const temperatureDraft = ref<number | null>(null);

const PAGES:{ id:MenuPage; label:string }[] = [
	{ id: 'testing', label: 'Arc Director' },
	{ id: 'game', label: 'Game' },
	{ id: 'display', label: 'Display' },
	{ id: 'audio', label: 'Audio' },
];

watch(
	() => props.hud.menuOpen,
	(open, was) => {
		if (open && !was) {
			session?.value?.onMenuOpened();
		}
		else if (!open && was) {
			session?.value?.onMenuClosed();
		}
	},
);

function toggle():void {
	props.hud.menuOpen = !props.hud.menuOpen;
}

function resume():void {
	props.hud.menuOpen = false;
}

function go(page:MenuPage):void {
	props.hud.menuPage = page;
}

function reset():void {
	session?.value?.pose.reset();
	props.hud.menuNotice = 'Location reset';
}

function save():void {
	session?.value?.slot.save();
}

function load():void {
	session?.value?.reboot('save');
}

function setMinimapFollow(follow:boolean):void {
	props.hud.minimapFollow = follow;
}

/** What shows of minds at work, each with its own switch. */
const MIND_VISUALS = [
	{ key: 'arcSlates', name: 'Arc code' },
	{ key: 'orderArcs', name: 'Order arcs' },
	{ key: 'toolIcons', name: 'Tool icons' },
	{ key: 'toolPoses', name: 'Tool animations' },
	{ key: 'toolFx', name: 'Tool effects' },
] as const;

function pickCharacter():void {
	session?.value?.applyPlayerKind();
}

function nudgeParallel(delta:number):void {
	const next = setPrefs({ maxParallel: live.maxParallel + delta }).maxParallel;
	props.hud.menuNotice = `${next} thinker${next === 1 ? '' : 's'}`;
}

function nudgeContext(delta:number):void {
	props.hud.menuNotice = `${contextLabel(setPrefs({ contextLength: nudgeContextLength(live.contextLength, delta) }).contextLength)} context`;
}

function onRange(ev:Event):number {
	return Number((ev.target as HTMLInputElement).value);
}

/** Music volume as the slider gesture began: what music comes back at after the slider turns it off at zero. */
let musicBefore = 0;

function holdMusicVolume():void {
	if (!live.musicMuted) {
		musicBefore = live.music;
	}
}

function nudgeThinking(delta:number):void {
	setPrefs({ thinkingBudget: nudgeThinkingBudget(live.thinkingBudget, delta) });
}

function dumpNPCMaps():void {
	void session?.value?.dumpNPCMaps();
}

function resetInferStats():void {
	session?.value?.resetInferStats();
}

function fmtMs(ms:number | null):string {
	if (ms === null || !Number.isFinite(ms)) {
		return '—';
	}
	if (ms < 1000) {
		return `${Math.round(ms)} ms`;
	}
	if (ms < 10_000) {
		return `${(ms / 1000).toFixed(1)} s`;
	}
	return `${Math.round(ms / 1000)} s`;
}

function avg(sum:number, n:number):number | null {
	if (n <= 0) {
		return null;
	}
	return sum / n;
}

function fmtSec(n:number):string {
	if (!Number.isFinite(n)) {
		return '—';
	}
	if (n < 10) {
		return `${n.toFixed(1)}s`;
	}
	return `${Math.round(n)}s`;
}

function fmtRethink(n:number | null):string {
	return n === null ? 'off' : fmtSec(n);
}

function fmtAgo(n:number | null):string {
	return n === null ? '—' : fmtSec(n);
}

function pct(n:number):string {
	if (!Number.isFinite(n)) {
		return '0';
	}
	return String(Math.round(Math.max(0, Math.min(1, n)) * 100));
}
</script>

<template>
	<div class="hud-menu-root">
		<button
			type="button"
			class="hud-menu-btn"
			:aria-label="hud.menuOpen ? 'Close menu' : 'Open menu'"
			@click.stop="toggle"
		>
			Menu
		</button>
		<div
			v-if="hud.menuOpen"
			class="hud-menu-dim"
			@click.stop="resume"
		>
			<div
				class="hud-menu-panel"
				role="dialog"
				aria-label="Paused"
				@click.stop
			>
				<header class="head">
					<h2>Paused</h2>
					<button type="button" class="resume" @click.stop="resume">Resume</button>
				</header>
				<div class="body">
					<nav class="rail" aria-label="Menu pages">
						<button
							v-for="page in PAGES"
							:key="page.id"
							type="button"
							:class="{ on: hud.menuPage === page.id }"
							@click.stop="go(page.id)"
						>
							{{ page.label }}
						</button>
						<button
							type="button"
							class="scenes"
							@click.stop="emit('scenes')"
						>
							Main Menu
						</button>
					</nav>
					<div class="page">
						<template v-if="hud.menuPage === 'game'">
							<label class="set">
								<span class="name">Character</span>
								<select
									v-model="hud.playerKind"
									:disabled="hud.playerKinds.length === 0"
									@change.stop="pickCharacter"
								>
									<option
										v-if="hud.playerKind && !hud.playerKinds.some((c) => c.id === hud.playerKind)"
										:value="hud.playerKind"
									>
										{{ hud.playerKind }}
									</option>
									<option
										v-for="c in hud.playerKinds"
										:key="c.id"
										:value="c.id"
									>
										{{ c.label }}
									</option>
								</select>
							</label>
							<label class="set">
								<span class="name">Player</span>
								<select
									v-model="player"
									title="Participant: NPCs notice you. Observer: they never do. Camera: no body at all, for screenshots. V cycles them in play"
								>
									<option value="participant">Participant</option>
									<option value="observer">Observer</option>
									<option value="camera">Camera</option>
								</select>
							</label>
							<div class="page-actions">
								<button type="button" @click.stop="reset">Reset location</button>
							</div>
							<h3>Save</h3>
							<p class="readout">{{ hud.savedUTC ? `Saved ${new Date(hud.savedUTC).toLocaleString()}` : 'No save yet' }}</p>
							<div class="page-actions">
								<button type="button" @click.stop="save">Save</button>
								<button type="button" :disabled="!hud.savedUTC" @click.stop="load">Load</button>
							</div>
						</template>
						<template v-else-if="hud.menuPage === 'display'">
							<div class="set">
								<span class="name">Maps</span>
								<HudSwitch :on="live.detailMaps" @toggle="setPrefs({ detailMaps: !live.detailMaps })" />
							</div>
							<label class="set">
								<span class="name">Shadows</span>
								<select
									v-model="shadows"
									title="Auto: picked from your graphics card, as the model suggestion is (never Off). Simple: baked scene shadows, soft capsules for characters. Low and High: realtime."
								>
									<option value="auto">Auto</option>
									<option value="off">Off</option>
									<option value="simple">Simple</option>
									<option value="low">Low quality</option>
									<option value="high">High quality</option>
								</select>
							</label>
							<div class="set">
								<span class="name">FPS counter</span>
								<HudSwitch :on="live.fpsCounter" @toggle="setPrefs({ fpsCounter: !live.fpsCounter })" />
							</div>
							<div class="set">
								<span class="name">Minimap</span>
								<div class="seg" role="group" aria-label="Minimap">
									<button
										type="button"
										:class="{ on: hud.minimapFollow }"
										:aria-pressed="hud.minimapFollow"
										@click.stop="setMinimapFollow(true)"
									>
										Follow
									</button>
									<button
										type="button"
										:class="{ on: !hud.minimapFollow }"
										:aria-pressed="!hud.minimapFollow"
										@click.stop="setMinimapFollow(false)"
									>
										Chunk
									</button>
								</div>
							</div>
							<h3>Minds at work</h3>
							<div class="set">
								<span class="name">Thinking bubbles</span>
								<HudSwitch :on="live.thinkingBubbles" @toggle="setPrefs({ thinkingBubbles: !live.thinkingBubbles })" />
								</div>
								<div class="set">
									<span class="name">Character tooltips</span>
									<HudSwitch :on="live.characterTooltips" @toggle="setPrefs({ characterTooltips: !live.characterTooltips })" />
							</div>
							<div class="set">
								<span class="name">Show all</span>
								<HudSwitch :on="live.mindVisuals" @toggle="setPrefs({ mindVisuals: !live.mindVisuals })" />
							</div>
							<div v-for="visual in MIND_VISUALS" :key="visual.key" class="set" :class="{ dim: !live.mindVisuals }">
								<span class="name">{{ visual.name }}</span>
								<HudSwitch :on="live[visual.key]" @toggle="setPrefs({ [visual.key]: !live[visual.key] })" />
							</div>
						</template>
						<template v-else-if="hud.menuPage === 'audio'">
							<div class="set">
								<span class="name">Mute</span>
								<HudSwitch :on="live.muted" @toggle="setPrefs({ muted: !live.muted })" />
							</div>
							<div class="set" :class="{ dim: live.muted }">
								<span class="name">Music</span>
								<HudSwitch :on="!live.musicMuted" @toggle="setMusicMuted(!live.musicMuted)" />
							</div>
							<label class="set stack" :class="{ dim: live.muted || live.musicMuted }">
								<span class="name">
									Music volume
									<span class="readout">{{ pct(live.musicMuted ? 0 : live.music) }}%</span>
								</span>
								<input
									:value="live.musicMuted ? 0 : live.music"
									type="range"
									min="0"
									max="1"
									step="0.01"
									@pointerdown="holdMusicVolume"
									@focus="holdMusicVolume"
									@input="setMusicVolume(onRange($event), musicBefore)"
								>
							</label>
							<label class="set stack" :class="{ dim: live.muted }">
								<span class="name">
									SFX
									<span class="readout">{{ pct(live.sfx) }}%</span>
								</span>
								<input
									:value="live.sfx"
									type="range"
									min="0"
									max="1"
									step="0.01"
									@input="setPrefs({ sfx: onRange($event) })"
								>
							</label>
							<div class="set" :class="{ dim: live.muted }">
								<span class="name">Voices</span>
								<HudSwitch :on="live.voices" @toggle="setPrefs({ voices: !live.voices })" />
							</div>
						</template>
						<template v-else>
							<p v-if="live.detached" class="readout">Prefs not saved (MCP)</p>
							<h3>World</h3>
							<div class="set">
								<span class="name">Arc Director</span>
								<HudSwitch :on="live.ai" @toggle="setPrefs({ ai: !live.ai })" />
							</div>
							<h3>Thinking</h3>
							<MindMenu :active="hud.activeModel" @change="pickerOpen = true" />
							<div class="set">
								<span class="name">Context window</span>
								<div class="stepper">
									<button
										type="button"
										:disabled="live.contextLength <= MIN_CONTEXT_LENGTH"
										@click.stop="nudgeContext(-1)"
									>
										−
									</button>
									<span>{{ contextLabel(live.contextLength) }}</span>
									<button
										type="button"
										:disabled="live.contextLength >= MAX_CONTEXT_LENGTH"
										@click.stop="nudgeContext(1)"
									>
										+
									</button>
								</div>
							</div>
							<label class="set stack">
								<span class="name" title="How freely NPCs pick each word. 0 always takes the likeliest, which can repeat a thought forever. Gemma is made for 1 and Qwen for 0.6; past 1, replies get wild.">
									Temperature
									<span class="readout">{{ (temperatureDraft ?? live.temperature).toFixed(2) }}</span>
								</span>
								<input
									:value="temperatureDraft ?? live.temperature"
									type="range"
									min="0"
									max="2"
									step="0.05"
									@input="temperatureDraft = onRange($event)"
									@change="setPrefs({ temperature: onRange($event) }); temperatureDraft = null"
								>
							</label>
							<div class="set">
								<span class="name" title="How many tokens an NPC may think before it must answer from what it thought">Thinking budget</span>
								<div class="stepper">
									<button
										type="button"
										:disabled="live.thinkingBudget === THINKING_BUDGETS[0]"
										@click.stop="nudgeThinking(-1)"
									>
										−
									</button>
									<span>{{ thinkingLabel(live.thinkingBudget) }}</span>
									<button
										type="button"
										:disabled="live.thinkingBudget === THINKING_BUDGETS[THINKING_BUDGETS.length - 1]"
										@click.stop="nudgeThinking(1)"
									>
										+
									</button>
								</div>
							</div>
							<p v-if="inferenceSetup.inference === 'lmstudio' && live.thinkingBudget !== 0" class="tip">
								Set LM Studio's own <i>Reasoning Budget</i> too (the model's settings, <i>Inference</i>), so thoughts end on their own instead of being cut off.
							</p>
							<label class="set">
								<span class="name">Arc format</span>
								<select
									v-model="arcFormat"
									title="How NPCs write their Arc: text, JSON, or JSON the server must follow (schema)"
								>
									<option value="text">Text</option>
									<option value="json">JSON</option>
									<option value="schema">Schema</option>
								</select>
							</label>
							<p v-if="live.arcFormat !== 'schema'" class="tip">
								&ldquo;Schema&rdquo; is the recommended Arc format. It keeps NPCs from writing plans the game can't read, so they don't waste time correcting their mistakes.
							</p>
							<h3>Scheduling</h3>
							<div class="set">
								<span class="name">Parallel thinkers</span>
								<div class="stepper">
									<button
										type="button"
										:disabled="live.maxParallel <= MIN_PARALLEL_THINKERS"
										@click.stop="nudgeParallel(-1)"
									>
										−
									</button>
									<span>{{ live.maxParallel }}</span>
									<button
										type="button"
										:disabled="live.maxParallel >= MAX_PARALLEL_THINKERS[inferenceSetup.inference]"
										@click.stop="nudgeParallel(1)"
									>
										+
									</button>
								</div>
							</div>
							<div class="set" :class="{ dim: live.maxParallel <= 1 }">
								<span class="name" :title="live.maxParallel <= 1 ? 'Only matters with more than one parallel thinker' : 'Start NPCs’ thinks together once the model is free'">Wait for idle</span>
								<HudSwitch :on="live.batchThinks" :disabled="live.maxParallel <= 1" @toggle="setPrefs({ batchThinks: !live.batchThinks })" />
							</div>
							<p v-if="!live.batchThinks && live.maxParallel > 1" class="tip">
								We recommend keeping this on. When it's off, NPCs pause their thinking every time a new NPC starts thinking.
							</p>
							<h3>Benchmarks</h3>
							<div class="set">
								<span class="name">ArcDirector Bench</span>
								<button type="button" class="act" @click.stop="hud.bench = 'arc'">
									Open
								</button>
							</div>
							<div class="set">
								<span class="name">ArcSelector Bench</span>
								<button type="button" class="act" @click.stop="hud.bench = 'decision'">
									Open
								</button>
							</div>
							<h3>Stats</h3>
							<table class="stats">
								<thead>
									<tr>
										<th></th>
										<th>Last</th>
										<th>Avg</th>
										<th>Total</th>
									</tr>
								</thead>
								<tbody>
									<tr>
										<td>Context load</td>
										<td>{{ fmtMs(hud.infer.lastContextMs) }}</td>
										<td>{{ fmtMs(avg(hud.infer.contextMs, hud.infer.contextKnown)) }}</td>
										<td>{{ fmtMs(hud.infer.contextKnown > 0 ? hud.infer.contextMs : null) }}</td>
									</tr>
									<tr>
										<td>Thinking</td>
										<td>{{ fmtMs(hud.infer.lastGenerateMs) }}</td>
										<td>{{ fmtMs(avg(hud.infer.generateMs, hud.infer.calls)) }}</td>
										<td>{{ fmtMs(hud.infer.calls > 0 ? hud.infer.generateMs : null) }}</td>
									</tr>
									<tr>
										<td>Round trip</td>
										<td>{{ fmtMs(hud.infer.lastWallMs) }}</td>
										<td>{{ fmtMs(avg(hud.infer.wallMs, hud.infer.calls)) }}</td>
										<td>{{ fmtMs(hud.infer.calls > 0 ? hud.infer.wallMs : null) }}</td>
									</tr>
								</tbody>
							</table>
							<div class="stats-foot">
								<span>Graphics memory {{ fmtMem(hud.renderStats.framebufferMemory + hud.renderStats.sceneMemory) }}</span>
								<span>{{ hud.infer.calls }} call{{ hud.infer.calls === 1 ? '' : 's' }}</span>
								<button type="button" class="act" @click.stop="resetInferStats">Reset</button>
							</div>
							<table v-if="hud.mindStats.length" class="stats">
								<thead>
									<tr>
										<th>Mind</th>
										<th>Rethink</th>
										<th>Ago</th>
										<th>Think</th>
									</tr>
								</thead>
								<tbody>
									<tr v-for="row in hud.mindStats" :key="row.id">
										<td>{{ row.id }}</td>
										<td>{{ fmtRethink(row.rethink) }}</td>
										<td>{{ row.thinking ? 'thinking' : fmtAgo(row.ago) }}</td>
										<td>{{ fmtMs(row.thinkMs || null) }}</td>
									</tr>
								</tbody>
							</table>
							<h3>Debug</h3>
							<div class="set">
								<span class="name">NPC maps</span>
								<button type="button" class="act" @click.stop="dumpNPCMaps">
									Dump
								</button>
							</div>
						</template>
					</div>
				</div>
				<p v-if="hud.menuNotice" class="notice">{{ hud.menuNotice }}</p>
			</div>
			<HudBench v-if="hud.bench" :hud="hud" :kind="hud.bench" />
			<HudDialog :open="pickerOpen" title="Where should NPCs think?" close-label="Done" @close="pickerOpen = false">
				<InferencePicker @chosen="pickerOpen = false" />
			</HudDialog>
		</div>
	</div>
</template>

<style scoped>
/*
 * One parchment panel, plain text tabs, gold for the page you are on (NOTES.md › Pause menu,
 * mockup-calm-menu.jpg). Switches are knobs, choices are outlined segments, sliders have a gold thumb.
 */
.hud-menu-root {
	z-index: var(--z-menu);
	position: absolute;
	inset: 0;
	pointer-events: none;
	font-family: var(--font);
	color: var(--ink);
}

button,
select {
	font: inherit;
	color: inherit;
	cursor: pointer;
}

button:disabled,
select:disabled {
	opacity: 0.5;
	cursor: default;
}

button:focus-visible,
select:focus-visible,
input:focus-visible {
	outline: var(--line-thin) solid var(--gold-deep);
	outline-offset: 2px;
}

/* The top-right Menu button: the same fill and outline as the hotbar slots. */
.hud-menu-btn {
	position: absolute;
	top: 14px;
	right: 14px;
	z-index: 3;
	/* Fixed, so the buttons left of it (HudGuide, HudQuick) can line up beside it. */
	width: 112px;
	height: var(--btn);
	padding: 0;
	pointer-events: auto;
	font-size: 24px;
	font-weight: 700;
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-radius: var(--radius);
	box-shadow: var(--shadow);
	transition: transform var(--quick) var(--ease-out);
}

.hud-menu-btn:hover {
	transform: translateY(-1px);
}

.hud-menu-btn:active {
	transform: translateY(2px);
	box-shadow: none;
}

.hud-menu-dim {
	position: absolute;
	inset: 0;
	pointer-events: auto;
	cursor: default;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--backdrop);
}

.hud-menu-panel {
	width: min(760px, 92vw);
	height: min(540px, 82vh);
	display: flex;
	flex-direction: column;
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-radius: var(--radius-panel);
	box-shadow: var(--shadow-panel);
	animation: rise var(--slow) var(--ease-pop);
}

@keyframes rise {
	from {
		opacity: 0;
		transform: translateY(12px) scale(0.97);
	}
}

.head {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 22px 28px 10px 36px;
}

h2 {
	margin: 0;
	font-size: 30px;
	font-weight: 700;
}

/* Outlined buttons: Resume, Main Menu, and the actions inside pages. */
.resume,
.rail .scenes,
.page-actions button,
.act {
	padding: 6px 18px;
	font-size: 16px;
	font-weight: 700;
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: var(--radius-small);
	box-shadow: var(--shadow);
}

.resume:hover:not(:disabled),
.rail .scenes:hover,
.page-actions button:hover:not(:disabled),
.act:hover {
	background: var(--parchment-deep);
}

.act {
	padding: 4px 14px;
	font-size: 14px;
}

.body {
	flex: 1 1 auto;
	min-height: 0;
	display: flex;
	padding: 0 24px 20px;
}

.rail {
	flex: 0 0 200px;
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 8px 16px 4px 0;
}

/* Plain text tabs; the open page is a gold pad. */
.rail button:not(.scenes) {
	text-align: left;
	padding: 8px 12px;
	font-size: 21px;
	font-weight: 700;
	background: none;
	border: 0;
	border-radius: var(--radius-small);
	transition: background var(--quick) var(--ease-out);
}

.rail button:not(.scenes):hover {
	background: var(--ink-soft);
}

.rail button.on,
.rail button.on:hover {
	background: var(--gold);
}

.rail .scenes {
	margin-top: auto;
	align-self: flex-start;
}

.page {
	flex: 1 1 auto;
	min-width: 0;
	overflow: auto;
	padding: 4px 22px 12px;
	border-left: var(--line-thin) solid var(--ink-soft);
	border-top: var(--line-thin) solid var(--ink-soft);
	border-top-left-radius: var(--radius);
}

h3 {
	margin: 18px 0 2px;
	font-size: 13px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	opacity: 0.65;
}

h3:first-child {
	margin-top: 10px;
}

.set {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	min-height: 52px;
	padding: 6px 0;
	border-bottom: 1px solid var(--ink-soft);
}

.set.stack {
	flex-direction: column;
	align-items: stretch;
	gap: 8px;
	padding: 10px 0;
}

.set.dim {
	opacity: 0.45;
}

.name {
	font-size: 17px;
	font-weight: 700;
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
}

.readout {
	opacity: 0.7;
	font-size: 14px;
	font-weight: 400;
	font-variant-numeric: tabular-nums;
}

.set select {
	max-width: min(280px, 58%);
	padding: 6px 10px;
	font-size: 15px;
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: var(--radius-small);
}

.set.stack select {
	max-width: none;
	width: 100%;
}

/* Slider: a thin ink track, a gold thumb outlined in ink. */
.set input[type="range"] {
	width: 100%;
	height: 6px;
	margin: 6px 0;
	padding: 0;
	cursor: pointer;
	background: var(--ink);
	border-radius: 3px;
	-webkit-appearance: none;
	appearance: none;
}

.set input[type="range"]::-webkit-slider-thumb {
	-webkit-appearance: none;
	width: 16px;
	height: 26px;
	background: var(--gold);
	border: var(--line-thin) solid var(--ink);
	border-radius: 6px;
	cursor: pointer;
}

.set input[type="range"]::-moz-range-thumb {
	width: 12px;
	height: 22px;
	background: var(--gold);
	border: var(--line-thin) solid var(--ink);
	border-radius: 6px;
	cursor: pointer;
}

/* Segments and steppers: one outlined strip; the picked segment is gold. */
.seg,
.stepper {
	display: flex;
	align-items: stretch;
	border: var(--line-thin) solid var(--ink);
	border-radius: var(--radius-small);
	overflow: hidden;
}

.seg button,
.stepper button {
	min-width: 40px;
	padding: 5px 14px;
	font-size: 15px;
	font-weight: 700;
	background: var(--parchment);
	border: 0;
}

.seg button + button,
.stepper span + button {
	border-left: var(--line-thin) solid var(--ink);
}

.stepper button:first-child {
	border-right: var(--line-thin) solid var(--ink);
}

.seg button.on {
	background: var(--gold);
}

.seg button:hover:not(.on):not(:disabled),
.stepper button:hover:not(:disabled) {
	background: var(--parchment-deep);
}

.stepper span {
	min-width: 3.4em;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 15px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
}

.set:has(+ .tip) {
	border-bottom: 0;
}

/* Advice under a row: small, and part of it. */
.tip {
	margin: -2px 0 0;
	padding: 0 0 10px;
	font-size: 13px;
	line-height: 1.35;
	opacity: 0.75;
	border-bottom: 1px solid var(--ink-soft);
}

.page-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	margin-top: 14px;
}

.stats {
	width: 100%;
	margin: 8px 0 10px;
	border-collapse: collapse;
	font-size: 14px;
}

.stats th,
.stats td {
	text-align: left;
	padding: 4px 0;
}

.stats th:not(:first-child),
.stats td:not(:first-child) {
	text-align: right;
	font-variant-numeric: tabular-nums;
}

.stats th {
	font-size: 12px;
	font-weight: 700;
	opacity: 0.65;
}

.stats-foot {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	font-size: 14px;
}

.notice {
	flex: 0 0 auto;
	margin: 0;
	padding: 8px 36px 14px;
	font-size: 14px;
	border-top: 1px solid var(--ink-soft);
}

@media (max-width: 560px) {
	.hud-menu-panel {
		height: min(84vh, 640px);
	}

	.head {
		padding: 16px 16px 8px 20px;
	}

	.body {
		flex-direction: column;
		padding: 0 12px 12px;
	}

	.rail {
		flex: 0 0 auto;
		flex-direction: row;
		flex-wrap: wrap;
		padding: 0 0 8px;
	}

	.rail button:not(.scenes) {
		font-size: 16px;
		padding: 6px 10px;
	}

	.rail .scenes {
		margin: 0 0 0 auto;
		align-self: center;
	}

	.page {
		border-left: 0;
		border-top-left-radius: 0;
		padding: 4px 4px 12px;
	}

	.set select {
		max-width: min(220px, 55%);
	}
}
</style>
