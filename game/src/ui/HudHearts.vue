<script setup lang="ts">
import type { HudModel } from './hudModel';

defineProps<{
	hud:HudModel;
}>();

const heartSrc = `${import.meta.env.BASE_URL}heart.png`;
</script>

<template>
	<div class="hud-hearts" aria-label="Health">
		<img
			v-for="i in hud.maxHP"
			:key="i"
			class="heart"
			:class="{ filled: i <= hud.hp }"
			:src="heartSrc"
			width="32"
			height="32"
			alt=""
			aria-hidden="true"
		>
	</div>
</template>

<style scoped>
.hud-hearts {
	position: absolute;
	top: 16px;
	left: 16px;
	display: flex;
	gap: 4px;
	pointer-events: none;
}

.heart {
	image-rendering: pixelated;
	filter: grayscale(1) brightness(0.4);
	opacity: 0.7;
}

.heart.filled {
	filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.55));
	opacity: 1;
}
</style>
