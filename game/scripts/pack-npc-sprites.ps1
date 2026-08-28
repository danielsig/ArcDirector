Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class NpcPack {
	// Chroma threshold vs top-left key. Maroon pants sit ~53 from dark-magenta #771440,
	// so a global key at 52 punched holes in them. 40 still swallows the grainy
	// magenta field (~11-17) and is irrelevant once gens use lime/cyan or real alpha.
	const int Hard = 40;
	const int TargetH = 128;

	public static void PackDir(string srcDir, string dstRoot) {
		PackDir(srcDir, dstRoot, null);
	}

	public static void PackDir(string srcDir, string dstRoot, string kindsCsv) {
		System.Collections.Generic.HashSet<string> allow = null;
		if (kindsCsv != null && kindsCsv.Length > 0) {
			allow = new System.Collections.Generic.HashSet<string>(kindsCsv.Split(','));
		}
		foreach (string path in Directory.GetFiles(srcDir, "npc_*.png")) {
			string name = Path.GetFileNameWithoutExtension(path);
			string[] parts = name.Split(new char[] { '_' }, 3);
			if (parts.Length < 3) continue;
			string kind = parts[1];
			string rest = parts[2];
			if (allow != null && !allow.Contains(kind)) continue;
			string outDir = Path.Combine(dstRoot, kind);
			Directory.CreateDirectory(outDir);
			using (Bitmap file = OpenUnlocked(path))
			using (Bitmap cut = Extract(file, kind)) {
				string dest = Path.Combine(outDir, rest + ".png");
				cut.Save(dest, ImageFormat.Png);
				Console.WriteLine(kind + "/" + rest + ".png " + cut.Width + "x" + cut.Height);
			}
		}
		if (allow == null) {
			PadKind(Path.Combine(dstRoot, "guard"));
			PadKind(Path.Combine(dstRoot, "robe"));
			PadKind(Path.Combine(dstRoot, "player"));
			PadKind(Path.Combine(dstRoot, "merchant"));
			PadKind(Path.Combine(dstRoot, "princess"));
			PadKind(Path.Combine(dstRoot, "sorceress"));
		}
		else {
			foreach (string kind in allow) {
				PadKind(Path.Combine(dstRoot, kind));
			}
		}
	}

	static void TryKey(int[] px, bool[] bg, Queue<int> q, int i, int kr, int kg, int kb) {
		if (bg[i]) return;
		int r = (px[i] >> 16) & 255;
		int g = (px[i] >> 8) & 255;
		int b = px[i] & 255;
		int dist = Math.Abs(r - kr) + Math.Abs(g - kg) + Math.Abs(b - kb);
		if (dist < Hard) {
			bg[i] = true;
			q.Enqueue(i);
		}
	}

	static Bitmap OpenUnlocked(string path) {
		byte[] bytes = File.ReadAllBytes(path);
		using (MemoryStream ms = new MemoryStream(bytes))
		using (Bitmap tmp = new Bitmap(ms)) {
			Bitmap copy = new Bitmap(tmp.Width, tmp.Height, PixelFormat.Format32bppArgb);
			using (Graphics g = Graphics.FromImage(copy)) {
				g.CompositingMode = CompositingMode.SourceCopy;
				g.DrawImageUnscaled(tmp, 0, 0);
			}
			return copy;
		}
	}

	static int Find(int[] parent, int x) {
		while (parent[x] != x) {
			parent[x] = parent[parent[x]];
			x = parent[x];
		}
		return x;
	}

	static Bitmap Extract(Bitmap src, string kind) {
		int w = src.Width, h = src.Height;
		BitmapData data = src.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
		int[] px = new int[w * h];
		Marshal.Copy(data.Scan0, px, 0, px.Length);
		src.UnlockBits(data);

		int kr = (px[0] >> 16) & 255;
		int kg = (px[0] >> 8) & 255;
		int kb = px[0] & 255;
		int a0 = (px[0] >> 24) & 255;
		int alphaBg = 0;
		for (int i = 0; i < px.Length; i++) {
			if (((px[i] >> 24) & 255) < 16) alphaBg++;
		}
		bool useAlpha = a0 < 16 || alphaBg > w * h / 20;

		bool[] bg = new bool[w * h];
		if (useAlpha) {
			for (int i = 0; i < px.Length; i++) {
				bg[i] = ((px[i] >> 24) & 255) < 16;
			}
		}
		else {
			Queue<int> q = new Queue<int>();
			for (int x = 0; x < w; x++) {
				TryKey(px, bg, q, x, kr, kg, kb);
				TryKey(px, bg, q, (h - 1) * w + x, kr, kg, kb);
			}
			for (int y = 0; y < h; y++) {
				TryKey(px, bg, q, y * w, kr, kg, kb);
				TryKey(px, bg, q, y * w + (w - 1), kr, kg, kb);
			}
			while (q.Count > 0) {
				int i = q.Dequeue();
				int x = i % w, y = i / w;
				if (x > 0) TryKey(px, bg, q, i - 1, kr, kg, kb);
				if (x < w - 1) TryKey(px, bg, q, i + 1, kr, kg, kb);
				if (y > 0) TryKey(px, bg, q, i - w, kr, kg, kb);
				if (y < h - 1) TryKey(px, bg, q, i + w, kr, kg, kb);
			}
		}

		// Leftover lime #00FF00, including dark mixed edge pixels (dist often > Hard).
		// Safe vs maroon, skin, mail, brown: those never have G clearly above both R and B.
		for (int i = 0; i < px.Length; i++) {
			if (bg[i]) continue;
			int r = (px[i] >> 16) & 255;
			int g = (px[i] >> 8) & 255;
			int b = px[i] & 255;
			if (g > 30 && g > r + 16 && g > b + 16) bg[i] = true;
		}

		bool[] fg = new bool[w * h];
		for (int i = 0; i < px.Length; i++) fg[i] = !bg[i];

		int[] label = new int[w * h];
		int[] parent = new int[w * h + 1];
		int nlab = 0;
		for (int y = 0; y < h; y++) {
			for (int x = 0; x < w; x++) {
				int i = y * w + x;
				if (!fg[i]) continue;
				int left = (x > 0 && fg[i - 1]) ? label[i - 1] : 0;
				int up = (y > 0 && fg[i - w]) ? label[i - w] : 0;
				if (left == 0 && up == 0) {
					nlab++;
					parent[nlab] = nlab;
					label[i] = nlab;
				}
				else if (left != 0 && up == 0) {
					label[i] = left;
				}
				else if (up != 0 && left == 0) {
					label[i] = up;
				}
				else {
					label[i] = left;
					int a = Find(parent, left);
					int b = Find(parent, up);
					if (a != b) parent[b] = a;
				}
			}
		}

		int[] area = new int[nlab + 1];
		int[] minx = new int[nlab + 1];
		int[] miny = new int[nlab + 1];
		int[] maxx = new int[nlab + 1];
		int[] maxy = new int[nlab + 1];
		int[] score = new int[nlab + 1];
		for (int i = 0; i <= nlab; i++) {
			minx[i] = w;
			miny[i] = h;
			maxx[i] = -1;
			maxy[i] = -1;
		}
		for (int i = 0; i < px.Length; i++) {
			if (label[i] == 0) continue;
			int lab = Find(parent, label[i]);
			label[i] = lab;
			area[lab]++;
			int x = i % w;
			int y = i / w;
			if (x < minx[lab]) minx[lab] = x;
			if (y < miny[lab]) miny[lab] = y;
			if (x > maxx[lab]) maxx[lab] = x;
			if (y > maxy[lab]) maxy[lab] = y;
			int r = (px[i] >> 16) & 255;
			int g = (px[i] >> 8) & 255;
			int b = px[i] & 255;
			if (kind == "robe" || kind == "sorceress") {
				if (b > g + 12 && r > g) score[lab] += 3;
			}
			else if (kind == "player") {
				if (b > r + 8 && b > g) score[lab] += 3;
			}
			else if (kind == "merchant") {
				if (r > g + 10 && r > b) score[lab] += 3;
			}
			else if (kind == "princess") {
				int lum = r + g + b;
				if (b >= r - 8 && g > 140 && lum > 400) score[lab] += 3;
			}
			else {
				int mx = Math.Max(r, Math.Max(g, b));
				int mn = Math.Min(r, Math.Min(g, b));
				int sat = mx - mn;
				int lum = r + g + b;
				if (sat < 40 && lum > 180 && lum < 620) score[lab] += 2;
			}
		}

		int best = 0;
		int bestVal = -1;
		int cx = w / 2;
		int cy = h / 2;
		for (int lab = 1; lab <= nlab; lab++) {
			if (parent[lab] != lab || area[lab] < 400) continue;
			int bx = (minx[lab] + maxx[lab]) / 2;
			int by = (miny[lab] + maxy[lab]) / 2;
			int dist = Math.Abs(bx - cx) + Math.Abs(by - cy);
			int val = area[lab] * 4 + score[lab] - dist;
			if (val > bestVal) {
				bestVal = val;
				best = lab;
			}
		}
		if (best == 0) throw new Exception("no sprite in " + kind);

		int pad = 6;
		int x0 = Math.Max(0, minx[best] - pad);
		int y0 = Math.Max(0, miny[best] - pad);
		int x1 = Math.Min(w - 1, maxx[best] + pad);
		int y1 = Math.Min(h - 1, maxy[best] + pad);
		int cw = x1 - x0 + 1;
		int ch = y1 - y0 + 1;

		Bitmap crop = new Bitmap(cw, ch, PixelFormat.Format32bppArgb);
		BitmapData cd = crop.LockBits(new Rectangle(0, 0, cw, ch), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
		int[] outPx = new int[cw * ch];
		for (int y = 0; y < ch; y++) {
			for (int x = 0; x < cw; x++) {
				int si = (y0 + y) * w + (x0 + x);
				if (label[si] == best) {
					int p = px[si];
					int r = (p >> 16) & 255;
					int gch = (p >> 8) & 255;
					int b = p & 255;
					int a = (p >> 24) & 255;
					if (gch > r + 8 && gch > b + 8) {
						gch = Math.Max(r, b);
						p = (a << 24) | (r << 16) | (gch << 8) | b;
					}
					outPx[y * cw + x] = p;
				}
			}
		}
		Marshal.Copy(outPx, 0, cd.Scan0, outPx.Length);
		crop.UnlockBits(cd);

		int dw = Math.Max(1, (int)Math.Round((double)cw * TargetH / ch));
		int dh = TargetH;
		Bitmap scaled = new Bitmap(dw, dh, PixelFormat.Format32bppArgb);
		using (Graphics g = Graphics.FromImage(scaled)) {
			g.InterpolationMode = InterpolationMode.NearestNeighbor;
			g.PixelOffsetMode = PixelOffsetMode.Half;
			g.CompositingMode = CompositingMode.SourceCopy;
			g.Clear(Color.Transparent);
			g.DrawImage(crop, new Rectangle(0, 0, dw, dh), new Rectangle(0, 0, cw, ch), GraphicsUnit.Pixel);
		}
		crop.Dispose();
		return scaled;
	}

	static void PadKind(string dir) {
		if (!Directory.Exists(dir)) return;
		string[] files = Directory.GetFiles(dir, "*.png");
		int maxW = 1, maxH = 1;
		foreach (string f in files) {
			using (Bitmap b = OpenUnlocked(f)) {
				if (b.Width > maxW) maxW = b.Width;
				if (b.Height > maxH) maxH = b.Height;
			}
		}
		foreach (string f in files) {
			using (Bitmap b = OpenUnlocked(f)) {
				if (b.Width == maxW && b.Height == maxH) continue;
				Bitmap canvas = new Bitmap(maxW, maxH, PixelFormat.Format32bppArgb);
				using (Graphics g = Graphics.FromImage(canvas)) {
					g.CompositingMode = CompositingMode.SourceCopy;
					g.Clear(Color.Transparent);
					int x = (maxW - b.Width) / 2;
					int y = maxH - b.Height;
					g.DrawImageUnscaled(b, x, y);
				}
				canvas.Save(f, ImageFormat.Png);
				canvas.Dispose();
			}
		}
		Console.WriteLine("padded " + dir + " to " + maxW + "x" + maxH);
	}
}
'@

$gameRoot = Join-Path $PSScriptRoot ".."
$src = if ($env:NPC_PACK_SRC) { $env:NPC_PACK_SRC } else { Join-Path $gameRoot "assets\guard_stage" }
$dst = if ($env:NPC_PACK_DST) { $env:NPC_PACK_DST } else { Join-Path $gameRoot "public\characters" }
$kinds = if ($env:NPC_PACK_KINDS) { $env:NPC_PACK_KINDS } else { "guard" }
# Only overwrite kinds present in this run; never delete sibling character folders.
[NpcPack]::PackDir($src, $dst, $kinds)
