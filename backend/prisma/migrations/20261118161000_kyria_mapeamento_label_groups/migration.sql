-- Mapeamento de campos (Administração > Integração Kyria > Mapeamento) dos grupos de etiqueta (/label-groups), recurso #20 registrado em
-- 18/11/2026 — espelho local kyria_label_groups (migration 20261118160000). Levado pra produção por migration porque o deploy não roda seed.
-- Idempotente e não destrutivo: o recurso é chaveado por resource_path e os campos só entram se o recurso ainda não tiver nenhum.
-- 6 campos, 6 mantidos; 1 interno (nome_origem NULL: não vem da API, é do CaxHub).

INSERT INTO "kyria_resource_mappings" ("resource_path", "display_name", "amostra_bruta", "criado_em", "atualizado_em")
VALUES ($q$/label-groups$q$, $q$List label groups$q$, $q${"id":"mn76mj6tb7pmnt1dvhn9edfmq98bsw5k","key":"origem","name":"Origem","status":"active","description":"Onde surgiu o ticket"}$q$::jsonb, '2026-11-18T14:01:04.295'::timestamp, '2026-11-18T14:01:04.295'::timestamp)
ON CONFLICT ("resource_path") DO NOTHING;
INSERT INTO "kyria_field_mappings" ("resource_id", "nome_origem", "ordem", "manter", "tipo_escolhido", "nome_interno", "nullable", "tipo_inferido_amostra", "valor_exemplo", "tipo_openapi", "nullable_openapi", "enum_openapi", "criado_em", "atualizado_em", "escala", "precisao", "tamanho", "relacionamento_campo", "relacionamento_modelo", "relacionamento_campo_descricao")
SELECT r."id", v.*
FROM "kyria_resource_mappings" r,
(VALUES
  ($q$id$q$, 0, true, $q$String$q$::"KyriaTipoCampo", $q$id$q$, false, $q$string$q$, $q$"mn76mj6tb7pmnt1dvhn9edfmq98bsw5k"$q$, $q$string$q$, false, NULL::jsonb, '2026-11-18T14:01:05.075'::timestamp, '2026-11-18T14:01:05.075'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  ($q$key$q$, 1, true, $q$String$q$::"KyriaTipoCampo", $q$key$q$, false, $q$string$q$, $q$"origem"$q$, $q$string$q$, false, NULL::jsonb, '2026-11-18T14:01:05.075'::timestamp, '2026-11-18T14:01:05.075'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  ($q$name$q$, 2, true, $q$String$q$::"KyriaTipoCampo", $q$name$q$, false, $q$string$q$, $q$"Origem"$q$, $q$string$q$, false, NULL::jsonb, '2026-11-18T14:01:05.075'::timestamp, '2026-11-18T14:01:05.075'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  ($q$description$q$, 3, true, $q$String$q$::"KyriaTipoCampo", $q$description$q$, true, $q$string$q$, $q$"Onde surgiu o ticket"$q$, $q$string$q$, true, NULL::jsonb, '2026-11-18T14:01:05.075'::timestamp, '2026-11-18T14:01:05.075'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  ($q$status$q$, 4, true, $q$String$q$::"KyriaTipoCampo", $q$status$q$, false, $q$string$q$, $q$"active"$q$, $q$string$q$, false, $q$["active","inactive"]$q$::jsonb, '2026-11-18T14:01:05.075'::timestamp, '2026-11-18T14:01:05.075'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  (NULL::text, 5, true, $q$Boolean$q$::"KyriaTipoCampo", $q$fitro_dep_time$q$, true, NULL::text, NULL::text, NULL::text, NULL::boolean, NULL::jsonb, '2026-11-18T14:01:05.075'::timestamp, '2026-11-18T14:01:05.075'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text)
) AS v("nome_origem", "ordem", "manter", "tipo_escolhido", "nome_interno", "nullable", "tipo_inferido_amostra", "valor_exemplo", "tipo_openapi", "nullable_openapi", "enum_openapi", "criado_em", "atualizado_em", "escala", "precisao", "tamanho", "relacionamento_campo", "relacionamento_modelo", "relacionamento_campo_descricao")
WHERE r."resource_path" = $q$/label-groups$q$
  AND NOT EXISTS (SELECT 1 FROM "kyria_field_mappings" f WHERE f."resource_id" = r."id");
