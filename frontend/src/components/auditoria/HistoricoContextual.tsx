import axios from "axios";
import { useEffect, useState } from "react";
import { Avatar } from "../ui/Avatar";
import { GrupoAuditoria, resumoGrupo, toneBadgeAuditoria, toneGrupo } from "./auditoriaVisual";
import { DrawerAuditoria } from "./DrawerAuditoria";

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

interface HistoricoContextualProps {
  entidadeTipo: string;
  entidadeId: string | number;
}

// Aba/seção "Auditoria" reaproveitada dentro das telas de proposta e atividade (Fase 4)
// — mesmo GET /api/auditoria/entidade/:tipo/:id da Fase 3, só que embutido num painel
// menor em vez da tela cheia. RBAC fino: o backend decide se o usuário atual pode ver
// (admin/gestor sempre; consultor comum só a própria atividade) — aqui só tratamos o
// 403 graciosamente, sem quebrar o resto da tela.
export function HistoricoContextual({ entidadeTipo, entidadeId }: HistoricoContextualProps) {
  const [grupos, setGrupos] = useState<GrupoAuditoria[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMais, setLoadingMais] = useState(false);
  const [semAcesso, setSemAcesso] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [drawerGrupo, setDrawerGrupo] = useState<GrupoAuditoria | null>(null);

  function carregar(cursor: string | null) {
    if (cursor) setLoadingMais(true);
    else setLoading(true);
    axios
      .get(`/api/auditoria/entidade/${entidadeTipo}/${entidadeId}`, { params: { agrupar: true, limit: 15, cursor: cursor ?? undefined } })
      .then(({ data }) => {
        setGrupos((atual) => (cursor ? [...atual, ...data.rows] : data.rows));
        setNextCursor(data.nextCursor);
        setSemAcesso(false);
        setErro(null);
      })
      .catch((err) => {
        if (err.response?.status === 403) setSemAcesso(true);
        else setErro(err.response?.data?.error ?? "Falha ao carregar o histórico");
      })
      .finally(() => {
        setLoading(false);
        setLoadingMais(false);
      });
  }

  useEffect(() => {
    carregar(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entidadeTipo, entidadeId]);

  if (semAcesso) return null; // consultor sem acesso a este histórico específico — não polui a tela com um aviso

  return (
    <div>
      {loading && <p className="text-[12.5px] text-muted">Carregando histórico...</p>}
      {erro && <p className="text-[12.5px] text-destructive">{erro}</p>}
      {!loading && !erro && grupos.length === 0 && <p className="text-[12.5px] text-muted">Sem eventos de auditoria registrados.</p>}

      <div className="space-y-1.5">
        {grupos.map((grupo) => {
          const primeiro = grupo.eventos[0];
          const tone = toneGrupo(grupo);
          return (
            <button
              key={grupo.correlationId}
              onClick={() => setDrawerGrupo(grupo)}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
            >
              <Avatar nome={primeiro?.usuarioNome ?? "Sistema"} fotoUrl={primeiro?.usuarioFotoUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] text-foreground">{resumoGrupo(grupo)}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                  {dateTimeFormatter.format(new Date(grupo.ocorridoEm))}
                  <span className={`rounded-full px-1.5 py-0.5 font-mono text-[9.5px] font-medium ${toneBadgeAuditoria[tone]}`}>
                    {primeiro?.eventoTipo}
                  </span>
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {nextCursor && (
        <button
          onClick={() => carregar(nextCursor)}
          disabled={loadingMais}
          className="mt-2 text-[11.5px] text-primary hover:underline disabled:opacity-50"
        >
          {loadingMais ? "Carregando..." : "Carregar mais"}
        </button>
      )}

      {drawerGrupo && <DrawerAuditoria grupo={drawerGrupo} onFechar={() => setDrawerGrupo(null)} />}
    </div>
  );
}
