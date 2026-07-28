ALTER TABLE "pedidos" ADD CONSTRAINT "chk_pedidos_tipped" CHECK ("tipped" IN ('1', '2', '3', '4', '5', '6', '7', '8', '9'));
ALTER TABLE "pedidos" ADD CONSTRAINT "chk_pedidos_prcped" CHECK ("prcped" IN ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10'));
ALTER TABLE "pedidos" ADD CONSTRAINT "chk_pedidos_sitped" CHECK ("sitped" IN ('1', '2', '3', '4', '5', '6', '7', '8', '9'));
