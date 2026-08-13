import axios from "axios";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Tabs } from "../../components/ui/Tabs";
import { HistoricoContextual } from "../../components/auditoria/HistoricoContextual";
import { Skeleton } from "../../components/ui/Skeleton";
import { toneBadge, type Tone } from "../../components/ui/badges";

interface RatDetalhe {
  id: number;
  codemp: number;
  numrat: number | null;
  numprj: number | null;
  cliente: string | null;
  codpro: number | null;
  propostaSitproLabel: string | null;
  propostaSitproTone: Tone | null;
  consultorNome: string;
  datemi: string | null;
  dataApr: string | null;
  sitratLabel: string;
  sitratTone: Tone;
  obsrat: string | null;
  origemCaxHub: boolean;
}

interface ItemDetalhe {
  id: number;
  codser: string | null;
  itemDescricao: string | null;
  datati: string | null;
  horini: number | null;
  horfim: number | null;
  duracaoMinutos: number | null;
  desati: string | null;
  confirmadoNoSenior: boolean;
}

interface DespesaViagemDetalhe {
  id: number;
  datemi: string | null;
  desrdv: string | null;
  tipdesLabel: string;
  moddesLabel: string | null;
  qtdrdv: number | null;
  vlrunt: number | null;
  vlrtot: number | null;
  fatrdvLabel: string;
  pendenteDeEnvio: boolean;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const currencyFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (v: number | null) => (v == null ? "—" : `R$ ${currencyFormatter.format(v)}`);

function formatData(valor: string | null): string {
  if (!valor) return "—";
  return dateFormatter.format(new Date(valor));
}

// Minutos desde meia-noite (mesmo formato de RatItem.horini/horfim) -> "HH:MM".
function formatHora(minutos: number | null): string {
  if (minutos == null) return "—";
  const h = Math.trunc(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDuracao(minutos: number | null): string {
  if (minutos == null) return "—";
  const h = Math.trunc(minutos / 60);
  const m = minutos % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function Campo({ label, valor }: { label: string; valor: string | null | undefined }) {
  return (
    <div>
      <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 text-sm text-foreground">{valor && valor !== "" ? valor : "—"}</p>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h2 className="mb-4 font-mono text-[10.5px] font-semibold uppercase tracking-widest text-muted">{titulo}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
    </div>
  );
}

// Tela de visualização somente-leitura de uma RAT — mesmo padrão de
// PropostaVisualizacao.tsx, com tabela de itens (apontamentos, IAT) no lugar dos itens
// de proposta. Aberta a partir de qualquer lugar do CaxHub que já mostra uma RAT vinculada
// (hoje: Mercado > Listar Pedidos), identificada pelo id local (PK de Rat), não pelo
// numrat do Senior (que pode ser nulo até a RAT ser confirmada).
export function RatVisualizacao() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [rat, setRat] = useState<RatDetalhe | null>(null);
  const [itens, setItens] = useState<ItemDetalhe[]>([]);
  const [despesasViagem, setDespesasViagem] = useState<DespesaViagemDetalhe[]>([]);
  const [totalDespesasViagem, setTotalDespesasViagem] = useState(0);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<"detalhes" | "auditoria">("detalhes");

  useEffect(() => {
    setLoading(true);
    axios
      .get(`/api/rat-visualizacao/${id}`)
      .then(({ data }) => {
        setRat(data.rat);
        setItens(data.itens);
        setDespesasViagem(data.despesasViagem ?? []);
        setTotalDespesasViagem(data.totalDespesasViagem ?? 0);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar a RAT"))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div>
      <button onClick={() => navigate(-1)} className="text-sm text-primary hover:underline">
        ← Voltar
      </button>

      {loading && <p className="mt-4 text-sm text-muted">Carregando RAT...</p>}

      {erro && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {rat && (
        <>
          <div className="mb-6 mt-3">
            <p className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold text-foreground">
              RAT {rat.numrat ?? `#${rat.id} (sem número)`}
              {rat.numprj != null && ` · Projeto ${rat.numprj}`}
              <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-medium ${toneBadge[rat.sitratTone]}`}>
                {rat.sitratLabel}
              </span>
            </p>
            <p className="mt-1 text-sm text-muted">{rat.cliente ?? "—"}</p>
          </div>

          <Tabs
            tabs={[
              { key: "detalhes", label: "Detalhes" },
              { key: "auditoria", label: "Auditoria" },
            ]}
            activeKey={aba}
            onChange={(key) => setAba(key as "detalhes" | "auditoria")}
          />

          {aba === "auditoria" && (
            <div className="rounded-lg border border-border bg-surface p-5">
              <HistoricoContextual entidadeTipo="rat" entidadeId={String(rat.id)} />
            </div>
          )}
        </>
      )}

      {(loading || rat) && aba === "detalhes" && (
        <div className="space-y-4">
          {rat && (
            <>
              <Secao titulo="Vínculo">
                <Campo label="Consultor" valor={rat.consultorNome} />
                <div>
                  <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Proposta</p>
                  {rat.codpro != null ? (
                    <p className="mt-0.5 flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/projetos/proposta/${rat.codemp}/${rat.codpro}`)}
                        className="font-mono text-sm text-primary hover:underline"
                      >
                        {rat.codpro}
                      </button>
                      {rat.propostaSitproLabel != null && rat.propostaSitproTone != null && (
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge[rat.propostaSitproTone]}`}
                        >
                          {rat.propostaSitproLabel}
                        </span>
                      )}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-sm text-foreground">—</p>
                  )}
                </div>
                <Campo label="Origem" valor={rat.origemCaxHub ? "Criada no CaxHub" : "Sincronizada do Senior"} />
              </Secao>

              <Secao titulo="Datas">
                <Campo label="Emissão" valor={formatData(rat.datemi)} />
                <Campo label="Aprovação" valor={formatData(rat.dataApr)} />
              </Secao>

              {rat.obsrat && (
                <div className="rounded-lg border border-border bg-surface p-5">
                  <h2 className="mb-4 font-mono text-[10.5px] font-semibold uppercase tracking-widest text-muted">
                    Observação
                  </h2>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{rat.obsrat}</p>
                </div>
              )}
            </>
          )}

          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-mono text-[10.5px] font-semibold uppercase tracking-widest text-muted">
                Itens da RAT
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="bg-surface-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Data
                    </th>
                    <th className="bg-surface-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Serviço
                    </th>
                    <th className="bg-surface-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Descrição
                    </th>
                    <th className="bg-surface-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Horário
                    </th>
                    <th className="bg-surface-2 px-4 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Duração
                    </th>
                    <th className="bg-surface-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Confirmado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading &&
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-4 py-2.5">
                          <Skeleton className="h-4 w-20" />
                        </td>
                        <td className="px-4 py-2.5">
                          <Skeleton className="h-4 w-16" />
                        </td>
                        <td className="px-4 py-2.5">
                          <Skeleton className="h-4 w-40" />
                        </td>
                        <td className="px-4 py-2.5">
                          <Skeleton className="h-4 w-24" />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Skeleton className="ml-auto h-4 w-12" />
                        </td>
                        <td className="px-4 py-2.5">
                          <Skeleton className="h-5 w-20 rounded-full" />
                        </td>
                      </tr>
                    ))}
                  {!loading &&
                    itens.map((item) => (
                      <tr key={item.id} className="border-t border-border/60">
                        <td className="px-4 py-2.5 font-mono text-sm text-muted">{formatData(item.datati)}</td>
                        <td className="px-4 py-2.5 font-mono text-sm text-foreground">{item.codser ?? "—"}</td>
                        <td className="max-w-[260px] px-4 py-2.5 text-sm text-muted" title={item.desati ?? undefined}>
                          <p className="truncate">{item.itemDescricao ?? item.desati ?? "—"}</p>
                          {item.itemDescricao && item.desati && (
                            <p className="mt-0.5 truncate text-[11px] text-muted/70" title={item.desati}>
                              {item.desati}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-sm tabular-nums text-muted">
                          {formatHora(item.horini)} – {formatHora(item.horfim)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-foreground">
                          {formatDuracao(item.duracaoMinutos)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${
                              item.confirmadoNoSenior ? toneBadge.success : toneBadge.warning
                            }`}
                          >
                            {item.confirmadoNoSenior ? "Sim" : "Pendente"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  {!loading && itens.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                        Nenhum item cadastrado nesta RAT.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Só aparece quando há despesa — a maioria das RATs não tem nenhuma (a maior
              parte das 15 mil linhas de RDV no Senior se concentra num recorte pequeno de
              RATs que envolvem deslocamento). */}
          {!loading && despesasViagem.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <div className="border-b border-border px-5 py-3">
                <h2 className="font-mono text-[10.5px] font-semibold uppercase tracking-widest text-muted">
                  Despesas de Viagem
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="bg-surface-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Data
                      </th>
                      <th className="bg-surface-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Tipo
                      </th>
                      <th className="bg-surface-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Descrição
                      </th>
                      <th className="bg-surface-2 px-4 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Qtd
                      </th>
                      <th className="bg-surface-2 px-4 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Valor Unit.
                      </th>
                      <th className="bg-surface-2 px-4 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Valor Total
                      </th>
                      <th className="bg-surface-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Fatura Cliente
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {despesasViagem.map((d) => (
                      <tr key={d.id} className="border-t border-border/60">
                        <td className="px-4 py-2.5 font-mono text-sm text-muted">{formatData(d.datemi)}</td>
                        <td className="px-4 py-2.5 text-sm text-muted">
                          {d.tipdesLabel}
                          {d.moddesLabel && <span className="text-muted/70"> · {d.moddesLabel}</span>}
                        </td>
                        <td className="max-w-[320px] px-4 py-2.5 text-sm text-foreground">
                          <p className="truncate" title={d.desrdv ?? undefined}>
                            {d.desrdv ?? "—"}
                          </p>
                          {d.pendenteDeEnvio && (
                            <span className="mt-0.5 inline-block rounded-full bg-warning/15 px-1.5 py-0.5 text-[9.5px] font-medium text-warning">
                              Pendente de envio ao ERP
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-muted">{d.qtdrdv ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-muted">{formatMoney(d.vlrunt)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-foreground">
                          {formatMoney(d.vlrtot)}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-muted">{d.fatrdvLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-surface-2">
                      <td colSpan={5} className="px-4 py-2.5 text-right font-mono text-[11px] font-semibold uppercase tracking-wider text-muted">
                        Total
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold tabular-nums text-foreground">
                        {formatMoney(totalDespesasViagem)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
