<script setup lang="ts">
import { fmtMem, type HudModel } from './hud-model';

defineProps<{
	hud:HudModel;
}>();
</script>

<template>
	<div v-if="hud.statsOverlay" class="hud-stats">
		<div>{{ hud.renderStats.frameMSNow.toFixed(1) }} ms (1 s)</div>
		<div>{{ hud.renderStats.frameMS.toFixed(1) }} ms (30 s)</div>
		<div>dir {{ hud.renderStats.phaseMS.director.toFixed(1) }} sim {{ hud.renderStats.phaseMS.simulate.toFixed(1) }} draw {{ hud.renderStats.phaseMS.render.toFixed(1) }} ms</div>
		<div>{{ hud.renderStats.calls }} calls</div>
		<div>{{ hud.renderStats.triangles.toLocaleString() }} tris</div>
		<div>{{ hud.renderStats.geometries }} geometries</div>
		<div>{{ hud.renderStats.textures }} textures</div>
		<div>{{ fmtMem(hud.renderStats.sceneMemory) }} scene</div>
		<div>{{ fmtMem(hud.renderStats.framebufferMemory) }} screen</div>
		<div v-if="hud.renderStats.heapMB !== undefined">{{ hud.renderStats.heapMB }} MB heap</div>
	</div>
</template>

<style scoped>
.hud-stats {
	/* A compact box right under the top-right Menu button (HudMenu), right-aligned with it. */
	position: absolute;
	top: calc(14px + var(--btn) + 6px);
	right: 14px;
	z-index: var(--z-overlay);
	width: max-content;
	text-align: right;
	font-variant-numeric: tabular-nums;
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
