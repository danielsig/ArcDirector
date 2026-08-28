<script setup lang="ts">
import type { HudModel } from './hudModel';

defineProps<{
	hud:HudModel;
}>();
</script>

<template>
	<div class="speech-layer">
		<div
			v-for="s in hud.speech"
			v-show="s.visible"
			:key="s.id"
			class="overhead"
			:style="{ left: `${s.x}px`, top: `${s.y}px` }"
		>
			<div v-if="s.text" class="bubble">{{ s.text }}</div>
			<div v-if="s.status" class="status">{{ s.status }}</div>
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
	max-width: 220px;
}

.bubble {
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
</style>
