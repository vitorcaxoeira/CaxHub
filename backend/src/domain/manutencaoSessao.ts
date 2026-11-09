// Regras puras da manutenção de uma sessão já confirmada (PATCH /apontamentos/:id/sessao, só admin).
// Ficam à parte do router para serem testáveis sem Prisma nem rede.

import { paraHoraBrasil } from "./fusoBrasil";

export const MENSAGEM_DURACAO_ABAIXO_DE_UM_MINUTO =
  "Sessão dura menos de 1 minuto — o Senior só registra por minuto cheio. Ajuste o horário antes de confirmar.";

export type HorariosSenior = { ok: true; horini: number; horfim: number } | { ok: false; erro: string };

// RatItem.horini/horfim são minutos desde a meia-noite em hora de parede brasileira. Validar `fim > inicio`
// em milissegundos não basta: dois instantes de segundos de diferença truncam para o MESMO minuto e o item
// nasce com duração zero, que o Senior não distingue de outro "zero" vizinho (caso real, RatItem 2336686 x
// 2336685, 18/08/2026). Por isso a guarda é na granularidade que vai ao ERP.
export function horariosDoSenior(inicio: Date, fim: Date): HorariosSenior {
  const horini = paraHoraBrasil(inicio).minutosDoDia;
  const horfim = paraHoraBrasil(fim).minutosDoDia;
  if (horfim <= horini) return { ok: false, erro: MENSAGEM_DURACAO_ABAIXO_DE_UM_MINUTO };
  return { ok: true, horini, horfim };
}

export interface CamposApontamento {
  datati: Date | null;
  horini: number | null;
  horfim: number | null;
  desati: string | null;
}

const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const texto = (s: string | null) => (s ?? "").trim();

// Quais dos 4 campos que viajam no `registrarAtividades` (datAti, horIni, horFim, desAti) mudaram.
// Vazio = nada a equalizar no Senior, então nenhuma pendência é criada.
export function camposQueMudaram(antes: CamposApontamento, depois: CamposApontamento): string[] {
  const mudou: string[] = [];
  if (dia(antes.datati) !== dia(depois.datati)) mudou.push("datati");
  if (antes.horini !== depois.horini) mudou.push("horini");
  if (antes.horfim !== depois.horfim) mudou.push("horfim");
  if (texto(antes.desati) !== texto(depois.desati)) mudou.push("desati");
  return mudou;
}

// Quem pode manter a sessão e quando. Uma função só, usada pelo PATCH (que impõe) e por GET /rats/:id/itens (que
// informa a tela), para a tela nunca oferecer o que o servidor recusa. `null` = pode.
export function motivoBloqueioManutencao(ctx: {
  souAdmin: boolean;
  temRatItem: boolean;
  removidaNoSenior: boolean;
  sitrat: number | null;
}): string | null {
  if (!ctx.souAdmin) return "Somente o administrador pode alterar os dados da sessão.";
  if (!ctx.temRatItem) return "Esta sessão ainda não foi confirmada — ela não faz parte de nenhuma RAT.";
  if (ctx.removidaNoSenior) return "A RAT deste apontamento foi excluída no Senior — não é possível alterar.";
  if (ctx.sitrat !== 9) return "Só é possível alterar a sessão enquanto a RAT está com a situação Digitado.";
  return null;
}
