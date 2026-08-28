<script setup lang="ts">
import { reactive, ref, shallowRef, provide } from 'vue';
import KindlingView from './ui/KindlingView.vue';
import HudPickup from './ui/HudPickup.vue';
import HudLayer from './ui/HudLayer.vue';
import CursorLayer from './ui/CursorLayer.vue';
import { emptyHud } from './ui/hudModel';
import { sessionKey } from './ui/sessionKey';
import type { Session } from './engine/Session';
import { SCENES } from './data/scenes';
import { clearUrlView } from './engine/urlView';
import { preloadArt } from './render/preloadArt';

preloadArt();

const params = new URLSearchParams(window.location.search);
const fromUrl = params.get('scene');
const hud = reactive(emptyHud());
const session = shallowRef<Session | null>(null);
provide(sessionKey, session);
const sceneID = ref<string | null>(
	fromUrl && SCENES[fromUrl] ? fromUrl : null,
);

function pick(id:string):void {
	sceneID.value = id;
	const url = new URL(window.location.href);
	url.searchParams.set('scene', id);
	window.history.replaceState({}, '', url);
}

function leave():void {
	hud.menuOpen = false;
	hud.menuNotice = '';
	hud.sayOpen = false;
	hud.chatOpen = false;
	hud.aiLogOpen = false;
	sceneID.value = null;
	const url = new URL(window.location.href);
	url.searchParams.delete('scene');
	window.history.replaceState({}, '', url);
	clearUrlView();
}
</script>

<template>
	<div v-if="!sceneID" class="picker">
		<img class="brand" src="/logo.png" alt="Arc Director" />
		<h1>Scenes</h1>
		<p>Three places. Abbey vault, river glen, and a street flea market.</p>
		<button type="button" @click="pick('marketplace')">Marketplace</button>
		<button type="button" @click="pick('glen')">River Glen</button>
		<button type="button" @click="pick('abbey_vault')">Abbey Vault</button>
	</div>
	<template v-else>
		<KindlingView :hud="hud" :scene-id="sceneID" />
		<HudPickup :hud="hud" />
		<HudLayer :hud="hud" @scenes="leave" />
		<CursorLayer />
	</template>
</template>

<style scoped>
.picker {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 12px;
	background: #0e1410;
	color: #e8dfc8;
	font-family: ui-monospace, "Cascadia Code", monospace;
}
.brand {
	width: min(280px, 70vw);
	height: auto;
	margin-bottom: 8px;
}
.picker h1 {
	margin: 0;
	font-size: 28px;
	letter-spacing: 0.08em;
}
.picker p {
	opacity: 0.75;
	margin: 0 0 8px;
}
.picker button {
	min-width: 220px;
	padding: 10px 18px;
	font: inherit;
	color: #1a1208;
	background: #d4c4a0;
	border: 0;
	cursor: pointer;
}
.picker button:hover {
	background: #f0e6c8;
}
</style>
