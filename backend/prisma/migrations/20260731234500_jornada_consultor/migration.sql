-- Jornada de trabalho por consultor e dia da semana, mantida pelo gestor do departamento.
--
-- Existe pra a varredura de parada automática saber até que horas uma sessão aberta pode
-- contar: card esquecido "Em Andamento" na sexta à noite fecharia contando o fim de
-- semana inteiro.
--
-- Horários em MINUTOS desde a meia-noite (convenção de rat_itens.horini/horfim) e em hora
-- de parede de São Paulo, nunca UTC — o container de produção roda em UTC-0 e o de
-- desenvolvimento em UTC-3, então guardar "18:00" como instante seria ambíguo.
--
-- Cada período é opcional e independente: quem não trabalha à tarde deixa a tarde nula,
-- quem folga no dia deixa os quatro nulos. A AUSÊNCIA de linha significa "sem jornada
-- cadastrada", que é diferente de folga: consultor sem jornada não sofre parada por
-- expediente. Sem essa distinção, ligar a funcionalidade pararia todo mundo de uma vez.
CREATE TABLE "jornada_consultor" (
    "codemp" INTEGER NOT NULL,
    "codfor" INTEGER NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "manhaInicio" INTEGER,
    "manhaFim" INTEGER,
    "tardeInicio" INTEGER,
    "tardeFim" INTEGER,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPor" INTEGER,

    CONSTRAINT "jornada_consultor_pkey" PRIMARY KEY ("codemp","codfor","diaSemana")
);

ALTER TABLE "jornada_consultor"
    ADD CONSTRAINT "jornada_consultor_atualizadoPor_fkey"
    FOREIGN KEY ("atualizadoPor") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
