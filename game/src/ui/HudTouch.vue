<script setup lang="ts">
import { computed, inject, onUnmounted, ref } from 'vue';
import type { HudModel } from './hud-model';
import { sessionKey } from './session-key';

defineProps<{
	hud:HudModel;
}>();

/** How far the knob travels from the stick's middle, in pixels. */
const REACH = 48;
/** Under this much of its reach, the stick is at rest. */
const DEAD = 0.12;

const session = inject(sessionKey);
const knob = ref({ x: 0, y: 0 });
const knobStyle = computed(() => ({ transform: `translate(${knob.value.x * REACH}px, ${knob.value.y * REACH}px)` }));

function setStick(x:number, y:number):void {
	knob.value = { x, y };
	const input = session?.value?.gameObject.world?.input;
	if (input) {
		const moving = Math.hypot(x, y) >= DEAD;
		input.stickX = moving ? x : 0;
		input.stickY = moving ? -y : 0;
	}
}

function moveStick(e:PointerEvent):void {
	const stick = e.currentTarget as HTMLElement;
	if (!stick.hasPointerCapture(e.pointerId)) {
		return;
	}
	const rect = stick.getBoundingClientRect();
	const x = (e.clientX - (rect.left + rect.width / 2)) / REACH;
	const y = (e.clientY - (rect.top + rect.height / 2)) / REACH;
	const len = Math.max(1, Math.hypot(x, y));
	setStick(x / len, y / len);
}

function grabStick(e:PointerEvent):void {
	(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	moveStick(e);
}

onUnmounted(() => setStick(0, 0));
</script>

<template>
	<div
		class="stick"
		aria-label="Move"
		@pointerdown="grabStick"
		@pointermove="moveStick"
		@pointerup="setStick(0, 0)"
		@pointercancel="setStick(0, 0)"
	>
		<div class="knob" :style="knobStyle" />
	</div>
	<button
		v-if="!hud.sayOpen"
		type="button"
		class="quick-btn chat"
		aria-label="Say something"
		@click="session?.openSay()"
	>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
			<path d="M4 5h16v11H10l-5 4v-4H4z" />
		</svg>
	</button>
</template>

<style scoped>
/* Above the hotbar on the left, within a thumb's reach. */
.stick {
	position: absolute;
	left: 28px;
	bottom: 104px;
	width: 128px;
	height: 128px;
	display: flex;
	align-items: center;
	justify-content: center;
	pointer-events: auto;
	touch-action: none;
	background: rgba(244, 231, 197, 0.22);
	border: var(--line) solid var(--ink);
	border-radius: 50%;
}

.knob {
	width: 56px;
	height: 56px;
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-radius: 50%;
	box-shadow: var(--shadow);
	pointer-events: none;
}

/* On top of the minimap in the corner. */
.chat {
	top: auto;
	right: 16px;
	bottom: 140px;
}
</style>
