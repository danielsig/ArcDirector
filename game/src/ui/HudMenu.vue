<script setup lang="ts">
import { inject, watch } from 'vue';
import { type HudModel } from './hudModel';
import { sessionKey } from './sessionKey';
import {
	MAX_PARALLEL_THINKERS,
	MAX_THINKING_BUDGET,
	MIN_PARALLEL_THINKERS,
	MIN_THINKING_BUDGET,
	setPrefs,
} from '../prefs';

const props = defineProps<{
	hud:HudModel;
}>();

const emit = defineEmits<{
	scenes: [];
}>();

const session = inject(sessionKey);

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

function reset():void {
	session?.value?.resetLocation();
}

function toggleObserver():void {
	props.hud.observer = !props.hud.observer;
}

function toggleArcDirector():void {
	props.hud.arcDirectorOn = !props.hud.arcDirectorOn;
}

function toggleMinimapFollow():void {
	props.hud.minimap.follow = !props.hud.minimap.follow;
}

function toggleDetailMaps():void {
	const on = !props.hud.detailMaps;
	props.hud.detailMaps = on;
	setPrefs({ detailMaps: on });
}

function toggleShadows():void {
	const on = !props.hud.shadows;
	props.hud.shadows = on;
	setPrefs({ shadows: on });
}

function pickModel():void {
	session?.value?.applyModel();
}

function pickCharacter():void {
	session?.value?.applyPlayerKind();
}

function pickThinkers():void {
	session?.value?.applyMaxParallel();
}

function toggleBatchThinks():void {
	props.hud.batchThinks = !props.hud.batchThinks;
}

function dumpNPCMaps():void {
	void session?.value?.dumpNPCMaps();
}

function resetInferStats():void {
	session?.value?.resetInferStats();
}

