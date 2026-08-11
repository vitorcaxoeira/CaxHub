ALTER TABLE "plano_contabil" ADD CONSTRAINT "chk_plano_contabil_defgru" CHECK ("defgru" IN ('A', 'P', 'D', 'R', 'X', 'M', 'N', 'U', 'L', 'V', 'C', 'S', 'E', 'O', 'T'));
ALTER TABLE "plano_contabil" ADD CONSTRAINT "chk_plano_contabil_natcta" CHECK ("natcta" IN ('D', 'C'));
ALTER TABLE "plano_contabil" ADD CONSTRAINT "chk_plano_contabil_anasin" CHECK ("anasin" IN ('A', 'S'));
