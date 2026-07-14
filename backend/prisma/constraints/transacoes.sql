ALTER TABLE "transacoes" ADD CONSTRAINT "chk_transacoes_rectpb" CHECK (rectpb IS NULL OR trim(rectpb) = '' OR rectpb IN ('PG', 'DV', 'AB', 'CA', 'CR', 'CP', 'LP', 'SU', 'NA'));
