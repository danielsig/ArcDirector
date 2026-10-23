<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { GoalColor, HudModel } from './hudModel';

const props = defineProps<{
	hud:HudModel;
}>();

type Side = 'left' | 'right';

type Orb = {
	key:string;
	name:string;
	progress:number;
	done:boolean;
	side:Side;
	color:GoalColor;
	/** Its place on its own side, which picks its rune and setting. */
	index:number;
};

/** A stretch of line between two orbs: filled from `from`'s end by the goal it leads into. */
type Segment = { key:string; progress:number; from:Side | null; color:GoalColor | null };

/** How long a just-reached orb plays its level-up burst, ms. Matches the longest animation below. */
const BURST_MS = 1400;
const SPARKS = 10;

/** Runes carved into the orbs, one per orb in turn, drawn round the orb's centre (0, 0). */
const RUNES = [
	'M0,5V-5M0,-1L-4,-5M0,-1L4,-5',			// Algiz
	'M-2,5V-5L3,-2M-2,-1L3,2',				// Fehu
	'M-3,-5L2,-2L-2,2L3,5',					// Sowilo
	'M0,5V-5M-4,-1L0,-5L4,-1',				// Tiwaz
	'M0,-5L4,0L0,5L-4,0Z',					// Ingwaz
	'M-4,-4V4L4,-4V4Z',						// Dagaz
	'M-4,5L2,-1L0,-5L-2,-1L4,5',			// Othala
	'M-2,5V-5L3,-2L-2,1',					// Thurisaz
];

/** The gold setting's points: four, six or eight in turn. */
function points(o:Orb):number[] {
	const n = 4 + (o.index % 3) * 2;
	return Array.from({ length: n }, (element, i) => (i / n) * 360);
}

/** Circumference of the setting's ring, which fills with the goal's own progress. */
const RING = 2 * Math.PI * 16.5;

/** Keyed by colour, not end, so an orb stays itself when the two sides swap ends. */
function orbsOf(side:Side):Orb[] {
	const { color, goals } = props.hud.goals[side];
	return goals.map((g, i) => ({ key: `${color}${i}`, name: g.name, progress: g.progress, done: g.progress >= 1, side, color, index: i }));
}

/** Left goals in order from the left end, then right goals from the right end (so reversed). */
const orbs = computed(() => [...orbsOf('left'), ...orbsOf('right').reverse()]);

/**
 * The line between orb `i` and orb `i + 1` shows the progress of the goal it leads into: the next one for the left
 * side, the previous one for the right. Where the sides meet, it is neither's.
 */
const segments = computed<Segment[]>(() => orbs.value.slice(1).map((next, i) => {
	const prev = orbs.value[i];
	const into = next.side === 'left' ? next : prev.side === 'right' ? prev : null;
	return { key: `seg${i}`, progress: into?.progress ?? 0, from: into?.side ?? null, color: into?.color ?? null };
}));

/** Orbs reached since mount; only these burst, so a loaded save does not set every orb off at once. */
const bursting = ref(new Set<string>());
const timers = new Set<ReturnType<typeof setTimeout>>();

watch(orbs, (now, before) => {
	const was = new Map(before.map(o => [o.key, o.done]));
	for (const o of now) {
		if (!o.done || was.get(o.key) !== false) continue;
		bursting.value.add(o.key);
		const t = setTimeout(() => {
			bursting.value.delete(o.key);
			timers.delete(t);
		}, BURST_MS);
		timers.add(t);
	}
});

/** Orb width, the line's longest and shortest visible stretch, and the room kept clear of other HUD, px. */
const ORB = 40;
const LINE_MAX = 28;
const LINE_MIN = 8;
const CLEAR = 12;
/** Same row as the hearts and the back and restart buttons: 40px tall from here, centres level. */
const TOP = 10;

const root = ref<HTMLElement | null>(null);
const place = ref({ left: 0, top: TOP, line: LINE_MAX });

function widthWith(n:number, line:number):number {
	return n * ORB + (n - 1) * line;
}

