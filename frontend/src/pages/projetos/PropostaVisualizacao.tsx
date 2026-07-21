import axios from "axios";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { formatHoras } from "../../utils/horas";

interface PropostaDetalhe {
  codemp: number;
  codpro: number;
  numprj: number;
  cliente: string | null;
  clienteFaturamento: string | null;
  despro: string | null;
  dessol: string | null;
  consol: string | null;
  sitproLabel: string;
  sitproTone: "success" | "warning" | "destructive" | "neutral";
  depexeLabel: string;
  modproLabel: string;
  sisproLabel: string;
  tipvenLabel: string;
  claproLabel: string;
  priproLabel: string;
  tipprjLabel: string;
  frmprjLabel: string;
  sitmotLabel: string;
  forateLabel: string;
  forfatLabel: string;
  obrfasLabel: string;
  exipedcliLabel: string;
  liqbruLabel: string;
  pedcli: string | null;
  dscfpg: string | null;
  prarea: string | null;
  datpro: string | null;
  datenv: string | null;
  datret: string | null;
  datval: string | null;
  preent: string | null;
  representanteNome: string | null;
  centroCustoNome: string | null;
  qtdhor: number | null;
  numped: number;
  codlev2: number | null;
  obssit: string | null;
  obspro: string | null;
  hispro: string | null;
}

interface ItemDetalhe {
  seqite: number;
  codser: string;
  despro: string | null;
  entpro: string | null;
  depexeLabel: string;
  qtdhor: number | null;
  valhor: number;
  valorTotal: number;
  fatserLabel: string;
  sitprzLabel: string;
}

interface Totais {
  horas: number;
  valor: number;
}

const toneBadge: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  neutral: "bg-muted/15 text-muted",
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;

