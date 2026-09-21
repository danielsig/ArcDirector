<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { prefs, setPrefs } from '../prefs';
import type { HudModel } from './hudModel';

const props = defineProps<{
	hud:HudModel;
}>();

const logEl = ref<HTMLElement | null>(null);
const source = ref(prefs().aiLogSource);

const sources = computed(() => {
	const names = new Set(props.hud.aiLog.map((entry) => entry.name));
	if (source.value) {
		names.add(source.value);
	}
	return [...names].sort();
});

const rows = computed(() => (
	source.value
		? props.hud.aiLog.filter((entry) => entry.name === source.value)
		: props.hud.aiLog
));

function pickSource():void {
	setPrefs({ aiLogSource: source.value });
}

function preview(message:string):string {
	const line = message.replace(/\s+/g, ' ').trim();
	if (line.length <= 140) {
		return line;
	}
	return `${line.slice(0, 140)}…`;
}

function atBottom(el:HTMLElement):boolean {
	return el.scrollHeight - el.scrollTop - el.clientHeight < 8;
}

watch(
	() => [rows.value.length, props.hud.aiLogOpen, source.value] as const,
	async (curr, prev) => {
		if (!curr[1]) {
			return;
		}
		const el = logEl.value;
		const stick = !prev?.[1] || (el != null && atBottom(el));
		await nextTick();
		const box = logEl.value;
		if (stick && box) {
			box.scrollTop = box.scrollHeight;
		}
	},
);
</script>

<template>
	<Transition name="ai-log">
		<section
			v-if="hud.aiLogOpen"
			class="hud-ai-log"
			aria-label="AI log"
		>
			<div class="head">
				AI log
				<select
					v-model="source"
					aria-label="Source"
					@change.stop="pickSource"
				>
					<option value="">All</option>
					<option
						v-for="name in sources"
						:key="name"
						:value="name"
					>
						{{ name }}
					</option>
				</select>
				<span class="hint">~ to close</span>
			</div>
			<div ref="logEl" class="rows">
				<div v-if="rows.length === 0" class="empty">No AI entries yet.</div>
				<details
					v-for="entry in rows"
					:key="entry.seq"
					class="row"
					:open="!!entry.image"
				>
					<summary>
						<span class="name">{{ entry.name }}</span>
						<span class="msg">{{ preview(entry.message) }}</span>
					</summary>
					<pre class="full">{{ entry.message }}</pre>
					<img
						v-if="entry.image"
						class="map"
						:src="entry.image"
						alt=""
					/>
				</details>
			</div>
		</section>
	</Transition>
</template>

<style scoped>
.hud-ai-log {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	z-index: 2;
	max-height: min(52vh, 520px);
	display: flex;
	flex-direction: column;
	background: rgba(12, 10, 8, 0.78);
	box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.4);
	pointer-events: auto;
	color: #f0e6c8;
	font-family: ui-monospace, "Cascadia Code", monospace;
}

.head {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 14px 6px;
	font-size: 12px;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: #d4c4a0;
	border-bottom: 1px solid rgba(58, 42, 34, 0.85);
	text-shadow: 0 1px 0 #1a1208;
}

.head select {
	font: inherit;
	font-size: 11px;
	letter-spacing: 0.04em;
	text-transform: none;
	color: #f0e6c8;
	background: rgba(8, 6, 4, 0.55);
	border: 1px solid rgba(58, 42, 34, 0.85);
	padding: 2px 6px;
	cursor: pointer;
}

.hint {
	margin-left: auto;
	letter-spacing: 0.04em;
	text-transform: none;
	opacity: 0.55;
	font-size: 11px;
}

.rows {
	flex: 1 1 auto;
	overflow-y: auto;
	padding: 4px 8px 10px;
	min-height: 72px;
}

.empty {
	opacity: 0.5;
	font-size: 13px;
	padding: 10px 6px;
}

.row {
	border-bottom: 1px solid rgba(58, 42, 34, 0.55);
}

.row:last-child {
	border-bottom: 0;
}

.row summary {
	list-style: none;
	display: flex;
	gap: 12px;
	align-items: baseline;
	padding: 7px 6px;
	cursor: pointer;
}

.row summary::-webkit-details-marker {
	display: none;
}

.row summary::before {
	content: "▸";
	flex: 0 0 auto;
	opacity: 0.45;
	font-size: 11px;
}

.row[open] summary::before {
	content: "▾";
}

.name {
	flex: 0 0 auto;
	min-width: 7.5em;
	font-size: 11px;
	letter-spacing: 0.06em;
	color: #c4a574;
}

.msg {
	flex: 1 1 auto;
	font-size: 12px;
	line-height: 1.35;
	opacity: 0.92;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.full {
	margin: 0 6px 10px 22px;
	padding: 8px 10px;
	background: rgba(8, 6, 4, 0.45);
	font: inherit;
	font-size: 12px;
	line-height: 1.4;
	white-space: pre-wrap;
	word-break: break-word;
	color: #f0e6c8;
}

.map {
	display: block;
	margin: 0 6px 12px 22px;
	max-width: min(256px, calc(100% - 28px));
	height: auto;
	image-rendering: pixelated;
	border: 2px solid #1a1208;
	background: #141018;
}

.ai-log-enter-active,
.ai-log-leave-active {
	transition: transform 0.22s ease;
}

.ai-log-enter-from,
.ai-log-leave-to {
	transform: translateY(100%);
}
</style>
