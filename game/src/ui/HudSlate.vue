<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { arcLines, bracketDepth, rootVerbs, thinkTime, thoughtTail, type ArcLine } from './arc-text';
import HudArcLine from './HudArcLine.vue';
import { SLATE_HEIGHT, SLATE_WIDTH, type HudSlate } from './hud-model';

const props = defineProps<{
	slate:HudSlate;
}>();

/** The runes that flicker at the pen's tip before each letter settles: the goal orbs' own (HudGoals) and their kin. */
const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
/** How many letters behind the pen are still runes, and how many times a second they change. */
const TIP = 6;
const FLICKERS = 18;
/** Letters a second the pen writes at least, and how quickly it catches up with the model (of what is still unwritten, per second). */
const PEN_SPEED = 45;
const PEN_CATCH_UP = 7;
/** The needles of light round a chosen Arc, and the rough shape of a slate they are laid out on (px): only the proportions count. */
const RAY_COUNT = 34;
const RAY_BOX = [330, 150] as const;
/** How much a needle leans away from the middle rather than straight out of its edge, so the corners fan. */
const RAY_FAN = 0.65;
/** A needle's length and width at its base (px), and how late it starts (ms). */
const RAY_LENGTH = [12, 46] as const;
const RAY_WIDTH = [3, 7] as const;
const RAY_LATE = 170;
/** How far a needle must reach (0 to 1 of the difference in lengths) for a star to twinkle at its tip. */
const RAY_STAR = 0.55;

/** Evenly round the edge, each one's size and timing scattered by the golden ratio, so most are short and a few reach far. */
const RAYS = Array.from({ length: RAY_COUNT }, (_, i) => {
	const [w, h] = RAY_BOX;
	const around = (i + 0.5) / RAY_COUNT * 2 * (w + h);
	const onTop = around < w;
	const onRight = !onTop && around < w + h;
	const onBottom = !onTop && !onRight && around < 2 * w + h;
	const x = onTop ? around : onRight ? w : onBottom ? 2 * w + h - around : 0;
	const y = onTop ? 0 : onRight ? around - w : onBottom ? h : 2 * (w + h) - around;
	const out = onTop ? [0, -1] : onRight ? [1, 0] : onBottom ? [0, 1] : [-1, 0];
	const fromMiddle = [(x - w / 2) / (w / 2), (y - h / 2) / (h / 2)];
	const angle = Math.atan2(out[0]! + fromMiddle[0]! * RAY_FAN, -(out[1]! + fromMiddle[1]! * RAY_FAN));
	const scatter = (i * 0.618034) % 1;
	const reach = scatter * scatter;
	return {
		left: `${(x / w) * 100}%`,
		top: `${(y / h) * 100}%`,
		'--turn': `${angle}rad`,
		'--long': `${RAY_LENGTH[0] + reach * (RAY_LENGTH[1] - RAY_LENGTH[0])}px`,
		'--wide': `${RAY_WIDTH[0] + reach * (RAY_WIDTH[1] - RAY_WIDTH[0])}px`,
		animationDelay: `${((i * 0.381966) % 1) * RAY_LATE}ms`,
		star: reach > RAY_STAR,
	};
});

/** How often it looks again at what has scrolled off the top of the page (ms). */
const COUNT_EVERY = 300;

/** Letters of the Arc shown so far: the model's words come in bursts, and the pen evens them out. */
const shown = ref(0);
const flicker = ref(0);
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

let frame = 0;
let last = performance.now();
let wrote = '';
let nextCount = 0;
/** The first line of the Arc in sight under the pinned ones, and the root verbs whose calls are all above it, counted. */
let firstShown = 0;
const scrolled = ref<[string, number][]>([]);

