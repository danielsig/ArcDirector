<script setup lang="ts">
import { computed } from 'vue';
import type { HudModel } from './hudModel';
import { thinksWith } from '../director/inference';

const props = defineProps<{
	hud:HudModel;
}>();

/** The model NPCs think with and where it runs; empty while ArcDirector is off. */
const label = computed(() => (props.hud.arcDirectorOn ? thinksWith(props.hud.activeModel) : ''));
</script>

<template>
	<div v-if="label" class="hud-model-name" aria-label="Model NPCs think with">{{ label }}</div>
</template>

<style scoped>
/* Along the bottom edge, under the pickup messages: on the world with no panel, like the gold count. */
.hud-model-name {
	position: absolute;
	left: 50%;
	bottom: 8px;
	transform: translateX(-50%);
	font-family: var(--font);
	font-size: 13px;
	font-weight: 700;
	white-space: nowrap;
	color: var(--on-world);
	text-shadow: var(--on-world-edge);
	opacity: 0.85;
	pointer-events: none;
}
</style>
