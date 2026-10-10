<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue';
import type { HudModel } from './hudModel';
import { parseSlash, slashComplete, suggestSay, type SaySuggestion } from './sayCommands';
import { lsDel, lsGet, lsSet } from '../prefs';
import { sessionKey } from './sessionKey';

const props = defineProps<{
	hud:HudModel;
}>();

const session = inject(sessionKey);
const field = ref<HTMLInputElement | null>(null);
const draft = ref('');
const pick = ref(0);
const histKey = 'arc-director.sayHistory';
const hist = ref<string[]>([]);
const histAt = ref(-1);
const histLive = ref('');

function readHist():string[] {
	try {
		const raw = JSON.parse(lsGet(histKey) ?? '[]');
		return Array.isArray(raw)
			? raw.filter((s):s is string => typeof s === 'string' && s.length > 0).slice(-20)
			: [];
	}
	catch {
		return [];
	}
}

function remember(text:string):void {
	const rows = readHist();
	if (rows[rows.length - 1] === text) {
		hist.value = rows;
		return;
	}
	rows.push(text);
	const next = rows.slice(-20);
	hist.value = next;
	lsSet(histKey, JSON.stringify(next));
}

const catalog = computed(() => ({
	peers: props.hud.sayPeers,
	items: props.hud.sayItems,
	gold: props.hud.gold,
	goods: props.hud.sayGoods,
}));

const suggestions = computed(():SaySuggestion[] => suggestSay(draft.value, catalog.value));

watch(
	() => props.hud.sayOpen,
	async (open) => {
		if (!open) {
			draft.value = '';
			pick.value = 0;
			histAt.value = -1;
			return;
		}
		hist.value = readHist();
		histAt.value = -1;
		await nextTick();
		field.value?.focus();
		field.value?.select();
	},
);

watch(suggestions, (rows) => {
	if (rows.length === 0) {
		pick.value = 0;
		return;
	}
	if (pick.value >= rows.length) {
		pick.value = 0;
	}
});

function apply(row:SaySuggestion):void {
	draft.value = row.insert;
	pick.value = 0;
	void nextTick(() => {
		const el = field.value;
		if (!el) {
			return;
		}
		el.focus();
		const n = draft.value.length;
		el.setSelectionRange(n, n);
	});
}

function send():void {
	const text = draft.value.trim();
	draft.value = '';
	props.hud.sayOpen = false;
	props.hud.chatOpen = false;
	if (text.length > 0) {
		if (/^\/clear$/i.test(text)) {
			lsDel(histKey);
			hist.value = [];
			histAt.value = -1;
			return;
		}
		remember(text);
		session?.value?.say(text);
	}
}

function cancel():void {
	draft.value = '';
	props.hud.sayOpen = false;
}

function keepFocus():void {
	if (!props.hud.sayOpen || !document.hasFocus()) {
		return;
	}
	void nextTick(() => {
		field.value?.focus();
	});
}

function onFieldKey(e:KeyboardEvent):void {
	const rows = suggestions.value;
	if (e.code === 'ArrowUp' && rows.length === 0) {
		e.preventDefault();
		e.stopPropagation();
		if (hist.value.length === 0) {
			return;
		}
		if (histAt.value < 0) {
			histLive.value = draft.value;
			histAt.value = hist.value.length;
		}
		if (histAt.value > 0) {
			histAt.value -= 1;
			draft.value = hist.value[histAt.value] ?? '';
		}
		return;
	}
	if (e.code === 'ArrowDown' && rows.length === 0) {
		e.preventDefault();
		e.stopPropagation();
		if (histAt.value < 0) {
			return;
		}
		histAt.value += 1;
		if (histAt.value >= hist.value.length) {
			histAt.value = -1;
			draft.value = histLive.value;
			return;
		}
		draft.value = hist.value[histAt.value] ?? '';
		return;
	}
	if (e.code === 'ArrowDown' && rows.length > 0) {
		e.preventDefault();
		e.stopPropagation();
		pick.value = (pick.value + 1) % rows.length;
		return;
	}
	if (e.code === 'ArrowUp' && rows.length > 0) {
		e.preventDefault();
		e.stopPropagation();
		pick.value = (pick.value + rows.length - 1) % rows.length;
		return;
	}
	if (e.code === 'Tab' && rows.length > 0) {
		e.preventDefault();
		e.stopPropagation();
		apply(rows[pick.value] ?? rows[0]);
		return;
	}
	if (e.code === 'Enter' || e.code === 'NumpadEnter') {
		e.preventDefault();
		e.stopPropagation();
		const parsed = parseSlash(draft.value);
		if (parsed && !parsed.ok && rows.length > 0 && !slashComplete(draft.value)) {
			apply(rows[pick.value] ?? rows[0]);
			return;
		}
		send();
		return;
	}
	if (e.code === 'Escape') {
		e.preventDefault();
		e.stopPropagation();
		cancel();
	}
}

