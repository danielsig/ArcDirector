<script setup lang="ts">
import { computed } from 'vue';

/**
 * A keyboard keycap drawn inline with text, one line tall, in the text's color.
 * `label` is printed on the cap, except keys with a drawn symbol (`Enter`: the return arrow).
 */
const props = defineProps<{
	label:string;
}>();

const ICONS:Record<string, { path:string; width:number }> = {
	// Down from the top right, then left to an arrowhead: the return arrow.
	Enter: { path: 'M24 5v7H10m3.5-3.5L10 12l3.5 3.5', width: 34 },
	// A rightward arrow into a bar: the tab arrow.
	Tab: { path: 'M9 11h13m-3.5-3.5L22 11l-3.5 3.5M25 7v8', width: 34 },
};

const icon = computed(() => ICONS[props.label]);
// Wide enough for the label at 9 units a letter, never narrower than square.
const width = computed(() => icon.value?.width ?? Math.max(24, props.label.length * 9 + 10));
</script>

<template>
	<svg
		class="hud-key"
		:viewBox="`0 0 ${width} 24`"
		:style="{ width: `${width / 20}em` }"
		role="img"
		:aria-label="label"
	>
		<rect x="1" y="1" :width="width - 2" height="22" rx="4" fill="currentColor" opacity="0.18" />
		<rect x="1" y="1" :width="width - 2" height="22" rx="4" fill="none" stroke="currentColor" stroke-width="1.5" />
		<!-- The cap's front edge, for depth. -->
		<line x1="4" y1="19" :x2="width - 4" y2="19" stroke="currentColor" stroke-width="1" opacity="0.45" />
		<path
			v-if="icon"
			:d="icon.path"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
		<text
			v-else
			:x="width / 2"
			y="10.5"
			text-anchor="middle"
			dominant-baseline="central"
			fill="currentColor"
			font-size="11"
			font-family="inherit"
		>{{ label }}</text>
	</svg>
</template>

<style scoped>
.hud-key {
	display: inline-block;
	height: 1.2em;
	vertical-align: -0.3em;
	margin-right: 0.35em;
}
</style>