/**
 * Fit the track between whatever else stands along the top of the screen (the corner buttons, the hearts when shown):
 * as near the middle as there is room for, with shorter lines if need be. With no room even then, it drops below them.
 */
function layout():void {
	const layer = root.value?.parentElement;
	const n = orbs.value.length;
	if (!layer || n === 0) {
		return;
	}
	const screen = layer.getBoundingClientRect();
	const mid = screen.width / 2;
	let left = 0;
	let right = screen.width;
	let bottom = 0;
	for (const el of layer.querySelectorAll('button, .hud-hearts')) {
		const r = el.getBoundingClientRect();
		if (r.width === 0 || r.top - screen.top > TOP + ORB) {
			continue;
		}
		const x0 = r.left - screen.left;
		const x1 = r.right - screen.left;
		if ((x0 + x1) / 2 < mid) {
			left = Math.max(left, x1);
		}
		else {
			right = Math.min(right, x0);
		}
		bottom = Math.max(bottom, r.bottom - screen.top);
	}
	const fit = (from:number, to:number):number => Math.min(LINE_MAX, (to - from - 2 * CLEAR - n * ORB) / Math.max(1, n - 1));
	let line = fit(left, right);
	let top = TOP;
	if (line < LINE_MIN) {
		left = 0;
		right = screen.width;
		line = Math.max(LINE_MIN, fit(left, right));
		top = bottom + CLEAR;
	}
	const width = widthWith(n, line);
	const x = Math.max(left + CLEAR, Math.min(right - CLEAR - width, mid - width / 2));
	place.value = { left: Math.round(x), top: Math.round(top), line: Math.floor(line) };
}

const relayout = ():void => void nextTick(layout);
let observer:ResizeObserver | undefined;

watch(() => [orbs.value.length, props.hud.player, props.hud.maxHP], relayout);

onMounted(() => {
	observer = new ResizeObserver(relayout);
	if (root.value?.parentElement) {
		observer.observe(root.value.parentElement);
	}
	relayout();
});

/** How long two sides take to trade ends, ms, and how high their orbs arc as they pass each other, px. */
const SWAP_MS = 900;
const SWAP_ARC = 26;

const orbEls = new Map<string, HTMLElement>();
/** Both colours while two sides trade ends: the clash where they pass each other shows them both. */
const swapping = ref<[GoalColor, GoalColor] | null>(null);
let swapTimer:ReturnType<typeof setTimeout> | undefined;

function orbRef(key:string, el:unknown):void {
	if (el instanceof HTMLElement) {
		orbEls.set(key, el);
	}
	else {
		orbEls.delete(key);
	}
}

/**
 * When the two sides trade ends, every orb flies to its new place: those heading right arc over, those heading left
 * under, so the two lines pass each other, and a flash of both colours breaks where they cross.
 */
watch(() => `${props.hud.goals.left.color}|${props.hud.goals.right.color}`, (now, before) => {
	const [left, right] = now.split('|') as [GoalColor, GoalColor];
	if (`${right}|${left}` !== before || !props.hud.goals.left.goals.length || !props.hud.goals.right.goals.length
		|| matchMedia('(prefers-reduced-motion: reduce)').matches) {
		return;
	}
	const from = new Map([...orbEls].map(([key, el]) => [key, el.getBoundingClientRect().left]));
	void nextTick(() => {
		for (const [key, el] of orbEls) {
			const was = from.get(key);
			if (was === undefined) {
				continue;
			}
			const dx = was - el.getBoundingClientRect().left;
			const lift = dx < 0 ? -SWAP_ARC : SWAP_ARC;
			el.animate([
				{ transform: `translate(${dx}px, 0) scale(1)`, zIndex: 2 },
				{ transform: `translate(${dx / 2}px, ${lift}px) scale(1.3)`, zIndex: 2, offset: 0.5 },
				{ transform: 'translate(0, 0) scale(1)', zIndex: 2 },
			], { duration: SWAP_MS, easing: 'cubic-bezier(0.55, 0, 0.25, 1)' });
		}
		swapping.value = [left, right];
		clearTimeout(swapTimer);
		swapTimer = setTimeout(() => {
			swapping.value = null;
		}, SWAP_MS + 200);
	});
});

