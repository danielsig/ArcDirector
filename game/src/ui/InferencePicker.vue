<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { fetchModelCatalog, modelIDsMatch, trainedOnArcDirector } from 'arc-director';
import {
	BROWSER_MODELS,
	LM_STUDIO_MODEL,
	LM_STUDIO_ROOT,
	SKALDIC_LAYA,
	browserModelBusy,
	cancelDownload,
	decisionModelOf,
	deleteBrowserLaya,
	deleteBrowserModel,
	inferenceSetup,
	useBrowserLaya,
	useBrowserModel,
	type BrowserModel,
} from '../director/inference';
import { prefs, setPrefs, watchPrefs } from '../prefs';
import HudSwitch from './HudSwitch.vue';

const emit = defineEmits<{
	/** NPCs think with what was picked from now on. */
	chosen: [];
}>();

/** The model that fits this device, while no browser model is downloaded: after that, the advice has done its job. */
const recommended = computed(() => (Object.values(inferenceSetup.models).some((m) => m.cached) ? null : inferenceSetup.recommended));

/** The browser model whose bin was clicked once: a second click deletes it. */
const armed = ref<string | null>(null);

/** Asking LM Studio's server whether it is there, before picking it or showing its steps. */
const connecting = ref(false);

/** The LM Studio steps show in place of the buttons. */
const steps = ref(false);
/** LM Studio's model ids as its server answered; empty when it is off, null while asking. */
const served = ref<string[] | null>(null);
const serving = computed(() => !!served.value?.length);
const hasModel = computed(() => !!served.value?.some((id) => modelIDsMatch(id, LM_STUDIO_MODEL.id)));

/**
 * Asks LM Studio's server what it serves.
 * Only call on button press because contacting it makes the browser ask for permission
 * which nobody should have to see before actually picking LM Studio.
 */
async function connect():Promise<void> {
	connecting.value = true;
	try {
		await check();
	}
	finally {
		connecting.value = false;
	}
}

/** LM Studio answering already: it is picked. Otherwise the steps to set it up show. */
async function pickLMStudio():Promise<void> {
	await connect();
	if (serving.value) {
		useLMStudio();
	}
	else {
		steps.value = true;
	}
}

async function check():Promise<void> {
	served.value = null;
	served.value = (await fetchModelCatalog(LM_STUDIO_ROOT)).map((m) => m.id);
}

function useLMStudio():void {
	setPrefs({ inference: 'lmstudio' });
	steps.value = false;
	emit('chosen');
}

async function pickBrowser(id:string):Promise<void> {
	if (await useBrowserModel(id)) {
		emit('chosen');
	}
}

async function remove(model:string):Promise<void> {
	if (armed.value !== model) {
		armed.value = model;
		return;
	}
	armed.value = null;
	await (model === SKALDIC_LAYA.model ? deleteBrowserLaya() : deleteBrowserModel(model));
}

function inUse(id:string):boolean {
	return inferenceSetup.inference === 'browser' && inferenceSetup.browserModel === id;
}

/** The System One the menu picked, kept in step with the menu. */
const systemOne = ref(prefs().systemOne);
const decisionModel = ref(prefs().decisionModel);
onUnmounted(watchPrefs((next) => {
	systemOne.value = next.systemOne;
	decisionModel.value = next.decisionModel;
}));

/** Skaldic Laya makes the quick decisions now, in the browser beside whichever main model NPCs think with. */
const layaOn = computed(() => decisionModelOf({ inference: inferenceSetup.inference, systemOne: systemOne.value, decisionModel: decisionModel.value }) === SKALDIC_LAYA.model);
const layaDownloading = computed(() => inferenceSetup.laya.progress !== null);
const layaReady = computed(() => !inferenceSetup.unsupported && !layaDownloading.value);

