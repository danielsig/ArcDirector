<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import HudSlate from './HudSlate.vue';
import type { HudModel } from './hud-model';
import { separate, type Box } from './separate';

const props = defineProps<{
	hud:HudModel;
}>();

/** What slates keep clear of: spoken lines and the card beside a character. */
const WALLS = '.bubbles .bubble, .hud-inspect';
/** Room kept along each edge of the screen, and along the top for the row of hearts, goals and buttons, px. */
const EDGE = 8;
const TOP = 58;
/** How quickly a slate goes where it wants to be, per second: fast enough to keep up with its writer, slow enough to slide. */
const FOLLOW = 7;

const root = ref<HTMLElement | null>(null);
/** Where each slate is now: its top left corner, carried over frames so they slide rather than jump. */
const placed = new Map<string, Box>();

let frame = 0;
let last = performance.now();

function settle(dt:number):void {
	const layer = root.value;
	if (!layer) {
		return;
	}
	const elements = new Map([...layer.children].map((el) => [(el as HTMLElement).dataset.slate!, el as HTMLElement]));
	for (const id of placed.keys()) {
		if (!elements.has(id)) {
			placed.delete(id);
		}
	}
	const up = props.hud.slates.filter((slate) => slate.visible && elements.has(slate.id));
	if (up.length === 0) {
		return;
	}
	const screen = layer.getBoundingClientRect();
	const boxes = up.map((slate) => {
		const el = elements.get(slate.id)!;
		const h = el.offsetHeight;
		const w = el.offsetWidth;
		const box = placed.get(slate.id);
		if (!box) {
			const start = { x: slate.x, y: slate.y - h, w, h };
			placed.set(slate.id, start);
			return start;
		}
		const pull = Math.min(1, dt * FOLLOW);
		// It grows upward: its foot stays put as a line is added.
		box.y -= h - box.h;
		box.h = h;
		box.w = w;
		box.x += (slate.x - box.x) * pull;
		box.y += (slate.y - h - box.y) * pull;
		return box;
	});
	const walls = [...document.querySelectorAll(WALLS)].flatMap((wall):Box[] => {
		const rect = wall.getBoundingClientRect();
		return rect.width > 0 ? [{ x: rect.left - screen.left, y: rect.top - screen.top, w: rect.width, h: rect.height }] : [];
	});
	separate(boxes, walls, { left: EDGE, top: TOP, right: screen.width - EDGE, bottom: screen.height - EDGE });
	up.forEach((slate, i) => {
		const box = boxes[i]!;
		elements.get(slate.id)!.style.translate = `${Math.round(box.x)}px ${Math.round(box.y)}px`;
	});
}

function step(now:number):void {
	settle((now - last) / 1000);
	last = now;
	frame = requestAnimationFrame(step);
}

onMounted(() => {
	frame = requestAnimationFrame(step);
});

onBeforeUnmount(() => {
	cancelAnimationFrame(frame);
});
</script>

<template>
	<div ref="root" class="hud-slates">
		<HudSlate
			v-for="slate in hud.slates"
			:key="slate.id"
			:data-slate="slate.id"
			:slate="slate"
		/>
	</div>
</template>

<style scoped>
.hud-slates {
	z-index: var(--z-world);
	position: absolute;
	inset: 0;
	pointer-events: none;
}
</style>