onBeforeUnmount(() => {
	timers.forEach(clearTimeout);
	clearTimeout(swapTimer);
	observer?.disconnect();
});
</script>

<template>
	<div
		v-show="orbs.length"
		ref="root"
		class="hud-goals"
		:class="{ swapping }"
		:style="{ left: `${place.left}px`, top: `${place.top}px`, '--line': `${place.line}px` }"
		role="progressbar"
		aria-label="Goals"
		:aria-valuemax="orbs.length"
		:aria-valuenow="orbs.filter(o => o.done).length"
	>
		<template v-for="(o, i) in orbs" :key="o.key">
			<span
				v-if="i > 0"
				class="segment"
				:class="[segments[i - 1].from, segments[i - 1].color]"
				:style="{ '--progress': segments[i - 1].progress }"
			><span class="fill" /></span>
			<span
				:ref="(el) => orbRef(o.key, el)"
				class="orb"
				:class="[o.color, { done: o.done, burst: bursting.has(o.key) }]"
				:aria-label="`${o.name}${o.done ? ' (done)' : ''}`"
			>
				<template v-if="bursting.has(o.key)">
					<span class="ring" />
					<span class="ring late" />
					<span class="rays" />
					<span v-for="s in SPARKS" :key="s" class="spark" :style="{ '--a': `${(s / SPARKS) * 360 + 18}deg` }" />
				</template>
				<svg class="gem" viewBox="0 0 40 40" aria-hidden="true">
					<defs>
						<radialGradient :id="`${o.key}-glass`" cx="0.36" cy="0.32" r="0.75">
							<stop offset="0" class="glass-a" />
							<stop offset="0.45" class="glass-b" />
							<stop offset="1" class="glass-c" />
						</radialGradient>
						<radialGradient :id="`${o.key}-shade`" cx="0.5" cy="0.5" r="0.5">
							<stop offset="0.6" stop-color="#000" stop-opacity="0" />
							<stop offset="1" stop-color="#000" stop-opacity="0.55" />
						</radialGradient>
						<clipPath :id="`${o.key}-ball`">
							<circle cx="20" cy="20" r="12.5" />
						</clipPath>
					</defs>

					<!-- The gold setting: its points, then its ring, which fills as the goal does -->
					<g class="setting">
						<path
							v-for="a in points(o)"
							:key="a"
							class="point"
							:transform="`rotate(${a} 20 20)`"
							d="M20,0.8L21.6,4L20,5.6L18.4,4Z"
						/>
						<circle
							v-for="a in points(o)"
							:key="`dot${a}`"
							class="bead"
							:transform="`rotate(${a + 180 / points(o).length} 20 20)`"
							cx="20"
							cy="2.6"
							r="0.9"
						/>
					</g>
					<circle class="band" cx="20" cy="20" r="16.5" />
					<circle
						class="band-fill"
						cx="20"
						cy="20"
						r="16.5"
						:stroke-dasharray="`${o.progress * RING} ${RING}`"
						transform="rotate(-90 20 20)"
					/>

					<!-- The glass sphere: body, mist turning inside, rune, rim shade, light -->
					<circle cx="20" cy="20" r="13" class="socket" />
					<circle cx="20" cy="20" r="12.5" :fill="`url(#${o.key}-glass)`" />
					<g :clip-path="`url(#${o.key}-ball)`">
						<g class="mist">
							<path d="M8,22C12,14 22,12 31,17" />
							<path d="M10,28C16,22 24,24 32,23" />
						</g>
					</g>
					<path class="rune" :d="RUNES[o.index % RUNES.length]" transform="translate(20 20.5)" />
					<circle cx="20" cy="20" r="12.5" :fill="`url(#${o.key}-shade)`" />
					<path class="rim" d="M11.5,26.5A11,11 0 0 0 28.5,26.5" />
					<ellipse class="shine" cx="15.6" cy="14" rx="4.4" ry="2.6" transform="rotate(-35 15.6 14)" />
					<circle class="shine small" cx="25.5" cy="12.5" r="0.9" />
					<circle class="outline" cx="20" cy="20" r="12.5" />
				</svg>
				<span v-if="o.done" class="twinkle" />
				<span class="tip" aria-hidden="true">{{ o.name }}</span>
			</span>
		</template>
		<span v-if="swapping" class="clash" aria-hidden="true">
			<span class="clash-ring" :class="swapping[0]" />
			<span class="clash-ring late" :class="swapping[1]" />
		</span>
	</div>
