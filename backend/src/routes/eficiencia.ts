import { NextFunction, Response, Router } from "express";
import { AuthenticatedRequest, requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { ContextoConsultor, codforsDoTime, resolverContextoConsultor } from "../domain/contextoProjeto";
import {
  DadosEficiencia,
  FiltrosEficiencia,
  EscopoEficiencia,
  carregarApontadoSemItem,
  carregarDados,
  carregarDepartamentosDoEscopo,
  carregarTendencia,
} from "../domain/eficienciaDados";
import {
  ConsultorCalculado,
  LIMIARES,
  PropostaCalculada,
  calcularClientes,
  calcularConsultores,
  calcularProposta,
  faixaDaProposta,
  faixasDeConsumo,
  indexarAlocacoes,
  montarAlertas,
  paretoDoEstouro,
  resumirCarteira,
} from "../domain/eficienciaPropostas";
import {
  SISPRO_ORDER,
  SITPRO_ATIVIDADES_VISIVEIS,
  depexeLabel,
  fatserLabel,
  sisproLabel,
  sitproLabel,
} from "../domain/propostasDominio";
import { parseIntListParam } from "../lib/queryParams";

// Painel de Eficiência (Gestão de Projetos): vendido x executado x alocado, por proposta, equipe e
// cliente. Só leitura. Quem entra: admin ou gestor de algum departamento (DepartamentoGestor) — em
// sincronia com o item do menu (Sidebar, gestorOuAdmin) e o RequireGestorOuAdmin do frontend.
//
// Recorte do gestor: propostas do escopo da Alocação (depexe da proposta OU de algum item entre os
// departamentos que gerencia) e, em consultores, só o time dele (codforsDoTime). Quem está fora do
// time não aparece com nome: vira "outros" na gaveta da proposta.
export const eficienciaRouter = Router();

function handleError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[eficiencia:${label}]`, message);
  res.status(500).json({ error: message });
}

interface AcessoEficiencia {
  admin: boolean;
  contexto: ContextoConsultor;
}

async function exigirAdminOuGestor(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { email: true } });
    const contexto = user ? await resolverContextoConsultor(user.email) : { consultor: null, departamentosGerenciados: [], departamentosTime: [] };
    const admin = req.user!.role === "admin";
    if (!admin && contexto.departamentosGerenciados.length === 0) {
      res.status(403).json({ error: "Sem permissão para acessar este recurso" });
      return;
    }
    res.locals.acesso = { admin, contexto } satisfies AcessoEficiencia;
    next();
  } catch (error) {
    handleError(res, error, "acesso");
  }
}

eficienciaRouter.use(requireAuth, exigirAdminOuGestor);

const acessoDe = (res: Response) => res.locals.acesso as AcessoEficiencia;
const escopoDe = (a: AcessoEficiencia): EscopoEficiencia => ({ departamentos: a.admin ? null : a.contexto.departamentosGerenciados });

function lerFiltros(q: AuthenticatedRequest["query"]): FiltrosEficiencia {
  const tipo = q.tipo === "int" || q.tipo === "all" ? q.tipo : "cli";
  const sitpro = (parseIntListParam(q.sitpro) ?? []).filter((s) => SITPRO_ATIVIDADES_VISIVEIS.includes(s));
  return { tipo, sitpro, sispro: parseIntListParam(q.sispro), depexe: parseIntListParam(q.depexe) };
}

// Capacidade mensal em projeto, em horas. Parâmetro do usuário (a jornada cadastrada é a jornada
// TOTAL, não a parte em projeto, e só 32 de 50 consultores alocados têm jornada).
function lerCapacidadeMin(q: AuthenticatedRequest["query"]): number {
  const n = Number(q.cap);
  const horas = Number.isFinite(n) && n > 0 ? Math.min(220, Math.max(20, n)) : LIMIARES.capacidadePadraoHorasMes;
  return horas * 60;
}

async function calcular(dados: DadosEficiencia, acesso: AcessoEficiencia) {
  const visiveis = await codforsDoTime(acesso.admin ? "admin" : "gestor", acesso.contexto);
  const indice = indexarAlocacoes(dados.alocacoes);
  const propostas = dados.propostas.map((p) => calcularProposta(p, indice, visiveis));
  return { propostas, visiveis };
}

const nomeDe = (dados: DadosEficiencia, codfor: number) => dados.nomes.get(codfor) ?? `Consultor ${codfor}`;

// ---------- opções de filtro ----------
eficienciaRouter.get("/filtros", async (_req, res) => {
  try {
    const acesso = acessoDe(res);
    const deps = await carregarDepartamentosDoEscopo(escopoDe(acesso));
    res.json({
      sistemas: SISPRO_ORDER.map((valor) => ({ valor, rotulo: sisproLabel(valor) })),
      departamentos: deps.map((valor) => ({ valor, rotulo: depexeLabel(valor) })),
      situacoes: SITPRO_ATIVIDADES_VISIVEIS.map((valor) => ({ valor, rotulo: sitproLabel(valor) })),
    });
  } catch (error) {
    handleError(res, error, "filtros");
  }
});

// ---------- painel completo (todas as abas, uma consulta) ----------
// A carteira ativa é pequena (centenas de propostas, ~1 s), então as abas saem de UM payload e a
// troca de aba é instantânea. Só a gaveta (proposta/consultor) busca por demanda.
eficienciaRouter.get("/painel", async (req: AuthenticatedRequest, res) => {
  try {
    const acesso = acessoDe(res);
    const filtros = lerFiltros(req.query);
    const capacidadeMin = lerCapacidadeMin(req.query);
    const esc = escopoDe(acesso);

    const [dados, tendencia, apontadoSemItem] = await Promise.all([
      carregarDados(filtros, esc),
      carregarTendencia(filtros, esc, 12),
      acesso.admin ? carregarApontadoSemItem() : Promise.resolve(null),
    ]);
    const { propostas, visiveis } = await calcular(dados, acesso);

    const consultores = calcularConsultores(propostas, capacidadeMin)
      .filter((c) => c.executado > 0 || c.pendente >= 30 || c.revisar >= 30)
      .sort((a, b) => b.pendente - a.pendente || b.executado - a.executado);
    const resumo = resumirCarteira(propostas);
    const alertas = montarAlertas(propostas, consultores, dados.nomes);
    const pareto = paretoDoEstouro(propostas);

    const pendenteTotal = consultores.reduce((t, c) => t + c.pendente, 0);
    const revisarTotal = consultores.reduce((t, c) => t + c.revisar, 0);

    // Itens com estouro e sem valor-hora: o impacto em R$ deles sai zerado, então avisamos.
    let estouroSemValorHora = 0;
    let itensSemValorHora = 0;
    for (const p of propostas) {
      for (const i of p.itens) {
        if (i.acima > 0 && !(i.valhor && i.valhor > 0)) {
          itensSemValorHora++;
          estouroSemValorHora += i.acima;
        }
      }
    }

    res.json({
      meta: {
        geradoEm: new Date().toISOString(),
        escopo: acesso.admin ? "admin" : "gestor",
        departamentosGerenciados: acesso.admin ? null : acesso.contexto.departamentosGerenciados.map((d) => ({ valor: d, rotulo: depexeLabel(d) })),
        capacidadeHorasMes: capacidadeMin / 60,
        limiares: LIMIARES,
      },
      resumo,
      carga: {
        pendente: pendenteTotal,
        meses: capacidadeMin > 0 ? pendenteTotal / capacidadeMin : 0,
        consultoresComCarga: consultores.filter((c) => c.pendente >= 60).length,
        consultoresEmSobrecarga: consultores.filter((c) => c.meses > LIMIARES.mesesSobrecarga).length,
        revisar: revisarTotal,
      },
      alertas,
      pareto,
      faixas: faixasDeConsumo(propostas),
      tendencia,
      propostas: propostas.map((p) => ({
        codemp: p.codemp,
        codpro: p.codpro,
        codcli: p.codcli,
        cliente: p.cliente,
        sitpro: p.sitpro,
        sitproRotulo: sitproLabel(p.sitpro),
        sispro: p.sispro,
        sisproRotulo: sisproLabel(p.sispro),
        depexe: p.depexe,
        depexeRotulo: depexeLabel(p.depexe),
        interna: p.interna,
        vendido: p.vendido,
        executado: p.executado,
        acima: p.acima,
        saldo: p.saldo,
        impacto: p.impacto,
        semAlocacao: p.semAlocacao,
        consumo: p.consumo,
        eficiencia: p.eficiencia,
        situacao: p.situacao,
        critico: p.critico,
        faixa: faixaDaProposta(p),
        itens: p.itens.length,
      })),
      equipe: {
        consultores: consultores.map((c) => ({
          codfor: c.codfor,
          nome: nomeDe(dados, c.codfor),
          departamento: dados.departamentos.get(c.codfor) ?? null,
          alocado: c.alocado,
          executado: c.executado,
          eficiencia: c.eficiencia,
          pendente: c.pendente,
          revisar: c.revisar,
          meses: c.meses,
          propostasComSaldo: c.propostasComSaldo,
        })),
        mapa: montarMapa(consultores, propostas, dados),
      },
      clientes: calcularClientes(propostas).sort((a, b) => b.acima - a.acima || b.executado - a.executado),
      qualidade: montarQualidade(propostas, dados, apontadoSemItem, { itensSemValorHora, estouroSemValorHora }),
      timeVisivel: visiveis == null ? null : visiveis.size,
    });
  } catch (error) {
    handleError(res, error, "painel");
  }
});

// Mapa de alocação: horas executadas dos consultores com mais horas nas propostas com mais horas.
function montarMapa(consultores: ConsultorCalculado[], propostas: PropostaCalculada[], dados: DadosEficiencia) {
  const linhas = consultores.filter((c) => c.executado > 0).sort((a, b) => b.executado - a.executado).slice(0, 12);
  const horasNaProposta = (c: ConsultorCalculado, codemp: number, codpro: number) =>
    c.porProposta.find((x) => x.codemp === codemp && x.codpro === codpro);
  const colunas = propostas
    .map((p) => ({ p, k: linhas.reduce((t, c) => t + (horasNaProposta(c, p.codemp, p.codpro)?.executado ?? 0), 0) }))
    .filter((x) => x.k > 0)
    .sort((a, b) => b.k - a.k)
    .slice(0, 14);
  return {
    consultores: linhas.map((c) => ({ codfor: c.codfor, nome: nomeDe(dados, c.codfor), executado: c.executado })),
    propostas: colunas.map(({ p }) => ({ codemp: p.codemp, codpro: p.codpro, cliente: p.cliente, executado: p.executado })),
    celulas: linhas.flatMap((c) =>
      colunas.flatMap(({ p }) => {
        const v = horasNaProposta(c, p.codemp, p.codpro);
        return v && v.executado > 0
          ? [{ codfor: c.codfor, codemp: p.codemp, codpro: p.codpro, executado: v.executado, alocado: v.alocado, parteDaProposta: p.executado > 0 ? v.executado / p.executado : 0 }]
          : [];
      })
    ),
  };
}

function montarQualidade(
  propostas: PropostaCalculada[],
  dados: DadosEficiencia,
  apontadoSemItem: { apontamentos: number; minutos: number } | null,
  valorHora: { itensSemValorHora: number; estouroSemValorHora: number }
) {
  const semAlocacao = propostas
    .filter((p) => p.semAlocacao >= 60)
    .sort((a, b) => b.semAlocacao - a.semAlocacao)
    .slice(0, 30)
    .map((p) => ({ codemp: p.codemp, codpro: p.codpro, cliente: p.cliente, semAlocacao: p.semAlocacao, executado: p.executado }));

  const aRevisar = propostas
    .flatMap((p) =>
      p.itens.flatMap((i) =>
        i.consultores
          .filter((c) => c.revisar >= 30)
          .map((c) => ({
            codemp: p.codemp,
            codpro: p.codpro,
            cliente: p.cliente,
            seqite: i.seqite,
            item: i.descricao,
            codfor: c.codfor,
            consultor: nomeDe(dados, c.codfor),
            alocado: c.alocado,
            executado: c.executado,
            revisar: c.revisar,
          }))
      )
    )
    .sort((a, b) => b.revisar - a.revisar)
    .slice(0, 40);

  // Propostas fora da curva (consumo >= 300% e 200 h ou mais acima): distorcem totais e médias.
  const atipicas = propostas
    .filter((p) => (p.consumo == null || p.consumo >= 3) && p.acima >= 200 * 60)
    .sort((a, b) => b.acima - a.acima)
    .map((p) => ({ codemp: p.codemp, codpro: p.codpro, cliente: p.cliente, vendido: p.vendido, executado: p.executado, acima: p.acima, consumo: p.consumo }));

  return {
    semAlocacao,
    aRevisar,
    atipicas,
    itensSemValorHora: valorHora.itensSemValorHora,
    estouroSemValorHora: valorHora.estouroSemValorHora,
    // Só o admin: apontamento sem item de proposta não pertence a escopo de gestor nenhum.
    apontadoSemItem,
  };
}

// ---------- gaveta: uma proposta ----------
eficienciaRouter.get("/propostas/:codemp/:codpro", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    if (!Number.isInteger(codemp) || !Number.isInteger(codpro)) {
      res.status(400).json({ error: "Proposta inválida" });
      return;
    }
    const acesso = acessoDe(res);
    const dados = await carregarDados({ tipo: "all", sitpro: [], sispro: null, depexe: null, proposta: { codemp, codpro } }, escopoDe(acesso));
    const { propostas } = await calcular(dados, acesso);
    const p = propostas[0];
    if (!p) {
      res.status(404).json({ error: "Proposta não encontrada no seu escopo" });
      return;
    }
    res.json({
      codemp: p.codemp,
      codpro: p.codpro,
      codcli: p.codcli,
      cliente: p.cliente,
      sitproRotulo: sitproLabel(p.sitpro),
      sisproRotulo: sisproLabel(p.sispro),
      depexeRotulo: depexeLabel(p.depexe),
      interna: p.interna,
      vendido: p.vendido,
      executado: p.executado,
      dentro: p.dentro,
      acima: p.acima,
      saldo: p.saldo,
      impacto: p.impacto,
      semAlocacao: p.semAlocacao,
      consumo: p.consumo,
      eficiencia: p.eficiencia,
      situacao: p.situacao,
      critico: p.critico,
      itensPorSituacao: p.itensPorSituacao,
      itens: p.itens.map((i) => ({
        seqite: i.seqite,
        descricao: i.descricao,
        servico: i.servico,
        depexeRotulo: depexeLabel(i.depexe),
        fatserRotulo: fatserLabel(i.fatser),
        vendido: i.vendido,
        executado: i.executado,
        consumo: i.consumo,
        situacao: i.situacao,
        acima: i.acima,
        saldo: i.saldo,
        impacto: i.impacto,
        valhor: i.valhor,
        semAlocacao: i.semAlocacao,
        outros: i.outros,
        consultores: i.consultores.map((c) => ({ ...c, nome: nomeDe(dados, c.codfor) })),
      })),
    });
  } catch (error) {
    handleError(res, error, "proposta");
  }
});

// ---------- gaveta: um consultor ----------
eficienciaRouter.get("/consultores/:codfor", async (req: AuthenticatedRequest, res) => {
  try {
    const codfor = Number(req.params.codfor);
    if (!Number.isInteger(codfor)) {
      res.status(400).json({ error: "Consultor inválido" });
      return;
    }
    const acesso = acessoDe(res);
    const visiveis = await codforsDoTime(acesso.admin ? "admin" : "gestor", acesso.contexto);
    if (visiveis != null && !visiveis.has(codfor)) {
      res.status(403).json({ error: "Consultor fora do seu time" });
      return;
    }
    const capacidadeMin = lerCapacidadeMin(req.query);
    const dados = await carregarDados({ tipo: "all", sitpro: [], sispro: null, depexe: null }, escopoDe(acesso));
    const { propostas } = await calcular(dados, acesso);
    const c = calcularConsultores(propostas, capacidadeMin).find((x) => x.codfor === codfor);
    if (!c) {
      res.status(404).json({ error: "Consultor sem alocação nas propostas ativas" });
      return;
    }

    const itens = propostas
      .flatMap((p) =>
        p.itens.flatMap((i) =>
          i.consultores
            .filter((x) => x.codfor === codfor)
            .map((x) => ({
              codemp: p.codemp,
              codpro: p.codpro,
              cliente: p.cliente,
              seqite: i.seqite,
              descricao: i.descricao,
              alocado: x.alocado,
              executado: x.executado,
              pendente: x.pendente,
              revisar: x.revisar,
              vendidoItem: i.vendido,
              executadoItem: i.executado,
              situacaoItem: i.situacao,
            }))
        )
      )
      .sort((a, b) => b.pendente + b.revisar - (a.pendente + a.revisar) || b.executado - a.executado);

    res.json({
      codfor,
      nome: nomeDe(dados, codfor),
      departamento: dados.departamentos.get(codfor) ?? null,
      alocado: c.alocado,
      executado: c.executado,
      eficiencia: c.eficiencia,
      pendente: c.pendente,
      revisar: c.revisar,
      meses: c.meses,
      propostasComSaldo: c.propostasComSaldo,
      capacidadeHorasMes: capacidadeMin / 60,
      itens,
    });
  } catch (error) {
    handleError(res, error, "consultor");
  }
});
