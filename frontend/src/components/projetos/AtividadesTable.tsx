import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar } from "../ui/Avatar";
import { Pagination } from "../ui/Pagination";
import { Skeleton } from "../ui/Skeleton";
import { IconePlay, IconeStop } from "../ui/iconesExecucao";
import { Spinner } from "../ui/Spinner";
import { IndicadorProgresso } from "../cronograma/IndicadorProgresso";
import { formatHorasCompacto } from "../../lib/cronograma";
import { tomConsumo } from "../../lib/consumoHoras";
import { useCronometro } from "../../hooks/useCronometro";
import {
  EXIBIR_AMBOS_BOTOES,
  RAIA_EM_ANDAMENTO,
  motivoIniciarDesabilitado,
  motivoPararDesabilitado,
  podeIniciar,
  podeParar,
} from "../../lib/atividade-acoes";
import { AtividadeKanban, ColunaKanban, DetalheInfo } from "./KanbanBoard";
import { AtividadesFiltros } from "./AtividadesFiltros";
import type { SituacaoKpi } from "./IndicadoresProjetos";

// Mesmo array que alimenta o Kanban/Calendário/Timeline (GET /api/atividades) — o tipo
// de linha da tabela é o mesmo, não uma projeção separada.
export type AtividadeRow = AtividadeKanban;

interface OpcaoFiltro {
  value: number;
  label: string;
}

export interface FiltrosAtividades {
  busca: string;
  depexe: string;
  colunaId: string;
  pripro: string;
  codfor: string;
  atrasada: boolean;
}

// Um accordion = uma proposta trabalhada por um consultor. Proposta sozinha daria grupos
// maiores (176 contra 361 aqui), mas foi decisão do usuário separar por consultor: é assim
// que ele acompanha o consumo, já que o previsto é alocado por pessoa.
interface GrupoAtividades {
  chave: string;
  codemp: number;
  codpro: number;
  cliente: string;
  consultorNome: string;
  consultorFotoUrl: string | null;
  atividades: AtividadeRow[];
  previsto: number;
  realizado: number;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

const PAGE_SIZE = 25;

const TH_CLASS = "bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted";
const TH_SUB_CLASS = "py-[3px] pr-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted";

// Agrupa por codemp+codpro+codfor e soma as horas. `codemp` entra na chave porque codpro
// só é único dentro da empresa. Previsto nulo conta como zero — é atividade sem
// planejamento, não atividade de zero hora prevista, mas para a soma dá no mesmo.
//
// `previsto` aqui é o TETO (alocado + excedente autorizado): é contra ele que o
// apontamento é barrado, então é ele que a barra e o percentual têm que medir.
function agrupar(rows: AtividadeRow[]): GrupoAtividades[] {
  const mapa = new Map<string, GrupoAtividades>();
  for (const row of rows) {
    const chave = `${row.codemp}-${row.codpro}-${row.codfor}`;
    let grupo = mapa.get(chave);
    if (!grupo) {
      grupo = {
        chave,
        codemp: row.codemp,
        codpro: row.codpro,
        cliente: row.cliente,
        consultorNome: row.consultorNome,
        consultorFotoUrl: row.consultorFotoUrl,
        atividades: [],
        previsto: 0,
        realizado: 0,
      };
      mapa.set(chave, grupo);
    }
    grupo.atividades.push(row);
    grupo.previsto += (row.qtdhorPrevisto ?? 0) + row.horasExcedentes;
    grupo.realizado += row.horasRealizadas ?? 0;
  }
  // Proposta mais recente primeiro. Cheguei a ordenar por maior consumo, que parecia mais
  // útil, mas o percentual é ilimitado e a base tem previsto irrisório em proposta antiga:
  // a primeira página virava 25 grupos entre 700% e 145.000% (uma delas com 1455h
  // realizadas contra 1h prevista), e o trabalho do dia caía lá pra página 8. Ordem por
  // codpro é previsível e é como o usuário se refere às propostas.
  return [...mapa.values()].sort((a, b) => b.codpro - a.codpro || a.consultorNome.localeCompare(b.consultorNome, "pt-BR"));
}

interface AtividadesTableProps {
  rows: AtividadeRow[];
  total: number;
  page: number;
  loading: boolean;
  colunas: ColunaKanban[];
  departamentos: OpcaoFiltro[];
  prioridades: OpcaoFiltro[];
  consultores: OpcaoFiltro[];
  filtros: FiltrosAtividades;
  situacaoKpi: SituacaoKpi | null;
  onFiltros: (patch: Partial<FiltrosAtividades>) => void;
  onPageChange: (page: number) => void;
  onLimparKpi: () => void;
  onMover: (atividadeId: number, novaColunaId: number) => void;
  onAbrirDetalhe: (atividadeId: number, info: DetalheInfo) => void;
  onIniciar: (atividadeId: number) => void;
  onParar: (atividadeId: number) => void;
  processando: Set<number>;
}

function IndicadorSessao({ row }: { row: AtividadeRow }) {
  const emAndamento = row.coluna?.nome === RAIA_EM_ANDAMENTO;
  const { texto: cronometro, atingiuLimite } = useCronometro(row.sessaoAtualInicio, row.sessaoLimite);
  if (!emAndamento) return null;
  return (
    <span className="ml-1.5 inline-flex items-center gap-1.5 align-middle">
      <span className="relative flex h-2 w-2 flex-none">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      {cronometro && (
        <span
          className={`font-mono text-[10.5px] tabular-nums ${atingiuLimite ? "font-semibold text-destructive" : "text-success"}`}
          title={atingiuLimite ? "Limite atingido — a execução está sendo encerrada" : undefined}
        >
          {cronometro}
        </span>
      )}
    </span>
  );
}

// Realizado / previsto com o percentual colorido pela escala compartilhada com o card do
// Quadro. Sem previsto não há proporção: mostra só o realizado e omite o percentual —
// mesma regra do KanbanBoard.
function ConsumoHoras({ realizado, previsto }: { realizado: number; previsto: number }) {
  const temPrevisto = previsto > 0;
  const avanco = temPrevisto ? realizado / previsto : 0;
  const tom = tomConsumo(avanco);
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap font-mono text-[12px] tabular-nums text-muted">
      <span>
        {formatHorasCompacto(realizado)}
        {temPrevisto && ` / ${formatHorasCompacto(previsto)}`}
      </span>
      {temPrevisto && <span className={tom.texto}>{Math.round(avanco * 100)}%</span>}
    </span>
  );
}

