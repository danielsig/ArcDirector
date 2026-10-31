<script setup lang="ts">
withDefaults(defineProps<{
	/** Sparks flung out. */
	sparks?:number;
}>(), { sparks: 10 });
</script>

<template>
	<span class="hud-burst" aria-hidden="true">
		<span class="ring" />
		<span class="ring late" />
		<span class="rays" />
		<span v-for="s in sparks" :key="s" class="spark" :style="{ '--a': `${(s / sparks) * 360 + 18}deg` }" />
	</span>
</template>

<style scoped>
/* Something reached, in its side's colour (`.hue-*`): the goal orbs' level-up, filling whatever it is put in. */
.hud-burst {
	position: absolute;
	inset: 0;
	pointer-events: none;
}

/* Shockwave rings */
.ring {
	position: absolute;
	inset: 0;
	border-radius: 50%;
	border: 3px solid var(--hue);
	box-shadow: 0 0 12px var(--hue), inset 0 0 12px var(--hue);
	animation: hud-ring 800ms var(--ease-out) forwards;
}

.ring.late {
	border-color: #fffbe8;
	animation-delay: 160ms;
	opacity: 0;
}

/* Light rays turning behind it */
.rays {
	position: absolute;
	inset: -30px;
	z-index: -1;
	border-radius: 50%;
	background: repeating-conic-gradient(from 0deg, var(--hue) 0 8deg, transparent 8deg 30deg);
	mask-image: radial-gradient(circle, #000 20%, transparent 70%);
	-webkit-mask-image: radial-gradient(circle, #000 20%, transparent 70%);
	animation: rays 1400ms ease-out forwards;
}

/* Sparks flung outward, each down its own angle */
.spark {
	position: absolute;
	z-index: 2;
	left: 50%;
	top: 50%;
	width: 8px;
	height: 8px;
	margin: -4px;
	background: #fffbe8;
	clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
	filter: drop-shadow(0 0 3px var(--hue));
	animation: spark 900ms var(--ease-out) forwards;
}

.spark:nth-of-type(even) {
	width: 5px;
	height: 5px;
	margin: -2.5px;
	animation-duration: 1100ms;
}

@keyframes rays {
	0% { transform: scale(0.3) rotate(0deg); opacity: 0; }
	20% { opacity: 0.9; }
	100% { transform: scale(1.2) rotate(90deg); opacity: 0; }
}

@keyframes spark {
	0% { transform: rotate(var(--a)) translateY(0) scale(0.4); opacity: 1; }
	60% { opacity: 1; }
	100% { transform: rotate(var(--a)) translateY(-46px) scale(1.2) rotate(180deg); opacity: 0; }
}
</style>
