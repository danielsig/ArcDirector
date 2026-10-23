<script setup lang="ts">
import { computed } from 'vue';
import type { BenchKind } from '../director/bench';
import { clearQuickBench, pauseQuickBench, quickBench, quickBenchBlocked, quickBenchProgress, resumeQuickBench, startQuickBench } from '../director/quickBench';

/**
 * Ranks a list of LM Studio's models by a quick bench: a wand that starts it, then a bar while it runs that pauses,
 * and once paused resumes or clears.
 */
const props = defineProps<{
	kind:BenchKind;
}>();

const BENCH_NAME:Record<BenchKind, string> = { decision: 'ArcSelector Bench', arc: 'ArcDirector Bench' };

const run = computed(() => quickBench.runs[props.kind]);
/** The other ranking is running: this one starts or resumes once it is done or paused. */
const blocked = computed(() => quickBenchBlocked(props.kind));
const ranked = computed(() => Object.keys(quickBench.scores[props.kind]).length);
const total = computed(() => run.value.done + run.value.queue.length);
</script>

<template>
	<div class="quick-rank">
		<template v-if="run.state !== 'idle'">
			<span class="track" role="progressbar" :aria-valuenow="Math.round(quickBenchProgress(kind) * 100)" aria-valuemin="0" aria-valuemax="100">
				<span class="fill" :class="{ live: run.state === 'running' }" :style="{ width: `${quickBenchProgress(kind) * 100}%` }" />
			</span>
			<span class="count">
				{{ run.state === 'paused' ? 'Paused' : run.state === 'pausing' ? 'Pausing…' : '' }}
				{{ run.done }}/{{ total }}
			</span>
			<button
				v-if="run.state === 'running'"
				type="button"
				class="icon"
				title="Pause once this model is done"
				aria-label="Pause"
				@click="pauseQuickBench(kind)"
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
			</button>
			<template v-else>
				<button
					type="button"
					class="icon"
					:disabled="run.state === 'paused' && blocked"
					:title="run.state === 'paused' && blocked ? 'Resumes once the other ranking is done or paused' : 'Resume'"
					aria-label="Resume"
					@click="resumeQuickBench(kind)"
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path class="solid" d="M8 5l11 7-11 7z" /></svg>
				</button>
				<button v-if="run.state === 'paused'" type="button" class="icon" title="Clear the ranking" aria-label="Clear the ranking" @click="clearQuickBench(kind)">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
				</button>
			</template>
		</template>
		<template v-else>
			<button
				type="button"
				class="wand"
				:disabled="blocked"
				:title="blocked
					? 'Starts once the other ranking is done or paused'
					: `Test every model on the three ${BENCH_NAME[kind]} cases that best predict its score, and sort by that score, scaled down for slow answers`"
				@click="startQuickBench(kind)"
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path class="stick" d="M4 20L14 10" />
					<path class="solid" d="M16 2.5l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z" />
					<path class="solid" d="M20.5 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" />
					<path class="solid" d="M9.5 2.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" />
				</svg>
				{{ ranked ? 'Rank again' : 'Rank' }}
			</button>
			<button v-if="ranked" type="button" class="icon" title="Clear the ranking" aria-label="Clear the ranking" @click="clearQuickBench(kind)">
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
			</button>
		</template>
	</div>
</template>

<style scoped>
.quick-rank {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}

button {
	font: inherit;
	color: inherit;
	cursor: pointer;
}

button:disabled {
	opacity: 0.45;
	cursor: default;
}

button:focus-visible {
	outline: var(--line-thin) solid var(--gold-deep);
	outline-offset: 2px;
}

/* The magic: a gold pill with a wand whose stars twinkle when it is hovered. */
.wand {
	display: flex;
	align-items: center;
	gap: 5px;
	padding: 3px 11px 3px 8px;
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--ink);
	background: linear-gradient(135deg, #f6dc8f, var(--gold) 55%, var(--gold-deep));
	border: var(--line-thin) solid var(--ink);
	border-radius: 999px;
	box-shadow: var(--shadow), inset 0 1px 0 rgba(255, 255, 255, 0.5);
	transition: transform var(--quick) var(--ease-out);
}

.wand:hover:not(:disabled) {
	transform: translateY(-1px) rotate(-2deg);
}

.wand:active:not(:disabled) {
	transform: translateY(1px);
	box-shadow: none;
}

.wand svg {
	width: 17px;
	height: 17px;
	overflow: visible;
}

.stick {
	fill: none;
	stroke: var(--ink);
	stroke-width: 2.6;
	stroke-linecap: round;
}

.solid {
	fill: var(--ink);
	transform-box: fill-box;
	transform-origin: center;
}

.wand:hover:not(:disabled) .solid {
	animation: twinkle 0.9s var(--ease-out) infinite;
}

.wand:hover:not(:disabled) .solid:nth-of-type(3) {
	animation-delay: 0.3s;
}

.wand:hover:not(:disabled) .solid:nth-of-type(4) {
	animation-delay: 0.6s;
}

@keyframes twinkle {
	50% {
		transform: scale(1.5) rotate(45deg);
	}
}

/* How far it got: gold filling an ink track, a sheen running along it while it works. */
.track {
	position: relative;
	width: 84px;
	height: 10px;
	overflow: hidden;
	background: var(--parchment-deep);
	border: var(--line-thin) solid var(--ink);
	border-radius: 999px;
}

.fill {
	position: absolute;
	inset: 0 auto 0 0;
	background: linear-gradient(90deg, var(--gold-deep), var(--gold));
	transition: width var(--slow) linear;
}

.fill.live::after {
	content: "";
	position: absolute;
	inset: 0;
	background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.7), transparent);
	animation: sheen 1.2s linear infinite;
}

@keyframes sheen {
	from {
		transform: translateX(-100%);
	}
	to {
		transform: translateX(100%);
	}
}

.count {
	font-size: 12px;
	font-weight: 700;
	white-space: nowrap;
	font-variant-numeric: tabular-nums;
}

.icon {
	width: 24px;
	height: 24px;
	display: grid;
	place-items: center;
	padding: 0;
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: 50%;
}

.icon:hover {
	background: var(--parchment-deep);
}

.icon svg {
	width: 13px;
	height: 13px;
	fill: none;
	stroke: var(--ink);
	stroke-width: 3;
	stroke-linecap: round;
}

.icon .solid {
	stroke: none;
}

@media (prefers-reduced-motion: reduce) {
	.wand:hover:not(:disabled) .solid,
	.fill.live::after {
		animation: none;
	}
}
</style>
