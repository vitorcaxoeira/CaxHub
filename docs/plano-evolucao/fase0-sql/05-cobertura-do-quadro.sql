\echo '=== 18. cobertura do quadro: horas executadas desde 01/08/2026 por situacao da alocacao no quadro'
WITH fim AS (
  SELECT h."atividadeId", MIN(h."movidoEm") AS encerrou_em
  FROM atividade_historico_movimentacao h JOIN quadro_colunas c ON c.id = h."colunaNovaId"
  WHERE c."ehFinal" AND h.tipo='movimentacao' GROUP BY 1),
ri AS (
  SELECT ri.seqati, (ri.horfim-ri.horini) AS min
  FROM rat_itens ri JOIN rats r ON r.id=ri."ratId"
  WHERE ri.removido_em_senior IS NULL AND r.removido_em_senior IS NULL AND r.sitrat IS DISTINCT FROM 5
    AND ri.horini IS NOT NULL AND ri.horfim > ri.horini AND ri.datati >= '2026-08-01')
SELECT CASE WHEN a.id IS NULL THEN '1. sem alocacao (apontamento solto)'
            WHEN f."atividadeId" IS NOT NULL THEN '2. alocacao ENCERRADA no quadro'
            WHEN a."colunaId" IS NOT NULL THEN '3. alocacao no quadro, ainda aberta'
            ELSE '4. alocacao fora do quadro (nunca movida)' END AS situacao,
       COUNT(DISTINCT a.id) AS alocacoes, ROUND(SUM(ri.min)/60.0,1) AS horas,
       ROUND(100.0*SUM(ri.min)/SUM(SUM(ri.min)) OVER (),1) AS pct
FROM ri LEFT JOIN atividades_consultor a ON a.seqati = ri.seqati AND a.sitreg='A' AND a.removido_em_senior IS NULL
        LEFT JOIN fim f ON f."atividadeId" = a.id
GROUP BY 1 ORDER BY 1;

\echo '=== 19. alocacoes ativas: sitreg e desde quando o quadro e usado'
SELECT sitreg, COUNT(*) AS alocacoes, COUNT("colunaId") AS com_coluna FROM atividades_consultor WHERE removido_em_senior IS NULL GROUP BY 1;
SELECT MIN("movidoEm")::date AS primeira_movimentacao, COUNT(*) AS movimentacoes FROM atividade_historico_movimentacao WHERE tipo='movimentacao';

\echo '=== 20. alocacoes encerradas desde 01/07: orcado EXATO (qtdhor) x dentro do teto, e quantas estouraram'
WITH fim AS (
  SELECT h."atividadeId", MIN(h."movidoEm") AS encerrou_em
  FROM atividade_historico_movimentacao h JOIN quadro_colunas c ON c.id = h."colunaNovaId"
  WHERE c."ehFinal" AND h.tipo='movimentacao' GROUP BY 1),
base AS (SELECT a.id, a.seqati, a.qtdhor, a."horasExcedentes" AS exc FROM fim f JOIN atividades_consultor a ON a.id=f."atividadeId"
         WHERE a.sitreg='A' AND a.removido_em_senior IS NULL AND f.encerrou_em >= '2026-07-01'),
rat AS (SELECT ri.seqati, SUM(ri.horfim-ri.horini) AS min FROM rat_itens ri JOIN rats r ON r.id=ri."ratId"
        WHERE ri.removido_em_senior IS NULL AND r.removido_em_senior IS NULL AND r.sitrat IS DISTINCT FROM 5
          AND ri.horini IS NOT NULL AND ri.horfim > ri.horini AND ri.seqati IN (SELECT seqati FROM base) GROUP BY 1)
SELECT COUNT(*) AS encerradas,
       COUNT(*) FILTER (WHERE COALESCE(r.min,0) <= b.qtdhor) AS dentro_do_orcado,
       COUNT(*) FILTER (WHERE COALESCE(r.min,0) > b.qtdhor) AS acima_do_orcado,
       COUNT(*) FILTER (WHERE b.exc > 0) AS com_horas_excedentes_autorizadas,
       ROUND(100.0*SUM(LEAST(COALESCE(r.min,0), b.qtdhor))/NULLIF(SUM(COALESCE(r.min,0)),0),1) AS eficiencia_estilo_painel_pct
FROM base b LEFT JOIN rat r ON r.seqati=b.seqati;
