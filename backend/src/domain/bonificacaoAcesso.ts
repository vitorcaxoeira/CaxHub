import { escopoDoUsuario, escopoSql, podeAdministrarDescontos, podeVerConsultor, type EscopoDescontos } from "./descontosAcesso";

// Quem pode o quê na Gestão de Bonificação (25/11/2026, decisão do Vitor: "igual a Descontos"):
//   - admin e administrativo ADMINISTRAM: processos, regras, enquadramentos, apuração, fechamento; veem todos os consultores e fechamentos abertos;
//   - gestor de área (gerencia um departamento) só VISUALIZA os consultores do seu time;
//   - consultor vê só a própria bonificação.
// Gestor e consultor só enxergam fechamentos FECHADOS (o que está aberto ainda pode mudar). O escopo por consultor é o mesmo de Descontos
// (domain/descontosAcesso.ts): o tipo e as funções são reaproveitados, não duplicados.

export type EscopoBonificacao = EscopoDescontos;
export { escopoDoUsuario, escopoSql, podeVerConsultor };

export const podeAdministrarBonificacao = podeAdministrarDescontos;
