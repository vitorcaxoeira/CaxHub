-- tipnfs usa 0 como sentinela de "não informado" nos dados reais (campo Int de domínio, mesmo
-- papel que string em branco faz em campo de domínio String — ver ciffob/sitnfv abaixo).
ALTER TABLE "notas_fiscais_venda" ADD CONSTRAINT "chk_notas_fiscais_venda_tipnfs"
  CHECK ("tipnfs" IS NULL OR "tipnfs" = 0 OR "tipnfs" IN (1, 2, 3, 4, 5, 6, 9, 10));
ALTER TABLE "notas_fiscais_venda" ADD CONSTRAINT "chk_notas_fiscais_venda_ciffob"
  CHECK ("ciffob" IS NULL OR trim("ciffob") = '' OR "ciffob" IN ('C', 'F', 'T', 'X'));
ALTER TABLE "notas_fiscais_venda" ADD CONSTRAINT "chk_notas_fiscais_venda_sitnfv"
  CHECK ("sitnfv" IS NULL OR trim("sitnfv") = '' OR "sitnfv" IN ('1', '2', '3', '4', '5', '6', '7', '8'));
