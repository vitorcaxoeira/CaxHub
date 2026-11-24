import { NextFunction, Response, Router } from "express";
import { Prisma } from "@prisma/client";
import { AuthenticatedRequest, requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdEficienciaApontamento } from "../audit/identidadeEntidade";
import { codforsDoTime, consultoresDosDepartamentos, gerenciaDepartamento } from "../domain/contextoProjeto";
import { AcessoEficiencia, calcular, carregarPropostaNoEscopo, ehGestor, escopoDe, resolverAcesso } from "../domain/eficienciaAcesso";
import { contagemDeAcoes, eficienciaAcoesRouter } from "./eficienciaAcoes";
import {
  DadosEficiencia,
  ExclusaoAtiva,
  FiltrosEficiencia,
  carregarApontadoSemItem,
  carregarApontamentosDoItem,
  carregarClientesDoEscopo,
  carregarDados,
  carregarDepartamentosDoEscopo,
  carregarExclusoesAtivas,
  carregarExecucaoPorConsultor,
  carregarPropostasDoEscopo,
  carregarTendencia,
} from "../domain/eficienciaDados";
import { financeiroDaProposta, financeiroPorCliente, resumirFinanceiro } from "../domain/eficienciaFinanceiro";
import {
  aplicarIgnorados,
  chaveConsultorNaProposta,
  chaveItem,
  consultoresComoLista,
  itensComoLista,
  lerIgnoradosNaProposta,
  propostasComConsultorIgnorado,
  temIgnorados,
} from "../domain/eficienciaIgnorados";
import { MOTIVOS_EXCLUSAO, rotuloMotivoExclusao, validarExclusao } from "../domain/eficienciaExclusoes";
import { SITRAT_CANCELADO } from "../domain/ratDominio";
import {
  ConsultorCalculado,
  LIMIARES,
  PropostaCalculada,
  modoEstouroValido,
  calcularClientes,
  calcularConsultores,
  faixaDaProposta,
  faixasDeConsumo,
  montarAlertas,
  ordenarAlertas,
  paretoDoEstouro,
  resumirCarteira,
  ehAtipica,
} from "../domain/eficienciaPropostas";
import {
  CODCLI_EMPRESA_PROPRIA,
  MODPRO_ORDER,
  SITPRO_ATIVIDADES_VISIVEIS,
  depexeLabel,
  fatserLabel,
  modproLabel,
  sitproLabel,
} from "../domain/propostasDominio";
import { parseIntListParam } from "../lib/queryParams";

// Painel de Eficiência (Gestão de Projetos): vendido x executado x alocado, por proposta, equipe e
// cliente. Quem entra: admin ou gestor de algum departamento (DepartamentoGestor) — em
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

async function exigirAdminOuGestor(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const acesso = await resolverAcesso(req.user!.userId, req.user!.role);
    if (!acesso.admin && !ehGestor(acesso)) {
      res.status(403).json({ error: "Sem permissão para acessar este recurso" });
      return;
    }
    res.locals.acesso = acesso;
    next();
  } catch (error) {
    handleError(res, error, "acesso");
  }
}

// O plano de ação tem a PRÓPRIA guarda, por handler (o responsável da ação é consultor do time e não entra no painel,
// mas precisa ver e concluir a ação dele). Por isso é montado ANTES do guarda de gestor/admin abaixo.
eficienciaRouter.use("/acoes", eficienciaAcoesRouter);

eficienciaRouter.use(requireAuth, exigirAdminOuGestor);

const acessoDe = (res: Response) => res.locals.acesso as AcessoEficiencia;

function lerFiltros(q: AuthenticatedRequest["query"]): FiltrosEficiencia {
  const tipo = q.tipo === "int" || q.tipo === "all" ? q.tipo : "cli";
  const sitpro = (parseIntListParam(q.sitpro) ?? []).filter((s) => SITPRO_ATIVIDADES_VISIVEIS.includes(s));
  return { tipo, sitpro, modpro: parseIntListParam(q.modpro), codcli: parseIntListParam(q.codcli), codpro: parseIntListParam(q.codpro), depexe: parseIntListParam(q.depexe) };
}

