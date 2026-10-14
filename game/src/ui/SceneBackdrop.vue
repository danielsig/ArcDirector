<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { Showcase } from '../engine/Showcase';
import { preloadArt } from '../render/preloadArt';

/** One scene, live and circled by the camera, behind the main menu. Remount (a new `key`) to switch scenes. */
const props = defineProps<{
	sceneID:string;
}>();

const host = ref<HTMLElement | null>(null);
const shown = ref(false);
let game:Showcase | null = null;
let dead = false;

onMounted(async () => {
	try {
		await preloadArt();
	}
	catch (err) {
		console.error(err);
	}
	if (dead || !host.value) {
		return;
	}
	game = new Showcase(props.sceneID);
	game.mount(host.value);
	game.start();
	// Fade in once a frame or two are drawn, not over a blank canvas.
	requestAnimationFrame(() => requestAnimationFrame(() => {
		shown.value = true;
	}));
});

onUnmounted(() => {
	dead = true;
	game?.dispose();
	game = null;
});
</script>

<template>
	<div ref="host" class="backdrop" :class="{ shown }" aria-hidden="true" />
</template>

<style scoped>
.backdrop {
	position: absolute;
	inset: 0;
	pointer-events: none;
	opacity: 0;
	transition: opacity var(--slow) var(--ease-out);
}

.backdrop.shown {
	opacity: 1;
}

.backdrop :deep(canvas) {
	position: absolute;
	inset: 0;
	display: block;
	width: 100%;
	height: 100%;
}
</style>
