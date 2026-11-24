\echo '=== 1. universo: alocacoes ativas por coluna do quadro'
SELECT COALESCE(c.nome,'(sem coluna)') AS coluna, COALESCE(c."ehFinal",false) AS eh_final, COUNT(*) AS alocacoes,
       COUNT(a."dataPrevistaFim") AS com_data_prevista_fim
FROM atividades_consultor a LEFT JOIN quadro_colunas c ON c.id = a."colunaId"
WHERE a.sitreg = 'A' AND a.removido_em_senior IS NULL
GROUP BY 1,2 ORDER BY 3 DESC;

\echo '=== 2. preenchimento de dataPrevistaFim (ativas) e quem preenche'
SELECT COUNT(*) AS ativas, COUNT("dataPrevistaFim") AS com_fim, COUNT("dataPrevistaInicio") AS com_inicio,
       ROUND(100.0*COUNT("dataPrevistaFim")/NULLIF(COUNT(*),0),1) AS pct_fim
FROM atividades_consultor WHERE sitreg='A' AND removido_em_senior IS NULL;

\echo '=== 3. encerramento: 1a entrada em coluna final (historico) por mes'
WITH fim AS (
  SELECT h."atividadeId", MIN(h."movidoEm") AS encerrou_em
  FROM atividade_historico_movimentacao h JOIN quadro_colunas c ON c.id = h."colunaNovaId"
  WHERE c."ehFinal" AND h.tipo = 'movimentacao'
  GROUP BY 1)
SELECT to_char(date_trunc('month', f.encerrou_em),'YYYY-MM') AS mes, COUNT(*) AS encerradas,
       COUNT(a."dataPrevistaFim") AS com_data_prevista, COUNT(*) FILTER (WHERE a.qtdhor > 0) AS com_orcado
FROM fim f JOIN atividades_consultor a ON a.id = f."atividadeId"
WHERE a.sitreg='A' AND a.removido_em_senior IS NULL
GROUP BY 1 ORDER BY 1;

\echo '=== 4. coerencia: alocacao hoje em coluna final x tem movimentacao pra final no historico'
SELECT (c."ehFinal") AS hoje_em_final,
       COUNT(*) AS alocacoes,
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM atividade_historico_movimentacao h JOIN quadro_colunas cc ON cc.id=h."colunaNovaId" WHERE h."atividadeId"=a.id AND cc."ehFinal" AND h.tipo='movimentacao')) AS com_historico_final
FROM atividades_consultor a JOIN quadro_colunas c ON c.id = a."colunaId"
WHERE a.sitreg='A' AND a.removido_em_senior IS NULL
GROUP BY 1;

\echo '=== 5. reabertura: encerradas que depois voltaram pra coluna nao final'
WITH fim AS (
  SELECT h."atividadeId", MIN(h."movidoEm") AS encerrou_em
  FROM atividade_historico_movimentacao h JOIN quadro_colunas c ON c.id = h."colunaNovaId"
  WHERE c."ehFinal" AND h.tipo='movimentacao' GROUP BY 1)
SELECT COUNT(*) AS encerradas_alguma_vez,
       COUNT(*) FILTER (WHERE NOT cur."ehFinal") AS hoje_fora_de_final
FROM fim f JOIN atividades_consultor a ON a.id=f."atividadeId" JOIN quadro_colunas cur ON cur.id=a."colunaId"
WHERE a.sitreg='A' AND a.removido_em_senior IS NULL;

\echo '=== 6. colunas do quadro'
SELECT id, nome, ordem, "ehFinal", "contaComoExecucao" FROM quadro_colunas ORDER BY ordem;
