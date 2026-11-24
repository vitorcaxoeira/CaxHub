-- Mapeamentos de campos (Administração > Integração Kyria > Mapeamento) de status de ticket, tickets
-- e horas (ticket/cliente): registrados em dev e levados pra produção por migration, porque o
-- deploy não roda seed. Idempotente e não destrutivo: o recurso é chaveado por resource_path (os
-- ids locais 6/8/15/17 podem diferir aqui) e os campos só entram se o recurso ainda não tiver
-- nenhum — nunca sobrescreve o que um admin já registrou/editou em produção.

-- Status de Ticket (/ticket-statuses) — 8 campos
INSERT INTO "kyria_resource_mappings" ("resource_path", "display_name", "amostra_bruta", "criado_em", "atualizado_em")
VALUES ($q$/ticket-statuses$q$, $q$Status de Ticket$q$, $q${"id":"mx776q1c1rz2qrty0anpg1ca1x8bar3v","key":"em-analise","name":"Em atendimento","color":"#e3df3a","status":"active","teamId":null,"category":"execution","sortOrder":4}$q$::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("resource_path") DO NOTHING;
INSERT INTO "kyria_field_mappings" ("resource_id", "nome_origem", "ordem", "manter", "tipo_escolhido", "nome_interno", "nullable", "tipo_inferido_amostra", "valor_exemplo", "tipo_openapi", "nullable_openapi", "enum_openapi", "criado_em", "atualizado_em", "escala", "precisao", "tamanho", "relacionamento_campo", "relacionamento_modelo", "relacionamento_campo_descricao")
SELECT r."id", v.*
FROM "kyria_resource_mappings" r,
(VALUES
  ($q$id$q$, 0, true, $q$String$q$::"KyriaTipoCampo", $q$id$q$, false, $q$string$q$, $q$"mx776q1c1rz2qrty0anpg1ca1x8bar3v"$q$, $q$string$q$, false, NULL::jsonb, '2026-09-22T17:48:58.103'::timestamp, '2026-09-22T17:48:58.103'::timestamp, NULL::integer, NULL::integer, 64, NULL::text, NULL::text, NULL::text),
  ($q$teamId$q$, 1, true, $q$String$q$::"KyriaTipoCampo", $q$team_id$q$, true, $q$null$q$, $q$null$q$, $q$string$q$, true, NULL::jsonb, '2026-09-22T17:48:58.103'::timestamp, '2026-09-22T17:48:58.103'::timestamp, NULL::integer, NULL::integer, 64, NULL::text, NULL::text, NULL::text),
  ($q$key$q$, 2, true, $q$String$q$::"KyriaTipoCampo", $q$key$q$, false, $q$string$q$, $q$"em-analise"$q$, $q$string$q$, false, NULL::jsonb, '2026-09-22T17:48:58.103'::timestamp, '2026-09-22T17:48:58.103'::timestamp, NULL::integer, NULL::integer, 64, NULL::text, NULL::text, NULL::text),
  ($q$name$q$, 3, true, $q$String$q$::"KyriaTipoCampo", $q$name$q$, false, $q$string$q$, $q$"Em atendimento"$q$, $q$string$q$, false, NULL::jsonb, '2026-09-22T17:48:58.103'::timestamp, '2026-09-22T17:48:58.103'::timestamp, NULL::integer, NULL::integer, 255, NULL::text, NULL::text, NULL::text),
  ($q$color$q$, 4, true, $q$String$q$::"KyriaTipoCampo", $q$color$q$, true, $q$string$q$, $q$"#e3df3a"$q$, $q$string$q$, true, NULL::jsonb, '2026-09-22T17:48:58.103'::timestamp, '2026-09-22T17:48:58.103'::timestamp, NULL::integer, NULL::integer, 16, NULL::text, NULL::text, NULL::text),
  ($q$category$q$, 5, true, $q$String$q$::"KyriaTipoCampo", $q$category$q$, false, $q$string$q$, $q$"execution"$q$, $q$string$q$, false, NULL::jsonb, '2026-09-22T17:48:58.103'::timestamp, '2026-09-22T17:48:58.103'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  ($q$status$q$, 6, true, $q$String$q$::"KyriaTipoCampo", $q$status$q$, false, $q$string$q$, $q$"active"$q$, $q$string$q$, false, NULL::jsonb, '2026-09-22T17:48:58.103'::timestamp, '2026-09-22T17:48:58.103'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  ($q$sortOrder$q$, 7, true, $q$Int$q$::"KyriaTipoCampo", $q$sort_order$q$, true, $q$number$q$, $q$4$q$, $q$string$q$, true, NULL::jsonb, '2026-09-22T17:48:58.103'::timestamp, '2026-09-22T17:48:58.103'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text)
) AS v("nome_origem", "ordem", "manter", "tipo_escolhido", "nome_interno", "nullable", "tipo_inferido_amostra", "valor_exemplo", "tipo_openapi", "nullable_openapi", "enum_openapi", "criado_em", "atualizado_em", "escala", "precisao", "tamanho", "relacionamento_campo", "relacionamento_modelo", "relacionamento_campo_descricao")
WHERE r."resource_path" = $q$/ticket-statuses$q$
  AND NOT EXISTS (SELECT 1 FROM "kyria_field_mappings" f WHERE f."resource_id" = r."id");

-- Tickets (/tickets) — 16 campos
INSERT INTO "kyria_resource_mappings" ("resource_path", "display_name", "amostra_bruta", "criado_em", "atualizado_em")
VALUES ($q$/tickets$q$, $q$Tickets$q$, $q${"id":"kn734a2k18wbfkv9m4m4z73r698ews8a","code":"ERP-147546","title":"Movimentação do estoque consignado","teamId":"md75w8kjw3njz5r6km8ex92ckh8bb9nw","closedAt":null,"openedAt":1790082374389,"priority":"medium","revision":1,"projectId":null,"statusKey":"new","updatedAt":1790082379285,"customerId":"j57er8ps4d5wcybgftvcr5vbp18bw8xj","description":"Olá bom dia! Estamos com um problema na movimentação de um estoque consignado.\nPode me dar um auxilio por gentileza?","parentTicketId":null,"requesterUserId":"ks796hsjwc2ydkj1sq2ea5p8bd8d9a4e","responsibleUserId":null}$q$::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("resource_path") DO NOTHING;
INSERT INTO "kyria_field_mappings" ("resource_id", "nome_origem", "ordem", "manter", "tipo_escolhido", "nome_interno", "nullable", "tipo_inferido_amostra", "valor_exemplo", "tipo_openapi", "nullable_openapi", "enum_openapi", "criado_em", "atualizado_em", "escala", "precisao", "tamanho", "relacionamento_campo", "relacionamento_modelo", "relacionamento_campo_descricao")
SELECT r."id", v.*
FROM "kyria_resource_mappings" r,
(VALUES
  ($q$id$q$, 0, true, $q$String$q$::"KyriaTipoCampo", $q$id$q$, false, $q$string$q$, $q$"kn734a2k18wbfkv9m4m4z73r698ews8a"$q$, $q$string$q$, false, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, 64, NULL::text, NULL::text, NULL::text),
  ($q$code$q$, 1, true, $q$String$q$::"KyriaTipoCampo", $q$code$q$, true, $q$string$q$, $q$"ERP-147546"$q$, $q$string$q$, true, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, 24, NULL::text, NULL::text, NULL::text),
  ($q$title$q$, 2, true, $q$String$q$::"KyriaTipoCampo", $q$title$q$, false, $q$string$q$, $q$"Movimentação do estoque consignado"$q$, $q$string$q$, false, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, 255, NULL::text, NULL::text, NULL::text),
  ($q$description$q$, 3, true, $q$String$q$::"KyriaTipoCampo", $q$description$q$, true, $q$string$q$, $q$"Olá bom dia! Estamos com um problema na movimentação de um estoque consignado.\nPode me dar um auxilio por gentileza?"$q$, $q$string$q$, true, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  ($q$statusKey$q$, 4, true, $q$String$q$::"KyriaTipoCampo", $q$status_key$q$, false, $q$string$q$, $q$"new"$q$, $q$string$q$, false, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, 64, NULL::text, NULL::text, NULL::text),
  ($q$priority$q$, 5, true, $q$String$q$::"KyriaTipoCampo", $q$priority$q$, false, $q$string$q$, $q$"medium"$q$, $q$string$q$, false, $q$["low","medium","high","urgent"]$q$::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  ($q$teamId$q$, 6, true, $q$String$q$::"KyriaTipoCampo", $q$team_id$q$, true, $q$string$q$, $q$"md75w8kjw3njz5r6km8ex92ckh8bb9nw"$q$, $q$string$q$, true, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, 64, NULL::text, NULL::text, NULL::text),
  ($q$responsibleUserId$q$, 7, true, $q$String$q$::"KyriaTipoCampo", $q$responsible_user_id$q$, true, $q$null$q$, $q$null$q$, $q$string$q$, true, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, 64, NULL::text, NULL::text, NULL::text),
  ($q$requesterUserId$q$, 8, true, $q$String$q$::"KyriaTipoCampo", $q$requester_user_id$q$, false, $q$string$q$, $q$"ks796hsjwc2ydkj1sq2ea5p8bd8d9a4e"$q$, $q$string$q$, false, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, 64, NULL::text, NULL::text, NULL::text),
  ($q$projectId$q$, 9, false, $q$String$q$::"KyriaTipoCampo", $q$project_id$q$, true, $q$null$q$, $q$null$q$, $q$string$q$, true, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  ($q$customerId$q$, 10, true, $q$String$q$::"KyriaTipoCampo", $q$customer_id$q$, true, $q$string$q$, $q$"j57er8ps4d5wcybgftvcr5vbp18bw8xj"$q$, $q$string$q$, true, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, 64, NULL::text, NULL::text, NULL::text),
  ($q$openedAt$q$, 11, true, $q$DateTime$q$::"KyriaTipoCampo", $q$opened_at$q$, false, $q$number$q$, $q$1790082374389$q$, $q$number$q$, false, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  ($q$updatedAt$q$, 12, true, $q$DateTime$q$::"KyriaTipoCampo", $q$updated_at$q$, false, $q$number$q$, $q$1790082379285$q$, $q$number$q$, false, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  ($q$closedAt$q$, 13, true, $q$DateTime$q$::"KyriaTipoCampo", $q$closed_at$q$, true, $q$null$q$, $q$null$q$, $q$number$q$, true, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  ($q$parentTicketId$q$, 14, true, $q$String$q$::"KyriaTipoCampo", $q$parent_ticket_id$q$, true, $q$null$q$, $q$null$q$, $q$string$q$, true, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  ($q$revision$q$, 15, true, $q$Int$q$::"KyriaTipoCampo", $q$revision$q$, false, $q$number$q$, $q$1$q$, $q$integer$q$, false, NULL::jsonb, '2026-09-22T17:30:40.306'::timestamp, '2026-09-22T17:30:40.306'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text)
) AS v("nome_origem", "ordem", "manter", "tipo_escolhido", "nome_interno", "nullable", "tipo_inferido_amostra", "valor_exemplo", "tipo_openapi", "nullable_openapi", "enum_openapi", "criado_em", "atualizado_em", "escala", "precisao", "tamanho", "relacionamento_campo", "relacionamento_modelo", "relacionamento_campo_descricao")
WHERE r."resource_path" = $q$/tickets$q$
  AND NOT EXISTS (SELECT 1 FROM "kyria_field_mappings" f WHERE f."resource_id" = r."id");

-- Horas por ticket (relatório) (/reports/hours) — 5 campos
INSERT INTO "kyria_resource_mappings" ("resource_path", "display_name", "amostra_bruta", "criado_em", "atualizado_em")
VALUES ($q$/reports/hours$q$, $q$Horas por ticket (relatório)$q$, $q${"group":{"id":"kn76bffwcgq6c43qx1m3wcja7d8et2nw","code":"QUAL-16","type":"ticket","title":"CCIERP_MAP.V1"},"minutes":176.14}$q$::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("resource_path") DO NOTHING;
INSERT INTO "kyria_field_mappings" ("resource_id", "nome_origem", "ordem", "manter", "tipo_escolhido", "nome_interno", "nullable", "tipo_inferido_amostra", "valor_exemplo", "tipo_openapi", "nullable_openapi", "enum_openapi", "criado_em", "atualizado_em", "escala", "precisao", "tamanho", "relacionamento_campo", "relacionamento_modelo", "relacionamento_campo_descricao")
SELECT r."id", v.*
FROM "kyria_resource_mappings" r,
(VALUES
  ($q$group.type$q$, 0, true, $q$String$q$::"KyriaTipoCampo", $q$group_type$q$, false, $q$string$q$, $q$"ticket"$q$, NULL::text, NULL::boolean, NULL::jsonb, '2026-09-22T17:30:40.516'::timestamp, '2026-09-22T17:30:40.516'::timestamp, NULL::integer, NULL::integer, 25, NULL::text, NULL::text, NULL::text),
  ($q$group.id$q$, 1, true, $q$String$q$::"KyriaTipoCampo", $q$id$q$, false, $q$string$q$, $q$"kn76bffwcgq6c43qx1m3wcja7d8et2nw"$q$, NULL::text, NULL::boolean, NULL::jsonb, '2026-09-22T17:30:40.516'::timestamp, '2026-09-22T17:30:40.516'::timestamp, NULL::integer, NULL::integer, 64, NULL::text, NULL::text, NULL::text),
  ($q$group.code$q$, 2, true, $q$String$q$::"KyriaTipoCampo", $q$code$q$, true, $q$string$q$, $q$"QUAL-16"$q$, NULL::text, NULL::boolean, NULL::jsonb, '2026-09-22T17:30:40.516'::timestamp, '2026-09-22T17:30:40.516'::timestamp, NULL::integer, NULL::integer, 32, NULL::text, NULL::text, NULL::text),
  ($q$group.title$q$, 3, true, $q$String$q$::"KyriaTipoCampo", $q$title$q$, false, $q$string$q$, $q$"CCIERP_MAP.V1"$q$, NULL::text, NULL::boolean, NULL::jsonb, '2026-09-22T17:30:40.516'::timestamp, '2026-09-22T17:30:40.516'::timestamp, NULL::integer, NULL::integer, 255, NULL::text, NULL::text, NULL::text),
  ($q$minutes$q$, 4, true, $q$Decimal$q$::"KyriaTipoCampo", $q$minutes$q$, false, $q$number$q$, $q$176.14$q$, NULL::text, NULL::boolean, NULL::jsonb, '2026-09-22T17:30:40.516'::timestamp, '2026-09-22T17:30:40.516'::timestamp, 2, 8, NULL::integer, NULL::text, NULL::text, NULL::text)
) AS v("nome_origem", "ordem", "manter", "tipo_escolhido", "nome_interno", "nullable", "tipo_inferido_amostra", "valor_exemplo", "tipo_openapi", "nullable_openapi", "enum_openapi", "criado_em", "atualizado_em", "escala", "precisao", "tamanho", "relacionamento_campo", "relacionamento_modelo", "relacionamento_campo_descricao")
WHERE r."resource_path" = $q$/reports/hours$q$
  AND NOT EXISTS (SELECT 1 FROM "kyria_field_mappings" f WHERE f."resource_id" = r."id");

-- Horas por cliente (relatório) (/reports/hours?groupBy=customer) — 5 campos
INSERT INTO "kyria_resource_mappings" ("resource_path", "display_name", "amostra_bruta", "criado_em", "atualizado_em")
VALUES ($q$/reports/hours?groupBy=customer$q$, $q$Horas por cliente (relatório)$q$, $q${"group":{"id":"j57er8ps4d5wcybgftvcr5vbp18bw8xj","name":"Metalurgica Gram Serv LTDA","type":"customer"},"minutes":5445.32}$q$::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("resource_path") DO NOTHING;
INSERT INTO "kyria_field_mappings" ("resource_id", "nome_origem", "ordem", "manter", "tipo_escolhido", "nome_interno", "nullable", "tipo_inferido_amostra", "valor_exemplo", "tipo_openapi", "nullable_openapi", "enum_openapi", "criado_em", "atualizado_em", "escala", "precisao", "tamanho", "relacionamento_campo", "relacionamento_modelo", "relacionamento_campo_descricao")
SELECT r."id", v.*
FROM "kyria_resource_mappings" r,
(VALUES
  ($q$competencia$q$, 0, true, $q$DateTime$q$::"KyriaTipoCampo", $q$competencia$q$, false, $q$string$q$, $q$"2026-09-01"$q$, NULL::text, false, NULL::jsonb, '2026-09-24T20:39:05.077'::timestamp, '2026-09-24T20:39:05.077'::timestamp, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text),
  ($q$group.type$q$, 1, true, $q$String$q$::"KyriaTipoCampo", $q$group_type$q$, true, $q$string$q$, $q$"customer"$q$, NULL::text, NULL::boolean, NULL::jsonb, '2026-09-24T20:39:05.077'::timestamp, '2026-09-24T20:39:05.077'::timestamp, NULL::integer, NULL::integer, 32, NULL::text, NULL::text, NULL::text),
  ($q$group.id$q$, 2, true, $q$String$q$::"KyriaTipoCampo", $q$customer_id$q$, true, $q$string$q$, $q$"j57er8ps4d5wcybgftvcr5vbp18bw8xj"$q$, NULL::text, NULL::boolean, NULL::jsonb, '2026-09-24T20:39:05.077'::timestamp, '2026-09-24T20:39:05.077'::timestamp, NULL::integer, NULL::integer, 64, $q$id$q$, $q$KyriaCustomer$q$, $q$name$q$),
  ($q$group.name$q$, 3, true, $q$String$q$::"KyriaTipoCampo", $q$group_name$q$, true, $q$string$q$, $q$"Metalurgica Gram Serv LTDA"$q$, NULL::text, NULL::boolean, NULL::jsonb, '2026-09-24T20:39:05.077'::timestamp, '2026-09-24T20:39:05.077'::timestamp, NULL::integer, NULL::integer, 255, NULL::text, NULL::text, NULL::text),
  ($q$minutes$q$, 4, true, $q$Decimal$q$::"KyriaTipoCampo", $q$minutes$q$, true, $q$number$q$, $q$5445.32$q$, NULL::text, NULL::boolean, NULL::jsonb, '2026-09-24T20:39:05.077'::timestamp, '2026-09-24T20:39:05.077'::timestamp, 2, 12, NULL::integer, NULL::text, NULL::text, NULL::text)
) AS v("nome_origem", "ordem", "manter", "tipo_escolhido", "nome_interno", "nullable", "tipo_inferido_amostra", "valor_exemplo", "tipo_openapi", "nullable_openapi", "enum_openapi", "criado_em", "atualizado_em", "escala", "precisao", "tamanho", "relacionamento_campo", "relacionamento_modelo", "relacionamento_campo_descricao")
WHERE r."resource_path" = $q$/reports/hours?groupBy=customer$q$
  AND NOT EXISTS (SELECT 1 FROM "kyria_field_mappings" f WHERE f."resource_id" = r."id");
