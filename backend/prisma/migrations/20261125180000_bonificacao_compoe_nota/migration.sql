-- Bonificação compondo a nota fiscal (25/11/2026): flag no processo e a cópia dela no fechamento (valor na hora de fechar).

-- AlterTable
ALTER TABLE "bonificacao_processos" ADD COLUMN "compoe_nota" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "bonificacao_fechamentos" ADD COLUMN "compoe_nota" BOOLEAN NOT NULL DEFAULT false;
