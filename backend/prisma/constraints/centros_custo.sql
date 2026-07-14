ALTER TABLE "centros_custo" ADD CONSTRAINT "chk_centros_custo_tipccu" CHECK ("tipccu" IN ('1', '2', '3', '4', '5'));
ALTER TABLE "centros_custo" ADD CONSTRAINT "chk_centros_custo_anasin" CHECK ("anasin" IN ('A', 'S'));
