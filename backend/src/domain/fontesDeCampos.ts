import type { FonteCampos } from "../consultas/camposRelacionados";

// "Mais campos (tabela e relacionadas)" nas listas do CaxHub (24/11/2026, pedido do Vitor: levar o piloto da Gestão de Propostas para todas as telas de
// lista). Cada lista declara aqui as tabelas que a SUA consulta já tem em mãos, com o ALIAS que a consulta usa (consultas/camposRelacionados.ts). Os campos
// de cada tabela saem do schema Prisma; só os pedidos entram no SELECT. Tabela unida por LEFT JOIN é `opcional`. Regras:
//   - só entra tabela com UMA linha inteira na consulta; subconsulta/LATERAL que traz poucas colunas (ex.: consultor) fica de fora;
//   - dado sensível sai por `omitir` (ex.: `sencli`, a senha do cliente no Senior);
//   - o alias tem de bater com o da consulta: um teste (fontesDeCampos.test.ts) confere que cada tabela existe no schema.

const CLIENTE: Omit<FonteCampos, "alias"> = { id: "cliente", titulo: "Cliente", tabela: "clientes", omitir: ["sencli"] };

// Contábil › Resultado Analítico: lançamentos de uma célula da Matriz (routes/contabil.ts "/resultado/lancamentos").
export const FONTES_LANCAMENTOS_RESULTADO: FonteCampos[] = [
  { id: "rateio", titulo: "Rateio do lançamento", tabela: "rateios_lancamento", alias: "r" },
  { id: "conta", titulo: "Conta contábil", tabela: "plano_contabil", alias: "pc" },
  { id: "lancamento", titulo: "Lançamento contábil", tabela: "lancamentos_contabeis", alias: "l", opcional: true },
  { id: "centrocusto", titulo: "Centro de custo", tabela: "centros_custo", alias: "cc", opcional: true },
];

// Contábil › Orçado x Realizado: linhas do orçamento de uma célula Orçado ("/orcado-realizado/orcamentos").
export const FONTES_ORCAMENTO_CONTABIL: FonteCampos[] = [
  { id: "orcamento", titulo: "Orçamento contábil", tabela: "orcamentos_contabeis", alias: "o" },
  { id: "conta", titulo: "Conta contábil", tabela: "plano_contabil", alias: "pc" },
  { id: "filial", titulo: "Filial", tabela: "filial", alias: "f", opcional: true },
  { id: "centrocusto", titulo: "Centro de custo", tabela: "centros_custo", alias: "cc", opcional: true },
  { id: "naturezafinanceira", titulo: "Natureza financeira", tabela: "naturezas_financeiras", alias: "nf", opcional: true },
];

// Gestão de Descontos (routes/descontos.ts).
export const FONTES_DESCONTOS_PROCESSOS: FonteCampos[] = [
  { id: "processo", titulo: "Processo de desconto", tabela: "descontos_processos", alias: "p" },
  { id: "tipo", titulo: "Tipo de desconto", tabela: "descontos_tipos", alias: "t" },
];
export const FONTES_DESCONTOS_PARCELAS: FonteCampos[] = [
  { id: "parcela", titulo: "Parcela", tabela: "descontos_parcelas", alias: "dp" },
  { id: "processo", titulo: "Processo de desconto", tabela: "descontos_processos", alias: "p" },
  { id: "tipo", titulo: "Tipo de desconto", tabela: "descontos_tipos", alias: "t" },
];
export const FONTES_DESCONTOS_FECHAMENTOS: FonteCampos[] = [{ id: "fechamento", titulo: "Fechamento", tabela: "descontos_fechamentos", alias: "f" }];