const layaNote = computed(() => {
	const state = inferenceSetup.laya;
	if (layaOn.value && state.progress === null) {
		// It is on the GPU only once a scene loads it.
		return state.loaded ? 'On: it makes every quick decision.' : 'On: ready for every quick decision.';
	}
	if (state.progress !== null) {
		return `Downloading ${Math.round(state.progress * 100)}%`;
	}
	if (state.error) {
		return state.error.split(/(?<=\.)\s/)[0];
	}
	if (inferenceSetup.unsupported) {
		return 'Needs a browser that can use the graphics card.';
	}
	return state.cached ? 'Downloaded. Runs in your browser beside either.' : `Download ${SKALDIC_LAYA.sizeGB} GB. Runs in your browser beside either.`;
});

/** Skaldic Laya on as the System One (downloaded first), or off back to the main model scoring its own choices. */
async function toggleLaya():Promise<void> {
	if (layaOn.value) {
		setPrefs({ decisionModel: '' });
	}
	else {
		await useBrowserLaya();
	}
}

/** Why browser models can't run here, or why one failed, whole: the cards show only its first line. */
const problem = computed(() => inferenceSetup.unsupported || BROWSER_MODELS.map((m) => inferenceSetup.models[m.model].error).find(Boolean) || '');

function status(m:BrowserModel):string {
	const state = inferenceSetup.models[m.model];
	if (state.progress !== null) {
		return `${state.cached ? 'Loading' : 'Downloading'} ${Math.round(state.progress * 100)}%`;
	}
	if (state.error) {
		// The first sentence here; all of it under the models.
		return state.error.split(/(?<=\.)\s/)[0];
	}
	if (inferenceSetup.unsupported) {
		return inferenceSetup.unsupported.split('\n')[0];
	}
	if (inUse(m.model)) {
		return state.loaded ? 'In use' : 'Ready';
	}
	return state.cached ? 'Downloaded' : `Download ${m.downloadGB} GB`;
}
</script>

