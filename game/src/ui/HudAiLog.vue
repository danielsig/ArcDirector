<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { prefs, setPrefs } from '../prefs';
import { arcLines, thinkTime, thoughtTail } from './arc-text';
import HudArcLine from './HudArcLine.vue';
import type { HudModel } from './hud-model';

const ERRORS = 'Errors';

const props = defineProps<{
	hud:HudModel;
}>();

const logEl = ref<HTMLElement | null>(null);
const source = ref(prefs().aiLogSource);
const query = ref('');
/** On: every prompt and reply. Off: only what the slates show. */
const full = ref(prefs().aiLogFull);
const opened = new Set<number>();

const sources = computed(() => {
	const names = new Set(full.value ? props.hud.aiLog.map((entry) => entry.name) : props.hud.thinks.map((think) => think.name));
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

const thinks = computed(() => {
	const q = query.value.trim().toLowerCase();
	return props.hud.thinks.filter((think) => {
		if (source.value === ERRORS ? !think.error : source.value && think.name !== source.value) {
			return false;
		}
		return !q || [think.name, think.arc, think.thought, think.error].some((text) => text.toLowerCase().includes(q));
	});
});

function pickFull():void {
	setPrefs({ aiLogFull: full.value });
}

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
	() => [rows.value.length, props.hud.aiLogOpen, source.value, query.value, full.value, thinks.value.length, thinks.value.at(-1)?.arc.length] as const,
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
				<label class="full" title="Off: only what the floating think windows show. On: every prompt and reply.">
					<input v-model="full" type="checkbox" @change="pickFull">
					Full log
				</label>
				<span class="hint">~ to close</span>
				<button
					type="button"
					aria-label="Close"
					@click="hud.aiLogOpen = false"
				>×</button>
			</div>
			<div ref="logEl" class="rows">
				<template v-if="!full">
					<div v-if="thinks.length === 0" class="empty">
						{{ hud.thinks.length === 0 ? 'No thinks yet.' : 'No matching thinks.' }}
					</div>
					<article
						v-for="think in thinks"
						:key="think.seq"
						class="think"
						:class="[`hue-${think.color}`, think.state, { wrong: think.wrong }]"
					>
						<header>
							<span class="orb" />
							<strong>{{ think.name }}</strong>
							<span class="time">{{ thinkTime(think.ms) }}</span>
						</header>
						<p v-if="think.error" class="error">{{ think.error }}</p>
						<p v-if="think.thought" class="thought">{{ thoughtTail(think.thought) }}</p>
						<template v-if="think.arc">
							<HudArcLine v-for="(line, i) in arcLines(think.arc)" :key="i" :line="line" />
						</template>
					</article>
				</template>
				<div v-else-if="rows.length === 0" class="empty">
					{{ hud.aiLog.length === 0 ? 'No AI entries yet.' : 'No matching entries.' }}
				</div>
				<details
					v-for="entry in full ? rows : []"
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
					<pre class="full-text"><template v-for="(part, i) in hits(entry.message)" :key="i"><mark v-if="part.on">{{ part.t }}</mark><template v-else>{{ part.t }}</template></template></pre>
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
/* The AI log: a drawer of the slates' own dark glass, up from the bottom edge. Entries stay monospace (they are prompts and JSON). */
.hud-ai-log {
	position: absolute;
	left: 14px;
	right: 14px;
	bottom: 0;
	z-index: 2;
	max-height: min(52vh, 520px);
	display: flex;
	flex-direction: column;
	pointer-events: auto;
	color: var(--glass-text);
	font-family: var(--font);
	background: var(--glass);
	border: var(--line) solid var(--ink);
	border-bottom: 0;
	border-radius: var(--radius) var(--radius) 0 0;
	box-shadow: inset 0 0 0 1.5px var(--gold-deep), var(--shadow-panel);
}

.hud-ai-log::after {
	content: '';
	position: absolute;
	inset: 0;
	border-radius: inherit;
	background: var(--glass-facet);
	pointer-events: none;
}

.head {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 14px 8px;
	font-size: 18px;
	font-weight: 700;
	color: var(--gold);
	border-bottom: var(--line-thin) solid var(--gold-deep);
}

.head select,
.search input {
	font: inherit;
	font-size: 13px;
	font-weight: 400;
	color: var(--glass-text);
	background: #1a1220;
	border: var(--line-thin) solid var(--gold-deep);
	border-radius: var(--radius-small);
	padding: 3px 8px;
}

.head select {
	cursor: pointer;
}

.search {
	position: relative;
	flex: 0 1 13em;
	width: 13em;
}

.search input {
	width: 100%;
	padding-right: 24px;
	outline: none;
}

.search input:focus-visible,
.head select:focus-visible {
	border-color: var(--gold);
}

.search input::placeholder {
	color: var(--glass-text);
	opacity: 0.45;
}

.search button {
	position: absolute;
	right: 2px;
	top: 0;
	bottom: 0;
	width: 22px;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--glass-text);
	cursor: pointer;
	font: inherit;
	font-size: 16px;
	line-height: 1;
}

/* A switch: a dark track, its knob gold when on. */
.full {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 13px;
	font-weight: 400;
	color: var(--glass-text);
	cursor: pointer;
	user-select: none;
}

.full input {
	appearance: none;
	position: relative;
	width: 30px;
	height: 16px;
	margin: 0;
	background: #1a1220;
	border: var(--line-thin) solid var(--gold-deep);
	border-radius: 8px;
	cursor: pointer;
}

.full input::after {
	content: '';
	position: absolute;
	top: 1px;
	left: 1px;
	width: 10px;
	height: 10px;
	border-radius: 50%;
	background: var(--glass-text);
	opacity: 0.6;
	transition: translate var(--quick) var(--ease-out);
}

.full input:checked::after {
	translate: 14px 0;
	background: var(--gold);
	opacity: 1;
}

.full input:focus-visible {
	outline: 2px solid var(--gold);
	outline-offset: 1px;
}

.hint {
	margin-left: auto;
	font-size: 12px;
	font-weight: 400;
	color: var(--glass-text);
	opacity: 0.6;
}

.head > button {
	width: 22px;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--glass-text);
	cursor: pointer;
	font: inherit;
	font-size: 18px;
	line-height: 1;
	opacity: 0.7;
}

