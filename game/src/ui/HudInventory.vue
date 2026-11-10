<script setup lang="ts">
import { inject } from 'vue';
import type { HudModel } from './hud-model';
import { sessionKey } from './session-key';

defineProps<{
	hud:HudModel;
}>();

const session = inject(sessionKey);
</script>

<template>
	<div class="hud-inv" :class="{ touch: hud.touch }">
		<div class="line" v-if="hud.heldLeft || hud.heldRight || hud.back">
			<span v-if="hud.heldLeft">L {{ hud.heldLeft }}</span>
			<span v-if="hud.heldRight">R {{ hud.heldRight }}</span>
			<span v-if="hud.back">BACK {{ hud.back }}</span>
		</div>
		<div class="bar">
			<button
				v-if="hud.touch && hud.player !== 'camera'"
				type="button"
				class="slot swap"
				aria-label="Swap hands"
				@click="session?.gameObject.world?.input.press('KeyX')"
			>⇄</button>
			<span
				v-for="(it, i) in hud.hotbar"
				:key="i"
				class="slot"
				:class="{ on: it.selected }"
				@click="session?.toggleItem(i)"
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

/* Under a finger: big enough to hit, on one row so the stick above stays clear. */
.touch {
	max-width: 62%;
	font-size: 14px;
}

.touch .bar {
	flex-wrap: nowrap;
	overflow-x: auto;
	scrollbar-width: none;
	pointer-events: auto;
	user-select: none;
	-webkit-user-select: none;
}

.touch .slot {
	flex: none;
	padding: 9px 11px;
	white-space: nowrap;
	cursor: pointer;
}

.swap {
	font: inherit;
	color: inherit;
}
</style>
