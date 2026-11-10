<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { SCENES } from '../data/scenes';
import type { HudModel } from './hud-model';
import { readBackquoteGlyph, universalKeys } from './bindings';
import { briefSeen, markBriefSeen } from './briefs';
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

// A scene's first visit opens it.
watch(
	() => props.sceneID,
	(id) => {
		const first = !!SCENES[id] && !briefSeen(id);
		if (first) {
			markBriefSeen(id);
		}
		props.hud.guideOpen = first;
	},
	{ immediate: true },
);

// The layout can change at any time (a language switch), so read it each time the window opens,
// and again on any key press while it is open.
watch(() => props.hud.guideOpen, (open) => {
	if (open) {
		readConsoleKey();
	}
}, { immediate: true });

function onAnyKey():void {
	if (props.hud.guideOpen) {
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
			props.hud.guideOpen = false;
		}
	},
);

onUnmounted(() => {
	window.removeEventListener('keydown', onAnyKey);
	props.hud.guideOpen = false;
});
</script>

<template>
	<button
		ref="btn"
		type="button"
		class="quick-btn guide"
		:class="{ on: hud.guideOpen, away: hud.menuOpen }"
		:aria-expanded="hud.guideOpen"
		aria-label="About this scene, and the keys"
		title="About this scene, and the keys"
		@click.stop="hud.guideOpen = !hud.guideOpen"
	>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<!-- A question mark over a keyboard. -->
			<path d="M8.6 4.6a3.4 3.4 0 1 1 5.3 2.8c-1.2.8-1.9 1.4-1.9 2.7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
			<circle cx="12" cy="12.7" r="1.3" fill="currentColor" />
			<rect x="2" y="15" width="20" height="8" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.6" />
			<rect x="4.6" y="17" width="2" height="1.6" fill="currentColor" />
			<rect x="8" y="17" width="2" height="1.6" fill="currentColor" />
			<rect x="11.4" y="17" width="2" height="1.6" fill="currentColor" />
			<rect x="14.8" y="17" width="2" height="1.6" fill="currentColor" />
			<rect x="18" y="17" width="1.6" height="1.6" fill="currentColor" />
			<rect x="7" y="19.8" width="10" height="1.5" rx="0.4" fill="currentColor" />
		</svg>
	</button>
	<HudDialog :open="hud.guideOpen && !!scene" :title="scene?.title ?? ''" :width="1000" :from="btn" @close="hud.guideOpen = false">
		<div class="columns">
			<section class="column about">
				<h3>About</h3>
				<p class="copy">{{ scene?.brief }}</p>
			</section>
			<section class="column keys">
				<h3>Keys</h3>
				<dl>
					<div v-for="row in [...rows, ...(scene?.keys ?? [])]" :key="row.action" class="row">
						<dt>{{ row.action }}</dt>
						<dd>{{ row.key }}</dd>
					</div>
				</dl>
			</section>
		</div>
	</HudDialog>
</template>

<style scoped>
.guide {
	/* Left of Menu (14 + 112 + 12). */
	right: 138px;
}

.guide svg {
	width: 32px;
	height: 32px;
}

/*
 * Two columns, which wrap when the screen gets too narrow. Each has a rule along its left and its top, and the row hides
 * whichever of them falls outside it: side by side the rule between them stands upright, wrapped it lies flat.
 */
.columns {
	display: flex;
	flex-wrap: wrap;
	margin: 0 -28px;
	overflow: hidden;
}

.column {
	box-sizing: border-box;
	min-width: 0;
	margin: calc(-1 * var(--line-thin)) 0 0 calc(-1 * var(--line-thin));
	padding: 10px 28px 12px;
	border-top: var(--line-thin) solid var(--ink-soft);
	border-left: var(--line-thin) solid var(--ink-soft);
}

.about {
	flex: 3 1 340px;
}

.keys {
	flex: 2 1 280px;
}

h3 {
	margin: 0 0 8px;
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	opacity: 0.7;
}

.copy {
	margin: 0;
	font-size: 17px;
	line-height: 1.55;
	white-space: pre-wrap;
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
