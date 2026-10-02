# Gera o instalador do CaxHub Desktop e copia para a VPS. Roda na máquina de desenvolvimento:
# a compilação em Rust NUNCA acontece na VPS (3,8 GB de RAM) nem dentro do Docker.
# Ver desktop/README.md.
param(
    [string]$Vps = "root@179.197.67.226",
    [string]$Chave = "$HOME\.ssh\caxhub_vps_ed25519",
    [switch]$SemPublicar
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

npm install
npm run build

$exe = Get-ChildItem "src-tauri\target\release\bundle\nsis\*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { throw "Instalador não encontrado em src-tauri\target\release\bundle\nsis" }
Write-Host "Instalador gerado: $($exe.FullName) ($([math]::Round($exe.Length / 1MB, 1)) MB)"

if ($SemPublicar) { return }

scp -i $Chave $exe.FullName "${Vps}:/opt/CaxHub/downloads/CaxHub-Desktop-Setup.exe"
Write-Host "Publicado em /downloads/CaxHub-Desktop-Setup.exe"
