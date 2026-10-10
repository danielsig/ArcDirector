<script setup lang="ts">
import { computed } from 'vue';
import { DECISION_BENCH } from 'arc-director';
import { modelLabel, type HudModel } from './hudModel';
import { benchDecisions, JEV_CANDIDATE, type BenchRow } from '../director/decisionBench';

const props = defineProps<{
	hud:HudModel;
}>();

const SKILLS = [...new Set(DECISION_BENCH.map((c) => c.skill))];
const LEVELS = [{ level: 1, label: 'Easy' }, { level: 2, label: 'Medium' }, { level: 3, label: 'Hard' }] as const;

const candidates = computed(() => [
	{ id: JEV_CANDIDATE, label: JEV_CANDIDATE },
	...props.hud.models.map((m) => ({ id: m.id, label: modelLabel(m) })),
]);

function close():void {
	props.hud.benchOpen = false;
}

async function run():Promise<void> {
	props.hud.benchRunning = true;
	try {
		await benchDecisions([...props.hud.benchPick], props.hud.models, props.hud.benchRows);
	}
	finally {
		props.hud.benchRunning = false;
	}
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
	<div class="bench-dim" @click.stop="close">
		<div class="bench" role="dialog" aria-label="Decision bench" @click.stop>
			<header class="head">
				<h2>Decision bench</h2>
				<button type="button" class="close" @click.stop="close">Close</button>
			</header>
			<div class="body">
				<p class="hint">
					{{ DECISION_BENCH.length * 2 }} decisions per model ({{ SKILLS.join(', ') }}), easy to hard, each asked in
					both choice orders. Decision making only, not arcs. Hold Ctrl to pick several.
				</p>
				<div class="pick">
					<select v-model="hud.benchPick" multiple size="7" :disabled="hud.benchRunning">
						<option v-for="c in candidates" :key="c.id" :value="c.id">{{ c.label }}</option>
					</select>
					<button
						type="button"
						class="act"
						:disabled="hud.benchRunning || hud.benchPick.length === 0"
						@click.stop="run"
					>
						{{ hud.benchRunning ? 'Testing…' : 'Test' }}
					</button>
				</div>
				<table v-if="hud.benchRows.length > 0" class="stats">
					<thead>
						<tr>
							<th>Model</th>
							<th>Speed</th>
							<th v-for="skill in SKILLS" :key="skill">{{ skill }}</th>
							<th v-for="l in LEVELS" :key="l.level" class="level">{{ l.label }}</th>
							<th>Fails</th>
							<th>Total</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="row in hud.benchRows" :key="row.id">
							<td :title="row.score?.error">{{ row.id }}</td>
							<td>{{ row.score ? `${Math.round(row.score.msPerPick)} ms` : '' }}</td>
							<td v-for="skill in SKILLS" :key="skill">{{ cell(row.score?.skills[skill]) }}</td>
							<td v-for="l in LEVELS" :key="l.level" class="level">{{ cell(row.score?.levels[l.level]) }}</td>
							<td :title="row.score?.error">{{ row.score?.failed || '' }}</td>
							<td>{{ totalCell(row) }}</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>
</template>

<style scoped>
.bench-dim {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(8, 6, 4, 0.5);
	z-index: 4;
}

.bench {
	width: min(880px, 96vw);
	max-height: min(560px, 86vh);
	display: flex;
	flex-direction: column;
	background: var(--parchment);
	color: var(--ink);
	font-family: ui-monospace, "Cascadia Code", monospace;
	box-shadow: 0 2px 0 var(--ink), 0 16px 40px rgba(0, 0, 0, 0.45);
}

.head {
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

.body {
	overflow: auto;
	padding: 10px 16px 16px;
}

.hint {
	margin: 0 0 10px;
	font-size: 12px;
	opacity: 0.8;
}

.pick {
	display: flex;
	align-items: flex-start;
	gap: 12px;
}

.pick select {
	flex: 1 1 auto;
	min-width: 0;
	font: inherit;
	font-size: 12px;
	color: var(--ink);
	background: var(--cream);
	border: 0;
	padding: 4px;
	box-shadow: inset 0 0 0 2px var(--ink);
}

.close,
.act {
	font: inherit;
	font-size: 13px;
	color: var(--ink);
	background: var(--cream);
	border: 0;
	padding: 6px 14px;
	cursor: pointer;
	box-shadow: 0 2px 0 var(--ink);
}

.close:hover,
.act:hover:not(:disabled) {
	background: var(--highlight);
}

.act:disabled {
	opacity: 0.5;
	cursor: default;
}

.stats {
	width: 100%;
	margin-top: 14px;
	border-collapse: collapse;
	font-size: 12px;
}

.stats th,
.stats td {
	text-align: left;
	padding: 4px 6px 4px 0;
	border-bottom: 1px solid var(--rule);
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

.stats .level {
	background: rgba(0, 0, 0, 0.05);
}

.stats th {
	font-size: 11px;
	opacity: 0.7;
	font-weight: 500;
	text-transform: capitalize;
}

</style>