.rows {
	flex: 1 1 auto;
	overflow-y: auto;
	padding: 4px 8px 10px;
	min-height: 72px;
	scrollbar-color: var(--gold-deep) transparent;
}

.empty {
	opacity: 0.6;
	font-size: 14px;
	padding: 10px 6px;
}

/* A think, as its slate showed it. */
.think {
	padding: 7px 8px;
	font: 700 12.5px/1.35 var(--font-mono);
	border-bottom: 1px solid rgba(239, 230, 210, 0.14);
}

.think:last-child {
	border-bottom: 0;
}

.think header {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 3px;
	font: 700 13px/1.2 var(--font);
}

.think strong {
	color: var(--hue-light);
}

.think .time {
	margin-left: auto;
	color: var(--hue);
	font: 700 11px/1 var(--font-mono);
}

.think .orb {
	flex: none;
	width: 11px;
	height: 11px;
	border-radius: 50%;
	border: 1.5px solid var(--ink);
	background: radial-gradient(circle at 36% 32%, #fffbe8, var(--hue) 45%, var(--hue-deep));
}

.think.writing .orb {
	background: conic-gradient(var(--hue), #3a2a44 40%, var(--hue-deep) 70%, var(--hue));
}

.think.dropped {
	opacity: 0.55;
}

.think.failed .orb,
.think.wrong .orb {
	background: var(--health);
}

.think .error {
	margin: 0 0 3px;
	color: #ff9d8c;
	font: 700 11px/1.3 var(--font);
	overflow-wrap: anywhere;
}

.think .thought {
	margin: 0 0 3px;
	opacity: 0.45;
	font: 400 11px/1.3 var(--font);
}

.row {
	border-bottom: 1px solid rgba(239, 230, 210, 0.14);
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
	border-radius: var(--radius-small);
}

.row summary:hover {
	background: rgba(239, 230, 210, 0.08);
}

.row summary::-webkit-details-marker {
	display: none;
}

.row summary::before {
	content: "▸";
	flex: 0 0 auto;
	opacity: 0.5;
	font-size: 11px;
}

.row[open] summary::before {
	content: "▾";
}

.name {
	flex: 0 0 auto;
	min-width: 7.5em;
	font-size: 13px;
	font-weight: 700;
	color: var(--gold);
}

.row.err .name {
	color: #ff9d8c;
}

.msg {
	flex: 1 1 auto;
	font-family: var(--font-mono);
	font-size: 12px;
	line-height: 1.35;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.full-text {
	margin: 0 6px 10px 22px;
	padding: 8px 10px;
	font-family: var(--font-mono);
	font-size: 12px;
	line-height: 1.4;
	white-space: pre-wrap;
	word-break: break-word;
	color: var(--glass-text);
	background: rgba(0, 0, 0, 0.3);
	border-radius: var(--radius-small);
}

.full-text mark {
	background: var(--gold);
	color: var(--ink);
	padding: 0;
}

.map {
	display: block;
	margin: 0 6px 12px 22px;
	max-width: min(256px, calc(100% - 28px));
	height: auto;
	image-rendering: pixelated;
	border: var(--line-thin) solid var(--gold-deep);
	border-radius: var(--radius-small);
}

.ai-log-enter-active,
.ai-log-leave-active {
	transition: transform var(--slow) var(--ease-out);
}

.ai-log-enter-from,
.ai-log-leave-to {
	transform: translateY(100%);
}
</style>
