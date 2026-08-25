ALTER TABLE "produtos" ADD CONSTRAINT "chk_produtos_tippro" CHECK ("tippro" IN ('P', 'C', 'M', 'D', 'S'));
