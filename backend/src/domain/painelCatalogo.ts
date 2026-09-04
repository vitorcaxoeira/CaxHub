// ---------------------------------------------------------------------------
// Catálogo de painéis do Modo Painel/TV — GENÉRICO no formato (PainelDef,
// DefinicaoFiltro), ESPECÍFICO do CaxHub no conteúdo (o array PAINEIS). Um
// projeto novo que herdar o mecanismo troca só o array e os resolvers de
// `carregar` — o schema (PainelTv/PainelTvItem), os endpoints e o motor de
// rotação do frontend não mudam.
//
// Cada painel é um componente React (frontend/src/paineis/registry.ts mapeia
// o mesmo `id` pro componente) — não existe tabela de painéis no banco, só a
// config de QUAL painel entra em QUAL rotação (PainelTvItem.painelId).
// ---------------------------------------------------------------------------

import { prisma } from "../db/prisma";
import { depexeLabel, SITPRO_ATIVIDADES_VISIVEIS } from "./propostasDominio";
import { nomeConsultor, consultoresDosDepartamentos } from "./contextoProjeto";
import { diasDoPeriodo, horasRealizadasPorConsultorNoPeriodo, metasDoPeriodo } from "./resumoConsultor";
import { escolherDescricaoPadrao } from "./execucaoAtividade";

export interface DefinicaoFiltro {
  chave: string; // "depexe" | "codfor" | "periodo"
  tipo: "depexe" | "codfor" | "periodo";
  label: string;
  obrigatorio: boolean;
  multiplo: boolean;
}

// Domínio de sincronização externa que o painel pode disparar antes de
// mostrar (PainelTvItem.modoAtualizacao === "erp"). `null` = o painel não tem
// origem externa (é 100% CaxHub) e o modo "erp" nem é oferecido pra ele na
// tela de administração.
export type DominioSyncPainel = "projetos"; // | "financeiro" | "contabil" | "comercial" (fases futuras)

// Contexto resolvido pra UMA exibição de um painel: contexto base da TV
// (PainelTv.depexe/codemp) já mesclado com os filtros próprios do item
// (PainelTvItem.filtros) — já mesclado pelo router antes de chamar `carregar`.
export interface ContextoPainel {
  codemp: number;
  depexe: number | null;
  codfors: number[] | null; // null = sem filtro de consultor (todo o depto)
  periodo: { ano: number; mes: number } | null; // null = painel sem filtro de período
}

export interface PainelDef {
  id: string;
  nome: string;
  descricao: string;
  grupo: string; // agrupa a tela de admin (ex.: "Projetos e horas do time")
  filtros: DefinicaoFiltro[];
  dominioSync: DominioSyncPainel | null;
  duracaoPadraoSegundos: number;
  // Ausente até o painel ganhar seu resolver (cada um entra na fase do plano em
  // que aquele painel é implementado). GET /catalogo nunca serializa este
  // campo pro cliente — só o backend chama `carregar`.
  carregar?: (ctx: ContextoPainel) => Promise<unknown>;
}

