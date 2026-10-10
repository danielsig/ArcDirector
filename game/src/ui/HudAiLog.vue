<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { prefs, setPrefs } from '../prefs';
import type { HudModel } from './hudModel';

const ERRORS = 'Errors';

const props = defineProps<{
	hud:HudModel;
}>();

const logEl = ref<HTMLElement | null>(null);
const source = ref(prefs().aiLogSource);
const query = ref('');
const opened = new Set<number>();

const sources = computed(() => {
	const names = new Set(props.hud.aiLog.map((entry) => entry.name));
	names.delete(ERRORS);
	if (source.value && source.value !== ERRORS) {
		names.add(source.value);
	}
	return [...names].sort();
});

const rows = computed(() => {
	const q = query.value.trim().toLowerCase();
	return props.hud.aiLog.filter((entry) => {
		if (source.value === ERRORS) {
			if (!entry.error) {
				return false;
			}
		}
		else if (source.value && entry.name !== source.value) {
			return false;
		}
		return !q || entry.name.toLowerCase().includes(q) || entry.message.toLowerCase().includes(q);
	});
});

function pickSource():void {
	setPrefs({ aiLogSource: source.value });
}

function onToggle(seq:number, e:Event):void {
	if ((e.currentTarget as HTMLDetailsElement).open) {
		opened.add(seq);
	}
	else {
		opened.delete(seq);
	}
}

function preview(message:string):string {
	const line = message.replace(/\s+/g, ' ').trim();
	if (line.length <= 140) {
		return line;
	}
	return `${line.slice(0, 140)}…`;
}

function hits(text:string):{ t:string; on?:true }[] {
	const needle = query.value.trim();
	if (!needle) {
		return [{ t: text }];
	}
	const out:{ t:string; on?:true }[] = [];
	const low = text.toLowerCase();
	const n = needle.toLowerCase();
	let i = 0;
	for (let j = low.indexOf(n); j >= 0; j = low.indexOf(n, i)) {
		if (j > i) {
			out.push({ t: text.slice(i, j) });
		}
		out.push({ t: text.slice(j, j + n.length), on: true });
		i = j + n.length;
	}
	if (i < text.length) {
		out.push({ t: text.slice(i) });
	}
	return out;
}

function atBottom(el:HTMLElement):boolean {
	return el.scrollHeight - el.scrollTop - el.clientHeight < 8;
}

watch(
	() => [rows.value.length, props.hud.aiLogOpen, source.value, query.value] as const,
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
					<option :value="ERRORS">Errors</option>
					<option
						v-for="name in sources"
						:key="name"
						:value="name"
					>
						{{ name }}
					</option>
				</select>
				<label class="search">
					<input
						v-model="query"
						type="text"
						aria-label="Search"
						placeholder="Search"
						autocomplete="off"
						spellcheck="false"
					>
					<button
						v-if="query"
						type="button"
						aria-label="Clear search"
						@click="query = ''"
					>×</button>
				</label>
				<span class="hint">~ to close</span>
			</div>
			<div ref="logEl" class="rows">
				<div v-if="rows.length === 0" class="empty">
					{{ hud.aiLog.length === 0 ? 'No AI entries yet.' : 'No matching entries.' }}
				</div>
				<details
					v-for="entry in rows"
					:key="entry.seq"
					class="row"
					:class="{ err: entry.error }"
					:open="!!entry.image || opened.has(entry.seq)"
					@toggle="onToggle(entry.seq, $event)"
				>
					<summary>
						<span class="name">{{ entry.name }}</span>
						<span class="msg">{{ preview(entry.message) }}</span>
					</summary>
					<pre class="full"><template v-for="(part, i) in hits(entry.message)" :key="i"><mark v-if="part.on">{{ part.t }}</mark><template v-else>{{ part.t }}</template></template></pre>
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

.head select,
.search input {
	font: inherit;
	font-size: 11px;
	letter-spacing: 0.04em;
	text-transform: none;
	color: #f0e6c8;
	background: rgba(8, 6, 4, 0.55);
	border: 1px solid rgba(58, 42, 34, 0.85);
	padding: 2px 6px;
}

.head select {
	cursor: pointer;
}

.search {
	position: relative;
	flex: 0 1 12em;
	width: 12em;
}

.search input {
	box-sizing: border-box;
	width: 100%;
	padding-right: 22px;
	outline: none;
}

.search input::placeholder {
	color: #8a7a62;
}

.search button {
	position: absolute;
	right: 0;
	top: 0;
	bottom: 0;
	width: 22px;
	border: 0;
	background: transparent;
	color: #d4c4a0;
	cursor: pointer;
	font: inherit;
	font-size: 14px;
	line-height: 1;
	padding: 0;
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

.row.err .name {
	color: #e08070;
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

.full mark {
	background: #c4a574;
	color: #1a1208;
	padding: 0;
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
