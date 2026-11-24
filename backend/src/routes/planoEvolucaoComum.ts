import { NextFunction, Response } from "express";
import { Prisma, PlanoCiclo, PlanoCicloIndicador } from "@prisma/client";
import { AuthenticatedRequest } from "../auth/middleware";
import { criarEventoAuditoria, diffCampos } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EventoAuditoriaTipo } from "../audit/taxonomia";
import { entidadeIdPlanoApuracao, entidadeIdPlanoCiclo, entidadeIdPlanoParticipante } from "../audit/identidadeEntidade";
import { AcessoEficiencia, ehGestor, resolverAcesso } from "../domain/eficienciaAcesso";
import { DEPEXES_PLANO_EVOLUCAO, depexeLabel } from "../domain/propostasDominio";
import { INDICADORES } from "../domain/planoEvolucao/eficienciaIndividual";
import { ParametrosDaPrevia } from "../domain/planoEvolucao/previa";
import { pendenciasDePublicacao } from "../domain/planoEvolucao/validacao";

// Pedaços compartilhados pelos routers do Plano de Evolução (ciclos/participantes em planoEvolucao.ts e apuração em
// planoEvolucaoApuracao.ts): guardas de acesso, utilitários de data, auditoria e o DTO do ciclo. Fica à parte para os dois routers
// se importarem sem círculo.

