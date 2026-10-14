<script setup lang="ts">
import type { HudModel } from './hudModel';

defineProps<{
	hud:HudModel;
}>();
</script>

<template>
	<div class="hud-counts">
		<div v-if="hud.showGold" class="row" aria-label="Gold"><span class="coin" aria-hidden="true" />{{ hud.gold }}</div>
	</div>
</template>

<style scoped>
/* Gold under the hearts, on the world with no panel (mockup-calm-glen.jpg). */
.hud-counts {
	position: absolute;
	top: 62px;
	left: 62px;
	font-family: var(--font);
	font-size: 20px;
	font-weight: 700;
	color: var(--on-world);
	text-shadow: var(--on-world-edge);
	pointer-events: none;
}

.row {
	display: flex;
	align-items: center;
	gap: 8px;
	line-height: 1;
	font-variant-numeric: tabular-nums;
}

.coin {
	width: 22px;
	height: 22px;
	border-radius: 50%;
	background: var(--gold);
	border: var(--line-thin) solid var(--ink);
	box-shadow: inset 0 0 0 3px var(--gold-deep), var(--shadow);
}
</style>
