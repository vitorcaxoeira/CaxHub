ALTER TABLE "contratos_venda_reajustes" ADD CONSTRAINT "chk_contratos_venda_reajustes_tiprea" CHECK ("tiprea" IS NULL OR trim("tiprea") = '' OR "tiprea" IN ('G', 'I'));
