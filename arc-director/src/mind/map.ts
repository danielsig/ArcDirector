/** Host-drawn top-down maps for the `see_map` tool. */

import { isRecord } from '../json.js';

/** 0 = whole loaded land, 1 = close around you. */
export function clampMapZoom(zoom:number):number {
	if (!Number.isFinite(zoom)) {
		return 1;
	}
	return Math.min(1, Math.max(0, zoom));
}

/** `see_map` args: `zoom` 0..1, or legacy `map` "near"|"world". */
export function parseMapZoom(args:unknown):number {
	if (!isRecord(args)) {
		return 1;
	}
	if (typeof args.zoom === 'number') {
		return clampMapZoom(args.zoom);
	}
	if (typeof args.zoom === 'string') {
		return clampMapZoom(Number(args.zoom));
	}
	if (args.map === 'world') {
		return 0;
	}
	if (args.map === 'near') {
		return 1;
	}
	return 1;
}

/** `id` is the character, thing or place marked; the legend shows the mind's own name for it. */
export type MapMark = {
	symbol:string;
	id:string;
	x:number;
	y:number;
};

export type MapSnapshot = {
	/** PNG or JPEG data URL. */
	image:string;
	width:number;
	height:number;
	toPixel:(x:number, y:number)=>{ u:number; v:number };
	marks:MapMark[];
	x?:number;
	y?:number;
};

/** Last picture. Return `{ image: prev.image }` to keep it. */
export type MapPrev = {
	image:string;
	zoom:number;
	timestamp:number;
	x?:number;
	y?:number;
};

export function isMapSnapshot(snap:MapSnapshot | { image:string }):snap is MapSnapshot {
	return 'marks' in snap && 'toPixel' in snap;
}

/** Default pictogram for the mind's own location on `see_map`. */
export const DEFAULT_YOU_SYMBOL = '❌';

export type MapSense = {
	snapshot:(
		npcID:string,
		zoom:number,
		prev?:MapPrev,
	)=>MapSnapshot | { image:string } | Promise<MapSnapshot | { image:string } | null> | null;
	/**
	 * Pictogram for the mind's own location. Must match the mark the host
	 * stamps. Standing prompts use this so the legend and the hint agree.
	 * Defaults to `DEFAULT_YOU_SYMBOL`.
	 */
	you?:string;
};

/** `symbol = name` pairs, comma-separated. No numbers. */
export function formatLegend(marks:MapMark[], name:(id:string)=>string = (id) => id):string {
	return marks.map((m) => `${m.symbol} = ${name(m.id)}`).join(', ');
}

export type StampedMap = {
	image:string;
	legend:string;
};

/**
 * Stamp host symbols onto the snapshot. Node and other canvas-less
 * runtimes return the source image plus a legend — tests still cover gating.
 */
export async function stampMap(snap:MapSnapshot, name?:(id:string)=>string):Promise<StampedMap> {
	const legend = formatLegend(snap.marks, name);
	const ctx = makeStampContext(snap.width, snap.height);
	if (!ctx) {
		return { image: snap.image, legend };
	}
	const bitmap = await decodeBitmap(snap.image);
	if (!bitmap) {
		return { image: snap.image, legend };
	}
	ctx.drawImage(bitmap, 0, 0, snap.width, snap.height);
	for (const mark of snap.marks) {
		const { u, v } = snap.toPixel(mark.x, mark.y);
		if (u < 0 || v < 0 || u > snap.width || v > snap.height) {
			continue;
		}
		drawMark(ctx, u, v, mark.symbol);
	}
	const image = await canvasPng(ctx);
	return { image: image ?? snap.image, legend };
}

type StampCtx = {
	canvas:unknown;
	fillStyle:string;
	font:string;
	textAlign:string;
	textBaseline:string;
	drawImage:(img:unknown, x:number, y:number, w:number, h:number)=>void;
	beginPath:()=>void;
	arc:(x:number, y:number, r:number, a0:number, a1:number)=>void;
	fill:()=>void;
	fillText:(text:string, x:number, y:number)=>void;
};

function makeStampContext(width:number, height:number):StampCtx | null {
	const g = globalThis as Record<string, unknown>;
	const Offscreen = g.OffscreenCanvas;
	if (typeof Offscreen === 'function') {
		const Ctor = Offscreen as new (w:number, h:number)=>{ getContext:(k:string)=>StampCtx | null };
		return new Ctor(width, height).getContext('2d');
	}
	const doc = g.document as { createElement?:(t:string)=>{ width:number; height:number; getContext:(k:string)=>StampCtx | null } } | undefined;
	if (typeof doc?.createElement !== 'function') {
		return null;
	}
	const canvas = doc.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas.getContext('2d');
}

async function decodeBitmap(src:string):Promise<unknown | null> {
	const create = (globalThis as { createImageBitmap?:(blob:Blob)=>Promise<unknown> }).createImageBitmap;
	if (typeof create !== 'function') {
		return null;
	}
	const blob = dataURLToBlob(src);
	if (!blob) {
		return null;
	}
	try {
		return await create(blob);
	}
	catch {
		return null;
	}
}

async function canvasPng(ctx:StampCtx):Promise<string | null> {
	const canvas = ctx.canvas as {
		toDataURL?:(type:string)=>string;
		convertToBlob?:(opts:{ type:string })=>Promise<Blob>;
	};
	if (typeof canvas.toDataURL === 'function') {
		return canvas.toDataURL('image/png');
	}
	if (typeof canvas.convertToBlob === 'function') {
		const blob = await canvas.convertToBlob({ type: 'image/png' });
		return blobToDataURL(blob);
	}
	return null;
}

function drawMark(ctx:StampCtx, u:number, v:number, symbol:string):void {
	ctx.fillStyle = '#1a1208';
	ctx.beginPath();
	ctx.arc(u, v, 11, 0, Math.PI * 2);
	ctx.fill();
	ctx.font = '16px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(symbol, u, v + 1);
}

function dataURLToBlob(url:string):Blob | null {
	const hit = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(url);
	if (!hit) {
		return null;
	}
	try {
		const bin = atob(hit[2]);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) {
			bytes[i] = bin.charCodeAt(i);
		}
		return new Blob([bytes], { type: hit[1] || 'image/png' });
	}
	catch {
		return null;
	}
}

async function blobToDataURL(blob:Blob):Promise<string> {
	const buf = await blob.arrayBuffer();
	const bytes = new Uint8Array(buf);
	let bin = '';
	for (const b of bytes) {
		bin += String.fromCharCode(b);
	}
	return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}
