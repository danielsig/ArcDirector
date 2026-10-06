<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref } from 'vue';
import { Game } from '../engine/Game';
import type { HudModel } from './hudModel';
import { sessionKey } from './sessionKey';
import { preloadArt } from '../render/preloadArt';

const props = defineProps<{
	hud:HudModel;
	sceneID:string;
}>();

const session = inject(sessionKey);
const host = ref<HTMLElement | null>(null);
const booted = ref(false);
let game:Game | null = null;
let dead = false;

onMounted(() => {
	void boot();
});

onUnmounted(() => {
	dead = true;
	if (session) {
		session.value = null;
	}
	game?.dispose();
	game = null;
});

async function boot():Promise<void> {
	try {
		await preloadArt();
	}
	catch (err) {
		console.error(err);
	}
	if (dead) {
		return;
	}
	const el = host.value;
	if (!el) {
		return;
	}
	game = new Game(props.hud, props.sceneID);
	if (session) {
		session.value = game.session;
	}
	game.mount(el);
	game.start();
	booted.value = true;
}
</script>

<template>
	<div ref="host" class="kindling-host" :class="{ booting: !booted }">
		<div v-if="!booted" class="boot">Loading…</div>
	</div>
</template>

<style scoped>
.kindling-host {
	position: absolute;
	inset: 0;
}

/* Above the HUD (z-index 5) so hearts and other chrome stay hidden until the scene is up. */
.kindling-host.booting {
	z-index: 6;
}

.kindling-host :deep(canvas) {
	position: absolute;
	inset: 0;
	display: block;
	width: 100%;
	height: 100%;
	cursor: pointer;
	outline: none;
}

.boot {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: #0e1410;
	color: #e8dfc8;
	font-family: ui-monospace, "Cascadia Code", monospace;
	z-index: 1;
}
</style>
