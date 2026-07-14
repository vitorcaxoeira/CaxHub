ALTER TABLE "tipos_titulo" ADD CONSTRAINT "chk_tipos_titulo_recsom" CHECK ("recsom" IN ('D', 'O', 'C'));
ALTER TABLE "tipos_titulo" ADD CONSTRAINT "chk_tipos_titulo_pagsom" CHECK ("pagsom" IN ('D', 'O', 'C'));
ALTER TABLE "tipos_titulo" ADD CONSTRAINT "chk_tipos_titulo_apltpt" CHECK ("apltpt" IN ('A', 'R', 'P'));
ALTER TABLE "tipos_titulo" ADD CONSTRAINT "chk_tipos_titulo_sittpt" CHECK ("sittpt" IN ('A', 'I'));
