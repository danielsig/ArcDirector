<script setup lang="ts">
import type { HudModel } from './hudModel';

defineProps<{
	hud:HudModel;
}>();
</script>

<template>
	<Transition name="inspect">
		<aside
			v-if="hud.inspect"
			class="hud-inspect"
			:class="hud.inspect.side"
			:style="{ left: `${hud.inspect.x}px`, top: `${hud.inspect.y}px` }"
			:aria-label="`About ${hud.inspect.name}`"
		>
			<header>
				<strong>{{ hud.inspect.name }}</strong>
				<span v-if="hud.inspect.role" class="role">{{ hud.inspect.role }}</span>
			</header>
			<p v-if="hud.inspect.traits.length" class="traits">
				<span v-for="trait in hud.inspect.traits" :key="trait">{{ trait }}</span>
			</p>
			<section v-if="hud.inspect.goal">
				<h3>Wants</h3>
				<p class="goal">{{ hud.inspect.goal }}</p>
			</section>
			<section>
				<h3>Carries</h3>
				<ul v-if="hud.inspect.gold || hud.inspect.items.length">
					<li v-if="hud.inspect.gold" class="gold">{{ hud.inspect.gold }} gold</li>
					<li v-for="item in hud.inspect.items" :key="item.name">
						{{ item.name }}<span v-if="item.count > 1" class="count">×{{ item.count }}</span>
					</li>
				</ul>
				<p v-else class="none">Nothing</p>
			</section>
		</aside>
	</Transition>
</template>

<style scoped>
/* A parchment card beside the character (`SceneDef.inspect`), vertically centred on them, on the side away from the middle. */
.hud-inspect {
	position: absolute;
	width: max-content;
	max-width: 230px;
	padding: 8px 10px;
	transform: translateY(-50%);
	font: 12px/1.35 var(--font);
	color: var(--ink);
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	border-radius: var(--radius-small);
	box-shadow: var(--shadow);
	pointer-events: none;
}

.hud-inspect.left {
	transform: translate(-100%, -50%);
}

header {
	display: flex;
	align-items: baseline;
	gap: 6px;
}

strong {
	font-size: 14px;
}

.role {
	opacity: 0.7;
}

.traits {
	display: flex;
	flex-wrap: wrap;
	gap: 3px;
	margin: 5px 0 0;
}

.traits span {
	padding: 0 6px;
	background: var(--parchment-deep);
	border-radius: 8px;
}

section {
	margin-top: 6px;
	padding-top: 5px;
	border-top: 1px solid var(--ink-soft);
}

h3 {
	margin: 0 0 2px;
	font-size: 10px;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	opacity: 0.65;
}

.goal,
.none {
	margin: 0;
}

.none {
	opacity: 0.6;
}

ul {
	margin: 0;
	padding: 0;
	list-style: none;
}

.gold {
	color: var(--gold-deep);
	font-weight: 700;
}

.count {
	margin-left: 3px;
	opacity: 0.7;
}

.inspect-enter-active,
.inspect-leave-active {
	transition: opacity var(--quick);
}

.inspect-enter-from,
.inspect-leave-to {
	opacity: 0;
}
</style>
