<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ARC_BENCH, ARC_BENCH_VERSION, DECISION_BENCH, DECISION_BENCH_VERSION, type BenchScore, type SkillScore } from 'arc-director/bench';
import { modelLabel, type HudModel } from './hudModel';
import HudDialog from './HudDialog.vue';
import { benchArcWriting, benchDecisions, JEV_CANDIDATE, xaiCandidates, type BenchKind, type BenchRow, type BenchRun } from '../director/bench';
import { HOSTED } from '../director/hosted';
import { BROWSER_MODELS, SKALDIC_LAYA, inferenceSetup, type BrowserModel } from '../director/inference';

const props = defineProps<{
	hud:HudModel;
	kind:BenchKind;
}>();

/** What each bench asks, and of whom. */
const BENCHES = {
	decision: {
		title: 'ArcSelector Bench',
		version: DECISION_BENCH_VERSION,
		cases: DECISION_BENCH,
		hint: `How well each model picks the best option in ${DECISION_BENCH.length} game situations. Every option is rated: full points for the best, some for one that still helps, none for a bad one. Each situation is asked twice, the second time with the options in reverse order, and the worse answer counts, so always picking the first option doesn't pay. No menu settings change the result.`,
		run: (ids:string[], rows:BenchRow[], run:BenchRun) => benchDecisions(ids, props.hud.models, rows, run),
		// Harm here is only a pick rated 0, which the score already counts as nothing, so no harm count.
		harm: false,
	},
	arc: {
		title: 'ArcDirector Bench',
		version: ARC_BENCH_VERSION,
		cases: ARC_BENCH,
		hint: `How well each model gets NPCs to their goals in ${ARC_BENCH.length} game situations, each played out like the game. Uses the Arc format, Thinking and Context window settings from the Arc Director menu; each model samples as its makers recommend, at the temperature shown. Each cell is the share of goals reached, ± how far another run would likely land from it, then (red) how many situations were left worse off than doing nothing, fails included. Doing nothing scores 0%.`,
		run: benchArcWriting,
		harm: true,
	},
};

const LEVELS = [{ level: 1, label: 'Easy' }, { level: 2, label: 'Medium' }, { level: 3, label: 'Hard' }] as const;

const bench = computed(() => BENCHES[props.kind]);
const rows = computed(() => props.hud.benchRows[props.kind]);
/** The score columns: each skill, then each difficulty level, but for a quick check, whose cases are all one level. */
const columns = computed(() => [
	...[...new Set(bench.value.cases.map((c) => c.skill))].map((skill) => ({ key: skill, label: skill, level: false, of: (s:BenchScore) => s.skills[skill] })),
	...rows.value.some((row) => row.quick) ? [] : LEVELS.map((l) => ({ key: l.label, label: l.label, level: true, of: (s:BenchScore) => s.levels[l.level] })),
]);
/** A quick check: per skill, a medium case, then an easy or a hard one by how that went. The full run is the bench's score. */
const quick = ref(false);
/** Times each case runs in a full run: more runs, less noise, and from two each score says how noisy it is. */
const repeats = ref(1);
const REPEATS = [1, 2, 3, 5, 10];

/** xAI's models, with its key on the dev server: they do both benches. */
const xai = ref<{ id:string; label:string }[]>([]);
onMounted(async () => {
	xai.value = await xaiCandidates();
});

/**
 * Jev (with its key) and every server model pick; only chat models write arcs. The game's browser models do both,
 * where this browser runs them, as do xAI's (with its key).
 */
const candidates = computed(() => [
	...(props.kind === 'decision' && HOSTED.jev ? [{ id: JEV_CANDIDATE, label: JEV_CANDIDATE }] : []),
	...props.hud.models.filter((m) => props.kind === 'decision' || !m.decision).map((m) => ({ id: m.id, label: modelLabel(m) })),
	...(inferenceSetup.unsupported ? [] : BROWSER_MODELS.map((m) => ({ id: m.model, label: `${m.label} · in your browser${browserDownload(m)}` }))),
	...(props.kind === 'decision' && !inferenceSetup.unsupported
		? [{ id: SKALDIC_LAYA.model, label: `${SKALDIC_LAYA.label} · in your browser${inferenceSetup.laya.cached ? '' : ` · ${SKALDIC_LAYA.sizeGB} GB to download`}` }]
		: []),
	...xai.value,
]);

/** What a browser model not downloaded yet costs to fetch; nothing once it is here. */
function browserDownload(m:BrowserModel):string {
	return inferenceSetup.models[m.model]?.cached ? '' : ` · ${m.downloadGB} GB to download`;
}

/** A row's model by its label: a browser model's id is its download's address. */
function labelOf(id:string):string {
	return candidates.value.find((c) => c.id === id)?.label ?? id;
}

function close():void {
	props.hud.bench = null;
}

async function run():Promise<void> {
	props.hud.benchRunning = true;
	try {
		await bench.value.run([...props.hud.benchPick[props.kind]], rows.value, { quick: quick.value, repeats: quick.value ? 1 : repeats.value });
	}
	finally {
		props.hud.benchRunning = false;
	}
}

/** Mean think time per case, and how many cases thought at once while it was timed. */
function speed(score:BenchScore):string {
	const ms = score.msPerTrial;
	const time = ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
	return score.parallel > 1 ? `${time} ×${score.parallel}` : time;
}

