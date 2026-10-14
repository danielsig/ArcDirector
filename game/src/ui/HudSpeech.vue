<script setup lang="ts">
import { computed } from 'vue';
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
	if (s.maxHP > 0) {
		h += 4 + 16 + 2 + 8;
	}
	return h;
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
		<div
			v-for="s in hud.speech"
			v-show="s.visible"
			:key="s.id"
			class="overhead"
			:style="{ left: `${s.x}px`, top: `${s.y}px`, zIndex: s.text ? s.timestamp : 0 }"
		>
			<div
				v-if="s.text"
				class="bubble"
				:style="{ translate: shiftOf(s) }"
			>{{ s.text }}</div>
			<div v-if="s.thinking" class="thinking" role="img" aria-label="Thinking">
				<span class="dot" /><span class="dot" /><span class="dot" />
			</div>
			<div v-if="s.status" class="status">{{ s.status }}</div>
			<div v-if="s.maxHP > 0" class="plate">
				<div class="name">{{ s.name }}</div>
				<div class="hp-track">
					<div class="hp-fill" :style="{ width: `${fillPct(s)}%` }" />
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
