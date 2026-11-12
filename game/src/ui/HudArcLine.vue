<script setup lang="ts">
import { ARC_INDENT, type ArcLine } from './arc-text';

defineProps<{
	line:ArcLine;
}>();
</script>

<template>
	<div class="line" :style="{ paddingLeft: `${line.indent * ARC_INDENT}ch` }">
		<span
			v-for="(piece, p) in line.pieces"
			:key="p"
			:class="[piece.kind, piece.level !== undefined && `level-${piece.level % 3}`]"
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

/* VS Code's Dark+ colors, but for the steps: they stand out in the slate's own hue, a little bolder than the calls that only ask. */
.verb {
	color: var(--hue);
}

.fn {
	color: #dcdcaa;
	font-weight: 500;
}

.plain,
.op,
.mark {
	color: #d4d4d4;
}

.mark {
	opacity: 0.6;
}

.var,
.ending {
	color: #9cdcfe;
}

.key {
	color: #9cdcfe;
	opacity: 0.55;
}

.name {
	color: #4ec9b0;
}

.keyword {
	color: #c586c0;
}

.declare {
	color: #569cd6;
}

.said {
	color: #ce9178;
}

/* Values: the numbers, and close to them the durations and the truths. */
.number {
	color: #b5cea8;
}

.duration {
	color: #c5deb8;
}

.bool {
	color: #a8d4b0;
}

/* Brackets by how deep they stand, VS Code's pair colors: the same three on every slate. */
.level-0 {
	color: #ffd700;
}

.level-1 {
	color: #da70d6;
}

.level-2 {
	color: #179fff;
}

.wrong {
	color: #f14c4c;
	text-decoration: underline wavy #f14c4c;
	text-decoration-skip-ink: none;
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
