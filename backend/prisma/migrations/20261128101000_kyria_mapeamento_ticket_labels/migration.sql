-- Mapeamento de campos (Administração > Integração Kyria > Mapeamento) das etiquetas de cada chamado (/tickets/{ticketId}/labels), espelho
-- local kyria_ticket_labels. Levado pra produção por migration porque o deploy não roda seed. Idempotente e não destrutivo: o recurso é
-- chaveado por resource_path e os campos só entram se o recurso ainda não tiver nenhum. key/name/color vêm da tabela de etiquetas
-- (kyria_labels), por isso ficam com manter = false; ticket_id é o chamado consultado (campo interno).

INSERT INTO "kyria_resource_mappings" ("resource_path", "display_name", "amostra_bruta", "criado_em", "atualizado_em")
VALUES ($q$/tickets/{ticketId}/labels$q$, $q$List ticket labels$q$, $q${"labelId":"ms77pn38paq7v2kv2hb8kcrnw18je86t","groupId":"mn783fgvmygvprce0yhggdd0nn8jftw2","key":"area-erp-gestao-empresarial","name":"ERP | Gestão Empresarial","color":null,"appliedAt":1795017795286}$q$::jsonb, '2026-11-28T10:00:00.000'::timestamp, '2026-11-28T10:00:00.000'::timestamp)
ON CONFLICT ("resource_path") DO NOTHING;

INSERT INTO "kyria_field_mappings" ("resource_id", "nome_origem", "ordem", "manter", "tipo_escolhido", "nome_interno", "nullable", "tamanho", "criado_em", "atualizado_em")
SELECT r."id", v."nome_origem", v."ordem", v."manter", v."tipo"::"KyriaTipoCampo", v."nome_interno", v."nullable", v."tamanho", '2026-11-28T10:00:00.000'::timestamp, '2026-11-28T10:00:00.000'::timestamp
FROM "kyria_resource_mappings" r,
(VALUES
  (NULL::text, 0, true, 'String', 'ticket_id', false, 64),
  ('labelId', 1, true, 'String', 'label_id', false, 64),
  ('groupId', 2, true, 'String', 'group_id', true, 64),
  ('appliedAt', 3, true, 'DateTime', 'applied_at', true, NULL::int),
  ('key', 4, false, 'String', 'key', false, 255),
  ('name', 5, false, 'String', 'name', false, 255),
  ('color', 6, false, 'String', 'color', true, 24)
) AS v("nome_origem", "ordem", "manter", "tipo", "nome_interno", "nullable", "tamanho")
WHERE r."resource_path" = $q$/tickets/{ticketId}/labels$q$
  AND NOT EXISTS (SELECT 1 FROM "kyria_field_mappings" f WHERE f."resource_id" = r."id");
