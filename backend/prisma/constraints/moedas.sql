ALTER TABLE "moedas" ADD CONSTRAINT "chk_moedas_tipmoe" CHECK ("tipmoe" IN ('V', 'D', 'P', 'E', 'H'));