function formatData(valor: string | null): string {
  if (!valor) return "—";
  return dateFormatter.format(new Date(valor));
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

// Tela de visualização somente-leitura de uma proposta — pensada pra ser aberta a
// partir de qualquer lugar do CaxHub que já mostra um número de proposta (hoje só a
// lista de Alocação de Atividades chama, mas a rota não depende de nenhum contexto
// específico dessa tela de origem, só de codemp/codpro).
export function PropostaVisualizacao() {
  const { codemp, codpro } = useParams<{ codemp: string; codpro: string }>();
  const navigate = useNavigate();
  const [proposta, setProposta] = useState<PropostaDetalhe | null>(null);
  const [itens, setItens] = useState<ItemDetalhe[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    axios
      .get(`/api/proposta-visualizacao/${codemp}/${codpro}`)
      .then(({ data }) => {
        setProposta(data.proposta);
        setItens(data.itens);
        setTotais(data.totais);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar a proposta"))
      .finally(() => setLoading(false));
  }, [codemp, codpro]);

  return (
    <div>
      <button onClick={() => navigate(-1)} className="text-sm text-primary hover:underline">
        ← Voltar
      </button>

      {loading && <p className="mt-4 text-sm text-muted">Carregando proposta...</p>}

      {erro && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {proposta && (
        <>
          <div className="mb-6 mt-3">
            <p className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold text-foreground">
              Proposta {proposta.codpro} · Projeto {proposta.numprj}
              <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-medium ${toneBadge[proposta.sitproTone]}`}>
                {proposta.sitproLabel}
              </span>
            </p>
            {proposta.despro && <p className="mt-1 text-sm text-foreground">{proposta.despro}</p>}
            <p className="mt-1 text-sm text-muted">{proposta.cliente}</p>
          </div>

          <div className="space-y-4">
            <Secao titulo="Classificação">
              <Campo label="Departamento Executor" valor={proposta.depexeLabel} />
              <Campo label="Modalidade" valor={proposta.modproLabel} />
              <Campo label="Sistema" valor={proposta.sisproLabel} />
              <Campo label="Tipo de Venda" valor={proposta.tipvenLabel} />
              <Campo label="Classificação" valor={proposta.claproLabel} />
              <Campo label="Prioridade" valor={proposta.priproLabel} />
              <Campo label="Tipo de Projeto" valor={proposta.tipprjLabel} />
              <Campo label="Forma do Projeto" valor={proposta.frmprjLabel} />
            </Secao>

            <Secao titulo="Solicitação">
              <Campo label="Solicitante" valor={proposta.dessol} />
              <Campo label="Contato do Solicitante" valor={proposta.consol} />
              <Campo label="Área da Solicitação" valor={proposta.prarea} />
            </Secao>

            <Secao titulo="Datas">
              <Campo label="Data da Proposta" valor={formatData(proposta.datpro)} />
              <Campo label="Data de Envio" valor={formatData(proposta.datenv)} />
              <Campo label="Data de Retorno" valor={formatData(proposta.datret)} />
              <Campo label="Data de Validade" valor={formatData(proposta.datval)} />
              <Campo label="Previsão de Entrega" valor={formatData(proposta.preent)} />
            </Secao>

            <Secao titulo="Comercial e Financeiro">
              <Campo label="Representante" valor={proposta.representanteNome} />
              <Campo label="Centro de Custo" valor={proposta.centroCustoNome} />
              <Campo label="Forma de Faturamento" valor={proposta.forfatLabel} />
              <Campo label="Forma de Pagamento" valor={proposta.dscfpg} />
              <Campo label="Situação / Motivo" valor={proposta.sitmotLabel} />
              <Campo label="Valor Líquido/Bruto" valor={proposta.liqbruLabel} />
              <Campo label="Cliente para Faturamento" valor={proposta.clienteFaturamento} />
              <Campo label="Proposta Relacionada" valor={proposta.codlev2 != null ? String(proposta.codlev2) : null} />
            </Secao>

            <Secao titulo="Atendimento">
              <Campo label="Atendimento" valor={proposta.forateLabel} />
              <Campo label="Exige Fase na RAT" valor={proposta.obrfasLabel} />
              <Campo label="Exige Pedido do Cliente" valor={proposta.exipedcliLabel} />
              <Campo label="Nro. Pedido/OC Cliente" valor={proposta.pedcli} />
              <Campo label="Horas Previstas" valor={proposta.qtdhor != null ? formatHoras(proposta.qtdhor / 60) : null} />
              <Campo label="Nro. Pedido" valor={String(proposta.numped)} />
            </Secao>

            {(proposta.obssit || proposta.obspro || proposta.hispro) && (
              <div className="rounded-lg border border-border bg-surface p-5">
                <h2 className="mb-4 font-mono text-[10.5px] font-semibold uppercase tracking-widest text-muted">
                  Observações
                </h2>
                <div className="space-y-3">
                  {proposta.obssit && (
                    <div>
                      <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Observação da Situação
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{proposta.obssit}</p>
                    </div>
                  )}
                  {proposta.obspro && (
                    <div>
                      <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Observação da Proposta
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{proposta.obspro}</p>
                    </div>
                  )}
                  {proposta.hispro && (
                    <div>
                      <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Histórico</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{proposta.hispro}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <div className="border-b border-border px-5 py-3">
                <h2 className="font-mono text-[10.5px] font-semibold uppercase tracking-widest text-muted">
                  Itens da Proposta
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="bg-surface-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Serviço
                      </th>
                      <th className="bg-surface-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Descrição
                      </th>
                      <th className="bg-surface-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Departamento
                      </th>
                      <th className="bg-surface-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Faturamento
                      </th>
                      <th className="bg-surface-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Situação
                      </th>
                      <th className="bg-surface-2 px-4 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Horas
                      </th>
                      <th className="bg-surface-2 px-4 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Valor/Hora
                      </th>
                      <th className="bg-surface-2 px-4 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((item) => (
                      <tr key={item.seqite} className="border-t border-border/60">
                        <td className="px-4 py-2.5 font-mono text-sm text-foreground">{item.codser}</td>
                        <td className="max-w-[220px] px-4 py-2.5 text-sm text-muted" title={item.despro ?? undefined}>
                          <p className="truncate">{item.despro ?? "—"}</p>
                          {item.entpro && (
                            <p className="mt-0.5 truncate text-[11px] text-muted/70" title={item.entpro}>
                              Entregável: {item.entpro}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.neutral}`}>
                            {item.depexeLabel}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-muted">{item.fatserLabel}</td>
                        <td className="px-4 py-2.5 text-sm text-muted">{item.sitprzLabel}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-muted">
                          {item.qtdhor != null ? formatHoras(item.qtdhor / 60) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-muted">
                          {fmtMoney(item.valhor)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-foreground">
                          {fmtMoney(item.valorTotal)}
                        </td>
                      </tr>
                    ))}
                    {itens.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted">
                          Nenhum item cadastrado nesta proposta.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {totais && itens.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-border bg-surface-2/40">
                        <td colSpan={5} className="px-4 py-2.5 text-right font-mono text-sm font-semibold uppercase tracking-wider text-muted">
                          Total
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold tabular-nums text-foreground">
                          {formatHoras(totais.horas / 60)}
                        </td>
                        <td />
                        <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold tabular-nums text-foreground">
                          {fmtMoney(totais.valor)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
