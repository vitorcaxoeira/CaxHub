import axios from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "../ui/Spinner";
import { toneBadge, type Tone } from "../ui/badges";
import { IconeIntegracaoErp } from "../ui/IconeIntegracaoErp";
import { ModalLancarDespesa } from "./ModalLancarDespesa";

export interface Opcao {
  value: number | string;
  label: string;
}

export interface Rota {
  id: number;
  desrot: string;
  kmtrot: number | null;
  horrot: number | null;
}

// Exportada (junto com Opcao/Rota acima) porque ModalLancarDespesa.tsx precisa do formato
// completo pra pré-preencher o formulário de edição — este componente já busca tudo isso em
// GET /:id/despesas, então o modal recebe como prop em vez de buscar de novo.
export interface DespesaLancada {
  id: number;
  // Id que o Senior atribui a esta despesa (USU_TE777RDV.SeqRdv) — null até ele confirmar,
  // igual ao seqati de uma alocação. Mesmo princípio do "Est. {id} · Ativ. {seqati}" do
  // Cronograma: nosso id (imediato) ao lado do id de lá (só depois de sincronizar).
  seqrdv: number | null;
  datemi: string | null;
  desrdv: string | null;
  tipdes: number;
  moddes: string | null;
  tipdesLabel: string;
  moddesLabel: string | null;
  qtdrdv: number | null;
  vlrunt: number | null;
  vlrtot: number | null;
  hordes: number | null;
  fatrdv: string;
  fatrdvLabel: string;
  rotid: number | null;
  pendenteDeEnvio: boolean;
  // Exclusão já enfileirada, aguardando confirmação do Senior (ver tipEve=E em
  // sync/outboxSeniorDespesa.ts) — a linha continua visível até lá, só travada.
  exclusaoPendente: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
  // Coluna "Sinc. ERP" — mesma filosofia (calcularIntegracaoErp/IconeIntegracaoErp) já usada em
  // "Sessões pendentes de confirmação" e no Cronograma: label/tom já resolvidos no servidor.
  integracaoErpLabel: string;
  integracaoErpTone: Tone;
  integracaoErpErro: string | null;
}

interface RespostaDespesas {
  // Dono da RAT ou admin (mesma regra de podeGerenciarDespesas no backend) — decide se o botão
  // "Nova Despesa" aparece. Quem não gerencia só vê "Lançamentos desta RAT" em modo leitura,
  // sem botões de editar/excluir (já vêm false por linha nesse caso).
  podeGerenciar: boolean;
  podeLancar: boolean;
  // Motivo de podeLancar=false pronto pra exibir — só preenchido quando podeGerenciar=true
  // (pra quem só visualiza, mostrar aviso de bloqueio de uma ação que nunca teve seria ruído).
  mensagemBloqueio: string | null;
  despesas: DespesaLancada[];
  rotas: Rota[];
  opcoesTipo: Opcao[];
  opcoesModalidade: Opcao[];
}

interface DespesasRatPainelProps {
  ratId: number;
}

// Mesma cadência de ENVIO_INTERVALO_MS/ENVIO_MAX_TENTATIVAS em MeusApontamentos.tsx (~19,5s de
// janela) — ver acompanharReenvio abaixo.
const REENVIO_INTERVALO_MS = 1500;
const REENVIO_MAX_TENTATIVAS = 13;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (v: number | null) => (v == null ? "—" : `R$ ${currency.format(v)}`);
const formatData = (v: string | null) => (v ? dateFormatter.format(new Date(v)) : "—");

// "falha" (destructive) e "pendente" (neutral) são os dois estados em que faz sentido clicar
// pra forçar um reenvio — "enviando" já está em voo (clicar de novo seria redundante, o
// backend recusa com 409) e "sincronizado" não tem o que reenviar.
function podeReenviarDespesa(despesa: DespesaLancada): boolean {
  return despesa.integracaoErpTone === "destructive" || despesa.integracaoErpTone === "neutral";
}

