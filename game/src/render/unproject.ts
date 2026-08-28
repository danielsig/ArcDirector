export type Pt = { x:number; y:number };

export type PxQuad = {
	tl:Pt;
	tr:Pt;
	br:Pt;
	bl:Pt;
};

export type AtlasPixels = {
	data:Uint8ClampedArray;
	w:number;
	h:number;
};

export function rasterizeImage(img:HTMLImageElement):AtlasPixels {
	const canvas = document.createElement('canvas');
	canvas.width = img.naturalWidth;
	canvas.height = img.naturalHeight;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		throw new Error('2d context');
	}
	ctx.drawImage(img, 0, 0);
	const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	return { data: imgData.data, w: canvas.width, h: canvas.height };
}

export function lerpPt(a:Pt, b:Pt, t:number):Pt {
	return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function insetQuad(q:PxQuad, t:number):PxQuad {
	const c = {
		x: (q.tl.x + q.tr.x + q.br.x + q.bl.x) * 0.25,
		y: (q.tl.y + q.tr.y + q.br.y + q.bl.y) * 0.25,
	};
	const pull = (p:Pt):Pt => ({
		x: p.x + (c.x - p.x) * t,
		y: p.y + (c.y - p.y) * t,
	});
	return { tl: pull(q.tl), tr: pull(q.tr), br: pull(q.br), bl: pull(q.bl) };
}

export function sliceQuad(q:PxQuad, i:number, n:number):PxQuad {
	const t0 = i / n;
	const t1 = (i + 1) / n;
	return {
		tl: lerpPt(q.tl, q.tr, t0),
		tr: lerpPt(q.tl, q.tr, t1),
		br: lerpPt(q.bl, q.br, t1),
		bl: lerpPt(q.bl, q.br, t0),
	};
}

function solve8(A:number[][], b:number[]):number[] {
	const n = 8;
	const M = A.map((row, i) => [...row, b[i]]);
	for (let col = 0; col < n; col++) {
		let pivot = col;
		for (let r = col + 1; r < n; r++) {
			if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) {
				pivot = r;
			}
		}
		const tmp = M[col];
		M[col] = M[pivot];
		M[pivot] = tmp;
		const div = M[col][col];
		if (Math.abs(div) < 1e-12) {
			continue;
		}
		for (let c = col; c <= n; c++) {
			M[col][c] /= div;
		}
		for (let r = 0; r < n; r++) {
			if (r === col) {
				continue;
			}
			const f = M[r][col];
			for (let c = col; c <= n; c++) {
				M[r][c] -= f * M[col][c];
			}
		}
	}
	return M.map((row) => row[n]);
}

/** Homography mapping unit-square (u,v) onto the atlas quad. */
function unitToQuad(q:PxQuad):number[] {
	const src:Pt[] = [
		{ x: 0, y: 0 },
		{ x: 1, y: 0 },
		{ x: 1, y: 1 },
		{ x: 0, y: 1 },
	];
	const dst:Pt[] = [q.tl, q.tr, q.br, q.bl];
	const A:number[][] = [];
	const b:number[] = [];
	for (let i = 0; i < 4; i++) {
		const x = src[i].x;
		const y = src[i].y;
		const u = dst[i].x;
		const v = dst[i].y;
		A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
		b.push(u);
		A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
		b.push(v);
	}
	return solve8(A, b);
}

function applyH(h:number[], x:number, y:number):Pt {
	const w = h[6] * x + h[7] * y + 1;
	return {
		x: (h[0] * x + h[1] * y + h[2]) / w,
		y: (h[3] * x + h[4] * y + h[5]) / w,
	};
}

function sampleBilinear(px:AtlasPixels, x:number, y:number, out:Uint8ClampedArray, di:number):void {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const x1 = x0 + 1;
	const y1 = y0 + 1;
	const tx = x - x0;
	const ty = y - y0;
	const w = px.w;
	const h = px.h;
	const data = px.data;
	const at = (ix:number, iy:number, c:number):number => {
		const xx = ix < 0 ? 0 : ix >= w ? w - 1 : ix;
		const yy = iy < 0 ? 0 : iy >= h ? h - 1 : iy;
		return data[(yy * w + xx) * 4 + c];
	};
	for (let c = 0; c < 4; c++) {
		const v00 = at(x0, y0, c);
		const v10 = at(x1, y0, c);
		const v01 = at(x0, y1, c);
		const v11 = at(x1, y1, c);
		out[di + c] = (v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty + 0.5) | 0;
	}
}

export function warpQuad(
	px:AtlasPixels,
	quad:PxQuad,
	outW:number,
	outH:number,
	logicalW:number,
	logicalH:number,
):HTMLCanvasElement {
	const sx = px.w / logicalW;
	const sy = px.h / logicalH;
	const scaled:PxQuad = {
		tl: { x: quad.tl.x * sx, y: quad.tl.y * sy },
		tr: { x: quad.tr.x * sx, y: quad.tr.y * sy },
		br: { x: quad.br.x * sx, y: quad.br.y * sy },
		bl: { x: quad.bl.x * sx, y: quad.bl.y * sy },
	};
	const h = unitToQuad(scaled);
	const canvas = document.createElement('canvas');
	canvas.width = outW;
	canvas.height = outH;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('2d context');
	}
	const img = ctx.createImageData(outW, outH);
	const d = img.data;
	const denomU = Math.max(1, outW - 1);
	const denomV = Math.max(1, outH - 1);
	for (let y = 0; y < outH; y++) {
		const v = y / denomV;
		for (let x = 0; x < outW; x++) {
			const u = x / denomU;
			const p = applyH(h, u, v);
			sampleBilinear(px, p.x, p.y, d, (y * outW + x) * 4);
		}
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}
