<script setup lang="ts">
import type { HudModel } from './hudModel';

defineProps<{
	hud:HudModel;
}>();
</script>

<template>
	<div class="hud-message" v-if="hud.message || hud.cursorName">
		<div v-if="hud.cursorName" class="cursor">{{ hud.cursorName }}</div>
		<div v-if="hud.message">{{ hud.message }}</div>
	</div>
</template>

<style scoped>
.hud-message {
	position: absolute;
	left: 50%;
	bottom: 28px;
	transform: translateX(-50%);
	/* Long reads (an inscription) wrap instead of running off screen. */
	width: max-content;
	max-width: min(640px, calc(100vw - 32px));
	font-family: ui-monospace, "Cascadia Code", monospace;
	color: #f0e6c8;
	text-shadow: 0 2px 0 #1a1208;
	text-align: center;
	pointer-events: none;
	letter-spacing: 0.04em;
	font-size: 15px;
}

.cursor {
	opacity: 0.7;
	font-size: 12px;
	margin-bottom: 4px;
}
</style>
