<script setup lang="ts">
import { computed } from 'vue';
import type { HudModel } from './hudModel';

const props = defineProps<{
	hud:HudModel;
}>();

const PER = 4;

const fills = computed(() => {
	const n = Math.max(0, Math.ceil(props.hud.maxHP / PER));
	return Array.from({ length: n }, (element, i) => Math.max(0, Math.min(1, (props.hud.hp - i * PER) / PER)));
});

/** One heart or less left: it beats. */
const low = computed(() => props.hud.hp > 0 && props.hud.hp <= PER);

/** A hardcore heart in the 40×40 box: chunky and cut in facets like a gem, straight sides down to a hard point. */
const HEART = 'M20,36L4.5,19.5L3.5,12L7.5,6L14,5L20,10.5L26,5L32.5,6L36.5,12L35.5,19.5Z';

/** The lit facet: everything left of a hard diagonal from the top right to the bottom left. */
const LIT = 'M0,0H27L13,40H0Z';

/**
 * The lit share of a heart, as a wedge round its middle that ends at twelve o'clock: a quarter heart is the last
 * quarter turn, as the hearts have always emptied.
 */
function wedge(fill:number):string {
	if (fill >= 1) {
		return 'M0,0H40V40H0Z';
	}
	const r = 30;
	const from = (1 - fill) * 2 * Math.PI;
	const x = 20 + r * Math.sin(from);
	const y = 20 - r * Math.cos(from);
	return `M20,20L${x.toFixed(2)},${y.toFixed(2)}A${r},${r} 0 ${fill > 0.5 ? 1 : 0} 1 20,${20 - r}Z`;
}
</script>

<template>
	<div class="hud-hearts" aria-label="Health">
		<svg
			v-for="(fill, i) in fills"
			:key="i"
			class="heart"
			:class="{ beat: low && i === 0 }"
			viewBox="0 0 40 40"
			width="40"
			height="40"
			aria-hidden="true"
		>
			<defs>
				<clipPath :id="`heart${i}-shape`">
					<path :d="HEART" />
				</clipPath>
				<clipPath :id="`heart${i}-share`">
					<path :d="wedge(fill)" />
				</clipPath>
			</defs>

			<!--
				Cel shading, flat colours and hard edges: a shadow over the whole heart, its lit facet over the left, then
				a sharp glint. Empty first, then the lit share of it in crimson.
			-->
			<g :clip-path="`url(#heart${i}-shape)`">
				<g class="empty">
					<rect class="shade" width="40" height="40" />
					<path class="base" :d="LIT" />
				</g>
				<g v-if="fill > 0" class="lit" :clip-path="`url(#heart${i}-share)`">
					<rect class="shade" width="40" height="40" />
					<path class="base" :d="LIT" />
					<path class="bounce" d="M33.4,19.4L24.6,29.4" />
				</g>
			</g>
			<g class="shine" :class="{ dim: fill === 0 }">
				<path d="M6.8,14.6L8.6,9.4L13.8,8L9.2,10.8Z" />
				<path d="M15.6,11L17,12.6L15.6,14.2L14.2,12.6Z" />
			</g>
			<path class="outline" :d="HEART" />
		</svg>
	</div>
</template>

<style scoped>
/*
 * No panel round the hearts (NOTES.md › HUD): they stand on the world on their own short shadow. Hardcore and cel-shaded:
 * chunky and faceted, flat red, a hard diagonal shadow, a sharp glint and a heavy ink line. Empty glass is
 * the goal orbs' unlit smoke (HudGoals).
 */
.hud-hearts {
	position: absolute;
	/* Level with the back and restart buttons beside them (40px tall from here) and the goal track. */
	top: 10px;
	/* Clear of the back and restart buttons in the corner. */
	left: 108px;
	display: flex;
	gap: 6px;
	pointer-events: none;
}

.heart {
	overflow: visible;
	filter: drop-shadow(var(--shadow));
}

.empty .shade {
	fill: #1a1220;
}

.empty .base {
	fill: #33253d;
}

.lit .shade {
	fill: #9c1d24;
}

.lit .base {
	fill: #e23b36;
}

/* Light bounced back into the shadow, along the lower right edge */
.bounce {
	fill: none;
	stroke: #ff5a4a;
	stroke-width: 1.4;
	stroke-linecap: round;
}

.shine path {
	fill: #fff;
}

.shine.dim {
	opacity: 0.3;
}

.outline {
	fill: none;
	stroke: var(--ink);
	stroke-width: 3;
	stroke-linejoin: miter;
}

/* The last heart beats, lub-dub, while it is all that is left. */
.beat {
	transform-origin: 50% 55%;
	animation: beat 1s ease-in-out infinite;
}

@keyframes beat {
	0%, 40%, 100% { transform: scale(1); }
	10% { transform: scale(1.14); }
	20% { transform: scale(1.02); }
	30% { transform: scale(1.1); }
}

@media (prefers-reduced-motion: reduce) {
	.beat {
		animation: none;
	}
}
</style>
