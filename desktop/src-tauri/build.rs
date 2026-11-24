// Declara os comandos do app no manifesto: é o que gera as permissões `allow-<comando>` usadas em
// capabilities/default.json. Sem isso, o Tauri 2 não deixa a página remota (o CaxHub carregado
// do servidor) chamar comandos próprios do app.
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "definir_modo",
            "aplicar_preferencias",
            "notificar",
            "trazer_para_frente",
            "esconder_janela",
            "abrir_no_navegador",
        ])),
    )
    .expect("falha ao preparar o build do Tauri");
}
