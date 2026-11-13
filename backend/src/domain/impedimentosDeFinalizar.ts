import { prisma } from "../db/prisma";
import { SITRAT_BLOQUEIA_FINALIZAR } from "./gestaoPropostasSql";

// O que impede FINALIZAR uma proposta (Gestão Propostas, 10/11/2026), num lugar só: o clique em Finalizar (routes/gestaoPropostas.ts) e a reconferência
// no ENVIO ao Senior (sync/outboxSeniorProposta.ts, a pendência pode esperar) usam esta mesma regra, e as duas mostram a mesma mensagem.
//
// Três causas, todas sobre trabalho que ainda não está fechado:
//  1. RAT Digitada ou Fechada (SITRAT_BLOQUEIA_FINALIZAR), ainda existente no Senior.
//  2. Sessão de execução EM CURSO: um consultor está com o cronômetro aberto numa atividade da proposta (`fim` nulo).
//  3. Sessão PENDENTE DE RAT: a sessão já foi encerrada mas o consultor ainda não a confirmou em Meus Apontamentos (`fim` preenchido e `confirmada` falso),
//     então a hora trabalhada ainda não virou item de RAT. É a mesma fila "a confirmar" de GET /apontamentos/sessoes-pendentes (atividade ativa, sessão não excluída).

export interface RatQueImpede {
  id: number;
  numrat: number | null;
  sitrat: number | null;
}

export interface SessaoQueImpede {
  id: number;
  atividadeId: number;
  codfor: number;
  consultor: string;
  inicio: Date;
  fim: Date | null;
}

export interface ImpedimentosDeFinalizar {
  rats: RatQueImpede[];
  sessoesEmCurso: SessaoQueImpede[];
  sessoesPendentes: SessaoQueImpede[];
}

const LIMITE_NOMES = 5;
const LIMITE_RATS = 10;

/** "Ana, Bruno e mais 2": os primeiros nomes distintos (por ordem de aparição) e quantos ficaram de fora. */
export function resumoDeNomes(nomes: string[], limite = LIMITE_NOMES): string {
  const distintos = [...new Set(nomes)];
  if (distintos.length <= limite) return distintos.join(", ");
  return `${distintos.slice(0, limite).join(", ")} e mais ${distintos.length - limite}`;
}

export function haImpedimentos(i: ImpedimentosDeFinalizar): boolean {
  return i.rats.length > 0 || i.sessoesEmCurso.length > 0 || i.sessoesPendentes.length > 0;
}

/**
 * A mensagem que a tela mostra (e que a pendência guarda quando o envio é barrado): uma linha por causa, com quem/quais, e o que fazer. null = nada impede.
 * Pura, com teste.
 */
export function mensagemDosImpedimentos(i: ImpedimentosDeFinalizar): string | null {
  if (!haImpedimentos(i)) return null;
  const linhas: string[] = [];
  if (i.rats.length > 0) {
    const numeros = i.rats.slice(0, LIMITE_RATS).map((r) => (r.numrat != null ? String(r.numrat) : `local ${r.id}`));
    const mais = i.rats.length > LIMITE_RATS ? ", ..." : "";
    linhas.push(`• ${i.rats.length > LIMITE_RATS ? "Mais de " + LIMITE_RATS : i.rats.length} RAT(s) em situação Digitada ou Fechada (RAT ${numeros.join(", ")}${mais})`);
  }
  if (i.sessoesEmCurso.length > 0) {
    linhas.push(`• ${i.sessoesEmCurso.length} sessão(ões) em curso, com o cronômetro aberto (${resumoDeNomes(i.sessoesEmCurso.map((s) => s.consultor))})`);
  }
  if (i.sessoesPendentes.length > 0) {
    linhas.push(
      `• ${i.sessoesPendentes.length} sessão(ões) encerrada(s) e ainda pendente(s) de confirmação em RAT (${resumoDeNomes(i.sessoesPendentes.map((s) => s.consultor))})`,
    );
  }
  const acao = [
    i.rats.length > 0 ? "feche/resolva as RATs" : null,
    i.sessoesEmCurso.length > 0 ? "encerre as sessões em curso" : null,
    i.sessoesPendentes.length > 0 ? "confirme as sessões pendentes em Meus Apontamentos" : null,
  ].filter(Boolean);
  return `Não é possível finalizar a proposta:\n${linhas.join("\n")}\nPara finalizar, ${acao.join("; ")} e tente de novo.`;
}

/**
 * Lê no banco o que impede finalizar a proposta. `removidoEmSenior != null` NÃO bloqueia: a RAT não existe mais no Senior (o sitrat fica congelado em 9)
 * e nem dá para fechá-la, então bloquear criaria um impasse sem saída pela tela; sitrat 0 (fora do domínio) também não bloqueia (não é 9 nem 1). Rascunho do
 * CaxHub (sem numrat) BLOQUEIA: é apontamento que ainda não foi ao Senior.
 */
export async function buscarImpedimentosDeFinalizar(codemp: number, codpro: number): Promise<ImpedimentosDeFinalizar> {
  const [rats, sessoes] = await Promise.all([
    prisma.rat.findMany({
      where: { codemp, codpro, removidoEmSenior: null, sitrat: { in: [...SITRAT_BLOQUEIA_FINALIZAR] } },
      select: { id: true, numrat: true, sitrat: true },
      orderBy: [{ sitrat: "asc" }, { numrat: "asc" }],
      take: LIMITE_RATS + 1,
    }),
    prisma.atividadeSessaoExecucao.findMany({
      where: { excluidaEm: null, confirmada: false, atividade: { codemp, codpro, sitreg: "A" } },
      select: { id: true, inicio: true, fim: true, atividade: { select: { id: true, codfor: true } } },
      orderBy: { inicio: "asc" },
      take: 500,
    }),
  ]);

  const codfors = [...new Set(sessoes.map((s) => s.atividade.codfor))];
  const consultores =
    codfors.length > 0 ? await prisma.consultor.findMany({ where: { codfor: { in: codfors } }, select: { codfor: true, nomcom: true, nomfor: true } }) : [];
  const nomePorCodfor = new Map<number, string>();
  for (const c of consultores) if (c.codfor != null && !nomePorCodfor.has(c.codfor)) nomePorCodfor.set(c.codfor, (c.nomcom?.trim() || c.nomfor?.trim() || `Fornecedor ${c.codfor}`));

  const lista: SessaoQueImpede[] = sessoes.map((s) => ({
    id: s.id,
    atividadeId: s.atividade.id,
    codfor: s.atividade.codfor,
    consultor: nomePorCodfor.get(s.atividade.codfor) ?? `Fornecedor ${s.atividade.codfor}`,
    inicio: s.inicio,
    fim: s.fim,
  }));
  return {
    rats,
    sessoesEmCurso: lista.filter((s) => s.fim == null),
    sessoesPendentes: lista.filter((s) => s.fim != null),
  };
}
