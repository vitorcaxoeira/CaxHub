-- Preferências de tela por usuário. A primeira é a visão em que Gestão de Projetos › Atividades abre (antes era sempre o
-- Quadro). Próximas preferências de tela entram como colunas novas desta tabela.

-- CreateTable
CREATE TABLE "preferencias_tela" (
    "userId" INTEGER NOT NULL,
    "atividadesVisao" VARCHAR(12) NOT NULL DEFAULT 'quadro',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preferencias_tela_pkey" PRIMARY KEY ("userId")
);

-- Mesmas visões da tela (VISOES_ATIVIDADES em src/domain/preferenciasTela.ts).
ALTER TABLE "preferencias_tela" ADD CONSTRAINT "preferencias_tela_atividadesVisao_check"
  CHECK ("atividadesVisao" IN ('quadro', 'lista', 'calendario', 'timeline', 'workload'));

-- AddForeignKey
ALTER TABLE "preferencias_tela" ADD CONSTRAINT "preferencias_tela_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
