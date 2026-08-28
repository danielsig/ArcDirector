using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

/// <summary>
/// Builds tangent-space normal (_n) and metalness (_m) maps from albedo PNGs.
/// Alpha is copied 1:1 from the source so black outlines stay opaque.
/// </summary>
public static class BakeSpriteMaps {
	public static void BakeTree(string root) {
		foreach (string dir in Directory.GetDirectories(root)) {
			if (string.Equals(Path.GetFileName(dir), "old", StringComparison.OrdinalIgnoreCase)) {
				continue;
			}
			BakeTree(dir);
		}
		foreach (string path in Directory.GetFiles(root, "*.png")) {
			string name = Path.GetFileNameWithoutExtension(path);
			if (name.EndsWith("_n") || name.EndsWith("_m")) {
				continue;
			}
			if (!name.StartsWith("idle_") && !name.StartsWith("walk_") && !name.StartsWith("take_")) {
				continue;
			}
			BakeOne(path);
		}
	}

	public static void BakeMetalOnly(string albedoPath) {
		BakeOne(albedoPath, false);
	}

	public static void BakeOne(string albedoPath) {
		BakeOne(albedoPath, true);
	}

	public static void BakeOne(string albedoPath, bool writeNormal) {
		byte[] bytes = File.ReadAllBytes(albedoPath);
		using (var ms = new MemoryStream(bytes))
		using (var tmp = new Bitmap(ms))
		using (var src = new Bitmap(tmp.Width, tmp.Height, PixelFormat.Format32bppArgb)) {
			using (var g = Graphics.FromImage(src)) {
				g.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
				g.DrawImageUnscaled(tmp, 0, 0);
			}
			int w = src.Width, h = src.Height;
			var bd = src.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
			int[] px = new int[w * h];
			Marshal.Copy(bd.Scan0, px, 0, px.Length);
			src.UnlockBits(bd);

			int[] metal = new int[w * h];
			int[] nrm = new int[w * h];
			float[] height = new float[w * h];
			float[] dist = Distance(px, w, h);

			for (int i = 0; i < px.Length; i++) {
				int p = px[i];
				int a = (p >> 24) & 255;
				int r = (p >> 16) & 255;
				int gch = (p >> 8) & 255;
				int b = p & 255;
				int m = a < 16 ? 0 : Metal(r, gch, b, a, px, i, w, h);
				metal[i] = (a << 24) | (m << 16) | (m << 8) | m;
				float lum = (r + gch + b) / 765f;
				float volume = Math.Min(dist[i] / 5f, 1f);
				float ht = 0.38f * volume + 0.62f * lum;
				if (a > 16 && lum < 0.18f) {
					ht -= 0.12f;
				}
				if (a < 16) {
					ht = 0;
				}
				height[i] = ht;
			}

			const float strength = 3.2f;
			for (int y = 0; y < h; y++) {
				for (int x = 0; x < w; x++) {
					int i = y * w + x;
					int a = (px[i] >> 24) & 255;
					if (a < 16) {
						nrm[i] = (a << 24) | (128 << 16) | (128 << 8) | 255;
						continue;
					}
					float l = SampleH(height, px, w, h, x - 1, y);
					float rgt = SampleH(height, px, w, h, x + 1, y);
					float up = SampleH(height, px, w, h, x, y - 1);
					float dn = SampleH(height, px, w, h, x, y + 1);
					float nx = (l - rgt) * strength;
					float ny = (dn - up) * strength;
					float nz = 1f;
					float len = (float)Math.Sqrt(nx * nx + ny * ny + nz * nz);
					nx /= len; ny /= len; nz /= len;
					int nr = ClampByte(nx * 127.5f + 128f);
					int ng = ClampByte(ny * 127.5f + 128f);
					int nb = ClampByte(nz * 127.5f + 128f);
					nrm[i] = (a << 24) | (nr << 16) | (ng << 8) | nb;
				}
			}

			string stem = Path.Combine(Path.GetDirectoryName(albedoPath), Path.GetFileNameWithoutExtension(albedoPath));
			Save(stem + "_m.png", w, h, metal);
			if (writeNormal) {
				Save(stem + "_n.png", w, h, nrm);
				Console.WriteLine(Path.GetFileName(albedoPath) + " -> _n _m");
			}
			else {
				Console.WriteLine(Path.GetFileName(albedoPath) + " -> _m");
			}
		}
	}

