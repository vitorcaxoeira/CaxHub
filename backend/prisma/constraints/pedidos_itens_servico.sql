ALTER TABLE "pedidos_itens_servico" ADD CONSTRAINT "chk_pedidos_itens_servico_sitisp" CHECK ("sitisp" IN (1, 2, 3, 4, 5, 6, 7, 8, 9));
