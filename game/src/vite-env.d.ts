/// <reference types="vite/client" />

declare module 'virtual:art-cache' {
	import type { ArtCacheManifest } from './render/artCache';
	const manifest:ArtCacheManifest;
	export default manifest;
}
