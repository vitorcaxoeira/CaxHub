ALTER TABLE "contas_correntes" ADD CONSTRAINT "chk_contas_correntes_sitcco" CHECK ("sitcco" IN ('A', 'I'));
