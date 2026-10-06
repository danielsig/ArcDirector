<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { HudModel } from './hudModel';

const props = defineProps<{
	hud:HudModel;
}>();

const logEl = ref<HTMLElement | null>(null);

watch(
	() => [props.hud.chat.length, props.hud.chatOpen] as const,
	async () => {
		if (!props.hud.chatOpen) {
			return;
		}
		await nextTick();
		const el = logEl.value;
		if (el) {
			el.scrollTop = el.scrollHeight;
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
.hud-chat {
	position: absolute;
	top: 88px;
	left: 16px;
	width: min(360px, 42vw);
	max-height: min(52vh, 420px);
	display: flex;
	flex-direction: column;
	background: rgba(18, 14, 10, 0.88);
	box-shadow: 0 0 0 2px #1a1208, 0 8px 24px rgba(0, 0, 0, 0.45);
	pointer-events: auto;
	color: #f0e6c8;
	font-family: ui-monospace, "Cascadia Code", monospace;
}

.head {
	flex: 0 0 auto;
	padding: 8px 12px 6px;
	font-size: 12px;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: #d4c4a0;
	border-bottom: 1px solid #3a2a22;
	text-shadow: 0 1px 0 #1a1208;
}

.hint {
	float: right;
	letter-spacing: 0.04em;
	text-transform: none;
	opacity: 0.55;
	font-size: 11px;
}

.log {
	flex: 1 1 auto;
	overflow-y: auto;
	padding: 8px 12px 12px;
	min-height: 80px;
}

.empty {
	opacity: 0.5;
	font-size: 13px;
}

.line {
	margin-bottom: 10px;
}

.line:last-child {
	margin-bottom: 0;
}

.who {
	font-size: 11px;
	letter-spacing: 0.06em;
	color: #c4a574;
	margin-bottom: 2px;
}

.said {
	font-size: 13px;
	line-height: 1.4;
	white-space: pre-wrap;
	text-shadow: 0 1px 0 #1a1208;
}

.act .who {
	color: #8eb8a4;
}

.act .said {
	color: #c5ddd2;
}
</style>
