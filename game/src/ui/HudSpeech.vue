<script setup lang="ts">
import { computed } from 'vue';
import { ITEM_DEFS } from '../items/defs';
import type { HudModel, HudSpeech } from './hudModel';

const props = defineProps<{
	hud:HudModel;
}>();

// Sizes the stacking estimates from; they match the styles below.
const BUBBLE_W = 220;
const FONT = 14;
/** Padding plus outline, both sides. */
const PAD_X = 28;
/** Padding plus outline, top and bottom, plus the tail. */
const PAD_Y = 26;
const LINE = 1.3;
/** A rounded face averages about half an em a letter; a little over, so bubbles never stack too tight. */
const CHAR_EM = 0.55;
const STACK_GAP = 6;

function bubbleWidth(text:string):number {
	let longest = 1;
	for (const part of text.split('\n')) {
		longest = Math.max(longest, part.length);
	}
	const content = longest * FONT * CHAR_EM + PAD_X;
	return Math.min(BUBBLE_W, Math.max(PAD_X + FONT, content));
}

function bubbleHeight(text:string, width:number):number {
	const charsPerLine = Math.max(1, Math.floor((width - PAD_X) / (FONT * CHAR_EM)));
	let lines = 0;
	for (const part of text.split('\n')) {
		lines += Math.ceil(Math.max(1, part.length) / charsPerLine);
	}
	return lines * FONT * LINE + PAD_Y;
}

/** Pixels of the overhead column under the bubble (thinking dots, status, nameplate, padding). */
function belowBubble(s:HudSpeech):number {
	let h = 8;
	if (s.thinking) {
		h += 4 + 34;
	}
	if (s.status) {
		const lines = Math.min(3, Math.max(1, Math.ceil(s.status.length / 28)));
		h += 4 + lines * 12 * 1.3;
	}
	if (carries(s)) {
		h += 4 + CARRY_H - (s.maxHP > 0 ? 0 : CARRY_TUCK);
	}
	if (s.maxHP > 0) {
		h += 4 + 16 + 2 + 8;
	}
	return h;
}

/** Height of the carried-things row; matches `.carry`. */
const CARRY_H = 12;
/** How far the carried-things row drops toward the head when nothing is under it; matches `.carry:last-child`. */
const CARRY_TUCK = 18;

function carries(s:HudSpeech):boolean {
	return s.gold > 0 || s.items.length > 0;
}

