<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { HudModel } from './hudModel';
import { tileFill } from '../world/tileFill';
import { CHUNK_SIZE } from '../world/constants';

const props = defineProps<{
	hud:HudModel;
}>();

const cell = 7;
const view = CHUNK_SIZE * cell;
const canvasRef = ref<HTMLCanvasElement | null>(null);

const size = computed(() => ({
	w: view,
	h: view,
}));

function paint():void {
	const canvas = canvasRef.value;
	if (!canvas) {
		return;
	}
	const m = props.hud.minimap;
	const w = Math.max(1, m.width) * cell;
	const h = Math.max(1, m.height) * cell;
	if (canvas.width !== w) {
		canvas.width = w;
	}
	if (canvas.height !== h) {
		canvas.height = h;
	}
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		return;
	}
	ctx.fillStyle = '#141018';
	ctx.fillRect(0, 0, w, h);
	const cells = m.cells;
	const cols = Math.max(1, m.width);
	for (let i = 0; i < cells.length; i++) {
		const c = cells[i];
		ctx.fillStyle = tileFill(c.def, c.blocked, c.height);
		ctx.fillRect((i % cols) * cell, Math.floor(i / cols) * cell, cell, cell);
	}
}

const mapShift = computed(() => {
	const m = props.hud.minimap;
	if (!m.follow) {
		return 'none';
	}
	const tx = Math.round(view / 2 - (m.playerX - m.originX) * cell);
	const ty = Math.round(view / 2 - (m.playerZ - m.originZ) * cell);
	return `translate(${tx}px, ${ty}px)`;
});

const playerPx = computed(() => {
	const m = props.hud.minimap;
	const deg = -(m.playerYaw * 180) / Math.PI;
	if (m.follow) {
		return { x: view / 2, y: view / 2, deg };
	}
	return {
		x: (m.playerX - m.originX) * cell,
		y: (m.playerZ - m.originZ) * cell,
		deg,
	};
});

watch(() => props.hud.minimap.tileRev, paint);
onMounted(paint);
</script>

<template>
	<div class="hud-minimap" :style="{ width: `${size.w}px`, height: `${size.h}px` }" aria-label="minimap">
		<canvas ref="canvasRef" :style="{ transform: mapShift }" />
		<svg
			class="player-overlay"
			:width="size.w"
			:height="size.h"
			:viewBox="`0 0 ${size.w} ${size.h}`"
		>
			<polygon
				class="player"
				points="0,-6 5,5 -5,5"
				:transform="`translate(${playerPx.x}, ${playerPx.y}) rotate(${playerPx.deg})`"
			/>
		</svg>
	</div>
</template>

<style scoped>
.hud-minimap {
	position: absolute;
	right: 16px;
	bottom: 16px;
	overflow: hidden;
	opacity: 0.88;
	pointer-events: none;
	image-rendering: pixelated;
	box-shadow: 0 0 0 2px #1a1208, 0 4px 16px rgba(0, 0, 0, 0.45);
	background: #141018;
}

.hud-minimap canvas {
	position: absolute;
	left: 0;
	top: 0;
	display: block;
	transform-origin: 0 0;
}

.player-overlay {
	position: absolute;
	inset: 0;
	display: block;
}

.player {
	fill: #f4e8c4;
	stroke: #1a1208;
	stroke-width: 1;
}
</style>