// "Atividades do setor" — reaproveita o VOCABULÁRIO de routes/atividades.ts
// (definição de atrasada, ehFinal/contaComoExecucao, SITPRO_ATIVIDADES_VISIVEIS),
// não a função pesada `carregarAtividadesVisiveis` (que carrega TODA atividade
// ativa do sistema e filtra em memória por permissão — o oposto do que uma
// query de painel precisa: `where` já restrito ao departamento, indexado).
async function carregarAtividadesSetor(ctx: ContextoPainel) {
  if (ctx.depexe == null) return { erro: "Departamento não configurado para este painel." };

  const itensDoDepto = await prisma.propostaItem.findMany({
    where: { codemp: ctx.codemp, depexe: ctx.depexe },
    select: { codemp: true, codpro: true, seqite: true },
  });
  const chavesValidas = new Set(itensDoDepto.map((i) => `${i.codemp}-${i.codpro}-${i.seqite}`));
  const codprosUnicos = [...new Set(itensDoDepto.map((i) => i.codpro))];
  if (codprosUnicos.length === 0) {
    return { depexeLabel: depexeLabel(ctx.depexe), total: 0, backlog: 0, emCurso: 0, atrasadas: 0, concluidasNoMes: 0, porConsultor: [] };
  }

  const [atividadesBrutas, propostas] = await Promise.all([
    prisma.atividadeConsultor.findMany({
      where: {
        sitreg: "A",
        codemp: ctx.codemp,
        codpro: { in: codprosUnicos },
        ...(ctx.codfors && ctx.codfors.length > 0 ? { codfor: { in: ctx.codfors } } : {}),
      },
      include: { coluna: true },
    }),
    prisma.proposta.findMany({ where: { codemp: ctx.codemp, codpro: { in: codprosUnicos } }, select: { codpro: true, sitpro: true } }),
  ]);
  const sitproPorCodpro = new Map(propostas.map((p) => [p.codpro, p.sitpro]));

  // `IN` por codpro trouxe um superset (todo item daquele codpro, mesmo de outro
  // departamento) — recorta pra chave exata e pra proposta em situação visível, mesmo
  // filtro de SITPRO_ATIVIDADES_VISIVEIS que a listagem normal de Atividades aplica.
  const atividades = atividadesBrutas.filter((a) => {
    if (!chavesValidas.has(`${a.codemp}-${a.codpro}-${a.seqite}`)) return false;
    const sitpro = sitproPorCodpro.get(a.codpro);
    return sitpro != null && SITPRO_ATIVIDADES_VISIVEIS.includes(sitpro);
  });

  const hoje = new Date(new Date().toDateString());
  let backlog = 0;
  let emCurso = 0;
  let atrasadas = 0;
  const concluidasIds: number[] = [];
  const porConsultor = new Map<number, { codfor: number; nome: string; qtd: number }>();

  for (const a of atividades) {
    const ehFinal = a.coluna?.ehFinal ?? false;
    if (ehFinal) {
      concluidasIds.push(a.id);
    } else {
      if (a.coluna?.contaComoExecucao) emCurso += 1;
      else backlog += 1;
      if (a.dataPrevistaFim != null && new Date(a.dataPrevistaFim) < hoje) atrasadas += 1;

      const bucket = porConsultor.get(a.codfor) ?? { codfor: a.codfor, nome: `Fornecedor ${a.codfor}`, qtd: 0 };
      bucket.qtd += 1;
      porConsultor.set(a.codfor, bucket);
    }
  }

  const consultores =
    porConsultor.size > 0
      ? await prisma.consultor.findMany({ where: { codfor: { in: [...porConsultor.keys()] } } })
      : [];
  for (const c of consultores) {
    if (c.codfor == null) continue;
    const bucket = porConsultor.get(c.codfor);
    if (bucket) bucket.nome = nomeConsultor(c);
  }

  // "Concluídas NO MÊS" — primeira entrada numa coluna final, dentro do mês corrente. Mesma
  // fonte (AtividadeHistoricoMovimentacao.colunaNova.ehFinal) do SLA em GET /atividades/indicadores.
  let concluidasNoMes = 0;
  if (concluidasIds.length > 0) {
    const agora = new Date();
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const fimMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 1);
    const movimentos = await prisma.atividadeHistoricoMovimentacao.findMany({
      where: { atividadeId: { in: concluidasIds }, colunaNova: { ehFinal: true }, movidoEm: { gte: inicioMes, lt: fimMes } },
      select: { atividadeId: true },
      distinct: ["atividadeId"],
    });
    concluidasNoMes = movimentos.length;
  }

  return {
    depexeLabel: depexeLabel(ctx.depexe),
    total: atividades.length,
    backlog,
    emCurso,
    atrasadas,
    concluidasNoMes,
    porConsultor: [...porConsultor.values()].sort((a, b) => b.qtd - a.qtd).slice(0, 8),
  };
}

