import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { depexeLabel, modproLabel, sitproLabel, sitproTone, SITPRO_ALOCAVEL } from "../domain/propostasDominio";
import {
  resolverContextoConsultor,
  podeExecutarAcao,
  departamentosComTime,
  gerenciaDepartamento,
  AcaoProjeto,
  ContextoConsultor,
} from "../domain/contextoProjeto";
import { truncarNomeEstrutura } from "../domain/estruturaAtividadeDominio";
import { enfileirar } from "../sync/outboxSenior";
import { TIP_EVE_ALTERAR, TIP_EVE_EXCLUIR, TIP_EVE_INCLUIR } from "../soap/client";
import { criarEventoAuditoria, criarEventosDeData, diffCampos, paraDiff } from "../audit/registrarEvento";
import { CAMPOS_AUDITADOS_ALOCACAO, CAMPOS_AUDITADOS_ATIVIDADE_DATAS } from "../audit/camposAuditados";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdAtividade } from "../audit/identidadeEntidade";
import { Prisma } from "@prisma/client";

// Área de alocação: o Líder Técnico (Gestor) distribui as horas de um item de proposta
// entre um ou mais consultores do próprio time (AtividadeConsultor = "Distribuição
// Atividades por Consultor" no Senior — já suporta N linhas por item, uma por consultor).
// Só admin e Líder Técnico têm acesso; Consultor/Comercial não enxergam essa tela.
export const alocacaoRouter = Router();
alocacaoRouter.use(requireAuth);

