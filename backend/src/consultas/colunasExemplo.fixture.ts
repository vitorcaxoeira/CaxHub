// Colunas de exemplo usadas SÓ pelo teste de consultaColunas: cópia das declarações de três telas do Plannix do CaxHub_Dash (lá em
// plannix/colunasTelas.ts), onde o teste nasceu. Não são usadas por nenhuma rota daqui.
import { Prisma } from "@prisma/client";
import type { ColunaConsulta } from "./consultaColunas";

/** Etapa base do status (alguns estados trazem complemento de qualidade, ex.: "CONCRETAGEM - Pendente"). */
export const ETAPA_SQL = Prisma.sql`upper(trim(split_part(coalesce(s.status, 'SEM STATUS'), ' - ', 1)))`;

const ORIGENS = [
  { valor: "concreto", rotulo: "Concreto (traço)" },
  { valor: "aco", rotulo: "Aço da peça" },
  { valor: "complemento", rotulo: "Complemento" },
  { valor: "aco_complemento", rotulo: "Aço de complemento" },
  { valor: "outro", rotulo: "Outro" },
  // Origem virtual: produtos das famílias de aço com entrada/saída manual e sem consumo no Plannix (linhasSemConsumoPlannix, routes/plannix.ts).
  { valor: "sem_consumo_plannix", rotulo: "Sem consumo Plannix" },
];

/**
 * Obras: `o` = plannix_obras; `p` e `r` = os resumos por obra (LATERAL de peças e de revisões). As colunas com resumo são `agregada`: a
 * rota só as usa no WHERE/ORDER BY quando calcula o resumo de todas as obras (ver usaAgregada).
 */
export const COLUNAS_OBRAS: ColunaConsulta[] = [
  { nome: "codObra", tipo: "inteiro", expr: Prisma.sql`o.cod_obra`, obrigatoria: true },
  { nome: "sigla", tipo: "texto", expr: Prisma.sql`o.sigla` },
  { nome: "nome", tipo: "texto", expr: Prisma.sql`o.nome` },
  { nome: "status", tipo: "texto", expr: Prisma.sql`o.status` },
  { nome: "codAuxiliarObra", tipo: "texto", expr: Prisma.sql`o.cod_auxiliar_obra` },
  { nome: "dataInicial", tipo: "data", expr: Prisma.sql`o.data_inicial` },
  { nome: "pecas", tipo: "inteiro", expr: Prisma.sql`coalesce(p.pecas, 0)`, obrigatoria: true, agregada: true },
  { nome: "concretadas", tipo: "inteiro", expr: Prisma.sql`coalesce(p.concretadas, 0)`, obrigatoria: true, agregada: true },
  { nome: "montadas", tipo: "inteiro", expr: Prisma.sql`coalesce(p.montadas, 0)`, obrigatoria: true, agregada: true },
  { nome: "volumeTeorico", tipo: "decimal", expr: Prisma.sql`p.volume_teorico`, agregada: true },
  { nome: "revisoesDetectadas", tipo: "inteiro", expr: Prisma.sql`coalesce(r.revisoes_detectadas, 0)`, obrigatoria: true, agregada: true },
];

/** Peças: `p` = plannix_pecas, `s` = plannix_peca_status (a situação atual). */
export const COLUNAS_PECAS: ColunaConsulta[] = [
  { nome: "codigoControle", tipo: "texto", expr: Prisma.sql`p.codigo_controle`, obrigatoria: true },
  { nome: "sigla", tipo: "texto", expr: Prisma.sql`p.sigla` },
  { nome: "nomePeca", tipo: "texto", expr: Prisma.sql`p.nome_peca` },
  { nome: "produto", tipo: "texto", expr: Prisma.sql`p.produto` },
  { nome: "etapa", tipo: "texto", expr: Prisma.sql`s.status` },
  { nome: "revisao", tipo: "inteiro", expr: Prisma.sql`p.revisao` },
  { nome: "volumeTeorico", tipo: "decimal", expr: Prisma.sql`p.volume_teorico` },
  { nome: "pesoTeorico", tipo: "decimal", expr: Prisma.sql`p.peso_teorico` },
];

