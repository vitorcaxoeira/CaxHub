// CaxHub Desktop — casca fina da janela flutuante.
//
// A interface inteira vem do servidor (rota /flutuante do CaxHub), então melhorar a tela NÃO
// exige reinstalar o app. Aqui ficam só as coisas que o navegador não faz: iniciar com o Windows,
// ficar por cima das outras janelas, ícone na bandeja e notificação nativa. A página chama estes
// comandos por `window.__TAURI__` (ver frontend/src/lib/desktop.ts).

use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

const ROTULO_JANELA: &str = "flutuante";
const URL_PADRAO: &str = "http://179.197.67.226:8080";
// Tamanhos em pixels lógicos. A "pílula" mostra só o cronômetro; a expandida, a lista.
const TAMANHO_PILULA: (f64, f64) = (320.0, 72.0);
const TAMANHO_EXPANDIDA: (f64, f64) = (360.0, 560.0);
// Distância da borda da área útil (sem a barra de tarefas) ao encaixar num canto, em px lógicos.
const MARGEM: f64 = 16.0;
// Só posição e tamanho vão pro arquivo de estado: salvar "visível" faria o app subir escondido
// depois de um "Sair" com a janela oculta, e ninguém veria o que "abrir ao iniciar" abriu.
const ESTADO_JANELA: StateFlags = StateFlags::POSITION.union(StateFlags::SIZE);

#[derive(Clone, Copy)]
enum Canto {
    SuperiorDireito,
    InferiorDireito,
    SuperiorEsquerdo,
    InferiorEsquerdo,
}

#[derive(Deserialize)]
struct Configuracao {
    url: Option<String>,
}

// Endereço do CaxHub, nesta ordem: variável CAXHUB_URL (desenvolvimento), `config.json` na pasta
// de configuração do app ({"url": "..."}) e, por fim, o endereço de produção. O arquivo existe
// pra uma troca de IP/domínio não obrigar a reinstalar em todos os computadores. A URL precisa
// continuar casando com `remote.urls` de capabilities/default.json, senão a página perde os
// comandos nativos.
fn url_do_servidor(app: &AppHandle) -> String {
    if let Ok(url) = std::env::var("CAXHUB_URL") {
        if !url.trim().is_empty() {
            return url.trim().trim_end_matches('/').to_string();
        }
    }
    if let Ok(pasta) = app.path().app_config_dir() {
        if let Ok(texto) = std::fs::read_to_string(pasta.join("config.json")) {
            // O Bloco de Notas e o PowerShell 5.1 gravam UTF-8 COM BOM, que o serde_json recusa.
            if let Ok(cfg) = serde_json::from_str::<Configuracao>(texto.trim_start_matches('\u{feff}')) {
                if let Some(url) = cfg.url.filter(|u| !u.trim().is_empty()) {
                    return url.trim().trim_end_matches('/').to_string();
                }
            }
        }
    }
    URL_PADRAO.to_string()
}

fn janela(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(ROTULO_JANELA)
}

fn monitor_da_janela(janela: &WebviewWindow) -> Option<tauri::Monitor> {
    match janela.current_monitor() {
        Ok(Some(m)) => Some(m),
        _ => janela.primary_monitor().ok().flatten(),
    }
}

// Encaixa num canto da ÁREA ÚTIL do monitor (a que não inclui a barra de tarefas), com margem.
fn encaixar(janela: &WebviewWindow, canto: Canto) {
    let Some(monitor) = monitor_da_janela(janela) else { return };
    let Ok(tamanho) = janela.outer_size() else { return };
    let area = monitor.work_area();
    let margem = (MARGEM * monitor.scale_factor()) as i32;
    let esquerda = area.position.x + margem;
    let direita = area.position.x + area.size.width as i32 - tamanho.width as i32 - margem;
    let topo = area.position.y + margem;
    let base = area.position.y + area.size.height as i32 - tamanho.height as i32 - margem;
    let (x, y) = match canto {
        Canto::SuperiorDireito => (direita, topo),
        Canto::InferiorDireito => (direita, base),
        Canto::SuperiorEsquerdo => (esquerda, topo),
        Canto::InferiorEsquerdo => (esquerda, base),
    };
    let _ = janela.set_position(PhysicalPosition::new(x, y));
}

