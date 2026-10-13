<script setup lang="ts">
import { computed } from 'vue';
import type { HudModel } from './hudModel';

const props = defineProps<{
	hud:HudModel;
}>();

const heartSrc = `${import.meta.env.BASE_URL}heart.png`;
const PER = 4;

const fills = computed(() => {
	const n = Math.max(0, Math.ceil(props.hud.maxHP / PER));
	return Array.from({ length: n }, (element, i) => Math.max(0, Math.min(1, (props.hud.hp - i * PER) / PER)));
});
</script>

<template>
	<div class="hud-hearts" aria-label="Health">
		<span v-for="(fill, i) in fills" :key="i" class="heart">
			<img class="empty" :src="heartSrc" width="32" height="32" alt="" aria-hidden="true">
			<img
				v-if="fill > 0"
				class="full"
				:src="heartSrc"
				width="32"
				height="32"
				alt=""
				aria-hidden="true"
				:style="{ '--fill': fill }"
			>
		</span>
	</div>
</template>

<style scoped>
.hud-hearts {
	position: absolute;
	top: 16px;
	/* Clear of the back button in the corner. */
	left: 60px;
	display: flex;
	gap: 4px;
	pointer-events: none;
}

.heart {
	position: relative;
	width: 32px;
	height: 32px;
}

.heart img {
	position: absolute;
	inset: 0;
	image-rendering: pixelated;
}

.empty {
	filter: grayscale(1) brightness(0.4);
	opacity: 0.7;
}

.full {
	filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.55));
	mask-image: conic-gradient(transparent calc((1 - var(--fill)) * 360deg), #000 0);
	-webkit-mask-image: conic-gradient(transparent calc((1 - var(--fill)) * 360deg), #000 0);
}
</style>
