import { prisma } from "../db/prisma";
import { SITRAT_CANCELADO, sitratLabel } from "./ratDominio";
import { FATOR_HORA_DESLOCAMENTO, deslocamentoNoPeriodo } from "./resumoConsultor";

// Relatório "Produtividade por Fornecedor" (FJPO910 do Senior) de um consultor num mês, impresso a partir da
// Home. Conferido contra o PDF da Eli Venturi (set/2026, codfor 232): 105 itens = 164:14, deslocamento 01:30
// (RAT 993562), valor-hora 105,39 → R$ 17.308,86 + R$ 79,04 = Valor Nota R$ 17.387,90.
//
// Entram todos os itens de RAT do mês, menos os de RAT cancelada e os excluídos no Senior (decisão do Vitor,
// 05/10/2026): RAT ainda Digitada aparece, com a situação da linha visível, então o mês em aberto é uma prévia.
// A semana termina no domingo; o subtotal semanal soma só os itens de RAT — o deslocamento NÃO entra nele,
// como no Senior. Tudo em UTC porque `datati`/`datemi` são @db.Date (meia-noite UTC).

export interface ItemProdutividade {
  tipo: "item";
  data: string; // AAAA-MM-DD
  horini: number; // minutos desde a meia-noite
  horfim: number;
  minutos: number;
  codpro: number | null;
  numrat: number | null;
  cliente: string | null;
  sitrat: number | null;
  sitratLabel: string;
  // Domínio USU_LFatSer: S = Faturamento Normal, A = Antecipado, N = Sem Faturamento (e C/H/I).
  fatser: string | null;
}

export interface DeslocamentoProdutividade {
  tipo: "deslocamento";
  data: string;
  minutos: number;
  numrats: number[];
}

export interface SubtotalSemana {
  tipo: "subtotal";
  // Domingo que fecha a semana, ou o último dia do mês quando a semana é cortada por ele.
  data: string;
  rotulo: "Domingo" | "Data fim do mês";
  minutos: number;
}

export type BlocoProdutividade = ItemProdutividade | DeslocamentoProdutividade | SubtotalSemana;

export interface TotaisProdutividade {
  minutosTrabalhados: number;
  minutosDeslocamento: number;
  valorHora: number | null;
  valorTrabalhadas: number | null;
  valorDeslocamento: number | null;
  valorNota: number | null;
}

