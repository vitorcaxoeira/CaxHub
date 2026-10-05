-- Janela de retroatividade dos pedidos de apontamento avulso e de ajuste de horário.
--
-- Por ordem da Diretoria (05/10/2026) o consultor só pode pedir apontamento/ajuste para o dia
-- corrente. Esta tabela é a EXCEÇÃO por consultor: quantos dias úteis (seg–sex, sem feriado) antes
-- de hoje ele ainda pode pedir. Mantida pelo admin ou pelo líder do departamento dele.
--
-- A AUSÊNCIA de linha significa 0 dias (só hoje) — é o padrão da regra, por isso a migration não
-- semeia nada. Tabela própria, e não coluna em "consultores", porque aquela é espelho sincronizado
-- do Senior.
CREATE TABLE "configuracao_apontamento_consultor" (
    "codemp" INTEGER NOT NULL,
    "codfor" INTEGER NOT NULL,
    "diasRetroativos" INTEGER NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPor" INTEGER,

    CONSTRAINT "configuracao_apontamento_consultor_pkey" PRIMARY KEY ("codemp","codfor")
);

ALTER TABLE "configuracao_apontamento_consultor"
    ADD CONSTRAINT "configuracao_apontamento_consultor_atualizadoPor_fkey"
    FOREIGN KEY ("atualizadoPor") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
