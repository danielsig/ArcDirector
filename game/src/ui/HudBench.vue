<script setup lang="ts">
import { computed } from 'vue';
import { ARC_BENCH, ARC_BENCH_VERSION, DECISION_BENCH, DECISION_BENCH_VERSION } from 'arc-director';
import { modelLabel, type HudModel } from './hudModel';
import HudDialog from './HudDialog.vue';
import { benchArcWriting, benchDecisions, JEV_CANDIDATE, type BenchKind, type BenchRow } from '../director/bench';

const props = defineProps<{
	hud:HudModel;
	kind:BenchKind;
}>();

/** What each bench asks, and of whom. */
const BENCHES = {
	decision: {
		title: 'Arc Decision Bench',
		version: DECISION_BENCH_VERSION,
		cases: DECISION_BENCH,
		hint: `How well each model picks the best option in ${DECISION_BENCH.length} game situations. Options are asked in both orders, so always picking the first scores half. No menu settings change the result.`,
		run: (ids:string[], rows:BenchRow[]) => benchDecisions(ids, props.hud.models, rows),
	},
	arc: {
		title: 'Arc Bench',
		version: ARC_BENCH_VERSION,
		cases: ARC_BENCH,
		hint: `How well each model gets NPCs to their goals in ${ARC_BENCH.length} game situations, each played out like the game. Uses the Arc format, Thinking and Context window settings from the Arc Director menu. Lookup cases need the map or the NPC's knowledge.`,
		run: benchArcWriting,
	},
};

const LEVELS = [{ level: 1, label: 'Easy' }, { level: 2, label: 'Medium' }, { level: 3, label: 'Hard' }] as const;

const bench = computed(() => BENCHES[props.kind]);
const skills = computed(() => [...new Set(bench.value.cases.map((c) => c.skill))]);
const rows = computed(() => props.hud.benchRows[props.kind]);

/** Jev and every server model pick; only chat models write arcs. */
const candidates = computed(() => [
	...(props.kind === 'decision' ? [{ id: JEV_CANDIDATE, label: JEV_CANDIDATE }] : []),
	...props.hud.models.filter((m) => props.kind === 'decision' || !m.decision).map((m) => ({ id: m.id, label: modelLabel(m) })),
]);

function close():void {
	props.hud.bench = null;
}

async function run():Promise<void> {
	props.hud.benchRunning = true;
	try {
		await bench.value.run([...props.hud.benchPick[props.kind]], rows.value);
	}
	finally {
		props.hud.benchRunning = false;
	}
}

function speed(ms:number):string {
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function cell(score:{ right:number; total:number } | undefined):string {
	return score ? `${score.right}/${score.total}` : '';
}

function totalCell(row:BenchRow):string {
	if (!row.score) {
		return !row.started ? 'waiting' : row.total ? `${row.done}/${row.total}…` : 'loading…';
	}
	const all = Object.values(row.score.skills);
	const right = all.reduce((sum, s) => sum + s.right, 0);
	const total = all.reduce((sum, s) => sum + s.total, 0);
	return `${Math.round((100 * right) / total)}%`;
}
</script>

<template>
	<HudDialog open :title="bench.title" :width="880" @close="close">
		<template #title>{{ bench.title }} <span class="version">v{{ bench.version }}</span></template>
		<p class="hint">
			{{ bench.hint }} Ctrl-click to test several models.
		</p>
		<div class="pick">
			<select v-model="hud.benchPick[kind]" multiple :disabled="hud.benchRunning">
				<option v-for="c in candidates" :key="c.id" :value="c.id">{{ c.label }}</option>
			</select>
			<button
				type="button"
				class="act"
				:disabled="hud.benchRunning || hud.benchPick[kind].length === 0"
				@click.stop="run"
			>
				{{ hud.benchRunning ? 'Testing…' : 'Test' }}
			</button>
		</div>
		<table v-if="rows.length > 0" class="stats">
			<thead>
				<tr>
					<th>Model</th>
					<th>Speed</th>
					<th v-for="skill in skills" :key="skill">{{ skill }}</th>
					<th v-for="l in LEVELS" :key="l.level" class="level">{{ l.label }}</th>
					<th>Fails</th>
					<th>Total</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="row in rows" :key="row.id">
					<td :title="row.score?.error">{{ row.id }}</td>
					<td>{{ row.score ? speed(row.score.msPerTrial) : '' }}</td>
					<td v-for="skill in skills" :key="skill">{{ cell(row.score?.skills[skill]) }}</td>
					<td v-for="l in LEVELS" :key="l.level" class="level">{{ cell(row.score?.levels[l.level]) }}</td>
					<td :title="row.score?.error">{{ row.score?.failed || '' }}</td>
					<td>{{ totalCell(row) }}</td>
				</tr>
			</tbody>
		</table>
	</HudDialog>
</template>

<style scoped>
.version {
	font-size: 16px;
	opacity: 0.6;
}

.hint {
	margin: 0 0 12px;
	font-size: 14px;
	opacity: 0.8;
}

.pick {
	display: flex;
	align-items: flex-start;
	gap: 12px;
}

/* Seven models on a short screen, more as the screen allows. */
.pick select {
	flex: 1 1 auto;
	min-width: 0;
	height: clamp(170px, 45vh, 520px);
	padding: 4px;
	font: inherit;
	font-size: 14px;
	color: var(--ink);
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: var(--radius-small);
}

.pick select option:checked {
	background: var(--gold);
}

/* Outlined, as the dialog's Close. */
.act {
	padding: 6px 18px;
	font: inherit;
	font-size: 16px;
	font-weight: 700;
	color: var(--ink);
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: var(--radius-small);
	box-shadow: var(--shadow);
	cursor: pointer;
}

.act:hover:not(:disabled) {
	background: var(--parchment-deep);
}

.act:disabled {
	opacity: 0.5;
	cursor: default;
}

button:focus-visible,
select:focus-visible {
	outline: var(--line-thin) solid var(--gold-deep);
	outline-offset: 2px;
}

.stats {
	width: 100%;
	margin-top: 16px;
	border-collapse: collapse;
	font-size: 14px;
}

.stats th,
.stats td {
	text-align: left;
	padding: 5px 8px 5px 0;
	border-bottom: 1px solid var(--ink-soft);
	white-space: nowrap;
}

.stats td:first-child {
	white-space: normal;
	word-break: break-all;
}

.stats th:not(:first-child),
.stats td:not(:first-child) {
	text-align: right;
	font-variant-numeric: tabular-nums;
}

/* The difficulty columns, shaded apart from the skills. */
.stats .level {
	background: var(--parchment-deep);
}

.stats th {
	font-size: 12px;
	font-weight: 700;
	opacity: 0.65;
	text-transform: capitalize;
}
</style>