// Gestão de Bonificação (routes/bonificacao.ts).
export const FONTES_BONIFICACAO_FECHAMENTOS: FonteCampos[] = [
  { id: "fechamento", titulo: "Fechamento", tabela: "bonificacao_fechamentos", alias: "f" },
  { id: "processo", titulo: "Processo de bonificação", tabela: "bonificacao_processos", alias: "p" },
];
export const FONTES_BONIFICACAO_RESULTADOS: FonteCampos[] = [
  { id: "resultado", titulo: "Resultado do indicador", tabela: "bonificacao_resultados", alias: "r" },
  { id: "fechamento", titulo: "Fechamento", tabela: "bonificacao_fechamentos", alias: "f" },
  { id: "processo", titulo: "Processo de bonificação", tabela: "bonificacao_processos", alias: "p" },
  { id: "indicador", titulo: "Indicador", tabela: "bonificacao_indicadores", alias: "i" },
];

// Financeiro (routes/financeiro.ts, fluxoCaixa.ts, inadimplencia.ts, recebimentos.ts).
export const FONTES_TITULOS_RECEBER: FonteCampos[] = [
  { id: "titulo", titulo: "Título a receber", tabela: "titulos_receber", alias: "t" },
  { ...CLIENTE, alias: "c" },
  { id: "tipotitulo", titulo: "Tipo de título", tabela: "tipos_titulo", alias: "tt" },
  { id: "empresa", titulo: "Empresa", tabela: "empresa", alias: "e" },
  { id: "filial", titulo: "Filial", tabela: "filial", alias: "f" },
];
// Operacional (fluxo de caixa): as duas variantes da consulta têm o título (t) e o cliente (c).
export const FONTES_OPERACIONAL_TITULOS: FonteCampos[] = [
  { id: "titulo", titulo: "Título a receber", tabela: "titulos_receber", alias: "t" },
  { ...CLIENTE, alias: "c" },
];
export const FONTES_INADIMPLENCIA: FonteCampos[] = FONTES_OPERACIONAL_TITULOS;
export const FONTES_RECEBIMENTOS: FonteCampos[] = [
  { id: "movimento", titulo: "Movimento de recebimento", tabela: "movimentos_receber", alias: "m" },
  { id: "titulo", titulo: "Título a receber", tabela: "titulos_receber", alias: "t" },
  { ...CLIENTE, alias: "c" },
  { id: "transacao", titulo: "Transação", tabela: "transacoes", alias: "tr" },
  { id: "portador", titulo: "Portador", tabela: "portadores", alias: "p", opcional: true },
  { id: "contacorrente", titulo: "Conta corrente", tabela: "contas_correntes", alias: "cc", opcional: true },
];

// Mercado › Pedidos (routes/pedidos.ts). A RAT (LATERAL) e o consultor trazem poucas colunas: ficam de fora.
export const FONTES_PEDIDOS: FonteCampos[] = [
  { id: "pedido", titulo: "Pedido", tabela: "pedidos", alias: "p" },
  { ...CLIENTE, alias: "c", opcional: true },
  { id: "proposta", titulo: "Proposta", tabela: "propostas", alias: "pr", opcional: true },
  { id: "formapagamento", titulo: "Forma de pagamento", tabela: "formas_pagamento", alias: "fp", opcional: true },
  { id: "condicaopagamento", titulo: "Condição de pagamento", tabela: "condicoes_pagamento", alias: "cp", opcional: true },
];

// Projetos › Propostas (routes/projetos.ts "/propostas"): mesmas fontes do piloto da Gestão de Propostas.
export const FONTES_PROPOSTAS_PROJETOS: FonteCampos[] = [
  { id: "proposta", titulo: "Proposta", tabela: "propostas", alias: "p" },
  { ...CLIENTE, alias: "c" },
];

// RATs: Meus Apontamentos (routes/rats.ts "/lista") e RATs da proposta na Gestão de Propostas (mesma consulta, domain/ratsListaSql.ts).
// O consultor (CTE `cons`) e o cliente (subconsulta) trazem poucas colunas: ficam de fora.
export const FONTES_RATS: FonteCampos[] = [{ id: "rat", titulo: "RAT", tabela: "rats", alias: "r" }];