function onDevStatsToggle(ev:Event):void {
	const el = ev.currentTarget as HTMLDetailsElement;
	props.hud.devStatsOpen = el.open;
	setPrefs({ devStatsOpen: el.open });
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

function select(id:string):void {
	props.hud.saveSelectedID = id;
	const slot = props.hud.saveSlots.find((s) => s.id === id);
	if (slot && !slot.auto) {
		props.hud.saveLabel = slot.label;
	}
}

function save():void {
	session?.value?.save();
}

function load():void {
	if (!props.hud.saveSelectedID) {
		props.hud.menuNotice = 'Select a slot';
		return;
	}
	session?.value?.load();
}

function remove():void {
	if (!props.hud.saveSelectedID) {
		props.hud.menuNotice = 'Select a slot';
		return;
	}
	session?.value?.removeSave();
}

function when(iso:string):string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) {
		return iso;
	}
	return d.toLocaleString();
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
				aria-label="Game menu"
				@click.stop
			>
				<h2>Menu</h2>
				<div class="row">
					<button type="button" @click.stop="resume">Resume</button>
					<button type="button" @click.stop="reset">Reset location</button>
					<button type="button" @click.stop="emit('scenes')">Scenes</button>
				</div>
				<h3>Testing</h3>
				<div class="row">
					<button
						type="button"
						:class="{ on: hud.observer }"
						:aria-pressed="hud.observer"
						@click.stop="toggleObserver"
					>
						{{ hud.observer ? 'Observer on' : 'Observer off' }}
					</button>
					<button
						type="button"
						:class="{ on: hud.arcDirectorOn }"
						:aria-pressed="hud.arcDirectorOn"
						@click.stop="toggleArcDirector"
					>
						{{ hud.arcDirectorOn ? 'ArcDirector on' : 'ArcDirector paused' }}
					</button>
					<button type="button" @click.stop="dumpNPCMaps">
						NPC maps
					</button>
					<button
						type="button"
						:class="{ on: hud.minimap.follow }"
						:aria-pressed="hud.minimap.follow"
						@click.stop="toggleMinimapFollow"
					>
						{{ hud.minimap.follow ? 'Minimap follow' : 'Minimap chunk' }}
					</button>
					<button
						type="button"
						:class="{ on: hud.detailMaps }"
						:aria-pressed="hud.detailMaps"
						@click.stop="toggleDetailMaps"
					>
						{{ hud.detailMaps ? 'Maps on' : 'Maps off' }}
					</button>
					<button
						type="button"
						:class="{ on: hud.shadows }"
						:aria-pressed="hud.shadows"
						@click.stop="toggleShadows"
					>
						{{ hud.shadows ? 'Shadows on' : 'Shadows off' }}
					</button>
				</div>
				<label class="name">
					Character
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
				<label class="name">
					Model
					<select
						v-model="hud.model"
						:disabled="hud.models.length === 0 && !hud.model"
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
				<div class="row">
					<label class="name">
						Parallel thinkers
						<input
							v-model.number="hud.maxParallel"
							type="number"
							:min="MIN_PARALLEL_THINKERS"
							:max="MAX_PARALLEL_THINKERS"
							step="1"
							@change.stop="pickThinkers"
						>
					</label>
					<button
						type="button"
						:class="{ on: hud.batchThinks }"
						@click.stop="toggleBatchThinks"
					>
						{{ hud.batchThinks ? 'Wait for idle on' : 'Wait for idle off' }}
					</button>
				</div>
				<label class="name">
					Thinking
					<input
						v-model.number="hud.thinkingBudget"
						type="number"
						:min="MIN_THINKING_BUDGET"
						:max="MAX_THINKING_BUDGET"
						step="1"
					>
				</label>
				<h3>Audio</h3>
				<div class="row">
					<button
						type="button"
						:class="{ on: hud.audioMuted }"
						:aria-pressed="hud.audioMuted"
						@click.stop="hud.audioMuted = !hud.audioMuted"
					>
						{{ hud.audioMuted ? 'Muted' : 'Mute' }}
					</button>
					<label class="name">
						Music
						<input
							v-model.number="hud.musicVolume"
							type="range"
							min="0"
							max="1"
							step="0.01"
						>
					</label>
					<label class="name">
						SFX
						<input
							v-model.number="hud.sfxVolume"
							type="range"
							min="0"
							max="1"
							step="0.01"
						>
					</label>
				</div>
				<details
					class="dev-stats"
					:open="hud.devStatsOpen"
					@toggle="onDevStatsToggle"
				>
					<summary>Dev stats</summary>
					<table>
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
					<div class="row stats-foot">
						<span class="calls">Graphics memory {{ fmtMem(hud.graphicsMemory) }}</span>
						<span class="calls">{{ hud.inferCalls }} call{{ hud.inferCalls === 1 ? '' : 's' }}</span>
						<button type="button" @click.stop="resetInferStats">Reset</button>
					</div>
				</details>
				<h3>Save states</h3>
				<ul class="slots">
					<li v-if="hud.saveSlots.length === 0" class="empty">No saves yet</li>
					<li
						v-for="slot in hud.saveSlots"
						:key="slot.id"
						:class="{ selected: hud.saveSelectedID === slot.id }"
					>
						<button type="button" class="slot" @click.stop="select(slot.id)">
							<span class="label">{{ slot.auto ? 'Autosave' : slot.label }}</span>
							<span class="when">{{ when(slot.savedAt) }}</span>
						</button>
					</li>
				</ul>
				<label class="name">
					Slot name
					<input
						v-model="hud.saveLabel"
						type="text"
						maxlength="48"
						autocomplete="off"
						placeholder="optional"
					>
				</label>
				<div class="row">
					<button type="button" @click.stop="save">Save</button>
					<button type="button" @click.stop="load">Load</button>
					<button type="button" @click.stop="remove">Delete</button>
				</div>
				<p v-if="hud.menuNotice" class="notice">{{ hud.menuNotice }}</p>
			</div>
		</div>
	</div>