// Componente controlado: filtros, paginação e dados vêm da página (Atividades.tsx),
// que também alimenta o Kanban/Calendário/Timeline com o mesmo recorte — isso permite
// que um KPI clicado filtre tanto a lista quanto o quadro.
export function AtividadesTable({
  rows,
  total,
  page,
  loading,
  colunas,
  departamentos,
  prioridades,
  consultores,
  filtros,
  situacaoKpi,
  onFiltros,
  onPageChange,
  onLimparKpi,
  onMover,
  onAbrirDetalhe,
  onIniciar,
  onParar,
  processando,
}: AtividadesTableProps) {
  const navigate = useNavigate();
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const grupos = useMemo(() => agrupar(rows), [rows]);
  // Paginação por GRUPO, client-side. Paginar por atividade no servidor partiria um grupo
  // ao meio entre duas páginas — por isso Atividades.tsx parou de mandar page/pageSize.
  const gruposPagina = useMemo(() => grupos.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [grupos, page]);

  function alternar(chave: string) {
    setExpandidos((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(chave)) proximo.add(chave);
      return proximo;
    });
  }

  return (
    <div>
      <AtividadesFiltros
        colunas={colunas}
        departamentos={departamentos}
        prioridades={prioridades}
        consultores={consultores}
        filtros={filtros}
        situacaoKpi={situacaoKpi}
        onFiltros={onFiltros}
        onLimparKpi={onLimparKpi}
      />

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          {/* table-fixed + colgroup, e não larguras nas células: com largura declarada na
              própria célula o browser concilia width/max-width de um jeito imprevisível
              (já colapsou uma coluna inteira em ListarPedidos). Só a primeira coluna fica
              sem largura, então é ela que recebe toda a sobra — é o que faz o nome do
              cliente correr até o consultor sem cortar. */}
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col />
              <col className="w-[15rem]" />
              <col className="w-[7rem]" />
              <col className="w-[11rem]" />
            </colgroup>
            <thead>
              <tr>
                <th className={TH_CLASS}>Proposta · Cliente</th>
                <th className={TH_CLASS}>Consultor</th>
                <th className={`${TH_CLASS} whitespace-nowrap text-right`}>Atividades</th>
                <th className={`${TH_CLASS} whitespace-nowrap text-right`}>Realizado / Previsto</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-2.5 py-1.5">
                      <Skeleton className="h-4 w-72" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <Skeleton className="h-4 w-32" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <Skeleton className="ml-auto h-4 w-12" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <Skeleton className="ml-auto h-4 w-28" />
                    </td>
                  </tr>
                ))}

              {!loading &&
                gruposPagina.map((grupo) => {
                  const aberto = expandidos.has(grupo.chave);
                  const temPrevisto = grupo.previsto > 0;
                  const avanco = temPrevisto ? grupo.realizado / grupo.previsto : 0;
                  const tom = tomConsumo(avanco);
                  return (
                    <Fragment key={grupo.chave}>
                      <tr
                        onClick={() => alternar(grupo.chave)}
                        className={`cursor-pointer transition ${
                          aberto ? "border-t border-primary bg-primary/5" : "border-t border-border/60 hover:bg-surface-2"
                        }`}
                      >
                        <td className={`px-2.5 pb-0.5 pt-1.5 ${aberto ? "border-l border-primary" : ""}`}>
                          <div className="flex items-center gap-2 whitespace-nowrap text-sm">
                            <span className="shrink-0 text-muted">{aberto ? "▾" : "▸"}</span>
                            {/* stopPropagation: a linha inteira é o toggle — sem isso, ir
                                pra proposta também abriria/fecharia o grupo. */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/projetos/proposta/${grupo.codemp}/${grupo.codpro}`);
                              }}
                              className="shrink-0 font-semibold text-primary hover:underline"
                            >
                              {grupo.codpro}
                            </button>
                            <span className="shrink-0 text-muted">·</span>
                            {/* min-w-0 é o que deixa o truncate agir dentro do flex; sem
                                ele o nome estoura a célula em vez de cortar. */}
                            <span className="min-w-0 truncate text-foreground" title={grupo.cliente}>
                              {grupo.cliente}
                            </span>
                          </div>
                        </td>
                        <td className="px-2.5 pb-0.5 pt-1.5 text-sm text-muted">
                          <span className="flex items-center gap-1.5 whitespace-nowrap" title={grupo.consultorNome}>
                            <Avatar nome={grupo.consultorNome} fotoUrl={grupo.consultorFotoUrl} size="xs" />
                            <span className="min-w-0 truncate">{grupo.consultorNome}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-2.5 pb-0.5 pt-1.5 text-right font-mono text-[12px] tabular-nums text-muted">
                          {grupo.atividades.length}
                        </td>
                        <td className={`whitespace-nowrap px-2.5 pb-0.5 pt-1.5 text-right ${aberto ? "border-r border-primary" : ""}`}>
                          <ConsumoHoras realizado={grupo.realizado} previsto={grupo.previsto} />
                        </td>
                      </tr>
                      {/* Barra numa linha própria pra ocupar a largura inteira do grupo em
                          vez de ficar presa a uma célula. Sem previsto ela some — não há
                          proporção pra desenhar. */}
                      <tr
                        onClick={() => alternar(grupo.chave)}
                        className={`cursor-pointer ${aberto ? "bg-primary/5" : "hover:bg-surface-2"}`}
                      >
                        <td
                          colSpan={4}
                          className={`px-2.5 pb-1.5 ${aberto ? "border-l border-r border-primary" : ""}`}
                        >
                          {temPrevisto && <IndicadorProgresso avanco={avanco} cor={tom.barra} alturaPx={4} />}
                        </td>
                      </tr>

                      {aberto && (
                        <tr className="bg-surface-2/40">
                          <td colSpan={4} className="border-b border-l border-r border-primary px-2.5 py-2">
                            <div className="overflow-x-auto">
                              {/* Mesma técnica da tabela de fora: só a Descrição fica sem
                                  largura, então é ela que fica com toda a sobra e as
                                  quatro colunas seguintes se agrupam à direita — Horas e
                                  Fim previsto encostadas na Situação, e a Situação
                                  encostada no Iniciar. */}
                              <table className="w-full table-fixed border-collapse">
                                <colgroup>
                                  <col />
                                  <col className="w-[10rem]" />
                                  <col className="w-[6.5rem]" />
                                  <col className="w-[8.5rem]" />
                                  <col className="w-[14rem]" />
                                </colgroup>
                                <thead>
                                  <tr>
                                    <th className={TH_SUB_CLASS}>Descrição</th>
                                    <th className={`${TH_SUB_CLASS} whitespace-nowrap text-right`}>Horas</th>
                                    <th className={`${TH_SUB_CLASS} whitespace-nowrap`}>Fim previsto</th>
                                    <th className={`${TH_SUB_CLASS} text-right`}>Situação</th>
                                    <th className={TH_SUB_CLASS} />
                                  </tr>
                                </thead>
                                <tbody>
                                  {grupo.atividades.map((row) => (
                                    <tr key={row.id} className="border-t border-border/60">
                                      {/* Truncate obrigatório, não cosmético: algumas
                                          descrições trazem o escopo inteiro da proposta,
                                          com vários parágrafos. O cronômetro da sessão em
                                          andamento vem pra cá porque a coluna Consultor,
                                          onde ele morava, virou cabeçalho do grupo. */}
                                      <td className="py-1.5 pr-2 text-sm text-foreground">
                                        <div className="flex items-center">
                                          <span className="min-w-0 truncate" title={row.itemDescricao ?? undefined}>
                                            {row.itemDescricao ?? "—"}
                                          </span>
                                          <IndicadorSessao row={row} />
                                        </div>
                                      </td>
                                      <td className="whitespace-nowrap py-1.5 pr-2 text-right">
                                        <ConsumoHoras realizado={row.horasRealizadas} previsto={(row.qtdhorPrevisto ?? 0) + row.horasExcedentes} />
                                      </td>
                                      {/* Atraso comunicado só pela cor — o "· Atrasado"
                                          repetia em texto o que o vermelho já diz. */}
                                      <td className="whitespace-nowrap py-1.5 pr-2 font-mono text-[12px]">
                                        <span
                                          className={row.atrasada ? "font-semibold text-destructive" : "text-muted"}
                                          title={row.atrasada ? "Fim previsto vencido" : undefined}
                                        >
                                          {row.dataPrevistaFim ? dateFormatter.format(new Date(row.dataPrevistaFim)) : "—"}
                                        </span>
                                      </td>
                                      <td className="py-1.5 pr-2 text-right">
                                        <select
                                          value={row.colunaId ?? ""}
                                          disabled={!row.podeMover}
                                          onChange={(e) => onMover(row.id, Number(e.target.value))}
                                          className="rounded-md border border-border bg-surface px-2 py-0.5 text-[12px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          {colunas.map((c) => (
                                            <option key={c.id} value={c.id}>
                                              {c.nome}
                                            </option>
                                          ))}
                                        </select>
                                      </td>
                                      <td className="py-1.5">
                                        <div className="flex items-center justify-end gap-2">
                                          {(EXIBIR_AMBOS_BOTOES || podeIniciar(row)) && (
                                            <button
                                              onClick={() => onIniciar(row.id)}
                                              disabled={!podeIniciar(row) || processando.has(row.id)}
                                              title={motivoIniciarDesabilitado(row)}
                                              className="flex items-center gap-1 rounded border border-primary/40 px-2 py-0.5 text-[11.5px] font-medium text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none"
                                            >
                                              {processando.has(row.id) ? <Spinner className="h-3 w-3" /> : <IconePlay />}
                                              Iniciar
                                            </button>
                                          )}
                                          {(EXIBIR_AMBOS_BOTOES || podeParar(row)) && (
                                            <button
                                              onClick={() => onParar(row.id)}
                                              disabled={!podeParar(row) || processando.has(row.id)}
                                              title={motivoPararDesabilitado(row)}
                                              className="flex items-center gap-1 rounded border border-destructive/40 px-2 py-0.5 text-[11.5px] font-medium text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none"
                                            >
                                              {processando.has(row.id) ? <Spinner className="h-3 w-3" /> : <IconeStop />}
                                              Parar
                                            </button>
                                          )}
                                          <button
                                            onClick={() =>
                                              onAbrirDetalhe(row.id, {
                                                titulo: `Proposta ${row.codpro} · Projeto ${row.numprj}`,
                                                podeEditar: row.podeEditar,
                                                dataPrevistaInicio: row.dataPrevistaInicio,
                                                dataPrevistaFim: row.dataPrevistaFim,
                                                codemp: row.codemp,
                                                codpro: row.codpro,
                                                seqite: row.seqite,
                                                itemDescricao: row.itemDescricao,
                                                itemQtdhor: row.itemQtdhor,
                                                itemAlocado: row.itemAlocado,
                                                itemRealizado: row.itemRealizado,
                                                estruturaNome: row.estruturaNome,
                                                horasRealizadas: row.horasRealizadas,
                                                estruturaPercentual: row.estruturaPercentual,
                                                podeVerCronograma: row.podeVerCronograma,
                                                qtdhorPrevisto: row.qtdhorPrevisto,
                                                horasExcedentes: row.horasExcedentes,
                                                podeAutorizarExcedente: row.podeAutorizarExcedente,
                                              })
                                            }
                                            className="text-sm text-primary hover:underline"
                                          >
                                            Detalhes
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}

              {grupos.length === 0 && !loading && (
                <tr>
                  <td colSpan={4} className="px-2.5 py-6 text-center text-sm text-muted">
                    Nenhuma atividade encontrada com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Total em GRUPOS, não em atividades: é o que a paginação fatia. A contagem de
            atividades (`total`) vira o complemento do rótulo, pra não sumir da tela. */}
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={grupos.length}
          loading={loading}
          onPageChange={onPageChange}
          label={`grupos · ${total} atividade${total === 1 ? "" : "s"}`}
        />
      </div>
    </div>
  );
}