export interface MesProdutividade {
  ano: number;
  mes: number;
  inicio: string;
  fim: string;
  blocos: BlocoProdutividade[];
  totais: TotaisProdutividade;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const centavos = (v: number) => Math.round(v * 100) / 100;

// Domingo que fecha a semana de `dia`, limitado ao fim do mês (que então vira o rótulo "Data fim do mês").
function fechamentoDaSemana(dia: Date, fimDoMes: Date): { data: Date; rotulo: SubtotalSemana["rotulo"] } {
  const domingo = new Date(dia);
  domingo.setUTCDate(domingo.getUTCDate() + ((7 - domingo.getUTCDay()) % 7));
  if (domingo.getTime() >= fimDoMes.getTime()) return { data: fimDoMes, rotulo: "Data fim do mês" };
  return { data: domingo, rotulo: "Domingo" };
}

// Ordena como o relatório do Senior: por dia, deslocamento do dia antes dos itens dele, e o subtotal de cada
// semana depois do último item dela. Semana sem item não gera subtotal.
export function montarBlocos(itens: ItemProdutividade[], deslocamentos: DeslocamentoProdutividade[], fimDoMes: Date): BlocoProdutividade[] {
  const dias = new Set<string>([...itens.map((i) => i.data), ...deslocamentos.map((d) => d.data)]);
  const blocos: BlocoProdutividade[] = [];
  let semanaAtual: { chave: string; data: Date; rotulo: SubtotalSemana["rotulo"]; minutos: number; temItem: boolean } | null = null;

  function fecharSemana() {
    if (semanaAtual?.temItem) blocos.push({ tipo: "subtotal", data: iso(semanaAtual.data), rotulo: semanaAtual.rotulo, minutos: semanaAtual.minutos });
    semanaAtual = null;
  }

  for (const dia of [...dias].sort()) {
    const fech = fechamentoDaSemana(new Date(`${dia}T00:00:00Z`), fimDoMes);
    const chave = iso(fech.data);
    if (semanaAtual && semanaAtual.chave !== chave) fecharSemana();
    if (!semanaAtual) semanaAtual = { chave, data: fech.data, rotulo: fech.rotulo, minutos: 0, temItem: false };

    for (const d of deslocamentos.filter((x) => x.data === dia)) blocos.push(d);
    for (const i of itens.filter((x) => x.data === dia)) {
      blocos.push(i);
      semanaAtual.minutos += i.minutos;
      semanaAtual.temItem = true;
    }
  }
  fecharSemana();
  return blocos;
}

export async function produtividadeDoMes(
  codemp: number,
  codfor: number,
  ano: number,
  mes: number,
  valorHora: number | null
): Promise<MesProdutividade> {
  const de = new Date(Date.UTC(ano, mes - 1, 1));
  const ate = new Date(Date.UTC(ano, mes, 0));

  const [ratItens, desloc] = await Promise.all([
    prisma.ratItem.findMany({
      where: {
        codemp,
        datati: { gte: de, lte: ate },
        horini: { not: null },
        horfim: { not: null },
        removidoEmSenior: null,
        rat: { codfor, sitrat: { not: SITRAT_CANCELADO }, removidoEmSenior: null },
      },
      select: {
        datati: true,
        horini: true,
        horfim: true,
        codpro: true,
        seqite: true,
        rat: { select: { numrat: true, sitrat: true, codcli: true } },
      },
      orderBy: [{ datati: "asc" }, { horini: "asc" }],
    }),
    deslocamentoNoPeriodo(codemp, codfor, de, ate),
  ]);

  // Cliente e tipo de faturamento em lote (nunca um por linha). Propostas por `IN` de codpro (superset);
  // a chave exata codpro+seqite escolhe o item certo.
  const codclis = [...new Set(ratItens.map((r) => r.rat.codcli).filter((c): c is number => c != null))];
  const codpros = [...new Set(ratItens.map((r) => r.codpro).filter((c): c is number => c != null))];
  const [clientes, itensProposta] = await Promise.all([
    codclis.length > 0 ? prisma.cliente.findMany({ where: { codcli: { in: codclis } }, select: { codcli: true, nomcli: true, apecli: true } }) : [],
    codpros.length > 0
      ? prisma.propostaItem.findMany({ where: { codemp, codpro: { in: codpros } }, select: { codpro: true, seqite: true, fatser: true } })
      : [],
  ]);
  const clientePorCodigo = new Map(clientes.map((c) => [c.codcli, c.apecli?.trim() || c.nomcli?.trim() || null]));
  const fatserPorItem = new Map(itensProposta.map((i) => [`${i.codpro}-${i.seqite}`, i.fatser]));

  const itens: ItemProdutividade[] = [];
  for (const r of ratItens) {
    if (r.datati == null || r.horini == null || r.horfim == null || r.horfim <= r.horini) continue;
    itens.push({
      tipo: "item",
      data: iso(r.datati),
      horini: r.horini,
      horfim: r.horfim,
      minutos: r.horfim - r.horini,
      codpro: r.codpro,
      numrat: r.rat.numrat,
      cliente: r.rat.codcli != null ? clientePorCodigo.get(r.rat.codcli) ?? null : null,
      sitrat: r.rat.sitrat,
      sitratLabel: sitratLabel(r.rat.sitrat),
      fatser: r.codpro != null && r.seqite != null ? fatserPorItem.get(`${r.codpro}-${r.seqite}`) ?? null : null,
    });
  }

  // Deslocamento do mesmo dia (mais de uma RAT) numa linha só, citando todas as RATs.
  const deslocPorDia = new Map<string, DeslocamentoProdutividade>();
  for (const d of desloc) {
    const dia = iso(d.data);
    const atual = deslocPorDia.get(dia) ?? { tipo: "deslocamento" as const, data: dia, minutos: 0, numrats: [] };
    atual.minutos += d.minutos;
    if (!atual.numrats.includes(d.numrat)) atual.numrats.push(d.numrat);
    deslocPorDia.set(dia, atual);
  }
  const deslocamentos = [...deslocPorDia.values()];

  const minutosTrabalhados = itens.reduce((s, i) => s + i.minutos, 0);
  const minutosDeslocamento = deslocamentos.reduce((s, d) => s + d.minutos, 0);
  const valorTrabalhadas = valorHora != null ? centavos((valorHora * minutosTrabalhados) / 60) : null;
  const valorDeslocamento = valorHora != null ? centavos((valorHora * FATOR_HORA_DESLOCAMENTO * minutosDeslocamento) / 60) : null;

  return {
    ano,
    mes,
    inicio: iso(de),
    fim: iso(ate),
    blocos: montarBlocos(itens, deslocamentos, ate),
    totais: {
      minutosTrabalhados,
      minutosDeslocamento,
      valorHora,
      valorTrabalhadas,
      valorDeslocamento,
      valorNota: valorTrabalhadas != null && valorDeslocamento != null ? centavos(valorTrabalhadas + valorDeslocamento) : null,
    },
  };
}
