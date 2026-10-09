import { FiltroRh } from "./filtros";
import { folha } from "./folha";
import { absenteismo } from "./absenteismo";
import { ponto } from "./ponto";
import { turnover } from "./turnover";
import { rescisoes } from "./rescisoes";
import { pct } from "./comum";

// DRE de RH: uma matriz mês a mês (colunas) por indicador (linhas), montada com as mesmas funções das
// telas, para o número da DRE ser exatamente o da tela correspondente. Cada linha diz como o total é
// obtido (soma, média ou razão), porque somar índices é errado.

export type TipoLinha = "moeda" | "horas" | "percentual" | "quantidade";
export type TotalDe = "soma" | "ultimo" | "razao";

export interface LinhaDre {
  grupo: string;
  rotulo: string;
  tipo: TipoLinha;
  /** valores por mês (AAAA-MM); null = sem dado naquele mês */
  valores: Record<string, number | null>;
  total: number | null;
  totalDe: TotalDe;
}

export async function dre(f: FiltroRh, individual: boolean) {
  const [fo, ab, po, tu, re] = await Promise.all([folha(f, individual), absenteismo(f, individual), ponto(f, individual), turnover(f, individual), rescisoes(f, individual)]);

  const meses = tu.meses.map((m) => ({ mes: m.mes, rotulo: m.rotulo }));
  const chaves = meses.map((m) => m.mes);

  const serie = <T>(lista: T[], chave: (x: T) => string, valor: (x: T) => number | null, padrao: number | null = null): Record<string, number | null> => {
    const mapa = new Map(lista.map((x) => [chave(x), valor(x)]));
    return Object.fromEntries(chaves.map((m) => [m, mapa.get(m) ?? padrao]));
  };
  const somar = (v: Record<string, number | null>) => {
    const nums = Object.values(v).filter((x): x is number => x != null);
    return nums.length ? Math.round(nums.reduce((s, x) => s + x, 0) * 100) / 100 : null;
  };
  const ultimo = (v: Record<string, number | null>) => {
    for (let i = chaves.length - 1; i >= 0; i--) if (v[chaves[i]] != null) return v[chaves[i]];
    return null;
  };

  const folhaMes = (campo: "bruto" | "descontos" | "liquido" | "custoMedio" | "colaboradores") =>
    serie(fo.evolucao, (x) => x.comp, (x) => x[campo] ?? null);
  const abMes = (campo: "horasTrabalhadas" | "horasAusencia" | "indice") => serie(ab.evolucao, (x) => x.mes, (x) => x[campo]);
  const poMes = (campo: "horasExtrasPagas" | "creditoNoBanco" | "pctDasHorasTrabalhadas") => serie(po.evolucao, (x) => x.mes, (x) => x[campo]);
  const tuMes = (campo: "headcountFim" | "admissoes" | "desligamentos" | "turnover") => serie(tu.meses, (x) => x.mes, (x) => x[campo]);
  // Mês sem rescisão é zero (contagem verdadeira), não "sem dado".
  const reMes = (campo: "qtd" | "proventos") => serie(re.evolucao, (x) => x.mes, (x) => x[campo], 0);

  const horasExtrasTotais = Object.fromEntries(chaves.map((m) => {
    const a = poMes("horasExtrasPagas")[m];
    const b = poMes("creditoNoBanco")[m];
    return [m, a == null && b == null ? null : Math.round(((a ?? 0) + (b ?? 0)) * 10) / 10];
  })) as Record<string, number | null>;

  const linha = (grupo: string, rotulo: string, tipo: TipoLinha, valores: Record<string, number | null>, totalDe: TotalDe, total?: number | null): LinhaDre => ({
    grupo, rotulo, tipo, valores, totalDe,
    total: total !== undefined ? total : totalDe === "soma" ? somar(valores) : totalDe === "ultimo" ? ultimo(valores) : null,
  });

  const linhas: LinhaDre[] = [
    linha("Folha de pagamento", "Folha bruta", "moeda", folhaMes("bruto"), "soma"),
    linha("Folha de pagamento", "Descontos", "moeda", folhaMes("descontos"), "soma"),
    linha("Folha de pagamento", "Folha líquida", "moeda", folhaMes("liquido"), "soma"),
    linha("Folha de pagamento", "Colaboradores na folha", "quantidade", folhaMes("colaboradores"), "ultimo"),
    linha("Folha de pagamento", "Custo médio por colaborador", "moeda", folhaMes("custoMedio"), "razao", null),
    linha("Jornada", "Horas trabalhadas", "horas", abMes("horasTrabalhadas"), "soma"),
    linha("Jornada", "Horas extras (pagas + crédito de banco)", "horas", horasExtrasTotais, "soma"),
    linha("Jornada", "Horas extras sobre trabalhadas", "percentual", poMes("pctDasHorasTrabalhadas"), "razao", pct(po.kpis.totalDeExtras, ab.kpis.horasTrabalhadas, 1)),
    linha("Jornada", "Horas de ausência", "horas", abMes("horasAusencia"), "soma"),
    linha("Jornada", "Índice de absenteísmo", "percentual", abMes("indice"), "razao", ab.kpis.indice),
    linha("Quadro", "Headcount no fim do mês", "quantidade", tuMes("headcountFim"), "ultimo"),
    linha("Quadro", "Admissões", "quantidade", tuMes("admissoes"), "soma"),
    linha("Quadro", "Desligamentos", "quantidade", tuMes("desligamentos"), "soma"),
    linha("Quadro", "Turnover", "percentual", tuMes("turnover"), "razao", tu.kpis.turnover),
    linha("Rescisões", "Rescisões calculadas", "quantidade", reMes("qtd"), "soma"),
    linha("Rescisões", "Proventos pagos em rescisões", "moeda", reMes("proventos"), "soma"),
  ];

  // Custo médio do período = bruto total ÷ soma dos colaboradores-mês (média ponderada).
  const custo = linhas.find((l) => l.rotulo === "Custo médio por colaborador");
  const colabMes = Object.values(folhaMes("colaboradores")).filter((x): x is number => x != null);
  if (custo) custo.total = colabMes.length && colabMes.reduce((s, x) => s + x, 0) ? Math.round(fo.totaisDoPeriodo.bruto / colabMes.reduce((s, x) => s + x, 0)) : null;

  return {
    periodo: { de: f.de, ate: f.ate },
    meses,
    linhas,
    definicoes: {
      totais: "Fluxos (folha, horas, admissões, rescisões) somam; headcount mostra o último mês; índices são recalculados sobre o período, não somados.",
      origem: "Cada linha vem da tela correspondente: Folha, Absenteísmo, Ponto, Turnover e Rescisões.",
    },
  };
}
