<script setup lang="ts">
import { inject, watch } from 'vue';
import { type HudModel, type MenuPage } from './hudModel';
import { sessionKey } from './sessionKey';
import {
	MAX_CONTEXT_LENGTH,
	MAX_PARALLEL_THINKERS,
	MIN_CONTEXT_LENGTH,
	MIN_PARALLEL_THINKERS,
	contextLabel,
	nudgeContextLength,
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

const PAGES:{ id:MenuPage; label:string }[] = [
	{ id: 'testing', label: 'Arc Director' },
	{ id: 'game', label: 'Game' },
	{ id: 'display', label: 'Display' },
	{ id: 'audio', label: 'Audio' },
	{ id: 'save', label: 'Save' },
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
	session?.value?.resetLocation();
}

function save():void {
	session?.value?.save();
}

function load():void {
	session?.value?.load();
}

function toggleObserver():void {
	setPrefs({ observer: !props.hud.observer });
}

function toggleArcDirector():void {
	setPrefs({ ai: !props.hud.arcDirectorOn });
}

function setMinimapFollow(follow:boolean):void {
	props.hud.minimap.follow = follow;
}

function toggleDetailMaps():void {
	setPrefs({ detailMaps: !props.hud.detailMaps });
}

function toggleShadows():void {
	setPrefs({ shadows: !props.hud.shadows });
}

function pickModel():void {
	session?.value?.applyModel();
}

function pickCharacter():void {
	session?.value?.applyPlayerKind();
}

function nudgeParallel(delta:number):void {
	session?.value?.setMaxParallel(props.hud.maxParallel + delta);
}

function nudgeContext(delta:number):void {
	session?.value?.setContextLength(nudgeContextLength(props.hud.contextLength, delta));
}

function onRange(ev:Event):number {
	return Number((ev.target as HTMLInputElement).value);
}

function toggleBatchThinks():void {
	setPrefs({ batchThinks: !props.hud.batchThinks });
}

function toggleThinking():void {
	setPrefs({ thinkingBudget: !props.hud.thinkingBudget });
}

function toggleArcText():void {
	setPrefs({ arcText: !props.hud.arcText });
}

function dumpNPCMaps():void {
	void session?.value?.dumpNPCMaps();
}

function resetInferStats():void {
	session?.value?.resetInferStats();
}

function fmtMem(bytes:number):string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return '—';
	}
	if (bytes < 1024 * 1024) {
		return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	}
	const mb = bytes / (1024 * 1024);
	return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
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

