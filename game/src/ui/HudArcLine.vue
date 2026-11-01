<script setup lang="ts">
import { ARC_INDENT, type ArcLine } from './arcText';

defineProps<{
	line:ArcLine;
}>();
</script>

<template>
	<div class="line" :style="{ paddingLeft: `${line.indent * ARC_INDENT}ch` }">
		<span
			v-for="(piece, p) in line.pieces"
			:key="p"
			:class="piece.kind"
		>{{ piece.text }}</span>
		<slot />
	</div>
</template>

<style scoped>
/* A line too long wraps at its own indent. */
.line {
	min-height: 1.35em;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.verb {
	color: var(--hue);
}

.said {
	color: var(--hue-light);
}

.mark {
	color: var(--glass-text);
	opacity: 0.55;
}

/* Fixed width, so a rune settling into its letter does not shove the line. */
.rune {
	display: inline-block;
	width: 1ch;
	overflow: visible;
	text-align: center;
	color: var(--hue-light);
	text-shadow: 0 0 5px var(--hue);
	font-family: "Segoe UI Historic", "Noto Sans Runic", var(--font-mono);
	font-weight: 400;
}
</style>
