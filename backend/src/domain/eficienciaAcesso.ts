import { prisma } from "../db/prisma";
import { ContextoConsultor, codforsDoTime, resolverContextoConsultor } from "./contextoProjeto";
import { DadosEficiencia, EscopoEficiencia, carregarDados } from "./eficienciaDados";
import { SITPRO_GANHAS } from "./propostasDominio";
import { ModoEstouro, calcularProposta, indexarAlocacoes } from "./eficienciaPropostas";

// Quem está olhando o Painel de Eficiência e o que enxerga. Fica aqui (e não em routes/eficiencia.ts) porque os dois
// routers — o do painel e o do plano de ação — precisam da MESMA definição de escopo; duplicar deixaria um deles ver
// propostas ou consultores que o outro esconde.
export interface AcessoEficiencia {
  userId: number;
  role: string;
  admin: boolean;
  contexto: ContextoConsultor;
}

export async function resolverAcesso(userId: number, role: string): Promise<AcessoEficiencia> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const contexto: ContextoConsultor = user
    ? await resolverContextoConsultor(user.email)
    : { consultor: null, departamentosGerenciados: [], departamentosTime: [] };
  return { userId, role, admin: role === "admin", contexto };
}

export const ehGestor = (a: AcessoEficiencia) => a.contexto.departamentosGerenciados.length > 0;

// Recorte de propostas: admin vê tudo; gestor, as dos departamentos que gerencia (da proposta OU de algum item).
export const escopoDe = (a: AcessoEficiencia): EscopoEficiencia => ({ departamentos: a.admin ? null : a.contexto.departamentosGerenciados });

// Calcula as propostas já com o recorte de CONSULTORES do usuário (admin = todos; gestor = o time dele).
//
// `restringirA`: consultores que o filtro de departamento da tela deixa à mostra (o time dos departamentos escolhidos).
// Funciona como o time do líder: quem não está no recorte não aparece com nome (vira "outros") e não entra nas tabelas de
// equipe, carga, mapa nem nos alertas de capacidade. Cruza com o recorte de acesso: o gestor nunca passa do time dele.
//
// `ignorarConsultores`: consultores que a pessoa marcou pra ficar fora dos indicadores da equipe. Mesmo efeito de sair do recorte
// (viram "outros"), mas só nas contas de equipe: vendido, executado e estouro das propostas não mudam.
export async function calcular(
  dados: DadosEficiencia,
  acesso: AcessoEficiencia,
  restringirA: Set<number> | null = null,
  ignorarConsultores: Set<number> | null = null,
  modo: ModoEstouro = "item"
) {
  const doAcesso = await codforsDoTime(acesso.admin ? "admin" : "gestor", acesso.contexto);
  const visiveis = restringirA == null ? doAcesso : doAcesso == null ? restringirA : new Set([...restringirA].filter((c) => doAcesso.has(c)));
  const indice = indexarAlocacoes(dados.alocacoes);
  const propostas = dados.propostas.map((p) => calcularProposta(p, indice, visiveis, ignorarConsultores, modo));
  return { propostas, visiveis };
}

// A proposta (com o item) só existe pra quem a enxerga: fora do escopo do gestor é 404, nunca 403 que confirmaria que existe.
// Usa as situações "ganhas" (4, 7 e 8), e não só as ativas: uma exclusão feita enquanto a proposta estava em execução
// continua restaurável depois que ela vira Executada.
export async function carregarPropostaNoEscopo(codemp: number, codpro: number, acesso: AcessoEficiencia) {
  const dados = await carregarDados({ tipo: "all", sitpro: [...SITPRO_GANHAS], modpro: null, codcli: null, depexe: null, proposta: { codemp, codpro } }, escopoDe(acesso));
  const { propostas, visiveis } = await calcular(dados, acesso);
  const p = propostas[0];
  return p ? { dados, p, visiveis } : null;
}
