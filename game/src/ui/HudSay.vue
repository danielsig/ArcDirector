<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
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
/** Character index under the mouse, and the caret's while the field has focus; -1 for none. */
const hoverAt = ref(-1);
const caret = ref(-1);
const chipHover = ref(false);
/** A good just picked keeps its chip until the caret moves or the field is clicked. `at` is where the caret was left. */
const pinned = ref<{ start:number; at:number } | null>(null);

type Amount = { start:number; end:number; digits:number; name:string };

/** Every `6 gold` / `2 Bowl` in a slash command. Plain speech has none. */
const amounts = computed(():Amount[] => [...(draft.value.startsWith('/') ? draft.value : '').matchAll(/\b(\d+) +([A-Za-z]\w*)/g)].map((m) => ({
	start: m.index,
	end: m.index + m[0].length,
	digits: m[1].length,
	name: m[2],
})));

/** Which amount has the chip: the one the mouse, a pin, or the caret is on. Kept while the mouse is on the chip. */
const chipAt = ref(-1);
const chip = computed(():Amount | null => amounts.value[chipAt.value] ?? null);
watch([amounts, hoverAt, caret, chipHover, pinned], () => {
	if (chipHover.value) {
		return;
	}
	const on = (at:number):number => amounts.value.findIndex((a) => at >= a.start && at <= a.end);
	const hovered = on(hoverAt.value);
	const next = hovered >= 0 ? hovered : on(pinned.value?.start ?? caret.value);
	if (next === chipAt.value) {
		return;
	}
	// Room for the chip between amount and name while it shows.
	gap(chipAt.value, 1);
	gap(next, 3);
	chipAt.value = next;
});

/** Put `spaces` between the amount and the name of amount `i`, keeping the caret where it was in the text. */
function gap(i:number, spaces:number):void {
	const a = amounts.value[i];
	if (!a) {
		return;
	}
	const from = a.start + a.digits;
	const old = a.end - a.name.length - from;
	splice(from, old, ' '.repeat(spaces));
}

/** Replace `length` characters at `from` with `text`; a caret or pin past them moves with them. */
function splice(from:number, length:number, text:string):void {
	const shift = text.length - length;
	if (shift === 0 && draft.value.slice(from, from + length) === text) {
		return;
	}
	// A keystroke reaches the field before selectionchange reaches us; once the field shows the draft, it knows the caret.
	const el = field.value;
	if (el && document.activeElement === el && el.value === draft.value) {
		caret.value = el.selectionStart ?? caret.value;
	}
	draft.value = draft.value.slice(0, from) + text + draft.value.slice(from + length);
	const moved = (at:number):number => (at > from ? at + shift : at);
	if (pinned.value) {
		pinned.value = { start: moved(pinned.value.start), at: moved(pinned.value.at) };
	}
	if (caret.value >= 0) {
		placeCaret(moved(caret.value));
	}
}

/** Put the caret at `at` once the field shows the new draft. `caret` leads, so the last call wins. */
function placeCaret(at:number):void {
	caret.value = at;
	void nextTick(() => {
		const el = field.value;
		if (el && caret.value >= 0) {
			el.focus();
			el.setSelectionRange(caret.value, caret.value);
		}
	});
}

/** The field's monospace character width and left padding, for mapping pixels to characters. */
function metrics():{ char:number; pad:number } {
	const el = field.value!;
	const style = getComputedStyle(el);
	const ctx = document.createElement('canvas').getContext('2d')!;
	ctx.font = style.font;
	return { char: ctx.measureText('0').width, pad: parseFloat(style.paddingLeft) };
}

/** The middle of the gap between the chip's amount and name. */
const chipLeft = computed(() => {
	const el = field.value;
	const a = chip.value;
	if (!a || !el) {
		return 0;
	}
	const { char, pad } = metrics();
	const mid = a.start + a.digits + (a.end - a.name.length - a.start - a.digits) / 2;
	return pad + mid * char - el.scrollLeft;
});

function onHover(e:MouseEvent):void {
	const { char, pad } = metrics();
	hoverAt.value = Math.floor((e.offsetX - pad + field.value!.scrollLeft) / char);
}

/** Follow every caret move in the field: typing, arrows, clicks. Moving off a pin drops it. */
function syncCaret():void {
	const el = field.value;
	if (!el || document.activeElement !== el) {
		return;
	}
	caret.value = el.selectionStart ?? -1;
	if (pinned.value && caret.value !== pinned.value.at) {
		pinned.value = null;
	}
}

onMounted(() => document.addEventListener('selectionchange', syncCaret));
onUnmounted(() => document.removeEventListener('selectionchange', syncCaret));

/** Step the chip's amount by `delta`, never below 1, and gold you give never past your purse. */
function step(delta:number):void {
	const a = chip.value;
	if (!a) {
		return;
	}
	const giving = !/\bfor\b/i.test(draft.value.slice(0, a.start));
	const most = a.name.toLowerCase() === 'gold' && giving && props.hud.gold > 0 ? props.hud.gold : Infinity;
	const n = Math.min(most, Math.max(1, Number(draft.value.slice(a.start, a.start + a.digits)) + delta));
	splice(a.start, a.digits, String(n));
}

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
	offers: props.hud.sayOffers,
}));

/** Completions for the end of the draft: only while the caret is there. */
const suggestions = computed(():SaySuggestion[] => (
	caret.value >= 0 && caret.value < draft.value.length ? [] : suggestSay(draft.value, catalog.value)
));

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
	const picked = amounts.value.find((a) => a.end === row.insert.trimEnd().length);
	pinned.value = picked ? { start: picked.start, at: row.insert.length } : null;
	placeCaret(row.insert.length);
}

function send():void {
	gap(chipAt.value, 1);
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
	if ((e.code === 'ArrowUp' || e.code === 'ArrowDown') && chip.value) {
		e.preventDefault();
		e.stopPropagation();
		step(e.code === 'ArrowUp' ? 1 : -1);
		return;
	}
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
		<div class="field">
			<div
				v-if="chip"
				class="chip"
				:style="{ left: `${chipLeft}px` }"
				@mouseenter="chipHover = true"
				@mouseleave="chipHover = false"
			>
				<button type="button" aria-label="more" @mousedown.prevent="step(1)">▲</button>
				<button type="button" aria-label="fewer" @mousedown.prevent="step(-1)">▼</button>
			</div>
			<input
				id="hud-say-input"
				ref="field"
				v-model="draft"
				type="text"
				autocomplete="off"
				spellcheck="false"
				placeholder="Say something… or /give"
				@keydown="onFieldKey"
				@keyup="syncCaret"
				@click="syncCaret"
				@mousemove="onHover"
				@mouseleave="hoverAt = -1"
				@blur="caret = -1; keepFocus()"
			>
		</div>
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

.field {
	position: relative;
}

.chip {
	position: absolute;
	top: 50%;
	z-index: 1;
	transform: translate(-50%, -50%);
	display: flex;
	flex-direction: column;
	background: rgba(18, 14, 10, 0.94);
	box-shadow: 0 0 0 2px #1a1208;
}

.chip button {
	padding: 0 4px;
	font-size: 10px;
	line-height: 14px;
	color: #f0e6c8;
	background: none;
	border: 0;
	cursor: pointer;
}

.chip button:hover {
	background: rgba(80, 58, 32, 0.55);
}

input::placeholder {
	color: #8a7a62;
}
</style>
