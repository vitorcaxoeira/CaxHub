\echo '=== 13b. SO lancados direto no Senior (sem sessao do CaxHub), desde 01/08: atraso datati -> datreg'
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
  AND ri.horini IS NOT NULL AND ri.horfim > ri.horini AND ri.datati >= '2026-08-01'
  AND NOT EXISTS (SELECT 1 FROM atividade_sessoes_execucao x WHERE x."ratItemId"=ri.id AND x."excluidaEm" IS NULL)
GROUP BY 1 ORDER BY 3 DESC;

\echo '=== 13c. o que e datreg? mediana do atraso e quantos tem datreg < datati (inconsistente)'
SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE datreg < datati) AS datreg_antes_do_trabalho,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY (datreg - datati)) AS mediana_dias
FROM rat_itens ri JOIN rats r ON r.id=ri."ratId"
WHERE ri.removido_em_senior IS NULL AND r.removido_em_senior IS NULL AND ri.datati >= '2026-08-01' AND ri.datreg IS NOT NULL;
