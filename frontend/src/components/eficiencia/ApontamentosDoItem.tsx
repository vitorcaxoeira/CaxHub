import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "../ui/Toast";
import { ApontamentoLinha, ApontamentosDoItemResposta, MotivoExclusao, dataBr, dataHoraBr, hh, hhmm, horaDoDia } from "../../lib/eficiencia";
import { Chip } from "./comum";
import { ModalExclusao } from "./ModalExclusao";

const mensagemDeErro = (e: unknown, padrao: string) => (axios.isAxiosError(e) ? e.response?.data?.error ?? padrao : padrao);

// Lista, dentro do item da gaveta, os apontamentos que compõem o executado — é daqui que o gestor tira um do cálculo
// do painel (ou o devolve). Carrega sob demanda (itens grandes têm milhares de linhas; vem só o mais recente).
export function ApontamentosDoItem({
  codemp,
  codpro,
  seqite,
  motivos,
  onMudou,
}: {
  codemp: number;
  codpro: number;
  seqite: number;
  motivos: MotivoExclusao[];
  /** Avisa que o cálculo mudou (a gaveta e o painel precisam recarregar). */
  onMudou: () => void;
}) {
  const { mostrar } = useToast();
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<ApontamentosDoItemResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [alvo, setAlvo] = useState<ApontamentoLinha | null>(null);
  const [restaurando, setRestaurando] = useState<number | null>(null);

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setErro(null);
    axios
      .get<ApontamentosDoItemResposta>(`/api/eficiencia/propostas/${codemp}/${codpro}/itens/${seqite}/apontamentos`)
      .then(({ data }) => !cancelado && setDados(data))
      .catch((e) => !cancelado && setErro(mensagemDeErro(e, "Não foi possível carregar os apontamentos.")));
    return () => {
      cancelado = true;
    };
  }, [aberto, codemp, codpro, seqite, versao]);

  const mudou = useCallback(() => {
    setVersao((v) => v + 1);
    onMudou();
  }, [onMudou]);

  async function excluir(motivo: string, observacao: string): Promise<string | null> {
    if (!alvo) return "Apontamento não selecionado.";
    try {
      await axios.post(`/api/eficiencia/apontamentos/${alvo.id}/excluir`, { motivo, observacao: observacao || undefined });
      setAlvo(null);
      mostrar("Apontamento fora do cálculo. Dá pra restaurar quando quiser.", "success");
      mudou();
      return null;
    } catch (e) {
      return mensagemDeErro(e, "Não foi possível tirar o apontamento do cálculo.");
    }
  }

  async function restaurar(a: ApontamentoLinha) {
    setRestaurando(a.id);
    try {
      await axios.post(`/api/eficiencia/apontamentos/${a.id}/restaurar`);
      mostrar("Apontamento de volta ao cálculo.", "success");
      mudou();
    } catch (e) {
      mostrar(mensagemDeErro(e, "Não foi possível restaurar o apontamento."), "destructive");
    } finally {
      setRestaurando(null);
    }
  }

  return (
    <div className="mt-2.5 border-t border-border/60 pt-2">
      <button
        type="button"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className="text-[12.5px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {aberto ? "▾ Ocultar apontamentos" : "▸ Ver apontamentos do item"}
      </button>

      {aberto && (
        <div className="mt-2">
          {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{erro}</p>}
          {!dados && !erro && <p className="text-[12.5px] text-muted">Carregando…</p>}
          {dados && (
            <>
              <p className="mb-1.5 text-[12px] text-muted">
                {dados.total} apontamentos · {hh(dados.minutosTotal)}
                {dados.truncado ? ` · mostrando os ${dados.apontamentos.length} mais recentes` : ""}
                {!dados.podeDecidir && " · você vê, mas só o gestor do item pode tirar do cálculo"}
              </p>
              {dados.apontamentos.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-[12.5px] text-muted">Nenhum apontamento neste item.</p>
              ) : (
                <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto rounded-md border border-border">
                  {dados.apontamentos.map((a) => (
                    <li key={a.id} className={`px-2.5 py-2 text-[12.5px] ${a.excluido ? "bg-surface-2/60" : ""}`}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className={a.excluido ? "text-muted line-through" : "text-foreground"}>
                          <b className="font-mono">{dataBr(a.data)}</b> <span className="font-mono text-muted">{horaDoDia(a.horini)}–{horaDoDia(a.horfim)}</span>{" "}
                          <b className="font-mono">{hhmm(a.minutos)} h</b>
                        </span>
                        <span className="text-muted">{a.consultor ?? "Outro consultor"}{a.numrat ? ` · RAT ${a.numrat}` : ""}</span>
                      </div>
                      {a.descricao && <p className={`mt-0.5 line-clamp-2 ${a.excluido ? "text-muted line-through" : "text-muted"}`}>{a.descricao}</p>}
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                        {a.excluido ? (
                          <span className="inline-flex flex-wrap items-center gap-2">
                            <Chip tom="warn">Fora do cálculo · {a.motivoRotulo}</Chip>
                            <span className="text-[11.5px] text-muted" title={a.observacao ?? undefined}>
                              {a.excluidoPorNome} · {dataHoraBr(a.excluidoEm)}
                              {a.observacao ? ` · “${a.observacao}”` : ""}
                            </span>
                          </span>
                        ) : (
                          <span />
                        )}
                        {dados.podeDecidir &&
                          (a.excluido ? (
                            <button
                              type="button"
                              onClick={() => restaurar(a)}
                              disabled={restaurando === a.id}
                              className="rounded-md border border-border bg-surface px-2 py-0.5 text-[12px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                            >
                              {restaurando === a.id ? "Restaurando…" : "Restaurar"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setAlvo(a)}
                              className="rounded-md border border-border bg-surface px-2 py-0.5 text-[12px] font-medium text-foreground transition hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              Tirar do cálculo
                            </button>
                          ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <ModalExclusao
        aberto={alvo != null}
        motivos={motivos}
        resumo={alvo ? `${dataBr(alvo.data)} · ${horaDoDia(alvo.horini)}–${horaDoDia(alvo.horfim)} · ${alvo.consultor ?? "Outro consultor"}` : ""}
        minutos={alvo?.minutos ?? 0}
        onConfirmar={excluir}
        onCancelar={() => setAlvo(null)}
      />
    </div>
  );
}