// `ignorar=1:5937,1:5938` (codemp:codpro): propostas que a pessoa marcou pra ficar FORA de todos os cálculos do painel. É escolha
// pessoal (o navegador guarda e manda a cada consulta), não dado compartilhado: nada é gravado no servidor. A linha delas continua
// vindo na lista (com `ignorada: true`) pra poder desmarcar; só não entram em resumo, alertas, pareto, faixas, clientes, equipe nem tendência.
function lerIgnoradas(q: AuthenticatedRequest["query"]): { chaves: Set<string>; pares: { codemp: number; codpro: number }[] } {
  const chaves = new Set<string>();
  const pares: { codemp: number; codpro: number }[] = [];
  const bruto = typeof q.ignorar === "string" ? q.ignorar : "";
  for (const parte of bruto.split(",").slice(0, 300)) {
    const m = /^(\d+):(\d+)$/.exec(parte.trim());
    if (!m) continue;
    const codemp = Number(m[1]);
    const codpro = Number(m[2]);
    const chave = `${codemp}-${codpro}`;
    if (chaves.has(chave)) continue;
    chaves.add(chave);
    pares.push({ codemp, codpro });
  }
  return { chaves, pares };
}

// `ignorarConsultor=12,34` (codfor): consultores que a pessoa marcou pra ficar FORA dos indicadores da equipe (carga, eficiência,
// sobrecarga, a revisar, mapa e alertas de capacidade). Mesma ideia das propostas ignoradas: escolha pessoal, o navegador guarda e manda,
// nada é gravado. As horas das PROPOSTAS (vendido, executado, estouro) não mudam; a linha dele continua na lista pra poder desmarcar.
function lerConsultoresIgnorados(q: AuthenticatedRequest["query"]): Set<number> {
  const bruto = typeof q.ignorarConsultor === "string" ? q.ignorarConsultor : "";
  const ids = bruto
    .split(",")
    .slice(0, 300)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return new Set(ids);
}

// Capacidade mensal em projeto, em horas. Parâmetro do usuário (a jornada cadastrada é a jornada
// TOTAL, não a parte em projeto, e só 32 de 50 consultores alocados têm jornada).
function lerCapacidadeMin(q: AuthenticatedRequest["query"]): number {
  const n = Number(q.cap);
  const horas = Number.isFinite(n) && n > 0 ? Math.min(220, Math.max(20, n)) : LIMIARES.capacidadePadraoHorasMes;
  return horas * 60;
}

const nomeDe = (dados: DadosEficiencia, codfor: number) => dados.nomes.get(codfor) ?? `Consultor ${codfor}`;

