<script setup lang="ts">
import type { HudModel } from './hudModel';

defineProps<{
	hud:HudModel;
}>();
</script>

<template>
	<div v-if="hud.fpsCounter" class="hud-fps">{{ hud.fps }} FPS</div>
</template>

<style scoped>
/* In the strip above the Menu button, right edges aligned with it. */
.hud-fps {
	position: absolute;
	top: 1px;
	right: 16px;
	font-family: ui-monospace, "Cascadia Code", monospace;
	font-size: 11px;
	line-height: 14px;
	color: #f0e6c8;
	text-shadow: 0 1px 0 #1a1208, 0 0 4px #000;
	pointer-events: none;
}
</style>