function step(now:number):void {
	const dt = (now - last) / 1000;
	last = now;
	const text = props.slate.arc;
	if (text !== wrote) {
		// The pen goes back only as far as the words changed: a call that turns out to hold an arc is laid out anew from
		// there, and a new request changes them all.
		let same = 0;
		while (same < text.length && text[same] === wrote[same]) {
			same += 1;
		}
		shown.value = Math.min(shown.value, same + TIP);
		wrote = text;
	}
	if (shown.value < text.length) {
		const left = text.length - shown.value;
		shown.value = still ? text.length : Math.min(text.length, shown.value + Math.max(PEN_SPEED, left * PEN_CATCH_UP) * dt);
		flicker.value = Math.floor(now / 1000 * FLICKERS);
	}
	pin();
	if (now >= nextCount) {
		nextCount = now + COUNT_EVERY;
		const gone = rootVerbs(lines.value.slice(0, firstShown));
		if (JSON.stringify(gone) !== JSON.stringify(scrolled.value)) {
			scrolled.value = gone;
		}
	}
	frame = requestAnimationFrame(step);
}

onMounted(() => {
	frame = requestAnimationFrame(step);
});

onBeforeUnmount(() => {
	cancelAnimationFrame(frame);
});

/** The letter a rune at `i` is standing in for shows when the pen has passed: until then, whichever rune it is on this flicker. */
function rune(i:number):string {
	return RUNES[(i * 7 + flicker.value * 11) % RUNES.length]!;
}

/** The Arc so far, line by line. */
const lines = computed(() => {
	const text = props.slate.arc;
	const end = Math.floor(shown.value);
	const writing = props.slate.state === 'writing' || end < text.length;
	return arcLines(text, end, writing && !still ? Math.max(0, end - TIP) : end, rune);
});

/** The most opening lines kept pinned at the top of a slate: its nearest, if it is nested deeper. */
const MAX_PINNED = 3;
/** How tall a pinned line stands, px; matches `.pinned .line`. */
const PINNED_LINE = 17;
const pageEl = ref<HTMLElement | null>(null);
const arcEl = ref<HTMLElement | null>(null);
const pinnedEl = ref<HTMLElement | null>(null);
/** Which lines are pinned, as in a code editor: those that opened the block the top of the page is now inside. */
const pinned = ref<number[]>([]);
let measured = '';

/** A pinned line says only the call it opens: what comes before it in the chain has no block to follow. */
function opening(line:ArcLine):ArcLine {
	let depth = 0;
	let from = 0;
	line.pieces.forEach((piece, i) => {
		// A `||` inside brackets is part of an expression, not of the chain.
		if (piece.kind === 'mark' && depth <= 0) {
			from = i + 1;
		}
		depth += bracketDepth(piece);
	});
	return { ...line, pieces: line.pieces.slice(from).filter((piece) => piece.text.trim()) };
}

/** Finds them again whenever the page has moved. Pinning covers more of the page, which can change what is on top, so it looks again. */
function pin():void {
	const page = pageEl.value;
	const arc = arcEl.value;
	// They stand above the page, which has moved down by their height.
	const shift = pinnedEl.value?.offsetHeight ?? 0;
	const key = `${arc?.offsetHeight}/${page?.clientHeight}/${shift}/${lines.value.length}`;
	if (key === measured) {
		return;
	}
	measured = key;
	if (!arc) {
		pinned.value = [];
		firstShown = 0;
		return;
	}
	const rows = [...arc.children] as HTMLElement[];
	const column = arc.parentElement!.offsetTop;
	const list = lines.value;
	let found:number[] = [];
	let cover = 0;
	for (let pass = 0; pass < 3; pass += 1) {
		// Rows are placed within the column, which the page has pushed up as the Arc outgrew it.
		let top = rows.findIndex((row) => column + row.offsetTop + shift + row.offsetHeight > cover);
		// A long opening line wraps: once its start is out of sight it is pinned like one above.
		if (list[top]?.opens && top + 1 < rows.length && column + rows[top]!.offsetTop + shift < cover) {
			top += 1;
		}
		firstShown = Math.max(0, top);
		const openers:number[] = [];
		let indent = list[top]?.indent ?? 0;
		for (let i = top - 1; i >= 0; i -= 1) {
			if (list[i]?.opens && list[i]!.indent < indent) {
				openers.unshift(i);
				indent = list[i]!.indent;
			}
		}
		// Only ever covering more: uncovering again could bring back the block just left, and it would never settle.
		const height = Math.min(openers.length, MAX_PINNED) * PINNED_LINE;
		if (height <= cover) {
			break;
		}
		found = openers.slice(-MAX_PINNED);
		cover = height;
	}
	if (found.join() !== pinned.value.join()) {
		pinned.value = found;
	}
}

