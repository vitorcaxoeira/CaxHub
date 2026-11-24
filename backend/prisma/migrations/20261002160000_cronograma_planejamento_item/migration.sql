-- Período (início/fim) e observação do item da proposta no Cronograma. PropostaItem é espelho do
-- Senior e não recebe coluna própria, então o dado fica numa tabela à parte (mesmo padrão de
-- proposta_item_posicao). Pasta raiz, pasta e atividade já usam as colunas de estrutura_atividades.

-- CreateTable
CREATE TABLE "proposta_item_planejamento" (
    "codemp" INTEGER NOT NULL,
    "codpro" INTEGER NOT NULL,
    "seqite" INTEGER NOT NULL,
    "dataPrevistaInicio" DATE,
    "dataPrevistaFim" DATE,
    "observacao" VARCHAR(1000),
    "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoPor" INTEGER,

    CONSTRAINT "proposta_item_planejamento_pkey" PRIMARY KEY ("codemp","codpro","seqite")
);
