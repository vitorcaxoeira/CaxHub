import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar } from "../ui/Avatar";
import { GrupoAuditoria, configEvento, toneBadgeAuditoria } from "./auditoriaVisual";

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" });

function formatarValorCampo(valor: unknown): string {
  if (valor === null || valor === undefined) return "—";
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor)) {
    return dateTimeFormatter.format(new Date(valor));
  }
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  return String(valor);
}

const ORIGEM_LABEL: Record<string, string> = {
  tela: "Tela",
  api: "API",
  job: "Job automático",
  integracao_senior: "Integração Senior",
};

interface DrawerAuditoriaProps {
  grupo: GrupoAuditoria;
  onFechar: () => void;
}

export function DrawerAuditoria({ grupo, onFechar }: DrawerAuditoriaProps) {
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const navigate = useNavigate();
  const primeiro = grupo.eventos[0];
  const usuarioNome = primeiro?.usuarioNome ?? ORIGEM_LABEL[grupo.origem] ?? grupo.origem;
  const propostaLink = primeiro?.codemp != null && primeiro?.codpro != null ? `/projetos/proposta/${primeiro.codemp}/${primeiro.codpro}` : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-foreground/20" onClick={onFechar} />
      <div className="relative flex h-full w-full flex-col overflow-y-auto border-l border-border bg-surface p-5 shadow-xl sm:w-[460px]">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Detalhe da ação</p>
          <button
            onClick={onFechar}
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="mb-5 flex items-center gap-3">
          <Avatar nome={usuarioNome} fotoUrl={primeiro?.usuarioFotoUrl} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{usuarioNome}</p>
            <p className="text-[12px] text-muted">
              {dateTimeFormatter.format(new Date(grupo.ocorridoEm))} · {ORIGEM_LABEL[grupo.origem] ?? grupo.origem}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {grupo.eventos.map((evento) => {
            const config = configEvento(evento.eventoTipo);
            const Icone = config.icone;
            return (
              <div key={evento.id} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${toneBadgeAuditoria[config.tone]}`}>
                    <Icone />
                    {evento.eventoTipo}
                  </span>
                </div>
                <p className="text-sm text-foreground">{config.resumo(evento)}</p>

                {evento.alteracoes && Object.keys(evento.alteracoes).length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-md border border-border">
                    <table className="w-full border-collapse text-[12.5px]">
                      <thead>
                        <tr>
                          <th className="bg-surface-2 px-2.5 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                            Campo
                          </th>
                          <th className="bg-surface-2 px-2.5 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                            Valor anterior
                          </th>
                          <th className="bg-surface-2 px-2.5 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                            Valor novo
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(evento.alteracoes).map(([campo, diff]) => (
                          <tr key={campo} className="border-t border-border/60">
                            <td className="px-2.5 py-1.5 text-foreground">{diff.rotulo ?? campo}</td>
                            <td className="px-2.5 py-1.5 text-muted line-through decoration-muted/60">
                              {formatarValorCampo(diff.de)}
                            </td>
                            <td className="px-2.5 py-1.5 font-medium text-foreground">{formatarValorCampo(diff.para)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {evento.metadata && <MetadataEvento eventoTipo={evento.eventoTipo} metadata={evento.metadata} />}
              </div>
            );
          })}
        </div>

        {propostaLink && (
          <button
            onClick={() => {
              onFechar();
              navigate(propostaLink);
            }}
            className="mt-5 text-sm text-primary hover:underline"
          >
            Ver proposta {primeiro?.codpro} →
          </button>
        )}
      </div>
    </div>
  );
}

function MetadataEvento({ eventoTipo, metadata }: { eventoTipo: string; metadata: Record<string, unknown> }) {
  if (eventoTipo === "ATIVIDADE_ENVIADA_SENIOR") {
    const sucesso = metadata.sucesso === true;
    return (
      <div className="mt-3 space-y-1.5 rounded-md bg-surface-2 p-2.5 text-[12px]">
        <p>
          <span className="text-muted">Status: </span>
          <span className={sucesso ? "font-medium text-success" : "font-medium text-destructive"}>
            {sucesso ? "Sucesso" : "Falha"}
          </span>
        </p>
        {typeof metadata.duracaoMs === "number" && (
          <p>
            <span className="text-muted">Duração: </span>
            <span className="font-mono text-foreground">{metadata.duracaoMs}ms</span>
          </p>
        )}
        {typeof metadata.tipo === "string" && (
          <p>
            <span className="text-muted">Tipo: </span>
            <span className="text-foreground">{metadata.tipo}</span>
          </p>
        )}
        {!sucesso && typeof metadata.erro === "string" && (
          <p>
            <span className="text-muted">Erro: </span>
            <span className="text-destructive">{metadata.erro}</span>
          </p>
        )}
        {typeof metadata.payload === "string" && (
          <details className="mt-1">
            <summary className="cursor-pointer text-muted">Payload enviado</summary>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted">{metadata.payload}</pre>
          </details>
        )}
      </div>
    );
  }

  const entradas = Object.entries(metadata).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (entradas.length === 0) return null;
  return (
    <div className="mt-3 space-y-1 rounded-md bg-surface-2 p-2.5 text-[12px]">
      {entradas.map(([chave, valor]) => (
        <p key={chave}>
          <span className="text-muted">{chave}: </span>
          <span className="text-foreground">{formatarValorCampo(valor)}</span>
        </p>
      ))}
    </div>
  );
}