/** The last of the reasoning, faint, above the Arc. */
const thought = computed(() => thoughtTail(props.slate.thought));

const time = computed(() => thinkTime(props.slate.ms));
</script>

<template>
	<aside
		v-show="slate.visible"
		class="hud-slate"
		:class="[`hue-${slate.color}`, slate.state, { leaving: slate.leaving, wrong: slate.wrong }]"
		:style="{ width: `${SLATE_WIDTH}px` }"
		:aria-label="`${slate.name} writes an Arc`"
	>
		<template v-if="slate.state === 'done'">
			<span class="halo" />
			<span class="rays">
				<template v-for="({ star, ...ray }, i) in RAYS" :key="i">
					<span class="ray" :style="ray" />
					<span v-if="star" class="star" :style="ray" />
				</template>
			</span>
			<span class="pulse" />
			<span class="pulse late" />
		</template>
		<div class="glass" :style="{ maxHeight: `${SLATE_HEIGHT}px` }">
			<header>
				<span class="orb" />
				<strong>{{ slate.name }}</strong>
				<span v-if="scrolled.length" class="scrolled">
					<span v-for="[verb, times] in scrolled" :key="verb">{{ verb }}<template v-if="times > 1"> ×{{ times }}</template></span>
				</span>
				<span class="time">{{ time }}</span>
			</header>
			<p v-if="slate.error && slate.state !== 'done'" class="error" :style="{ maxHeight: `${SLATE_HEIGHT * 0.2}px` }">{{ slate.error }}</p>
			<div v-if="pinned.length" ref="pinnedEl" class="pinned">
				<template v-for="i in pinned" :key="i">
					<HudArcLine v-if="lines[i]" class="line" :line="opening(lines[i]!)" />
				</template>
			</div>
			<div ref="pageEl" class="page" :class="{ thinking: thought }">
				<div class="column">
					<p v-if="thought" class="thought">{{ thought }}</p>
					<div v-if="slate.arc || slate.state === 'writing'" ref="arcEl" class="arc">
						<HudArcLine v-for="(line, i) in lines" :key="i" :line="line">
							<span v-if="slate.state === 'writing' && i === lines.length - 1" class="pen" />
						</HudArcLine>
					</div>
				</div>
			</div>
			<span v-if="slate.state === 'done'" class="glint" />
		</div>
	</aside>
</template>

<style scoped>
/* Off screen until `HudSlates` places it. Its spikes and pulses stand behind the glass, which comes after them. */
.hud-slate {
	position: absolute;
	left: 0;
	top: 0;
	translate: -9999px 0;
	transition: opacity 280ms;
}

.hud-slate.leaving {
	opacity: 0;
}

/*
 * Dark smoked glass, the goal orbs' unlit smoke: a heavy ink line round it, a band of the side's metal inside that, a
 * hard diagonal facet like the hearts', and a short shadow, standing on the world by the head of whoever is writing.
 */
.glass {
	position: relative;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	padding: 6px 10px 8px;
	color: var(--glass-text);
	background: var(--glass);
	border: var(--line) solid var(--ink);
	border-radius: var(--radius-small);
	box-shadow: inset 0 0 0 1.5px var(--hue-deep), var(--shadow);
	font: 700 12.5px/1.35 var(--font-mono);
	animation: open var(--slow) var(--ease-pop);
	transition: box-shadow 300ms;
}

/* The light on the glass lies over everything behind it, the pinned lines too. */
.glass::after {
	content: '';
	position: absolute;
	inset: 0;
	background: var(--glass-facet);
	pointer-events: none;
}

.done .glass {
	box-shadow: inset 0 0 0 1.5px var(--hue), 0 0 14px var(--hue), var(--shadow);
	animation: chosen 500ms var(--ease-pop);
}

/* Cut short by a newer think: nothing went wrong, it just goes. */
.dropped .glass {
	opacity: 0.55;
	filter: saturate(0.3);
}

/* A reply turned down: it shakes from side to side, settling like a spring, and flushes red; a failed think stays red. */
.wrong {
	animation: shake 600ms linear;
}

