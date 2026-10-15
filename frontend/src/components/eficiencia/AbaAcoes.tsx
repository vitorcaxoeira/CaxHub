import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { AcaoDto, AcoesResposta, FiltroAcoes, STATUS_ACAO_ROTULO, StatusAcao, paraTsv, prazoBr } from "../../lib/eficiencia";
import { BotaoCopiar, Cartao, Chip, Indicador, TabelaRolavel, Th, Vazio } from "./comum";

const FILTROS: { chave: FiltroAcoes; rotulo: string }[] = [
  { chave: "abertas", rotulo: "Em aberto" },
  { chave: "atrasadas", rotulo: "Atrasadas" },
  { chave: "concluidas", rotulo: "Concluídas" },
  { chave: "todas", rotulo: "Todas" },
];

export const filtroAcoesValido = (f: string | null | undefined): FiltroAcoes => (f === "atrasadas" || f === "concluidas" || f === "todas" ? f : "abertas");

const mensagem = (e: unknown, padrao: string) => (axios.isAxiosError(e) ? e.response?.data?.error ?? padrao : padrao);

// Estilo do seletor de status: acompanha a cor do chip da situação (aberta, em andamento, concluída).
export const classeStatusAcao: Record<StatusAcao, string> = {
  aberta: "border-warning/40 bg-warning/10 text-warning",
  andamento: "border-primary/40 bg-primary/10 text-primary",
  concluida: "border-success/40 bg-success/10 text-success",
};

export function SeletorStatus({ acao, onMudar, ocupado }: { acao: AcaoDto; onMudar: (status: StatusAcao) => void; ocupado: boolean }) {
  return (
    <select
      value={acao.status}
      disabled={ocupado}
      aria-label={`Status da ação ${acao.titulo}`}
      onChange={(e) => onMudar(e.target.value as StatusAcao)}
      className={`rounded-full border px-2.5 py-1 text-[12px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${classeStatusAcao[acao.status]}`}
    >
      {(Object.keys(STATUS_ACAO_ROTULO) as StatusAcao[]).map((k) => (
        <option key={k} value={k} className="bg-surface text-foreground">
          {STATUS_ACAO_ROTULO[k]}
        </option>
      ))}
    </select>
  );
}