<template>
	<div class="inference-picker">
		<div v-if="!steps" class="choices">
			<button
				type="button"
				class="lmstudio"
				:class="{ on: inferenceSetup.inference === 'lmstudio' }"
				:disabled="connecting"
				:aria-busy="connecting"
				@click="pickLMStudio"
			>
				<img src="/lmstudio/logo.png" alt="">
				<span class="text">
					<b>LM Studio</b>
					<span>{{ connecting ? 'Connecting…' : inferenceSetup.inference === 'lmstudio' ? 'In use' : 'Your own model server' }}</span>
				</span>
			</button>
			<div class="or" aria-hidden="true">
				<span>or</span>
			</div>
			<div class="browser">
				<div v-for="m in BROWSER_MODELS" :key="m.model" class="model-row" :class="{ recommended: recommended === m.model }">
					<button
						type="button"
						class="model"
						:class="{ on: inUse(m.model), downloaded: inferenceSetup.models[m.model].cached, failed: inferenceSetup.models[m.model].error, skaldic: trainedOnArcDirector(m.model) }"
						:disabled="!!inferenceSetup.unsupported || (browserModelBusy() && inferenceSetup.models[m.model].progress === null)"
						:aria-busy="inferenceSetup.models[m.model].progress !== null"
						:title="inferenceSetup.models[m.model].error || undefined"
						@click="pickBrowser(m.model)"
					>
						<svg v-if="inferenceSetup.models[m.model].cached" class="mark" viewBox="0 0 24 24" aria-hidden="true">
							<circle cx="12" cy="12" r="10" />
							<path d="M7.5 12.5l3 3 6-6.5" />
						</svg>
						<svg v-else class="mark" viewBox="0 0 24 24" aria-hidden="true">
							<path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />
						</svg>
						<span class="label">
							<span v-if="recommended === m.model" class="fit" title="Fits this device's graphics memory with room left for the game">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6L2.5 9.3l6.6-.8z" /></svg>
								Recommended for this device
							</span>
							<span v-if="trainedOnArcDirector(m.model)" class="eyebrow">Trained for ArcDirector</span>
							<b>{{ m.label }}</b>
							<span class="status">{{ status(m) }}</span>
						</span>
						<span
							v-if="inferenceSetup.models[m.model].progress !== null"
							class="bar"
							role="progressbar"
							:aria-valuenow="Math.round(inferenceSetup.models[m.model].progress! * 100)"
							aria-valuemin="0"
							aria-valuemax="100"
							:style="{ width: `${inferenceSetup.models[m.model].progress! * 100}%` }"
						/>
					</button>
					<button
						v-if="inferenceSetup.models[m.model].progress !== null"
						type="button"
						class="cancel"
						:title="`Stop downloading ${m.label}`"
						@click="cancelDownload(m.model)"
					>
						Cancel
					</button>
					<button
						v-if="inferenceSetup.models[m.model].progress === null && (inferenceSetup.models[m.model].cached || inferenceSetup.models[m.model].error)"
						type="button"
						class="delete"
						:class="{ armed: armed === m.model }"
						:aria-label="armed === m.model ? `Confirm deleting ${m.label}` : `Delete ${m.label}`"
						:title="`Delete ${m.label} (${m.downloadGB} GB) from this browser`"
						@click="remove(m.model)"
						@blur="armed = null"
					>
						<template v-if="armed === m.model">Delete?</template>
						<svg v-else viewBox="0 0 24 24" aria-hidden="true">
							<path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
						</svg>
					</button>
				</div>
				<p v-if="problem" class="problem" role="alert">{{ problem }}</p>
			</div>
		</div>
		<div v-else class="steps">
			<ol>
				<li :class="{ done: serving }">
					<b>Download LM Studio</b>
					<span>From <a href="https://lmstudio.ai/download" target="_blank" rel="noopener">lmstudio.ai/download</a>, then install and open it.</span>
				</li>
				<li :class="{ done: hasModel }">
					<b>Download {{ LM_STUDIO_MODEL.label }}</b>
					<span>
						In <i>Model Search</i>, pick <a :href="`https://lmstudio.ai/models/${LM_STUDIO_MODEL.id}`" target="_blank" rel="noopener">{{ LM_STUDIO_MODEL.label }}</a>
						and press <i>Download</i>, or run <code>lms get {{ LM_STUDIO_MODEL.id }}</code>.
					</span>
					<div class="shots">
						<a v-for="shot in ['model-search', 'download']" :key="shot" :href="`/lmstudio/${shot}.webp`" target="_blank" :class="shot">
							<img :src="`/lmstudio/${shot}.webp`" alt="">
						</a>
					</div>
				</li>
				<li :class="{ done: serving }">
					<b>Start the server with CORS on</b>
					<span>
						In <i>Model Server</i>, switch <i>Status</i> to Running, then open <i>Server Settings</i> and turn on
						<i>Enable CORS</i>, or run <code>lms server start --cors</code>.
					</span>
					<div class="shots">
						<a href="/lmstudio/server.webp" target="_blank"><img src="/lmstudio/server.webp" alt=""></a>
					</div>
				</li>
				<li>
					<b>Keep their thoughts short <span class="optional">(optional)</span></b>
					<span>
						NPCs that think long act late. Open the model's settings in LM Studio's <i>Library</i>, then under <i>Inference</i>
						tick <i>Reasoning Budget</i> and set it to 512.
					</span>
					<div class="shots narrow">
						<a href="/lmstudio/budget.webp" target="_blank"><img src="/lmstudio/budget.webp" alt=""></a>
					</div>
				</li>
			</ol>
			<p class="check" aria-live="polite">
				<template v-if="served === null">Looking for LM Studio…</template>
				<template v-else-if="serving">LM Studio is answering with {{ served.length }} model{{ served.length === 1 ? '' : 's' }}.</template>
				<template v-else>LM Studio isn't answering on port 1234 yet.</template>
				<button type="button" class="link" :disabled="served === null" @click="check">Check again</button>
			</p>
			<div class="actions">
				<button type="button" @click="steps = false">Back</button>
				<button type="button" class="primary" @click="useLMStudio">Use LM Studio</button>
			</div>
		</div>
		<aside v-if="!steps" class="addon skaldic" :class="{ on: layaOn }">
			<span class="pitch">
				<span class="eyebrow"><span class="badge">Add-on</span> Trained for ArcDirector</span>
				<span class="title">
					<b>{{ SKALDIC_LAYA.label }}</b>
					<span class="size">{{ SKALDIC_LAYA.sizeGB }} GB</span>
					<span class="note">{{ layaNote }}</span>
				</span>
				<span class="line">Sharper reflexes: fight or flee, heal or strike, decided in under a tenth of a second.</span>
			</span>
			<HudSwitch :on="layaOn" :disabled="!layaOn && !layaReady" @toggle="toggleLaya" />
			<button v-if="layaDownloading" type="button" class="cancel" :title="`Stop downloading ${SKALDIC_LAYA.label}`" @click="cancelDownload(SKALDIC_LAYA.model)">
				Cancel
			</button>
			<button
				v-if="inferenceSetup.laya.cached && !layaDownloading && !layaOn"
				type="button"
				class="delete"
				:class="{ armed: armed === SKALDIC_LAYA.model }"
				:aria-label="armed === SKALDIC_LAYA.model ? `Confirm deleting ${SKALDIC_LAYA.label}` : `Delete ${SKALDIC_LAYA.label}`"
				:title="`Delete ${SKALDIC_LAYA.label} (${SKALDIC_LAYA.sizeGB} GB) from this browser`"
				@click="remove(SKALDIC_LAYA.model)"
				@blur="armed = null"
			>
				<template v-if="armed === SKALDIC_LAYA.model">Delete?</template>
				<svg v-else viewBox="0 0 24 24" aria-hidden="true">
					<path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
				</svg>
			</button>
		</aside>
	</div>