</template>

<style scoped>
/* Same size and same short shadow as the hearts (HudHearts), on the world with no panel. Placed by `layout`. */
.hud-goals {
	position: absolute;
	display: flex;
	align-items: center;
	pointer-events: none;
}

/* Each side's colour (`GoalColor`). */
.gold {
	--hue: var(--gold);
	--hue-deep: var(--gold-deep);
	--hue-light: #fff3c4;
}

.red {
	--hue: #f07a5c;
	--hue-deep: var(--health);
	--hue-light: #ffd9cc;
}

.blue {
	--hue: #6cb8ff;
	--hue-deep: #2f63c8;
	--hue-light: #dff0ff;
}

.segment {
	position: relative;
	/* Tucked 4px under the orb at each end, so `--line` of it shows. */
	width: calc(var(--line) + 8px);
	height: 8px;
	margin: 0 -4px;
	background: var(--health-track);
	border: var(--line-thin) solid var(--ink);
	box-shadow: var(--shadow);
	overflow: hidden;
}

.segment .fill {
	position: absolute;
	top: 0;
	bottom: 0;
	width: calc(var(--progress) * 100%);
	background: linear-gradient(180deg, var(--hue-light), var(--hue) 45%, var(--hue-deep));
	box-shadow: 0 0 6px var(--hue);
	transition: width 500ms var(--ease-out);
}

.segment.left .fill {
	left: 0;
}

.segment.right .fill {
	right: 0;
}

/* A glint running along a filling line */
.segment .fill::after {
	content: '';
	position: absolute;
	inset: 0;
	background: linear-gradient(90deg, transparent 0 30%, rgba(255, 255, 255, 0.7) 50%, transparent 70%);
	background-size: 200% 100%;
	animation: glint 1.6s linear infinite;
}

/* While the sides trade ends, the lines fade out, and back in once each orb has landed. */
.swapping .segment {
	animation: refill 900ms ease-in-out;
}

/* Where the two sides pass each other mid-swap: a white flash, and a ring of each side's colour spreading from it. */
.clash {
	position: absolute;
	z-index: 3;
	left: 50%;
	top: 50%;
	width: 0;
	height: 0;
}

