\echo '=== 13. RatItem lancado no Senior (origemCaxHub=false), desde 01/08: atraso entre datati (dia trabalhado) e datreg (dia do registro)'
SELECT CASE WHEN ri.datreg IS NULL THEN '(datreg vazio)'
            WHEN ri.datreg - ri.datati <= 0 THEN 'no mesmo dia'
            WHEN ri.datreg - ri.datati <= 1 THEN '1 dia depois'
            WHEN ri.datreg - ri.datati <= 3 THEN '2 a 3 dias depois'
            WHEN ri.datreg - ri.datati <= 7 THEN '4 a 7 dias depois'
            ELSE 'mais de 7 dias depois' END AS atraso,
       COUNT(*) AS apontamentos, ROUND(SUM(ri.horfim-ri.horini)/60.0,1) AS horas,
       ROUND(100.0*SUM(ri.horfim-ri.horini)/SUM(SUM(ri.horfim-ri.horini)) OVER (),1) AS pct
FROM rat_itens ri JOIN rats r ON r.id=ri."ratId"
WHERE ri.removido_em_senior IS NULL AND r.removido_em_senior IS NULL AND r.sitrat IS DISTINCT FROM 5
  AND ri.horini IS NOT NULL AND ri.horfim > ri.horini AND ri.datati >= '2026-08-01' AND ri."origemCaxHub" = false
GROUP BY 1 ORDER BY 3 DESC;

\echo '=== 14. mesma medida para RatItem criado no CaxHub (origemCaxHub=true), de controle'
SELECT CASE WHEN ri.datreg IS NULL THEN '(datreg vazio)'
            WHEN ri.datreg - ri.datati <= 0 THEN 'no mesmo dia' ELSE 'depois' END AS atraso,
       COUNT(*) AS apontamentos, ROUND(SUM(ri.horfim-ri.horini)/60.0,1) AS horas
FROM rat_itens ri JOIN rats r ON r.id=ri."ratId"
WHERE ri.removido_em_senior IS NULL AND r.removido_em_senior IS NULL AND r.sitrat IS DISTINCT FROM 5
  AND ri.horini IS NOT NULL AND ri.horfim > ri.horini AND ri.datati >= '2026-08-01' AND ri."origemCaxHub" = true
GROUP BY 1 ORDER BY 1;

\echo '=== 15. preenchimento de datreg e historico: desde quando ha dado em rat_itens e sessoes'
SELECT MIN(datati) AS primeiro_apontamento, MAX(datati) AS ultimo, COUNT(*) AS total, COUNT(datreg) AS com_datreg,
       COUNT(*) FILTER (WHERE "origemCaxHub") AS criados_no_caxhub
FROM rat_itens WHERE removido_em_senior IS NULL;

\echo '=== 16. "apontamento online" por consultor (desde 01/08): % das horas vindas de sessao ao vivo, contando o Senior-desktop como NAO online'
WITH ri AS (
  SELECT r.codfor, (ri.horfim-ri.horini) AS min, ri.id,
         ri."origemCaxHub" AS caxhub, ri.datreg, ri.datati
  FROM rat_itens ri JOIN rats r ON r.id=ri."ratId"
  WHERE ri.removido_em_senior IS NULL AND r.removido_em_senior IS NULL AND r.sitrat IS DISTINCT FROM 5
    AND ri.horini IS NOT NULL AND ri.horfim > ri.horini AND ri.datati >= '2026-08-01' AND r.codfor IS NOT NULL),
cls AS (
  SELECT ri.codfor, ri.min,
    CASE WHEN se.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM solicitacoes_apontamento s WHERE s."sessaoId"=se.id)
              AND EXTRACT(EPOCH FROM (se."criadoEm"-se.inicio)) <= 300 THEN 'vivo' ELSE 'outro' END AS tipo,
    -- variante B: Senior no mesmo dia (datreg = datati) tambem conta como online
    CASE WHEN se.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM solicitacoes_apontamento s WHERE s."sessaoId"=se.id)
              AND EXTRACT(EPOCH FROM (se."criadoEm"-se.inicio)) <= 300 THEN 'vivo'
         WHEN se.id IS NULL AND ri.caxhub = false AND ri.datreg IS NOT NULL AND ri.datreg - ri.datati <= 0 THEN 'vivo' ELSE 'outro' END AS tipo_b
  FROM ri LEFT JOIN LATERAL (SELECT * FROM atividade_sessoes_execucao x WHERE x."ratItemId"=ri.id AND x."excluidaEm" IS NULL LIMIT 1) se ON true),
por AS (
  SELECT codfor, SUM(min) AS total,
         COALESCE(100.0*SUM(min) FILTER (WHERE tipo='vivo')/SUM(min),0) AS pct_a,
         COALESCE(100.0*SUM(min) FILTER (WHERE tipo_b='vivo')/SUM(min),0) AS pct_b
  FROM cls GROUP BY 1 HAVING SUM(min) >= 600)
SELECT 'A: so Start/Stop ao vivo' AS definicao, COUNT(*) AS consultores,
       COUNT(*) FILTER (WHERE pct_a >= 90) AS ge_90, COUNT(*) FILTER (WHERE pct_a >= 70 AND pct_a < 90) AS de_70_a_90,
       COUNT(*) FILTER (WHERE pct_a >= 40 AND pct_a < 70) AS de_40_a_70, COUNT(*) FILTER (WHERE pct_a < 40) AS abaixo_40, COUNT(*) FILTER (WHERE pct_a = 0) AS zero_online,
       ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY pct_a)::numeric,1) AS mediana FROM por
UNION ALL
SELECT 'B: + Senior no mesmo dia', COUNT(*), COUNT(*) FILTER (WHERE pct_b >= 90), COUNT(*) FILTER (WHERE pct_b >= 70 AND pct_b < 90),
       COUNT(*) FILTER (WHERE pct_b >= 40 AND pct_b < 70), COUNT(*) FILTER (WHERE pct_b < 40), COUNT(*) FILTER (WHERE pct_b = 0),
       ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY pct_b)::numeric,1) FROM por;

\echo '=== 17. consultores da area (itens depexe 8/9): quantos tem apontamento desde 01/08 e quantos horas'
SELECT COUNT(DISTINCT r.codfor) AS consultores_com_horas, ROUND(SUM(ri.horfim-ri.horini)/60.0,0) AS horas
FROM rat_itens ri JOIN rats r ON r.id=ri."ratId"
JOIN propostas_itens pi ON pi.codemp=ri.codemp AND pi.codpro=ri.codpro AND pi.seqite=ri.seqite
WHERE ri.removido_em_senior IS NULL AND r.removido_em_senior IS NULL AND r.sitrat IS DISTINCT FROM 5
  AND ri.horini IS NOT NULL AND ri.horfim > ri.horini AND ri.datati >= '2026-08-01' AND pi.depexe IN (8,9);
