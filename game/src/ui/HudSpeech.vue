<script setup lang="ts">
import { computed } from 'vue';
import type { HudModel, HudSpeech } from './hudModel';

const props = defineProps<{
	hud:HudModel;
}>();

const BUBBLE_W = 220;
const FONT = 13;
const PAD_X = 20;
const PAD_Y = 12;
const LINE = 1.35;
const CHAR_EM = 0.6;
const STACK_GAP = 6;

function bubbleHeight(text:string):number {
	const charsPerLine = Math.max(1, Math.floor((BUBBLE_W - PAD_X) / (FONT * CHAR_EM)));
	let lines = 0;
	for (const part of text.split('\n')) {
		lines += Math.ceil(Math.max(1, part.length) / charsPerLine);
	}
	return lines * FONT * LINE + PAD_Y;
}

/** Pixels of the overhead column under the bubble (status, health, padding). */
function belowBubble(s:HudSpeech):number {
	let h = 8;
	if (s.status) {
		const lines = Math.min(3, Math.max(1, Math.ceil(s.status.length / 28)));
		h += 4 + lines * 11 * 1.3;
	}
	if (s.maxHP > 0) {
		h += 4 + 9;
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
		const height = bubbleHeight(s.text);
		const left = s.x - BUBBLE_W / 2;
		let top = s.y - belowBubble(s) - height;
		for (const newer of boxes) {
			const overlapsX = left < newer.right + STACK_GAP && left + BUBBLE_W > newer.left - STACK_GAP;
			if (!overlapsX) {
				continue;
			}
			const above = newer.top - STACK_GAP - height;
			if (above < top) {
				top = above;
			}
		}
		boxes.push({ left, right: left + BUBBLE_W, top, bottom: top + height });
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
	return `translateY(${shift}px)`;
}

function fillPct(s:HudSpeech):number {
	if (s.maxHP <= 0) {
		return 0;
	}
	return Math.max(0, Math.min(100, (s.hp / s.maxHP) * 100));
}

function fillColor(s:HudSpeech):string {
	const t = s.maxHP <= 0 ? 0 : s.hp / s.maxHP;
	if (t <= 0) {
		return '#3a322c';
	}
	if (t <= 0.34) {
		return '#c43c2c';
	}
	if (t <= 0.67) {
		return '#d4a017';
	}
	return '#5b9a3a';
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
				:style="{ transform: shiftOf(s) }"
			>{{ s.text }}</div>
			<div v-if="s.status" class="status">{{ s.status }}</div>
			<div v-if="s.maxHP > 0" class="hp">
				<div class="hp-track">
					<div
						class="hp-fill"
						:style="{ width: `${fillPct(s)}%`, background: fillColor(s) }"
					/>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.speech-layer {
	position: absolute;
	inset: 0;
	pointer-events: none;
	overflow: hidden;
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
	box-sizing: border-box;
	width: 220px;
	padding: 6px 10px;
	border-radius: 6px;
	background: rgba(18, 14, 10, 0.78);
	color: #f0e6c8;
	font-family: ui-monospace, "Cascadia Code", monospace;
	font-size: 13px;
	line-height: 1.35;
	text-align: center;
	letter-spacing: 0.02em;
	text-shadow: 0 1px 0 #1a1208;
	box-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
	white-space: pre-wrap;
}

.status {
	color: #d4c4a0;
	font-family: ui-monospace, "Cascadia Code", monospace;
	font-size: 11px;
	line-height: 1.3;
	text-align: center;
	letter-spacing: 0.03em;
	text-shadow: 0 1px 0 #1a1208;
	opacity: 0.9;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 3;
	overflow: hidden;
}

.hp {
	padding-bottom: 2px;
}

.hp-track {
	width: 38px;
	height: 5px;
	background: rgba(18, 14, 10, 0.82);
	border: 1px solid #2a1c10;
	box-shadow: 0 1px 0 rgba(0, 0, 0, 0.45);
	overflow: hidden;
}

.hp-fill {
	height: 100%;
}
</style>
