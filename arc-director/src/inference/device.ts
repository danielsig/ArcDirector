/**
 * How much memory this device's GPU has for a browser model. Browsers never tell, so it is estimated from the GPU's
 * name (WebGL's renderer string) and the system RAM (`navigator.deviceMemory`): a discrete card's own memory, half
 * the RAM for an integrated GPU (what Windows lends one), most of it for a Mac's unified memory. Unknown (Safari's
 * bare "Apple GPU", Firefox's blurred names) is null.
 */
export type GPUMemory = {
	/** Gigabytes a model and the game's rendering share. */
	gb:number;
	/** The GPU, as the browser names it. */
	gpu:string;
	/** It shares the system RAM: an integrated GPU, or a Mac's unified memory. */
	shared:boolean;
};

/**
 * Discrete cards, most specific first: a name to match, its memory in GB, and the laptop part's where it differs.
 * Where a card came in two sizes, the smaller.
 */
const CARDS:[RegExp, number, number?][] = [
	[/RTX 5090/, 32, 24], [/RTX 5080/, 16], [/RTX 5070 Ti/, 16, 12], [/RTX 5070/, 12, 8], [/RTX 50[56]0/, 8],
	[/RTX 4090/, 24, 16], [/RTX 4080/, 16, 12], [/RTX 4070 Ti/, 12], [/RTX 4070/, 12, 8], [/RTX 4060/, 8], [/RTX 4050/, 6],
	[/RTX 3090/, 24], [/RTX 3080 Ti/, 12, 16], [/RTX 3080/, 10, 8], [/RTX 3070/, 8], [/RTX 3060 Ti/, 8], [/RTX 3060/, 12, 6], [/RTX 3050/, 8, 4],
	[/RTX 2080 Ti/, 11], [/RTX 20[78]0/, 8], [/RTX 2060/, 6], [/GTX 1660/, 6], [/GTX 1650/, 4],
	[/GTX 1080 Ti/, 11], [/GTX 10[78]0/, 8], [/GTX 1060/, 3],
	[/RTX (A6000|6000 Ada)/, 48], [/RTX A5000/, 24], [/RTX 4000 Ada/, 20], [/RTX A4000/, 16],
	[/RX 9070/, 16], [/RX 9060/, 8],
	[/RX 7900 XTX/, 24], [/RX 7900 XT\b/, 20], [/RX 7900/, 16], [/RX 7800/, 16], [/RX 7700/, 12], [/RX 7600 XT/, 16], [/RX 7600/, 8],
	[/RX 6[89]\d0/, 16], [/RX 67\d0 XT/, 12], [/RX 67\d0/, 10], [/RX 66\d0/, 8], [/RX 65\d0/, 4],
	[/RX 5700/, 8], [/RX 5600/, 6], [/RX 5[789]0\b/, 4],
	[/Arc\S* B580/, 12], [/Arc\S* B570/, 10], [/Arc\S* A[57]\d0/, 8], [/Arc\S* A3\d0/, 6],
];

/** GPUs that share the system RAM: AMD's Radeon "Graphics" and "…M" parts, Intel's built-in ones, phone GPUs. */
const INTEGRATED = /Radeon\S*\s+(\d{3}M\s+)?Graphics|Radeon Vega|Intel.*(UHD|Iris|HD Graphics|Arc\S* Graphics)|Adreno|Mali|PowerVR/;

/** The least RAM an Apple chip ships with, for when the browser does not say: by tier, and base chips from the M4 on. */
const APPLE_RAM:Record<string, number> = { Pro: 16, Max: 32, Ultra: 64 };

function appleRAM(chip:string, tier:string | undefined):number {
	return tier ? APPLE_RAM[tier] : Number(chip.slice(1)) >= 4 ? 16 : 8;
}

/** macOS lends the GPU about this much of the unified memory. */
const APPLE_GPU_SHARE = 0.7;

/** The estimate for this device, or null when it cannot be told. */
export function gpuMemory():GPUMemory | null {
	const nav = (globalThis as { navigator?:{ deviceMemory?:number } }).navigator;
	return memoryOf(rendererName(), nav?.deviceMemory);
}

/** The estimate for GPU `name` (a WebGL renderer string) on a device with `ramGB` of system RAM, if known. */
export function memoryOf(name:string | undefined, ramGB?:number):GPUMemory | null {
	if (!name) {
		return null;
	}
	const apple = /Apple (M\d+)(?: (Pro|Max|Ultra))?/.exec(name);
	if (apple) {
		return { gb: Math.max(ramGB ?? 0, appleRAM(apple[1], apple[2])) * APPLE_GPU_SHARE, gpu: apple[0], shared: true };
	}
	const card = CARDS.find(([match]) => match.test(name));
	if (card) {
		const laptop = /Laptop|Mobile|Max-Q|\d{4}M\b|\d{4}S\b/.test(name);
		return { gb: laptop ? card[2] ?? card[1] : card[1], gpu: gpuName(name), shared: false };
	}
	if (INTEGRATED.test(name) && ramGB) {
		return { gb: ramGB / 2, gpu: gpuName(name), shared: true };
	}
	return null;
}

/**
 * The biggest of `models` that fits this device with `spareGB` left over for the game's rendering, or undefined when
 * none fits or the device cannot be told.
 */
export function fittingModel<T extends { memoryGB:number }>(models:readonly T[], memory:GPUMemory | null, spareGB = 1):T | undefined {
	if (!memory) {
		return undefined;
	}
	return models
		.filter((m) => m.memoryGB + spareGB <= memory.gb)
		.sort((a, b) => b.memoryGB - a.memoryGB)[0];
}

/** The GPU's name from an ANGLE renderer string: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x…) Direct3D11 …)". */
function gpuName(renderer:string):string {
	const inner = /^ANGLE \([^,]*, (.*?)(?: \(0x[\da-f]+\))?(?: Direct3D.*| OpenGL.*| Vulkan.*)?(?:, [^,]*\))?$/i.exec(renderer);
	return (inner?.[1] ?? renderer).trim();
}

/** WebGL's unmasked renderer string: the GPU's real name, where the browser gives it. */
function rendererName():string | undefined {
	type GL = { getExtension(name:string):{ UNMASKED_RENDERER_WEBGL:number } | null; getParameter(p:number):unknown };
	const doc = (globalThis as { document?:{ createElement(tag:'canvas'):{ getContext(type:'webgl'):GL | null } } }).document;
	const gl = doc?.createElement('canvas').getContext('webgl');
	const ext = gl?.getExtension('WEBGL_debug_renderer_info');
	const name = ext ? gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL) : undefined;
	return typeof name === 'string' ? name : undefined;
}
