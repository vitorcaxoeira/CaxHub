ALTER TABLE "movimentos_conta" ADD CONSTRAINT "chk_movimentos_conta_sitmcc" CHECK ("sitmcc" IN ('A', 'I'));
