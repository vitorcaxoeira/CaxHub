ALTER TABLE "contratos_venda" ADD CONSTRAINT "chk_contratos_venda_sitctr" CHECK ("sitctr" IN ('A', 'I'));