	static float[] Distance(int[] px, int w, int h) {
		float inf = 1e6f;
		float[] d = new float[w * h];
		for (int i = 0; i < d.Length; i++) {
			d[i] = ((px[i] >> 24) & 255) < 16 ? 0 : inf;
		}
		for (int y = 0; y < h; y++) {
			for (int x = 0; x < w; x++) {
				int i = y * w + x;
				if (d[i] == 0) {
					continue;
				}
				if (x > 0) {
					d[i] = Math.Min(d[i], d[i - 1] + 1);
				}
				if (y > 0) {
					d[i] = Math.Min(d[i], d[i - w] + 1);
				}
			}
		}
		for (int y = h - 1; y >= 0; y--) {
			for (int x = w - 1; x >= 0; x--) {
				int i = y * w + x;
				if (d[i] == 0) {
					continue;
				}
				if (x + 1 < w) {
					d[i] = Math.Min(d[i], d[i + 1] + 1);
				}
				if (y + 1 < h) {
					d[i] = Math.Min(d[i], d[i + w] + 1);
				}
			}
		}
		return d;
	}

	static float SampleH(float[] height, int[] px, int w, int h, int x, int y) {
		if (x < 0 || y < 0 || x >= w || y >= h) {
			return 0;
		}
		int i = y * w + x;
		if (((px[i] >> 24) & 255) < 16) {
			return 0;
		}
		return height[i];
	}

	static int Metal(int r, int g, int b, int a, int[] px, int i, int w, int h) {
		int lum = r + g + b;
		int mx = Math.Max(r, Math.Max(g, b));
		int mn = Math.Min(r, Math.Min(g, b));
		int sat = mx - mn;
		if (IsEye(r, g, b, px, i, w, h)) {
			return 180;
		}
		if (r > 170 && g > 110 && b < 110 && (g - b) > 30 && (r - g) < 60 && lum > 470) {
			return 255;
		}
		if (lum > 570 && sat < 35) {
			if (b > r + 2) {
				return 230;
			}
			return 0;
		}
		if (sat < 48 && lum > 255 && lum < 560) {
			return 220;
		}
		bool brown = r > 45 && r >= g - 5 && g >= b - 10 && (r - b) > 15 && lum > 135 && lum < 480 && sat > 18;
		bool redCloth = r > g + 25 && r > b + 15 && g < 100;
		if (brown && !redCloth) {
			return 52;
		}
		return 0;
	}

	static bool IsEye(int r, int g, int b, int[] px, int i, int w, int h) {
		int lum = r + g + b;
		if (lum > 80 || Math.Max(r, Math.Max(g, b)) - Math.Min(r, Math.Min(g, b)) > 40) {
			return false;
		}
		int x = i % w;
		int y = i / w;
		for (int oy = -1; oy <= 1; oy++) {
			for (int ox = -1; ox <= 1; ox++) {
				if (ox == 0 && oy == 0) {
					continue;
				}
				int xx = x + ox, yy = y + oy;
				if (xx < 0 || yy < 0 || xx >= w || yy >= h) {
					continue;
				}
				int q = px[yy * w + xx];
				if (((q >> 24) & 255) < 40) {
					continue;
				}
				int qr = (q >> 16) & 255, qg = (q >> 8) & 255, qb = q & 255;
				if (qr > 140 && qg > 90 && qb > 55 && qr > qg + 8 && qg > qb) {
					return true;
				}
			}
		}
		return false;
	}

	static int ClampByte(float v) {
		int n = (int)Math.Round(v);
		if (n < 0) {
			return 0;
		}
		if (n > 255) {
			return 255;
		}
		return n;
	}

	static void Save(string path, int w, int h, int[] px) {
		using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
			var bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
			Marshal.Copy(px, 0, bd.Scan0, px.Length);
			bmp.UnlockBits(bd);
			bmp.Save(path, ImageFormat.Png);
		}
	}
}