function speedTitle(score:BenchScore | undefined):string | undefined {
	return score && score.parallel > 1 ? `Mean think time per case, timed with ${score.parallel} cases at once` : undefined;
}

/** A share as a whole percent. */
function percent(share:number):string {
	return `${Math.round(100 * share)}%`;
}

/** A score's standard error, in percentage points, when its repeats tell it. */
function error(score:SkillScore):string {
	return score.se === undefined ? '' : `±${Math.round(100 * score.se)}`;
}

function cellTitle(score:SkillScore):string {
	return `${score.right} of ${score.total} reached${score.harmful ? `, ${score.harmful} left worse off` : ''}`;
}

/** The whole run's wall time. */
function wall(score:BenchScore):string {
	const s = score.wallMs / 1000;
	return s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`;
}

function totalCell(row:BenchRow):string {
	if (!row.score) {
		return !row.started ? 'waiting' : row.total ? `${row.done}/${row.total}…` : 'loading…';
	}
	return `${percent(row.score.total.mean)} ${error(row.score.total)}${row.quick ? ' quick' : ''}`;
}
</script>

<template>
	<HudDialog open :title="bench.title" :width="1200" @close="close">
		<template #title>{{ bench.title }} <span class="version">v{{ bench.version }}</span></template>
		<p class="hint">
			{{ bench.hint }} Ctrl-click to test several models. A browser model downloads first if this browser does not have it yet.
		</p>
		<div class="pick">
			<select v-model="hud.benchPick[kind]" class="models" multiple :disabled="hud.benchRunning">
				<option v-for="c in candidates" :key="c.id" :value="c.id">{{ c.label }}</option>
			</select>
			<div class="run">
				<button
					type="button"
					class="act"
					:disabled="hud.benchRunning || hud.benchPick[kind].length === 0"
					@click.stop="run"
				>
					{{ hud.benchRunning ? 'Testing…' : 'Test' }}
				</button>
				<label class="option">
					<input v-model="quick" type="checkbox" :disabled="hud.benchRunning">
					Quick check
				</label>
				<label class="option" :class="{ moot: quick }">
					Runs per case
					<select v-model.number="repeats" class="repeats" :disabled="hud.benchRunning || quick">
						<option v-for="n in REPEATS" :key="n" :value="n">{{ n }}</option>
					</select>
				</label>
				<p v-if="quick" class="tip">Tries two cases per skill instead of all of them: a medium one, then an easier or a harder one depending on how it went. Quicker, but rougher. Runs per case is ignored. Compare quick scores only with other quick scores.</p>
				<p v-else class="tip">How many times to run each case. More runs give steadier scores, and from 2 runs each score shows ± how much it could vary. Each run takes as long as another full test.</p>
			</div>
		</div>
		<table v-if="rows.length > 0" class="stats">
			<thead>
				<tr>
					<th>Model</th>
					<th title="Sampling temperature: each model's makers' own">Temp</th>
					<th>Speed</th>
					<th title="The whole run, warm-up included">Time</th>
					<th v-for="c in columns" :key="c.key" :class="{ level: c.level }">{{ c.label }}</th>
					<th>Fails</th>
					<th>Total</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="row in rows" :key="row.id">
					<td :title="row.score?.error">{{ labelOf(row.id) }}</td>
					<td>{{ row.score?.sampling?.temperature ?? '' }}</td>
					<td :title="speedTitle(row.score)">{{ row.score ? speed(row.score) : '' }}</td>
					<td>{{ row.score ? wall(row.score) : '' }}</td>
					<td v-for="c in columns" :key="c.key" :class="{ level: c.level }" :title="row.score && cellTitle(c.of(row.score))">
						<template v-if="row.score">
							<span class="right">{{ percent(c.of(row.score).mean) }}</span>
							<span class="error">{{ error(c.of(row.score)) }}</span>
							<span v-if="bench.harm && c.of(row.score).harmful" class="harmful"> −{{ c.of(row.score).harmful }}</span>
						</template>
					</td>
					<td :title="row.score?.error">{{ row.score?.failed || '' }}</td>
					<td :title="row.quick ? 'Quick score: compare it only with other quick scores' : undefined">{{ totalCell(row) }}</td>
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
.pick .models {
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

.pick .models option:checked {
	background: var(--gold);
}

/* The Test button, with how it runs under it. */
.run {
	display: flex;
	flex-direction: column;
	gap: 8px;
	width: 170px;
}

.option {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 14px;
	cursor: pointer;
}

/* Runs per case, while the quick check makes it one. */
.option.moot {
	opacity: 0.45;
	cursor: default;
}

.tip {
	margin: 0;
	font-size: 12px;
	opacity: 0.7;
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
select:focus-visible,
input:focus-visible {
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

/* A cell's goals reached, how far another run would land from it, then its harm. */
.stats .right {
	color: var(--ink-good);
}

.stats .error {
	margin-left: 2px;
	font-size: 11px;
	opacity: 0.7;
}

.repeats {
	margin-left: auto;
	padding: 2px 4px;
	font: inherit;
	font-size: 14px;
	color: var(--ink);
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: var(--radius-small);
	cursor: pointer;
}

.repeats:disabled {
	cursor: default;
}

.stats .harmful {
	color: var(--ink-bad);
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