.wrong .glass,
.failed .glass {
	background: radial-gradient(ellipse at 30% 20%, #5a2024, #2a0f14 70%);
	box-shadow: inset 0 0 0 1.5px var(--health), 0 0 14px var(--health), var(--shadow);
}

.wrong .orb,
.failed .orb {
	background: var(--health);
	box-shadow: 0 0 6px var(--health);
	animation: none;
}

.error {
	flex: none;
	margin: 0 0 3px;
	color: #ff9d8c;
	font: 700 11px/1.3 var(--font);
	overflow-wrap: anywhere;
	overflow: hidden;
}

/* An Arc chosen: a sharp white reflection racing across the glass, as off a tilted blade: one broad bar and one thin. */
.glint {
	position: absolute;
	inset: 0;
	background: linear-gradient(108deg, transparent 40%, #fff 40% 49%, transparent 49% 52%, #fff 52% 54%, transparent 54%);
	translate: -100% 0;
	opacity: 0.5;
	pointer-events: none;
	animation: glint 420ms cubic-bezier(0.5, 0, 0.3, 1) 80ms forwards;
}

/* And a soft bloom round the glass, that the needles of light seem to come out of. */
.halo {
	position: absolute;
	inset: 0;
	border-radius: var(--radius-small);
	box-shadow: 0 0 26px 7px var(--hue);
	opacity: 0;
	animation: halo 950ms ease-out forwards;
}

/* The needles: each stands on the edge, under the glass, its tip thrown outward. */
.rays {
	position: absolute;
	inset: 0;
	/* A thin ink edge, so they hold on bright ground as well as dark; then their glow. */
	filter: drop-shadow(0 0 0.6px rgba(90, 58, 32, 0.8)) drop-shadow(0 0 3px var(--hue));
}

/* At the tips of the longest: a four-pointed star that twinkles once as its needle arrives. */
.star {
	position: absolute;
	width: 11px;
	height: 11px;
	translate: -50% -50%;
	transform: rotate(var(--turn)) translateY(calc(-1.1 * var(--long))) scale(0);
	clip-path: polygon(50% 0, 60% 40%, 100% 50%, 60% 60%, 50% 100%, 40% 60%, 0 50%, 40% 40%);
	background: #fff;
	animation: star 760ms ease-out forwards;
}

.ray {
	position: absolute;
	width: var(--wide);
	height: var(--long);
	translate: -50% -100%;
	transform-origin: 50% 100%;
	transform: rotate(var(--turn)) scaleY(0);
	clip-path: polygon(50% 0, 100% 100%, 0 100%);
	background: linear-gradient(to top, #fff 8%, var(--hue-light) 34%, var(--hue) 68%, transparent);
	opacity: 0;
	animation: ray 880ms cubic-bezier(0.16, 0.9, 0.3, 1) forwards;
}

/* And rectangles of light leaving its edges, each only a little way. */
.pulse {
	position: absolute;
	inset: 0;
	border: 3px solid var(--hue);
	border-radius: var(--radius-small);
	box-shadow: 0 0 10px var(--hue), inset 0 0 8px var(--hue);
	opacity: 0;
	animation: pulse 600ms var(--ease-out) forwards;
}

.pulse.late {
	border-color: #fffbe8;
	animation-delay: 170ms;
}

header {
	flex: none;
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 3px;
	font: 700 13px/1.2 var(--font);
}

strong {
	flex: none;
	color: var(--hue-light);
}

/* The root verbs written and scrolled away, so it still says what the Arc did. */
.scrolled {
	display: flex;
	gap: 6px;
	min-width: 0;
	overflow: hidden;
	color: var(--hue);
	font: 700 11px/1.2 var(--font-mono);
	white-space: nowrap;
}

.time {
	flex: none;
	margin-left: auto;
	color: var(--hue);
	font: 700 11px/1 var(--font-mono);
}

/* The little orb on the header: its glass turning with mist while the mind writes, lit once it has. */
.orb {
	flex: none;
	width: 11px;
	height: 11px;
	border-radius: 50%;
	border: 1.5px solid var(--ink);
	background: conic-gradient(var(--hue), #3a2a44 40%, var(--hue-deep) 70%, var(--hue));
	box-shadow: 0 0 0 1px var(--hue-deep);
	animation: turn 1.4s linear infinite;
}

.done .orb {
	background: radial-gradient(circle at 36% 32%, #fffbe8, var(--hue) 45%, var(--hue-deep));
	box-shadow: 0 0 6px var(--hue);
	animation: none;
}

/* The newest lines stay in sight; older ones scroll off the top, as on a terminal. */
.page {
	position: relative;
	display: flex;
	flex-direction: column;
	justify-content: flex-end;
	min-height: 0;
	overflow: hidden;
}

/* The lines that opened the block on top, on the glass itself over the page, which clips at a hard rule below them. */
.pinned {
	flex: none;
	border-bottom: 1.5px solid var(--hue-deep);
}

.pinned .line {
	height: 17px;
	min-height: 0;
	line-height: 17px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* The reasoning and the Arc under it: only the Arc takes room, so the slate grows once the Arc outgrows the reasoning. */
.column {
	position: relative;
	flex: none;
}

/* While there is reasoning, the page is at least as tall as it stands. */
.page.thinking {
	min-height: calc(5.2 * 11px + 3px);
}

/* The same height whatever the reasoning wraps to, its newest words at the foot, riding on top of the Arc. */
.thought {
	position: absolute;
	bottom: 100%;
	left: 0;
	right: 0;
	display: flex;
	flex-direction: column;
	justify-content: flex-end;
	height: 5.2em;
	margin: 0 0 3px;
	overflow: hidden;
	color: var(--glass-text);
	opacity: 0.45;
	font: 400 11px/1.3 var(--font);
}

.arc {
	flex: none;
}

/* The pen: a cut gem, the shape of the Ingwaz rune on the orbs. */
.pen {
	display: inline-block;
	width: 7px;
	height: 7px;
	margin-left: 3px;
	background: var(--hue-light);
	box-shadow: 0 0 6px var(--hue);
	transform: rotate(45deg);
	animation: blink 700ms steps(2, jump-none) infinite;
}

@keyframes open {
	from { opacity: 0; transform: scale(0.85); }
}

@keyframes chosen {
	0% { transform: scale(1); filter: brightness(1); }
	30% { transform: scale(1.04); filter: brightness(1.6); }
	100% { transform: scale(1); filter: brightness(1); }
}

@keyframes glint {
	from { translate: -100% 0; }
	to { translate: 100% 0; }
}

@keyframes halo {
	0% { opacity: 0; }
	18% { opacity: 0.6; }
	100% { opacity: 0; }
}

/* Out fast, then it lingers, drifting a little further as it fades from the tip's end of its life. */
@keyframes ray {
	0% { transform: rotate(var(--turn)) scaleY(0.1); opacity: 0; }
	14% { opacity: 1; }
	45% { transform: rotate(var(--turn)) scaleY(1); opacity: 0.9; }
	100% { transform: rotate(var(--turn)) scaleY(1.2); opacity: 0; }
}

@keyframes star {
	0%, 22% { transform: rotate(var(--turn)) translateY(calc(-1.1 * var(--long))) scale(0); }
	48% { transform: rotate(var(--turn)) translateY(calc(-1.1 * var(--long))) scale(1) rotate(45deg); }
	100% { transform: rotate(var(--turn)) translateY(calc(-1.1 * var(--long))) scale(0) rotate(120deg); }
}

/* Each swing narrower than the last. */
@keyframes shake {
	0%, 100% { transform: translateX(0); }
	12% { transform: translateX(-11px); }
	28% { transform: translateX(9px); }
	44% { transform: translateX(-6px); }
	60% { transform: translateX(4px); }
	76% { transform: translateX(-2px); }
	90% { transform: translateX(1px); }
}

@keyframes pulse {
	0% { inset: 0; opacity: 1; }
	100% { inset: -16px; opacity: 0; border-radius: calc(var(--radius-small) + 12px); }
}

@keyframes turn {
	to { transform: rotate(360deg); }
}

@keyframes blink {
	from { opacity: 1; }
	to { opacity: 0.25; }
}

@media (prefers-reduced-motion: reduce) {
	.glass,
	.orb,
	.pen,
	.wrong {
		animation: none;
	}

	.glint,
	.halo,
	.rays,
	.pulse {
		display: none;
	}
}
</style>
