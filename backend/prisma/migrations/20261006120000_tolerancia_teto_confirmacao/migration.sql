-- Tolerância do teto de horas na CONFIRMAÇÃO de sessões já trabalhadas (Meus Apontamentos).
--
-- A confirmação recusava qualquer minuto acima do teto (alocado + excedentes). Mas horini/horfim
-- do RatItem são truncados no minuto, o que alarga o intervalo em até 1 min em relação ao que a
-- parada automática por teto calculou em milissegundos. Caso real, sessão 2355 (05-06/10/2026):
-- a 2346 durou 110,16 min e virou RatItem de 111, o realizado da atividade foi a 961 contra o teto
-- de 960 e todas as sessões pendentes dela travaram.
--
-- Por consultor, mantida pelo admin ou pelo líder do departamento dele (junto da janela de
-- retroatividade). DEFAULT 5: quem não tem linha na tabela também recebe 5 (ver
-- domain/toleranciaTeto.ts), então a migration não semeia nada.
ALTER TABLE "configuracao_apontamento_consultor"
    ADD COLUMN "toleranciaTetoMin" INTEGER NOT NULL DEFAULT 5;
