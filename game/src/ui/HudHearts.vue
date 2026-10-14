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
			<img class="empty" :src="heartSrc" width="40" height="40" alt="" aria-hidden="true">
			<img
				v-if="fill > 0"
				class="full"
				:src="heartSrc"
				width="40"
				height="40"
				alt=""
				aria-hidden="true"
				:style="{ '--fill': fill }"
			>
		</span>
	</div>
</template>

<style scoped>
/* No panel round the hearts (NOTES.md › HUD): they stand on the world on their own short shadow. */
.hud-hearts {
	position: absolute;
	top: 14px;
	/* Clear of the back button in the corner. */
	left: 60px;
	display: flex;
	gap: 6px;
	pointer-events: none;
}

.heart {
	position: relative;
	width: 40px;
	height: 40px;
}

.heart img {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	image-rendering: pixelated;
}

.empty {
	filter: brightness(0) drop-shadow(var(--shadow));
	opacity: 0.35;
}

.full {
	filter: drop-shadow(var(--shadow));
	mask-image: conic-gradient(transparent calc((1 - var(--fill)) * 360deg), #000 0);
	-webkit-mask-image: conic-gradient(transparent calc((1 - var(--fill)) * 360deg), #000 0);
}
</style>
