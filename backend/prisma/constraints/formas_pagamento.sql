ALTER TABLE "formas_pagamento" ADD CONSTRAINT "chk_formas_pagamento_sitfpg" CHECK ("sitfpg" IN ('A', 'I'));
