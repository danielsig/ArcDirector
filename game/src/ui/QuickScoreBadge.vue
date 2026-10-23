<script setup lang="ts">
import { computed } from 'vue';
import type { BenchKind } from '../director/bench';
import { quickBench, quickBenchCurrent } from '../director/quickBench';

/** A model's quick-bench score on its row, or that it is being tested now; nothing before it is ranked. */
const props = defineProps<{
	kind:BenchKind;
	id:string;
}>();

const score = computed(() => quickBench.scores[props.kind][props.id]);
const testing = computed(() => quickBenchCurrent(props.kind) === props.id);

function time(ms:number):string {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const title = computed(() => {
	const s = score.value;
	if (!s) {
		return '';
	}
	if (s.failed && s.precision === 0) {
		return '✕ = This model could not answer the tests.';
	}
	const size = s.gb === undefined ? 'A model of unknown size' : `A ${s.gb < 1 ? `${Math.round(s.gb * 1000)}MB` : `${s.gb.toFixed(1)}GB`} model`;
	const per = props.kind === 'decision' ? 'decision' : 'plan';
	const penalty = (label:string, keep:number):string => (keep < 0.995 ? ` ${label} penalty: −${Math.round((1 - keep) * 100)}%.` : '');
	return `${Math.round(s.score * 100)} = ${size} scored ${Math.round(s.precision * 100)}% in ${time(s.ms)}/${per}.`
		+ penalty('Slow', s.speed) + penalty('Size', s.memory);
});

/** Gold for the best, plain for middling, faded for poor. */
const tier = computed(() => {
	const s = score.value?.score ?? 0;
	return s >= 0.7 ? 'high' : s >= 0.4 ? 'mid' : 'low';
});
</script>

<template>
	<span
		v-if="testing"
		class="badge testing"
		:class="{ warming: quickBench.runs[kind].warming }"
		:title="quickBench.runs[kind].warming ? 'Warming up, untimed: loading, and caching what every case shares' : 'Testing now'"
	>
		<i />
		<i />
		<i />
	</span>
	<span v-else-if="score" class="badge" :class="tier" :title="title">
		<template v-if="score.failed && score.precision === 0">✕</template>
		<template v-else>{{ Math.round(score.score * 100) }}</template>
	</span>
</template>

<style scoped>
/* A round seal at the row's end: the score out of 100. */
.badge {
	flex: 0 0 auto;
	min-width: 30px;
	height: 26px;
	padding: 0 6px;
	display: grid;
	grid-auto-flow: column;
	place-items: center;
	gap: 3px;
	font-size: 13px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	color: var(--ink);
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: 999px;
	box-sizing: border-box;
}

.badge.high {
	background: linear-gradient(135deg, #f6dc8f, var(--gold) 55%, var(--gold-deep));
	box-shadow: 0 0 10px rgba(255, 196, 80, 0.55);
}

.badge.low {
	opacity: 0.6;
	border-style: dashed;
}

/* Three dots that hop in turn while its cases run. */
.testing i {
	width: 5px;
	height: 5px;
	border-radius: 50%;
	background: var(--gold-deep);
	animation: hop 0.9s ease-in-out infinite;
}

/* Warming up: the dots hop slower, in ink, for nothing is timed yet. */
.testing.warming i {
	background: var(--ink-soft);
	animation-duration: 1.6s;
}

.testing i:nth-child(2) {
	animation-delay: 0.15s;
}

.testing i:nth-child(3) {
	animation-delay: 0.3s;
}

@keyframes hop {
	30% {
		transform: translateY(-4px);
	}
	60% {
		transform: none;
	}
}

@media (prefers-reduced-motion: reduce) {
	.testing i {
		animation: none;
	}
}
</style>
