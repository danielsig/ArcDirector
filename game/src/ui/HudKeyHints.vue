<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { MINIMAP_SIZE, type HudModel } from './hud-model';
import HudKey from './HudKey.vue';

const props = defineProps<{
	hud:HudModel;
}>();

type KeyHint = { key:string; label:string; when:(hud:HudModel) => boolean };

/** Nothing else has the keys: no prompt, menu or guide open. */
const calm = (h:HudModel):boolean => !h.sayOpen && !h.menuOpen && !h.guideOpen;

/** Every key hint the strip can show, in order. Adding a hint is one line. */
const HINTS:KeyHint[] = [
	{ key: 'Enter', label: 'Talk', when: (h) => h.player !== 'camera' && calm(h) },
	{ key: 'Tab', label: 'Chat', when: (h) => h.player === 'camera' && calm(h) },
	{ key: 'Esc', label: 'Close', when: (h) => h.sayOpen },
	{ key: 'Esc', label: 'Free cursor', when: (h) => h.pointerLocked && !h.sayOpen },
];

// Keyboard hints mean nothing on touch.
const shown = computed(() => (props.hud.touch ? [] : HINTS.filter((hint) => hint.when(props.hud))));
const signature = computed(() => shown.value.map((hint) => hint.label).join('|'));

// Bumped whenever the hints change, so the strip remounts and its fade (in, then dim) starts over.
const showings = ref(0);
watch(signature, () => {
	showings.value++;
});
</script>

<template>
	<div v-if="shown.length" :key="showings" class="key-hints" :style="{ bottom: `${MINIMAP_SIZE + 24}px` }">
		<span v-for="hint in shown" :key="hint.key + hint.label" class="hint">
			<HudKey :label="hint.key" />{{ hint.label }}
		</span>
	</div>
</template>

<style scoped>
.key-hints {
	position: absolute;
	/* Bottom right, stacked on the minimap (bottom set inline): where games keep control hints, clear of every panel. */
	right: 16px;
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 3px;
	padding: 0;
	white-space: nowrap;
	font-family: ui-monospace, "Cascadia Code", monospace;
	font-size: 12px;
	letter-spacing: 0.04em;
	color: #f0e6c8;
	/* text-shadow: 0 2px 0 #1a1208; */
	filter: drop-shadow(0 0 1px #1a1208) drop-shadow(0 0 2px #1a120880) drop-shadow(0 2px 0 #1a1208);
	pointer-events: none;
	animation: key-hints-fade 8s ease-out forwards;
}

/* Fades in, stays a few seconds, then dims but stays readable for whoever looks for it. */
@keyframes key-hints-fade {
	0% {
		opacity: 0;
	}
	4%, 60% {
		opacity: 0.9;
	}
	100% {
		opacity: 0.3;
	}
}
</style>
