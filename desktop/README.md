# CaxHub Desktop

Casca desktop (Tauri v2) da **janela flutuante** do CaxHub: abre com o Windows, fica sempre por cima das outras janelas, com o cronômetro da atividade em andamento e os botões Iniciar/Parar. A interface é a rota `/flutuante` do próprio CaxHub, carregada do servidor — melhorar a tela **não exige reinstalar** o app. Aqui só vive o que o navegador não faz: iniciar com o Windows, ficar no topo, ícone na bandeja e notificação nativa.

> Estado (02/10/2026): compila e o instalador sai com ~1,5 MB. Testado rodando o executável contra o servidor de dev: carrega `/flutuante`, modos pílula (320×72) e expandida (360×560), sempre no topo, esconder/trazer, X esconde sem encerrar, iniciar com o Windows (liga e desliga), notificação nativa, e recusa de links que não sejam http(s). **Ainda não testado:** a tela `/flutuante` autenticada com dados reais, a bandeja, e a instalação do `.exe` em outra máquina.

## O que NÃO entra no deploy da VPS

Nada deste diretório é compilado na VPS nem no Docker. O `.exe` é gerado na máquina de desenvolvimento e copiado por `scp` para `/opt/CaxHub/downloads/` (servido em `/downloads/CaxHub-Desktop-Setup.exe`). O deploy normal (`git pull` + `docker compose up -d --build`) não muda de tempo por causa disto.

## Pré-requisitos (uma vez, na máquina de desenvolvimento)

- **Rust** (rustup, toolchain `stable-x86_64-pc-windows-msvc`). Nesta máquina está em `D:\Dev\Rust` (variáveis `RUSTUP_HOME` e `CARGO_HOME` do usuário); terminais abertos antes da instalação precisam ser reabertos.
- **Visual Studio Build Tools** com a carga "Desenvolvimento para desktop com C++" (MSVC + Windows SDK). Aceita instalar fora do `C:` com `--installPath`.
- **WebView2**: já vem no Windows 11.
- Node (já usado no projeto) — só para o CLI do Tauri (`npm install` aqui baixa `@tauri-apps/cli`).

## Primeira vez

```powershell
cd desktop
npm install
# icones: ficam em src-tauri/icons e saem de ../brand/icone-app-1024.png (marca oficial, ver ../brand/gerar-marca.ps1)
npm run icon   # so se a marca mudar; apague depois src-tauri/icons/android e src-tauri/icons/ios (o app e so Windows)
```

## Desenvolvimento

```powershell
# com o frontend rodando (npm run dev em ../frontend, porta 5173)
$env:CAXHUB_URL = "http://localhost:5173"
npm run dev
```

## Gerar e publicar o instalador

```powershell
.\publicar.ps1          # gera o NSIS e copia para a VPS
```

O instalador é por usuário (não pede administrador). Sem assinatura de código, o SmartScreen mostra "O Windows protegeu o computador": **Mais informações → Executar assim mesmo**.

## Endereço do servidor

Ordem de busca: variável `CAXHUB_URL` → `config.json` na pasta de configuração do app (`%APPDATA%\br.com.caxhub.desktop\config.json`, conteúdo `{"url": "https://..."}`) → `http://179.197.67.226:8080`. Trocar IP/domínio não exige reinstalar, mas o novo endereço precisa casar com `remote.urls` em `src-tauri/capabilities/default.json` (já cobre `*.caxhub.com.br`), senão a página perde os comandos nativos.

## Segurança

- A página carregada é remota, então só os comandos listados em `build.rs` / `capabilities/default.json` estão liberados, e só para os endereços de `remote.urls`.
- Enquanto o CaxHub estiver em **HTTP** (sem HTTPS), quem interceptar a rede no meio do caminho poderia injetar JavaScript e chamar esses comandos (autostart, janela, notificação, abrir link http/https). Risco baixo, mas real; a solução definitiva é colocar o CaxHub em HTTPS.
- O token de dispositivo fica só como hash no banco e pode ser revogado em **Meu perfil → Janela flutuante**. "Sair" dentro do app também revoga.

## Como funciona

- **Fechar (X) esconde** na bandeja e não encerra: a página continua viva e o cronômetro segue. "Sair" no menu da bandeja encerra de verdade — e aí a sessão em andamento para em ~90 s (`pararSessoesAoFecharPagina.ts` no backend).
- As opções do usuário (abrir ao iniciar, sempre no topo, alertas, modo inicial) ficam no servidor; a página as aplica a cada abertura via `aplicar_preferencias`. Posição e tamanho ficam locais (plugin window-state).
- Sem rede ao abrir, a janela mostra "Conectando ao servidor…" e tenta de novo a cada 5 s.
