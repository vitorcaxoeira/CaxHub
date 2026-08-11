ALTER TABLE "rateios_lancamento" ADD CONSTRAINT "chk_rateios_lancamento_debcre" CHECK ("debcre" IN ('D', 'C'));
ALTER TABLE "rateios_lancamento" ADD CONSTRAINT "chk_rateios_lancamento_sitrat" CHECK ("sitrat" IN ('1', '2', '3', '4'));