// Trocar de modo redimensiona a janela a partir do canto superior esquerdo: uma janela encostada
// embaixo ou à direita ficaria boiando no meio da tela (ao recolher) ou cresceria pra fora dela
// (ao expandir). Mantém ancorada a borda em que ela estava encostada e, no fim, garante que cabe
// na área útil. Recebe a geometria de ANTES de redimensionar: lida depois, a folga já incluiria a
// mudança de tamanho e a "âncora" só repetiria a posição errada. O tamanho novo é previsto (a moldura
// é constante), porque `outer_size` logo depois de `set_size` pode devolver o valor antigo.
struct Geometria {
    pos: PhysicalPosition<i32>,
    externo: PhysicalSize<u32>,
    interno: PhysicalSize<u32>,
}

fn ler_geometria(janela: &WebviewWindow) -> Option<Geometria> {
    Some(Geometria {
        pos: janela.outer_position().ok()?,
        externo: janela.outer_size().ok()?,
        interno: janela.inner_size().ok()?,
    })
}

fn ajustar_ao_redimensionar(janela: &WebviewWindow, antes: Geometria, largura: f64, altura: f64) {
    let Some(monitor) = monitor_da_janela(janela) else { return };
    let Geometria { pos, externo, interno } = antes;
    let escala = monitor.scale_factor();
    let area = monitor.work_area();
    let (esq, topo) = (area.position.x, area.position.y);
    let (dir, base) = (esq + area.size.width as i32, topo + area.size.height as i32);

    let moldura_w = externo.width as i32 - interno.width as i32;
    let moldura_h = externo.height as i32 - interno.height as i32;
    let novo_w = (largura * escala).round() as i32 + moldura_w;
    let novo_h = (altura * escala).round() as i32 + moldura_h;

    let tolerancia = (MARGEM * 3.0 * escala) as i32;
    let folga_dir = dir - (pos.x + externo.width as i32);
    let folga_base = base - (pos.y + externo.height as i32);
    let mut x = if folga_dir.abs() <= tolerancia { dir - folga_dir - novo_w } else { pos.x };
    let mut y = if folga_base.abs() <= tolerancia { base - folga_base - novo_h } else { pos.y };

    if x + novo_w > dir {
        x = dir - novo_w;
    }
    if y + novo_h > base {
        y = base - novo_h;
    }
    x = x.max(esq);
    y = y.max(topo);
    let _ = janela.set_position(PhysicalPosition::new(x, y));
}

// Só na primeira vez neste computador a janela vai pro canto; depois vale a posição lembrada.
fn primeira_abertura(app: &AppHandle) -> bool {
    let Ok(pasta) = app.path().app_config_dir() else { return false };
    let marca = pasta.join("posicao-inicial.ok");
    if marca.exists() {
        return false;
    }
    let _ = std::fs::create_dir_all(&pasta);
    let _ = std::fs::write(&marca, "1");
    true
}

fn salvar_posicao(app: &AppHandle) {
    let _ = app.save_window_state(ESTADO_JANELA);
}

// Esconder na bandeja deixa a janela sem nenhum sinal na tela, e o ícone da bandeja costuma ficar
// dentro da seta (^) do Windows. Na primeira vez em cada execução o app diz pra onde ela foi.
static AVISOU_BANDEJA: AtomicBool = AtomicBool::new(false);

fn esconder_na_bandeja(app: &AppHandle, janela: &WebviewWindow) {
    salvar_posicao(app);
    let _ = janela.hide();
    if !AVISOU_BANDEJA.swap(true, Ordering::Relaxed) {
        let _ = app
            .notification()
            .builder()
            .title("CaxHub")
            .body("A janela continua aberta na bandeja do sistema (seta ^ ao lado do relógio). Clique no ícone do CaxHub para mostrar de novo.")
            .show();
    }
}

fn mostrar(app: &AppHandle) {
    if let Some(j) = janela(app) {
        let _ = j.show();
        let _ = j.unminimize();
        let _ = j.set_focus();
    }
}

fn alternar_visibilidade(app: &AppHandle) {
    if let Some(j) = janela(app) {
        if j.is_visible().unwrap_or(false) {
            let _ = j.hide();
        } else {
            mostrar(app);
        }
    }
}

