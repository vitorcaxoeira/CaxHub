-- Motivo da mudança de situação da proposta (Rejeitar, Cancelar, Declinar, Em Execução), enviado ao Senior no campo obsSit de ManterSituacaoProposta.
ALTER TABLE "sincronizacao_pendente_proposta" ADD COLUMN "obs_sit" VARCHAR(200);
