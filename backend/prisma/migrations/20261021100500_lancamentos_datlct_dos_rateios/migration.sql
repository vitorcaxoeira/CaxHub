-- Preenche a data (datlct) dos cabeçalhos já espelhados a partir dos rateios (rateios_lancamento guarda DatLct por lançamento).
-- Sem isso, o cabeçalho que JÁ sumiu do Senior (ex.: 1300765961) nunca mais viria na sync para ganhar a data, ficaria com datlct
-- NULL e fora do recorte "DatLct >= ..." da varredura, ou seja, nunca seria marcado. Os que ainda existem no Senior recebem a data
-- de lá na próxima sync de qualquer jeito (o upsert sobrescreve). Cabeçalho sem rateio fica NULL (fora do escopo da varredura).
UPDATE "lancamentos_contabeis" l
   SET "datlct" = r."datlct"
  FROM (SELECT "codemp", "numlct", MIN("datlct") AS "datlct" FROM "rateios_lancamento" GROUP BY "codemp", "numlct") r
 WHERE r."codemp" = l."codemp" AND r."numlct" = l."numlct" AND l."datlct" IS NULL;
