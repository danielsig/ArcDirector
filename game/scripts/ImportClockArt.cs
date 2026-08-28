using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

/// <summary>
/// Import generated idle inbetweens and take-strip cells onto the existing
/// character canvas size, then bake _n/_m. Never resizes sibling frames.
/// </summary>
public static class ImportClockArt {
	const int Hard = 40;
	const int TargetH = 128;

	public static void ImportAlbedo(string src, string dest, int canvasW, int canvasH) {
		using (Bitmap file = OpenUnlocked(src))
		using (Bitmap cut = Extract(file)) {
			SavePadded(cut, dest, canvasW, canvasH);
			Console.WriteLine("wrote " + dest + " " + canvasW + "x" + canvasH);
		}
	}

	public static void SliceStrip(string src, string destDir, string stem, int frames, int canvasW, int canvasH) {
		Directory.CreateDirectory(destDir);
		using (Bitmap file = OpenUnlocked(src))
		using (Bitmap cut = Extract(file)) {
			int[] ranges = FindFrameRanges(cut, frames);
			if (ranges != null) {
				for (int i = 0; i < frames; i++) {
					int x0 = ranges[i * 2];
					int x1 = ranges[i * 2 + 1];
					WriteCell(cut, destDir, stem, i, x0, x1 - x0 + 1, canvasW, canvasH);
				}
				return;
			}
			int fw = Math.Max(1, cut.Width / frames);
			for (int i = 0; i < frames; i++) {
				int x0 = i * fw;
				int cw = i == frames - 1 ? cut.Width - x0 : fw;
				WriteCell(cut, destDir, stem, i, x0, cw, canvasW, canvasH);
			}
		}
	}

	static void WriteCell(Bitmap cut, string destDir, string stem, int i, int x0, int cw, int canvasW, int canvasH) {
		using (Bitmap cell = cut.Clone(new Rectangle(x0, 0, cw, cut.Height), PixelFormat.Format32bppArgb)) {
			string dest = Path.Combine(destDir, stem + "_" + i + ".png");
			SavePadded(cell, dest, canvasW, canvasH);
			Console.WriteLine("sliced " + dest + " x=" + x0 + " w=" + cw);
		}
	}

	/// <summary>
	/// Split a strip on empty columns when there are exactly `frames` opaque runs.
	/// Wide gutters keep swords / arms from bleeding into the neighbor cell.
	/// </summary>
	static int[] FindFrameRanges(Bitmap cut, int frames) {
		int w = cut.Width, h = cut.Height;
		BitmapData data = cut.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
		int[] px = new int[w * h];
		Marshal.Copy(data.Scan0, px, 0, px.Length);
		cut.UnlockBits(data);

		bool[] col = new bool[w];
		for (int x = 0; x < w; x++) {
			for (int y = 0; y < h; y++) {
				if (((px[y * w + x] >> 24) & 255) >= 16) {
					col[x] = true;
					break;
				}
			}
		}

		var runs = new System.Collections.Generic.List<int>();
		int start = -1;
		for (int x = 0; x < w; x++) {
			if (col[x]) {
				if (start < 0) start = x;
			}
			else if (start >= 0) {
				runs.Add(start);
				runs.Add(x - 1);
				start = -1;
			}
		}
		if (start >= 0) {
			runs.Add(start);
			runs.Add(w - 1);
		}
		if (runs.Count != frames * 2) {
			Console.WriteLine("strip runs=" + (runs.Count / 2) + " expected=" + frames + " (equal-width fallback)");
			return null;
		}
		return runs.ToArray();
	}

	static void SavePadded(Bitmap src, string dest, int canvasW, int canvasH) {
		int dw, dh;
		if (src.Height <= 0) {
			throw new Exception("empty sprite " + dest);
		}
		dh = Math.Min(canvasH, TargetH);
		dw = Math.Max(1, (int)Math.Round((double)src.Width * dh / src.Height));
		if (dw > canvasW) {
			dw = canvasW;
			dh = Math.Max(1, (int)Math.Round((double)src.Height * dw / src.Width));
		}
		using (Bitmap scaled = new Bitmap(dw, dh, PixelFormat.Format32bppArgb))
		using (Bitmap canvas = new Bitmap(canvasW, canvasH, PixelFormat.Format32bppArgb)) {
			using (Graphics g = Graphics.FromImage(scaled)) {
				g.InterpolationMode = InterpolationMode.NearestNeighbor;
				g.PixelOffsetMode = PixelOffsetMode.Half;
				g.CompositingMode = CompositingMode.SourceCopy;
				g.Clear(Color.Transparent);
				g.DrawImage(src, new Rectangle(0, 0, dw, dh), new Rectangle(0, 0, src.Width, src.Height), GraphicsUnit.Pixel);
			}
			using (Graphics g = Graphics.FromImage(canvas)) {
				g.CompositingMode = CompositingMode.SourceCopy;
				g.Clear(Color.Transparent);
				int x = (canvasW - dw) / 2;
				int y = canvasH - dh;
				g.DrawImageUnscaled(scaled, x, y);
			}
			Directory.CreateDirectory(Path.GetDirectoryName(dest));
			canvas.Save(dest, ImageFormat.Png);
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

	static void TryKey(int[] px, bool[] bg, System.Collections.Generic.Queue<int> q, int i, int kr, int kg, int kb) {
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

	static Bitmap Extract(Bitmap src) {
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
			var q = new System.Collections.Generic.Queue<int>();
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

		for (int i = 0; i < px.Length; i++) {
			if (bg[i]) continue;
			int r = (px[i] >> 16) & 255;
			int g = (px[i] >> 8) & 255;
			int b = px[i] & 255;
			if (g > 30 && g > r + 16 && g > b + 16) bg[i] = true;
		}

		int minx = w, miny = h, maxx = -1, maxy = -1;
		for (int i = 0; i < px.Length; i++) {
			if (bg[i]) continue;
			int x = i % w, y = i / w;
			if (x < minx) minx = x;
			if (y < miny) miny = y;
			if (x > maxx) maxx = x;
			if (y > maxy) maxy = y;
		}
		if (maxx < minx) throw new Exception("no sprite pixels");

		int pad = 6;
		int x0 = Math.Max(0, minx - pad);
		int y0 = Math.Max(0, miny - pad);
		int x1 = Math.Min(w - 1, maxx + pad);
		int y1 = Math.Min(h - 1, maxy + pad);
		int cw = x1 - x0 + 1;
		int ch = y1 - y0 + 1;
		Bitmap crop = new Bitmap(cw, ch, PixelFormat.Format32bppArgb);
		BitmapData cd = crop.LockBits(new Rectangle(0, 0, cw, ch), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
		int[] outPx = new int[cw * ch];
		for (int y = 0; y < ch; y++) {
			for (int x = 0; x < cw; x++) {
				int si = (y0 + y) * w + (x0 + x);
				if (!bg[si]) {
					outPx[y * cw + x] = px[si];
				}
			}
		}
		Marshal.Copy(outPx, 0, cd.Scan0, outPx.Length);
		crop.UnlockBits(cd);
		return crop;
	}
}