/** An item's own colour, as its mesh is tinted. */
function tint(defID:string):string {
	return `#${(ITEM_DEFS[defID]?.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
}

type Laid = {
	shift:number;
};

const layout = computed(() => {
	const out = new Map<string, Laid>();
	const boxes:{ left:number; right:number; top:number; bottom:number }[] = [];
	const lines = props.hud.speech.filter((s) => s.visible && s.text);
	lines.sort((a, b) => b.timestamp - a.timestamp || (a.id < b.id ? -1 : 1));
	for (const s of lines) {
		const width = bubbleWidth(s.text);
		const height = bubbleHeight(s.text, width);
		const left = s.x - width / 2;
		let top = s.y - belowBubble(s) - height;
		for (const newer of boxes) {
			const overlapsX = left < newer.right + STACK_GAP && left + width > newer.left - STACK_GAP;
			if (!overlapsX) {
				continue;
			}
			const above = newer.top - STACK_GAP - height;
			if (above < top) {
				top = above;
			}
		}
		boxes.push({ left, right: left + width, top, bottom: top + height });
		const naturalTop = s.y - belowBubble(s) - height;
		out.set(s.id, { shift: top - naturalTop });
	}
	return out;
});

function shiftOf(s:HudSpeech):string | undefined {
	const shift = layout.value.get(s.id)?.shift ?? 0;
	if (shift === 0) {
		return undefined;
	}
	return `0 ${shift}px`;
}

function fillPct(s:HudSpeech):number {
	if (s.maxHP <= 0) {
		return 0;
	}
	return Math.max(0, Math.min(100, (s.hp / s.maxHP) * 100));
}
</script>

<template>
	<div class="speech-layer">
		<!-- Thought clouds and nameplates. A hidden bubble keeps their place under the spoken line. -->
		<div class="plates">
			<div
				v-for="s in hud.speech"
				v-show="s.visible"
				:key="s.id"
				class="overhead"
				:style="{ left: `${s.x}px`, top: `${s.y}px`, zIndex: s.text ? s.timestamp : 0 }"
			>
				<div
					v-if="s.text"
					class="bubble spacer"
					:style="{ translate: shiftOf(s) }"
				>{{ s.text }}</div>
				<div v-if="s.thinking" class="thinking" role="img" aria-label="Thinking">
					<span class="dot" /><span class="dot" /><span class="dot" />
				</div>
				<div v-if="s.status" class="status">{{ s.status }}</div>
				<div v-if="carries(s)" class="carry">
					<span v-if="s.gold > 0" class="gold"><span class="coin" />{{ s.gold }}</span>
					<svg
						v-for="(defID, i) in s.items"
						:key="i"
						class="icon"
						viewBox="0 0 12 12"
						:style="{ color: tint(defID) }"
						role="img"
						:aria-label="ITEM_DEFS[defID]?.name ?? defID"
					>
						<template v-if="defID === 'silver_trout'">
							<path d="M1 6c2-3 6-3 8 0-2 3-6 3-8 0z" fill="currentColor" />
							<path d="M8.5 6 11.5 3.5v5z" fill="currentColor" />
							<circle cx="3.2" cy="5.6" r="0.7" fill="#1a1208" />
						</template>
						<template v-else>
							<path d="M4.6 6.5h2.8l.5 4.5H4.1z" fill="#efe2c4" />
							<path d="M1 7c0-3 2.2-5 5-5s5 2 5 5z" fill="currentColor" />
							<circle cx="4.2" cy="4.4" r="0.8" fill="#fff6d8" />
							<circle cx="7.6" cy="5.2" r="0.6" fill="#fff6d8" />
						</template>
					</svg>
				</div>
				<div v-if="s.maxHP > 0" class="plate">
					<div class="name">{{ s.name }}</div>
					<div class="hp-track">
						<div class="hp-fill" :style="{ width: `${fillPct(s)}%` }" />
					</div>
				</div>
			</div>
		</div>
		<!-- Spoken lines, always above every thought cloud and health bar. -->
		<div class="bubbles">
			<div
				v-for="s in hud.speech"
				v-show="s.visible && s.text"
				:key="s.id"
				class="overhead"
				:style="{ left: `${s.x}px`, top: `${s.y}px`, zIndex: s.timestamp }"
			>
				<div
					class="bubble"
					:style="{ translate: shiftOf(s) }"
				>{{ s.text }}</div>
				<div v-if="s.thinking" class="thinking spacer" aria-hidden="true">
					<span class="dot" /><span class="dot" /><span class="dot" />
				</div>
				<div v-if="s.status" class="status spacer">{{ s.status }}</div>
				<div v-if="carries(s)" class="carry spacer" />
				<div v-if="s.maxHP > 0" class="plate spacer">
					<div class="name">{{ s.name }}</div>
					<div class="hp-track">
						<div class="hp-fill" :style="{ width: `${fillPct(s)}%` }" />
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
/*
 * Over each head, top down: a parchment speech bubble with a tail, a thought cloud of bobbing dots
 * while the mind thinks, a status line, and the nameplate (name over a health bar).
 */
.speech-layer {
	position: absolute;
	inset: 0;
	pointer-events: none;
	overflow: hidden;
	font-family: var(--font);
}

/* Plates stay under every speech bubble, even when a newer speaker's bar would otherwise cover it. */
.plates,
.bubbles {
	position: absolute;
	inset: 0;
}

.plates {
	z-index: 0;
}

.bubbles {
	z-index: 1;
}

.spacer {
	visibility: hidden;
	animation: none;
}

.overhead {
	position: absolute;
	transform: translate(-50%, -100%);
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
	width: 220px;
	padding-bottom: 8px;
}

.bubble {
	position: relative;
	width: fit-content;
	max-width: 100%;
	margin-bottom: 8px;
	padding: 5px 12px;
	color: var(--ink);
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: var(--radius-small);
	box-shadow: var(--shadow);
	font-size: 14px;
	font-weight: 700;
	line-height: 1.3;
	text-align: center;
	white-space: pre-wrap;
	animation: pop var(--slow) var(--ease-pop);
}

/* The tail: an ink triangle with a parchment one inside it. */
.bubble::before,
.bubble::after {
	content: "";
	position: absolute;
	left: 50%;
	border-style: solid;
	border-color: transparent;
}

.bubble::before {
	top: 100%;
	margin-left: -9px;
	border-width: 10px 9px 0;
	border-top-color: var(--ink);
}

.bubble::after {
	top: calc(100% - 1px);
	margin-left: -6px;
	border-width: 7px 6px 0;
	border-top-color: var(--parchment);
}

@keyframes pop {
	from {
		opacity: 0;
		transform: scale(0.8) translateY(6px);
	}
}

/* A thought cloud: three dots bobbing in turn, over two small puffs leading down to the head. */
.thinking {
	position: relative;
	display: flex;
	gap: 5px;
	margin-bottom: 12px;
	padding: 7px 11px;
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: 14px;
	box-shadow: var(--shadow);
	animation: pop var(--slow) var(--ease-pop);
}

.thinking::before,
.thinking::after {
	content: "";
	position: absolute;
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: 50%;
}

.thinking::before {
	width: 9px;
	height: 9px;
	left: 40%;
	top: calc(100% + 1px);
}

.thinking::after {
	width: 6px;
	height: 6px;
	left: 33%;
	top: calc(100% + 10px);
}

.dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--ink);
	animation: bob 1.2s var(--ease-out) infinite;
}

.dot:nth-child(2) {
	animation-delay: 0.15s;
}

.dot:nth-child(3) {
	animation-delay: 0.3s;
}

@keyframes bob {
	0%,
	60%,
	100% {
		transform: none;
		opacity: 0.45;
	}

	30% {
		transform: translateY(-4px);
		opacity: 1;
	}
}

.status {
	color: var(--on-world);
	text-shadow: var(--on-world-edge);
	font-size: 12px;
	font-weight: 700;
	line-height: 1.3;
	text-align: center;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 3;
	overflow: hidden;
}

/* What they carry: a gold dot and the coin count, then a tiny icon for each mushroom or trout. */
.carry {
	display: flex;
	flex-wrap: nowrap;
	align-items: center;
	justify-content: center;
	gap: 1px;
	height: 12px;
	max-width: 100%;
	filter: drop-shadow(0 1px 0 var(--ink));
}

/* With no nameplate under it, down onto the head rather than at nameplate height. */
.carry:last-child {
	margin-bottom: -18px;
}

.gold {
	display: inline-flex;
	align-items: center;
	gap: 2px;
	margin-right: 3px;
	color: var(--gold);
	font-size: 11px;
	font-weight: 700;
	line-height: 12px;
}

.coin {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: var(--gold);
	box-shadow: inset 0 0 0 1px var(--gold-deep);
}

.icon {
	width: 11px;
	height: 11px;
	flex: none;
}

.plate {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	padding-bottom: 2px;
}

.name {
	color: var(--on-world);
	text-shadow: var(--on-world-edge);
	font-size: 13px;
	font-weight: 700;
	line-height: 16px;
	white-space: nowrap;
}

.hp-track {
	width: 56px;
	height: 8px;
	background: var(--health-track);
	border: var(--line-thin) solid var(--health-track);
	border-radius: 4px;
	box-shadow: var(--shadow);
	overflow: hidden;
}

.hp-fill {
	height: 100%;
	border-radius: 2px;
	background: var(--health);
	transition: width var(--slow) var(--ease-out);
}
</style>
