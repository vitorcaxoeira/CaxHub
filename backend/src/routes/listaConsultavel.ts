import { Prisma } from "@prisma/client";
import type { Request, Response, Router } from "express";
import { prisma } from "../db/prisma";
import {
  type ColunaConsulta,
  condicoesDosFiltros,
  descreverColunas,
  ErroEntradaConsulta,
  lerCalculadasConsulta,
  lerFiltrosEOrdemConsulta,
  lerResumoConsulta,
  ordenacaoSql,
  prepararColunasConsulta,
  respostaDoResumo,
  resumoSql,
  selecaoCalculadas,
  valoresDaColunaSql,
} from "../consultas/consultaColunas";
import type { FiltroColuna } from "../sync/filtroColunaLocal";
import { lerInteiro } from "./parametrosConsulta";
import { gerarPdfDaPagina, RelatorioPdfError } from "../lib/relatorioPdf";

// Lista de uma tela com filtro e ordem por coluna, resumo no rodapé e colunas calculadas por fórmula (29/10/2026), a partir da consulta que
// a tela JÁ tinha: a rota entrega a consulta pronta (com os filtros do topo, sem ORDER BY nem LIMIT) e as colunas declaradas; aqui a consulta
// vira subconsulta `x` e por fora entram filtro, ordem, página, resumo e valores do funil. Registra, no router da tela:
//   GET <caminho>          lista paginada: { colunas, calculadasComProblema, itens, total, totais?, page, pageSize }
//   GET <caminho>/resumo   rodapé sobre TODAS as linhas do filtro
//   GET <caminho>/valores  aba "Valores" do funil
// O cliente só escolhe entre os NOMES declarados (nunca manda SQL); cada valor entra como parâmetro.

export interface ListaConsultavel {
  /** A consulta da tela com os filtros do topo, sem ORDER BY nem LIMIT. Expõe uma coluna por nome declarado em `colunas`. */
  interna: Prisma.Sql;
  colunas: ColunaConsulta[];
  /** ORDER BY de desempate/padrão, sobre `x` (ex.: `x."datpgt" DESC`). */
  ordemPadrao: Prisma.Sql;
  /** Colunas decimais somadas sobre TODAS as linhas do filtro (o total do cabeçalho); volta em `totais`. */
  totais?: string[];
  /** `WITH ...` que a consulta interna precisa na frente. */
  com?: Prisma.Sql;
  pageSizePadrao?: number;
  /** Acrescenta campos às linhas da página (ex.: texto que depende de outra consulta ou de regra em JS). Não vale para filtro e ordem. */
  decorar?: (linhas: Record<string, unknown>[]) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];
  /** Teto de linhas por página (padrão 200). */
  paginaMaxima?: number;
}

const MAX_PAGINA = 200;
const executar = (sql: Prisma.Sql) => prisma.$queryRaw<Record<string, unknown>[]>(sql);

const ref = (nome: string) => Prisma.raw(`x."${nome}"`);
const DIA_BRT = (nome: string) => Prisma.raw(`(x."${nome}"::timestamp AT TIME ZONE 'America/Sao_Paulo')`);

type OpcoesColuna = Pick<ColunaConsulta, "obrigatoria" | "semValores" | "dominio">;
/** Colunas da subconsulta `x`: a expressão é sempre o próprio nome da coluna exposta pela consulta interna. */
export const col = {
  texto: (nome: string, o: OpcoesColuna = {}): ColunaConsulta => ({ nome, tipo: "texto", expr: ref(nome), ...o }),
  inteiro: (nome: string, o: OpcoesColuna = {}): ColunaConsulta => ({ nome, tipo: "inteiro", expr: ref(nome), ...o }),
  decimal: (nome: string, o: OpcoesColuna = {}): ColunaConsulta => ({ nome, tipo: "decimal", expr: ref(nome), ...o }),
  booleano: (nome: string, o: OpcoesColuna = {}): ColunaConsulta => ({ nome, tipo: "booleano", expr: ref(nome), ...o }),
  /** Data (date ou timestamp): compara pelo dia de Brasília, como as outras listas. */
  data: (nome: string, o: OpcoesColuna = {}): ColunaConsulta => ({ nome, tipo: "data", expr: DIA_BRT(nome), ...o }),
};