// ---------- opções de filtro ----------
eficienciaRouter.get("/filtros", async (_req, res) => {
  try {
    const acesso = acessoDe(res);
    const [deps, clientes, propostas] = await Promise.all([
      carregarDepartamentosDoEscopo(escopoDe(acesso)),
      carregarClientesDoEscopo(escopoDe(acesso)),
      carregarPropostasDoEscopo(escopoDe(acesso)),
    ]);
    res.json({
      modalidades: MODPRO_ORDER.map((valor) => ({ valor, rotulo: modproLabel(valor) })),
      clientes: clientes.map((c) => ({ valor: c.codcli, rotulo: c.nome })),
      // Só as do escopo do usuário. `codcli`/`interna` deixam a tela limitar a lista ao cliente e ao tipo (De clientes / Internas) já escolhidos.
      propostas: propostas.map((p) => ({ valor: p.codpro, rotulo: `PS ${p.codpro} · ${p.cliente}`, codcli: p.codcli, interna: p.codcli === CODCLI_EMPRESA_PROPRIA })),
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
    const ignoradas = lerIgnoradas(req.query);
    const consultoresIgnorados = lerConsultoresIgnorados(req.query);
    const ignNaProposta = lerIgnoradosNaProposta(req.query);
    const modo = modoEstouroValido(req.query.estouro);
    const esc = escopoDe(acesso);

    const [dadosBrutos, tendencia, apontadoSemItem, exclusoesAtivas, acoes] = await Promise.all([
      carregarDados(filtros, esc),
      // A tendência é SQL: recebe as ignoradas pra sair com o mesmo recorte do resto da tela.
      carregarTendencia(filtros, esc, 12, ignoradas.pares, { itens: itensComoLista(ignNaProposta), consultores: consultoresComoLista(ignNaProposta) }, modo),
      acesso.admin ? carregarApontadoSemItem() : Promise.resolve(null),
      carregarExclusoesAtivas(filtros, esc),
      contagemDeAcoes(acesso),
    ]);
    // Item e consultor (numa proposta) ignorados pela pessoa: saem dos dados ANTES de qualquer conta, então lista, resumo, equipe,
    // clientes e alertas concordam. As horas por consultor só são lidas das propostas que têm consultor ignorado.
    const { dados, efetivos: ignoradosNaProposta } = aplicarIgnorados(
      dadosBrutos,
      ignNaProposta,
      await carregarExecucaoPorConsultor(propostasComConsultorIgnorado(ignNaProposta))
    );
    // Filtro de departamento: além de recortar as propostas, recorta a EQUIPE ao time desses departamentos (mesma ideia do
    // líder, que só vê o time dele). Sem filtro, vale só o recorte do acesso (admin = todos; gestor = o time dele).
    const timeDosDepartamentos = filtros.depexe && filtros.depexe.length > 0 ? await codforsDosDepartamentos(filtros.depexe) : null;
    const { propostas: todas, visiveis } = await calcular(dados, acesso, timeDosDepartamentos, null, modo);
    // Com consultor ignorado, as contas de equipe usam um segundo cálculo (ele vira "outros"); `todas` segue completo pra lista dele.
    const todasParaEquipe = consultoresIgnorados.size > 0 ? (await calcular(dados, acesso, timeDosDepartamentos, consultoresIgnorados, modo)).propostas : todas;
    // `todas` = tudo que a lista mostra (inclusive as ignoradas, pra dar pra desmarcar); `propostas` = o que ENTRA nos números.
    const chaveDe = (p: { codemp: number; codpro: number }) => `${p.codemp}-${p.codpro}`;
    const propostas = todasParaEquipe.filter((p) => !ignoradas.chaves.has(chaveDe(p)));
    const atipicas = todas.filter(ehAtipica);

    const aparece = (c: ConsultorCalculado) => c.executado > 0 || c.pendente >= 30 || c.revisar >= 30;
    const consultores = calcularConsultores(propostas, capacidadeMin)
      .filter(aparece)
      .sort((a, b) => b.pendente - a.pendente || b.executado - a.executado);
    // Os ignorados saem das contas acima, mas a linha deles (com os números de verdade) continua na lista, esmaecida, pra desmarcar.
    const linhasIgnoradas =
      consultoresIgnorados.size > 0
        ? calcularConsultores(
            todas.filter((p) => !ignoradas.chaves.has(chaveDe(p))),
            capacidadeMin
          ).filter((c) => consultoresIgnorados.has(c.codfor) && aparece(c))
        : [];
    const resumo = resumirCarteira(propostas);
    // O alerta do plano de ação vem do banco (não da conta de horas): entra na mesma lista e reordena.
    const alertasDeHoras = montarAlertas(propostas, consultores, dados.nomes);
    const alertas = ordenarAlertas(
      acoes.atrasadas > 0
        ? [
            ...alertasDeHoras,
            {
              severidade: "bad" as const,
              rotulo: "Plano de ação",
              peso: 5000 + acoes.atrasadas * 60,
              titulo: `${acoes.atrasadas} ${acoes.atrasadas > 1 ? "ações atrasadas" : "ação atrasada"} no plano de ação`,
              detalhe: "Prazo vencido sem concluir. Cobre o responsável ou renegocie o prazo.",
              alvo: { tipo: "aba" as const, aba: "acoes" as const, filtro: "atrasadas" },
            },
          ]
        : alertasDeHoras
    );
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
        // Quantos itens e consultores-numa-proposta a pessoa tem ignorados (só os que existem nos dados): alimenta a faixa de aviso.
        ignoradosNaProposta,
        // Como o estouro está sendo lido: "item" (soma do estouro de cada item) ou "proposta" (total da proposta).
        modoEstouro: modo,
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
      propostas: todas.map((p) => ({
        ignorada: ignoradas.chaves.has(chaveDe(p)),
        atipica: ehAtipica(p),
        codemp: p.codemp,
        codpro: p.codpro,
        codcli: p.codcli,
        cliente: p.cliente,
        sitpro: p.sitpro,
        sitproRotulo: sitproLabel(p.sitpro),
        modpro: p.modpro,
        modproRotulo: modproLabel(p.modpro),
        depexe: p.depexe,
        depexeRotulo: depexeLabel(p.depexe),
        interna: p.interna,
        vendido: p.vendido,
        executado: p.executado,
        acima: p.acima,
        saldo: p.saldo,
        impacto: p.impacto,
        acimaPorItem: p.acimaPorItem,
        acimaGlobal: p.acimaGlobal,
        semAlocacao: p.semAlocacao,
        consumo: p.consumo,
        eficiencia: p.eficiencia,
        situacao: p.situacao,
        critico: p.critico,
        faixa: faixaDaProposta(p),
        itens: p.itens.length,
      })),
      equipe: {
        consultores: [...consultores.map((c) => ({ c, ignorado: false })), ...linhasIgnoradas.map((c) => ({ c, ignorado: true }))].map(({ c, ignorado }) => ({
          ignorado,
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
      // Eficiência financeira (base: valor-hora de VENDA do item; não é faturamento nem custo). Mesmo recorte e mesmo modo de estouro do resto.
      financeiro: {
        resumo: resumirFinanceiro(propostas),
        clientes: financeiroPorCliente(propostas).sort((a, b) => b.valorAcima - a.valorAcima || b.valorExecutado - a.valorExecutado),
        propostas: propostas
          .map((p) => ({ codemp: p.codemp, codpro: p.codpro, codcli: p.codcli, cliente: p.cliente, sitproRotulo: sitproLabel(p.sitpro), interna: p.interna, ...financeiroDaProposta(p) }))
          .sort((a, b) => b.valorAcima - a.valorAcima || b.valorExecutado - a.valorExecutado),
      },
      exclusoes: await montarExclusoes(
        exclusoesAtivas,
        acesso,
        visiveis,
        // Proposta, item ou consultor ignorado está fora da conta: as exclusões de apontamento dele também saem da lista.
        ignoradas.chaves,
        ignNaProposta
      ),
      motivosExclusao: MOTIVOS_EXCLUSAO,
      acoes,
      qualidade: montarQualidade(propostas, atipicas, ignoradas.chaves, dados, apontadoSemItem, { itensSemValorHora, estouroSemValorHora }),
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
  atipicas: PropostaCalculada[],
  ignoradas: Set<string>,
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

  // Propostas fora da curva (critério único: ehAtipica em eficienciaPropostas.ts). Lista TODAS, inclusive as que a pessoa já
  // ignorou (com a marca), pra ela saber o que está dentro e fora da conta.
  const listaAtipicas = [...atipicas]
    .sort((a, b) => b.acima - a.acima)
    .map((p) => ({ codemp: p.codemp, codpro: p.codpro, cliente: p.cliente, vendido: p.vendido, executado: p.executado, acima: p.acima, consumo: p.consumo, ignorada: ignoradas.has(`${p.codemp}-${p.codpro}`) }));

  return {
    semAlocacao,
    aRevisar,
    atipicas: listaAtipicas,
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
    const ign = lerIgnoradosNaProposta(req.query);
    const modo = modoEstouroValido(req.query.estouro);
    const dados = await carregarDados({ tipo: "all", sitpro: [], modpro: null, codcli: null, depexe: null, proposta: { codemp, codpro } }, escopoDe(acesso));
    const { propostas, visiveis } = await calcular(dados, acesso, null, null, modo);
    const completa = propostas[0];
    if (!completa) {
      res.status(404).json({ error: "Proposta não encontrada no seu escopo" });
      return;
    }
    // `completa` = a proposta SEM ignorar nada (os números reais, que a lista mostra pra dar pra desmarcar); `p` = a que vale pros
    // indicadores do topo, já sem os itens e consultores que a pessoa ignorou.
    const execucao = await carregarExecucaoPorConsultor([{ codemp, codpro }]);
    const { dados: dadosVigentes, efetivos } = aplicarIgnorados(dados, ign, execucao);
    const p = temIgnorados(ign) ? ((await calcular(dadosVigentes, acesso, null, null, modo)).propostas[0] ?? completa) : completa;
    const itemVigente = new Map(p.itens.map((i) => [i.seqite, i]));
    const itensDaLista = completa.itens.map((completo) => {
      const ignorado = ign.itens.has(chaveItem(codemp, codpro, completo.seqite));
      return { ignorado, i: ignorado ? completo : itemVigente.get(completo.seqite) ?? completo };
    });

    // Aba Consultores: quem apontou horas nesta proposta (RatItem por consultor), com o que cada um tem de alocação. Só o time do
    // usuário aparece com nome e pode ser ignorado; os demais entram somados em "outros" (mesma regra do resto do painel).
    const itensQueContam = new Set(itensDaLista.filter((x) => !x.ignorado).map((x) => x.i.seqite));
    const executadoBase = itensDaLista.filter((x) => !x.ignorado).reduce((t, x) => t + x.i.executado, 0);
    const porConsultor = new Map<number, { executado: number; itens: Set<number> }>();
    for (const e of execucao) {
      const atual = porConsultor.get(e.codfor) ?? { executado: 0, itens: new Set<number>() };
      if (itensQueContam.has(e.seqite)) {
        atual.executado += e.minutos;
        atual.itens.add(e.seqite);
      }
      porConsultor.set(e.codfor, atual);
    }
    const alocadoPorConsultor = new Map<number, number>();
    for (const a of dados.alocacoes) {
      if (itensQueContam.has(a.seqite)) alocadoPorConsultor.set(a.codfor, (alocadoPorConsultor.get(a.codfor) ?? 0) + a.alocado);
    }
    const idsVisiveis = [...porConsultor.keys()].filter((c) => visiveis == null || visiveis.has(c));
    const nomesDosConsultores = await nomesVisiveisDeConsultores(idsVisiveis, visiveis);
    const listaConsultores = idsVisiveis
      .map((codfor) => {
        const x = porConsultor.get(codfor)!;
        return {
          codfor,
          nome: nomesDosConsultores.get(codfor) ?? nomeDe(dados, codfor),
          executado: x.executado,
          alocado: alocadoPorConsultor.get(codfor) ?? 0,
          itens: x.itens.size,
          parte: executadoBase > 0 ? x.executado / executadoBase : 0,
          ignorado: ign.consultores.has(chaveConsultorNaProposta(codemp, codpro, codfor)),
        };
      })
      .sort((a, b) => b.executado - a.executado);
    const outros = [...porConsultor.entries()].filter(([c]) => !(visiveis == null || visiveis.has(c)));
    res.json({
      ignorados: efetivos,
      // Quando algo está ignorado, os números do topo são os "vigentes"; aqui vão os de antes pra pessoa ver a diferença.
      semIgnorar: temIgnorados(ign) ? { vendido: completa.vendido, executado: completa.executado, acima: completa.acima } : null,
      consultores: listaConsultores,
      outrosConsultores: { quantidade: outros.length, executado: outros.reduce((t, [, x]) => t + x.executado, 0) },
      codemp: p.codemp,
      codpro: p.codpro,
      codcli: p.codcli,
      cliente: p.cliente,
      sitproRotulo: sitproLabel(p.sitpro),
      modproRotulo: modproLabel(p.modpro),
      depexeRotulo: depexeLabel(p.depexe),
      interna: p.interna,
      vendido: p.vendido,
      executado: p.executado,
      dentro: p.dentro,
      acima: p.acima,
      saldo: p.saldo,
      impacto: p.impacto,
      // Os dois jeitos de ler o estouro: o do modo escolhido já está em `acima`; estes mostram o outro pra comparar.
      modoEstouro: modo,
      acimaPorItem: p.acimaPorItem,
      acimaGlobal: p.acimaGlobal,
      valorVendido: p.valorVendido,
      valorExecutado: p.valorExecutado,
      semAlocacao: p.semAlocacao,
      consumo: p.consumo,
      eficiencia: p.eficiencia,
      situacao: p.situacao,
      critico: p.critico,
      itensPorSituacao: p.itensPorSituacao,
      itens: itensDaLista.map(({ ignorado, i }) => ({
        ignorado,
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
    const dados = await carregarDados({ tipo: "all", sitpro: [], modpro: null, codcli: null, depexe: null }, escopoDe(acesso));
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

// ======================================================================================================
// Exclusão de apontamento do cálculo DO PAINEL (só do painel: não mexe em RAT, teto da Alocação nem Senior).
// Quem decide: admin, ou o gestor do departamento do item ou da proposta (mesma lógica de podeMexerNoItem na Alocação).
// ======================================================================================================

function podeDecidirExclusao(acesso: AcessoEficiencia, depexeItem: number | null, depexeProposta: number | null): boolean {
  if (acesso.admin) return true;
  return (
    (depexeItem != null && gerenciaDepartamento("gestor", acesso.contexto, depexeItem)) ||
    (depexeProposta != null && gerenciaDepartamento("gestor", acesso.contexto, depexeProposta))
  );
}

// Nome só de quem o usuário pode ver (o time dele; admin vê todos). Os demais ficam sem nome ("Outro consultor" na tela).
async function nomesVisiveisDeConsultores(codfors: (number | null)[], visiveis: Set<number> | null): Promise<Map<number, string>> {
  const ids = [...new Set(codfors.filter((c): c is number => c != null && (visiveis == null || visiveis.has(c))))];
  if (ids.length === 0) return new Map();
  const linhas = await prisma.consultor.findMany({ where: { codfor: { in: ids } }, select: { codfor: true, nomcom: true, nomfor: true } });
  const mapa = new Map<number, string>();
  for (const c of linhas) if (c.codfor != null && !mapa.has(c.codfor)) mapa.set(c.codfor, c.nomcom ?? c.nomfor ?? `Fornecedor ${c.codfor}`);
  return mapa;
}

async function nomesDeUsuarios(ids: (number | null)[]): Promise<Map<number, string>> {
  const unicos = [...new Set(ids.filter((i): i is number => i != null))];
  if (unicos.length === 0) return new Map();
  const linhas = await prisma.user.findMany({ where: { id: { in: unicos } }, select: { id: true, nome: true } });
  return new Map(linhas.map((u) => [u.id, u.nome]));
}

async function montarExclusoes(
  lista: ExclusaoAtiva[],
  acesso: AcessoEficiencia,
  visiveis: Set<number> | null,
  propostasOcultas: Set<string>,
  ignNaProposta: ReturnType<typeof lerIgnoradosNaProposta>
) {
  const efetivas = lista.filter(
    (e) =>
      !propostasOcultas.has(`${e.codemp}-${e.codpro}`) &&
      !ignNaProposta.itens.has(chaveItem(e.codemp, e.codpro, e.seqite)) &&
      !(e.codfor != null && ignNaProposta.consultores.has(chaveConsultorNaProposta(e.codemp, e.codpro, e.codfor)))
  );
  const [consultores, usuarios] = await Promise.all([
    nomesVisiveisDeConsultores(efetivas.map((e) => e.codfor), visiveis),
    nomesDeUsuarios(efetivas.map((e) => e.excluidoPor)),
  ]);
  return {
    total: efetivas.length,
    minutos: efetivas.reduce((t, e) => t + e.minutos, 0),
    lista: efetivas.map((e) => ({
      id: e.id,
      ratItemId: e.ratItemId,
      codemp: e.codemp,
      codpro: e.codpro,
      cliente: e.cliente,
      seqite: e.seqite,
      item: e.item,
      consultor: e.codfor != null ? consultores.get(e.codfor) ?? null : null,
      minutos: e.minutos,
      motivo: e.motivo,
      motivoRotulo: rotuloMotivoExclusao(e.motivo),
      observacao: e.observacao,
      excluidoPorNome: usuarios.get(e.excluidoPor) ?? "—",
      excluidoEm: e.excluidoEm,
      podeRestaurar: podeDecidirExclusao(acesso, e.depexeItem, e.depexeProposta),
    })),
  };
}

// Codfors do time (DepartamentoTime ativo) dos departamentos escolhidos no filtro.
async function codforsDosDepartamentos(depexes: number[]): Promise<Set<number>> {
  const consultores = await consultoresDosDepartamentos(depexes);
  return new Set(consultores.map((c) => c.codfor).filter((c): c is number => c != null));
}

function inteiroPositivo(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

class ConflitoExclusao extends Error {}

// ---------- lista de apontamentos de um item (de onde o gestor escolhe o que tirar do cálculo) ----------
eficienciaRouter.get("/propostas/:codemp/:codpro/itens/:seqite/apontamentos", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = inteiroPositivo(req.params.codemp);
    const codpro = inteiroPositivo(req.params.codpro);
    const seqite = inteiroPositivo(req.params.seqite);
    if (codemp == null || codpro == null || seqite == null) {
      res.status(400).json({ error: "Item inválido" });
      return;
    }
    const acesso = acessoDe(res);
    const alvo = await carregarPropostaNoEscopo(codemp, codpro, acesso);
    const item = alvo?.p.itens.find((i) => i.seqite === seqite);
    if (!alvo || !item) {
      res.status(404).json({ error: "Item não encontrado no seu escopo" });
      return;
    }
    const { linhas, total, minutosTotal } = await carregarApontamentosDoItem(codemp, codpro, seqite);
    const [consultores, usuarios] = await Promise.all([
      nomesVisiveisDeConsultores(linhas.map((l) => l.codfor), alvo.visiveis),
      nomesDeUsuarios(linhas.map((l) => l.excluidoPor)),
    ]);
    res.json({
      podeDecidir: podeDecidirExclusao(acesso, item.depexe, alvo.p.depexe),
      total,
      minutosTotal,
      truncado: total > linhas.length,
      apontamentos: linhas.map((l) => ({
        id: l.id,
        data: l.data,
        horini: l.horini,
        horfim: l.horfim,
        minutos: l.horini != null && l.horfim != null ? l.horfim - l.horini : 0,
        descricao: l.descricao,
        numrat: l.numrat,
        consultor: l.codfor != null ? consultores.get(l.codfor) ?? null : null,
        excluido: l.exclusaoId != null,
        motivo: l.motivo,
        motivoRotulo: l.motivo ? rotuloMotivoExclusao(l.motivo) : null,
        observacao: l.observacao,
        excluidoPorNome: l.excluidoPor != null ? usuarios.get(l.excluidoPor) ?? "—" : null,
        excluidoEm: l.excluidoEm,
      })),
    });
  } catch (error) {
    handleError(res, error, "apontamentos-do-item");
  }
});

// ---------- excluir um apontamento do cálculo ----------
eficienciaRouter.post("/apontamentos/:ratItemId/excluir", async (req: AuthenticatedRequest, res) => {
  try {
    const ratItemId = inteiroPositivo(req.params.ratItemId);
    if (ratItemId == null) {
      res.status(400).json({ error: "Apontamento inválido" });
      return;
    }
    const validacao = validarExclusao(req.body);
    if (!validacao.ok) {
      res.status(400).json({ error: validacao.erro });
      return;
    }
    const acesso = acessoDe(res);
    const ri = await prisma.ratItem.findUnique({
      where: { id: ratItemId },
      include: { rat: { select: { codfor: true, sitrat: true, removidoEmSenior: true } } },
    });
    // Só conta no painel o apontamento válido (mesma regra do SQL): RAT cancelada/excluída ou sem horário não tem o que excluir.
    if (
      !ri ||
      ri.removidoEmSenior != null ||
      ri.rat.removidoEmSenior != null ||
      ri.rat.sitrat === SITRAT_CANCELADO ||
      ri.horini == null ||
      ri.horfim == null ||
      ri.horfim <= ri.horini
    ) {
      res.status(404).json({ error: "Apontamento não encontrado ou já fora do cálculo" });
      return;
    }
    if (ri.codpro == null || ri.seqite == null || ri.seqite === 0) {
      res.status(400).json({ error: "Este apontamento não está ligado a um item de proposta" });
      return;
    }
    const codpro = ri.codpro;
    const seqite = ri.seqite;
    const alvo = await carregarPropostaNoEscopo(ri.codemp, codpro, acesso);
    const item = alvo?.p.itens.find((i) => i.seqite === seqite);
    if (!alvo || !item) {
      res.status(404).json({ error: "Item não encontrado no seu escopo" });
      return;
    }
    if (!podeDecidirExclusao(acesso, item.depexe, alvo.p.depexe)) {
      res.status(403).json({ error: "Só o gestor do item (ou um administrador) pode tirar um apontamento do cálculo" });
      return;
    }

    const minutos = ri.horfim - ri.horini;
    const motivoRotulo = rotuloMotivoExclusao(validacao.motivo);
    try {
      const criada = await prisma.$transaction(async (tx) => {
        const ativa = await tx.apontamentoForaDoCalculo.findFirst({ where: { ratItemId, restauradoEm: null }, select: { id: true } });
        if (ativa) throw new ConflitoExclusao();
        const nova = await tx.apontamentoForaDoCalculo.create({
          data: {
            ratItemId,
            codemp: ri.codemp,
            codpro,
            seqite,
            codfor: ri.rat.codfor,
            minutos,
            motivo: validacao.motivo,
            observacao: validacao.observacao,
            excluidoPor: req.user!.userId,
          },
        });
        await criarEventoAuditoria(
          {
            origem: "tela",
            usuarioId: req.user!.userId,
            codemp: ri.codemp,
            codpro,
            entidadeTipo: ENTIDADES_AUDITORIA.EFICIENCIA_APONTAMENTO,
            entidadeId: entidadeIdEficienciaApontamento(ratItemId),
            entidadeRotulo: `Apontamento #${ratItemId} · PS ${codpro} item ${seqite}`,
            eventoTipo: EVENTOS_AUDITORIA.EFICIENCIA_APONTAMENTO_EXCLUIDO,
            metadata: { motivo: validacao.motivo, motivoRotulo, observacao: validacao.observacao, minutos, seqite, codfor: ri.rat.codfor, data: ri.datati },
            correlationId: req.correlationId!,
          },
          tx
        );
        return nova;
      });
      res.status(201).json({ id: criada.id, ratItemId, minutos });
    } catch (e) {
      // Duas exclusões simultâneas do mesmo apontamento: o índice único parcial barra a segunda.
      if (e instanceof ConflitoExclusao || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) {
        res.status(409).json({ error: "Este apontamento já está fora do cálculo" });
        return;
      }
      throw e;
    }
  } catch (error) {
    handleError(res, error, "excluir-apontamento");
  }
});

// ---------- devolver o apontamento ao cálculo ----------
eficienciaRouter.post("/apontamentos/:ratItemId/restaurar", async (req: AuthenticatedRequest, res) => {
  try {
    const ratItemId = inteiroPositivo(req.params.ratItemId);
    if (ratItemId == null) {
      res.status(400).json({ error: "Apontamento inválido" });
      return;
    }
    const acesso = acessoDe(res);
    const ativa = await prisma.apontamentoForaDoCalculo.findFirst({ where: { ratItemId, restauradoEm: null } });
    if (!ativa) {
      res.status(404).json({ error: "Este apontamento não está fora do cálculo" });
      return;
    }
    const alvo = await carregarPropostaNoEscopo(ativa.codemp, ativa.codpro, acesso);
    if (!alvo) {
      res.status(404).json({ error: "Item não encontrado no seu escopo" });
      return;
    }
    const item = alvo.p.itens.find((i) => i.seqite === ativa.seqite);
    if (!podeDecidirExclusao(acesso, item?.depexe ?? null, alvo.p.depexe)) {
      res.status(403).json({ error: "Só o gestor do item (ou um administrador) pode devolver um apontamento ao cálculo" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // updateMany com a condição de ativa: se outra pessoa restaurou no meio do caminho, não grava duas vezes.
      const r = await tx.apontamentoForaDoCalculo.updateMany({
        where: { id: ativa.id, restauradoEm: null },
        data: { restauradoEm: new Date(), restauradoPor: req.user!.userId },
      });
      if (r.count === 0) return;
      await criarEventoAuditoria(
        {
          origem: "tela",
          usuarioId: req.user!.userId,
          codemp: ativa.codemp,
          codpro: ativa.codpro,
          entidadeTipo: ENTIDADES_AUDITORIA.EFICIENCIA_APONTAMENTO,
          entidadeId: entidadeIdEficienciaApontamento(ratItemId),
          entidadeRotulo: `Apontamento #${ratItemId} · PS ${ativa.codpro} item ${ativa.seqite}`,
          eventoTipo: EVENTOS_AUDITORIA.EFICIENCIA_APONTAMENTO_RESTAURADO,
          metadata: { motivoOriginal: ativa.motivo, motivoOriginalRotulo: rotuloMotivoExclusao(ativa.motivo), minutos: ativa.minutos, seqite: ativa.seqite, codfor: ativa.codfor },
          correlationId: req.correlationId!,
        },
        tx
      );
    });
    res.json({ ratItemId, restaurado: true });
  } catch (error) {
    handleError(res, error, "restaurar-apontamento");
  }
});