function onPick(row:SaySuggestion, e:MouseEvent):void {
	e.preventDefault();
	apply(row);
}
</script>

<template>
	<div v-if="hud.sayOpen" class="hud-say" aria-label="say">
		<label class="who" for="hud-say-input">
			<template v-if="hud.sayTo">To {{ hud.sayTo }}</template>
			<template v-else>No one in earshot</template>
			<span class="hint">Enter send · Tab complete · / commands · @Name</span>
		</label>
		<ul v-if="suggestions.length > 0" class="suggest" role="listbox">
			<li
				v-for="(row, i) in suggestions"
				:key="row.insert + row.label"
				class="opt"
				:class="{ on: i === pick }"
				role="option"
				:aria-selected="i === pick"
				@mousedown="onPick(row, $event)"
			>
				<span class="lab">{{ row.label }}</span>
				<span class="meta">{{ row.hint }}</span>
			</li>
		</ul>
		<input
			id="hud-say-input"
			ref="field"
			v-model="draft"
			type="text"
			autocomplete="off"
			spellcheck="false"
			placeholder="Say something… or /give"
			@keydown="onFieldKey"
			@blur="keepFocus"
		>
	</div>
</template>

<style scoped>
.hud-say {
	position: absolute;
	left: 50%;
	bottom: 72px;
	transform: translateX(-50%);
	width: min(520px, 86vw);
	display: flex;
	flex-direction: column;
	gap: 6px;
	pointer-events: auto;
	font-family: ui-monospace, "Cascadia Code", monospace;
	color: #f0e6c8;
}

.who {
	font-size: 12px;
	letter-spacing: 0.06em;
	color: #d4c4a0;
	text-shadow: 0 1px 0 #1a1208;
	white-space: normal;
}

.hint {
	float: right;
	opacity: 0.55;
	letter-spacing: 0.04em;
}

.suggest {
	margin: 0;
	padding: 4px 0;
	list-style: none;
	background: rgba(18, 14, 10, 0.94);
	box-shadow: 0 0 0 2px #1a1208, 0 8px 24px rgba(0, 0, 0, 0.45);
	max-height: 220px;
	overflow-y: auto;
}

.opt {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	padding: 6px 12px;
	font-size: 13px;
	cursor: pointer;
}

.opt.on,
.opt:hover {
	background: rgba(80, 58, 32, 0.55);
	color: #fff6d8;
}

.lab {
	letter-spacing: 0.03em;
}

.meta {
	opacity: 0.5;
	font-size: 11px;
	letter-spacing: 0.04em;
}

input {
	width: 100%;
	box-sizing: border-box;
	padding: 10px 12px;
	font: inherit;
	font-size: 15px;
	color: #f0e6c8;
	background: rgba(18, 14, 10, 0.92);
	border: 0;
	box-shadow: 0 0 0 2px #1a1208, 0 8px 24px rgba(0, 0, 0, 0.45);
	outline: none;
}

input::placeholder {
	color: #8a7a62;
}
</style>