/**
 * Consulta escrita com parâmetros posicionais ($1, $2...) como texto (as telas mais antigas montam o WHERE assim) vira Prisma.Sql para
 * entrar na subconsulta da lista. Cada $n vira um parâmetro de verdade, na ordem em que aparece.
 */
export function sqlPosicional(texto: string, params: unknown[]): Prisma.Sql {
  const partes = texto.split(/\$(\d+)/);
  const strings: string[] = [];
  const valores: unknown[] = [];
  for (let i = 0; i < partes.length; i++) {
    if (i % 2 === 0) strings.push(partes[i]);
    else valores.push(params[Number(partes[i]) - 1]);
  }
  return Prisma.sql(strings as unknown as TemplateStringsArray, ...valores);
}

/** `CASE expr WHEN v THEN rótulo ...`: o rótulo de um domínio como coluna SQL, para a lista filtrar e ordenar pelo texto que a tela mostra. */
export function casoSql<V extends string | number>(expr: Prisma.Sql, valores: readonly V[], rotulo: (v: V) => string, senao: Prisma.Sql = Prisma.sql`NULL`): Prisma.Sql {
  if (valores.length === 0) return senao;
  return Prisma.sql`(CASE ${Prisma.join(valores.map((v) => Prisma.sql`WHEN ${expr} = ${v} THEN ${rotulo(v)}`), " ")} ELSE ${senao} END)`;
}

function limpar(linha: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [chave, v] of Object.entries(linha)) {
    if (typeof v === "bigint") saida[chave] = Number(v);
    else if (v !== null && typeof v === "object" && Prisma.Decimal.isDecimal(v)) saida[chave] = (v as Prisma.Decimal).toNumber();
    else saida[chave] = v;
  }
  return saida;
}

function erroHttp(res: Response, erro: unknown, rotulo: string) {
  if (erro instanceof ErroEntradaConsulta) return res.status(erro.status).json({ error: erro.message });
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  console.error(`[lista:${rotulo}]`, mensagem);
  return res.status(500).json({ error: mensagem });
}

const de = (l: ListaConsultavel) => Prisma.sql`FROM (${l.interna}) x`;

/** `montar(colunas)(filtros)(selecao)`: a consulta da lista com os filtros de coluna (comuns), no formato do resumoSql e do prepararColunasConsulta. */
const montarDe = (l: ListaConsultavel) => (colunas: ColunaConsulta[]) => (filtros: FiltroColuna[]) => (sel: Prisma.Sql) => {
  const condicoes = condicoesDosFiltros(colunas, filtros, { agregadas: false });
  const onde = condicoes.length ? Prisma.sql`WHERE ${Prisma.join(condicoes, " AND ")}` : Prisma.empty;
  return Prisma.sql`${l.com ?? Prisma.empty} SELECT ${sel} ${de(l)} ${onde}`;
};

/** O router já tem um POST exatamente neste caminho? */
function jaTemPost(router: Router, caminho: string): boolean {
  const pilha = (router as unknown as { stack?: { route?: { path?: unknown; methods?: Record<string, boolean> } }[] }).stack ?? [];
  return pilha.some((l) => l.route?.path === caminho && !!l.route.methods?.post);
}

/** O router já tem um GET exatamente neste caminho? (camadas de rota do Express) */
function jaTemGet(router: Router, caminho: string): boolean {
  const pilha = (router as unknown as { stack?: { route?: { path?: unknown; methods?: Record<string, boolean> } }[] }).stack ?? [];
  return pilha.some((l) => l.route?.path === caminho && !!l.route.methods?.get);
}

/**
 * Todas as linhas da lista (sem página nem ordem) que passam pelos filtros de coluna da query, com a `selecao` pedida sobre `x`. Para
 * ações em lote que precisam respeitar exatamente o filtro que a pessoa vê na tela (ex.: "Fechar Todos" das RATs).
 */