// "Horas do time no mês" — reaproveita domain/resumoConsultor.ts, a MESMA definição de
// "horas realizadas" e "meta" que o Dashboard inicial (Home/DashboardConsultor) usa pra
// um consultor só; aqui em lote, pro time inteiro de um departamento de uma vez.
async function carregarHorasMeta(ctx: ContextoPainel) {
  if (ctx.depexe == null) return { erro: "Departamento não configurado para este painel." };
  const periodo = ctx.periodo ?? { ano: new Date().getFullYear(), mes: new Date().getMonth() + 1 };

  const timeDoDepto = await consultoresDosDepartamentos([ctx.depexe]);
  let codforsAlvo = timeDoDepto.filter((c) => c.codfor != null).map((c) => c.codfor as number);
  if (ctx.codfors && ctx.codfors.length > 0) {
    const permitidos = new Set(ctx.codfors);
    codforsAlvo = codforsAlvo.filter((cf) => permitidos.has(cf));
  }
  if (codforsAlvo.length === 0) {
    return {
      depexeLabel: depexeLabel(ctx.depexe),
      periodo,
      porConsultor: [],
      evolucaoDiaria: [],
      totalRealizadoMinutos: 0,
      totalMetaMinutos: 0,
    };
  }

  const de = new Date(Date.UTC(periodo.ano, periodo.mes - 1, 1));
  const ate = new Date(Date.UTC(periodo.ano, periodo.mes, 0)); // dia 0 do mês seguinte = último dia deste mês

  const [realizadoPorConsultor, metaPorConsultor, consultores] = await Promise.all([
    horasRealizadasPorConsultorNoPeriodo(ctx.codemp, codforsAlvo, de, ate),
    metasDoPeriodo(ctx.codemp, codforsAlvo, de, ate),
    prisma.consultor.findMany({ where: { codfor: { in: codforsAlvo } } }),
  ]);
  const nomePorCodfor = new Map(consultores.filter((c) => c.codfor != null).map((c) => [c.codfor as number, nomeConsultor(c)]));

  const porConsultor = codforsAlvo
    .map((codfor) => ({
      codfor,
      nome: nomePorCodfor.get(codfor) ?? `Fornecedor ${codfor}`,
      realizadoMinutos: realizadoPorConsultor.get(codfor)?.totalMinutos ?? 0,
      metaMinutos: metaPorConsultor.get(codfor)?.metaTotalMinutos ?? 0,
    }))
    .sort((a, b) => b.realizadoMinutos - a.realizadoMinutos);

  // Evolução diária do TIME inteiro — soma o `porDia` de cada consultor, dia a dia.
  const evolucaoPorDia = new Map<string, number>();
  for (const r of realizadoPorConsultor.values()) {
    for (const [dia, minutos] of r.porDia) evolucaoPorDia.set(dia, (evolucaoPorDia.get(dia) ?? 0) + minutos);
  }
  const evolucaoDiaria = diasDoPeriodo(de, ate).map((dia) => ({ data: dia, minutos: evolucaoPorDia.get(dia) ?? 0 }));

  return {
    depexeLabel: depexeLabel(ctx.depexe),
    periodo,
    porConsultor,
    evolucaoDiaria,
    totalRealizadoMinutos: porConsultor.reduce((s, c) => s + c.realizadoMinutos, 0),
    totalMetaMinutos: porConsultor.reduce((s, c) => s + c.metaMinutos, 0),
  };
}

// "Em execução agora" — sessão de execução ABERTA (fim: null) nasce e morre 100% no
// CaxHub (AtividadeSessaoExecucao), sem origem externa — por isso dominioSync: null lá
// embaixo. O tempo decorrido é calculado no CLIENTE a partir de `inicio` (useCronometro),
// não recarregado a cada rotação — é o painel mais "vivo" da TV, mas o servidor só
// precisa dizer QUANDO começou, uma vez.
async function carregarEmExecucao(ctx: ContextoPainel) {
  if (ctx.depexe == null) return { erro: "Departamento não configurado para este painel." };

  const itensDoDepto = await prisma.propostaItem.findMany({
    where: { codemp: ctx.codemp, depexe: ctx.depexe },
    select: { codemp: true, codpro: true, seqite: true, despro: true },
  });
  const chavesValidas = new Set(itensDoDepto.map((i) => `${i.codemp}-${i.codpro}-${i.seqite}`));
  const desproPorChave = new Map(itensDoDepto.map((i) => [`${i.codemp}-${i.codpro}-${i.seqite}`, i.despro]));
  const codprosUnicos = [...new Set(itensDoDepto.map((i) => i.codpro))];
  if (codprosUnicos.length === 0) return { depexeLabel: depexeLabel(ctx.depexe), emExecucao: [] };

  const sessoesAbertas = await prisma.atividadeSessaoExecucao.findMany({
    where: {
      fim: null,
      atividade: {
        sitreg: "A",
        codemp: ctx.codemp,
        codpro: { in: codprosUnicos },
        ...(ctx.codfors && ctx.codfors.length > 0 ? { codfor: { in: ctx.codfors } } : {}),
      },
    },
    include: { atividade: { include: { estruturaAtividade: true } } },
  });

  // `IN` por codpro trouxe um superset (mesmo cuidado de carregarAtividadesSetor acima) —
  // recorta pra chave exata do item deste departamento.
  const relevantes = sessoesAbertas.filter((s) => chavesValidas.has(`${s.atividade.codemp}-${s.atividade.codpro}-${s.atividade.seqite}`));
  if (relevantes.length === 0) return { depexeLabel: depexeLabel(ctx.depexe), emExecucao: [] };

  const codforsUnicos = [...new Set(relevantes.map((s) => s.atividade.codfor))];
  const codprosDasSessoes = [...new Set(relevantes.map((s) => s.atividade.codpro))];
  const [consultores, propostas] = await Promise.all([
    prisma.consultor.findMany({ where: { codfor: { in: codforsUnicos } } }),
    prisma.proposta.findMany({ where: { codemp: ctx.codemp, codpro: { in: codprosDasSessoes } }, include: { cliente: true } }),
  ]);
  const nomePorCodfor = new Map(consultores.filter((c) => c.codfor != null).map((c) => [c.codfor as number, nomeConsultor(c)]));
  const propostaPorCodpro = new Map(propostas.map((p) => [p.codpro, p]));

  const emExecucao = relevantes
    .map((s) => {
      const a = s.atividade;
      const chave = `${a.codemp}-${a.codpro}-${a.seqite}`;
      const proposta = propostaPorCodpro.get(a.codpro);
      return {
        atividadeConsultorId: a.id,
        codfor: a.codfor,
        consultorNome: nomePorCodfor.get(a.codfor) ?? `Fornecedor ${a.codfor}`,
        atividadeNome: escolherDescricaoPadrao(a.estruturaAtividade?.nome ?? null, desproPorChave.get(chave) ?? null) ?? `Proposta ${a.codpro}`,
        clienteNome: proposta?.cliente?.nomcli ?? null,
        inicio: s.inicio.toISOString(),
      };
    })
    // Quem está rodando há MAIS tempo aparece primeiro — é o que mais pede atenção.
    .sort((x, y) => x.inicio.localeCompare(y.inicio));

  return { depexeLabel: depexeLabel(ctx.depexe), emExecucao };
}

