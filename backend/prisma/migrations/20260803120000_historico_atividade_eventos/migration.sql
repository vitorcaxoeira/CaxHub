-- A linha do tempo da atividade passa a aceitar fatos que não movem o card (o primeiro
-- deles: liberação de horas excedentes pelo gestor). Um evento desses não tem coluna de
-- destino, então colunaNovaId deixa de ser obrigatório.
ALTER TABLE "atividade_historico_movimentacao" ALTER COLUMN "colunaNovaId" DROP NOT NULL;

-- Default preenche as linhas existentes: tudo que já está gravado é movimentação.
ALTER TABLE "atividade_historico_movimentacao"
  ADD COLUMN "tipo" VARCHAR(40) NOT NULL DEFAULT 'movimentacao',
  ADD COLUMN "descricao" VARCHAR(300);
