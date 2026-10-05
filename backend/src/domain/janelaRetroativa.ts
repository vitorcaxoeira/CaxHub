import { prisma } from "../db/prisma";
import { diaBrasilComoData } from "./fusoBrasil";

// Janela de retroatividade dos PEDIDOS de apontamento avulso e de ajuste de horário.
//
// Ordem da Diretoria (05/10/2026): o consultor só pede para o dia corrente. A exceção é por
// consultor (ConfiguracaoApontamentoConsultor.diasRetroativos), mantida pelo admin ou pelo líder do
// departamento dele. Sem linha = 0 dias = só hoje.
//
// Só barra a CRIAÇÃO do pedido. Aprovar/reprovar, o lançamento manual do gestor e as sessões do
// quadro não passam por aqui. "Hoje" é o dia de parede de São Paulo, nunca o relógio do servidor
// (produção roda em UTC) — ver domain/fusoBrasil.ts.

export const MAX_DIAS_RETROATIVOS = 30;

export async function diasRetroativosDoConsultor(codemp: number, codfor: number): Promise<number> {
  const config = await prisma.configuracaoApontamentoConsultor.findUnique({ where: { codemp_codfor: { codemp, codfor } } });
  return config?.diasRetroativos ?? 0;
}

// Dia mais antigo (meia-noite UTC, o formato de @db.Date) em que ainda se pode pedir. Volta
// `diasUteis` dias úteis (seg–sex, sem feriado — mesma noção de dia útil do painel do consultor)
// a partir de hoje: com 1 dia, na segunda ainda se pede para sexta; com 0, só hoje (mesmo num
// sábado, o dia corrente é sempre permitido).
export function primeiroDiaPermitido(hoje: Date, diasUteis: number): Date {
  const dia = diaBrasilComoData(hoje);
  let restantes = diasUteis;
  while (restantes > 0) {
    dia.setUTCDate(dia.getUTCDate() - 1);
    const diaSemana = dia.getUTCDay();
    if (diaSemana !== 0 && diaSemana !== 6) restantes -= 1;
  }
  return dia;
}

const isoDia = (d: Date) => d.toISOString().slice(0, 10);
const brDia = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export interface JanelaRetroativa {
  diasRetroativos: number;
  primeiroDiaPermitido: string; // AAAA-MM-DD
}

export async function janelaDoConsultor(codemp: number, codfor: number, agora: Date = new Date()): Promise<JanelaRetroativa> {
  const diasRetroativos = await diasRetroativosDoConsultor(codemp, codfor);
  return { diasRetroativos, primeiroDiaPermitido: isoDia(primeiroDiaPermitido(agora, diasRetroativos)) };
}

// Mesmo formato de retorno de recusarSeEstourarTeto: `{ status, body }` pra devolver direto no
// handler, ou null quando todas as datas estão dentro da janela. O ajuste confere DUAS datas (a do
// apontamento original e a nova), o que fecha o atalho de "ajustar" uma sessão antiga pra hoje.
export async function recusarSeForaDaJanela(
  codemp: number,
  codfor: number,
  datas: Date[],
  agora: Date = new Date()
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const janela = await janelaDoConsultor(codemp, codfor, agora);
  const minimo = new Date(`${janela.primeiroDiaPermitido}T00:00:00.000Z`);
  if (datas.every((d) => diaBrasilComoData(d).getTime() >= minimo.getTime())) return null;

  const quando =
    janela.diasRetroativos === 0
      ? `para o dia de hoje (${brDia(minimo)})`
      : `a partir de ${brDia(minimo)} (${janela.diasRetroativos} ${janela.diasRetroativos === 1 ? "dia útil" : "dias úteis"} para trás)`;
  return {
    status: 409,
    body: {
      error: `Só é possível solicitar apontamento ou ajuste ${quando}.`,
      diasRetroativos: janela.diasRetroativos,
      primeiroDiaPermitido: janela.primeiroDiaPermitido,
    },
  };
}
