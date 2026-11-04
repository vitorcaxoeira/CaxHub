// Lista em memória (03/11/2026): filtro e ordem por coluna, resumo no rodapé, aba "Valores" do funil e colunas calculadas por fórmula
// aplicados sobre as linhas que a rota JÁ monta (com o recorte de permissão e os filtros do topo dela). É o par de
// registrarListaConsultavel para as telas que leem com Prisma e regra de acesso (Solicitações, 5S, Alocação, RATs): em vez de reescrever a
// consulta em SQL, o recorte continua o de sempre e só o que vem depois dele muda. Mesma semântica das tabelas locais da tela
// (consultas/local/*, cópias fiéis do frontend). Funções puras, sem banco.
import { Prisma } from "@prisma/client";
import { colunasDaFormula, ErroFormula, type TipoColunaFormula, validarFormula } from "../formulas/formula";
import { type FiltroColuna, operadoresDaColuna, validarFiltrosColuna } from "../sync/filtroColunaLocal";
import { type OrdemColuna, validarOrdem } from "../sync/ordemColuna";
import { type PedidoResumo, validarPedidosResumo } from "../sync/resumoColuna";
import { aplicarFiltrosLocal, type ColunaLocal, ordenarLocal, type RespostaValores, valoresLocais } from "./local/aplicarLocal";
import { avaliarFormula } from "./local/avaliarFormula";
import { resumirLinhas, type TipoResumo } from "./local/resumoLocal";
import { ErroEntradaConsulta } from "./consultaColunas";

export type { ColunaLocal } from "./local/aplicarLocal";

/** Uma coluna da lista em memória: o tipo (filtro, ordem, resumo) e, opcionalmente, o domínio do funil. */
export interface ColunaMemoria extends ColunaLocal {
  dominio?: { valor: string; rotulo: string }[];
  /** Sem aba "Valores" no funil (ex.: texto longo, único por linha). */
  semValores?: boolean;
}

export type Linha = Record<string, unknown>;

const NOME_CALCULADA = /^calc_\d{1,9}$/;
const MAX_CALCULADAS = 20;

/** Date → ISO, Decimal/BigInt → número: as linhas ficam como a tela as recebe (e como as funções locais esperam). */
export function normalizarLinha(linha: Linha): Linha {
  const saida: Linha = {};
  for (const [k, v] of Object.entries(linha)) {
    if (v instanceof Date) saida[k] = v.toISOString();
    else if (typeof v === "bigint") saida[k] = Number(v);
    else if (v !== null && typeof v === "object" && Prisma.Decimal.isDecimal(v)) saida[k] = (v as Prisma.Decimal).toNumber();
    else saida[k] = v;
  }
  return saida;
}

const lerJson = (bruto: unknown, mensagem: string): unknown => {
  try {
    return typeof bruto === "string" && bruto.trim() ? JSON.parse(bruto) : [];
  } catch {
    throw new ErroEntradaConsulta(mensagem);
  }
};

const paraFiltravel = (c: ColunaLocal) => ({ nome: c.nome, tipo: c.tipo, obrigatoria: !!c.obrigatoria, prisma: "" });

export interface Preparada {
  colunas: ColunaMemoria[];
  /** Linhas com as calculadas válidas já preenchidas (`calc_<id>`), ANTES dos filtros de coluna. */
  linhas: Linha[];
  filtros: FiltroColuna[];
  ordem: OrdemColuna[];
  problemas: Record<string, string>;
}

/**
 * Lê da query as calculadas (`calculadas`), os filtros (`filtros`) e a ordem (`ordem`) contra as colunas declaradas e devolve as linhas com
 * as calculadas. Calculada inválida não derruba a lista: fica de fora e volta em `problemas`. TOTAL([x]) = soma de x nas linhas que passam
 * nos filtros das colunas comuns (mesma regra do servidor SQL).
 */
