-- Janela flutuante do CaxHub Desktop: opções por usuário e computadores conectados.

-- CreateTable
CREATE TABLE "preferencias_desktop" (
    "userId" INTEGER NOT NULL,
    "abrirAoIniciar" BOOLEAN NOT NULL DEFAULT true,
    "sempreNoTopo" BOOLEAN NOT NULL DEFAULT true,
    "alertasJornada" BOOLEAN NOT NULL DEFAULT true,
    "modoInicial" VARCHAR(10) NOT NULL DEFAULT 'expandida',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preferencias_desktop_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "dispositivos_desktop" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUsoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "revogadoEm" TIMESTAMP(3),

    CONSTRAINT "dispositivos_desktop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dispositivos_desktop_tokenHash_key" ON "dispositivos_desktop"("tokenHash");

-- CreateIndex
CREATE INDEX "dispositivos_desktop_userId_idx" ON "dispositivos_desktop"("userId");

-- AddForeignKey
ALTER TABLE "preferencias_desktop" ADD CONSTRAINT "preferencias_desktop_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivos_desktop" ADD CONSTRAINT "dispositivos_desktop_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
