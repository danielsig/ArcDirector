<script setup lang="ts">
import type { HudModel } from './hud-model';
import HudHearts from './HudHearts.vue';
import HudGoals from './HudGoals.vue';
import HudInspect from './HudInspect.vue';
import HudCounts from './HudCounts.vue';
import HudMinimap from './HudMinimap.vue';
import HudMessage from './HudMessage.vue';
import HudModelName from './HudModelName.vue';
import HudInventory from './HudInventory.vue';
import HudTouch from './HudTouch.vue';
import HudSpeech from './HudSpeech.vue';
import HudSlates from './HudSlates.vue';
import HudChat from './HudChat.vue';
import HudAiLog from './HudAiLog.vue';
import HudSay from './HudSay.vue';
import HudMenu from './HudMenu.vue';
import HudQuick from './HudQuick.vue';
import HudGuide from './HudGuide.vue';
import HudToast from './HudToast.vue';
import HudStats from './HudStats.vue';
import HudFPS from './HudFPS.vue';
import HudKeyHints from './HudKeyHints.vue';
import { usePrefs } from './use-prefs';

defineProps<{
	hud:HudModel;
	sceneID:string;
}>();

const emit = defineEmits<{
	scenes: [];
}>();

const live = usePrefs();
</script>

<template>
	<div class="hud-layer">
		<HudSpeech :hud="hud" />
		<HudSlates :hud="hud" />
		<HudHearts v-if="live.player === 'participant'" :hud="hud" />
		<HudGoals :hud="hud" />
		<HudInspect :hud="hud" />
		<HudCounts v-if="live.player === 'participant'" :hud="hud" />
		<HudInventory :hud="hud" />
		<HudTouch v-if="hud.touch && live.player !== 'camera' && !hud.menuOpen" :hud="hud" />
		<HudMessage :hud="hud" />
		<HudModelName :hud="hud" />
		<HudChat :hud="hud" />
		<HudAiLog :hud="hud" />
		<HudSay :hud="hud" />
		<HudMinimap :hud="hud" />
		<HudGuide :hud="hud" :sceneID="sceneID" />
		<HudQuick :hud="hud" @scenes="emit('scenes')" />
		<HudMenu :hud="hud" @scenes="emit('scenes')" />
		<HudToast :hud="hud" />
		<HudStats :hud="hud" />
		<HudFPS :hud="hud" />
		<HudKeyHints :hud="hud" />
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
