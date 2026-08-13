-- RegistroDespesaViagem vira tabela de MÃO DUPLA: passa a receber despesa lançada pelo
-- consultor no CaxHub, não só o espelho do Senior. Mesma mudança (e mesma razão) que Rat e
-- RatItem já tinham: `seqrdv` é numeração DO SENIOR, então linha criada aqui precisa nascer sem
-- ela — gerar um MAX+1 local colidiria com uma despesa lançada no ERP no intervalo, e o upsert
-- do próximo sync sobrescreveria em silêncio o lançamento do consultor.
--
-- ALTER em vez de DROP/CREATE de propósito: preserva as 15.034 linhas já espelhadas (são
-- recuperáveis via sync, mas não há motivo pra descartá-las e ressincronizar 15 mil linhas).

-- PK local autoincrement no lugar da chave natural composta
ALTER TABLE "registros_despesa_viagem" ADD COLUMN "id" SERIAL;
ALTER TABLE "registros_despesa_viagem" DROP CONSTRAINT "registros_despesa_viagem_pkey";
ALTER TABLE "registros_despesa_viagem" ADD CONSTRAINT "registros_despesa_viagem_pkey" PRIMARY KEY ("id");

-- Nulo até o Senior confirmar
ALTER TABLE "registros_despesa_viagem" ALTER COLUMN "seqrdv" DROP NOT NULL;

-- Controle de origem/envio (ver comentários no model)
ALTER TABLE "registros_despesa_viagem" ADD COLUMN "origemCaxHub" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "registros_despesa_viagem" ADD COLUMN "enviado_em_senior" TIMESTAMP(3);

-- Chave natural do Senior continua única (é por ela que o sync faz upsert). Aceita vários NULL
-- em seqrdv, que é justamente o que permite N despesas criadas no CaxHub na mesma RAT.
CREATE UNIQUE INDEX "registros_despesa_viagem_codemp_numrat_seqrdv_key" ON "registros_despesa_viagem"("codemp", "numrat", "seqrdv");
