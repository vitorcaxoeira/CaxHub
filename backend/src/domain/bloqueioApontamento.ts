import { prisma } from "../db/prisma";

// Resolve o bloqueio de apontamento/excedente de uma proposta+atividade — "mais restritivo
// vence" entre PropostaModoAlocacao (nível proposta) e AtividadeConsultor (nível alocação).
// Ver comentários dos campos em schema.prisma (PropostaModoAlocacao.bloqueiaApontamento/
// bloqueiaExcedente, AtividadeConsultor.bloqueiaApontamento/bloqueiaExcedente) e o plano
// "Bloqueios no Cronograma" (02/09/2026).
//
// Canal deliberadamente separado de PropostaModoAlocacao.bloqueiaExcedenteEstrutura (que só
// trava EDITAR a duração planejada da EAP acima do saldo do item) — este arquivo trata de
// apontar horas de verdade e de autorizar/solicitar AtividadeConsultor.horasExcedentes.

export interface ConfigBloqueioProposta {
  bloqueiaApontamento: boolean;
  bloqueiaExcedente: boolean;
}

// Sem linha em PropostaModoAlocacao (proposta que nunca passou pela tela de Alocação) =
// os defaults do schema — mesma resolução "sem linha = default" já usada por
// propostaBloqueiaExcedenteEstrutura em routes/alocacao.ts.
export async function configBloqueioProposta(codemp: number, codpro: number): Promise<ConfigBloqueioProposta> {
  const config = await prisma.propostaModoAlocacao.findUnique({ where: { codemp_codpro: { codemp, codpro } } });
  return {
    bloqueiaApontamento: config?.bloqueiaApontamento ?? false,
    bloqueiaExcedente: config?.bloqueiaExcedente ?? true,
  };
}

// Busca a config de várias propostas de uma vez (pares codemp/codpro distintos) — pra rotas
// que resolvem muitas atividades de uma vez (GET /cronograma, carregarAtividadesVisiveisImpl,
// sessões pendentes, listagens de Aprovações) nunca fazerem 1 query por linha. Chave do Map:
// `${codemp}-${codpro}`.
export async function configBloqueioPropostasEmLote(
  pares: { codemp: number; codpro: number }[]
): Promise<Map<string, ConfigBloqueioProposta>> {
  const chave = (codemp: number, codpro: number) => `${codemp}-${codpro}`;
  const unicos = new Map<string, { codemp: number; codpro: number }>();
  for (const p of pares) unicos.set(chave(p.codemp, p.codpro), p);

  const configs = await prisma.propostaModoAlocacao.findMany({
    where: { OR: Array.from(unicos.values()).map(({ codemp, codpro }) => ({ codemp, codpro })) },
  });
  const porChave = new Map<string, ConfigBloqueioProposta>();
  for (const c of configs) {
    porChave.set(chave(c.codemp, c.codpro), { bloqueiaApontamento: c.bloqueiaApontamento, bloqueiaExcedente: c.bloqueiaExcedente });
  }

  // Preenche default pra quem não tem linha nenhuma, senão resolverBloqueioApontamentoComConfig
  // teria que saber lidar com "ausente" em vez de só ler o Map.
  const resultado = new Map<string, ConfigBloqueioProposta>();
  for (const { codemp, codpro } of unicos.values()) {
    const k = chave(codemp, codpro);
    resultado.set(k, porChave.get(k) ?? { bloqueiaApontamento: false, bloqueiaExcedente: true });
  }
  return resultado;
}

export interface ResolucaoBloqueio {
  bloqueadoApontamento: boolean;
  origemBloqueioApontamento: "proposta" | "atividade" | null;
  bloqueadoExcedente: boolean;
  origemBloqueioExcedente: "proposta" | "atividade" | null;
}

interface AtividadeParaResolverBloqueio {
  bloqueiaApontamento: boolean;
  bloqueiaExcedente: boolean;
}

// Combina a config da proposta (já resolvida) com os campos da alocação — usar isto (não
// resolverBloqueioApontamento) quando a config da proposta já foi buscada em lote.
export function resolverBloqueioComConfig(
  cfg: ConfigBloqueioProposta,
  atividade: AtividadeParaResolverBloqueio
): ResolucaoBloqueio {
  return {
    bloqueadoApontamento: cfg.bloqueiaApontamento || atividade.bloqueiaApontamento,
    origemBloqueioApontamento: cfg.bloqueiaApontamento ? "proposta" : atividade.bloqueiaApontamento ? "atividade" : null,
    bloqueadoExcedente: cfg.bloqueiaExcedente || atividade.bloqueiaExcedente,
    origemBloqueioExcedente: cfg.bloqueiaExcedente ? "proposta" : atividade.bloqueiaExcedente ? "atividade" : null,
  };
}

// "Mais restritivo vence": proposta OU atividade bloqueando já bloqueia. Uso pontual (1
// atividade por vez) — pra listas grandes, prefira configBloqueioPropostasEmLote +
// resolverBloqueioComConfig pra não fazer 1 query por linha.
export async function resolverBloqueioApontamento(
  atividade: { codemp: number; codpro: number } & AtividadeParaResolverBloqueio
): Promise<ResolucaoBloqueio> {
  const cfg = await configBloqueioProposta(atividade.codemp, atividade.codpro);
  return resolverBloqueioComConfig(cfg, atividade);
}