// Espera o servidor responder (TCP) e só então manda a janela pra página do CaxHub. Até lá ela
// mostra a tela local de conexão (ui/index.html). Sem isto, abrir o app sem rede (comum logo que o
// Windows liga) deixaria a página de erro do WebView2, sem nenhuma nova tentativa.
fn conectar_quando_disponivel(app: AppHandle, url: String) {
    std::thread::spawn(move || {
        let Ok(parsed) = Url::parse(&url) else { return };
        let Some(host) = parsed.host_str().map(|h| h.to_string()) else { return };
        let porta = parsed.port_or_known_default().unwrap_or(80);
        loop {
            let alcancavel = (host.as_str(), porta)
                .to_socket_addrs()
                .ok()
                .and_then(|mut enderecos| enderecos.find_map(|e| TcpStream::connect_timeout(&e, Duration::from_secs(3)).ok()))
                .is_some();
            if alcancavel {
                if let Some(j) = janela(&app) {
                    let destino = serde_json::to_string(&format!("{}/flutuante", url)).unwrap_or_default();
                    let _ = j.eval(&format!("location.replace({})", destino));
                }
                return;
            }
            std::thread::sleep(Duration::from_secs(5));
        }
    });
}

// ---------- Comandos chamados pela página ----------

#[tauri::command]
fn definir_modo(window: WebviewWindow, modo: String) -> Result<(), String> {
    let (largura, altura) = match modo.as_str() {
        "pilula" => TAMANHO_PILULA,
        "expandida" => TAMANHO_EXPANDIDA,
        _ => return Err("modo inválido".into()),
    };
    // Lê a geometria ANTES de redimensionar (ver ajustar_ao_redimensionar).
    let antes = ler_geometria(&window);
    window.set_size(LogicalSize::new(largura, altura)).map_err(|e| e.to_string())?;
    if let Some(antes) = antes {
        ajustar_ao_redimensionar(&window, antes, largura, altura);
    }
    Ok(())
}