</template>

<style scoped>
/*
 * Where NPCs think. LM Studio (its blue) on the left, the browser models stacked on the right; narrow, as in the
 * pause menu, they wrap into one column. A download fills a gold bar along its button's foot.
 */
.inference-picker {
	/* Skaldic models' cards under their gold: midnight blue for the main model, crimson for Laya. */
	--skaldic-bg: linear-gradient(135deg, #24345a, #0f1626);
	--laya-bg: linear-gradient(135deg, #5c1d26, #24090e);
	container-type: inline-size;
	font-family: var(--font);
	color: var(--ink);
}

button {
	font: inherit;
	color: inherit;
	cursor: pointer;
}

button:disabled {
	opacity: 0.5;
	cursor: default;
}

button:focus-visible,
a:focus-visible {
	outline: var(--line-thin) solid var(--gold-deep);
	outline-offset: 2px;
}

/* LM Studio and the browser models side by side, the same width; wide enough that every model name stays on one line. */
.choices {
	display: grid;
	grid-template-columns: 1fr auto 1fr;
	gap: 12px;
}

/* Between LM Studio and the browser models: a rule with "or" in the middle, upright beside them, flat between rows. */
.or {
	flex: 0 0 auto;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6px;
}

.or::before,
.or::after {
	content: "";
	flex: 1 1 auto;
	width: var(--line-thin);
	background: var(--ink-soft);
	border-radius: 1px;
}

.or span {
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	opacity: 0.65;
}

.lmstudio,
.model {
	position: relative;
	overflow: hidden;
	border: var(--line) solid var(--ink);
	border-radius: var(--radius);
	box-shadow: var(--shadow);
}

/* A browser model lifts as a row, so its bin rises with it. */
.lmstudio,
.model-row {
	transition: transform var(--quick) var(--ease-out);
}

.lmstudio:hover:not(:disabled),
.model-row:hover:has(> .model:not(:disabled)) {
	transform: translateY(-2px);
}

.lmstudio:active:not(:disabled),
.model-row:has(> .model:active:not(:disabled)) {
	transform: translateY(2px);
}

.lmstudio:active:not(:disabled),
.model:active:not(:disabled) {
	box-shadow: none;
}

/* What NPCs think with now: a gold ring. */
.lmstudio.on,
.model.on {
	box-shadow: 0 0 0 var(--line) var(--gold), var(--shadow);
}

/* LM Studio's own blue, from its logo. */
.lmstudio {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 10px;
	min-height: 160px;
	padding: 16px;
	color: #fff;
	background: linear-gradient(135deg, #6b74ed, #5018c0);
}

.lmstudio img {
	width: 64px;
	height: 64px;
	border-radius: 14px;
	box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
}

.text {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
}

.text b {
	font-size: 22px;
}

.text span {
	font-size: 14px;
	opacity: 0.85;
}

.browser {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.model-row {
	position: relative;
	flex: 1 1 auto;
	display: flex;
}

.model {
	flex: 1 1 auto;
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 74px;
	padding: 10px 16px 14px;
	text-align: left;
	background: var(--parchment);
}

.model:hover:not(:disabled) {
	background: var(--parchment-deep);
}

/*
 * Not downloaded yet: flat, a dashed outline and a download arrow. Downloaded: raised and solid, with a gold
 * tick, and room on the right for its bin.
 */
.model:not(.downloaded) {
	border-style: dashed;
	box-shadow: none;
	background: transparent;
}

.model.downloaded {
	padding-right: 70px;
}

.mark {
	flex: 0 0 auto;
	width: 30px;
	height: 30px;
	fill: none;
	stroke: var(--ink);
	stroke-width: 2.4;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.model:not(.downloaded) .mark {
	opacity: 0.6;
}

.model.downloaded .mark circle {
	fill: var(--gold);
	stroke-width: 2;
}

.label {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

.model b {
	font-size: 18px;
	white-space: nowrap;
}

/* Keeps a message's line breaks, and still wraps a line too long for the button. */
/* What fits this device: the card's first line, behind a gold star, over a gold tint. */
.model .fit {
	display: flex;
	align-items: center;
	gap: 5px;
	font-size: 13px;
	font-weight: 700;
	white-space: nowrap;
}

.fit svg {
	flex: 0 0 auto;
	width: 15px;
	height: 15px;
	fill: var(--gold-deep);
	stroke: var(--ink);
	stroke-width: 1.5;
	stroke-linejoin: round;
}

.model-row.recommended .model {
	background: color-mix(in srgb, var(--gold) 22%, var(--parchment));
}

.model-row.recommended .model:hover:not(:disabled) {
	background: color-mix(in srgb, var(--gold) 38%, var(--parchment));
}

.model .status {
	font-size: 14px;
	opacity: 0.8;
	white-space: pre-line;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

/* Why the browser can't run models, and what the player can do about it. */
.problem {
	margin: 0;
	font-size: 14px;
	line-height: 1.4;
	white-space: pre-line;
	color: var(--health);
}

.problem::first-line {
	font-weight: 700;
}

.model.failed .status {
	color: var(--health);
	opacity: 1;
}

/* A downloaded model's bin, inside its button on the right. Once clicked, it asks again in red. */
.delete {
	position: absolute;
	top: 50%;
	right: 14px;
	min-width: 44px;
	height: 44px;
	padding: 0 10px;
	display: grid;
	place-items: center;
	font-size: 15px;
	font-weight: 700;
	color: var(--health);
	background: none;
	border: 0;
	border-radius: var(--radius-small);
	transform: translateY(-50%);
}

/* Stops a download under way: where the bin sits once it is done, with room kept for it. */
.cancel {
	position: absolute;
	top: 50%;
	right: 14px;
	padding: 6px 12px;
	font-size: 14px;
	font-weight: 700;
	color: var(--ink);
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: var(--radius-small);
	transform: translateY(-50%);
}

.cancel:hover {
	background: var(--parchment-deep);
}

.model-row:has(> .cancel) .model {
	padding-right: 100px;
}

.addon .cancel {
	position: static;
	transform: none;
}

.delete svg {
	width: 28px;
	height: 28px;
}

.delete:hover {
	background: var(--ink-soft);
}

.delete.armed {
	color: var(--parchment);
	background: var(--health);
	border: var(--line-thin) solid var(--ink);
}

.model .bar {
	position: absolute;
	left: 0;
	bottom: 0;
	height: 6px;
	background: var(--gold-deep);
	opacity: 1;
	transition: width var(--slow) linear;
}

/* Skaldic Laya, under the choices: an add-on to the main model, not one of them, kept to three short lines. */
.addon {
	position: relative;
	display: flex;
	align-items: center;
	gap: 16px;
	margin-top: 12px;
	padding: 12px 18px;
	border: var(--line-thin) dashed var(--ink);
	border-radius: var(--radius);
}

.addon.on {
	border-style: solid;
	background: color-mix(in srgb, var(--gold) 22%, var(--parchment));
	box-shadow: 0 0 0 var(--line) var(--gold), var(--shadow);
}

.addon .eyebrow {
	display: flex;
	align-items: center;
	gap: 8px;
}

.addon .badge {
	padding: 1px 7px;
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--parchment);
	background: var(--ink);
	border-radius: 999px;
}

.addon .pitch {
	flex: 1 1 auto;
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
	font-size: 14px;
}

.addon .title {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	column-gap: 10px;
}

.addon .title b {
	font-size: 17px;
	white-space: nowrap;
}

.addon .size {
	font-size: 13px;
	opacity: 0.7;
}

/* The status after the size, set apart by a dot. */
.addon .note {
	font-size: 13px;
	font-weight: 700;
	opacity: 0.85;
}

.addon .note::before {
	content: "·";
	margin-right: 10px;
	font-weight: 400;
}

.addon .line {
	font-size: 13px;
	line-height: 1.35;
	opacity: 0.9;
}

/*
 * Skaldic models, trained for ArcDirector: dark and gilded, with a sheen crossing them when hovered, so they stand
 * out from the general models as what this game is made for.
 */
.skaldic {
	position: relative;
	overflow: hidden;
	color: var(--parchment);
	background: var(--skaldic-bg);
	border-color: var(--gold);
	box-shadow: var(--shadow), inset 0 0 18px rgba(255, 200, 90, 0.12);
}

.skaldic::after {
	content: "";
	position: absolute;
	inset: 0;
	background: linear-gradient(100deg, transparent 30%, rgba(255, 225, 150, 0.25) 50%, transparent 70%);
	transform: translateX(-120%);
	pointer-events: none;
}

.skaldic:hover::after,
.skaldic:focus-within::after {
	transform: translateX(120%);
	transition: transform 0.9s var(--ease-out);
}

.model.skaldic:not(.downloaded),
.model.skaldic:hover:not(:disabled),
.model-row.recommended .model.skaldic {
	background: var(--skaldic-bg);
}

.model.skaldic:hover:not(:disabled),
.addon.skaldic:hover {
	box-shadow: var(--shadow), 0 0 20px rgba(255, 196, 80, 0.45), inset 0 0 18px rgba(255, 200, 90, 0.2);
}

.model.skaldic .mark {
	stroke: var(--gold);
	opacity: 1;
	filter: drop-shadow(0 0 5px rgba(255, 200, 90, 0.6));
}

.skaldic .eyebrow {
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--gold);
}

.skaldic .status,
.skaldic .note,
.skaldic .size {
	color: var(--gold);
	opacity: 0.85;
}

.addon.skaldic,
.addon.skaldic.on {
	border-color: var(--gold);
	background: var(--laya-bg);
}

.addon.skaldic .badge {
	color: var(--ink);
	background: var(--gold);
}

/* On the dark card, the switch's track is gold when on: the menu's ink would vanish into it. */
.addon.skaldic .switch {
	border-color: var(--gold);
}

.addon.skaldic .switch.on {
	background: var(--gold);
}

.addon.skaldic .switch.on::after {
	background: var(--parchment);
	border-color: var(--ink);
}

/* Its bin sits beside its switch, not over the card's corner as a model's does. */
.addon .delete {
	position: static;
	transform: none;
}

.addon.skaldic.on {
	border-style: solid;
	box-shadow: 0 0 0 var(--line) var(--gold), 0 0 22px rgba(255, 196, 80, 0.5), inset 0 0 18px rgba(255, 200, 90, 0.2);
}

@media (prefers-reduced-motion: reduce) {
	.skaldic:hover::after,
	.skaldic:focus-within::after {
		transition: none;
	}
}

/* One column: LM Studio becomes a row like the others. */
@container (max-width: 500px) {
	.choices {
		grid-template-columns: 1fr;
	}

	.lmstudio,
	.browser {
		flex: 0 0 auto;
	}

	.or {
		flex-direction: row;
	}

	.or::before,
	.or::after {
		width: auto;
		height: var(--line-thin);
	}

	.lmstudio {
		flex-direction: row;
		justify-content: flex-start;
		min-height: 74px;
		padding: 10px 16px;
	}

	.lmstudio img {
		width: 44px;
		height: 44px;
		border-radius: 10px;
	}

	.text {
		align-items: flex-start;
	}

	.text b {
		font-size: 18px;
	}
}

.steps ol {
	margin: 0;
	padding: 0;
	list-style: none;
	counter-reset: step;
	display: flex;
	flex-direction: column;
	gap: 14px;
}

/* A gold number, or a tick once LM Studio shows the step is done. */
.steps li {
	counter-increment: step;
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding-left: 46px;
	font-size: 15px;
	line-height: 1.35;
}

.steps li::before {
	content: counter(step);
	position: absolute;
	left: 0;
	top: 0;
	width: 32px;
	height: 32px;
	display: grid;
	place-items: center;
	font-weight: 700;
	background: var(--gold);
	border: var(--line-thin) solid var(--ink);
	border-radius: 50%;
}

.steps li.done::before {
	content: "✓";
}

.steps li b {
	font-size: 17px;
}

.steps a {
	color: var(--gold-deep);
	font-weight: 700;
}

/* Where to click in LM Studio, ringed and numbered; side by side at one height. Each opens full size. */
.shots {
	display: flex;
	gap: 8px;
	margin-top: 6px;
}

.shots a {
	flex: 1 1 0;
	min-width: 0;
	border: var(--line-thin) solid var(--ink);
	border-radius: var(--radius-small);
	overflow: hidden;
	box-shadow: var(--shadow);
}

/* Grown by aspect ratio, so the two share a height. */
.shots .model-search {
	flex-grow: 1.29;
}

.shots .download {
	flex-grow: 3.49;
}

/* A tall, narrow picture stays small; it opens full size. */
.shots.narrow a {
	flex: 0 0 150px;
}

.optional {
	font-size: 14px;
	font-weight: 400;
	opacity: 0.7;
}

.shots img {
	display: block;
	width: 100%;
}

code {
	font-family: var(--font-mono);
	font-size: 0.9em;
	white-space: nowrap;
	padding: 0 4px;
	background: var(--parchment-deep);
	border-radius: 4px;
}

.check {
	margin: 16px 0 0;
	font-size: 14px;
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 4px 10px;
}

.link {
	padding: 0;
	background: none;
	border: 0;
	font-weight: 700;
	text-decoration: underline;
}

.actions {
	display: flex;
	justify-content: flex-end;
	gap: 10px;
	margin-top: 16px;
}

.actions button {
	padding: 6px 18px;
	font-size: 16px;
	font-weight: 700;
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: var(--radius-small);
	box-shadow: var(--shadow);
}

.actions button:hover {
	background: var(--parchment-deep);
}

.actions .primary {
	color: #fff;
	background: linear-gradient(135deg, #6b74ed, #5018c0);
}

.actions .primary:hover {
	background: linear-gradient(135deg, #5d66e0, #4413a8);
}</style>
