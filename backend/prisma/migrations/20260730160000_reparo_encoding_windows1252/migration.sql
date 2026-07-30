-- Repara o texto que entrou com a faixa 0x80-0x9F trocada por caracteres de controle.
--
-- Causa: até 30/07/2026 o payload do Senior era decodificado como "latin1" em
-- backend/src/soap/client.ts. Latin-1 e Windows-1252 só coincidem de 0xA0 pra cima; na
-- faixa 0x80-0x9F o Windows-1252 tem pontuação (travessão, aspas curvas, bullet,
-- reticências) e o Latin-1 tem controles invisíveis. Resultado: todo travessão virou um
-- caractere de controle, que aparecia como quadradinho na tela.
--
-- Nada se perdeu: o byte original virou um controle de MESMO valor numérico, então a volta
-- é determinística — um translate() caractere a caractere resolve.
--
-- Duas decisões de implementação:
--
-- 1. Varre as colunas DINAMICAMENTE em vez de listar as afetadas. O levantamento foi feito
--    no banco local (12 colunas, ~543 linhas); produção pode ter linhas afetadas em outras
--    colunas, e uma lista fixa as deixaria para trás.
--
-- 2. Mapeia a faixa cp1252 INTEIRA, não só os 8 caracteres encontrados. Assim o resultado
--    aqui é idêntico ao que o decodificador corrigido produz, e o dado não fica oscilando
--    entre um valor e outro a cada sincronização. Os 5 bytes sem definição no cp1252
--    (0x81 0x8D 0x8F 0x90 0x9D) ficam intocados, que é o mesmo que o TextDecoder faz.
--
-- Os caracteres são montados com chr() de propósito: escrevê-los literalmente neste
-- arquivo .sql o tornaria sensível ao encoding com que ele próprio é lido — que é
-- exatamente o problema que esta migration existe pra consertar.
DO $$
DECLARE
  -- 0x80  0x82  0x83  0x84  0x85  0x86  0x87  0x88  0x89  0x8A  0x8B  0x8C  0x8E
  -- 0x91  0x92  0x93  0x94  0x95  0x96  0x97  0x98  0x99  0x9A  0x9B  0x9C  0x9E  0x9F
  origem text :=
    chr(128)||chr(130)||chr(131)||chr(132)||chr(133)||chr(134)||chr(135)||chr(136)||
    chr(137)||chr(138)||chr(139)||chr(140)||chr(142)||chr(145)||chr(146)||chr(147)||
    chr(148)||chr(149)||chr(150)||chr(151)||chr(152)||chr(153)||chr(154)||chr(155)||
    chr(156)||chr(158)||chr(159);
  --  €     ‚     ƒ     „     …     †     ‡     ˆ     ‰     Š     ‹     Œ     Ž
  --  '     '     "     "     •     –     —     ˜     ™     š     ›     œ     ž     Ÿ
  destino text :=
    chr(8364)||chr(8218)||chr(402) ||chr(8222)||chr(8230)||chr(8224)||chr(8225)||chr(710)||
    chr(8240)||chr(352) ||chr(8249)||chr(338) ||chr(381) ||chr(8216)||chr(8217)||chr(8220)||
    chr(8221)||chr(8226)||chr(8211)||chr(8212)||chr(732) ||chr(8482)||chr(353) ||chr(8250)||
    chr(339) ||chr(382) ||chr(376);
  faixa_c1 text := '[' || chr(128) || '-' || chr(159) || ']';
  col record;
  afetadas bigint;
  total bigint := 0;
BEGIN
  FOR col IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = current_schema()
       -- Só tabela base: view não aceita UPDATE.
       AND t.table_type = 'BASE TABLE'
       AND c.data_type IN ('text', 'character varying')
       -- Controle de migrations do Prisma: não é dado de negócio, fica de fora.
       AND c.table_name <> '_prisma_migrations'
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = translate(%I, $1, $2) WHERE %I ~ $3',
      col.table_name, col.column_name, col.column_name, col.column_name
    ) USING origem, destino, faixa_c1;

    GET DIAGNOSTICS afetadas = ROW_COUNT;
    total := total + afetadas;
    IF afetadas > 0 THEN
      RAISE NOTICE 'encoding reparado em %.%: % linha(s)', col.table_name, col.column_name, afetadas;
    END IF;
  END LOOP;

  RAISE NOTICE 'encoding: % linha(s) reparada(s) no total', total;
END $$;