// Fonte da verdade: as preferências do usuário no servidor. A página chama isto a cada abertura.
#[tauri::command]
fn aplicar_preferencias(
    app: AppHandle,
    window: WebviewWindow,
    abrir_ao_iniciar: bool,
    sempre_no_topo: bool,
) -> Result<(), String> {
    window.set_always_on_top(sempre_no_topo).map_err(|e| e.to_string())?;
    let inicio = app.autolaunch();
    let ligado = inicio.is_enabled().unwrap_or(false);
    if abrir_ao_iniciar && !ligado {
        inicio.enable().map_err(|e| e.to_string())?;
    } else if !abrir_ao_iniciar && ligado {
        inicio.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn notificar(app: AppHandle, titulo: String, corpo: String) -> Result<(), String> {
    app.notification().builder().title(titulo).body(corpo).show().map_err(|e| e.to_string())
}

#[tauri::command]
fn trazer_para_frente(app: AppHandle) {
    mostrar(&app);
}

// Esconde, não encerra: a página segue viva e o cronômetro continua. Encerrar de verdade é só
// "Sair" na bandeja — aí o `pagehide` agenda a parada da sessão (ver VigiaFimDeJornada).
#[tauri::command]
fn esconder_janela(app: AppHandle, window: WebviewWindow) {
    esconder_na_bandeja(&app, &window);
}

#[tauri::command]
fn abrir_no_navegador(app: AppHandle, url: String) -> Result<(), String> {
    // A página é remota: só abre http(s), nunca file:, javascript: ou programa local.
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("endereço não permitido".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

fn montar_bandeja(app: &AppHandle, url: &str) -> tauri::Result<()> {
    let mostrar_ocultar = MenuItem::with_id(app, "mostrar_ocultar", "Mostrar / ocultar", true, None::<&str>)?;
    let topo = CheckMenuItem::with_id(app, "topo", "Sempre no topo", true, true, None::<&str>)?;
    let completo = MenuItem::with_id(app, "completo", "Abrir o CaxHub completo", true, None::<&str>)?;
    let sair = MenuItem::with_id(app, "sair", "Sair", true, None::<&str>)?;
    let pos_id = MenuItem::with_id(app, "pos_id", "Inferior direito", true, None::<&str>)?;
    let pos_sd = MenuItem::with_id(app, "pos_sd", "Superior direito", true, None::<&str>)?;
    let pos_ie = MenuItem::with_id(app, "pos_ie", "Inferior esquerdo", true, None::<&str>)?;
    let pos_se = MenuItem::with_id(app, "pos_se", "Superior esquerdo", true, None::<&str>)?;
    let posicao = Submenu::with_items(app, "Posição", true, &[&pos_id, &pos_sd, &pos_ie, &pos_se])?;
    let menu = Menu::with_items(
        app,
        &[&mostrar_ocultar, &topo, &posicao, &completo, &PredefinedMenuItem::separator(app)?, &sair],
    )?;

    let url_completo = format!("{}/projetos/atividades", url);
    let topo_item = topo.clone();
    let mut bandeja = TrayIconBuilder::new()
        .tooltip("CaxHub")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, evento| match evento.id().as_ref() {
            "mostrar_ocultar" => alternar_visibilidade(app),
            "topo" => {
                if let (Some(j), Ok(marcado)) = (janela(app), topo_item.is_checked()) {
                    let _ = j.set_always_on_top(marcado);
                }
            }
            id @ ("pos_id" | "pos_sd" | "pos_ie" | "pos_se") => {
                if let Some(j) = janela(app) {
                    let _ = j.show();
                    encaixar(
                        &j,
                        match id {
                            "pos_id" => Canto::InferiorDireito,
                            "pos_sd" => Canto::SuperiorDireito,
                            "pos_ie" => Canto::InferiorEsquerdo,
                            _ => Canto::SuperiorEsquerdo,
                        },
                    );
                    salvar_posicao(app);
                }
            }
            "completo" => {
                let _ = app.opener().open_url(url_completo.clone(), None::<&str>);
            }
            "sair" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|bandeja, evento| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = evento {
                alternar_visibilidade(bandeja.app_handle());
            }
        });
    if let Some(icone) = app.default_window_icon() {
        bandeja = bandeja.icon(icone.clone());
    }
    bandeja.build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        // Primeiro plugin, por exigência do single-instance: abrir o app de novo só traz a janela.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| mostrar(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        // Lembra posição e tamanho por computador (dependem do monitor, por isso não vão pro servidor).
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(ESTADO_JANELA).build())
        .invoke_handler(tauri::generate_handler![
            definir_modo,
            aplicar_preferencias,
            notificar,
            trazer_para_frente,
            esconder_janela,
            abrir_no_navegador
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let url = url_do_servidor(&handle);

            // Entregue à página antes de ela carregar (frontend/src/lib/desktop.ts).
            let nome = std::env::var("COMPUTERNAME").unwrap_or_default();
            let script = format!(
                "window.__CAXHUB_DESKTOP__ = {{ hostname: {}, url: {} }};",
                serde_json::to_string(&nome).unwrap_or_else(|_| "\"\"".into()),
                serde_json::to_string(&url).unwrap_or_else(|_| "\"\"".into())
            );

            // Barra de título NATIVA: arrastar funciona em qualquer página, inclusive no login e se o
            // servidor ainda não tiver a tela nova. Aparece na barra de tarefas e pode minimizar (a
            // janela minimizada é achada ali). Só o X esconde na bandeja, ver on_window_event.
            let janela_principal = WebviewWindowBuilder::new(app, ROTULO_JANELA, WebviewUrl::App("index.html".into()))
                .title("CaxHub")
                .inner_size(TAMANHO_EXPANDIDA.0, TAMANHO_EXPANDIDA.1)
                .min_inner_size(TAMANHO_PILULA.0, TAMANHO_PILULA.1)
                .decorations(true)
                .minimizable(true)
                .maximizable(false)
                .resizable(true)
                .skip_taskbar(false)
                // Até as preferências do usuário chegarem do servidor.
                .always_on_top(true)
                .initialization_script(&script)
                .build()?;

            // Primeira vez neste computador: canto inferior direito, o que menos atrapalha (o
            // superior direito cobriria os botões de fechar/minimizar das janelas maximizadas).
            if primeira_abertura(&handle) {
                encaixar(&janela_principal, Canto::InferiorDireito);
                salvar_posicao(&handle);
            }

            montar_bandeja(&handle, &url)?;
            conectar_quando_disponivel(handle, url);
            Ok(())
        })
        // Fechar (X, Alt+F4) esconde na bandeja em vez de encerrar.
        .on_window_event(|janela, evento| {
            if let WindowEvent::CloseRequested { api, .. } = evento {
                api.prevent_close();
                if let Some(j) = janela.app_handle().get_webview_window(ROTULO_JANELA) {
                    esconder_na_bandeja(janela.app_handle(), &j);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao executar o CaxHub Desktop");
}
