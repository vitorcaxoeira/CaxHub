ALTER TABLE "condicoes_pagamento" ADD CONSTRAINT "chk_condicoes_pagamento_aplcpg" CHECK ("aplcpg" IN ('V', 'C', 'A'));
ALTER TABLE "condicoes_pagamento" ADD CONSTRAINT "chk_condicoes_pagamento_sitcpg" CHECK ("sitcpg" IN ('A', 'I'));
