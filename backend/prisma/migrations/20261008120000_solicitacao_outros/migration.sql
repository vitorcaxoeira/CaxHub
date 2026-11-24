-- Serviço "Outros" (material de expediente, equipamentos): pedido simples dentro do mesmo módulo de solicitações.
-- Só colunas novas: as solicitações existentes viram tipo "viagem" pelo DEFAULT; nada é reescrito.
ALTER TABLE "solicitacoes_viagem" ADD COLUMN "tipo" VARCHAR(10) NOT NULL DEFAULT 'viagem';

ALTER TABLE "solicitacoes_viagem_itens"
  ADD COLUMN "descricao" VARCHAR(500),
  ADD COLUMN "quantidade" INTEGER;
