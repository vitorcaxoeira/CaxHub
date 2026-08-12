-- Remove PlanoContabilParalelo (e043pcm do Senior) — avaliado e descartado, não era
-- necessário. Empresa.codmpc/codmpu continuam existindo (sem FK formal pra esta tabela, nunca
-- tiveram), só a tabela de mapeamento em si sai. Nunca teve UI nem dado de usuário: é
-- espelho puro do Senior, ressincronizável do zero se um dia for preciso de novo.
DROP TABLE "plano_contabil_paralelo";
