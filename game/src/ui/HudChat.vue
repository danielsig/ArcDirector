<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { HudModel } from './hudModel';

const props = defineProps<{
	hud:HudModel;
}>();

const logEl = ref<HTMLElement | null>(null);

function atBottom(el:HTMLElement):boolean {
	return el.scrollHeight - el.scrollTop - el.clientHeight < 8;
}

watch(
	() => [props.hud.chat.length, props.hud.chatOpen] as const,
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
	<div v-if="hud.chatOpen" class="hud-chat" aria-label="chat history">
		<div class="head">Chat <span class="hint">Tab to close</span></div>
		<div ref="logEl" class="log">
			<div v-if="hud.chat.length === 0" class="empty">No one has spoken yet.</div>
			<div v-for="(line, i) in hud.chat" :key="i" class="line" :class="{ act: line.act }">
				<div class="who">
					{{ line.speaker }}<template v-if="line.to"> → {{ line.to }}</template>
				</div>
				<div class="said">{{ line.text }}</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
/* The chat history: a parchment panel under the hearts and gold, as the pause menu's. */
.hud-chat {
	position: absolute;
	top: 98px;
	left: 14px;
	width: min(360px, 42vw);
	max-height: min(52vh, 420px);
	display: flex;
	flex-direction: column;
	pointer-events: auto;
	color: var(--ink);
	font-family: var(--font);
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-radius: var(--radius);
	box-shadow: var(--shadow-panel);
	overflow: hidden;
}

.head {
	flex: 0 0 auto;
	padding: 10px 14px 8px;
	font-size: 18px;
	font-weight: 700;
	border-bottom: var(--line-thin) solid var(--ink-soft);
}

.hint {
	float: right;
	margin-top: 3px;
	font-size: 12px;
	font-weight: 400;
	opacity: 0.6;
}

.log {
	flex: 1 1 auto;
	overflow-y: auto;
	padding: 10px 14px 12px;
	min-height: 80px;
}

.empty {
	opacity: 0.6;
	font-size: 14px;
}

.line {
	margin-bottom: 10px;
}

.line:last-child {
	margin-bottom: 0;
}

.who {
	margin-bottom: 1px;
	font-size: 13px;
	font-weight: 700;
	color: var(--gold-deep);
}

.said {
	font-size: 14px;
	line-height: 1.4;
	white-space: pre-wrap;
}

/* Something done, not said: in italics, a little fainter. */
.act .who,
.act .said {
	font-style: italic;
	opacity: 0.75;
}
</style>
