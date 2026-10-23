<script setup lang="ts">
import { ref } from 'vue';
import type { HudModel } from './hudModel';
import HudDialog from './HudDialog.vue';
import InferencePicker from './InferencePicker.vue';
import MindMenu from './MindMenu.vue';

defineProps<{
	hud:HudModel;
}>();

/** Where NPCs think, picked over the game at the init screen's size. */
const pickerOpen = ref(false);
</script>

<template>
	<div v-if="hud.arcDirectorOn" class="hud-model-name">
		<MindMenu compact :active="hud.activeModel" @change="pickerOpen = true" />
	</div>
	<HudDialog :open="pickerOpen" title="Where should NPCs think?" close-label="Done" @close="pickerOpen = false">
		<InferencePicker @chosen="pickerOpen = false" />
	</HudDialog>
</template>

<style scoped>
/* Along the bottom edge, under the pickup messages: on the world with no panel, like the gold count. */
.hud-model-name {
	position: absolute;
	left: 50%;
	bottom: 4px;
	transform: translateX(-50%);
	pointer-events: auto;
}
</style>
