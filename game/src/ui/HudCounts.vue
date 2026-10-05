<script setup lang="ts">
import type { HudModel } from './hudModel';

defineProps<{
	hud:HudModel;
}>();
</script>

<template>
	<div class="hud-counts">
		<div v-if="hud.showGold" class="row">GOLD {{ hud.gold }}</div>
	</div>
</template>

<style scoped>
.hud-counts {
	position: absolute;
	top: 56px;
	right: 16px;
	font-family: ui-monospace, "Cascadia Code", monospace;
	font-size: 18px;
	letter-spacing: 0.12em;
	color: #f0e6c8;
	text-shadow: 0 2px 0 #1a1208, 0 0 8px #000;
	pointer-events: none;
	text-align: right;
}

.row {
	line-height: 1.35;
}
</style>