// Tooltip do ícone "Sinc. ERP" — mesmo texto/prioridade de tituloSincSessao em
// MeusApontamentos.tsx (falha explica o erro real; sincronizado confirma; o resto usa o label),
// com a dica de clique nos dois estados em que o ícone vira botão.
function tituloIntegracaoDespesa(despesa: DespesaLancada): string {
  if (despesa.integracaoErpErro) return `Falha no envio ao Senior: ${despesa.integracaoErpErro} — clique para reenviar.`;
  if (despesa.integracaoErpTone === "success") return "Já confirmada pelo Senior.";
  if (podeReenviarDespesa(despesa)) return `Integração com o Senior: ${despesa.integracaoErpLabel} — clique para reenviar.`;
  return `Integração com o Senior: ${despesa.integracaoErpLabel}`;
}

// Conteúdo da aba "RDVs" do acordeão de RATs em MeusApontamentos.tsx — extraído (07/09/2026) do
// antigo ModalDespesasRat.tsx, que abria isto num modal separado atrás do menu "⋯ > Despesas de
// Viagem". Desde 08/09/2026 é só a lista de lançamentos + o botão "Nova Despesa" — o formulário
// de lançar/editar vive num modal próprio (ModalLancarDespesa.tsx, aberto por cima desta tela em
// vez de embutido no acordeão; chegou a ser uma janela popup separada por um instante, revertido
// a pedido do Vitor — só modal mesmo).
export function DespesasRatPainel({ ratId }: DespesasRatPainelProps) {
  const [dados, setDados] = useState<RespostaDespesas | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  // Nasce aberto: a lista é o conteúdo principal da aba (sobretudo pra quem só visualiza, que
  // não tem nenhum botão de lançamento acima dela).
  const [historicoAberto, setHistoricoAberto] = useState(true);
  // Modal de lançar/editar aberto — `null` fechado; `{ despesa: null }` = modo "nova despesa";
  // `{ despesa }` = editando aquela despesa. Fica aqui (não dentro do modal) porque decide
  // TAMBÉM o `key` do modal abaixo, forçando ele a remontar do zero a cada abertura — sem isso
  // o formulário de uma edição anterior vazaria pra próxima.
  const [modalDespesa, setModalDespesa] = useState<{ despesa: DespesaLancada | null } | null>(null);
  // Id da despesa cujo reenvio está em voo — só trava o ícone clicado (ver reenviar abaixo).
  const [reenviandoId, setReenviandoId] = useState<number | null>(null);
  // Timers do acompanhamento de reenvio (ver acompanharReenvio), cancelados ao desmontar pra
  // não bater no endpoint depois que a aba RDVs (ou a linha da RAT) já saiu de tela — mesmo
  // padrão de timersEnvioRef em MeusApontamentos.tsx.
  const timersReenvioRef = useRef<number[]>([]);
  useEffect(() => {
    const timers = timersReenvioRef;
    return () => timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  // Retorna os dados recém-buscados (não só grava em `dados`) — o polling de
  // acompanharReenvio abaixo precisa inspecionar o resultado de CADA busca pra saber se já
  // pode parar de perguntar.
  async function carregar(mostrarLoading = true): Promise<RespostaDespesas | null> {
    if (mostrarLoading) setLoading(true);
    try {
      const { data } = await axios.get(`/api/rats/${ratId}/despesas`);
      setDados(data);
      setErro(null);
      return data;
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao carregar despesas");
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratId]);

  const totalLancado = useMemo(() => dados?.despesas.reduce((total, despesa) => total + (despesa.vlrtot ?? 0), 0) ?? 0, [dados]);
  const pendentesDeEnvio = dados?.despesas.filter((despesa) => despesa.pendenteDeEnvio).length ?? 0;

  // Aba de verdade (não popup pequeno como o modal de lançar) — o relatório precisa de espaço
  // pra revisar antes de imprimir. Nome de janela fixo por RAT: clicar de novo reaproveita a
  // mesma aba em vez de abrir várias.
  function abrirRelatorio() {
    window.open(`/projetos/rats/${ratId}/despesas/relatorio`, `relatorio-despesas-${ratId}`);
  }

  async function excluir(despesaId: number) {
    if (!window.confirm("Excluir esta despesa? Se ela já tiver sido enviada ao Senior, a exclusão fica pendente até ele confirmar.")) return;
    setErro(null);
    setSucesso(null);
    try {
      const { data } = await axios.delete(`/api/rats/despesas/${despesaId}`);
      setSucesso(data?.pendente ? "Exclusão enviada — aguardando confirmação do Senior." : "Despesa excluída.");
      carregar(false);
      // Mesmo motivo de criar/editar: a exclusão também roda em segundo plano no servidor —
      // sem acompanhar, o ícone "Sinc. ERP" ficava preso em "enviando" pra sempre. Quando o
      // Senior confirma, a despesa recebe `excluidaEm` e some da lista (GET /:id/despesas já
      // filtra por isso) — acompanharReenvio já trata "despesa sumiu da lista" como concluído.
      // Se `data.pendente` for false (nunca chegou a ir pro Senior, já apagada na hora), a
      // primeira checagem já resolve sozinha, sem custo extra.
      acompanharReenvio(despesaId);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao excluir a despesa");
    }
  }

  // O reenvio roda em segundo plano no servidor — o POST responde (202) antes do SOAP com o
  // Senior terminar, então um único `carregar(false)` logo depois quase sempre pega a
  // pendência ainda "enviando" (o ícone continuaria mostrando o estado antigo, falha/pendente,
  // apesar da mensagem de sucesso). Isto aqui fecha o ciclo: pergunta de tempos em tempos como
  // ficou e só solta o spinner do ícone quando o Senior já respondeu de verdade — sucesso, ou
  // falha já com um erro pra mostrar. Mesmo padrão de acompanharEnvio em MeusApontamentos.tsx.
  function acompanharReenvio(despesaId: number, tentativa = 0) {
    const timer = window.setTimeout(async () => {
      const data = await carregar(false);
      const despesa = data?.despesas.find((d) => d.id === despesaId);
      // Sumiu da lista (ex.: exclusão concluída nesse meio-tempo) também conta como concluído
      // — não há mais o que acompanhar.
      const concluido =
        despesa == null ||
        despesa.integracaoErpTone === "success" ||
        (despesa.integracaoErpTone === "destructive" && despesa.integracaoErpErro != null);
      if (concluido) {
        setReenviandoId(null);
        return;
      }
      if (tentativa + 1 < REENVIO_MAX_TENTATIVAS) {
        acompanharReenvio(despesaId, tentativa + 1);
      } else {
        // Estourou o tempo sem desfecho — solta o ícone (volta a mostrar o estado real,
        // ainda pendente/enviando) e deixa o cron de 15 min assumir.
        setReenviandoId(null);
      }
    }, REENVIO_INTERVALO_MS);
    timersReenvioRef.current.push(timer);
  }

  // Reenvio manual — clique no ícone "Sinc. ERP" quando o estado é falha/pendente
  // (ver podeReenviarDespesa). `reenviandoId` trava o ícone clicado (spinner) até
  // acompanharReenvio acima confirmar o desfecho, não só até o POST inicial responder.
  async function reenviar(despesaId: number) {
    setErro(null);
    setSucesso(null);
    setReenviandoId(despesaId);
    try {
      await axios.post(`/api/rats/despesas/${despesaId}/reenviar`);
      // Sem mensagem de sucesso aqui — o próprio ícone (spinner até acompanharReenvio
      // confirmar o desfecho) já avisa que está sincronizando, sem precisar de um banner.
      acompanharReenvio(despesaId);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao reenviar ao Senior");
      setReenviandoId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return (
    // `-mt-4` compensa o `mb-6` (24px) que o componente Tabs (compartilhado com outras 3 telas,
    // não dá pra encolher só aqui) deixa acima deste painel — sem isso o vão de cima ficava o
    // dobro do de baixo. `space-y-2` (8px) é a metade do `space-y-4` (16px) de antes, pro vão
    // abaixo do botão "Nova Despesa" ficar igual ao de cima (24px de Tabs - 16px do -mt-4 = 8px).
    <div className="-mt-4 space-y-2 pb-2">
      {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
      {sucesso && <p role="status" className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">{sucesso}</p>}

      {dados && (
        <>
          {/* "Imprimir" fica FORA do bloco `podeGerenciar` — é leitura, não gerenciamento;
              qualquer um que vê a RAT (regra que já controla a montagem deste componente
              inteiro) também vê este botão. "Nova Despesa" continua exigindo podeGerenciar. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {dados.podeGerenciar && !dados.podeLancar && dados.mensagemBloqueio && (
              <p className="text-xs text-warning">{dados.mensagemBloqueio}</p>
            )}
            <button
              type="button"
              onClick={abrirRelatorio}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Imprimir
            </button>
            {dados.podeGerenciar && (
              <button
                type="button"
                onClick={() => setModalDespesa({ despesa: null })}
                disabled={!dados.podeLancar}
                title={!dados.podeLancar ? dados.mensagemBloqueio ?? undefined : undefined}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Nova Despesa
              </button>
            )}
          </div>

          <section className="overflow-hidden rounded-lg border border-border bg-surface">
            <button
              type="button"
              onClick={() => setHistoricoAberto((aberto) => !aberto)}
              aria-expanded={historicoAberto}
              aria-controls={`historico-despesas-rat-${ratId}`}
              className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
            >
              <span>
                <span className="block text-sm font-semibold text-foreground">Lançamentos desta RAT</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {dados.despesas.length === 0 ? "Nenhuma despesa lançada" : `${dados.despesas.length} ${dados.despesas.length === 1 ? "lançamento" : "lançamentos"}`} · {formatMoney(totalLancado)}
                  {pendentesDeEnvio > 0 && ` · ${pendentesDeEnvio} pendente${pendentesDeEnvio === 1 ? "" : "s"} de envio`}
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium text-primary">{historicoAberto ? "Ocultar" : "Ver lançamentos"}</span>
            </button>

            {historicoAberto && (
              <div id={`historico-despesas-rat-${ratId}`} className="border-t border-border">
                {dados.despesas.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted sm:px-4">Os lançamentos realizados aqui aparecerão neste histórico.</p>
                ) : (
                  <>
                    <div className="hidden overflow-x-auto sm:block">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            {/* Id local (RegistroDespesaViagem.id), não o seqrdv do Senior — mesmo espírito de
                                "Est. {id}" no Cronograma (DrawerAtividade.tsx): a alça pra falar desta linha
                                aqui dentro, antes/independente dela existir do lado de lá. Espaçamento (py-1.5
                                pr-3, sem fundo) igual ao da tabela de Atividades logo acima, na mesma aba. */}
                            <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">ID</th>
                            <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Seqrdv</th>
                            <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Data</th>
                            <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Tipo</th>
                            <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Descrição</th>
                            <th className="py-1.5 pr-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Quantidade</th>
                            <th className="py-1.5 pr-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Valor Unit.</th>
                            <th className="py-1.5 pr-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Total</th>
                            <th className="py-1.5 pr-3 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Sinc. ERP</th>
                            <th className="py-1.5" />
                          </tr>
                        </thead>
                        <tbody>
                          {dados.despesas.map((despesa) => (
                            <tr key={despesa.id} className="border-t border-border/40">
                              <td className="py-1.5 pr-3 font-mono text-[12.5px] tabular-nums text-muted">{despesa.id}</td>
                              <td className="py-1.5 pr-3 font-mono text-[12.5px] tabular-nums text-muted">{despesa.seqrdv ?? "—"}</td>
                              <td className="py-1.5 pr-3 font-mono text-[12.5px] tabular-nums text-muted">{formatData(despesa.datemi)}</td>
                              <td className="py-1.5 pr-3 text-[12.5px] text-muted">
                                {despesa.tipdesLabel}
                                {despesa.moddesLabel && <span className="text-muted/70"> · {despesa.moddesLabel}</span>}
                              </td>
                              <td className="max-w-[260px] py-1.5 pr-3 text-[12.5px] text-foreground">
                                <p className="truncate" title={despesa.desrdv ?? undefined}>{despesa.desrdv ?? "—"}</p>
                                {despesa.pendenteDeEnvio && <span className="mt-1 inline-block rounded-full bg-warning/15 px-1.5 py-0.5 text-[9.5px] font-medium text-warning">Pendente de envio</span>}
                                {despesa.exclusaoPendente && <span className="mt-1 inline-block rounded-full bg-destructive/15 px-1.5 py-0.5 text-[9.5px] font-medium text-destructive">Exclusão pendente</span>}
                              </td>
                              <td className="py-1.5 pr-3 text-right font-mono text-[12.5px] tabular-nums text-foreground">{despesa.qtdrdv ?? "—"}</td>
                              <td className="py-1.5 pr-3 text-right font-mono text-[12.5px] tabular-nums text-foreground">{formatMoney(despesa.vlrunt)}</td>
                              <td className="py-1.5 pr-3 text-right font-mono text-[12.5px] tabular-nums text-foreground">{formatMoney(despesa.vlrtot)}</td>
                              <td className="py-1.5 pr-3 text-center">
                                {podeReenviarDespesa(despesa) ? (
                                  <button
                                    type="button"
                                    onClick={() => void reenviar(despesa.id)}
                                    disabled={reenviandoId === despesa.id}
                                    title={tituloIntegracaoDespesa(despesa)}
                                    className={`inline-flex h-4 w-4 items-center justify-center rounded-full transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${toneBadge[despesa.integracaoErpTone]}`}
                                  >
                                    <IconeIntegracaoErp tone={reenviandoId === despesa.id ? "warning" : despesa.integracaoErpTone} />
                                  </button>
                                ) : (
                                  <span
                                    className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${toneBadge[despesa.integracaoErpTone]}`}
                                    title={tituloIntegracaoDespesa(despesa)}
                                  >
                                    <IconeIntegracaoErp tone={despesa.integracaoErpTone} />
                                  </span>
                                )}
                              </td>
                              <td className="py-1.5 text-right">
                                <div className="flex justify-end gap-3">
                                  {despesa.podeEditar && (
                                    <button type="button" onClick={() => setModalDespesa({ despesa })} className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                      Editar
                                    </button>
                                  )}
                                  {despesa.podeExcluir && (
                                    <button type="button" onClick={() => void excluir(despesa.id)} className="text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                      Excluir
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="divide-y divide-border sm:hidden">
                      {dados.despesas.map((despesa) => (
                        <article key={despesa.id} className="space-y-2 px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">{despesa.desrdv ?? "Sem descrição"}</p>
                              <p className="mt-0.5 text-xs text-muted">{despesa.tipdesLabel}{despesa.moddesLabel ? ` · ${despesa.moddesLabel}` : ""}</p>
                            </div>
                            <span className="whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-foreground">{formatMoney(despesa.vlrtot)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-xs text-muted">
                            <span>{formatData(despesa.datemi)}</span>
                            <span>{despesa.fatrdvLabel === "Sim" ? "Fatura cliente" : "Não fatura cliente"}</span>
                          </div>
                          {(despesa.pendenteDeEnvio || despesa.exclusaoPendente || despesa.podeEditar || despesa.podeExcluir) && (
                            <div className="flex items-center justify-between gap-3">
                              <span className="space-x-1">
                                {despesa.pendenteDeEnvio && <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[9.5px] font-medium text-warning">Pendente de envio</span>}
                                {despesa.exclusaoPendente && <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[9.5px] font-medium text-destructive">Exclusão pendente</span>}
                              </span>
                              <span className="flex shrink-0 gap-3">
                                {despesa.podeEditar && (
                                  <button type="button" onClick={() => setModalDespesa({ despesa })} className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    Editar
                                  </button>
                                )}
                                {despesa.podeExcluir && (
                                  <button type="button" onClick={() => void excluir(despesa.id)} className="text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    Excluir
                                  </button>
                                )}
                              </span>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </section>

          {modalDespesa && dados && (
            <ModalLancarDespesa
              key={modalDespesa.despesa?.id ?? "nova"}
              ratId={ratId}
              rotas={dados.rotas}
              opcoesTipo={dados.opcoesTipo}
              opcoesModalidade={dados.opcoesModalidade}
              despesaEmEdicao={modalDespesa.despesa}
              onFechar={() => setModalDespesa(null)}
              onSalvo={(despesaId) => {
                carregar(false);
                // O envio/reenvio ao Senior roda em segundo plano — sem isso, o primeiro
                // refresh (quase sempre) pega o ícone "enviando" e ele nunca mais atualiza
                // sozinho. Mesmo acompanhamento do reenvio manual, ver acompanharReenvio.
                acompanharReenvio(despesaId);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
