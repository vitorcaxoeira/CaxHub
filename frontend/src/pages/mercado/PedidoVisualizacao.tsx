import axios from "axios";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toneBadge, type Tone } from "../../components/ui/badges";

interface PedidoDetalhe {
  codemp: number;
  codfil: number;
  numped: number;
  cliente: string;
  sitpedLabel: string;
  sitpedTone: Tone;
  tippedLabel: string;
  prcpedLabel: string;
  tnspro: string | null;
  tnsser: string | null;
  datemi: string;
  horemi: number | null;
  datprv: string | null;
  vlrliq: number | null;
  formaPagamentoLabel: string | null;
  condicaoPagamentoLabel: string | null;
  numrat: string | null;
  propostaCodpro: number | null;
  propostaSitproLabel: string | null;
  propostaSitproTone: Tone | null;
  faturamentoLabel: string | null;
  faturamentoRdvLabel: string | null;
  obsped: string | null;
  obsmot: string | null;
  pedcli: string | null;
  // Preenchido quando o pedido foi excluído no Senior: ele some das listagens, mas
  // continua acessível por link direto com uma tarja (ver backend/src/sync/varrerRemovidos.ts).
  removidoEmSenior: string | null;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const currencyFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (v: number) => `R$ ${currencyFormatter.format(v)}`;

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

// Tela de visualização somente-leitura de um Pedido — mesmo padrão de
// PropostaVisualizacao.tsx, sem tabela de itens (Pedido é registro único, não
// master-detail) e sem aba de Auditoria (ainda não existe trilha de auditoria pra
// Pedido no backend).
export function PedidoVisualizacao() {
  const { codemp, codfil, numped } = useParams<{ codemp: string; codfil: string; numped: string }>();
  const navigate = useNavigate();
  const [pedido, setPedido] = useState<PedidoDetalhe | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    axios
      .get(`/api/pedido-visualizacao/${codemp}/${codfil}/${numped}`)
      .then(({ data }) => {
        setPedido(data.pedido);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar o pedido"))
      .finally(() => setLoading(false));
  }, [codemp, codfil, numped]);

  return (
    <div>
      <button onClick={() => navigate(-1)} className="text-sm text-primary hover:underline">
        ← Voltar
      </button>

      {loading && <p className="mt-4 text-sm text-muted">Carregando pedido...</p>}

      {erro && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {pedido && (
        <>
          <div className="mb-6 mt-3">
            <p className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold text-foreground">
              Pedido {pedido.numped} · Filial {pedido.codfil}
              <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-medium ${toneBadge[pedido.sitpedTone]}`}>
                {pedido.sitpedLabel}
              </span>
            </p>
            <p className="mt-1 text-sm text-muted">{pedido.cliente}</p>
          </div>

          {pedido.removidoEmSenior && (
            <div className="mb-6 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
              <span className="font-semibold">Este pedido não existe mais no Senior.</span> Ele sumiu da consulta ao
              ERP em {dateFormatter.format(new Date(pedido.removidoEmSenior))} e por isso não aparece mais nas
              listagens nem nos indicadores. Os dados abaixo são o último retrato que o CaxHub recebeu.
            </div>
          )}

          <div className="space-y-4">
            <Secao titulo="Classificação">
              <Campo label="Tipo" valor={pedido.tippedLabel} />
              <Campo label="Processo" valor={pedido.prcpedLabel} />
              <Campo label="Transação Produto" valor={pedido.tnspro} />
              <Campo label="Transação Serviço" valor={pedido.tnsser} />
            </Secao>

            <Secao titulo="Datas">
              <Campo label="Emissão" valor={formatData(pedido.datemi)} />
              <Campo label="Hora de Emissão" valor={formatHora(pedido.horemi)} />
              <Campo label="Previsão" valor={formatData(pedido.datprv)} />
            </Secao>

            <Secao titulo="Pagamento">
              <Campo label="Forma de Pagamento" valor={pedido.formaPagamentoLabel} />
              <Campo label="Condição de Pagamento" valor={pedido.condicaoPagamentoLabel} />
              <Campo label="Valor Líquido" valor={pedido.vlrliq != null ? formatMoney(pedido.vlrliq) : null} />
              <Campo label="Nro. Pedido/OC Cliente" valor={pedido.pedcli} />
            </Secao>

            <div className="rounded-lg border border-border bg-surface p-5">
              <h2 className="mb-4 font-mono text-[10.5px] font-semibold uppercase tracking-widest text-muted">
                Vínculo RAT/Proposta
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                <Campo label="RAT vinculada" valor={pedido.numrat} />
                <div>
                  <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Proposta</p>
                  {pedido.propostaCodpro != null ? (
                    <p className="mt-0.5 flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/projetos/proposta/${pedido.codemp}/${pedido.propostaCodpro}`)}
                        className="font-mono text-sm text-primary hover:underline"
                      >
                        {pedido.propostaCodpro}
                      </button>
                      {pedido.propostaSitproLabel != null && pedido.propostaSitproTone != null && (
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge[pedido.propostaSitproTone]}`}
                        >
                          {pedido.propostaSitproLabel}
                        </span>
                      )}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-sm text-foreground">—</p>
                  )}
                </div>
                <Campo label="Faturamento" valor={pedido.faturamentoLabel} />
                <Campo label="Faturamento RDV" valor={pedido.faturamentoRdvLabel} />
              </div>
            </div>

            {(pedido.obsped || pedido.obsmot) && (
              <div className="rounded-lg border border-border bg-surface p-5">
                <h2 className="mb-4 font-mono text-[10.5px] font-semibold uppercase tracking-widest text-muted">
                  Observações
                </h2>
                <div className="space-y-3">
                  {pedido.obsped && (
                    <div>
                      <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Observação do Pedido
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{pedido.obsped}</p>
                    </div>
                  )}
                  {pedido.obsmot && (
                    <div>
                      <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Observação do Motivo
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{pedido.obsmot}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
