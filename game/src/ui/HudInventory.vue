<script setup lang="ts">
import type { HudModel } from './hudModel';

defineProps<{
	hud:HudModel;
}>();
</script>

<template>
	<div class="hud-inv">
		<div class="line" v-if="hud.heldLeft || hud.heldRight || hud.back">
			<span v-if="hud.heldLeft">L {{ hud.heldLeft }}</span>
			<span v-if="hud.heldRight">R {{ hud.heldRight }}</span>
			<span v-if="hud.back">BACK {{ hud.back }}</span>
		</div>
		<div class="bar">
			<span
				v-for="(it, i) in hud.hotbar"
				:key="i"
				class="slot"
				:class="{ on: it.selected }"
			>{{ i + 1 }} {{ it.name }}{{ it.count > 1 ? ' ×' + it.count : '' }}</span>
		</div>
	</div>
</template>

<style scoped>
.hud-inv {
	position: absolute;
	left: 16px;
	bottom: 16px;
	font-family: ui-monospace, "Cascadia Code", monospace;
	font-size: 12px;
	color: #d8cba8;
	text-shadow: 0 1px 0 #1a1208;
	pointer-events: none;
	max-width: 48%;
}

.line {
	display: flex;
	gap: 12px;
	margin-bottom: 6px;
	opacity: 0.85;
}

.bar {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.slot {
	padding: 3px 6px;
	background: rgba(18, 12, 8, 0.55);
	border: 1px solid #3a2a1c;
}

.slot.on {
	border-color: #e8d5a0;
	color: #fff6d8;
}
</style>