export const PAINEIS: PainelDef[] = [
  {
    id: "projetos-atividades-setor",
    nome: "Atividades do setor",
    descricao: "Backlog, atrasadas, em curso e concluídas no mês, mais a carga por consultor.",
    grupo: "Projetos e horas do time",
    filtros: [
      { chave: "depexe", tipo: "depexe", label: "Departamento", obrigatorio: true, multiplo: false },
      { chave: "codfor", tipo: "codfor", label: "Consultores", obrigatorio: false, multiplo: true },
    ],
    dominioSync: "projetos",
    duracaoPadraoSegundos: 30,
    carregar: carregarAtividadesSetor,
  },
  {
    id: "projetos-horas-meta",
    nome: "Horas do time no mês",
    descricao: "Realizado x meta de jornada por consultor no mês, com a evolução diária.",
    grupo: "Projetos e horas do time",
    filtros: [
      { chave: "depexe", tipo: "depexe", label: "Departamento", obrigatorio: true, multiplo: false },
      { chave: "periodo", tipo: "periodo", label: "Período", obrigatorio: true, multiplo: false },
      { chave: "codfor", tipo: "codfor", label: "Consultores", obrigatorio: false, multiplo: true },
    ],
    dominioSync: "projetos",
    duracaoPadraoSegundos: 30,
    carregar: carregarHorasMeta,
  },
  {
    id: "projetos-em-execucao",
    nome: "Em execução agora",
    descricao: "Quem está com atividade rodando neste momento e há quanto tempo.",
    grupo: "Projetos e horas do time",
    filtros: [
      { chave: "depexe", tipo: "depexe", label: "Departamento", obrigatorio: true, multiplo: false },
      { chave: "codfor", tipo: "codfor", label: "Consultores", obrigatorio: false, multiplo: true },
    ],
    // Sessão de execução nasce no CaxHub (AtividadeSessaoExecucao) — não há origem externa
    // pra sincronizar, então este painel nunca oferece o modo "erp".
    dominioSync: null,
    duracaoPadraoSegundos: 20,
    carregar: carregarEmExecucao,
  },
];

export function painelPorId(id: string): PainelDef | undefined {
  return PAINEIS.find((p) => p.id === id);
}

// Shape público (sem `carregar`) devolvido por GET /painel-tv/catalogo.
export function catalogoPublico() {
  return PAINEIS.map(({ id, nome, descricao, grupo, filtros, dominioSync, duracaoPadraoSegundos }) => ({
    id,
    nome,
    descricao,
    grupo,
    filtros,
    dominioSync,
    duracaoPadraoSegundos,
  }));
}

// Valida que toda chave em `filtros` (o Json gravado num PainelTvItem) está
// declarada no catálogo pro painel em questão — chave desconhecida nunca é
// aceita em silêncio, pra este campo nunca virar gaveta de bugigangas (mesmo
// espírito de JOBS_COM_FILTRO em sync/registry.ts).
export function validarFiltros(painelId: string, filtros: unknown): string | null {
  const def = painelPorId(painelId);
  if (!def) return `Painel desconhecido: ${painelId}`;
  if (filtros == null) return null;
  if (typeof filtros !== "object" || Array.isArray(filtros)) return "filtros deve ser um objeto";
  const chavesValidas = new Set(def.filtros.map((f) => f.chave));
  for (const chave of Object.keys(filtros)) {
    if (!chavesValidas.has(chave)) return `Filtro "${chave}" não é suportado pelo painel "${painelId}"`;
  }
  for (const f of def.filtros) {
    if (f.obrigatorio && (filtros as Record<string, unknown>)[f.chave] == null) {
      return `Filtro "${f.chave}" é obrigatório para o painel "${painelId}"`;
    }
  }
  return null;
}
