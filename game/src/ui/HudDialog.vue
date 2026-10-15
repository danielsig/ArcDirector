<script setup lang="ts">
/**
 * Every HUD dialog: a parchment panel over a dim backdrop, a title, one outlined button that closes it, and the
 * content in the default slot (a `title` slot for more than text). Clicking the backdrop closes it too. It rises
 * into place, or, given `from`, flies out of that element and back into it.
 */
const props = withDefaults(defineProps<{
	open:boolean;
	title:string;
	/** Panel width in pixels, before it narrows to the screen. */
	width?:number;
	closeLabel?:string;
	from?:HTMLElement | null;
}>(), {
	width: 640,
	closeLabel: 'Close',
	from: null,
});

const emit = defineEmits<{ close:[] }>();

function animate(el:Element, done:()=>void, open:boolean):void {
	const panel = el.querySelector('.panel') as HTMLElement;
	el.getAnimations().forEach((a) => a.cancel());
	panel.getAnimations().forEach((a) => a.cancel());
	let start = 'translateY(12px) scale(0.97)';
	if (props.from) {
		const btn = props.from.getBoundingClientRect();
		const box = panel.getBoundingClientRect();
		const dx = btn.left + btn.width / 2 - box.left - box.width / 2;
		const dy = btn.top + btn.height / 2 - box.top - box.height / 2;
		start = `translate(${dx}px, ${dy}px) scale(0.05)`;
	}
	const opts:KeyframeAnimationOptions = {
		duration: 220,
		easing: 'cubic-bezier(.2,.8,.2,1)',
		fill: 'both',
		direction: open ? 'normal' : 'reverse',
	};
	el.animate([{ opacity: 0 }, { opacity: 1 }], opts);
	panel.animate([{ transform: start }, { transform: 'none' }], opts).finished.then(() => done(), () => undefined);
}
</script>

<template>
	<Transition :css="false" appear @enter="(el, done) => animate(el, done, true)" @leave="(el, done) => animate(el, done, false)">
		<div v-if="open" class="dim" @click.stop="emit('close')">
			<section
				class="panel"
				role="dialog"
				:aria-label="title"
				:style="{ width: `min(${width}px, 92vw)` }"
				@click.stop
			>
				<header class="head">
					<h2><slot name="title">{{ title }}</slot></h2>
					<button type="button" class="close" @click.stop="emit('close')">{{ closeLabel }}</button>
				</header>
				<div class="body">
					<slot />
				</div>
			</section>
		</div>
	</Transition>
</template>

<style scoped>
/* The pause menu's panel and its Resume button (HudMenu), for every dialog that is not the menu. */
.dim {
	position: absolute;
	inset: 0;
	z-index: 4;
	pointer-events: auto;
	cursor: default;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--backdrop);
}

.panel {
	max-height: min(720px, 86vh);
	display: flex;
	flex-direction: column;
	color: var(--ink);
	font-family: var(--font);
	background: var(--parchment);
	border: var(--line) solid var(--ink);
	border-radius: var(--radius-panel);
	box-shadow: var(--shadow-panel);
}

.head {
	flex: 0 0 auto;
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

.close {
	flex: 0 0 auto;
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

.close:hover {
	background: var(--parchment-deep);
}

.close:focus-visible {
	outline: var(--line-thin) solid var(--gold-deep);
	outline-offset: 2px;
}

.body {
	flex: 1 1 auto;
	min-height: 0;
	overflow: auto;
	padding: 14px 28px 24px;
}
</style>
