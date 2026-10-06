<script setup lang="ts">
import { ref, watch } from 'vue';
import type { HudModel } from './hudModel';

const LIFE_MS = 6000;

const props = defineProps<{
	hud:HudModel;
}>();

const text = ref('');
let timer:number | undefined;

watch(
	() => props.hud.aiLog[props.hud.aiLog.length - 1]?.seq,
	() => {
		const last = props.hud.aiLog[props.hud.aiLog.length - 1];
		if (!last?.error) {
			return;
		}
		// Log message is `<ms>\n<error>` for inference failures; show the error line(s).
		text.value = `${last.name}: ${last.message.replace(/^\d+ms\n/, '')}`;
		window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			text.value = '';
		}, LIFE_MS);
	},
);
</script>

<template>
	<div v-if="text" class="hud-toast" role="alert">{{ text }}</div>
</template>

<style scoped>
.hud-toast {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	padding: 2px 10px;
	background: rgba(176, 32, 32, 0.92);
	color: #fff;
	font-family: ui-monospace, "Cascadia Code", monospace;
	font-size: 12px;
	line-height: 1.3;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	pointer-events: none;
}
</style>
