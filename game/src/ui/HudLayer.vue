<script setup lang="ts">
import type { HudModel } from './hudModel';
import HudHearts from './HudHearts.vue';
import HudDiamonds from './HudDiamonds.vue';
import HudCounts from './HudCounts.vue';
import HudMinimap from './HudMinimap.vue';
import HudMessage from './HudMessage.vue';
import HudInventory from './HudInventory.vue';
import HudSpeech from './HudSpeech.vue';
import HudChat from './HudChat.vue';
import HudAiLog from './HudAiLog.vue';
import HudSay from './HudSay.vue';
import HudMenu from './HudMenu.vue';

defineProps<{
	hud:HudModel;
}>();

const emit = defineEmits<{
	scenes: [];
}>();
</script>

<template>
	<div class="hud-layer">
		<HudSpeech :hud="hud" />
		<HudHearts :hud="hud" />
		<HudDiamonds :hud="hud" />
		<HudCounts :hud="hud" />
		<HudInventory :hud="hud" />
		<HudMessage :hud="hud" />
		<HudChat :hud="hud" />
		<HudAiLog :hud="hud" />
		<HudSay :hud="hud" />
		<HudMenu :hud="hud" @scenes="emit('scenes')" />
		<HudMinimap :hud="hud" />
	</div>
</template>

<style scoped>
.hud-layer {
	position: absolute;
	inset: 0;
	z-index: 5;
	pointer-events: none;
}
</style>
