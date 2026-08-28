<script setup lang="ts">
import { inject, watch } from 'vue';
import type { HudModel } from './hudModel';
import { sessionKey } from './sessionKey';
import { MAX_PARALLEL_THINKERS, MIN_PARALLEL_THINKERS } from '../engine/thinkPref';

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

function pickModel():void {
	session?.value?.applyModel();
}

function pickThinkers():void {
	session?.value?.applyMaxParallel();
}

function dumpNpcMaps():void {
	void session?.value?.dumpNpcMaps();
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
					<button type="button" @click.stop="dumpNpcMaps">
						NPC maps
					</button>
				</div>
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
	width: min(420px, 92vw);
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
	gap: 8px;
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

.notice {
	margin: 12px 0 0;
	font-size: 12px;
}
</style>
