\echo '=== 7. alocacoes encerradas desde 01/07/2026 (1a entrada em coluna final): orcado x executado, por depexe do item'
WITH fim AS (
  SELECT h."atividadeId", MIN(h."movidoEm") AS encerrou_em
  FROM atividade_historico_movimentacao h JOIN quadro_colunas c ON c.id = h."colunaNovaId"
  WHERE c."ehFinal" AND h.tipo='movimentacao' GROUP BY 1),
base AS (
  SELECT a.id, a.seqati, a.codfor, a.qtdhor, a."horasExcedentes" AS exc, pi.depexe, f.encerrou_em
  FROM fim f JOIN atividades_consultor a ON a.id=f."atividadeId"
  LEFT JOIN propostas_itens pi ON pi.codemp=a.codemp AND pi.codpro=a.codpro AND pi.seqite=a.seqite
  WHERE a.sitreg='A' AND a.removido_em_senior IS NULL AND f.encerrou_em >= '2026-07-01'),
rat AS (
  SELECT ri.seqati, SUM(ri.horfim-ri.horini) AS min
  FROM rat_itens ri JOIN rats r ON r.id=ri."ratId"
  WHERE ri.removido_em_senior IS NULL AND r.removido_em_senior IS NULL AND r.sitrat IS DISTINCT FROM 5
    AND ri.horini IS NOT NULL AND ri.horfim > ri.horini AND ri.seqati IN (SELECT seqati FROM base WHERE seqati IS NOT NULL)
  GROUP BY 1),
ses AS (
  SELECT se."atividadeId", SUM(EXTRACT(EPOCH FROM (se.fim-se.inicio))/60) AS min
  FROM atividade_sessoes_execucao se
  WHERE se.confirmada=false AND se.fim IS NOT NULL AND se."excluidaEm" IS NULL AND se."atividadeId" IN (SELECT id FROM base)
  GROUP BY 1),
t AS (
  SELECT b.*, COALESCE(r.min,0)+COALESCE(s.min,0) AS exec
  FROM base b LEFT JOIN rat r ON r.seqati=b.seqati LEFT JOIN ses s ON s."atividadeId"=b.id)
SELECT COALESCE(depexe::text,'(sem item)') AS depexe, COUNT(*) AS encerradas, COUNT(DISTINCT codfor) AS consultores,
       ROUND(SUM(qtdhor)/60.0,1) AS orcado_h, ROUND(SUM(qtdhor+exc)/60.0,1) AS teto_h, ROUND(SUM(exec)/60.0,1) AS executado_h,
       ROUND(100.0*SUM(qtdhor)/NULLIF(SUM(exec),0),1) AS indice_orcado_sobre_exec_pct,
       COUNT(*) FILTER (WHERE seqati IS NULL) AS sem_seqati, COUNT(*) FILTER (WHERE exec = 0) AS sem_horas_executadas
FROM t GROUP BY ROLLUP(1) ORDER BY 1;

\echo '=== 8. consultores com encerradas desde 01/07 (distribuicao: 1, 2-4, 5+)'
WITH fim AS (
  SELECT h."atividadeId", MIN(h."movidoEm") AS encerrou_em
  FROM atividade_historico_movimentacao h JOIN quadro_colunas c ON c.id = h."colunaNovaId"
  WHERE c."ehFinal" AND h.tipo='movimentacao' GROUP BY 1),
por AS (
  SELECT a.codfor, COUNT(*) AS n FROM fim f JOIN atividades_consultor a ON a.id=f."atividadeId"
  WHERE a.sitreg='A' AND a.removido_em_senior IS NULL AND f.encerrou_em >= '2026-07-01' GROUP BY 1)
SELECT CASE WHEN n=1 THEN '1' WHEN n<5 THEN '2-4' WHEN n<10 THEN '5-9' ELSE '10+' END AS faixa, COUNT(*) AS consultores, SUM(n) AS encerradas
FROM por GROUP BY 1 ORDER BY 1;

\echo '=== 9. sessoes de execucao (nao excluidas) por origem'
SELECT origem, COUNT(*) AS sessoes, COUNT(*) FILTER (WHERE fim IS NULL) AS abertas, COUNT(*) FILTER (WHERE confirmada) AS confirmadas,
       MIN(inicio)::date AS primeira, MAX(inicio)::date AS ultima
FROM atividade_sessoes_execucao WHERE "excluidaEm" IS NULL GROUP BY 1;

\echo '=== 10. atraso entre o inicio da sessao e a criacao do registro (sinal de lancamento retroativo)'
SELECT CASE WHEN EXTRACT(EPOCH FROM (se."criadoEm"-se.inicio)) <= 300 THEN 'ate 5 min (ao vivo)'
            WHEN EXTRACT(EPOCH FROM (se."criadoEm"-se.inicio)) <= 3600 THEN '5 min a 1 h'
            WHEN EXTRACT(EPOCH FROM (se."criadoEm"-se.inicio)) <= 86400 THEN '1 h a 1 dia'
            ELSE 'mais de 1 dia' END AS atraso,
       COUNT(*) AS sessoes, ROUND(SUM(EXTRACT(EPOCH FROM (se.fim-se.inicio))/3600)::numeric,1) AS horas,
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM solicitacoes_apontamento s WHERE s."sessaoId"=se.id)) AS de_solicitacao_aprovada
FROM atividade_sessoes_execucao se WHERE se."excluidaEm" IS NULL AND se.fim IS NOT NULL GROUP BY 1 ORDER BY 1;

\echo '=== 11. sessoes nascidas de solicitacao de apontamento (retroativo explicito)'
SELECT status, COUNT(*) AS solicitacoes, COUNT("sessaoId") AS com_sessao FROM solicitacoes_apontamento GROUP BY 1;

\echo '=== 12. de onde vem o executado (RatItem valido, datati desde 01/08/2026), em horas'
WITH ri AS (
  SELECT ri.id, ri."origemCaxHub" AS caxhub, (ri.horfim-ri.horini) AS min
  FROM rat_itens ri JOIN rats r ON r.id=ri."ratId"
  WHERE ri.removido_em_senior IS NULL AND r.removido_em_senior IS NULL AND r.sitrat IS DISTINCT FROM 5
    AND ri.horini IS NOT NULL AND ri.horfim > ri.horini AND ri.datati >= '2026-08-01'),
cls AS (
  SELECT ri.min,
    CASE WHEN se.id IS NULL AND ri.caxhub = false THEN 'Senior (lancado no desktop)'
         WHEN se.id IS NULL AND ri.caxhub = true  THEN 'CaxHub sem sessao (RAT direta)'
         WHEN EXISTS (SELECT 1 FROM solicitacoes_apontamento s WHERE s."sessaoId"=se.id) THEN 'sessao de solicitacao (retroativo explicito)'
         WHEN EXTRACT(EPOCH FROM (se."criadoEm"-se.inicio)) <= 300 THEN 'sessao ao vivo (Start/Stop)'
         ELSE 'sessao criada depois do fato (retroativo provavel)' END AS origem
  FROM ri LEFT JOIN LATERAL (SELECT * FROM atividade_sessoes_execucao x WHERE x."ratItemId"=ri.id AND x."excluidaEm" IS NULL LIMIT 1) se ON true)
SELECT origem, COUNT(*) AS apontamentos, ROUND(SUM(min)/60.0,1) AS horas, ROUND(100.0*SUM(min)/SUM(SUM(min)) OVER (),1) AS pct
FROM cls GROUP BY 1 ORDER BY 3 DESC;
