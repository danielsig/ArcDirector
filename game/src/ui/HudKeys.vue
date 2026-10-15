<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { SCENES } from '../data/scenes';
import type { HudModel } from './hudModel';
import { readBackquoteGlyph, universalKeys } from './bindings';
import HudDialog from './HudDialog.vue';

const props = defineProps<{
	hud:HudModel;
	sceneID:string;
}>();

const scene = computed(() => SCENES[props.sceneID]);
const btn = useTemplateRef('btn');
const consoleKey = ref('~');
const rows = computed(() => universalKeys(consoleKey.value));

/** Reads what the AI log's key is printed with on the keyboard layout in use now. */
function readConsoleKey():void {
	void readBackquoteGlyph().then((glyph) => {
		consoleKey.value = glyph;
	});
}

// The layout can change at any time (a language switch), so read it each time the window opens,
// and again on any key press while it is open.
watch(() => props.hud.keysOpen, (open) => {
	if (open) {
		readConsoleKey();
	}
}, { immediate: true });

function onAnyKey():void {
	if (props.hud.keysOpen) {
		readConsoleKey();
	}
}

onMounted(() => {
	window.addEventListener('keydown', onAnyKey);
});

watch(
	() => props.hud.menuOpen,
	(open) => {
		if (open) {
			props.hud.keysOpen = false;
		}
	},
);

onUnmounted(() => {
	window.removeEventListener('keydown', onAnyKey);
	props.hud.keysOpen = false;
});

function toggle():void {
	if (props.hud.menuOpen) {
		return;
	}
	props.hud.keysOpen = !props.hud.keysOpen;
	if (props.hud.keysOpen) {
		props.hud.briefOpen = false;
	}
}

function close():void {
	props.hud.keysOpen = false;
}
</script>

<template>
	<div class="keys-root">
		<button
			ref="btn"
			type="button"
			class="keys-btn"
			:class="{ on: hud.keysOpen, away: hud.menuOpen }"
			:aria-expanded="hud.keysOpen"
			aria-label="Keys"
			@click.stop="toggle"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<rect x="1" y="4" width="22" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6" />
				<rect x="3.2" y="6.3" width="2.5" height="2.5" fill="currentColor" />
				<rect x="6.9" y="6.3" width="2.5" height="2.5" fill="currentColor" />
				<rect x="10.6" y="6.3" width="2.5" height="2.5" fill="currentColor" />
				<rect x="14.3" y="6.3" width="2.5" height="2.5" fill="currentColor" />
				<rect x="18" y="6.3" width="2.5" height="2.5" fill="currentColor" />
				<rect x="4.2" y="10.2" width="2.5" height="2.5" fill="currentColor" />
				<rect x="7.9" y="10.2" width="2.5" height="2.5" fill="currentColor" />
				<rect x="11.6" y="10.2" width="2.5" height="2.5" fill="currentColor" />
				<rect x="15.3" y="10.2" width="2.5" height="2.5" fill="currentColor" />
				<rect x="6.2" y="14.2" width="11.6" height="2.4" rx="0.4" fill="currentColor" />
			</svg>
		</button>
		<HudDialog :open="hud.keysOpen && !!scene" title="Keys" :width="480" :from="btn" @close="close">
			<dl>
				<div v-for="row in rows" :key="row.action" class="row">
					<dt>{{ row.action }}</dt>
					<dd>{{ row.key }}</dd>
				</div>
			</dl>
			<section v-if="scene && scene.keys.length > 0">
				<h3>{{ scene.title }}</h3>
				<dl>
					<div v-for="row in scene.keys" :key="row.action" class="row">
						<dt>{{ row.action }}</dt>
						<dd>{{ row.key }}</dd>
					</div>
				</dl>
			</section>
		</HudDialog>
	</div>
</template>

<style scoped>
.keys-root {
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.keys-btn {
	position: absolute;
	top: 14px;
	/* Left of Menu (14 + 112 + 12). */
	right: 138px;
	width: var(--btn);
	height: var(--btn);
	padding: 0;
	pointer-events: auto;
	z-index: 3;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--ink);
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-radius: 50%;
	box-shadow: var(--shadow);
	cursor: pointer;
}

.keys-btn svg {
	width: 30px;
	height: 30px;
	display: block;
}

.keys-btn:focus {
	outline: none;
}

.keys-btn:focus-visible {
	outline: 2px solid var(--ink);
	outline-offset: 2px;
}

.keys-btn:hover,
.keys-btn.on {
	background: var(--parchment-deep);
}

.keys-btn.away {
	visibility: hidden;
}

h3 {
	margin: 0 0 6px;
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	opacity: 0.7;
}

section {
	margin-top: 16px;
}

dl {
	margin: 0;
}

.row {
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 16px;
	align-items: baseline;
	padding: 5px 0;
	border-bottom: 1px solid var(--ink-soft);
}

dt {
	margin: 0;
}

dd {
	margin: 0;
	font-weight: 700;
	text-align: right;
}
</style>
