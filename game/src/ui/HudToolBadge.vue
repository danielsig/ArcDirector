<script setup lang="ts">
import { computed, useId } from 'vue';
import HudBurst from './HudBurst.vue';

const props = defineProps<{
	/** The tool's name, as the mind called it. */
	tool:string;
}>();

/** What each known tool says under its icon, and the color of its glass; any other is a look-up. */
const LOOKS:Record<string, { word:string; hue:string; icon:'map' | 'memory' | 'eye' | 'ear' }> = {
	see_map: { word: 'Map', hue: '#e9c46a', icon: 'map' },
	recall: { word: 'Memory', hue: '#c9a6ff', icon: 'memory' },
	observe: { word: 'Looking', hue: '#6cb8ff', icon: 'eye' },
	earshot: { word: 'Listening', hue: '#7fe8b4', icon: 'ear' },
};

/** Its own, as a hidden badge's clip would otherwise be every other badge's. */
const clip = useId();
const look = computed(() => LOOKS[props.tool]);
/** An unknown tool's own name, in words. */
const word = computed(() => look.value?.word ?? props.tool.replace(/_/g, ' '));
</script>

<template>
	<div class="hud-tool-badge" :style="{ '--hue': look?.hue ?? '#e9c46a' }" role="img" :aria-label="word">
		<span class="gem">
			<HudBurst :sparks="6" />
			<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
				<!-- Cut like the hearts: flat colors, a hard diagonal facet, a sharp glint and a heavy ink line. -->
				<defs>
					<clipPath :id="clip"><path d="M20,2L34,8L38,22L28,36H12L2,22L6,8Z" /></clipPath>
				</defs>
				<g :clip-path="`url(#${clip})`">
					<rect class="shade" width="40" height="40" />
					<path class="base" d="M0,0H27L13,40H0Z" />
				</g>
				<g class="mark">
					<template v-if="look?.icon === 'map'">
						<path class="paper" d="M10,12L17,9.5L23,12L30,9.5V27.5L23,30L17,27.5L10,30Z" />
						<path d="M17,9.5V27.5M23,12V30" />
						<path class="red" d="M24.5,15.5L28,19M28,15.5L24.5,19" />
					</template>
					<template v-else-if="look?.icon === 'memory'">
						<path class="paper" d="M20,12C16,9 12,9 9,10.5V27.5C12,26 16,26 20,29C24,26 28,26 31,27.5V10.5C28,9 24,9 20,12Z" />
						<path d="M20,12V29M12.5,15C14.5,14.6 16,15 17.5,16M12.5,20C14.5,19.6 16,20 17.5,21M27.5,15C25.5,14.6 24,15 22.5,16M27.5,20C25.5,19.6 24,20 22.5,21" />
					</template>
					<template v-else-if="look?.icon === 'eye'">
						<path class="paper" d="M7,20C11,13 16,11.5 20,11.5C24,11.5 29,13 33,20C29,27 24,28.5 20,28.5C16,28.5 11,27 7,20Z" />
						<circle class="pupil" cx="20" cy="20" r="5" />
						<circle class="glint" cx="18.3" cy="18.2" r="1.4" />
					</template>
					<template v-else-if="look?.icon === 'ear'">
						<path class="paper" d="M14,17C14,11.5 18,9 22,9C26.5,9 29,12.5 29,16.5C29,21 25,22 24.5,25.5C24,29 21.5,31 18.5,30.5C16,30 14.5,28 15,26" />
						<path d="M18.5,18C18.5,15.5 20,14 22,14C24,14 25,15.5 25,17C25,19 23,19.5 22,21" />
						<path class="wave" d="M9,14C7.5,17.5 7.5,20.5 9,24" />
					</template>
					<template v-else>
						<circle class="paper" cx="18" cy="18" r="8" />
						<path d="M24,24L31,31" />
					</template>
				</g>
				<path class="glint" d="M7.5,13L9,8.5L13.5,7L9.5,9.5Z" />
				<path class="outline" d="M20,2L34,8L38,22L28,36H12L2,22L6,8Z" />
			</svg>
		</span>
		<span class="word">{{ word }}</span>
	</div>
</template>

<style scoped>
/*
 * A cut gem over the head of whoever just called a tool, in the hearts' cel shading, its glass the tool's own color.
 * Pops in like a speech bubble and bursts like a goal orb reached, so it reads from across the screen.
 */
.hud-tool-badge {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 1px;
	animation: pop var(--slow) var(--ease-pop);
}

.gem {
	position: relative;
	width: 40px;
	height: 40px;
	filter: drop-shadow(var(--shadow));
	animation: bob 1.4s ease-in-out infinite;
}

svg {
	position: relative;
	display: block;
	overflow: visible;
}

.shade {
	fill: color-mix(in srgb, var(--hue) 62%, #1a1220);
}

.base {
	fill: var(--hue);
}

.mark path,
.mark circle {
	fill: none;
	stroke: var(--ink);
	stroke-width: 1.6;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.mark .paper {
	fill: var(--parchment);
	stroke-width: 2;
}

.mark .red {
	stroke: var(--health);
	stroke-width: 2;
}

.mark .pupil {
	fill: var(--ink);
}

.mark .wave {
	stroke-width: 2;
}

.glint,
.mark .glint {
	fill: #fff;
	stroke: none;
}

.outline {
	fill: none;
	stroke: var(--ink);
	stroke-width: 3;
	stroke-linejoin: miter;
}

.word {
	color: var(--on-world);
	text-shadow: var(--on-world-edge);
	font-size: 12px;
	font-weight: 700;
	line-height: 14px;
	white-space: nowrap;
}

@keyframes pop {
	from {
		opacity: 0;
		transform: scale(0.5) translateY(8px);
	}
}

@keyframes bob {
	50% { transform: translateY(-3px); }
}

@media (prefers-reduced-motion: reduce) {
	.hud-tool-badge,
	.gem {
		animation: none;
	}
}
</style>
