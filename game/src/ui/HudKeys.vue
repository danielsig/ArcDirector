<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { SCENES } from '../data/scenes';
import type { HudModel } from './hudModel';
import { readBackquoteGlyph, universalKeys } from './bindings';

const props = defineProps<{
	hud:HudModel;
	sceneID:string;
}>();

const scene = computed(() => SCENES[props.sceneID]);
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

function fly(el:Element, done:()=>void, open:boolean):void {
	const panel = el.querySelector('.panel') as HTMLElement;
	el.getAnimations().forEach((a) => a.cancel());
	panel.getAnimations().forEach((a) => a.cancel());
	const btn = el.parentElement!.querySelector('.keys-btn')!.getBoundingClientRect();
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
	<div class="keys-root">
		<button
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
		<Transition :css="false" @enter="(el, done) => fly(el, done, true)" @leave="(el, done) => fly(el, done, false)">
		<div
			v-if="hud.keysOpen && scene"
			class="dim"
			@click.stop="close"
		>
			<div
				class="panel"
				role="dialog"
				aria-labelledby="keys-title"
				@click.stop
			>
				<header class="head">
					<h2 id="keys-title">Keys</h2>
					<button type="button" class="close" @click.stop="close">Close</button>
				</header>
				<div class="body">
					<dl>
						<div v-for="row in rows" :key="row.action" class="row">
							<dt>{{ row.action }}</dt>
							<dd>{{ row.key }}</dd>
						</div>
					</dl>
					<section v-if="scene.keys.length > 0">
						<h3>{{ scene.title }}</h3>
						<dl>
							<div v-for="row in scene.keys" :key="row.action" class="row">
								<dt>{{ row.action }}</dt>
								<dd>{{ row.key }}</dd>
							</div>
						</dl>
					</section>
				</div>
			</div>
		</div>
		</Transition>
	</div>
</template>

<style scoped>
.keys-root {
	--cream: #f0e6c8;
	--highlight: #fff6dc;
	--rule: #c4b490;
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
	background: var(--cream);
}

.keys-btn.away {
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
	width: min(480px, 92vw);
	max-height: min(90vh, 720px);
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

h3 {
	margin: 0 0 8px;
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.14em;
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

.body {
	margin: 0;
	padding: 16px 28px 20px;
	overflow: auto;
	font-size: 15px;
	line-height: 1.4;
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
	border-bottom: 1px solid var(--rule);
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
