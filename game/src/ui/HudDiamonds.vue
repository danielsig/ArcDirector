<script setup lang="ts">
import type { HudModel } from './hudModel';

defineProps<{
	hud:HudModel;
}>();
</script>

<template>
	<div class="hud-diamonds" aria-label="mana">
		<span
			v-for="i in hud.maxMana"
			:key="i"
			class="diamond"
			:class="{ filled: i <= hud.mana }"
		/>
	</div>
</template>

<style scoped>
.hud-diamonds {
	position: absolute;
	top: 52px;
	left: 16px;
	display: flex;
	gap: 5px;
	pointer-events: none;
}

.diamond {
	width: 14px;
	height: 14px;
	transform: rotate(45deg);
	background: #2a3544;
	opacity: 0.55;
	box-shadow: inset 0 0 0 1px #1a222c;
}

.diamond.filled {
	background: #7ec8e8;
	opacity: 1;
	box-shadow: 0 0 6px rgba(126, 200, 232, 0.45);
}
</style>
