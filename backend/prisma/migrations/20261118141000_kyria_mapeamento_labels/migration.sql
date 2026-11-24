-- Mapeamento de campos (Administração > Integração Kyria > Mapeamento) das etiquetas (/labels), recurso #16 registrado em
-- 18/11/2026 — espelho local kyria_labels (migration 20261118140000). Levado pra produção por migration porque o deploy não roda seed.
-- Idempotente e não destrutivo: o recurso é chaveado por resource_path e os campos só entram se o recurso ainda não tiver nenhum.
-- 8 campos, todos mantidos. key/name com tamanho 64/255 (o registro original usava 32, menor que o dado real da API).

INSERT INTO "kyria_resource_mappings" ("resource_path", "display_name", "amostra_bruta", "criado_em", "atualizado_em")
VALUES ($q$/labels$q$, $q$List labels$q$, $q${"id":"ms75pwjpk7aw3g4swacghvnnvs8bsbxr","key":"kyria","name":"Kyria","color":"#000000","status":"inactive","teamId":null,"groupId":"mn76mj6tb7pmnt1dvhn9edfmq98bsw5k","sortOrder":null}$q$::jsonb, '2026-11-18T13:25:59.384'::timestamp, '2026-11-18T13:25:59.384'::timestamp)
ON CONFLICT ("resource_path") DO NOTHING;
INSERT INTO "kyria_field_mappings" ("resource_id", "nome_origem", "ordem", "manter", "tipo_escolhido", "nome_interno", "nullable", "tipo_inferido_amostra", "valor_exemplo", "tipo_openapi", "nullable_openapi", "enum_openapi", "criado_em", "atualizado_em", "escala", "precisao", "tamanho", "relacionamento_campo", "relacionamento_modelo", "relacionamento_campo_descricao")
SELECT r."id", v.*
FROM "kyria_resource_mappings" r,
(VALUES
  ($q$id$q$, 0, true, $q$String$q$::"KyriaTipoCampo", $q$id$q$, false, $q$string$q$, $q$"ms75pwjpk7aw3g4swacghvnnvs8bsbxr"$q$, $q$string$q$, false, NULL::jsonb, '2026-11-18T13:25:59.526'::timestamp, '2026-11-18T13:25:59.526'::timestamp, NULL::integer, NULL::integer, 64, NULL::text, NULL::text, NULL::text),
  ($q$groupId$q$, 1, true, $q$String$q$::"KyriaTipoCampo", $q$group_id$q$, true, $q$string$q$, $q$"mn76mj6tb7pmnt1dvhn9edfmq98bsw5k"$q$, $q$string$q$, true, NULL::jsonb, '2026-11-18T13:25:59.526'::timestamp, '2026-11-18T13:25:59.526'::timestamp, NULL::integer, NULL::integer, 64, NULL::text, NULL::text, NULL::text),
  ($q$teamId$q$, 2, true, $q$String$q$::"KyriaTipoCampo", $q$team_id$q$, true, $q$null$q$, $q$null$q$, $q$string$q$, true, NULL::jsonb, '2026-11-18T13:25:59.526'::timestamp, '2026-11-18T13:25:59.526'::timestamp, NULL::integer, NULL::integer, 64, NULL::text, NULL::text, NULL::text),
  ($q$key$q$, 3, true, $q$String$q$::"KyriaTipoCampo", $q$key$q$, false, $q$string$q$, $q$"kyria"$q$, $q$string$q$, false, NULL::jsonb, '2026-11-18T13:25:59.526'::timestamp, '2026-11-18T13:25:59.526'::timestamp, NULL::integer, NULL::integer, 64, NULL::text, NULL::text, NULL::text),
  ($q$name$q$, 4, true, $q$String$q$::"KyriaTipoCampo", $q$name$q$, false, $q$string$q$, $q$"Kyria"$q$, $q$string$q$, false, NULL::jsonb, '2026-11-18T13:25:59.526'::timestamp, '2026-11-18T13:25:59.526'::timestamp, NULL::integer, NULL::integer, 255, NULL::text, NULL::text, NULL::text),
  ($q$color$q$, 5, true, $q$String$q$::"KyriaTipoCampo", $q$color$q$, true, $q$string$q$, $q$"#000000"$q$, $q$string$q$, true, NULL::jsonb, '2026-11-18T13:25:59.526'::timestamp, '2026-11-18T13:25:59.526'::timestamp, NULL::integer, NULL::integer, 24, NULL::text, NULL::text, NULL::text),
  ($q$status$q$, 6, true, $q$String$q$::"KyriaTipoCampo", $q$status$q$, false, $q$string$q$, $q$"inactive"$q$, $q$string$q$, false, $q$["active","inactive"]$q$::jsonb, '2026-11-18T13:25:59.526'::timestamp, '2026-11-18T13:25:59.526'::timestamp, NULL::integer, NULL::integer, 12, NULL::text, NULL::text, NULL::text),
  ($q$sortOrder$q$, 7, true, $q$Int$q$::"KyriaTipoCampo", $q$sort_order$q$, true, $q$null$q$, $q$null$q$, $q$number$q$, true, NULL::jsonb, '2026-11-18T13:25:59.526'::timestamp, '2026-11-18T13:25:59.526'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text)
) AS v("nome_origem", "ordem", "manter", "tipo_escolhido", "nome_interno", "nullable", "tipo_inferido_amostra", "valor_exemplo", "tipo_openapi", "nullable_openapi", "enum_openapi", "criado_em", "atualizado_em", "escala", "precisao", "tamanho", "relacionamento_campo", "relacionamento_modelo", "relacionamento_campo_descricao")
WHERE r."resource_path" = $q$/labels$q$
  AND NOT EXISTS (SELECT 1 FROM "kyria_field_mappings" f WHERE f."resource_id" = r."id");
