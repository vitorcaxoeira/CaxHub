# Gera todas as variantes da marca do CaxHub a partir de brand/logo-original.png.
#
#   powershell -ExecutionPolicy Bypass -File brand\gerar-marca.ps1
#
# A imagem original e um raster de 1024 px com a marca sobre uma foto de cachoeira desbotada.
# Aqui a marca e separada do fundo por cor (tinta = azul saturado ou azul-marinho; o fundo e claro e
# quase sem saturacao) e dividida em pecas: onda em "C", letras "CaxHub", hub, cauda e lema. As
# variantes saem das pecas, nao de um recorte retangular. Para trocar o desenho, substitua
# brand\logo-original.png: se as coordenadas das pecas mudarem, ajuste as regras abaixo.
#
# Gera: brand\ (emblema, logo completo, icone do app), frontend\public\ (favicon e icone do site/
# telas de login e menu), desktop\ui\ (tela de conexao) e desktop\src-tauri\installer\ (imagens do
# instalador). Os icones do app desktop saem de `tauri icon` (ver desktop\README.md).
# So System.Drawing do Windows: nao instala nada.

$ErrorActionPreference = "Stop"
$brand = $PSScriptRoot
$raiz = Split-Path $brand -Parent
Add-Type -AssemblyName System.Drawing
Add-Type -Path "$brand\Marca.Base.cs", "$brand\Marca.Imagem.cs" -ReferencedAssemblies System.Drawing

$r = [Marca]::Carregar("$brand\logo-original.png")
$tinta = [Marca]::Tinta($r, 55, 150)
$pecas = $null
$lab = [Marca]::Rotular($tinta, $r.W, $r.H, 60, [ref]$pecas)

# Regras por posicao na imagem original (1024x1024).
$emblema = [Marca]::Escolher($pecas, [Func[object, bool]] { param($p) $p.Esq -ge 100 -and $p.Dir -le 500 -and $p.Topo -ge 280 -and $p.Base -le 710 -and -not ($p.Topo -ge 460 -and $p.Base -le 552 -and $p.Esq -ge 220) })
$letras = [Marca]::Escolher($pecas, [Func[object, bool]] { param($p) $p.Topo -ge 460 -and $p.Base -le 552 -and $p.Esq -ge 220 -and $p.Dir -le 615 })
$hub = [Marca]::Escolher($pecas, [Func[object, bool]] { param($p) $p.Esq -ge 620 -and $p.Dir -le 860 -and $p.Topo -ge 380 -and $p.Base -le 600 })
$cauda = [Marca]::Escolher($pecas, [Func[object, bool]] { param($p) $p.Esq -ge 430 -and $p.Dir -ge 600 -and $p.Topo -ge 540 -and $p.Base -le 700 })
$lema = [Marca]::Escolher($pecas, [Func[object, bool]] { param($p) $p.Topo -ge 715 -and $p.Base -le 795 })
if ($emblema.Count -lt 5 -or $letras.Count -ne 6) { throw "As pecas da marca nao bateram (emblema=$($emblema.Count), letras=$($letras.Count)). Confira as regras." }

$todas = New-Object 'System.Collections.Generic.HashSet[int]'
foreach ($c in @($emblema, $letras, $hub, $cauda, $lema)) { foreach ($i in $c) { [void]$todas.Add($i) } }

function Recorte($escolhidas) {
    $ex = [Marca]::Extrair($r, $tinta, $lab, $escolhidas, 2, 0.12)
    return [Marca]::Recortar($ex, [Marca]::CaixaOpaca($ex, 40))
}
$bEmblema = Recorte $emblema
$bCompleto = Recorte $todas
$bLetras = Recorte $letras
# Logo sem o lema + lema sozinho: a faixa do login desenha os dois separados pra poder dar mais
# tamanho ao lema (na logo inteira ele encolhe junto e fica ilegivel numa faixa baixa).
$semLema = New-Object 'System.Collections.Generic.HashSet[int]'
foreach ($c in @($emblema, $letras, $hub, $cauda)) { foreach ($i in $c) { [void]$semLema.Add($i) } }
$bSemLema = Recorte $semLema
$bLema = Recorte $lema

# --- brand\ ---------------------------------------------------------------------------------
[Marca]::SalvarPng(([Marca]::Quadrado($bEmblema, 512, 0.88)), "$brand\emblema.png")
$pad = 24
$comMargem = New-Object System.Drawing.Bitmap ($bCompleto.Width + 2 * $pad), ($bCompleto.Height + 2 * $pad), ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($comMargem); $g.DrawImage($bCompleto, $pad, $pad); $g.Dispose()
[Marca]::SalvarPng($comMargem, "$brand\logo-completo.png")
$icone1024 = [Marca]::Icone($bEmblema, 1024, 0.66, 0.225)
[Marca]::SalvarPng($icone1024, "$brand\icone-app-1024.png")

