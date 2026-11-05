-- Espelho de USU_TE077ITE ganha USU_DepCusRec (Departamento de Custo/Receita, domínio USU_LDepExe), pedido do Vitor em 05/11/2026.
-- Coluna nova e vazia: o próximo sync de propostas_itens preenche.
ALTER TABLE "propostas_itens" ADD COLUMN "depcusrec" INTEGER;
