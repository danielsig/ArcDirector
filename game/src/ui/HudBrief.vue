<script setup lang="ts">
import { computed, onUnmounted, useTemplateRef, watch } from 'vue';
import { SCENES } from '../data/scenes';
import type { HudModel } from './hudModel';
import { briefSeen, markBriefSeen } from './briefs';
import HudDialog from './HudDialog.vue';

const props = defineProps<{
	hud:HudModel;
	sceneID:string;
}>();

const scene = computed(() => SCENES[props.sceneID]);
const btn = useTemplateRef('btn');

watch(
	() => props.sceneID,
	(id) => {
		const def = SCENES[id];
		if (!def) {
			props.hud.briefOpen = false;
			return;
		}
		if (briefSeen(id)) {
			props.hud.briefOpen = false;
			return;
		}
		markBriefSeen(id);
		props.hud.briefOpen = true;
	},
	{ immediate: true },
);

watch(
	() => props.hud.menuOpen,
	(open) => {
		if (open) {
			props.hud.briefOpen = false;
		}
	},
);

onUnmounted(() => {
	props.hud.briefOpen = false;
});

function toggle():void {
	if (props.hud.menuOpen) {
		return;
	}
	props.hud.briefOpen = !props.hud.briefOpen;
	if (props.hud.briefOpen) {
		props.hud.keysOpen = false;
	}
}

function close():void {
	props.hud.briefOpen = false;
}
</script>

<template>
	<div class="brief-root">
		<button
			ref="btn"
			type="button"
			class="brief-btn"
			:class="{ on: hud.briefOpen, away: hud.menuOpen }"
			:aria-expanded="hud.briefOpen"
			aria-label="About this scene"
			@click.stop="toggle"
		>
			?
		</button>
		<HudDialog :open="hud.briefOpen && !!scene" :title="scene?.title ?? ''" :width="760" :from="btn" @close="close">
			<p class="copy">{{ scene?.brief }}</p>
		</HudDialog>
	</div>
</template>

<style scoped>
.brief-root {
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.brief-btn {
	position: absolute;
	top: 14px;
	/* Left of the keyboard button. */
	right: 210px;
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
	font-family: var(--font);
	font-size: 26px;
	font-weight: 700;
}

.brief-btn:hover,
.brief-btn.on {
	background: var(--parchment-deep);
}

.brief-btn.away {
	visibility: hidden;
}

.copy {
	margin: 0;
	font-size: 17px;
	line-height: 1.55;
	white-space: pre-wrap;
}
</style>
