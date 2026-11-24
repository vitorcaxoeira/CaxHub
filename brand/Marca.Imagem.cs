using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static partial class Marca
{
    // Fica só com as peças escolhidas e joga fora o fundo. Pixels de tinta das peças escolhidas ficam
    // opacos; num anel de `raio` px em volta deles (a borda suavizada) a opacidade vem de "quanto
    // esse pixel é mais escuro que branco", e a cor é recalculada como se estivesse sobre branco —
    // assim a borda não fica com franja clara quando a marca for posta sobre fundo escuro.
    public static Raster Extrair(Raster src, bool[] tinta, int[] lab, HashSet<int> escolhidas, int raio, double corte)
    {
        int w = src.W, h = src.H;
        var sel = new bool[w * h];
        for (int i = 0; i < sel.Length; i++) sel[i] = lab[i] != 0 && escolhidas.Contains(lab[i]);

        // dilatação separável (máximo em janela)
        var tmp = new bool[w * h];
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                bool v = false;
                for (int d = -raio; d <= raio && !v; d++) { int nx = x + d; if (nx >= 0 && nx < w && sel[y * w + nx]) v = true; }
                tmp[y * w + x] = v;
            }
        var zona = new bool[w * h];
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                bool v = false;
                for (int d = -raio; d <= raio && !v; d++) { int ny = y + d; if (ny >= 0 && ny < h && tmp[ny * w + x]) v = true; }
                zona[y * w + x] = v;
            }

        var o = new Raster(w, h);
        for (int i = 0; i < w * h; i++)
        {
            if (!zona[i]) continue;
            int b = src.Px[i * 4], g = src.Px[i * 4 + 1], r = src.Px[i * 4 + 2];
            if (sel[i]) { o.Px[i * 4] = (byte)b; o.Px[i * 4 + 1] = (byte)g; o.Px[i * 4 + 2] = (byte)r; o.Px[i * 4 + 3] = 255; continue; }
            if (tinta[i]) continue; // tinta de OUTRA peça encostada no anel
            int mn = Math.Min(r, Math.Min(g, b));
            double a = 1.0 - mn / 255.0;
            double ap = (a - corte) / (1.0 - corte);
            if (ap <= 0) continue;
            if (ap > 1) ap = 1;
            o.Px[i * 4] = Corrigir(b, ap);
            o.Px[i * 4 + 1] = Corrigir(g, ap);
            o.Px[i * 4 + 2] = Corrigir(r, ap);
            o.Px[i * 4 + 3] = (byte)Math.Round(ap * 255);
        }
        return o;
    }

    // F tal que ap*F + (1-ap)*255 = c  (a cor da marca sem o branco que estava misturado)
    static byte Corrigir(int c, double ap)
    {
        double f = (c - (1 - ap) * 255) / ap;
        if (f < 0) f = 0; if (f > 255) f = 255;
        return (byte)Math.Round(f);
    }

    public static HashSet<int> Escolher(List<Peca> pecas, Func<Peca, bool> regra)
    {
        var s = new HashSet<int>();
        foreach (var p in pecas) if (regra(p)) s.Add(p.Id);
        return s;
    }

    // Caixa que envolve tudo que não é transparente
    public static Rectangle CaixaOpaca(Raster r, int alfaMin)
    {
        int e = r.W, t = r.H, d = -1, b = -1;
        for (int y = 0; y < r.H; y++)
            for (int x = 0; x < r.W; x++)
                if (r.Px[(y * r.W + x) * 4 + 3] >= alfaMin)
                { if (x < e) e = x; if (x > d) d = x; if (y < t) t = y; if (y > b) b = y; }
        if (d < 0) return Rectangle.Empty;
        return new Rectangle(e, t, d - e + 1, b - t + 1);
    }

    public static Bitmap Recortar(Raster r, Rectangle caixa)
    {
        using (var full = ParaBitmap(r)) return full.Clone(caixa, PixelFormat.Format32bppArgb);
    }

    // Põe a imagem centralizada numa tela transparente quadrada, ocupando `ocupacao` (0..1) do lado
    public static Bitmap Quadrado(Image img, int lado, double ocupacao)
    {
        var bmp = new Bitmap(lado, lado, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.Clear(Color.Transparent);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.SmoothingMode = SmoothingMode.HighQuality;
            double esc = Math.Min(lado * ocupacao / img.Width, lado * ocupacao / img.Height);
            int w = (int)Math.Round(img.Width * esc), h = (int)Math.Round(img.Height * esc);
            g.DrawImage(img, new Rectangle((lado - w) / 2, (lado - h) / 2, w, h));
        }
        return bmp;
    }

    public static GraphicsPath Arredondado(float x, float y, float w, float h, float raio)
    {
        var p = new GraphicsPath(); float d = raio * 2;
        p.AddArc(x, y, d, d, 180, 90); p.AddArc(x + w - d, y, d, d, 270, 90);
        p.AddArc(x + w - d, y + h - d, d, d, 0, 90); p.AddArc(x, y + h - d, d, d, 90, 90);
        p.CloseFigure(); return p;
    }

    // Ícone do app: quadrado de cantos arredondados em branco-azulado com a imagem no centro.
    // Fundo claro de propósito: o azul-marinho da marca some em barra de tarefas/aba escura.
    public static Bitmap Icone(Image emblema, int lado, double ocupacao, double raioRel)
    {
        var bmp = new Bitmap(lado, lado, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.Clear(Color.Transparent);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var br = new LinearGradientBrush(new Rectangle(0, 0, lado, lado), Color.FromArgb(255, 255, 255, 255), Color.FromArgb(255, 232, 243, 250), 90f))
            {
                if (raioRel <= 0) g.FillRectangle(br, 0, 0, lado, lado); // quadrado puro: o iOS aplica a propria mascara
                else using (var path = Arredondado(0, 0, lado - 1, lado - 1, (float)(lado * raioRel))) g.FillPath(br, path);
            }
        }
        using (var q = Quadrado(emblema, lado, ocupacao))
        using (var g2 = Graphics.FromImage(bmp)) { g2.DrawImage(q, 0, 0); }
        return bmp;
    }

    public static Bitmap Sobre(Image img, Color fundo)
    {
        var bmp = new Bitmap(img.Width, img.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp)) { g.Clear(fundo); g.DrawImage(img, 0, 0); }
        return bmp;
    }

    // .ico com quadros em PNG (aceito por navegadores e pelo Windows desde o Vista)
    public static void SalvarIco(string caminho, List<Bitmap> quadros)
    {
        var dados = new List<byte[]>();
        foreach (var q in quadros)
            using (var ms = new MemoryStream()) { q.Save(ms, ImageFormat.Png); dados.Add(ms.ToArray()); }

        using (var fs = new FileStream(caminho, FileMode.Create))
        using (var w = new BinaryWriter(fs))
        {
            w.Write((short)0); w.Write((short)1); w.Write((short)quadros.Count);
            int offset = 6 + 16 * quadros.Count;
            for (int i = 0; i < quadros.Count; i++)
            {
                w.Write((byte)(quadros[i].Width >= 256 ? 0 : quadros[i].Width));
                w.Write((byte)(quadros[i].Height >= 256 ? 0 : quadros[i].Height));
                w.Write((byte)0); w.Write((byte)0);
                w.Write((short)1); w.Write((short)32);
                w.Write(dados[i].Length); w.Write(offset);
                offset += dados[i].Length;
            }
            foreach (var d in dados) w.Write(d);
        }
    }

    // BMP de 24 bits (o NSIS, instalador do Windows, só aceita este formato nas imagens laterais)
    public static void SalvarBmp24(Bitmap origem, string caminho)
    {
        using (var rgb = new Bitmap(origem.Width, origem.Height, PixelFormat.Format24bppRgb))
        {
            using (var g = Graphics.FromImage(rgb)) { g.Clear(Color.White); g.DrawImage(origem, 0, 0, origem.Width, origem.Height); }
            rgb.Save(caminho, ImageFormat.Bmp);
        }
    }

    public static void SalvarPng(Bitmap bmp, string caminho)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(caminho));
        bmp.Save(caminho, ImageFormat.Png);
    }
}
