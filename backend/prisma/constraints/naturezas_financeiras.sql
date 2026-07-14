ALTER TABLE "naturezas_financeiras" ADD CONSTRAINT "chk_naturezas_financeiras_defgru" CHECK ("defgru" IN ('A', 'P', 'D', 'R', 'X', 'M', 'N', 'U', 'L', 'V', 'C', 'S', 'E', 'O', 'T'));
ALTER TABLE "naturezas_financeiras" ADD CONSTRAINT "chk_naturezas_financeiras_anasin" CHECK ("anasin" IN ('A', 'S'));
ALTER TABLE "naturezas_financeiras" ADD CONSTRAINT "chk_naturezas_financeiras_natfin" CHECK ("natfin" IN ('D', 'C'));
ALTER TABLE "naturezas_financeiras" ADD CONSTRAINT "chk_naturezas_financeiras_sitfin" CHECK ("sitfin" IN ('A', 'I'));
