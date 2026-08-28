<script setup lang="ts">
import type { HudModel } from './hudModel';

defineProps<{
	hud:HudModel;
}>();
</script>

<template>
	<div class="pickup-layer">
		<div
			v-if="hud.pickupHint.visible && hud.pickupHint.name"
			class="tag"
			:style="{ left: `${hud.pickupHint.x}px`, top: `${hud.pickupHint.y}px` }"
		>
			{{ hud.pickupHint.name }}
		</div>
	</div>
</template>

<style scoped>
.pickup-layer {
	position: absolute;
	inset: 0;
	z-index: 0;
	pointer-events: none;
	overflow: hidden;
}

.tag {
	position: absolute;
	transform: translate(-50%, 12px);
	padding: 3px 10px 4px;
	border-radius: 4px;
	background: rgba(14, 11, 8, 0.55);
	border-top: 1px solid rgba(255, 236, 180, 0.28);
	box-shadow: 0 0 14px rgba(232, 196, 110, 0.16);
	color: #fff3c8;
	font-family: ui-monospace, "Cascadia Code", monospace;
	font-size: 13px;
	letter-spacing: 0.06em;
	text-shadow:
		0 0 8px rgba(10, 8, 4, 0.95),
		0 2px 0 #1a1208;
	white-space: nowrap;
}
</style>