function parseIdsParam(value: unknown): number[] | null {
  if (typeof value !== "string" || value === "") return null;
  const ids = value
    .split(",")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  return ids.length > 0 ? ids : null;
}

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[alocacao:${label}]`, message);
  res.status(500).json({ error: message });
}

async function contextoDoUsuario(req: AuthenticatedRequest) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return null;
  const contexto = await resolverContextoConsultor(user.email);
  return { user, contexto, role: req.user!.role as string };
}

// Departamentos que o usuário pode gerenciar nesta área — Líder Técnico só os que
// gerencia; qualquer outro papel, nenhum. Admin recebe a união dos depexe distintos das
// DUAS tabelas: o escopo padrão da tela olha Proposta.depexe e o de compartilhadas olha
// PropostaItem.depexe, então tirar só de uma delas deixaria admin sem enxergar propostas
// de um departamento que não aparece na outra.
async function departamentosPermitidos(role: string, contexto: Awaited<ReturnType<typeof resolverContextoConsultor>>) {
  if (role === "admin") {
    const [deItens, dePropostas] = await Promise.all([
      prisma.propostaItem.findMany({ where: { depexe: { not: null } }, distinct: ["depexe"], select: { depexe: true } }),
      prisma.proposta.findMany({ where: { depexe: { not: null } }, distinct: ["depexe"], select: { depexe: true } }),
    ]);
    return [...new Set([...deItens, ...dePropostas].map((d) => d.depexe as number))];
  }
  return contexto.departamentosGerenciados;
}

// ---------------------------------------------------------------------------------
// Escopo da tela de Alocação: quais propostas o gestor enxerga.
//
// São DOIS caminhos, e o campo consultado é diferente em cada um:
//
//   próprias      -> Proposta.depexe está nos meus departamentos. É a lista padrão.
//   compartilhada -> Proposta.depexe é de OUTRO departamento, mas algum PropostaItem
//                    dela está num dos meus. Só aparece com o filtro ligado.
//
// Os dois são disjuntos de propósito: uma proposta própria nunca é "compartilhada". A
// leitura inclusiva (qualquer proposta com item meu) foi medida e devolve exatamente a
// mesma lista do padrão para os gestores reais — o filtro não filtraria nada.
//
// Uma vez que a proposta entra, ela entra INTEIRA: todos os itens aparecem e os
// agregados somam a proposta toda, não só a fatia do meu departamento. Ver/alocar são
// coisas diferentes — a permissão de alocar continua por item (podeExecutarAcao com o
// depexe DO ITEM), então item de outro departamento aparece somente-leitura.
// ---------------------------------------------------------------------------------

type OrigemEscopo = "propria" | "compartilhada";

// Classifica uma proposta contra os departamentos informados. `null` = fora do escopo.
function origemDaProposta(
  propostaDepexe: number | null,
  depexesDosItens: Set<number>,
  permitidos: number[]
): OrigemEscopo | null {
  if (propostaDepexe != null && permitidos.includes(propostaDepexe)) return "propria";
  for (const dep of depexesDosItens) if (permitidos.includes(dep)) return "compartilhada";
  return null;
}

// Guarda de acesso das rotas de detalhe (itens, consultores, cronograma). Mesma regra da
// lista, para não haver proposta que aparece na listagem e dá 403 ao abrir.
async function podeVerProposta(permitidos: number[], codemp: number, codpro: number): Promise<boolean> {
  if (permitidos.length === 0) return false;
  const [proposta, itens] = await Promise.all([
    prisma.proposta.findUnique({ where: { codemp_codpro: { codemp, codpro } }, select: { depexe: true } }),
    prisma.propostaItem.findMany({ where: { codemp, codpro, depexe: { not: null } }, distinct: ["depexe"], select: { depexe: true } }),
  ]);
  if (!proposta) return false;
  const depsItens = new Set(itens.map((i) => i.depexe as number));
  return origemDaProposta(proposta.depexe, depsItens, permitidos) != null;
}

// Ações no nível da proposta inteira (pasta raiz, agrupar/soltar item) não têm um único
// depexe pra checar contra podeExecutarAcao — uma pasta raiz pode reunir itens de
// departamentos diferentes. Vale a mesma regra de escopo da listagem: quem enxerga a
// proposta organiza a estrutura dela.
//
// Antes olhava só os itens, e isso virou um beco sem saída com o escopo novo: existem 6
// propostas cujo Proposta.depexe é de um departamento que não aparece em nenhum item
// dela (ex.: 1-8605, de Consultoria HCM, com todos os itens em Consultoria ERP). O dono
// passaria a vê-la como própria e não poderia fazer NADA nela.
//
// Organizar a estrutura não é alocar: distribuir horas para um consultor continua sendo
// decidido item a item por podeExecutarAcao, com o depexe DO ITEM.
async function podeGerenciarProposta(
  role: string,
  contexto: Awaited<ReturnType<typeof resolverContextoConsultor>>,
  codemp: number,
  codpro: number
): Promise<boolean> {
  const permitidos = await departamentosPermitidos(role, contexto);
  return podeVerProposta(permitidos, codemp, codpro);
}

// Decisão sobre UM item da proposta — criar/editar/excluir estrutura e alocação. Ponto
// único: antes cada rota chamava podeExecutarAcao solta com o depexe do item, e a regra
// abaixo teria de ser repetida em nove lugares.
//
// Além do departamento DO ITEM, vale o departamento DA PROPOSTA (02/08/2026): quem
// gerencia o departamento dono da proposta alcança todos os itens dela, inclusive os de
// outro departamento. É como o Senior já se comporta — na proposta 1-8480 (Processo
// Interno) os itens de Desenvolvimento, Administrativo e HCM já vieram de lá com alocação
// do gestor da proposta, e o CaxHub mostrava essas linhas enquanto proibia criar novas.
//
// `gerenciaDepartamento` já resolve admin sozinha — não repetir a checagem de papel aqui.
function podeMexerNoItem(
  role: string,
  contexto: ContextoConsultor,
  acao: AcaoProjeto,
  itemDepexe: number | null,
  propostaDepexe: number | null,
  codfor = 0
): boolean {
  if (itemDepexe == null) return false;
  if (podeExecutarAcao(role, contexto, acao, { depexe: itemDepexe, codfor })) return true;
  return propostaDepexe != null && gerenciaDepartamento(role, contexto, propostaDepexe);
}

async function depexeDaProposta(codemp: number, codpro: number): Promise<number | null> {
  const p = await prisma.proposta.findUnique({ where: { codemp_codpro: { codemp, codpro } }, select: { depexe: true } });
  return p?.depexe ?? null;
}

// Departamentos de onde se pode tirar consultor para um item: o do item mais os que o
// usuário gerencia. Fonte única do seletor do modal (que só oferece estes), da validação
// de `consultores-elegiveis` e da checagem de time das duas rotas de criação — se
// divergissem, o modal voltaria a oferecer nome que o salvar recusa.
//
// Só entram departamentos COM time: um departamento vazio no seletor abriria uma lista sem
// ninguém, e na checagem de criação não muda nada (não há quem casar).
async function departamentosAlocaveisNoItem(
  role: string,
  contexto: ContextoConsultor,
  itemDepexe: number | null
): Promise<number[]> {
  const comTime = new Set(await departamentosComTime());
  const permitidos = await departamentosPermitidos(role, contexto);
  const candidatos = new Set<number>(permitidos);
  if (itemDepexe != null) candidatos.add(itemDepexe);
  return [...candidatos].filter((d) => comTime.has(d));
}

// codusu de quem pode ser alocado no item. Trabalha em codusu (e não codfor) porque é o
// que DepartamentoTime guarda; a conversão BigInt->Number é obrigatória, os dois campos
// têm tipos diferentes no schema.
async function codususAlocaveisNoItem(
  role: string,
  contexto: ContextoConsultor,
  codemp: number,
  itemDepexe: number | null
): Promise<Set<number>> {
  const depexes = await departamentosAlocaveisNoItem(role, contexto, itemDepexe);
  if (depexes.length === 0) return new Set();
  const time = await prisma.departamentoTime.findMany({
    where: { codemp, depexe: { in: depexes }, sitreg: "A" },
    select: { codusu: true },
  });
  return new Set(time.map((t) => Number(t.codusu)));
}

// Controle sempre por proposta (uma proposta pode ter muitos itens — misturar tudo
// num feed único de itens fica ruim de gerenciar). Esta lista é o ponto de entrada:
// uma linha por proposta, com Total/Alocado/Saldo agregados sobre a proposta INTEIRA,
// incluindo itens de outros departamentos (ver o bloco de escopo no topo do arquivo).
alocacaoRouter.get("/propostas", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;
    const permitidos = await departamentosPermitidos(role, contexto);
    if (permitidos.length === 0) {
      res.status(403).json({ error: "Sem departamentos para gerenciar" });
      return;
    }

    const depexeFiltro = parseIdsParam(req.query.depexe);
    const depexesConsultados =
      depexeFiltro != null ? depexeFiltro.filter((d) => permitidos.includes(d)) : permitidos;

    const busca = typeof req.query.busca === "string" ? req.query.busca.trim().toLowerCase() : "";
    const apenasComSaldo = req.query.apenasComSaldo === "true";
    const compartilhadas = req.query.compartilhadas === "true";
    const situacoesValidas = ["semAlocacao", "saldoPendente", "totalmenteAlocadas", "compartilhadasEmAberto"] as const;
    const situacao = situacoesValidas.includes(req.query.situacao as any)
      ? (req.query.situacao as (typeof situacoesValidas)[number])
      : null;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

    // Parte das PROPOSTAS alocáveis, não dos itens: o escopo padrão agora é
    // Proposta.depexe. São ~260 linhas na base inteira, então carregar todas e
    // classificar em memória é mais simples (e mais barato) que duas queries com OR
    // gigante — mesmo padrão já usado nas outras rotas deste arquivo.
    const propostas = await prisma.proposta.findMany({
      where: { sitpro: { in: SITPRO_ALOCAVEL } },
      include: { cliente: true },
    });
    const propostaPorChave = new Map(propostas.map((p) => [`${p.codemp}-${p.codpro}`, p]));

    // TODOS os itens dessas propostas, sem recorte de departamento: quem decide se a
    // proposta entra é o classificador abaixo; uma vez dentro, ela entra inteira.
    const itens = propostas.length
      ? await prisma.propostaItem.findMany({
          where: { OR: propostas.map((p) => ({ codemp: p.codemp, codpro: p.codpro })) },
        })
      : [];

    const depexesPorProposta = new Map<string, Set<number>>();
    for (const item of itens) {
      if (item.depexe == null) continue;
      const chave = `${item.codemp}-${item.codpro}`;
      if (!depexesPorProposta.has(chave)) depexesPorProposta.set(chave, new Set());
      depexesPorProposta.get(chave)!.add(item.depexe);
    }

    const origemPorProposta = new Map<string, OrigemEscopo>();
    for (const p of propostas) {
      const chave = `${p.codemp}-${p.codpro}`;
      const origem = origemDaProposta(p.depexe, depexesPorProposta.get(chave) ?? new Set(), depexesConsultados);
      if (origem) origemPorProposta.set(chave, origem);
    }

    if (origemPorProposta.size === 0) {
      const kpiZerado = { quantidade: 0, horas: 0 };
      res.json({
        rows: [],
        total: 0,
        kpis: {
          totalNoEscopo: 0,
          semAlocacao: kpiZerado,
          saldoPendente: kpiZerado,
          totalmenteAlocadas: kpiZerado,
          compartilhadasEmAberto: kpiZerado,
        },
      });
      return;
    }

    const alocacoes = await prisma.atividadeConsultor.findMany({
      where: { sitreg: "A", OR: itens.map((i) => ({ codemp: i.codemp, codpro: i.codpro, seqite: i.seqite })) },
    });
    const alocadoPorItem = new Map<string, number>();
    for (const a of alocacoes) {
      const chave = `${a.codemp}-${a.codpro}-${a.seqite}`;
      alocadoPorItem.set(chave, (alocadoPorItem.get(chave) ?? 0) + (a.qtdhor ?? 0));
    }

    interface Agregado {
      codemp: number;
      codpro: number;
      numprj: number;
      cliente: string;
      despro: string | null;
      sitpro: number | null;
      propostaDepexe: number | null;
      propostaModpro: number | null;
      origem: OrigemEscopo;
      totalItens: number;
      qtdhorTotal: number;
      horasAlocadas: number;
    }
    // Semeia pelas PROPOSTAS do escopo (não pelos itens) — só assim a proposta existe
    // no mapa antes de se saber se ela tem item, o que torna a exclusão das vazias uma
    // decisão explícita lá embaixo em vez de efeito colateral do laço.
    const porProposta = new Map<string, Agregado>();
    for (const [chaveProposta, origem] of origemPorProposta) {
      const proposta = propostaPorChave.get(chaveProposta)!;
      porProposta.set(chaveProposta, {
        codemp: proposta.codemp,
        codpro: proposta.codpro,
        numprj: proposta.numprj,
        cliente: `${proposta.cliente.codcli} - ${proposta.cliente.nomcli}`,
        despro: proposta.despro,
        sitpro: proposta.sitpro,
        propostaDepexe: proposta.depexe,
        propostaModpro: proposta.modpro,
        origem,
        totalItens: 0,
        qtdhorTotal: 0,
        horasAlocadas: 0,
      });
    }
    // Sem recorte por item.depexe: se a proposta está no escopo, TODOS os itens dela
    // entram no agregado — Total/Alocado/Saldo passam a ser os da proposta inteira, e
    // não mais a fatia do departamento de quem está olhando.
    for (const item of itens) {
      const agregado = porProposta.get(`${item.codemp}-${item.codpro}`);
      if (!agregado) continue;
      agregado.totalItens += 1;
      agregado.qtdhorTotal += item.qtdhor ?? 0;
      agregado.horasAlocadas += alocadoPorItem.get(`${item.codemp}-${item.codpro}-${item.seqite}`) ?? 0;
    }
    // Proposta sem item nenhum sai da lista: não há o que alocar nela, e ela só ocuparia
    // linha com tudo zerado. São 11 na base local — todas recém-aprovadas, ainda sem
    // itens sincronizados do Senior.
    for (const [chave, agregado] of porProposta) {
      if (agregado.totalItens === 0) porProposta.delete(chave);
    }

    // KPIs sempre por proposta (nunca por item) e sempre com quantidade + total de horas
    // juntos no mesmo card — refletem o escopo de departamento(s) selecionado, mas não os
    // filtros transitórios de busca/saldo/compartilhadas da tabela abaixo, pra não ficarem
    // pulando enquanto o usuário digita ou alterna um toggle.
    const todasPropostas = [...porProposta.values()];
    // "Sem alocação" e "Saldo pendente" são mutuamente exclusivas: a primeira é quem
    // não teve NENHUMA hora alocada ainda; a segunda é quem já teve alguma alocação
    // mas ainda não fechou o total (senão uma proposta zerada contava nas duas).
    const semAlocacao = todasPropostas.filter((a) => a.horasAlocadas === 0);
    const comSaldoPendente = todasPropostas.filter(
      (a) => a.horasAlocadas > 0 && a.qtdhorTotal - a.horasAlocadas > 0
    );
    const totalmenteAlocadas = todasPropostas.filter(
      (a) => a.qtdhorTotal > 0 && a.qtdhorTotal - a.horasAlocadas <= 0
    );
    // "Compartilhada" agora vem da classificação de escopo, não de recomparar o depexe:
    // é proposta de OUTRO departamento que entrou porque tem item no meu. Antes o corte
    // usava departamentosGerenciados, que para admin é vazio — e com isso as 248
    // propostas dele caíam todas neste KPI.
    const compartilhadasEmAberto = todasPropostas.filter(
      (a) => a.origem === "compartilhada" && a.qtdhorTotal - a.horasAlocadas > 0
    );
    const somaHoras = (lista: Agregado[], campo: (a: Agregado) => number) =>
      lista.reduce((soma, a) => soma + campo(a), 0);
    const kpis = {
      totalNoEscopo: todasPropostas.length,
      semAlocacao: { quantidade: semAlocacao.length, horas: somaHoras(semAlocacao, (a) => a.qtdhorTotal) },
      saldoPendente: {
        quantidade: comSaldoPendente.length,
        horas: somaHoras(comSaldoPendente, (a) => a.qtdhorTotal - a.horasAlocadas),
      },
      totalmenteAlocadas: {
        quantidade: totalmenteAlocadas.length,
        horas: somaHoras(totalmenteAlocadas, (a) => a.horasAlocadas),
      },
      compartilhadasEmAberto: {
        quantidade: compartilhadasEmAberto.length,
        horas: somaHoras(compartilhadasEmAberto, (a) => a.qtdhorTotal - a.horasAlocadas),
      },
    };

    // Um KPI clicado vira o único critério de "situação" da tabela (substitui os
    // checkboxes de saldo/compartilhadas, que só valem quando nenhum KPI está ativo) —
    // reaproveita exatamente as mesmas listas já calculadas acima pros cards.
    const porSituacao: Record<(typeof situacoesValidas)[number], Agregado[]> = {
      semAlocacao,
      saldoPendente: comSaldoPendente,
      totalmenteAlocadas,
      compartilhadasEmAberto,
    };
    // Sem o filtro ligado a lista mostra só as PRÓPRIAS; ligado, só as compartilhadas.
    // Os dois conjuntos são disjuntos, então o checkbox alterna entre eles em vez de
    // somar — é o que dá sentido ao rótulo "Compartilhadas com meu departamento".
    const baseFiltrada = situacao
      ? porSituacao[situacao]
      : todasPropostas
          .filter((a) => (compartilhadas ? a.origem === "compartilhada" : a.origem === "propria"))
          .filter((a) => !apenasComSaldo || a.qtdhorTotal - a.horasAlocadas > 0);

    let linhas = baseFiltrada.map((a) => ({
      codemp: a.codemp,
      codpro: a.codpro,
      numprj: a.numprj,
      cliente: a.cliente,
      despro: a.despro,
      sitpro: a.sitpro,
      sitproLabel: sitproLabel(a.sitpro),
      sitproTone: sitproTone(a.sitpro),
      // Sempre o departamento "dono" da proposta no Senior — não os departamentos
      // dos itens (que podem ser só os visíveis pro usuário, e confundiriam numa
      // proposta compartilhada mostrando o depto de quem está vendo, não o real).
      depexeLabel: depexeLabel(a.propostaDepexe),
      modproLabel: modproLabel(a.propostaModpro),
      totalItens: a.totalItens,
      qtdhorTotal: a.qtdhorTotal,
      horasAlocadas: a.horasAlocadas,
      saldo: a.qtdhorTotal - a.horasAlocadas,
    }));

    if (busca) {
      linhas = linhas.filter((l) => l.cliente.toLowerCase().includes(busca) || String(l.codpro).includes(busca));
    }
    if (apenasComSaldo) {
      linhas = linhas.filter((l) => l.saldo > 0);
    }
    linhas.sort((a, b) => b.codpro - a.codpro);

    const total = linhas.length;
    const inicio = (page - 1) * pageSize;
    const pagina = linhas.slice(inicio, inicio + pageSize);

    res.json({ rows: pagina, total, kpis });
  } catch (error) {
    handleError(res, error, "propostas");
  }
});

// Resumo por consultor de uma proposta — usado no accordion da lista de propostas,
// pra responder "quanto cada consultor já tem alocado nessa proposta" sem precisar
// abrir o detalhe e somar item por item. Não inclui horas em RAT (apontamento real de
// horas trabalhadas) porque essa tabela do Senior ainda não é sincronizada no CaxHub.
alocacaoRouter.get("/propostas/:codemp/:codpro/consultores", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    if (!Number.isFinite(codemp) || !Number.isFinite(codpro)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;
    const permitidos = await departamentosPermitidos(role, contexto);
    if (!(await podeVerProposta(permitidos, codemp, codpro))) {
      res.json({ consultores: [] });
      return;
    }

    // Todos os itens da proposta, sem recorte de departamento: o resumo por consultor do
    // accordion tem que bater com o Alocado da linha, que agora é o da proposta inteira.
    const itens = await prisma.propostaItem.findMany({
      where: { codemp, codpro },
      select: { codemp: true, codpro: true, seqite: true },
    });
    if (itens.length === 0) {
      res.json({ consultores: [] });
      return;
    }

    const alocacoes = await prisma.atividadeConsultor.findMany({
      where: { sitreg: "A", OR: itens.map((i) => ({ codemp: i.codemp, codpro: i.codpro, seqite: i.seqite })) },
    });

    // "Horas realizadas" por consultor — mesmo cálculo de horasRealizadasDaAlocacao mais
    // abaixo neste arquivo (árvore do cronograma) e de horasRealizadasDaAtividade em
    // atividades.ts: sessões de execução ainda não confirmadas + RatItem já confirmados/
    // sincronizados (nunca as duas fontes ao mesmo tempo pra mesma sessão), somado por
    // TODAS as alocações do consultor nesta proposta (pode ter mais de um item).
    const seqatisValidos = [...new Set(alocacoes.map((a) => a.seqati).filter((s): s is bigint => s != null))];
    const ratItemsComHoras =
      seqatisValidos.length > 0
        ? await prisma.ratItem.findMany({
            where: { seqati: { in: seqatisValidos }, horini: { not: null }, horfim: { not: null } },
            select: { seqati: true, horini: true, horfim: true },
          })
        : [];
    const minutosRealizadosPorSeqati = new Map<bigint, number>();
    for (const item of ratItemsComHoras) {
      if (item.seqati == null || item.horini == null || item.horfim == null) continue;
      minutosRealizadosPorSeqati.set(item.seqati, (minutosRealizadosPorSeqati.get(item.seqati) ?? 0) + (item.horfim - item.horini));
    }
    const sessoesNaoConfirmadas =
      alocacoes.length > 0
        ? await prisma.atividadeSessaoExecucao.findMany({
            where: { atividadeId: { in: alocacoes.map((a) => a.id) }, confirmada: false, fim: { not: null } },
            select: { atividadeId: true, inicio: true, fim: true },
          })
        : [];
    const msRealizadosPorAtividadeId = new Map<number, number>();
    for (const s of sessoesNaoConfirmadas) {
      if (s.fim == null) continue;
      msRealizadosPorAtividadeId.set(s.atividadeId, (msRealizadosPorAtividadeId.get(s.atividadeId) ?? 0) + (s.fim.getTime() - s.inicio.getTime()));
    }

    const horasPorCodfor = new Map<number, number>();
    const excedentesPorCodfor = new Map<number, number>();
    const realizadoPorCodfor = new Map<number, number>();
    for (const a of alocacoes) {
      horasPorCodfor.set(a.codfor, (horasPorCodfor.get(a.codfor) ?? 0) + (a.qtdhor ?? 0));
      excedentesPorCodfor.set(a.codfor, (excedentesPorCodfor.get(a.codfor) ?? 0) + a.horasExcedentes);
      const realizadoDaAlocacao =
        (a.seqati != null ? minutosRealizadosPorSeqati.get(a.seqati) ?? 0 : 0) + Math.round((msRealizadosPorAtividadeId.get(a.id) ?? 0) / 60000);
      realizadoPorCodfor.set(a.codfor, (realizadoPorCodfor.get(a.codfor) ?? 0) + realizadoDaAlocacao);
    }

    const codforUnicos = [...horasPorCodfor.keys()];
    const consultores =
      codforUnicos.length > 0 ? await prisma.consultor.findMany({ where: { codfor: { in: codforUnicos } } }) : [];
    const consultorPorCodfor = new Map(consultores.map((c) => [c.codfor, c]));

    const linhas = codforUnicos
      .map((codfor) => {
        const consultor = consultorPorCodfor.get(codfor);
        const horasAlocadas = horasPorCodfor.get(codfor) ?? 0;
        const horasExcedentes = excedentesPorCodfor.get(codfor) ?? 0;
        const horasRealizadas = realizadoPorCodfor.get(codfor) ?? 0;
        return {
          codfor,
          nome: consultor?.nomcom ?? consultor?.nomfor ?? `Fornecedor ${codfor}`,
          depexeLabel: consultor?.depexedes ?? depexeLabel(consultor?.depexe ?? null),
          horasAlocadas,
          horasExcedentes,
          horasRealizadas,
          // Mesma fórmula de tetoDaAtividade (domain/tetoAtividade.ts): o teto de
          // apontamento é qtdhor + horasExcedentes, não só qtdhor — senão o saldo mostraria
          // "estourado" pra quem já tem folga autorizada pelo gestor.
          saldo: horasAlocadas + horasExcedentes - horasRealizadas,
        };
      })
      .sort((a, b) => b.horasAlocadas - a.horasAlocadas);

    res.json({ consultores: linhas });
  } catch (error) {
    handleError(res, error, "proposta-consultores");
  }
});

// Detalhe de uma proposta: TODOS os itens dela, de qualquer departamento, já com as
// alocações de cada um — a "aba 2" (item x consultor x fase) fica embutida por item
// em vez de ser uma grade solta que obriga cruzar pelo número de sequência. Item fora
// dos meus departamentos vem com podeAlocar/podeEditar false: aparece, não se mexe.
alocacaoRouter.get("/propostas/:codemp/:codpro/itens", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    if (!Number.isFinite(codemp) || !Number.isFinite(codpro)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;
    const permitidos = await departamentosPermitidos(role, contexto);

    const proposta = await prisma.proposta.findUnique({ where: { codemp_codpro: { codemp, codpro } }, include: { cliente: true } });
    if (!proposta || proposta.sitpro == null || !SITPRO_ALOCAVEL.includes(proposta.sitpro)) {
      res.status(404).json({ error: "Proposta não encontrada ou não alocável" });
      return;
    }

    // Proposta no escopo entra inteira: todos os itens, inclusive os de outro
    // departamento. Ver e alocar seguem sendo coisas diferentes — `podeAlocar` abaixo é
    // decidido item a item (pelo depexe do item OU pelo da proposta, ver podeMexerNoItem).
    if (!(await podeVerProposta(permitidos, codemp, codpro))) {
      res.status(403).json({ error: "Sem acesso a esta proposta" });
      return;
    }
    const itens = await prisma.propostaItem.findMany({
      where: { codemp, codpro },
      orderBy: { seqite: "asc" },
    });
    if (itens.length === 0) {
      res.status(404).json({ error: "Proposta sem itens" });
      return;
    }

    const alocacoes = await prisma.atividadeConsultor.findMany({
      where: { sitreg: "A", OR: itens.map((i) => ({ codemp: i.codemp, codpro: i.codpro, seqite: i.seqite })) },
      include: { fase: true },
    });
    const codforUnicos = [...new Set(alocacoes.map((a) => a.codfor))];
    const consultores =
      codforUnicos.length > 0 ? await prisma.consultor.findMany({ where: { codfor: { in: codforUnicos } } }) : [];
    const consultorPorCodfor = new Map(consultores.map((c) => [c.codfor, c]));

    const alocacoesPorItem = new Map<number, typeof alocacoes>();
    for (const a of alocacoes) {
      if (!alocacoesPorItem.has(a.seqite)) alocacoesPorItem.set(a.seqite, []);
      alocacoesPorItem.get(a.seqite)!.push(a);
    }

    res.json({
      proposta: {
        codemp: proposta.codemp,
        codpro: proposta.codpro,
        numprj: proposta.numprj,
        cliente: `${proposta.cliente.codcli} - ${proposta.cliente.nomcli}`,
        sitpro: proposta.sitpro,
        sitproLabel: sitproLabel(proposta.sitpro),
        sitproTone: sitproTone(proposta.sitpro),
      },
      itens: itens.map((item) => {
        const alocacoesDoItem = alocacoesPorItem.get(item.seqite) ?? [];
        const horasAlocadas = alocacoesDoItem.reduce((soma, a) => soma + (a.qtdhor ?? 0), 0);
        const saldo = item.qtdhor != null ? item.qtdhor - horasAlocadas : null;
        return {
          seqite: item.seqite,
          codser: item.codser,
          despro: item.despro,
          depexe: item.depexe,
          depexeLabel: depexeLabel(item.depexe),
          qtdhorItem: item.qtdhor,
          horasAlocadas,
          saldo,
          podeAlocar: podeMexerNoItem(role, contexto, "criar", item.depexe, proposta.depexe),
          alocacoes: alocacoesDoItem.map((a) => {
            const consultor = consultorPorCodfor.get(a.codfor);
            return {
              id: a.id,
              codfor: a.codfor,
              consultorNome: consultor?.nomcom ?? consultor?.nomfor ?? `Fornecedor ${a.codfor}`,
              qtdhor: a.qtdhor,
              horasExcedentes: a.horasExcedentes,
              fasid: a.fasid,
              faseDes: a.fase.fasdes,
              dataPrevistaInicio: a.dataPrevistaInicio,
              dataPrevistaFim: a.dataPrevistaFim,
              seqati: a.seqati != null ? a.seqati.toString() : null,
            };
          }),
        };
      }),
    });
  } catch (error) {
    handleError(res, error, "proposta-itens");
  }
});

// Departamentos que o seletor do modal de alocação oferece. Depende do ITEM, não só do
// usuário: é o departamento do item mais os que o usuário gerencia — exatamente o conjunto
// que as rotas de criação aceitam (ver departamentosAlocaveisNoItem). Oferecer mais que
// isso é o defeito que o seletor tinha ao nascer: a tela deixava escolher e o salvar
// recusava com 400.
alocacaoRouter.get("/itens/:codemp/:codpro/:seqite/departamentos-alocaveis", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    const seqite = Number(req.params.seqite);
    if (![codemp, codpro, seqite].every(Number.isFinite)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;
    const permitidos = await departamentosPermitidos(role, contexto);
    if (permitidos.length === 0) {
      res.status(403).json({ error: "Sem departamentos para gerenciar" });
      return;
    }

    const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
    if (!item) {
      res.status(404).json({ error: "Item de proposta não encontrado" });
      return;
    }

    const depexes = await departamentosAlocaveisNoItem(role, contexto, item.depexe);
    res.json({
      departamentos: depexes
        .map((depexe) => ({ depexe, label: depexeLabel(depexe) }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    });
  } catch (error) {
    handleError(res, error, "departamentos-alocaveis");
  }
});

alocacaoRouter.get("/consultores-elegiveis", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;
    const depexe = Number(req.query.depexe);
    const codemp = Number(req.query.codemp);
    const codpro = Number(req.query.codpro);
    const seqite = Number(req.query.seqite);
    if (![depexe, codemp, codpro, seqite].every(Number.isFinite)) {
      res.status(400).json({ error: "depexe, codemp, codpro e seqite são obrigatórios" });
      return;
    }
    const permitidos = await departamentosPermitidos(role, contexto);
    if (permitidos.length === 0) {
      res.status(403).json({ error: "Sem departamentos para gerenciar" });
      return;
    }

    // Valida o departamento consultado contra o MESMO conjunto que a criação aceita. Sem
    // isto a rota volta a oferecer nomes que o `alocar-lote` recusa — e o usuário só
    // descobre no botão de salvar.
    const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
    if (!item) {
      res.status(404).json({ error: "Item de proposta não encontrado" });
      return;
    }
    const alocaveis = await departamentosAlocaveisNoItem(role, contexto, item.depexe);
    if (!alocaveis.includes(depexe)) {
      res.status(403).json({ error: "Não é possível alocar consultores deste departamento neste item" });
      return;
    }

    const integrantes = await prisma.departamentoTime.findMany({ where: { codemp, depexe, sitreg: "A" } });
    const codusuList = integrantes.map((i) => Number(i.codusu));
    const consultoresDoTime =
      codusuList.length > 0
        ? await prisma.consultor.findMany({
            where: { codemp, codusu: { in: codusuList }, codfor: { not: null }, sitfor: "A" },
            include: { usuariosCaxHub: { select: { fotoUrl: true } } },
          })
        : [];

    res.json({
      consultores: consultoresDoTime
        .map((c) => ({
          codfor: c.codfor as number,
          nome: c.nomcom ?? c.nomfor ?? `Fornecedor ${c.codfor}`,
          fotoUrl: c.usuariosCaxHub[0]?.fotoUrl ?? null,
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    });
  } catch (error) {
    handleError(res, error, "consultores-elegiveis");
  }
});

alocacaoRouter.get("/fases", async (_req, res) => {
  try {
    const fases = await prisma.faseProposta.findMany({ orderBy: { fasid: "asc" } });
    res.json({ fases: fases.map((f) => ({ fasid: f.fasid, fasdes: f.fasdes })) });
  } catch (error) {
    handleError(res, error, "fases");
  }
});

// Modo de alocação da proposta: "item" (direto no item, fluxo de sempre) ou "estrutura"
// (EAP — pastas + atividades-folha, ver EstruturaAtividade). Propostas que já tinham
// alocação antes dessa funcionalidade existir (sincronizadas do Senior ou criadas antes
// do gate) resolvem pra "item" automaticamente — sem interromper quem já vinha usando
// o fluxo direto, e sem precisar de uma migração retroativa de dado.
async function resolverModoAlocacao(codemp: number, codpro: number): Promise<"item" | "estrutura" | null> {
  const config = await prisma.propostaModoAlocacao.findUnique({ where: { codemp_codpro: { codemp, codpro } } });
  if (config) return config.modo as "item" | "estrutura";
  // Sem config explícita: sempre "estrutura" — o modo "item" só existe hoje pra
  // propostas com PropostaModoAlocacao="item" explícita (legado migrado em massa via
  // backend/prisma/migrarLegadoParaEstrutura.ts; o que sobrou sem config é só proposta
  // sem nenhuma alocação ainda, ou proposta fora do recorte alocável — SITPRO_ALOCAVEL
  // já bloqueia as duas telas antes de chegar aqui de qualquer forma).
  return "estrutura";
}

alocacaoRouter.get("/propostas/:codemp/:codpro/modo", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    if (!Number.isFinite(codemp) || !Number.isFinite(codpro)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }
    const modo = await resolverModoAlocacao(codemp, codpro);
    res.json({ modo });
  } catch (error) {
    handleError(res, error, "modo-alocacao");
  }
});

alocacaoRouter.post("/propostas/:codemp/:codpro/modo", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    const modo = req.body?.modo;
    if (!Number.isFinite(codemp) || !Number.isFinite(codpro)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }
    if (modo !== "item" && modo !== "estrutura") {
      res.status(400).json({ error: "modo deve ser 'item' ou 'estrutura'" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const atual = await resolverModoAlocacao(codemp, codpro);
    if (atual) {
      res.status(409).json({ error: `Modo já definido para esta proposta (${atual}) — não é possível trocar depois da primeira alocação` });
      return;
    }

    await prisma.propostaModoAlocacao.create({
      data: { codemp, codpro, modo, definidoPor: ctx.contexto.consultor?.codusu ?? null },
    });

    res.status(201).json({ modo });
  } catch (error) {
    handleError(res, error, "definir-modo-alocacao");
  }
});

function formatHorasSimples(minutos: number): string {
  const totalMinutos = Math.round(minutos);
  const horas = Math.trunc(totalMinutos / 60);
  const resto = Math.abs(totalMinutos % 60);
  return `${horas}:${String(resto).padStart(2, "0")} h`;
}

async function validarSaldo(
  codemp: number,
  codpro: number,
  seqite: number,
  qtdhorNovo: number,
  opts?: { ignorarAtividadeId?: number; estruturaAtividadeId?: number }
): Promise<{ ok: true } | { ok: false; erro: string }> {
  // Modo "estrutura": o teto é a duração do nó-folha da EAP, não o item inteiro — o
  // teto do item já foi garantido quando o nó foi criado/editado (ver validarSomaEstrutura).
  if (opts?.estruturaAtividadeId != null) {
    const no = await prisma.estruturaAtividade.findUnique({ where: { id: opts.estruturaAtividadeId } });
    if (!no) return { ok: false, erro: "Atividade da estrutura não encontrada" };
    if (no.tipo !== "atividade") return { ok: false, erro: "Só é possível alocar consultor em atividades-folha, não em pastas" };
    if (no.duracaoHoras == null) return { ok: false, erro: "Atividade sem duração definida" };

    const existentesNo = await prisma.atividadeConsultor.findMany({
      where: { estruturaAtividadeId: opts.estruturaAtividadeId, sitreg: "A" },
    });
    const somaAtualNo = existentesNo
      .filter((a) => a.id !== opts.ignorarAtividadeId)
      .reduce((soma, a) => soma + (a.qtdhor ?? 0), 0);
    if (somaAtualNo + qtdhorNovo > no.duracaoHoras) {
      return {
        ok: false,
        erro: `Horas excedem o saldo da atividade (disponível: ${formatHorasSimples(no.duracaoHoras - somaAtualNo)}, tentando alocar: ${formatHorasSimples(qtdhorNovo)})`,
      };
    }
    return { ok: true };
  }

  const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
  if (!item) return { ok: false, erro: "Item de proposta não encontrado" };
  if (item.qtdhor == null) return { ok: false, erro: "Item sem horas definidas na proposta" };

  const existentes = await prisma.atividadeConsultor.findMany({
    where: { codemp, codpro, seqite, sitreg: "A" },
  });
  const somaAtual = existentes
    .filter((a) => a.id !== opts?.ignorarAtividadeId)
    .reduce((soma, a) => soma + (a.qtdhor ?? 0), 0);

  if (somaAtual + qtdhorNovo > item.qtdhor) {
    return {
      ok: false,
      erro: `Horas excedem o saldo do item (disponível: ${formatHorasSimples(item.qtdhor - somaAtual)}, tentando alocar: ${formatHorasSimples(qtdhorNovo)})`,
    };
  }
  return { ok: true };
}

// Checagem 2 da EAP: soma da duração de todas as atividades-folha da árvore não pode
// passar do total de horas do item — roda ao criar/editar um nó, não ao alocar
// consultor (isso é a checagem 1, dentro de validarSaldo acima).
async function validarSomaEstrutura(
  codemp: number,
  codpro: number,
  seqite: number,
  ignorarNoId: number | null,
  duracaoNova: number
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
  if (!item || item.qtdhor == null) return { ok: false, erro: "Item sem horas definidas na proposta" };

  const folhas = await prisma.estruturaAtividade.findMany({ where: { codemp, codpro, seqite, tipo: "atividade" } });
  const somaAtual = folhas
    .filter((n) => n.id !== ignorarNoId)
    .reduce((soma, n) => soma + (n.duracaoHoras ?? 0), 0);

  if (somaAtual + duracaoNova > item.qtdhor) {
    return {
      ok: false,
      erro: `Duração excede o saldo do item (disponível: ${formatHorasSimples(item.qtdhor - somaAtual)}, tentando usar: ${formatHorasSimples(duracaoNova)})`,
    };
  }
  return { ok: true };
}

// EAP (Estrutura Analítica de Projeto) — pastas + atividades-folha dentro de um item,
// só existe pra propostas em modo "estrutura" (ver resolverModoAlocacao acima).
// Cronograma exclusivo da proposta inteira (não por item) — todos os itens da proposta
// entram como âncora da lista, e cada um carrega sua própria árvore de pastas/atividades
// (EstruturaAtividade). Uma atividade sempre pertence à árvore de UM item (seqite), então
// "só pode ser adicionada abaixo da pasta do item" já é garantido pela própria FK —
// aqui só juntamos tudo numa resposta só, pra tela ficar numa página única.
alocacaoRouter.get("/propostas/:codemp/:codpro/cronograma", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    if (!Number.isFinite(codemp) || !Number.isFinite(codpro)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;
    const permitidos = await departamentosPermitidos(role, contexto);

    const proposta = await prisma.proposta.findUnique({ where: { codemp_codpro: { codemp, codpro } }, include: { cliente: true } });
    if (!proposta || proposta.sitpro == null || !SITPRO_ALOCAVEL.includes(proposta.sitpro)) {
      res.status(404).json({ error: "Proposta não encontrada ou não alocável" });
      return;
    }

    // Mesma regra da lista e do /itens: proposta no escopo aparece com todos os itens.
    if (!(await podeVerProposta(permitidos, codemp, codpro))) {
      res.status(403).json({ error: "Sem acesso a esta proposta" });
      return;
    }
    const itens = await prisma.propostaItem.findMany({
      where: { codemp, codpro },
      orderBy: { seqite: "asc" },
    });
    if (itens.length === 0) {
      res.status(404).json({ error: "Proposta sem itens" });
      return;
    }

    const seqites = itens.map((i) => i.seqite);
    // Nós ligados a um item (seqite preenchido) — filtro redundante em runtime (a query
    // já garante isso), só pra o TS parar de tratar seqite como number|null daqui pra
    // frente (o campo virou opcional no schema pra existirem pastas raiz, ver abaixo).
    const nos = (
      await prisma.estruturaAtividade.findMany({
        where: { codemp, codpro, seqite: { in: seqites } },
        orderBy: { ordem: "asc" },
      })
    ).filter((n): n is typeof n & { seqite: number } => n.seqite != null);

    // Pastas raiz da proposta (seqite null) — agrupam itens entre si, ver
    // PropostaItemPosicao. Entram na mesma lista achatada que os nós normais pro
    // frontend montar uma árvore só; carregam junto a posição de cada item (pra saber
    // dentro de qual pasta raiz — ou solto, se não houver linha em PropostaItemPosicao).
    const pastasRaiz = await prisma.estruturaAtividade.findMany({
      where: { codemp, codpro, seqite: null },
      orderBy: { ordem: "asc" },
    });
    const posicoesItens = await prisma.propostaItemPosicao.findMany({ where: { codemp, codpro, seqite: { in: seqites } } });
    const posicaoPorSeqite = new Map(posicoesItens.map((p) => [p.seqite, p.parentId]));

    const todosOsNos = [...nos, ...pastasRaiz];
    const nosIds = todosOsNos.map((n) => n.id);
    const alocacoes =
      nosIds.length > 0
        ? await prisma.atividadeConsultor.findMany({
            where: { estruturaAtividadeId: { in: nosIds }, sitreg: "A" },
            include: { fase: true },
          })
        : [];
    const codforUnicos = [
      ...new Set([...alocacoes.map((a) => a.codfor), ...todosOsNos.map((n) => n.responsavelCodfor).filter((c): c is number => c != null)]),
    ];
    const consultores =
      codforUnicos.length > 0 ? await prisma.consultor.findMany({ where: { codfor: { in: codforUnicos } } }) : [];
    const consultorPorCodfor = new Map(consultores.map((c) => [c.codfor, c]));
    const alocacoesPorNo = new Map<number, typeof alocacoes>();
    for (const a of alocacoes) {
      if (a.estruturaAtividadeId == null) continue;
      if (!alocacoesPorNo.has(a.estruturaAtividadeId)) alocacoesPorNo.set(a.estruturaAtividadeId, []);
      alocacoesPorNo.get(a.estruturaAtividadeId)!.push(a);
    }
    const nomePorId = new Map(todosOsNos.map((n) => [n.id, n.nome]));
    const nosPorSeqite = new Map<number, typeof nos>();
    for (const n of nos) {
      if (!nosPorSeqite.has(n.seqite)) nosPorSeqite.set(n.seqite, []);
      nosPorSeqite.get(n.seqite)!.push(n);
    }

    // "Horas realizadas" por alocação — mesmo cálculo de carregarAtividadesVisiveis em
    // atividades.ts: sessões de execução ainda não confirmadas + RatItem já confirmados/
    // sincronizados (nunca as duas fontes ao mesmo tempo pra mesma sessão).
    const seqatisValidos = [...new Set(alocacoes.map((a) => a.seqati).filter((s): s is bigint => s != null))];
    const ratItemsComHoras =
      seqatisValidos.length > 0
        ? await prisma.ratItem.findMany({
            where: { seqati: { in: seqatisValidos }, horini: { not: null }, horfim: { not: null } },
            select: { seqati: true, horini: true, horfim: true },
          })
        : [];
    const minutosRealizadosPorSeqati = new Map<bigint, number>();
    for (const item of ratItemsComHoras) {
      if (item.seqati == null || item.horini == null || item.horfim == null) continue;
      minutosRealizadosPorSeqati.set(item.seqati, (minutosRealizadosPorSeqati.get(item.seqati) ?? 0) + (item.horfim - item.horini));
    }
    const sessoesNaoConfirmadas =
      alocacoes.length > 0
        ? await prisma.atividadeSessaoExecucao.findMany({
            where: { atividadeId: { in: alocacoes.map((a) => a.id) }, confirmada: false, fim: { not: null } },
            select: { atividadeId: true, inicio: true, fim: true },
          })
        : [];
    // Mesmo cuidado de domain/tetoAtividade.ts: soma em milissegundos e arredonda uma vez
    // por atividade, senao sessao de menos de 30s conta zero.
    const msRealizadosPorAtividadeId = new Map<number, number>();
    for (const s of sessoesNaoConfirmadas) {
      if (s.fim == null) continue;
      msRealizadosPorAtividadeId.set(s.atividadeId, (msRealizadosPorAtividadeId.get(s.atividadeId) ?? 0) + (s.fim.getTime() - s.inicio.getTime()));
    }
    const minutosRealizadosPorAtividadeId = new Map<number, number>();
    for (const [id, ms] of msRealizadosPorAtividadeId) minutosRealizadosPorAtividadeId.set(id, Math.round(ms / 60000));
    function horasRealizadasDaAlocacao(a: (typeof alocacoes)[number]): number {
      return (a.seqati != null ? minutosRealizadosPorSeqati.get(a.seqati) ?? 0 : 0) + (minutosRealizadosPorAtividadeId.get(a.id) ?? 0);
    }

    function mapNo(n: (typeof todosOsNos)[number]) {
      const alocacoesDoNo = alocacoesPorNo.get(n.id) ?? [];
      const horasAlocadas = alocacoesDoNo.reduce((soma, a) => soma + (a.qtdhor ?? 0), 0);
      const horasRealizadas = alocacoesDoNo.reduce((soma, a) => soma + horasRealizadasDaAlocacao(a), 0);
      return {
        id: n.id,
        parentId: n.parentId,
        tipo: n.tipo,
        nome: n.nome,
        ordem: n.ordem,
        duracaoHoras: n.duracaoHoras,
        dataPrevistaInicio: n.dataPrevistaInicio,
        dataPrevistaFim: n.dataPrevistaFim,
        predecessoraId: n.predecessoraId,
        predecessoraNome: n.predecessoraId != null ? nomePorId.get(n.predecessoraId) ?? null : null,
        percentualConcluido: n.percentualConcluido,
        // Manual, só relevante em tipo="atividade" — "bloqueada" nunca vem daqui, é
        // sempre derivada no frontend (derivarStatus) a partir da predecessora.
        status: n.status,
        responsavelCodfor: n.responsavelCodfor,
        responsavelNome:
          n.responsavelCodfor != null
            ? consultorPorCodfor.get(n.responsavelCodfor)?.nomcom ?? consultorPorCodfor.get(n.responsavelCodfor)?.nomfor ?? null
            : null,
        observacao: n.observacao,
        horasAlocadas,
        horasRealizadas,
        saldo: n.duracaoHoras != null ? n.duracaoHoras - horasAlocadas : null,
        alocacoes: alocacoesDoNo.map((a) => ({
          id: a.id,
          codfor: a.codfor,
          consultorNome: consultorPorCodfor.get(a.codfor)?.nomcom ?? consultorPorCodfor.get(a.codfor)?.nomfor ?? `Fornecedor ${a.codfor}`,
          qtdhor: a.qtdhor,
          horasExcedentes: a.horasExcedentes,
          fasid: a.fasid,
          faseDes: a.fase.fasdes,
          dataPrevistaInicio: a.dataPrevistaInicio,
          dataPrevistaFim: a.dataPrevistaFim,
        })),
      };
    }

    const podeGerenciarEstaProposta = await podeGerenciarProposta(role, contexto, codemp, codpro);

    res.json({
      proposta: {
        codemp,
        codpro,
        numprj: proposta.numprj,
        cliente: `${proposta.cliente.codcli} - ${proposta.cliente.nomcli}`,
        sitproLabel: sitproLabel(proposta.sitpro),
        sitproTone: sitproTone(proposta.sitpro),
        // Cria/renomeia/exclui pasta raiz e agrupa itens dentro dela — ação de nível de
        // proposta inteira, não de um item/departamento específico (ver
        // podeGerenciarProposta).
        podeGerenciarProposta: podeGerenciarEstaProposta,
      },
      // Pastas raiz da proposta — organizacionais, fora do escopo de qualquer item;
      // servem só pra agrupar itens entre si (parentId de EstruturaAtividade normal,
      // igual pasta comum — a diferença é só não ter seqite).
      pastasRaiz: pastasRaiz.map((p) => ({ ...mapNo(p), podeEditar: podeGerenciarEstaProposta })),
      itens: itens.map((item) => ({
        seqite: item.seqite,
        codser: item.codser,
        despro: item.despro,
        depexe: item.depexe,
        depexeLabel: depexeLabel(item.depexe),
        qtdhorItem: item.qtdhor,
        podeEditar: podeMexerNoItem(role, contexto, "criar", item.depexe, proposta.depexe),
        // Pasta raiz onde este item foi agrupado, ou null se estiver solto (padrão —
        // comportamento de sempre, direto na raiz da árvore da proposta).
        parentId: posicaoPorSeqite.get(item.seqite) ?? null,
        nos: (nosPorSeqite.get(item.seqite) ?? []).map(mapNo),
      })),
    });
  } catch (error) {
    handleError(res, error, "cronograma");
  }
});

alocacaoRouter.post("/estrutura", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.body?.codemp);
    const codpro = Number(req.body?.codpro);
    // seqite ausente = pasta raiz da proposta (agrupa itens entre si, ver
    // PropostaItemPosicao) — só tipo "pasta" pode ser raiz, atividade sempre pertence a
    // um item.
    const seqiteRaw = req.body?.seqite;
    const seqite = seqiteRaw != null ? Number(seqiteRaw) : null;
    const tipo = req.body?.tipo;
    const nome = typeof req.body?.nome === "string" ? truncarNomeEstrutura(req.body.nome.trim()) : "";
    const parentId = req.body?.parentId != null ? Number(req.body.parentId) : null;
    if (![codemp, codpro].every(Number.isFinite) || (tipo !== "pasta" && tipo !== "atividade") || nome === "") {
      res.status(400).json({ error: "codemp, codpro, tipo (pasta|atividade) e nome são obrigatórios" });
      return;
    }
    if (seqite != null && !Number.isFinite(seqite)) {
      res.status(400).json({ error: "seqite inválido" });
      return;
    }
    if (seqite == null && tipo !== "pasta") {
      res.status(400).json({ error: "Só uma pasta pode ser raiz da proposta (sem seqite) — atividade sempre pertence a um item" });
      return;
    }

    const modo = await resolverModoAlocacao(codemp, codpro);
    if (modo !== "estrutura") {
      res.status(400).json({ error: "Esta proposta não está no modo de alocação por estrutura" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    if (seqite == null) {
      // Pasta raiz: permissão é no nível da proposta inteira (pode reunir itens de
      // departamentos diferentes, não dá pra checar contra um depexe só).
      if (!(await podeGerenciarProposta(role, contexto, codemp, codpro))) {
        res.status(403).json({ error: "Sem permissão para gerenciar esta proposta" });
        return;
      }
      if (parentId != null) {
        const pai = await prisma.estruturaAtividade.findUnique({ where: { id: parentId } });
        if (!pai || pai.codemp !== codemp || pai.codpro !== codpro || pai.seqite != null) {
          res.status(400).json({ error: "Pasta raiz de destino não encontrada" });
          return;
        }
        if (pai.tipo !== "pasta") {
          res.status(400).json({ error: "Só é possível criar dentro de uma pasta" });
          return;
        }
      }
      const irmaosRaiz = await prisma.estruturaAtividade.findMany({ where: { codemp, codpro, seqite: null, parentId } });
      const ordemRaiz = irmaosRaiz.length > 0 ? Math.max(...irmaosRaiz.map((n) => n.ordem)) + 1 : 0;
      const novaPastaRaiz = await prisma.estruturaAtividade.create({
        data: { codemp, codpro, seqite: null, parentId, tipo: "pasta", nome, ordem: ordemRaiz, criadoPor: contexto.consultor?.codusu ?? null },
      });
      res.status(201).json({ id: novaPastaRaiz.id });
      return;
    }

    const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
    if (!item || item.depexe == null) {
      res.status(404).json({ error: "Item de proposta não encontrado" });
      return;
    }

    if (!podeMexerNoItem(role, contexto, "criar", item.depexe, await depexeDaProposta(codemp, codpro))) {
      res.status(403).json({ error: "Sem permissão para editar a estrutura deste departamento" });
      return;
    }

    if (parentId != null) {
      const pai = await prisma.estruturaAtividade.findUnique({ where: { id: parentId } });
      if (!pai || pai.codemp !== codemp || pai.codpro !== codpro || pai.seqite !== seqite) {
        res.status(400).json({ error: "Pasta pai não encontrada" });
        return;
      }
      if (pai.tipo !== "pasta") {
        res.status(400).json({ error: "Só é possível criar dentro de uma pasta" });
        return;
      }
    }

    let duracaoHoras: number | null = null;
    let dataPrevistaInicio: Date | null = null;
    let dataPrevistaFim: Date | null = null;
    let predecessoraId: number | null = null;
    if (tipo === "atividade") {
      duracaoHoras = req.body?.duracaoHoras != null ? Number(req.body.duracaoHoras) : null;
      if (duracaoHoras != null) {
        const saldo = await validarSomaEstrutura(codemp, codpro, seqite, null, duracaoHoras);
        if (!saldo.ok) {
          res.status(400).json({ error: saldo.erro });
          return;
        }
      }
      dataPrevistaInicio = req.body?.dataPrevistaInicio ? new Date(req.body.dataPrevistaInicio) : null;
      dataPrevistaFim = req.body?.dataPrevistaFim ? new Date(req.body.dataPrevistaFim) : null;
      if (dataPrevistaInicio && dataPrevistaFim && dataPrevistaInicio > dataPrevistaFim) {
        res.status(400).json({ error: "Data de início não pode ser depois da data de fim" });
        return;
      }
      predecessoraId = req.body?.predecessoraId != null ? Number(req.body.predecessoraId) : null;
    }

    const irmaos = await prisma.estruturaAtividade.findMany({ where: { codemp, codpro, seqite, parentId } });
    const ordem = irmaos.length > 0 ? Math.max(...irmaos.map((n) => n.ordem)) + 1 : 0;

    const novo = await prisma.estruturaAtividade.create({
      data: {
        codemp,
        codpro,
        seqite,
        parentId,
        tipo,
        nome,
        ordem,
        duracaoHoras,
        dataPrevistaInicio,
        dataPrevistaFim,
        predecessoraId,
        criadoPor: contexto.consultor?.codusu ?? null,
      },
    });

    res.status(201).json({ id: novo.id });
  } catch (error) {
    handleError(res, error, "estrutura-criar");
  }
});

alocacaoRouter.patch("/estrutura/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const no = await prisma.estruturaAtividade.findUnique({ where: { id } });
    if (!no) {
      res.status(404).json({ error: "Nó não encontrado" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role, user } = ctx;

    if (no.seqite == null) {
      // Pasta raiz: permissão no nível da proposta inteira (ver POST /estrutura).
      if (!(await podeGerenciarProposta(role, contexto, no.codemp, no.codpro))) {
        res.status(403).json({ error: "Sem permissão para gerenciar esta proposta" });
        return;
      }
    } else {
      const item = await prisma.propostaItem.findUnique({
        where: { codemp_codpro_seqite: { codemp: no.codemp, codpro: no.codpro, seqite: no.seqite } },
      });
      if (!item || item.depexe == null) {
        res.status(404).json({ error: "Item de proposta não encontrado" });
        return;
      }
      if (!podeMexerNoItem(role, contexto, "editar", item.depexe, await depexeDaProposta(no.codemp, no.codpro))) {
        res.status(403).json({ error: "Sem permissão para editar a estrutura deste departamento" });
        return;
      }
    }

    const nome = typeof req.body?.nome === "string" && req.body.nome.trim() !== "" ? req.body.nome.trim() : undefined;
    let ordem = req.body?.ordem != null ? Number(req.body.ordem) : undefined;

    // Reorganização (mover pra dentro de outra pasta, ou pra raiz) — vale pra pasta e
    // atividade. Precisa impedir ciclo (mover uma pasta pra dentro de uma das suas
    // próprias subpastas) e recalcula a ordem pro final da nova lista de irmãos.
    let parentId: number | null | undefined;
    if (req.body?.parentId !== undefined) {
      parentId = req.body.parentId != null ? Number(req.body.parentId) : null;
      if (parentId != null) {
        if (parentId === no.id) {
          res.status(400).json({ error: "Não é possível mover um item pra dentro dele mesmo" });
          return;
        }
        const novoPai = await prisma.estruturaAtividade.findUnique({ where: { id: parentId } });
        // Pasta raiz (seqite null) só reparenta dentro de outra pasta raiz; pasta/atividade
        // ligada a um item só reparenta dentro do mesmo item — nunca mistura os dois
        // escopos (não faria sentido uma atividade "pular" pra debaixo de outro item por
        // aqui; pra mover o ITEM em si, ver POST .../itens/:seqite/posicao).
        if (!novoPai || novoPai.codemp !== no.codemp || novoPai.codpro !== no.codpro || novoPai.seqite !== no.seqite) {
          res.status(400).json({ error: "Pasta de destino não encontrada" });
          return;
        }
        if (novoPai.tipo !== "pasta") {
          res.status(400).json({ error: "Só é possível mover pra dentro de uma pasta" });
          return;
        }
        let atual: typeof novoPai | null = novoPai;
        while (atual?.parentId != null) {
          if (atual.parentId === no.id) {
            res.status(400).json({ error: "Não é possível mover uma pasta pra dentro de uma das suas próprias subpastas" });
            return;
          }
          atual = await prisma.estruturaAtividade.findUnique({ where: { id: atual.parentId } });
        }
      }
      if (ordem === undefined) {
        const irmaos = await prisma.estruturaAtividade.findMany({
          where: { codemp: no.codemp, codpro: no.codpro, seqite: no.seqite, parentId },
        });
        ordem = irmaos.length > 0 ? Math.max(...irmaos.map((n) => n.ordem)) + 1 : 0;
      }
    }

    let percentualConcluido: number | undefined;
    if (req.body?.percentualConcluido != null) {
      percentualConcluido = Number(req.body.percentualConcluido);
      if (!Number.isFinite(percentualConcluido) || percentualConcluido < 0 || percentualConcluido > 100) {
        res.status(400).json({ error: "percentualConcluido deve estar entre 0 e 100" });
        return;
      }
    }

    let duracaoHoras: number | null | undefined;
    let dataPrevistaInicio: Date | null | undefined;
    let dataPrevistaFim: Date | null | undefined;
    let predecessoraId: number | null | undefined;
    let status: string | null | undefined;
    let responsavelCodfor: number | null | undefined;
    let observacao: string | null | undefined;
    if (no.tipo === "atividade") {
      if (req.body?.status !== undefined) {
        const statusValidos = ["nao_iniciada", "em_curso", "concluida"];
        if (req.body.status != null && !statusValidos.includes(req.body.status)) {
          res.status(400).json({ error: "status deve ser 'nao_iniciada', 'em_curso' ou 'concluida' ('bloqueada' é sempre calculada, nunca gravada)" });
          return;
        }
        status = req.body.status ?? null;
      }
      if (req.body?.responsavelCodfor !== undefined) {
        responsavelCodfor = req.body.responsavelCodfor != null ? Number(req.body.responsavelCodfor) : null;
      }
      if (req.body?.observacao !== undefined) {
        observacao = typeof req.body.observacao === "string" && req.body.observacao.trim() !== "" ? req.body.observacao.trim() : null;
      }
      if (req.body?.duracaoHoras !== undefined) {
        duracaoHoras = req.body.duracaoHoras != null ? Number(req.body.duracaoHoras) : null;
        // Distribuição pode ser provisória — `confirmarExcedente` deixa passar mesmo
        // estourando o saldo do item (o usuário já viu o aviso no drawer e confirmou).
        // Sem essa flag, continua bloqueando — é só um "leve" a mais, não uma trava.
        if (duracaoHoras != null && req.body?.confirmarExcedente !== true) {
          // no.seqite nunca é null aqui — só pasta pode ser raiz (tipo="atividade" sempre
          // pertence a um item, garantido na criação em POST /estrutura).
          const saldo = await validarSomaEstrutura(no.codemp, no.codpro, no.seqite!, no.id, duracaoHoras);
          if (!saldo.ok) {
            res.status(400).json({ error: saldo.erro });
            return;
          }
        }
      }
      if (req.body?.dataPrevistaInicio !== undefined) {
        dataPrevistaInicio = req.body.dataPrevistaInicio ? new Date(req.body.dataPrevistaInicio) : null;
      }
      if (req.body?.dataPrevistaFim !== undefined) {
        dataPrevistaFim = req.body.dataPrevistaFim ? new Date(req.body.dataPrevistaFim) : null;
      }
      if (dataPrevistaInicio && dataPrevistaFim && dataPrevistaInicio > dataPrevistaFim) {
        res.status(400).json({ error: "Data de início não pode ser depois da data de fim" });
        return;
      }
      if (req.body?.predecessoraId !== undefined) {
        predecessoraId = req.body.predecessoraId != null ? Number(req.body.predecessoraId) : null;
      }
    }

    await prisma.estruturaAtividade.update({
      where: { id },
      data: {
        nome,
        ordem,
        parentId,
        percentualConcluido,
        duracaoHoras,
        dataPrevistaInicio,
        dataPrevistaFim,
        predecessoraId,
        status,
        responsavelCodfor,
        observacao,
      },
    });

    // A alocação que alimenta o Senior (AtividadeConsultor) é criada/atualizada aqui, nunca
    // só pelo campo do nó — editar o nó por aqui nunca propagava pra AtividadeConsultor, e
    // por isso nunca enfileirava nada pro Senior. Dois bugs reais (não teóricos) da mesma
    // causa: duracaoHoras mudava sem cascatear pro qtdhor (10/08/2026, alocação do Eli
    // Venturi, proposta 8688) e responsavelCodfor mudava sem NUNCA criar a
    // AtividadeConsultor (11/08/2026, atividade "Visões do Financeiro" alocada pro
    // Amarildo na proposta 8568, item 14, sem nenhuma AtividadeConsultor nascer). Mesmo
    // espírito do que PUT /alocacoes/:id já faz pro modo "item" (linha ~2126) e do que
    // POST .../alocar-lote já faz na criação em lote (mais abaixo neste arquivo).
    if (no.tipo === "atividade") {
      const houveMudancaResponsavel = responsavelCodfor !== undefined && responsavelCodfor !== no.responsavelCodfor;

      if (houveMudancaResponsavel) {
        // 1:1 na prática (confirmado: 0 de 993 nós com alocação têm mais de uma
        // AtividadeConsultor ativa vinculada) — `findFirst` cobre o caso real.
        const alocacaoAnterior = await prisma.atividadeConsultor.findFirst({
          where: { estruturaAtividadeId: id, sitreg: "A" },
        });

        // Trocar ou limpar: a alocação anterior deixa de existir aqui — mesmo padrão de
        // DELETE /alocacoes/:id (soft-delete + auditoria + remover_atividade).
        if (alocacaoAnterior) {
          await prisma.$transaction([
            prisma.atividadeConsultor.update({ where: { id: alocacaoAnterior.id }, data: { sitreg: "I" } }),
            criarEventoAuditoria({
              origem: "tela",
              usuarioId: user.id,
              codemp: alocacaoAnterior.codemp,
              codpro: alocacaoAnterior.codpro,
              entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
              entidadeId: entidadeIdAtividade(alocacaoAnterior.id),
              entidadeRotulo: `Alocação — Item ${alocacaoAnterior.seqite} da Proposta ${alocacaoAnterior.codemp}/${alocacaoAnterior.codpro}`,
              eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_REMOVIDA,
              alteracoes: null,
              metadata: { motivo: "responsavel_trocado_ou_limpo_na_arvore" },
              correlationId: req.correlationId!,
            }),
          ]);
          await enfileirar(alocacaoAnterior.id, "remover_atividade", {
            codemp: alocacaoAnterior.codemp,
            codpro: alocacaoAnterior.codpro,
            seqite: alocacaoAnterior.seqite,
            codfor: alocacaoAnterior.codfor,
            qtdhor: alocacaoAnterior.qtdhor,
            fasid: alocacaoAnterior.fasid,
            dataPrevistaInicio: alocacaoAnterior.dataPrevistaInicio?.toISOString() ?? null,
            dataPrevistaFim: alocacaoAnterior.dataPrevistaFim?.toISOString() ?? null,
            tipEve: TIP_EVE_EXCLUIR,
          });
        }

        // Definir ou trocar: nasce a alocação nova, já com a duração/datas efetivas desta
        // mesma requisição (se vieram junto) — não precisa de um segundo passo de "editar"
        // em cima. fasid/coluna resolvidos do mesmo jeito que POST .../alocar-lote.
        if (responsavelCodfor != null) {
          const duracaoEfetiva = duracaoHoras !== undefined ? duracaoHoras : no.duracaoHoras;
          const inicioEfetivo = dataPrevistaInicio !== undefined ? dataPrevistaInicio : no.dataPrevistaInicio;
          const fimEfetivo = dataPrevistaFim !== undefined ? dataPrevistaFim : no.dataPrevistaFim;
          const fasidBody = req.body?.fasid != null ? Number(req.body.fasid) : null;
          const fasid =
            fasidBody != null && Number.isFinite(fasidBody)
              ? fasidBody
              : (await prisma.faseProposta.findFirst({ orderBy: { fasid: "asc" } }))?.fasid;
          const primeiraColuna = await prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } });

          if (fasid == null) {
            res.status(400).json({ error: "Nenhuma fase cadastrada — não é possível criar a alocação" });
            return;
          }

          const novaAlocacao = await prisma.$transaction(async (tx) => {
            const criada = await tx.atividadeConsultor.create({
              data: {
                codemp: no.codemp,
                codpro: no.codpro,
                seqite: no.seqite!,
                codfor: responsavelCodfor!,
                qtdhor: duracaoEfetiva,
                sitreg: "A",
                datger: new Date(),
                usuger: contexto.consultor?.codusu ?? null,
                dataPrevistaInicio: inicioEfetivo,
                dataPrevistaFim: fimEfetivo,
                fasid,
                colunaId: primeiraColuna?.id ?? null,
                estruturaAtividadeId: id,
              },
            });
            await criarEventoAuditoria(
              {
                origem: "tela",
                usuarioId: user.id,
                codemp: no.codemp,
                codpro: no.codpro,
                entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
                entidadeId: entidadeIdAtividade(criada.id),
                entidadeRotulo: `Alocação — Item ${no.seqite} da Proposta ${no.codemp}/${no.codpro}`,
                eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_CRIADA,
                alteracoes: null,
                metadata: { qtdhor: duracaoEfetiva, fasid, origem: "arvore-drawer" },
                correlationId: req.correlationId!,
              },
              tx
            );
            return criada;
          });

          await enfileirar(novaAlocacao.id, "criar_atividade", {
            codemp: no.codemp,
            codpro: no.codpro,
            seqite: no.seqite,
            codfor: responsavelCodfor,
            qtdhor: duracaoEfetiva,
            fasid,
            dataPrevistaInicio: inicioEfetivo?.toISOString() ?? null,
            dataPrevistaFim: fimEfetivo?.toISOString() ?? null,
            tipEve: TIP_EVE_INCLUIR,
          });
        }
      } else if (duracaoHoras != null && duracaoHoras !== no.duracaoHoras) {
        const alocacaoVinculada = await prisma.atividadeConsultor.findFirst({
          where: { estruturaAtividadeId: id, sitreg: "A" },
        });
        if (alocacaoVinculada && alocacaoVinculada.qtdhor !== duracaoHoras) {
          await prisma.atividadeConsultor.update({
            where: { id: alocacaoVinculada.id },
            data: { qtdhor: duracaoHoras },
          });
          await enfileirar(alocacaoVinculada.id, "editar_atividade", {
            codemp: alocacaoVinculada.codemp,
            codpro: alocacaoVinculada.codpro,
            seqite: alocacaoVinculada.seqite,
            codfor: alocacaoVinculada.codfor,
            qtdhor: duracaoHoras,
            fasid: alocacaoVinculada.fasid,
            dataPrevistaInicio: alocacaoVinculada.dataPrevistaInicio?.toISOString() ?? null,
            dataPrevistaFim: alocacaoVinculada.dataPrevistaFim?.toISOString() ?? null,
            tipEve: TIP_EVE_ALTERAR,
          });
        }
      }
    }

    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "estrutura-editar");
  }
});

alocacaoRouter.delete("/estrutura/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const no = await prisma.estruturaAtividade.findUnique({ where: { id } });
    if (!no) {
      res.status(404).json({ error: "Nó não encontrado" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    if (no.seqite == null) {
      if (!(await podeGerenciarProposta(role, contexto, no.codemp, no.codpro))) {
        res.status(403).json({ error: "Sem permissão para gerenciar esta proposta" });
        return;
      }
    } else {
      const item = await prisma.propostaItem.findUnique({
        where: { codemp_codpro_seqite: { codemp: no.codemp, codpro: no.codpro, seqite: no.seqite } },
      });
      if (!item || item.depexe == null) {
        res.status(404).json({ error: "Item de proposta não encontrado" });
        return;
      }
      if (!podeMexerNoItem(role, contexto, "excluir", item.depexe, await depexeDaProposta(no.codemp, no.codpro))) {
        res.status(403).json({ error: "Sem permissão para editar a estrutura deste departamento" });
        return;
      }
    }

    const filhos = await prisma.estruturaAtividade.count({ where: { parentId: id } });
    if (filhos > 0) {
      res.status(400).json({ error: "Não é possível excluir: existem itens dentro desta pasta/atividade" });
      return;
    }
    // Pasta raiz com item(ns) da proposta agrupados dentro: uma vez que um item entra
    // numa pasta raiz, ela trava — não pode mais ser excluída (só esvaziada, movendo os
    // itens de volta pra fora, um por um).
    const itensAgrupados = await prisma.propostaItemPosicao.count({ where: { parentId: id } });
    if (itensAgrupados > 0) {
      res.status(400).json({ error: "Não é possível excluir: existem itens da proposta agrupados nesta pasta" });
      return;
    }
    const alocacoesVinculadas = await prisma.atividadeConsultor.findMany({ where: { estruturaAtividadeId: id, sitreg: "A" } });
    if (alocacoesVinculadas.length > 1) {
      res.status(400).json({
        error: `Não é possível excluir: existem ${alocacoesVinculadas.length} consultores alocados nesta atividade — remova as alocações primeiro`,
      });
      return;
    }

    if (alocacoesVinculadas.length === 1) {
      // Exclusão em cascata: uma atividade-folha do lote novo sempre tem exatamente 1
      // consultor vinculado (regra estrutural do módulo, ver alocar-lote) — excluir a
      // atividade sem excluir a alocação deixaria um AtividadeConsultor órfão apontando
      // pra um estruturaAtividadeId inexistente. Mesmo padrão (soft-delete + auditoria +
      // outbox) de DELETE /alocacao/alocacoes/:id, só que dentro da mesma transação da
      // exclusão do nó.
      const alocacao = alocacoesVinculadas[0];
      await prisma.$transaction([
        prisma.atividadeConsultor.update({ where: { id: alocacao.id }, data: { sitreg: "I" } }),
        criarEventoAuditoria({
          origem: "tela",
          usuarioId: ctx.user.id,
          codemp: alocacao.codemp,
          codpro: alocacao.codpro,
          entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
          entidadeId: entidadeIdAtividade(alocacao.id),
          entidadeRotulo: `Alocação — Item ${alocacao.seqite} da Proposta ${alocacao.codemp}/${alocacao.codpro}`,
          eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_REMOVIDA,
          alteracoes: null,
          metadata: null,
          correlationId: req.correlationId!,
        }),
        prisma.estruturaAtividade.delete({ where: { id } }),
      ]);
      await enfileirar(alocacao.id, "remover_atividade", {
        codemp: alocacao.codemp,
        codpro: alocacao.codpro,
        seqite: alocacao.seqite,
        codfor: alocacao.codfor,
        qtdhor: alocacao.qtdhor,
        fasid: alocacao.fasid,
        dataPrevistaInicio: alocacao.dataPrevistaInicio?.toISOString() ?? null,
        dataPrevistaFim: alocacao.dataPrevistaFim?.toISOString() ?? null,
        tipEve: TIP_EVE_EXCLUIR,
      });
      res.json({ ok: true });
      return;
    }

    await prisma.estruturaAtividade.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "estrutura-excluir");
  }
});

// Agrupa (ou solta) um item de proposta dentro de uma pasta raiz — o item continua
// virtual (nunca uma linha em EstruturaAtividade), só a posição é persistida aqui.
// parentId null = solta o item (volta a ficar direto na raiz da árvore, comportamento
// de sempre). Permissão é a mesma de editar o próprio item (mesmo depexe), não a da
// pasta raiz em si (essa foi checada quando a pasta foi criada).
alocacaoRouter.post("/propostas/:codemp/:codpro/itens/:seqite/posicao", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    const seqite = Number(req.params.seqite);
    const parentId = req.body?.parentId != null ? Number(req.body.parentId) : null;
    if (![codemp, codpro, seqite].every(Number.isFinite) || (req.body?.parentId != null && !Number.isFinite(parentId))) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const modo = await resolverModoAlocacao(codemp, codpro);
    if (modo !== "estrutura") {
      res.status(400).json({ error: "Esta proposta não está no modo de alocação por estrutura" });
      return;
    }

    const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
    if (!item || item.depexe == null) {
      res.status(404).json({ error: "Item de proposta não encontrado" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;
    // Regra de proposta, não de item: arrastar um item aqui só o agrupa/desagrupa de uma
    // pasta raiz — é organização da estrutura, igual a criar a pasta, e não distribui
    // hora nenhuma. Com o escopo novo o gestor enxerga a proposta inteira, então travar
    // por item.depexe deixava os itens de outro departamento imóveis no meio da árvore,
    // sem como organizá-los. Alocar continua item a item.
    if (!(await podeGerenciarProposta(role, contexto, codemp, codpro))) {
      res.status(403).json({ error: "Sem permissão para organizar a estrutura desta proposta" });
      return;
    }

    if (parentId != null) {
      const pastaRaiz = await prisma.estruturaAtividade.findUnique({ where: { id: parentId } });
      if (!pastaRaiz || pastaRaiz.codemp !== codemp || pastaRaiz.codpro !== codpro || pastaRaiz.seqite != null) {
        res.status(400).json({ error: "Pasta raiz de destino não encontrada" });
        return;
      }
      if (pastaRaiz.tipo !== "pasta") {
        res.status(400).json({ error: "Só é possível agrupar um item dentro de uma pasta" });
        return;
      }
      await prisma.propostaItemPosicao.upsert({
        where: { codemp_codpro_seqite: { codemp, codpro, seqite } },
        create: { codemp, codpro, seqite, parentId },
        update: { parentId },
      });
    } else {
      await prisma.propostaItemPosicao.deleteMany({ where: { codemp, codpro, seqite } });
    }

    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "item-posicao");
  }
});

alocacaoRouter.post("/itens/:codemp/:codpro/:seqite/alocacoes", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    const seqite = Number(req.params.seqite);
    const codfor = Number(req.body?.codfor);
    const qtdhor = Number(req.body?.qtdhor);
    const fasid = Number(req.body?.fasid);
    if (![codemp, codpro, seqite, codfor, qtdhor, fasid].every(Number.isFinite) || qtdhor <= 0) {
      res.status(400).json({ error: "codfor, qtdhor (>0) e fasid são obrigatórios" });
      return;
    }

    const dataPrevistaInicio = req.body?.dataPrevistaInicio ? new Date(req.body.dataPrevistaInicio) : null;
    const dataPrevistaFim = req.body?.dataPrevistaFim ? new Date(req.body.dataPrevistaFim) : null;
    if (dataPrevistaInicio && dataPrevistaFim && dataPrevistaInicio > dataPrevistaFim) {
      res.status(400).json({ error: "Data de início não pode ser depois da data de fim" });
      return;
    }

    // Modo "estrutura": a alocação mira o nó-folha da EAP em vez de ir direto no item
    // (ver resolverModoAlocacao/EstruturaAtividade) — o nó precisa existir e pertencer
    // a este mesmo item.
    let estruturaAtividadeId: number | null = null;
    if (req.body?.estruturaAtividadeId != null) {
      estruturaAtividadeId = Number(req.body.estruturaAtividadeId);
      if (!Number.isFinite(estruturaAtividadeId)) {
        res.status(400).json({ error: "estruturaAtividadeId inválido" });
        return;
      }
      const no = await prisma.estruturaAtividade.findUnique({ where: { id: estruturaAtividadeId } });
      if (!no || no.codemp !== codemp || no.codpro !== codpro || no.seqite !== seqite) {
        res.status(400).json({ error: "Atividade da estrutura não encontrada neste item" });
        return;
      }
      if (no.tipo !== "atividade") {
        res.status(400).json({ error: "Só é possível alocar consultor em atividades-folha, não em pastas" });
        return;
      }
    }

    const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
    if (!item || item.depexe == null) {
      res.status(404).json({ error: "Item de proposta não encontrado" });
      return;
    }

    const proposta = await prisma.proposta.findUnique({ where: { codemp_codpro: { codemp, codpro } } });
    if (!proposta || proposta.sitpro == null || !SITPRO_ALOCAVEL.includes(proposta.sitpro)) {
      res.status(400).json({ error: "Só é possível alocar horas em propostas Aprovada ou Em Execução" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto, role } = ctx;

    if (!podeMexerNoItem(role, contexto, "criar", item.depexe, proposta.depexe, codfor)) {
      res.status(403).json({ error: "Sem permissão para alocar neste departamento" });
      return;
    }

    // O consultor precisa ser de um dos departamentos alocáveis no item — o do item ou um
    // que eu gerencie (ver departamentosAlocaveisNoItem). Antes exigia o time do item, e
    // era isso que impedia o dono da proposta de pôr o próprio pessoal num item de outro
    // departamento.
    const consultorAlvo = await prisma.consultor.findFirst({ where: { codemp, codfor } });
    const codususPermitidos = await codususAlocaveisNoItem(role, contexto, codemp, item.depexe);
    if (!consultorAlvo || !codususPermitidos.has(consultorAlvo.codusu)) {
      res.status(400).json({
        error: "Consultor não está no time do departamento do item nem em nenhum que você gerencia",
      });
      return;
    }

    const saldo = await validarSaldo(codemp, codpro, seqite, qtdhor, { estruturaAtividadeId: estruturaAtividadeId ?? undefined });
    if (!saldo.ok) {
      res.status(400).json({ error: saldo.erro });
      return;
    }

    const primeiraColuna = await prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } });

    // Transação interativa (não array): o entidadeId do evento de auditoria é o `id`
    // gerado pelo create, que só existe depois do insert — o padrão "array de operações"
    // usado no resto do projeto não permite essa dependência entre operações da mesma
    // transação.
    const nova = await prisma.$transaction(async (tx) => {
      const criada = await tx.atividadeConsultor.create({
        data: {
          codemp,
          codpro,
          seqite,
          codfor,
          qtdhor,
          sitreg: "A",
          datger: new Date(),
          usuger: contexto.consultor?.codusu ?? null,
          dataPrevistaInicio,
          dataPrevistaFim,
          fasid,
          colunaId: primeiraColuna?.id ?? null,
          estruturaAtividadeId,
        },
      });

      const entidadeRotulo = `Alocação de ${consultorAlvo?.nomcom ?? consultorAlvo?.nomfor ?? `Fornecedor ${codfor}`} — Item ${seqite}`;
      await criarEventoAuditoria(
        {
          origem: "tela",
          usuarioId: user.id,
          codemp,
          codpro,
          entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
          entidadeId: entidadeIdAtividade(criada.id),
          entidadeRotulo,
          eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_CRIADA,
          alteracoes: null,
          metadata: { qtdhor, fasid },
          correlationId: req.correlationId!,
        },
        tx
      );

      return criada;
    });

    await enfileirar(nova.id, "criar_atividade", {
      codemp,
      codpro,
      seqite,
      codfor,
      qtdhor,
      fasid,
      dataPrevistaInicio: dataPrevistaInicio?.toISOString() ?? null,
      dataPrevistaFim: dataPrevistaFim?.toISOString() ?? null,
      tipEve: TIP_EVE_INCLUIR,
    });

    res.status(201).json({ id: nova.id });
  } catch (error) {
    handleError(res, error, "criar-alocacao");
  }
});

// Sinaliza especificamente "o saldo mudou entre o usuário abrir o modal e confirmar" —
// path de erro à parte do 400 de validação normal (ver validarSaldo/validarSomaEstrutura
// acima, que não tem esse precedente de 409): revalidado por último, já dentro da
// transação, imediatamente antes dos create — se alguém mais gravou horas nesse meio-
// tempo, aborta e o cliente recarrega a árvore em vez de só mostrar o erro.
class SaldoDivergenteError extends Error {}

interface ConsultorLoteInput {
  codfor: number;
  qtdhor: number;
}

type DestinoLote = { tipo: "item" } | { tipo: "pasta"; pastaId: number } | { tipo: "nova_pasta"; nome: string };

function parseDestinoLote(body: unknown): DestinoLote | null {
  const destino = (body as { destino?: unknown } | undefined)?.destino as Record<string, unknown> | undefined;
  if (!destino || typeof destino.tipo !== "string") return null;
  if (destino.tipo === "item") return { tipo: "item" };
  if (destino.tipo === "pasta") {
    const pastaId = Number(destino.pastaId);
    return Number.isFinite(pastaId) ? { tipo: "pasta", pastaId } : null;
  }
  if (destino.tipo === "nova_pasta") {
    const nome = typeof destino.nome === "string" ? destino.nome.trim() : "";
    return nome !== "" ? { tipo: "nova_pasta", nome } : null;
  }
  return null;
}

// Alocação em lote (EAP): cria N atividades-folha irmãs — uma por consultor marcado no
// modal "Alocar consultores" — todas filhas do mesmo destino (o próprio item, uma pasta
// já existente, ou uma pasta nova criada na hora). Cada atividade tem sempre exatamente
// 1 consultor (regra estrutural do módulo) — nunca reaproveita um nó existente pra
// receber um 2º consultor, mesmo que o schema tecnicamente permita (AtividadeConsultor.
// estruturaAtividadeId aceita N linhas por nó, usado historicamente pelo fluxo antigo de
// POST .../alocacoes com estruturaAtividadeId de um nó já criado à parte — aqui sempre
// nasce 1 nó novo por consultor).
alocacaoRouter.post("/itens/:codemp/:codpro/:seqite/alocar-lote", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    const seqite = Number(req.params.seqite);
    if (![codemp, codpro, seqite].every(Number.isFinite)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const destino = parseDestinoLote(req.body);
    if (!destino) {
      res.status(400).json({ error: "destino inválido — use 'item', 'pasta' (com pastaId) ou 'nova_pasta' (com nome)" });
      return;
    }

    const consultoresRaw = Array.isArray(req.body?.consultores) ? (req.body.consultores as unknown[]) : [];
    const consultores: ConsultorLoteInput[] = consultoresRaw.map((c) => ({
      codfor: Number((c as Record<string, unknown>)?.codfor),
      qtdhor: Number((c as Record<string, unknown>)?.qtdhor),
    }));
    if (consultores.length === 0 || consultores.some((c) => !Number.isFinite(c.codfor) || !Number.isFinite(c.qtdhor) || c.qtdhor <= 0)) {
      res.status(400).json({ error: "Informe ao menos 1 consultor, cada um com qtdhor (>0)" });
      return;
    }
    const codforsUnicos = new Set(consultores.map((c) => c.codfor));
    if (codforsUnicos.size !== consultores.length) {
      res.status(400).json({ error: "Consultor duplicado na lista" });
      return;
    }

    const dataPrevistaInicio = req.body?.dataPrevistaInicio ? new Date(req.body.dataPrevistaInicio) : null;
    const dataPrevistaFim = req.body?.dataPrevistaFim ? new Date(req.body.dataPrevistaFim) : null;
    if (dataPrevistaInicio && dataPrevistaFim && dataPrevistaInicio > dataPrevistaFim) {
      res.status(400).json({ error: "Data de início não pode ser depois da data de fim" });
      return;
    }

    const modo = await resolverModoAlocacao(codemp, codpro);
    if (modo !== "estrutura") {
      res.status(400).json({ error: "Esta proposta não está no modo de alocação por estrutura" });
      return;
    }

    const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
    if (!item) {
      res.status(404).json({ error: "Item de proposta não encontrado" });
      return;
    }
    if (item.depexe == null) {
      res.status(400).json({ error: "Item sem departamento de execução definido" });
      return;
    }

    const proposta = await prisma.proposta.findUnique({ where: { codemp_codpro: { codemp, codpro } } });
    if (!proposta || proposta.sitpro == null || !SITPRO_ALOCAVEL.includes(proposta.sitpro)) {
      res.status(400).json({ error: "Só é possível alocar horas em propostas Aprovada ou Em Execução" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto, role } = ctx;

    if (!podeMexerNoItem(role, contexto, "criar", item.depexe, proposta.depexe)) {
      res.status(403).json({ error: "Sem permissão para alocar neste departamento" });
      return;
    }

    // Resolve o nó de destino (não a pasta nova ainda — essa só nasce dentro da
    // transação, junto com as atividades, pra não deixar uma pasta órfã se o resto
    // falhar).
    let pastaDestinoExistente: Awaited<ReturnType<typeof prisma.estruturaAtividade.findUnique>> = null;
    if (destino.tipo === "pasta") {
      pastaDestinoExistente = await prisma.estruturaAtividade.findUnique({ where: { id: destino.pastaId } });
      if (
        !pastaDestinoExistente ||
        pastaDestinoExistente.codemp !== codemp ||
        pastaDestinoExistente.codpro !== codpro ||
        pastaDestinoExistente.seqite !== seqite ||
        pastaDestinoExistente.tipo !== "pasta"
      ) {
        res.status(400).json({ error: "Pasta de destino não encontrada" });
        return;
      }
    }

    // Consultor precisa existir, estar ativo E ser de um departamento alocável neste item
    // — mesma checagem de POST .../alocacoes, aplicada a cada linha do lote.
    const codforsAtivos = await prisma.consultor.findMany({
      where: { codemp, codfor: { in: [...codforsUnicos] }, sitfor: "A" },
    });
    const consultorPorCodfor = new Map(codforsAtivos.map((c) => [c.codfor as number, c]));
    const faltantes = [...codforsUnicos].filter((cf) => !consultorPorCodfor.has(cf));
    if (faltantes.length > 0) {
      res.status(400).json({ error: `Consultor(es) não encontrado(s) ou inativo(s): ${faltantes.join(", ")}` });
      return;
    }
    const codususPermitidos = await codususAlocaveisNoItem(role, contexto, codemp, item.depexe);
    const foraDoTime = codforsAtivos.filter((c) => !codususPermitidos.has(c.codusu));
    if (foraDoTime.length > 0) {
      res.status(400).json({
        error: `Consultor(es) fora do time do departamento do item e dos que você gerencia: ${foraDoTime
          .map((c) => c.nomcom ?? c.nomfor ?? c.codfor)
          .join(", ")}`,
      });
      return;
    }

    const fasidBody = req.body?.fasid != null ? Number(req.body.fasid) : null;
    let fasid: number;
    if (fasidBody != null) {
      if (!Number.isFinite(fasidBody) || !(await prisma.faseProposta.findUnique({ where: { fasid: fasidBody } }))) {
        res.status(400).json({ error: "fasid inválido" });
        return;
      }
      fasid = fasidBody;
    } else {
      const primeiraFase = await prisma.faseProposta.findFirst({ orderBy: { fasid: "asc" } });
      if (!primeiraFase) {
        res.status(400).json({ error: "Nenhuma fase cadastrada" });
        return;
      }
      fasid = primeiraFase.fasid;
    }

    const primeiraColuna = await prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } });
    const somaLote = consultores.reduce((soma, c) => soma + c.qtdhor, 0);

    let criadas: { id: number; estruturaAtividadeId: number; codfor: number; qtdhor: number }[] = [];
    let pastaCriadaId: number | null = null;

    try {
      await prisma.$transaction(async (tx) => {
        // Revalidação final do saldo do item, já dentro da transação — a mesma conta de
        // validarSomaEstrutura, mas recalculada agora (não com o snapshot que o modal
        // carregou) e incluindo a soma do lote inteiro de uma vez, não consultor a
        // consultor (senão o 1º consultor "reservaria" saldo que o 2º acabaria vendo como
        // livre, mesmo os dois cabendo juntos ou os dois estourando juntos).
        const itemAtual = await tx.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
        if (!itemAtual || itemAtual.qtdhor == null) throw new SaldoDivergenteError("Item sem horas definidas na proposta");
        const folhasAtuais = await tx.estruturaAtividade.findMany({ where: { codemp, codpro, seqite, tipo: "atividade" } });
        const somaAtual = folhasAtuais.reduce((soma, n) => soma + (n.duracaoHoras ?? 0), 0);
        if (somaAtual + somaLote > itemAtual.qtdhor) {
          throw new SaldoDivergenteError(
            `O saldo do item mudou — disponível agora: ${formatHorasSimples(itemAtual.qtdhor - somaAtual)}, tentando alocar: ${formatHorasSimples(somaLote)}`
          );
        }

        let parentId: number | null;
        if (destino.tipo === "item") {
          parentId = null;
        } else if (destino.tipo === "pasta") {
          parentId = destino.pastaId;
        } else {
          const irmaosRaiz = await tx.estruturaAtividade.findMany({ where: { codemp, codpro, seqite, parentId: null } });
          const ordemPasta = irmaosRaiz.length > 0 ? Math.max(...irmaosRaiz.map((n) => n.ordem)) + 1 : 0;
          const novaPasta = await tx.estruturaAtividade.create({
            data: {
              codemp,
              codpro,
              seqite,
              parentId: null,
              tipo: "pasta",
              nome: truncarNomeEstrutura(destino.nome),
              ordem: ordemPasta,
              criadoPor: contexto.consultor?.codusu ?? null,
            },
          });
          pastaCriadaId = novaPasta.id;
          parentId = novaPasta.id;
        }

        const irmaosDestino = await tx.estruturaAtividade.findMany({ where: { codemp, codpro, seqite, parentId } });
        let proximaOrdem = irmaosDestino.length > 0 ? Math.max(...irmaosDestino.map((n) => n.ordem)) + 1 : 0;

        // Nome da atividade = nome do ITEM (mesma regra de useCronograma.ts no
        // frontend: despro se tiver, senão codser) — o consultor não vira o título da
        // atividade, só o responsável (responsavelCodfor abaixo), mostrado como
        // avatar/iniciais na árvore (LinhaNo.tsx já resolve isso, sem mudança de UI).
        const nomeAtividade = truncarNomeEstrutura(item.despro ?? item.codser);

        for (const c of consultores) {
          const consultorInfo = consultorPorCodfor.get(c.codfor)!;
          const nomeConsultor = consultorInfo.nomcom ?? consultorInfo.nomfor ?? `Fornecedor ${c.codfor}`;

          const noEstrutura = await tx.estruturaAtividade.create({
            data: {
              codemp,
              codpro,
              seqite,
              parentId,
              tipo: "atividade",
              nome: nomeAtividade,
              responsavelCodfor: c.codfor,
              ordem: proximaOrdem++,
              duracaoHoras: c.qtdhor,
              dataPrevistaInicio,
              dataPrevistaFim,
              criadoPor: contexto.consultor?.codusu ?? null,
            },
          });

          const atividadeConsultor = await tx.atividadeConsultor.create({
            data: {
              codemp,
              codpro,
              seqite,
              codfor: c.codfor,
              qtdhor: c.qtdhor,
              sitreg: "A",
              datger: new Date(),
              usuger: contexto.consultor?.codusu ?? null,
              dataPrevistaInicio,
              dataPrevistaFim,
              fasid,
              colunaId: primeiraColuna?.id ?? null,
              estruturaAtividadeId: noEstrutura.id,
            },
          });

          const entidadeRotulo = `Alocação de ${nomeConsultor} — Item ${seqite}`;
          await criarEventoAuditoria(
            {
              origem: "tela",
              usuarioId: user.id,
              codemp,
              codpro,
              entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
              entidadeId: entidadeIdAtividade(atividadeConsultor.id),
              entidadeRotulo,
              eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_CRIADA,
              alteracoes: null,
              metadata: { qtdhor: c.qtdhor, fasid, loteDestino: destino.tipo },
              correlationId: req.correlationId!,
            },
            tx
          );

          criadas.push({ id: atividadeConsultor.id, estruturaAtividadeId: noEstrutura.id, codfor: c.codfor, qtdhor: c.qtdhor });
        }
      });
    } catch (error) {
      if (error instanceof SaldoDivergenteError) {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }

    for (const c of criadas) {
      await enfileirar(c.id, "criar_atividade", {
        codemp,
        codpro,
        seqite,
        codfor: c.codfor,
        qtdhor: c.qtdhor,
        fasid,
        dataPrevistaInicio: dataPrevistaInicio?.toISOString() ?? null,
        dataPrevistaFim: dataPrevistaFim?.toISOString() ?? null,
        tipEve: TIP_EVE_INCLUIR,
      });
    }

    res.status(201).json({ pastaId: pastaCriadaId, atividades: criadas });
  } catch (error) {
    handleError(res, error, "alocar-lote");
  }
});

async function carregarAlocacaoComDepexe(id: number) {
  const atividade = await prisma.atividadeConsultor.findUnique({ where: { id } });
  if (!atividade) return null;
  const item = await prisma.propostaItem.findUnique({
    where: { codemp_codpro_seqite: { codemp: atividade.codemp, codpro: atividade.codpro, seqite: atividade.seqite } },
  });
  if (!item || item.depexe == null) return null;
  // O depexe da proposta vem junto porque editar/excluir uma alocação decide pela MESMA
  // regra que criar (podeMexerNoItem). Sem ele o dono da proposta criaria a alocação num
  // item de outro departamento e depois não conseguiria corrigir as horas nem removê-la.
  const propostaDepexe = await depexeDaProposta(atividade.codemp, atividade.codpro);
  return { atividade, depexe: item.depexe, propostaDepexe };
}

alocacaoRouter.patch("/alocacoes/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const qtdhor = Number(req.body?.qtdhor);
    if (!Number.isFinite(id) || !Number.isFinite(qtdhor) || qtdhor <= 0) {
      res.status(400).json({ error: "qtdhor (>0) é obrigatório" });
      return;
    }

    const dataPrevistaInicio = req.body?.dataPrevistaInicio ? new Date(req.body.dataPrevistaInicio) : null;
    const dataPrevistaFim = req.body?.dataPrevistaFim ? new Date(req.body.dataPrevistaFim) : null;
    if (dataPrevistaInicio && dataPrevistaFim && dataPrevistaInicio > dataPrevistaFim) {
      res.status(400).json({ error: "Data de início não pode ser depois da data de fim" });
      return;
    }

    const resolvido = await carregarAlocacaoComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Alocação não encontrada" });
      return;
    }
    const { atividade, depexe } = resolvido;

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    if (!podeMexerNoItem(role, contexto, "editar", depexe, resolvido.propostaDepexe, atividade.codfor)) {
      res.status(403).json({ error: "Sem permissão para editar esta alocação" });
      return;
    }

    // Horas excedentes NÃO passam por validarSaldo de propósito: elas são justamente a
    // autorização pra estourar o contratado do item. Confrontá-las com o saldo do item
    // recriaria o teto que elas existem pra furar.
    //
    // Ausente no body = mantém o valor gravado, pra uma tela que edita só horas/datas não
    // zerar o excedente sem querer.
    const horasExcedentesBody = req.body?.horasExcedentes;
    const horasExcedentes = horasExcedentesBody === undefined ? null : Number(horasExcedentesBody);
    if (horasExcedentes !== null && (!Number.isFinite(horasExcedentes) || horasExcedentes < 0)) {
      res.status(400).json({ error: "horasExcedentes precisa ser um número maior ou igual a zero" });
      return;
    }

    const saldo = await validarSaldo(atividade.codemp, atividade.codpro, atividade.seqite, qtdhor, {
      ignorarAtividadeId: id,
      estruturaAtividadeId: atividade.estruturaAtividadeId ?? undefined,
    });
    if (!saldo.ok) {
      res.status(400).json({ error: saldo.erro });
      return;
    }

    const entidadeId = entidadeIdAtividade(id);
    const entidadeRotulo = `Alocação — Item ${atividade.seqite} da Proposta ${atividade.codemp}/${atividade.codpro}`;
    const correlationId = req.correlationId!;
    const ctxEvento = {
      origem: "tela" as const,
      usuarioId: ctx.user.id,
      codemp: atividade.codemp,
      codpro: atividade.codpro,
      entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
      entidadeId,
      entidadeRotulo,
      correlationId,
    };

    const camposAlterados = horasExcedentes !== null ? { qtdhor, horasExcedentes } : { qtdhor };
    const diffHoras = diffCampos(CAMPOS_AUDITADOS_ALOCACAO, atividade, paraDiff(camposAlterados));
    const operacoes: Prisma.PrismaPromise<unknown>[] = [
      prisma.atividadeConsultor.update({
        where: { id },
        data: {
          qtdhor,
          dataPrevistaInicio,
          dataPrevistaFim,
          ...(horasExcedentes !== null ? { horasExcedentes } : {}),
        },
      }),
    ];
    if (diffHoras.algumaMudanca) {
      operacoes.push(
        criarEventoAuditoria({
          ...ctxEvento,
          eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_ALTERADA,
          alteracoes: diffHoras.alteracoes,
          metadata: null,
        })
      );
    }
    operacoes.push(
      ...criarEventosDeData(
        CAMPOS_AUDITADOS_ATIVIDADE_DATAS,
        { dataPrevistaInicio: atividade.dataPrevistaInicio, dataPrevistaFim: atividade.dataPrevistaFim },
        { dataPrevistaInicio, dataPrevistaFim },
        { ...ctxEvento, entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE }
      )
    );
    await prisma.$transaction(operacoes);

    await enfileirar(id, "editar_atividade", {
      codemp: atividade.codemp,
      codpro: atividade.codpro,
      seqite: atividade.seqite,
      codfor: atividade.codfor,
      qtdhor,
      fasid: atividade.fasid,
      dataPrevistaInicio: dataPrevistaInicio?.toISOString() ?? null,
      dataPrevistaFim: dataPrevistaFim?.toISOString() ?? null,
      tipEve: TIP_EVE_ALTERAR,
    });

    res.json({ id, qtdhor, horasExcedentes: horasExcedentes ?? atividade.horasExcedentes, dataPrevistaInicio, dataPrevistaFim });
  } catch (error) {
    handleError(res, error, "editar-alocacao");
  }
});

alocacaoRouter.delete("/alocacoes/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const resolvido = await carregarAlocacaoComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Alocação não encontrada" });
      return;
    }
    const { atividade, depexe } = resolvido;

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    if (!podeMexerNoItem(role, contexto, "excluir", depexe, resolvido.propostaDepexe, atividade.codfor)) {
      res.status(403).json({ error: "Sem permissão para remover esta alocação" });
      return;
    }

    // Soft-delete (mesma convenção do sitreg do ERP: A=Ativo, I=Inativo) — evita mexer
    // no histórico/comentários/anexos já vinculados e é o mesmo filtro que já esconde
    // a atividade das telas de Kanban/Lista/Calendário/Timeline/Workload.
    await prisma.$transaction([
      prisma.atividadeConsultor.update({ where: { id }, data: { sitreg: "I" } }),
      criarEventoAuditoria({
        origem: "tela",
        usuarioId: ctx.user.id,
        codemp: atividade.codemp,
        codpro: atividade.codpro,
        entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
        entidadeId: entidadeIdAtividade(id),
        entidadeRotulo: `Alocação — Item ${atividade.seqite} da Proposta ${atividade.codemp}/${atividade.codpro}`,
        eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_REMOVIDA,
        alteracoes: null,
        metadata: null,
        correlationId: req.correlationId!,
      }),
    ]);
    await enfileirar(id, "remover_atividade", {
      codemp: atividade.codemp,
      codpro: atividade.codpro,
      seqite: atividade.seqite,
      codfor: atividade.codfor,
      qtdhor: atividade.qtdhor,
      fasid: atividade.fasid,
      dataPrevistaInicio: atividade.dataPrevistaInicio?.toISOString() ?? null,
      dataPrevistaFim: atividade.dataPrevistaFim?.toISOString() ?? null,
      tipEve: TIP_EVE_EXCLUIR,
    });

    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "remover-alocacao");
  }
});
