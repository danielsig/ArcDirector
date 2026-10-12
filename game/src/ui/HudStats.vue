<script setup lang="ts">
import { fmtMem, type HudModel } from './hudModel';

defineProps<{
	hud:HudModel;
}>();
</script>

<template>
	<div v-if="hud.statsOverlay" class="hud-stats">
		<div>{{ hud.renderStats.frameMS.toFixed(1) }} ms (30 s)</div>
		<div>{{ hud.renderStats.calls }} calls</div>
		<div>{{ hud.renderStats.triangles.toLocaleString() }} tris</div>
		<div>{{ hud.renderStats.geometries }} geometries</div>
		<div>{{ hud.renderStats.textures }} textures</div>
		<div>{{ fmtMem(hud.renderStats.sceneMemory) }} scene</div>
		<div>{{ fmtMem(hud.renderStats.framebufferMemory) }} screen</div>
	</div>
</template>

<style scoped>
.hud-stats {
	position: absolute;
	top: 16px;
	left: 50%;
	transform: translateX(-50%);
	display: flex;
	gap: 12px;
	white-space: nowrap;
	padding: 4px 8px;
	font-family: ui-monospace, "Cascadia Code", monospace;
	font-size: 12px;
	line-height: 1.4;
	color: #f0e6c8;
	background: rgba(0, 0, 0, 0.55);
	pointer-events: none;
}
</style>