export function prepararLista(base: ColunaMemoria[], linhasBrutas: Linha[], query: Record<string, unknown>): Preparada {
  const linhasBase = linhasBrutas.map(normalizarLinha);
  const tipos = new Map<string, TipoColunaFormula>(base.map((c) => [c.nome, c.tipo]));
  const bruto = lerJson(query.calculadas, "Colunas calculadas inválidas.");
  if (!Array.isArray(bruto) || bruto.length > MAX_CALCULADAS) throw new ErroEntradaConsulta("Colunas calculadas inválidas.");
  const problemas: Record<string, string> = {};
  const calculadas: { nome: string; arvore: ReturnType<typeof validarFormula> }[] = [];
  for (const item of bruto) {
    const nome = item && typeof item === "object" ? (item as Record<string, unknown>).nome : undefined;
    if (typeof nome !== "string" || !NOME_CALCULADA.test(nome) || tipos.has(nome) || calculadas.some((c) => c.nome === nome))
      throw new ErroEntradaConsulta("Colunas calculadas inválidas.");
    try {
      calculadas.push({ nome, arvore: validarFormula((item as Record<string, unknown>).arvore, tipos) });
    } catch (erro) {
      if (!(erro instanceof ErroFormula)) throw erro;
      problemas[nome] = erro.message;
    }
  }
  const colunas: ColunaMemoria[] = [...base, ...calculadas.map((c) => ({ nome: c.nome, tipo: "decimal" as const }))];

  const filtrosBrutos = lerJson(query.filtros, "Filtros inválidos.");
  let filtros: FiltroColuna[];
  let ordem: OrdemColuna[];
  try {
    filtros = validarFiltrosColuna(colunas.map(paraFiltravel), filtrosBrutos);
    ordem = validarOrdem(
      colunas.map((c) => c.nome),
      query.ordem,
    );
  } catch (erro) {
    throw new ErroEntradaConsulta(erro instanceof Error ? erro.message : "Filtros inválidos.");
  }

  let linhas = linhasBase;
  if (calculadas.length > 0) {
    const comuns = filtros.filter((f) => !NOME_CALCULADA.test(f.coluna));
    const filtradasComuns = aplicarFiltrosLocal(linhasBase, base, comuns);
    const totais: Record<string, number | null> = {};
    for (const nome of new Set(calculadas.flatMap((c) => colunasDaFormula(c.arvore, true)))) {
      const ns = filtradasComuns.map((l) => Number(l[nome])).filter((n) => Number.isFinite(n));
      totais[nome] = ns.length ? ns.reduce((a, b) => a + b, 0) : null;
    }
    linhas = linhasBase.map((l) => {
      const nova = { ...l };
      for (const c of calculadas) nova[c.nome] = avaliarFormula(c.arvore, (n) => l[n], tipos, totais);
      return nova;
    });
  }
  return { colunas, linhas, filtros, ordem, problemas };
}

/** Descrição das colunas que a tela recebe (mesmo formato de descreverColunas, da lista SQL). */
export function descreverColunasMemoria(colunas: ColunaMemoria[]) {
  return colunas.map((c) => ({
    nome: c.nome,
    tipo: c.tipo,
    operadores: operadoresDaColuna({ tipo: c.tipo, obrigatoria: !!c.obrigatoria }),
    agregada: false,
    semAbaValores: !!c.semValores,
    ...(c.dominio ? { dominio: c.dominio } : {}),
  }));
}

/** Página da lista: filtros, ordem (sem ordem = a ordem em que a rota entregou as linhas), totais e a fatia pedida. */
export function paginaDaLista(p: Preparada, opcoes: { page: number; pageSize: number; totais?: string[] }) {
  const filtradas = aplicarFiltrosLocal(p.linhas, p.colunas, p.filtros);
  const ordenadas = ordenarLocal(filtradas, p.colunas, p.ordem);
  const soma = (coluna: string) => filtradas.reduce((s, l) => s + (Number.isFinite(Number(l[coluna])) && l[coluna] !== null ? Number(l[coluna]) : 0), 0);
  return {
    colunas: descreverColunasMemoria(p.colunas),
    calculadasComProblema: p.problemas,
    itens: ordenadas.slice((opcoes.page - 1) * opcoes.pageSize, opcoes.page * opcoes.pageSize),
    total: filtradas.length,
    totais: Object.fromEntries((opcoes.totais ?? []).map((c) => [c, soma(c)])),
    page: opcoes.page,
    pageSize: opcoes.pageSize,
  };
}

/** Rodapé: o resumo de cada coluna pedida (`resumo`, JSON) sobre TODAS as linhas do filtro. */
export function resumoDaLista(p: Preparada, query: Record<string, unknown>) {
  let pedidos: PedidoResumo[];
  try {
    pedidos = validarPedidosResumo(p.colunas, lerJson(query.resumo, "Resumo inválido."));
  } catch (erro) {
    throw erro instanceof ErroEntradaConsulta ? erro : new ErroEntradaConsulta(erro instanceof Error ? erro.message : "Resumo inválido.");
  }
  const tipos = new Map<string, TipoResumo>(p.colunas.map((c) => [c.nome, c.tipo]));
  return resumirLinhas(aplicarFiltrosLocal(p.linhas, p.colunas, p.filtros), pedidos, (l, c) => l[c], tipos);
}

/** Aba "Valores" do funil de uma coluna: os valores nas linhas filtradas pelas OUTRAS colunas. */
export function valoresDaLista(p: Preparada, coluna: string, termo: string): RespostaValores & { coluna: string } {
  const c = p.colunas.find((x) => x.nome === coluna);
  if (!c || c.semValores) throw new ErroEntradaConsulta(`A coluna "${coluna}" não tem lista de valores.`);
  return { coluna, ...valoresLocais(p.linhas, p.colunas, p.filtros, coluna, termo) };
}
