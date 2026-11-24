using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

// Ferramentas para separar a marca do CaxHub do fundo da imagem original e montar as variantes
// (Ã­cone do app, favicon, logo completo, imagens do instalador). SÃ³ System.Drawing: sem instalar nada.
public static partial class Marca
{
    public class Raster
    {
        public int W, H;
        public byte[] Px; // BGRA, 4 bytes por pixel
        public Raster(int w, int h) { W = w; H = h; Px = new byte[w * h * 4]; }
    }

    public class Peca
    {
        public int Id, Esq, Topo, Dir, Base, Area;
        public override string ToString() { return string.Format("#{0,-4} x {1,4}-{2,4}  y {3,4}-{4,4}  Ã¡rea {5}", Id, Esq, Dir, Topo, Base, Area); }
    }

    public static Raster Carregar(string caminho)
    {
        using (var bmp = new Bitmap(caminho))
        {
            var r = new Raster(bmp.Width, bmp.Height);
            var d = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            Marshal.Copy(d.Scan0, r.Px, 0, r.Px.Length);
            bmp.UnlockBits(d);
            return r;
        }
    }

    public static Bitmap ParaBitmap(Raster r)
    {
        var bmp = new Bitmap(r.W, r.H, PixelFormat.Format32bppArgb);
        var d = bmp.LockBits(new Rectangle(0, 0, r.W, r.H), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(r.Px, 0, d.Scan0, r.Px.Length);
        bmp.UnlockBits(d);
        return bmp;
    }

    public static Raster DeBitmap(Bitmap bmp)
    {
        var r = new Raster(bmp.Width, bmp.Height);
        var d = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(d.Scan0, r.Px, 0, r.Px.Length);
        bmp.UnlockBits(d);
        return r;
    }

    // "Tinta" = pixel claramente da marca: saturado (azul/ciano) ou escuro (azul-marinho).
    // O fundo (nÃ©voa, espuma, cachoeira desbotada) Ã© claro e quase sem saturaÃ§Ã£o.
    public static bool[] Tinta(Raster r, int sat, int escuro)
    {
        var t = new bool[r.W * r.H];
        for (int i = 0; i < t.Length; i++)
        {
            int b = r.Px[i * 4], g = r.Px[i * 4 + 1], rr = r.Px[i * 4 + 2];
            int mx = Math.Max(rr, Math.Max(g, b)), mn = Math.Min(rr, Math.Min(g, b));
            t[i] = (mx - mn) >= sat || mx < escuro;
        }
        return t;
    }

    // Componentes conexos (8 vizinhos) da tinta. Devolve o mapa de rÃ³tulos e a lista de peÃ§as.
    public static int[] Rotular(bool[] tinta, int w, int h, int areaMin, out List<Peca> pecas)
    {
        var lab = new int[w * h];
        pecas = new List<Peca>();
        var pilha = new Stack<int>();
        int prox = 1;
        for (int i0 = 0; i0 < tinta.Length; i0++)
        {
            if (!tinta[i0] || lab[i0] != 0) continue;
            var p = new Peca { Id = prox, Esq = w, Topo = h, Dir = 0, Base = 0 };
            lab[i0] = prox; pilha.Push(i0);
            while (pilha.Count > 0)
            {
                int i = pilha.Pop(); int x = i % w, y = i / w;
                p.Area++;
                if (x < p.Esq) p.Esq = x; if (x > p.Dir) p.Dir = x;
                if (y < p.Topo) p.Topo = y; if (y > p.Base) p.Base = y;
                for (int dy = -1; dy <= 1; dy++)
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        int nx = x + dx, ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                        int j = ny * w + nx;
                        if (tinta[j] && lab[j] == 0) { lab[j] = prox; pilha.Push(j); }
                    }
            }
            prox++;
            if (p.Area >= areaMin) pecas.Add(p);
        }
        return lab;
    }

    public static Bitmap Redimensionar(Image src, int w, int h)
    {
        var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.Clear(Color.Transparent);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.DrawImage(src, new Rectangle(0, 0, w, h));
        }
        return bmp;
    }
}

