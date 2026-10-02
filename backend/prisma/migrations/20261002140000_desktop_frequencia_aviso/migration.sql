-- Frequência (minutos) do aviso "dentro da jornada e sem atividade em execução" da janela flutuante.
-- 0 desliga o aviso.
ALTER TABLE "preferencias_desktop" ADD COLUMN "frequenciaAvisoMin" INTEGER NOT NULL DEFAULT 15;