/** Histórico de revisões: `r` = plannix_peca_revisoes. */
export const COLUNAS_REVISOES: ColunaConsulta[] = [
  { nome: "detectadaEm", tipo: "data", expr: Prisma.sql`r.detectada_em`, obrigatoria: true },
  { nome: "codigoControle", tipo: "texto", expr: Prisma.sql`r.codigo_controle`, obrigatoria: true },
  { nome: "sigla", tipo: "texto", expr: Prisma.sql`r.sigla` },
  { nome: "nomePeca", tipo: "texto", expr: Prisma.sql`r.nome_peca` },
  { nome: "revisao", tipo: "inteiro", expr: Prisma.sql`r.revisao`, obrigatoria: true },
  { nome: "dataRevisao", tipo: "data", expr: Prisma.sql`r.data_revisao` },
];

/**
 * Consumo por material: `c` = plannix_consumos, agrupado por (origem, código ERP, descrição). Origem, código e descrição são a chave do
 * grupo (filtram no WHERE); quantidade, peças, obras e período são agregadas (filtram no HAVING). `volumeConcretado` entra no "por m³".
 * Uma linha por código do ERP: `dc` = a descrição mais recente do código (FROM_CONSUMO de routes/plannix.ts). `erp` = consumo do ERP das
 * peças da lista, por código (CTE de routes/plannix.ts, 1 linha por código, LEFT JOIN em c.codigo_erp).
 */
export function colunasConsumoMateriais(volumeConcretado: number): ColunaConsulta[] {
  return [
    { nome: "descricao", tipo: "texto", expr: Prisma.sql`coalesce(dc.descricao, c.descricao)` },
    { nome: "codigoErp", tipo: "texto", expr: Prisma.sql`c.codigo_erp` },
    { nome: "origem", tipo: "texto", expr: Prisma.sql`c.origem::text`, obrigatoria: true, dominio: ORIGENS },
    { nome: "quantidade", tipo: "decimal", expr: Prisma.sql`sum(c.quantidade)`, agregada: true },
    { nome: "consumoErp", tipo: "decimal", expr: Prisma.sql`max(erp.q)`, agregada: true },
    // Diferença em quantidade, Plannix − ERP (mesmo sinal do Δ%); só com código do ERP (sem código não há com o que comparar).
    { nome: "deltaErp", tipo: "decimal", expr: Prisma.sql`CASE WHEN c.codigo_erp IS NOT NULL THEN sum(c.quantidade) - coalesce(max(erp.q), 0) END`, agregada: true },
    { nome: "deltaErpPct", tipo: "decimal", expr: Prisma.sql`(sum(c.quantidade) - max(erp.q)) / NULLIF(max(erp.q), 0) * 100`, agregada: true },
    // `em`/`sm` = entradas e saídas manuais de estoque do período, por código (CTEs de routes/plannix.ts; vazias com obra no filtro).
    { nome: "entradasManuais", tipo: "decimal", expr: Prisma.sql`max(em.q)`, agregada: true },
    { nome: "entradasManuaisValor", tipo: "decimal", expr: Prisma.sql`max(em.v)`, agregada: true },
    { nome: "saidasManuais", tipo: "decimal", expr: Prisma.sql`max(sm.q)`, agregada: true },
    { nome: "saidasManuaisValor", tipo: "decimal", expr: Prisma.sql`max(sm.v)`, agregada: true },
    {
      nome: "porM3",
      tipo: "decimal",
      expr: Prisma.sql`CASE WHEN c.origem::text = 'concreto' AND ${volumeConcretado}::numeric > 0 THEN sum(c.quantidade) / ${volumeConcretado}::numeric END`,
      agregada: true,
    },
    { nome: "pecas", tipo: "inteiro", expr: Prisma.sql`count(DISTINCT c.codigo_controle)`, obrigatoria: true, agregada: true },
    { nome: "obras", tipo: "inteiro", expr: Prisma.sql`count(DISTINCT c.sigla)`, obrigatoria: true, agregada: true },
    { nome: "primeiro", tipo: "data", expr: Prisma.sql`min(c.data)`, agregada: true },
  ];
}

/**
 * Consumo de um material, peça a peça: `c` = plannix_consumos, agrupado por peça, fase e obra (a peça pode ter mais de um componente do
 * mesmo material: soma); `e` = baixas do material na OP ligada à peça (LATERAL de routes/plannix.ts, todas as datas, uma linha por peça,
 * também no GROUP BY). Data e quantidade do Plannix são agregadas (HAVING). As colunas do ERP filtram e ordenam, sem lista de valores.
 */