export async function linhasFiltradasDaLista(lista: ListaConsultavel, q: Record<string, unknown>, selecao: Prisma.Sql) {
  const montar = montarDe(lista);
  const { colunas, filtros } = await prepararColunasConsulta(executar, lista.colunas, q, montar(lista.colunas));
  return (await executar(montar(colunas)(filtros)(selecao))).map(limpar);
}

/** Teto de linhas de uma exportação CSV (uma lista de tela nunca chega perto; é guarda contra filtro vazio numa tabela enorme). */
const LIMITE_CSV = 50000;
/** Teto de linhas do relatório impresso (papel: acima disso a pessoa deve filtrar ou exportar para o Excel). */
const LIMITE_IMPRESSAO = 5000;

const DIA_BR = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const DIA_HORA_BR = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

/** Uma célula do CSV em português: ";" como separador, vírgula decimal, datas dd/mm/aaaa, Sim/Não. */
function celulaCsv(valor: unknown, tipo: ColunaConsulta["tipo"] | undefined): string {
  let texto: string;
  if (valor == null) texto = "";
  else if (valor instanceof Date) {
    const meiaNoiteUtc = valor.getUTCHours() === 0 && valor.getUTCMinutes() === 0 && valor.getUTCSeconds() === 0;
    texto = meiaNoiteUtc ? DIA_BR.format(valor) : DIA_HORA_BR.format(valor);
  } else if (typeof valor === "boolean") texto = valor ? "Sim" : "Não";
  else if (typeof valor === "number") texto = (tipo === "decimal" ? valor.toFixed(2) : String(valor)).replace(".", ",");
  else texto = String(valor);
  // Células que o Excel interpretaria como fórmula (=, +, -, @) ganham um apóstrofo na frente: texto vindo do banco nunca vira fórmula.
  if (typeof valor === "string" && /^[=+\-@]/.test(texto)) texto = `'${texto}`;
  return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function registrarListaConsultavel(
  router: Router,
  caminho: string,
  ler: (req: Request) => ListaConsultavel | Promise<ListaConsultavel>,
  rotulo: string,
) {
  const sub = (s: string) => (caminho === "/" ? s : `${caminho}${s}`);
  // Rota GET já registrada em `/resumo` ou `/valores` responde no lugar da lista (o Express atende a primeira): falha ao subir, não em
  // silêncio na tela. Aconteceu em Notas de Saída (29/10/2026): o `/resumo` antigo dos KPIs engolia o resumo do rodapé. O caminho da própria
  // lista fica de fora: há rota antes dela de propósito, que só trata `formato=csv` e chama next() (fluxo de caixa operacional).
  for (const p of [sub("/resumo"), sub("/valores")]) {
    if (jaTemGet(router, p)) throw new Error(`registrarListaConsultavel(${rotulo}): GET ${p} já existe neste router`);
  }

  router.get(caminho, async (req, res) => {
    try {
      const q = req.query as Record<string, unknown>;
      const lista = await ler(req);
      const page = lerInteiro(q.page, 1, 1, 100000);
      const pageSize = lerInteiro(q.pageSize, lista.pageSizePadrao ?? 50, 1, lista.paginaMaxima ?? MAX_PAGINA);
      const montar = montarDe(lista);
      const { colunas, problemas, filtros, ordem } = await prepararColunasConsulta(executar, lista.colunas, q, montar(lista.colunas));
      const consulta = montar(colunas)(filtros);
      const pedidos = (lista.totais ?? []).map((coluna) => ({ coluna, funcao: "soma" as const }));
      const [linhas, resumo] = await Promise.all([
        executar(Prisma.sql`${consulta(Prisma.sql`x.*${selecaoCalculadas(colunas)}`)}
          ORDER BY ${ordenacaoSql(colunas, ordem, lista.ordemPadrao)} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
        executar(resumoSql(colunas, pedidos, consulta)),
      ]);
      const r = respostaDoResumo(resumo[0], pedidos);
      res.json({
        colunas: descreverColunas(colunas),
        calculadasComProblema: problemas,
        itens: lista.decorar ? await lista.decorar(linhas.map(limpar)) : linhas.map(limpar),
        total: r.linhas,
        totais: Object.fromEntries(pedidos.map((p) => [p.coluna, Number(r.valores[`${p.coluna}:soma`] ?? 0)])),
        page,
        pageSize,
      });
    } catch (erro) {
      erroHttp(res, erro, rotulo);
    }
  });

  router.get(sub("/resumo"), async (req, res) => {
    try {
      const q = req.query as Record<string, unknown>;
      const lista = await ler(req);
      const montar = montarDe(lista);
      const { colunas, filtros } = await prepararColunasConsulta(executar, lista.colunas, q, montar(lista.colunas));
      const pedidos = lerResumoConsulta(colunas, q);
      const [linha] = await executar(resumoSql(colunas, pedidos, montar(colunas)(filtros)));
      res.json(respostaDoResumo(linha, pedidos));
    } catch (erro) {
      erroHttp(res, erro, `${rotulo}-resumo`);
    }
  });

  router.get(sub("/valores"), async (req, res) => {
    try {
      const q = req.query as Record<string, unknown>;
      const lista = await ler(req);
      const { colunas } = lerCalculadasConsulta(lista.colunas, q);
      const { filtros } = lerFiltrosEOrdemConsulta(colunas, q);
      res.json(
        await valoresDaColunaSql(executar, colunas, typeof q.coluna === "string" ? q.coluna : "", {
          com: lista.com,
          de: de(lista),
          base: [],
          filtros,
          termo: typeof q.termo === "string" ? q.termo : "",
        }),
      );
    } catch (erro) {
      erroHttp(res, erro, `${rotulo}-valores`);
    }
  });

  // Exportação e impressão: TODAS as linhas do filtro atual (não só a página), na ordem pedida, com as colunas que a pessoa deixou visíveis
  // (`colunasCsv`, na ordem da tela) e os títulos da tela (`cabecalhos`, JSON { nome: título }). Mesma consulta e mesmos filtros da lista.
  async function linhasExportadas(req: Request, limite: number) {
    const q = req.query as Record<string, unknown>;
    const lista = await ler(req);
    const montar = montarDe(lista);
    const { colunas, filtros, ordem } = await prepararColunasConsulta(executar, lista.colunas, q, montar(lista.colunas));
    const linhas = (
      await executar(Prisma.sql`${montar(colunas)(filtros)(Prisma.sql`x.*${selecaoCalculadas(colunas)}`)}
        ORDER BY ${ordenacaoSql(colunas, ordem, lista.ordemPadrao)} LIMIT ${limite + 1}`)
    ).map(limpar);
    const truncado = linhas.length > limite;
    if (truncado) linhas.length = limite;

    const porNome = new Map(colunas.map((c) => [c.nome, c]));
    const pedidas = typeof q.colunasCsv === "string" ? q.colunasCsv.split(",").filter((n) => porNome.has(n)) : [];
    const nomes = pedidas.length ? pedidas : lista.colunas.map((c) => c.nome);
    let titulos: Record<string, unknown> = {};
    try {
      const lido = typeof q.cabecalhos === "string" ? JSON.parse(q.cabecalhos) : {};
      if (lido && typeof lido === "object") titulos = lido as Record<string, unknown>;
    } catch {
      /* cabeçalho é só enfeite: sem JSON válido usa o nome técnico */
    }
    const tituloDe = (n: string) => (typeof titulos[n] === "string" ? (titulos[n] as string) : n);
    return { lista, linhas, nomes, porNome, tituloDe, truncado };
  }

  if (!jaTemGet(router, sub("/csv"))) {
    router.get(sub("/csv"), async (req, res) => {
      try {
        const { linhas, nomes, porNome, tituloDe } = await linhasExportadas(req, LIMITE_CSV);
        const cabecalho = nomes.map((n) => celulaCsv(tituloDe(n), undefined));
        const corpo = linhas.map((l) => nomes.map((n) => celulaCsv(l[n], porNome.get(n)?.tipo)).join(";"));
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${rotulo.replace(/[^a-z0-9_-]/gi, "_")}_${Date.now()}.csv"`);
        // BOM + ponto e vírgula + vírgula decimal: abre direto no Excel em português (mesma convenção das outras exportações).
        res.send(`\uFEFF${[cabecalho.join(";"), ...corpo].join("\r\n")}`);
      } catch (erro) {
        erroHttp(res, erro, `${rotulo}-csv`);
      }
    });
  }

  // Relatório impresso (06/11/2026): as mesmas linhas da exportação, em JSON, só com as colunas visíveis (título e tipo de cada uma, para a
  // página formatar) e a soma das colunas de total da lista. Até LIMITE_IMPRESSAO linhas; acima disso volta `truncado` e a página avisa.
  if (!jaTemGet(router, sub("/impressao"))) {
    router.get(sub("/impressao"), async (req, res) => {
      try {
        // `completo=1` (PDF): sem o corte de 5.000 do relatório de tela, vale o teto do CSV (50.000, na prática todas as linhas).
        const limite = (req.query as Record<string, unknown>).completo === "1" ? LIMITE_CSV : LIMITE_IMPRESSAO;
        const { lista, linhas, nomes, porNome, tituloDe, truncado } = await linhasExportadas(req, limite);
        const totais = Object.fromEntries(
          (lista.totais ?? []).map((c) => [c, Math.round(linhas.reduce((soma, l) => soma + (Number(l[c]) || 0), 0) * 100) / 100])
        );
        res.json({
          colunas: nomes.map((n) => ({ nome: n, titulo: tituloDe(n), tipo: porNome.get(n)?.tipo ?? "texto" })),
          linhas: linhas.map((l) => Object.fromEntries(nomes.map((n) => [n, l[n] ?? null]))),
          total: linhas.length,
          truncado,
          limite,
          totais,
        });
      } catch (erro) {
        erroHttp(res, erro, `${rotulo}-impressao`);
      }
    });
  }

  // PDF (06/11/2026): o mesmo relatório do "Imprimir" (página /relatorio/lista/:id), gerado no servidor com Chromium e SEM o corte de linhas
  // (completo=1). O corpo traz o título, os parâmetros da exportação (filtros da tela, filtros e ordem por coluna, colunas visíveis e títulos),
  // a orientação e o tema. A url da lista vem do próprio router (nunca do corpo), e a página consulta /impressao com o token de quem pediu:
  // o escopo é o da lista.
  if (!jaTemPost(router, sub("/pdf"))) {
    router.post(sub("/pdf"), async (req, res) => {
      try {
        const corpo = (req.body ?? {}) as Record<string, unknown>;
        const titulo = typeof corpo.titulo === "string" && corpo.titulo.trim() ? corpo.titulo.trim().slice(0, 120) : rotulo;
        const bruto = corpo.params && typeof corpo.params === "object" ? (corpo.params as Record<string, unknown>) : {};
        const params: Record<string, string | number | boolean> = {};
        for (const [k, v] of Object.entries(bruto)) {
          if ((typeof v === "string" && v.length <= 5000) || typeof v === "number" || typeof v === "boolean") params[k] = v;
        }
        const orientacao = corpo.orientacao === "retrato" ? "retrato" : "paisagem";
        const tema = corpo.tema === "escuro" ? "escuro" : "claro";
        const id = `pdf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const espec = { titulo, url: `/api${req.baseUrl}${sub("")}`, params, criadoEm: Date.now() };
        const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
        const pdf = await gerarPdfDaPagina(`/relatorio/lista/${id}?orientacao=${orientacao}&tema=${tema}&completo=1`, token, {
          [`caxhub-relatorio-lista:${id}`]: JSON.stringify(espec),
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${rotulo.replace(/[^a-z0-9_-]/gi, "_")}_${Date.now()}.pdf"`);
        res.send(pdf);
      } catch (erro) {
        if (erro instanceof RelatorioPdfError) {
          console.error(`[lista:${rotulo}-pdf]`, erro.message);
          res.status(erro.status).json({ error: erro.message });
          return;
        }
        erroHttp(res, erro, `${rotulo}-pdf`);
      }
    });
  }
}
