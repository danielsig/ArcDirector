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
/* The decision bench: a parchment panel over the pause menu, as the pause panel itself. */
.bench-dim {
	position: absolute;
	inset: 0;
	z-index: 4;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--backdrop);
}

.bench {
	width: min(880px, 96vw);
	max-height: min(560px, 86vh);
	display: flex;
	flex-direction: column;
	color: var(--ink);
	font-family: var(--font);
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-radius: var(--radius-panel);
	box-shadow: var(--shadow-panel);
	animation: rise var(--slow) var(--ease-pop);
}

@keyframes rise {
	from {
		opacity: 0;
		transform: translateY(12px) scale(0.97);
	}
}

.head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 18px 24px 10px 28px;
	border-bottom: var(--line-thin) solid var(--ink-soft);
}

h2 {
	margin: 0;
	font-size: 26px;
	font-weight: 700;
}

.body {
	overflow: auto;
	padding: 12px 28px 22px;
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

.pick select {
	flex: 1 1 auto;
	min-width: 0;
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

/* Outlined buttons, as the pause menu's Resume. */
.close,
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

.close:hover,
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