</template>

<style scoped>
.hud-menu-root {
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
	color: #1a1208;
	background: #d4c4a0;
	border: 0;
	padding: 6px 12px;
	cursor: pointer;
	box-shadow: 0 2px 0 #1a1208, 0 4px 12px rgba(0, 0, 0, 0.35);
	z-index: 3;
}

.hud-menu-btn:hover {
	background: #f0e6c8;
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
	z-index: 2;
}

.hud-menu-panel {
	width: min(460px, 92vw);
	max-height: min(78vh, 640px);
	overflow: auto;
	background: #d4c4a0;
	color: #1a1208;
	font-family: ui-monospace, "Cascadia Code", monospace;
	padding: 18px 20px 16px;
	box-shadow: 0 2px 0 #1a1208, 0 16px 40px rgba(0, 0, 0, 0.45);
}

h2 {
	margin: 0 0 12px;
	font-size: 18px;
	letter-spacing: 0.12em;
}

h3 {
	margin: 16px 0 8px;
	font-size: 13px;
	letter-spacing: 0.08em;
}

.row {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 8px;
}

.row .name {
	margin: 0;
}

.row button,
.name input,
.name select {
	font: inherit;
	font-size: 13px;
	color: #1a1208;
	background: #f0e6c8;
	border: 0;
	padding: 6px 10px;
	cursor: pointer;
	box-shadow: 0 2px 0 #1a1208;
}

.row button:hover {
	background: #fff6dc;
}

.row button.on {
	background: #fff6dc;
	box-shadow: inset 0 0 0 2px #1a1208, 0 2px 0 #1a1208;
}

.slots {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
	max-height: 220px;
	overflow: auto;
}

.empty {
	opacity: 0.7;
	font-size: 13px;
	padding: 6px 0;
}

.slot {
	width: 100%;
	display: flex;
	justify-content: space-between;
	gap: 12px;
	text-align: left;
	font: inherit;
	font-size: 13px;
	color: #1a1208;
	background: #c4b490;
	border: 0;
	padding: 8px 10px;
	cursor: pointer;
}

.selected .slot {
	background: #f0e6c8;
	box-shadow: inset 0 0 0 2px #1a1208;
}

.label {
	font-weight: 600;
}

.when {
	opacity: 0.7;
	font-size: 11px;
}

.name {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin: 12px 0;
	font-size: 12px;
	letter-spacing: 0.06em;
}

.name input,
.name select {
	cursor: text;
	box-shadow: inset 0 0 0 2px #1a1208;
}

.name select {
	cursor: pointer;
	max-width: 100%;
}

.name select:disabled {
	opacity: 0.7;
	cursor: default;
}

.name input[type="number"] {
	width: 4.5em;
}

.name input[type="range"] {
	width: 8em;
	box-shadow: none;
	padding: 6px 0;
	cursor: pointer;
	accent-color: #1a1208;
}

.dev-stats {
	margin: 12px 0 4px;
	font-size: 12px;
	letter-spacing: 0.04em;
}

.dev-stats summary {
	cursor: pointer;
	font-size: 13px;
	letter-spacing: 0.08em;
	font-weight: 700;
	list-style-position: outside;
}

.dev-stats table {
	width: 100%;
	margin: 10px 0 8px;
	border-collapse: collapse;
}

.dev-stats th,
.dev-stats td {
	text-align: left;
	padding: 4px 0;
}

.dev-stats th:not(:first-child),
.dev-stats td:not(:first-child) {
	text-align: right;
	font-variant-numeric: tabular-nums;
}

.dev-stats th {
	font-size: 11px;
	opacity: 0.7;
	font-weight: 500;
}

.stats-foot {
	align-items: center;
	justify-content: space-between;
}

.calls {
	opacity: 0.75;
}

.notice {
	margin: 12px 0 0;
	font-size: 12px;
}
</style>