function fmtPulse(n:number | null):string {
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
							<div class="page-actions">
								<button type="button" @click.stop="reset">Reset location</button>
							</div>
						</template>
						<template v-else-if="hud.menuPage === 'display'">
							<div class="set">
								<span class="name">Maps</span>
								<button
									type="button"
									class="switch"
									:class="{ on: hud.detailMaps }"
									:aria-pressed="hud.detailMaps"
									@click.stop="toggleDetailMaps"
								>
									{{ hud.detailMaps ? 'On' : 'Off' }}
								</button>
							</div>
							<div class="set">
								<span class="name">Shadows</span>
								<button
									type="button"
									class="switch"
									:class="{ on: hud.shadows }"
									:aria-pressed="hud.shadows"
									@click.stop="toggleShadows"
								>
									{{ hud.shadows ? 'On' : 'Off' }}
								</button>
							</div>
							<div class="set">
								<span class="name">Minimap</span>
								<div class="seg" role="group" aria-label="Minimap">
									<button
										type="button"
										:class="{ on: hud.minimap.follow }"
										:aria-pressed="hud.minimap.follow"
										@click.stop="setMinimapFollow(true)"
									>
										Follow
									</button>
									<button
										type="button"
										:class="{ on: !hud.minimap.follow }"
										:aria-pressed="!hud.minimap.follow"
										@click.stop="setMinimapFollow(false)"
									>
										Chunk
									</button>
								</div>
							</div>
						</template>
						<template v-else-if="hud.menuPage === 'save'">
							<p class="readout">{{ hud.savedUTC ? `Saved ${new Date(hud.savedUTC).toLocaleString()}` : 'No save yet' }}</p>
							<div class="page-actions">
								<button type="button" @click.stop="save">Save</button>
								<button type="button" :disabled="!hud.savedUTC" @click.stop="load">Load</button>
							</div>
						</template>
						<template v-else-if="hud.menuPage === 'audio'">
							<div class="set">
								<span class="name">Mute</span>
								<button
									type="button"
									class="switch"
									:class="{ on: hud.audioMuted }"
									:aria-pressed="hud.audioMuted"
									@click.stop="setPrefs({ muted: !hud.audioMuted })"
								>
									{{ hud.audioMuted ? 'On' : 'Off' }}
								</button>
							</div>
							<label class="set stack" :class="{ dim: hud.audioMuted }">
								<span class="name">
									Music
									<span class="readout">{{ pct(hud.musicVolume) }}%</span>
								</span>
								<input
									:value="hud.musicVolume"
									type="range"
									min="0"
									max="1"
									step="0.01"
									@input="setMusicVolume(onRange($event))"
								>
							</label>
							<label class="set stack" :class="{ dim: hud.audioMuted }">
								<span class="name">
									SFX
									<span class="readout">{{ pct(hud.sfxVolume) }}%</span>
								</span>
								<input
									:value="hud.sfxVolume"
									type="range"
									min="0"
									max="1"
									step="0.01"
									@input="setPrefs({ sfx: onRange($event) })"
								>
							</label>
						</template>
						<template v-else>
							<p v-if="hud.prefsDetached" class="readout">Prefs not saved (MCP)</p>
							<h3>World</h3>
							<div class="set">
								<span class="name">Arc Director</span>
								<button
									type="button"
									class="switch"
									:class="{ on: hud.arcDirectorOn }"
									:aria-pressed="hud.arcDirectorOn"
									@click.stop="toggleArcDirector"
								>
									{{ hud.arcDirectorOn ? 'On' : 'Off' }}
								</button>
							</div>
							<div class="set">
								<span class="name">Observer</span>
								<button
									type="button"
									class="switch"
									:class="{ on: hud.observer }"
									:aria-pressed="hud.observer"
									@click.stop="toggleObserver"
								>
									{{ hud.observer ? 'On' : 'Off' }}
								</button>
							</div>
							<div class="set">
								<span class="name">NPC maps</span>
								<button type="button" class="act" @click.stop="dumpNPCMaps">
									Dump
								</button>
							</div>
							<h3>Inference</h3>
							<label class="set">
								<span class="name">Model</span>
								<select
									v-model="hud.model"
									:disabled="hud.models.length === 0 && !hud.model"
									@mousedown="session?.refreshHudModels()"
									@change.stop="pickModel"
								>
									<option
										v-if="hud.models.length === 0 && !hud.model"
										value=""
										disabled
									>
										No models found
									</option>
									<option
										v-if="hud.model && !hud.models.some((m) => m.id === hud.model)"
										:value="hud.model"
									>
										{{ hud.model }}
									</option>
									<option
										v-for="m in hud.models"
										:key="m.id"
										:value="m.id"
									>
										{{ m.loaded ? `${m.id} · loaded` : m.id }}
									</option>
								</select>
							</label>
							<div class="set">
								<span class="name">Parallel thinkers</span>
								<div class="stepper">
									<button
										type="button"
										:disabled="hud.maxParallel <= MIN_PARALLEL_THINKERS"
										@click.stop="nudgeParallel(-1)"
									>
										−
									</button>
									<span>{{ hud.maxParallel }}</span>
									<button
										type="button"
										:disabled="hud.maxParallel >= MAX_PARALLEL_THINKERS"
										@click.stop="nudgeParallel(1)"
									>
										+
									</button>
								</div>
							</div>
							<div class="set">
								<span class="name">Context window</span>
								<div class="stepper">
									<button
										type="button"
										:disabled="hud.contextLength <= MIN_CONTEXT_LENGTH"
										@click.stop="nudgeContext(-1)"
									>
										−
									</button>
									<span>{{ contextLabel(hud.contextLength) }}</span>
									<button
										type="button"
										:disabled="hud.contextLength >= MAX_CONTEXT_LENGTH"
										@click.stop="nudgeContext(1)"
									>
										+
									</button>
								</div>
							</div>
							<div class="set">
								<span class="name">Wait for idle</span>
								<button
									type="button"
									class="switch"
									:class="{ on: hud.batchThinks }"
									:aria-pressed="hud.batchThinks"
									@click.stop="toggleBatchThinks"
								>
									{{ hud.batchThinks ? 'On' : 'Off' }}
								</button>
							</div>
							<div class="set">
								<span class="name">Thinking</span>
								<button
									type="button"
									class="switch"
									:class="{ on: hud.thinkingBudget }"
									:aria-pressed="hud.thinkingBudget"
									@click.stop="toggleThinking"
								>
									{{ hud.thinkingBudget ? 'On' : 'Off' }}
								</button>
							</div>
							<div class="set">
								<span class="name">Arc text</span>
								<button
									type="button"
									class="switch"
									:class="{ on: hud.arcText }"
									:aria-pressed="hud.arcText"
									@click.stop="toggleArcText"
								>
									{{ hud.arcText ? 'On' : 'Off' }}
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
										<td>{{ fmtMs(hud.inferLastContextMs) }}</td>
										<td>{{ fmtMs(avg(hud.inferContextMs, hud.inferContextKnown)) }}</td>
										<td>{{ fmtMs(hud.inferContextKnown > 0 ? hud.inferContextMs : null) }}</td>
									</tr>
									<tr>
										<td>Thinking</td>
										<td>{{ fmtMs(hud.inferLastGenerateMs) }}</td>
										<td>{{ fmtMs(avg(hud.inferGenerateMs, hud.inferCalls)) }}</td>
										<td>{{ fmtMs(hud.inferCalls > 0 ? hud.inferGenerateMs : null) }}</td>
									</tr>
									<tr>
										<td>Round trip</td>
										<td>{{ fmtMs(hud.inferLastWallMs) }}</td>
										<td>{{ fmtMs(avg(hud.inferWallMs, hud.inferCalls)) }}</td>
										<td>{{ fmtMs(hud.inferCalls > 0 ? hud.inferWallMs : null) }}</td>
									</tr>
								</tbody>
							</table>
							<div class="stats-foot">
								<span>Graphics memory {{ fmtMem(hud.graphicsMemory) }}</span>
								<span>{{ hud.inferCalls }} call{{ hud.inferCalls === 1 ? '' : 's' }}</span>
								<button type="button" class="act" @click.stop="resetInferStats">Reset</button>
							</div>
							<table v-if="hud.heartrates.length" class="stats">
								<thead>
									<tr>
										<th>Heartrate</th>
										<th>Pulse</th>
										<th>Ago</th>
										<th>Think</th>
									</tr>
								</thead>
								<tbody>
									<tr v-for="row in hud.heartrates" :key="row.id">
										<td>{{ row.id }}</td>
										<td>{{ fmtPulse(row.pulse) }}</td>
										<td>{{ row.thinking ? 'thinking' : fmtAgo(row.ago) }}</td>
										<td>{{ fmtMs(row.thinkMs || null) }}</td>
									</tr>
								</tbody>
							</table>
						</template>
					</div>
				</div>
				<p v-if="hud.menuNotice" class="notice">{{ hud.menuNotice }}</p>
			</div>
		</div>
	</div>
</template>

<style scoped>
.hud-menu-root {
	--ink: #1a1208;
	--parchment: #d4c4a0;
	--cream: #f0e6c8;
	--highlight: #fff6dc;
	--rule: #c4b490;
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.hud-menu-btn {
	position: absolute;
	top: 16px;
	right: 16px;
	pointer-events: auto;
	font-family: ui-monospace, "Cascadia Code", monospace;
	font-size: 14px;
	letter-spacing: 0.1em;
	color: var(--ink);
	background: var(--parchment);
	border: 0;
	padding: 6px 12px;
	cursor: pointer;
	box-shadow: 0 2px 0 var(--ink), 0 4px 12px rgba(0, 0, 0, 0.35);
	z-index: 3;
}

.hud-menu-btn:hover {
	background: var(--cream);
}

.hud-menu-dim {
	position: absolute;
	inset: 0;
	pointer-events: auto;
	background: rgba(8, 6, 4, 0.62);
	cursor: default;
	display: flex;
	align-items: center;
	justify-content: center;
}

.hud-menu-panel {
	width: min(720px, 92vw);
	height: min(520px, 80vh);
	display: flex;
	flex-direction: column;
	background: var(--parchment);
	color: var(--ink);
	font-family: ui-monospace, "Cascadia Code", monospace;
	box-shadow: 0 2px 0 var(--ink), 0 16px 40px rgba(0, 0, 0, 0.45);
}

.head {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 12px 16px;
	border-bottom: 1px solid var(--rule);
}

h2 {
	margin: 0;
	font-size: 15px;
	font-weight: 700;
	letter-spacing: 0.18em;
	text-transform: uppercase;
}

.resume,
.page-actions button,
.act,
.rail button {
	font: inherit;
	color: var(--ink);
	background: var(--cream);
	border: 0;
	cursor: pointer;
	box-shadow: 0 2px 0 var(--ink);
}

.resume {
	font-size: 13px;
	padding: 6px 12px;
}

.resume:hover,
.page-actions button:hover,
.act:hover,
.rail button:hover:not(.on) {
	background: var(--highlight);
}

.body {
	flex: 1 1 auto;
	min-height: 0;
	display: flex;
}

.rail {
	flex: 0 0 168px;
	width: 168px;
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 8px;
	border-right: 1px solid var(--rule);
}

.rail button {
	text-align: left;
	font-size: 12px;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	padding: 9px 12px;
}

.rail button.on {
	background: var(--highlight);
	box-shadow: inset 0 0 0 2px var(--ink), 0 2px 0 var(--ink);
}

.rail .scenes {
	margin-top: auto;
}

.page {
	flex: 1 1 auto;
	min-width: 0;
	overflow: auto;
	padding: 8px 18px 16px;
}

h3 {
	margin: 14px 0 4px;
	font-size: 11px;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	opacity: 0.7;
	font-weight: 700;
}

h3:first-child {
	margin-top: 8px;
}

.set {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	min-height: 44px;
	padding: 6px 0;
	border-bottom: 1px solid var(--rule);
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
	font-size: 13px;
	letter-spacing: 0.06em;
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
}

.readout {
	opacity: 0.7;
	font-size: 12px;
	font-variant-numeric: tabular-nums;
	letter-spacing: 0.04em;
}

.set select {
	font: inherit;
	font-size: 13px;
	color: var(--ink);
	background: var(--cream);
	border: 0;
	padding: 6px 10px;
	max-width: min(280px, 58%);
	box-shadow: inset 0 0 0 2px var(--ink);
}

.set.stack select {
	max-width: none;
	width: 100%;
}

.set select {
	cursor: pointer;
}

.set select:disabled {
	opacity: 0.7;
	cursor: default;
}

.set input[type="range"] {
	width: 100%;
	height: 8px;
	margin: 2px 0 4px;
	padding: 0;
	cursor: pointer;
	accent-color: var(--ink);
	background: var(--rule);
	box-shadow: inset 0 0 0 1px var(--ink);
	-webkit-appearance: none;
	appearance: none;
}

.set input[type="range"]::-webkit-slider-thumb {
	-webkit-appearance: none;
	width: 14px;
	height: 18px;
	background: var(--ink);
	border: 0;
	cursor: pointer;
}

.set input[type="range"]::-moz-range-thumb {
	width: 14px;
	height: 18px;
	background: var(--ink);
	border: 0;
	border-radius: 0;
	cursor: pointer;
}

.switch {
	flex: 0 0 56px;
	width: 56px;
	height: 22px;
	padding: 0;
	font: inherit;
	font-size: 10px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--ink);
	background: var(--rule);
	border: 0;
	cursor: pointer;
	box-shadow: inset 0 0 0 2px var(--ink);
}

.switch.on {
	color: var(--cream);
	background: var(--ink);
}

.seg,
.stepper {
	display: flex;
	align-items: stretch;
}

.seg button,
.stepper button,
.act {
	font: inherit;
	font-size: 12px;
	color: var(--ink);
	background: var(--cream);
	border: 0;
	padding: 5px 10px;
	cursor: pointer;
	box-shadow: inset 0 0 0 2px var(--ink);
}

.seg button.on {
	background: var(--ink);
	color: var(--cream);
}

.stepper span {
	min-width: 3.2em;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 13px;
	font-variant-numeric: tabular-nums;
	background: var(--cream);
	box-shadow: inset 0 0 0 2px var(--ink);
}

.stepper button:disabled {
	opacity: 0.45;
	cursor: default;
}

.page-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 14px;
}

.page-actions button {
	font-size: 13px;
	padding: 6px 12px;
}

.stats {
	width: 100%;
	margin: 8px 0 10px;
	border-collapse: collapse;
	font-size: 12px;
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
	font-size: 11px;
	opacity: 0.7;
	font-weight: 500;
}

.stats-foot {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	font-size: 12px;
	opacity: 0.85;
}

.notice {
	flex: 0 0 auto;
	margin: 0;
	padding: 8px 16px 12px;
	font-size: 12px;
	border-top: 1px solid var(--rule);
}

@media (max-width: 560px) {
	.hud-menu-panel {
		height: min(80vh, 640px);
	}

	.body {
		flex-direction: column;
	}

	.rail {
		flex: 0 0 auto;
		width: 100%;
		flex-direction: row;
		flex-wrap: wrap;
		border-right: 0;
		border-bottom: 1px solid var(--rule);
	}

	.rail .scenes {
		margin-top: 0;
		margin-left: auto;
	}

	.set select {
		max-width: min(220px, 55%);
	}
}
</style>