# --- site (frontend\public) -------------------------------------------------------------------
# Quanto menor o quadro, maior a fatia que a onda ocupa: em 16 px o desenho precisa de espaco.
$quadros = @()
foreach ($par in @(@(16, 0.88), @(32, 0.84), @(48, 0.80), @(64, 0.76))) { $quadros += [Marca]::Icone($bEmblema, $par[0], $par[1], 0.2) }
[Marca]::SalvarIco("$raiz\frontend\public\favicon.ico", ([System.Collections.Generic.List[System.Drawing.Bitmap]]$quadros))
[Marca]::SalvarPng(([Marca]::Icone($bEmblema, 32, 0.84, 0.2)), "$raiz\frontend\public\favicon-32.png")
[Marca]::SalvarPng(([Marca]::Icone($bEmblema, 180, 0.70, 0.0)), "$raiz\frontend\public\apple-touch-icon.png")
[Marca]::SalvarPng(([Marca]::Icone($bEmblema, 128, 0.74, 0.22)), "$raiz\frontend\public\marca\icone-128.png")

# --- app desktop ------------------------------------------------------------------------------
[Marca]::SalvarPng(([Marca]::Icone($bEmblema, 128, 0.74, 0.22)), "$raiz\desktop\ui\icone.png")

# Instalador (NSIS): cabecalho 150x57 e imagem lateral 164x314, sempre sobre branco.
$cab = New-Object System.Drawing.Bitmap 150, 57, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gc = [System.Drawing.Graphics]::FromImage($cab); $gc.Clear([System.Drawing.Color]::White)
$gc.InterpolationMode = 'HighQualityBicubic'; $gc.SmoothingMode = 'HighQuality'
$alt = 47; $larg = [int]($bEmblema.Width * $alt / $bEmblema.Height)
$gc.DrawImage($bEmblema, [int]((150 - $larg) / 2), 5, $larg, $alt); $gc.Dispose()
[Marca]::SalvarBmp24($cab, "$raiz\desktop\src-tauri\installer\cabecalho.bmp")

$lat = New-Object System.Drawing.Bitmap 164, 314, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gl = [System.Drawing.Graphics]::FromImage($lat)
$gl.InterpolationMode = 'HighQualityBicubic'; $gl.SmoothingMode = 'HighQuality'
$fundo = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 0, 164, 314), ([System.Drawing.Color]::White), ([System.Drawing.Color]::FromArgb(255, 214, 236, 247)), 90.0
$gl.FillRectangle($fundo, 0, 0, 164, 314)
$ae = 118; $le = [int]($bEmblema.Width * $ae / $bEmblema.Height)
$gl.DrawImage($bEmblema, [int]((164 - $le) / 2), 52, $le, $ae)
$lw = 112; $aw = [int]($bLetras.Height * $lw / $bLetras.Width)
$gl.DrawImage($bLetras, [int]((164 - $lw) / 2), 186, $lw, $aw); $gl.Dispose()
[Marca]::SalvarBmp24($lat, "$raiz\desktop\src-tauri\installer\lateral.bmp")

# --- faixa das telas de login e convite -------------------------------------------------------
# Faixa baixa e larga (15:4, a mesma do `aspect-[15/4]` do CartaoAcesso.tsx: mudar uma, mudar a
# outra). A imagem original e quadrada, entao nao da pra so recortar sem cortar a logo: o fundo vem
# da faixa de CIMA da original (y 0-273, so nevoa e cachoeira, a onda comeca em y 292) e a logo
# completa ja separada do fundo vai por cima, centralizada. JPEG porque e foto (em PNG passaria de
# 1 MB, e o login e a primeira tela que carrega).
$fw = 1200; $fh = 320
$faixa = New-Object System.Drawing.Bitmap $fw, $fh, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$gf = [System.Drawing.Graphics]::FromImage($faixa)
$gf.InterpolationMode = 'HighQualityBicubic'; $gf.SmoothingMode = 'HighQuality'; $gf.PixelOffsetMode = 'HighQuality'
$orig = [System.Drawing.Image]::FromFile("$brand\logo-original.png")
$gf.DrawImage($orig, (New-Object System.Drawing.Rectangle 0, 0, $fw, $fh), 0, 0, $orig.Width, [int]($orig.Width * $fh / $fw), [System.Drawing.GraphicsUnit]::Pixel)
# Logo em cima e lema embaixo, cada um centralizado. O lema fica ~25% maior que na logo original
# (pedido do Vitor: na proporcao original ele saia com ~10 px de letra no cartao) e o espaco entre
# os dois um pouco menor, pra altura total continuar ~88% da faixa.
$altLogo = 227; $altLema = 41; $vao = 12
$larLogo = [int]($bSemLema.Width * $altLogo / $bSemLema.Height)
$larLema = [int]($bLema.Width * $altLema / $bLema.Height)
$topo = [int](($fh - ($altLogo + $vao + $altLema)) / 2)
$gf.DrawImage($bSemLema, [int](($fw - $larLogo) / 2), $topo, $larLogo, $altLogo)
$gf.DrawImage($bLema, [int](($fw - $larLema) / 2), $topo + $altLogo + $vao, $larLema, $altLema)
$gf.Dispose(); $orig.Dispose()
$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$qualidade = New-Object System.Drawing.Imaging.EncoderParameters 1
$qualidade.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]85)
$faixa.Save("$raiz\frontend\public\marca\login-faixa.jpg", $jpeg, $qualidade)
$faixa.Dispose()

Write-Host "Marca gerada: $($emblema.Count) pecas no emblema, $($letras.Count) letras, $($hub.Count) do hub."
