<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue';
import { SCENES } from '../data/scenes';
import type { HudModel } from './hudModel';
import { briefSeen, markBriefSeen } from './briefs';

const props = defineProps<{
	hud:HudModel;
	sceneID:string;
}>();

const scene = computed(() => SCENES[props.sceneID]);

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

function fly(el:Element, done:()=>void, open:boolean):void {
	const panel = el.querySelector('.panel') as HTMLElement;
	el.getAnimations().forEach((a) => a.cancel());
	panel.getAnimations().forEach((a) => a.cancel());
	const btn = el.parentElement!.querySelector('.brief-btn')!.getBoundingClientRect();
	const box = panel.getBoundingClientRect();
	const dx = btn.left + btn.width / 2 - box.left - box.width / 2;
	const dy = btn.top + btn.height / 2 - box.top - box.height / 2;
	const opts:KeyframeAnimationOptions = {
		duration: 200,
		easing: 'cubic-bezier(.2,.8,.2,1)',
		fill: 'both',
		direction: open ? 'normal' : 'reverse',
	};
	el.animate([{ opacity: 0 }, { opacity: 1 }], opts);
	panel.animate(
		[{ transform: `translate(${dx}px, ${dy}px) scale(0.05)` }, { transform: 'none' }],
		opts,
	).finished.then(() => done(), () => undefined);
}
</script>

<template>
	<div class="brief-root">
		<button
			type="button"
			class="brief-btn"
			:class="{ on: hud.briefOpen, away: hud.menuOpen }"
			:aria-expanded="hud.briefOpen"
			aria-label="About this scene"
			@click.stop="toggle"
		>
			?
		</button>
		<Transition :css="false" @enter="(el, done) => fly(el, done, true)" @leave="(el, done) => fly(el, done, false)">
		<div
			v-if="hud.briefOpen && scene"
			class="dim"
			@click.stop="close"
		>
			<div
				class="panel"
				role="dialog"
				aria-labelledby="scene-brief-title"
				@click.stop
			>
				<header class="head">
					<h2 id="scene-brief-title">{{ scene.title }}</h2>
					<button type="button" class="close" @click.stop="close">Close</button>
				</header>
				<p class="copy">{{ scene.brief }}</p>
			</div>
		</div>
		</Transition>
	</div>
</template>

<style scoped>
.brief-root {
	--ink: #1a1208;
	--parchment: #d4c4a0;
	--cream: #f0e6c8;
	--highlight: #fff6dc;
	--rule: #c4b490;
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.brief-btn {
	position: absolute;
	top: 16px;
	right: 96px;
	width: 32px;
	height: 32px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	pointer-events: auto;
	z-index: 3;
	font-family: ui-monospace, "Cascadia Code", monospace;
	font-size: 18px;
	line-height: 32px;
	color: var(--ink);
	background: var(--parchment);
	cursor: pointer;
	box-shadow: 0 2px 0 var(--ink), 0 4px 12px rgba(0, 0, 0, 0.35);
}

.brief-btn:hover,
.brief-btn.on {
	background: var(--cream);
}

.brief-btn.away {
	visibility: hidden;
}

.dim {
	position: absolute;
	inset: 0;
	pointer-events: auto;
	background: rgba(8, 6, 4, 0.62);
	display: flex;
	align-items: center;
	justify-content: center;
}

.panel {
	width: min(760px, 92vw);
	max-height: min(82vh, 720px);
	display: flex;
	flex-direction: column;
	background: var(--parchment);
	color: var(--ink);
	font-family: ui-monospace, "Cascadia Code", monospace;
	box-shadow: 0 2px 0 var(--ink), 0 16px 40px rgba(0, 0, 0, 0.45);
}

.head {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 12px 16px;
	border-bottom: 1px solid var(--rule);
}

h2 {
	margin: 0;
	font-size: 15px;
	font-weight: 700;
	letter-spacing: 0.18em;
	text-transform: uppercase;
}

.close {
	font: inherit;
	font-size: 13px;
	padding: 6px 12px;
	color: var(--ink);
	background: var(--cream);
	border: 0;
	cursor: pointer;
	box-shadow: 0 2px 0 var(--ink);
}

.close:hover {
	background: var(--highlight);
}

.copy {
	margin: 0;
	padding: 28px 32px 32px;
	overflow: auto;
	font-size: 16px;
	line-height: 1.5;
	white-space: pre-wrap;
}
</style>