// Aba "Plano de ação": o que o gestor combinou a partir dos alertas, com responsável do time e prazo.
export function AbaAcoes({
  filtro,
  onFiltro,
  versao,
  onNova,
  onEditar,
  onMudou,
  abrirProposta,
  abrirConsultor,
}: {
  filtro: FiltroAcoes;
  onFiltro: (f: FiltroAcoes) => void;
  /** Muda quando uma ação foi criada/editada fora daqui (formulário): recarrega a lista. */
  versao: number;
  onNova: () => void;
  onEditar: (acao: AcaoDto) => void;
  /** Houve mudança (status, exclusão): o painel por trás atualiza a contagem e o alerta. */
  onMudou: () => void;
  abrirProposta: (codemp: number, codpro: number) => void;
  abrirConsultor: (codfor: number) => void;
}) {
  const { mostrar } = useToast();
  const [dados, setDados] = useState<AcoesResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [mudando, setMudando] = useState<number | null>(null);
  const [excluindo, setExcluindo] = useState<AcaoDto | null>(null);
  const [apagando, setApagando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    // Traz todas e filtra na tela: as contagens dos botões precisam do conjunto inteiro.
    axios
      .get<AcoesResposta>("/api/eficiencia/acoes", { params: { filtro: "todas" } })
      .then(({ data }) => !cancelado && setDados(data))
      .catch((e) => !cancelado && setErro(mensagem(e, "Não foi possível carregar o plano de ação.")));
    return () => {
      cancelado = true;
    };
  }, [versao, recarga]);

  const visiveis = useMemo(() => {
    if (!dados) return [];
    return dados.acoes.filter((a) => (filtro === "abertas" ? a.status !== "concluida" : filtro === "atrasadas" ? a.atrasada : filtro === "concluidas" ? a.status === "concluida" : true));
  }, [dados, filtro]);

  const recarregar = useCallback(() => {
    setRecarga((n) => n + 1);
    onMudou();
  }, [onMudou]);

  async function mudarStatus(a: AcaoDto, status: StatusAcao) {
    setMudando(a.id);
    try {
      await axios.patch(`/api/eficiencia/acoes/${a.id}/status`, { status });
      recarregar();
    } catch (e) {
      mostrar(mensagem(e, "Não foi possível mudar o status."), "destructive");
    } finally {
      setMudando(null);
    }
  }

  async function excluir() {
    if (!excluindo) return;
    setApagando(true);
    try {
      await axios.delete(`/api/eficiencia/acoes/${excluindo.id}`);
      setExcluindo(null);
      mostrar("Ação excluída.", "success");
      recarregar();
    } catch (e) {
      mostrar(mensagem(e, "Não foi possível excluir a ação."), "destructive");
    } finally {
      setApagando(false);
    }
  }

  const c = dados?.contagens;
  const contagemDoFiltro = (f: FiltroAcoes) => (c ? { abertas: c.abertas, atrasadas: c.atrasadas, concluidas: c.concluidas, todas: c.todas }[f] : 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Indicador rotulo="Em aberto" valor={c?.abertas ?? "—"} sub="abertas ou em andamento" />
        <Indicador rotulo="Atrasadas" valor={c?.atrasadas ?? "—"} sub="prazo vencido" tom={c ? (c.atrasadas ? "bad" : "ok") : undefined} onClick={() => onFiltro("atrasadas")} />
        <Indicador rotulo="Concluídas" valor={c?.concluidas ?? "—"} sub="no total" />
        <Indicador rotulo="Vencem em 5 dias úteis" valor={c?.vencemEm5DiasUteis ?? "—"} sub="para acompanhar" tom={c && c.vencemEm5DiasUteis ? "warn" : undefined} />
      </div>

      <Cartao
        titulo="Plano de ação"
        nota="O que foi combinado, com responsável do time e prazo"
        acao={
          <div className="flex items-center gap-2">
            <BotaoCopiar
              montar={() =>
                paraTsv(
                  ["Ação", "Referência", "Responsável", "Prazo", "Status", "Criada por"],
                  visiveis.map((a) => [a.titulo, [a.codpro != null ? `PS ${a.codpro}` : "", a.cliente ?? "", a.alvoNome ?? ""].filter(Boolean).join(" · "), a.responsavelNome, prazoBr(a.prazo), a.statusRotulo, a.criadoPorNome])
                )
              }
            />
            <button
              type="button"
              onClick={onNova}
              className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Nova ação
            </button>
          </div>
        }
      >
        <div className="mb-4 inline-flex flex-wrap gap-0.5 rounded-md bg-surface-2 p-0.5" role="group" aria-label="Filtrar ações">
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              type="button"
              aria-pressed={filtro === f.chave}
              onClick={() => onFiltro(f.chave)}
              className={`rounded px-2.5 py-1 text-[12.5px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filtro === f.chave ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
            >
              {f.rotulo} <b className={`ml-1 font-mono text-[11px] ${filtro === f.chave ? "text-primary" : "text-muted"}`}>{contagemDoFiltro(f.chave)}</b>
            </button>
          ))}
        </div>

        {erro && <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{erro}</p>}
        {!dados && !erro && <p className="text-sm text-muted">Carregando…</p>}
        {dados && visiveis.length === 0 && (
          <Vazio>
            {filtro === "abertas" && c && c.todas === 0
              ? "Nenhuma ação ainda. Crie a primeira pelo botão “Criar ação” de um alerta, de uma proposta ou de um consultor."
              : "Nenhuma ação neste filtro."}
          </Vazio>
        )}
        {dados && visiveis.length > 0 && (
          <TabelaRolavel altura="max-h-[60vh]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th rotulo="Ação" />
                  <Th rotulo="Responsável" />
                  <Th rotulo="Prazo" />
                  <Th rotulo="Status" />
                  <Th rotulo="" />
                </tr>
              </thead>
              <tbody>
                {visiveis.map((a) => (
                  <tr key={a.id} className={`border-t border-border/60 align-top hover:bg-surface-2 ${a.status === "concluida" ? "opacity-60" : ""}`}>
                    <td className="px-2.5 py-2.5">
                      <span className="block max-w-[420px] font-medium text-foreground">{a.titulo}</span>
                      {a.observacao && <span className="mt-0.5 block max-w-[420px] text-[12px] text-muted">{a.observacao}</span>}
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted">
                        {a.codemp != null && a.codpro != null && (
                          <button type="button" onClick={() => abrirProposta(a.codemp!, a.codpro!)} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            PS {a.codpro}
                            {a.cliente ? ` · ${a.cliente}` : ""}
                          </button>
                        )}
                        {a.codforAlvo != null && (
                          <button type="button" onClick={() => abrirConsultor(a.codforAlvo!)} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {a.alvoNome ?? `Consultor ${a.codforAlvo}`}
                          </button>
                        )}
                        <span>por {a.criadoPorNome}</span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2.5 text-foreground">{a.responsavelNome}</td>
                    <td className="whitespace-nowrap px-2.5 py-2.5 font-mono tabular-nums">
                      <span className={a.atrasada ? "font-semibold text-destructive" : "text-foreground"}>{prazoBr(a.prazo)}</span>
                      {a.atrasada && <span className="mt-1 block"><Chip tom="bad">Atrasada</Chip></span>}
                    </td>
                    <td className="px-2.5 py-2.5">
                      {a.podeMudarStatus ? (
                        <SeletorStatus acao={a} ocupado={mudando === a.id} onMudar={(s) => mudarStatus(a, s)} />
                      ) : (
                        <Chip tom={a.status === "concluida" ? "ok" : "warn"}>{a.statusRotulo}</Chip>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2.5 text-right">
                      {a.podeEditar && (
                        <span className="inline-flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => onEditar(a)}
                            className="rounded-md border border-border bg-surface px-2 py-0.5 text-[12px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => setExcluindo(a)}
                            className="rounded-md border border-border bg-surface px-2 py-0.5 text-[12px] font-medium text-foreground transition hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Excluir
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabelaRolavel>
        )}
      </Cartao>

      <Modal open={excluindo != null} onClose={() => setExcluindo(null)} title="Excluir ação" subtitulo={excluindo?.titulo} fecharPorFora={false}>
        <p className="text-sm text-muted">A ação some da lista do responsável também. Fica só o registro na Auditoria.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setExcluindo(null)}
            disabled={apagando}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={excluir}
            disabled={apagando}
            className="rounded-md bg-destructive px-3 py-1.5 text-[13px] font-medium text-destructive-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {apagando ? "Excluindo…" : "Excluir"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
