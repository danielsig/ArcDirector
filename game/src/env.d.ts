/// <reference types="vite/client" />

declare module '*.vue' {
	import type { DefineComponent } from 'vue';
	const component:DefineComponent<object, object, unknown>;
	export default component;
}

/** Which hosted services have a key on the dev server (`vite.config.ts`, read through `director/hosted.ts`). */
declare const __HOSTED__:{ jev:boolean; xai:boolean };