export function handleError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[plano-evolucao:${label}]`, message);
  res.status(500).json({ error: message });
}

export const acessoDe = (res: Response) => res.locals.acesso as AcessoEficiencia;

// Resolve o acesso uma vez por requisição (as guardas abaixo e os handlers leem de res.locals).
// No Plano, quem gerencia a Consultoria ERP ou HCM (DEPEXES_PLANO_EVOLUCAO) é ADMINISTRADOR DO PLANO, com os mesmos poderes do admin
// (pedido do Vitor, 20/10/2026): ciclos, participantes e apuração de qualquer consultor da área, valores em R$, índice global, contestação
// procedente e CSV. Decidido AQUI, num ponto só: toda guarda e todo recorte do Plano que olham `acesso.admin` passam a valer para eles.
// Gestor de outro departamento não entra (exigirAdminOuGestor). O consultor (/meu, a própria memória) não depende disto: usa
// contexto.consultor. Fora do Plano (ex.: auditoria) o `admin` continua sendo só o papel admin.
export async function carregarAcesso(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const acesso = await resolverAcesso(req.user!.userId, req.user!.role);
    acesso.contexto = {
      ...acesso.contexto,
      departamentosGerenciados: acesso.contexto.departamentosGerenciados.filter((d) => DEPEXES_PLANO_EVOLUCAO.includes(d)),
    };
    if (acesso.contexto.departamentosGerenciados.length > 0) acesso.admin = true;
    res.locals.acesso = acesso;
    next();
  } catch (error) {
    handleError(res, error, "acesso");
  }
}

export function exigirAdmin(_req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!acessoDe(res).admin) {
    res.status(403).json({ error: "Somente o administrador e os gestores da Consultoria ERP e HCM podem fazer isto" });
    return;
  }
  next();
}

export function exigirAdminOuGestor(_req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const a = acessoDe(res);
  if (!a.admin && !ehGestor(a)) {
    res.status(403).json({ error: "Só o administrador e os gestores da Consultoria ERP e da Consultoria HCM acessam o Plano de Evolução PJ" });
    return;
  }
  next();
}

// ---------------------------------------------------------------- utilitários

export const isoDaData = (d: Date) => d.toISOString().slice(0, 10);
export const dataDeIso = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const numOuNulo = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));
export const idDoParametro = (v: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
export const rotuloCiclo = (c: Pick<PlanoCiclo, "ano" | "semestre">) => `${c.semestre}º semestre de ${c.ano}`;

export type CicloComIndicadores = PlanoCiclo & { indicadores: PlanoCicloIndicador[] };

export function auditar(
  tx: Prisma.TransactionClient,
  req: AuthenticatedRequest,
  alvo: { tipo: "ciclo" | "participante" | "apuracao"; id: number; rotulo: string },
  eventoTipo: EventoAuditoriaTipo,
  extra: { alteracoes?: ReturnType<typeof diffCampos>["alteracoes"]; metadata?: Record<string, unknown> } = {}
) {
  return criarEventoAuditoria(
    {
      origem: "tela",
      usuarioId: req.user!.userId,
      entidadeTipo: alvo.tipo === "ciclo" ? ENTIDADES_AUDITORIA.PLANO_CICLO : alvo.tipo === "participante" ? ENTIDADES_AUDITORIA.PLANO_PARTICIPANTE : ENTIDADES_AUDITORIA.PLANO_APURACAO,
      entidadeId: alvo.tipo === "ciclo" ? entidadeIdPlanoCiclo(alvo.id) : alvo.tipo === "participante" ? entidadeIdPlanoParticipante(alvo.id) : entidadeIdPlanoApuracao(alvo.id),
      entidadeRotulo: alvo.rotulo,
      eventoTipo,
      alteracoes: extra.alteracoes ?? null,
      metadata: extra.metadata ?? null,
      correlationId: req.correlationId!,
    },
    tx
  );
}


export function cicloDto(c: CicloComIndicadores) {
  const indicadores = [...c.indicadores]
    .sort((a, b) => a.ordem - b.ordem)
    .map((i) => {
      const def = INDICADORES.find((x) => x.chave === i.chave);
      return {
        chave: i.chave,
        rotulo: def?.rotulo ?? i.chave,
        descricao: def?.descricao ?? "",
        tipo: i.tipo as "automatico" | "manual",
        peso: i.peso,
        meta: numOuNulo(i.meta),
        ativo: i.ativo,
        ordem: i.ordem,
      };
    });
  return {
    id: c.id,
    ano: c.ano,
    semestre: c.semestre,
    rotulo: rotuloCiclo(c),
    inicio: isoDaData(c.inicio),
    fim: isoDaData(c.fim),
    status: c.status as "rascunho" | "publicado" | "encerrado",
    editavel: c.status === "rascunho",
    metaEficienciaGlobal: numOuNulo(c.metaEficienciaGlobal),
    departamentosArea: c.departamentosArea,
    departamentosAreaRotulos: c.departamentosArea.map((d) => depexeLabel(d)),
    amostraMinimaHoras: c.amostraMinimaHoras,
    definicaoOnline: c.definicaoOnline as "A" | "B",
    notaMinimaEficienciaIndividual: c.notaMinimaEficienciaIndividual,
    naoApuradoQuebraSequencia: c.naoApuradoQuebraSequencia,
    certificacoesExigidas: c.certificacoesExigidas,
    atividadesElegiveisClientes: c.atividadesElegiveisClientes,
    corteEvidencias: isoDaData(c.corteEvidencias),
    apuracaoAte: isoDaData(c.apuracaoAte),
    devolutivaEm: isoDaData(c.devolutivaEm),
    contestacaoAte: isoDaData(c.contestacaoAte),
    publicadoEm: c.publicadoEm,
    indicadores,
    pendenciasPublicacao:
      c.status === "rascunho"
        ? pendenciasDePublicacao({ metaEficienciaGlobal: numOuNulo(c.metaEficienciaGlobal), departamentosArea: c.departamentosArea, indicadores })
        : [],
  };
}

export const parametrosDaPrevia = (c: CicloComIndicadores): ParametrosDaPrevia => ({
  metaEficienciaGlobal: numOuNulo(c.metaEficienciaGlobal),
  amostraMinimaHoras: c.amostraMinimaHoras,
  definicaoOnline: c.definicaoOnline as "A" | "B",
  notaMinimaEficienciaIndividual: c.notaMinimaEficienciaIndividual,
  naoApuradoQuebraSequencia: c.naoApuradoQuebraSequencia,
  indicadores: c.indicadores.map((i) => ({ chave: i.chave, tipo: i.tipo as "automatico" | "manual", peso: i.peso, meta: numOuNulo(i.meta), ativo: i.ativo })),
});