.clash::before {
	content: '';
	position: absolute;
	left: -30px;
	top: -30px;
	width: 60px;
	height: 60px;
	border-radius: 50%;
	background: radial-gradient(circle, #fff 0 15%, rgba(255, 255, 255, 0.6) 35%, transparent 70%);
	opacity: 0;
	animation: clash 600ms ease-out 330ms forwards;
}

.clash-ring {
	position: absolute;
	left: -20px;
	top: -20px;
	width: 40px;
	height: 40px;
	border-radius: 50%;
	border: 3px solid var(--hue);
	box-shadow: 0 0 12px var(--hue), inset 0 0 10px var(--hue);
	opacity: 0;
	animation: ring 750ms var(--ease-out) 380ms forwards;
}

.clash-ring.late {
	animation-delay: 470ms;
}

/* Toward the middle: a right side's line runs the other way. */
.segment.right .fill::after {
	animation-direction: reverse;
}

.orb {
	position: relative;
	z-index: 1;
	/* The orbs alone take the mouse, for their tooltip; the rest of the HUD stays click-through. */
	pointer-events: auto;
	width: 40px;
	height: 40px;
	flex: none;
}

.gem {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	overflow: visible;
	filter: drop-shadow(var(--shadow));
}

/* Setting in its side's metal: dull until reached, then bright, and slowly turning */
.setting {
	transform-origin: 20px 20px;
}

.point,
.bead {
	fill: var(--hue-deep);
	stroke: var(--ink);
	stroke-width: 0.8;
}

.band {
	fill: none;
	stroke: var(--ink);
	stroke-width: 3.2;
}

.band-fill {
	fill: none;
	stroke: var(--hue);
	stroke-width: 1.6;
	stroke-linecap: round;
	transition: stroke-dasharray 500ms var(--ease-out);
}

.done .point,
.done .bead {
	fill: var(--hue);
}

.done .setting {
	animation: turn 24s linear infinite;
}

.done .band-fill {
	stroke: var(--hue);
}

.socket {
	fill: var(--ink);
}

/* Glass: smoky and dim with a hint of its side's colour until reached, then lit from within */
.glass-a {
	stop-color: #8a7890;
}

.glass-b {
	stop-color: #3a2a44;
}

.glass-c {
	stop-color: #120a16;
}

.done .glass-a {
	stop-color: #fffbe8;
}

.done .glass-b {
	stop-color: var(--hue);
}

.done .glass-c {
	stop-color: var(--hue-deep);
}

.mist path {
	fill: none;
	stroke: var(--hue-light);
	stroke-width: 2.2;
	stroke-linecap: round;
	opacity: 0.18;
}

.mist {
	transform-origin: 20px 20px;
	animation: turn 9s linear infinite;
}

.done .mist path {
	stroke: #fff;
	opacity: 0.45;
}

.rune {
	fill: none;
	stroke: var(--hue);
	stroke-width: 1.5;
	stroke-linecap: round;
	stroke-linejoin: round;
	opacity: 0.4;
}

.done .rune {
	stroke: #fff;
	opacity: 0.95;
	filter: drop-shadow(0 0 1.5px var(--hue-light)) drop-shadow(0 0 2.5px var(--hue));
}

.rim {
	fill: none;
	stroke: var(--hue);
	stroke-width: 1.2;
	stroke-linecap: round;
	opacity: 0.35;
}

.done .rim {
	stroke: var(--hue-light);
	opacity: 0.8;
}

.shine {
	fill: #fff;
	opacity: 0.75;
}

.shine.small {
	opacity: 0.6;
}

.outline {
	fill: none;
	stroke: var(--ink);
	stroke-width: 1.4;
}

.done .gem {
	filter: drop-shadow(var(--shadow)) drop-shadow(0 0 6px var(--hue));
	animation: glow 2.4s ease-in-out infinite;
}

.burst .gem {
	animation:
		pop 700ms var(--ease-pop),
		flash 700ms ease-out,
		glow 2.4s ease-in-out 700ms infinite;
}

/* What the goal is, in a line or two on parchment under its orb while hovered */
.tip {
	position: absolute;
	z-index: 4;
	top: calc(100% + 8px);
	left: 50%;
	width: max-content;
	max-width: 150px;
	padding: 4px 8px;
	font: 600 12px/1.3 var(--font);
	text-align: center;
	color: var(--ink);
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: var(--radius-small);
	box-shadow: var(--shadow);
	opacity: 0;
	transform: translate(-50%, -4px);
	transition: opacity var(--quick), transform var(--quick) var(--ease-out);
	pointer-events: none;
}

.orb:hover .tip {
	opacity: 1;
	transform: translate(-50%, 0);
	z-index: 5;
}

/* Shockwave rings */
.ring {
	position: absolute;
	inset: 0;
	border-radius: 50%;
	border: 3px solid var(--hue);
	box-shadow: 0 0 12px var(--hue), inset 0 0 12px var(--hue);
	animation: ring 800ms var(--ease-out) forwards;
}

.ring.late {
	border-color: #fffbe8;
	animation-delay: 160ms;
	opacity: 0;
}

/* Light rays turning behind the orb */
.rays {
	position: absolute;
	inset: -30px;
	z-index: -1;
	border-radius: 50%;
	background: repeating-conic-gradient(from 0deg, var(--hue) 0 8deg, transparent 8deg 30deg);
	mask-image: radial-gradient(circle, #000 20%, transparent 70%);
	-webkit-mask-image: radial-gradient(circle, #000 20%, transparent 70%);
	animation: rays 1400ms ease-out forwards;
}

/* Sparks flung outward, each down its own angle */
.spark {
	position: absolute;
	z-index: 2;
	left: 50%;
	top: 50%;
	width: 8px;
	height: 8px;
	margin: -4px;
	background: #fffbe8;
	clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
	filter: drop-shadow(0 0 3px var(--hue));
	animation: spark 900ms var(--ease-out) forwards;
}

.spark:nth-of-type(even) {
	width: 5px;
	height: 5px;
	margin: -2.5px;
	animation-duration: 1100ms;
}

/* A small star glinting on a reached orb's glass now and then */
.twinkle {
	position: absolute;
	top: 8px;
	left: 10px;
	width: 9px;
	height: 9px;
	background: #fff;
	clip-path: polygon(50% 0, 60% 40%, 100% 50%, 60% 60%, 50% 100%, 40% 60%, 0 50%, 40% 40%);
	filter: drop-shadow(0 0 2px #fff);
	animation: twinkle 3s ease-in-out infinite;
}

.orb:nth-child(4n) .twinkle {
	animation-delay: -1s;
}

.orb:nth-child(4n + 2) .twinkle {
	animation-delay: -2s;
}

@keyframes refill {
	0% { opacity: 1; }
	12%, 50% { opacity: 0; }
	85%, 100% { opacity: 1; }
}

@keyframes clash {
	0% { transform: scale(0.3); opacity: 0; }
	25% { transform: scale(1.2); opacity: 1; }
	100% { transform: scale(1.8); opacity: 0; }
}

@keyframes turn {
	to { transform: rotate(360deg); }
}

@keyframes glint {
	from { background-position: 150% 0; }
	to { background-position: -50% 0; }
}

@keyframes pop {
	0% { transform: scale(1); }
	30% { transform: scale(1.55); }
	55% { transform: scale(0.88); }
	100% { transform: scale(1); }
}

@keyframes flash {
	0%, 25% { filter: brightness(2.6) saturate(0.4) drop-shadow(0 0 10px var(--hue)); }
	100% { filter: drop-shadow(var(--shadow)) drop-shadow(0 0 6px var(--hue)); }
}

@keyframes glow {
	0%, 100% { filter: drop-shadow(var(--shadow)) drop-shadow(0 0 5px var(--hue)); }
	50% { filter: drop-shadow(var(--shadow)) drop-shadow(0 0 10px var(--hue)) brightness(1.12); }
}

@keyframes ring {
	0% { transform: scale(0.6); opacity: 1; }
	100% { transform: scale(2.6); opacity: 0; }
}

@keyframes rays {
	0% { transform: scale(0.3) rotate(0deg); opacity: 0; }
	20% { opacity: 0.9; }
	100% { transform: scale(1.2) rotate(90deg); opacity: 0; }
}

@keyframes spark {
	0% { transform: rotate(var(--a)) translateY(0) scale(0.4); opacity: 1; }
	60% { opacity: 1; }
	100% { transform: rotate(var(--a)) translateY(-46px) scale(1.2) rotate(180deg); opacity: 0; }
}

@keyframes twinkle {
	0%, 70%, 100% { transform: scale(0) rotate(0deg); opacity: 0; }
	80% { transform: scale(1) rotate(45deg); opacity: 1; }
	90% { transform: scale(0.3) rotate(90deg); opacity: 0.6; }
}
</style>
