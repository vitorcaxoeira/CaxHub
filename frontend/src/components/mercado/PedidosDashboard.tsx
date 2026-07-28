import { KpiCard } from "../ui/KpiCard";
import { RankingBarra } from "../ui/RankingBarra";
import { Skeleton } from "../ui/Skeleton";

export interface PedidosIndicadoresData {
  total: number;
  naoFechados: number;
  abertos: number;
  comRatVinculada: number;
  ratsSincronizadasLocalmente: number;
  valorLiquidoTotal: number;
  porSituacao: { sitped: number; label: string; tone: string; quantidade: number }[];
  topClientes: { codcli: number; nome: string; quantidade: number; valorLiquido: number }[];
  porFaturamento: { forfat: number; label: string; quantidade: number }[];
  porFaturamentoRdv: { forfatrdv: number; label: string; quantidade: number }[];
}

interface PedidosDashboardProps {
  dados: PedidosIndicadoresData | null;
  loading: boolean;
}

const formatarContagem = (valor: number) => valor.toLocaleString("pt-BR");
const currencyFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (v: number) => `R$ ${currencyFormatter.format(v)}`;

// KPIs de Pedido + RAT + Proposta (aba "Dash"). Mesmo padrão visual de
// WorkloadConsultores.tsx (KpiCard + RankingBarra, sem lib de gráfico). vlrliq é o
// único campo monetário real disponível — usado no KPI de valor total e no ranking de
// Top Clientes; o resto continua em contagem/distribuição.
export function PedidosDashboard({ dados, loading }: PedidosDashboardProps) {
  if (loading || !dados) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-5">
            <Skeleton className="mb-2 h-3.5 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="mt-2 h-1 w-full" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        ))}
      </div>
    );
  }

  const naoSincronizadas = dados.comRatVinculada - dados.ratsSincronizadasLocalmente;

  const situacaoItens = dados.porSituacao.map((s) => ({
    chave: s.sitped,
    nome: s.label,
    quantidade: s.quantidade,
    valor: s.quantidade,
  }));
  const clientesItens = dados.topClientes.map((c) => ({
    chave: c.codcli,
    nome: c.nome,
    quantidade: c.quantidade,
    valor: c.valorLiquido,
  }));
  const faturamentoItens = dados.porFaturamento.map((f) => ({
    chave: f.forfat,
    nome: f.label,
    quantidade: f.quantidade,
    valor: f.quantidade,
  }));
  const faturamentoRdvItens = dados.porFaturamentoRdv.map((f) => ({
    chave: f.forfatrdv,
    nome: f.label,
    quantidade: f.quantidade,
    valor: f.quantidade,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total de Pedidos" tone="primary" quantidade={dados.total} total={dados.total} rodape="Base completa, sem filtro" />
        <KpiCard
          label="Valor Líquido Total"
          tone="primary"
          quantidade={dados.total}
          total={dados.total}
          valor={formatMoney(dados.valorLiquidoTotal)}
          rodape="Soma de todos os pedidos"
        />
        <KpiCard label="Não Fechados" tone="warning" quantidade={dados.naoFechados} total={dados.total} rodape="Situação 9" />
        <KpiCard label="Abertos" tone="warning" quantidade={dados.abertos} total={dados.total} rodape="Situações 1 e 2" />
        <KpiCard
          label="Com RAT vinculada"
          tone="success"
          quantidade={dados.comRatVinculada}
          total={dados.total}
          rodape="Campo usu_numrat preenchido"
        />
        <KpiCard
          label="RAT não sincronizada"
          tone="destructive"
          quantidade={naoSincronizadas}
          total={dados.comRatVinculada}
          rodape="Aguardando sync do Senior"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RankingBarra titulo="Pedidos por Situação" itens={situacaoItens} formatarValor={formatarContagem} unidade="pedidos" />
        <RankingBarra titulo="Top Clientes" itens={clientesItens} unidade="pedidos" descricao="Por valor líquido somado" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RankingBarra
          titulo="Forma de Faturamento (RAT)"
          itens={faturamentoItens}
          formatarValor={formatarContagem}
          unidade="pedidos"
          descricao="Via RAT vinculada e resolvida"
        />
        <RankingBarra
          titulo="Forma de Faturamento (RDV)"
          itens={faturamentoRdvItens}
          formatarValor={formatarContagem}
          unidade="pedidos"
          descricao="Via RAT vinculada e resolvida"
        />
      </div>
    </div>
  );
}
