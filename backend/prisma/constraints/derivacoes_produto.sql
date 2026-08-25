ALTER TABLE "derivacoes_produto" ADD CONSTRAINT "chk_derivacoes_produto_tipcn2" CHECK ("tipcn2" IN ('*', '/', 'R'));
ALTER TABLE "derivacoes_produto" ADD CONSTRAINT "chk_derivacoes_produto_tipcn3" CHECK ("tipcn3" IN ('*', '/', 'R'));
