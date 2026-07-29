import "dotenv/config";
import fs from "fs";
import path from "path";
import { validateQuery } from "../src/soap/queryValidator";
import { getTableInfo, getFieldDomainValues, SeniorField } from "../src/soap/metadata";
import { mapSeniorType } from "../src/soap/typeMapping";

const BACKEND_ROOT = path.resolve(__dirname, "..");
const SCHEMA_PATH = path.join(BACKEND_ROOT, "prisma", "schema.prisma");
const SYNC_DIR = path.join(BACKEND_ROOT, "src", "sync");
const CONSTRAINTS_DIR = path.join(BACKEND_ROOT, "prisma", "constraints");

function tsInterfaceType(prismaType: string): string {
  switch (prismaType) {
    case "Int":
    case "BigInt":
    case "Decimal":
      return "number";
    case "Boolean":
      return "boolean";
    case "DateTime":
    case "String":
    default:
      return "string";
  }
}

function upsertValueExpr(prismaType: string, accessor: string, optional: boolean): string {
  if (prismaType === "BigInt") {
    return optional ? `${accessor} != null ? BigInt(${accessor}) : null` : `BigInt(${accessor})`;
  }
  if (prismaType === "DateTime") {
    return optional ? `${accessor} != null ? new Date(${accessor}) : null` : `new Date(${accessor})`;
  }
  return accessor;
}

async function main() {
  const [, , modelName, localTableName, query] = process.argv;
  if (!modelName || !localTableName || !query) {
    console.error(
      'Uso: npx ts-node scripts/scaffold-table.ts <ModelName> <nome_tabela_postgres> "<SELECT col AS col, ... FROM tabela>"'
    );
    process.exit(1);
  }

  console.log(`Validando query contra o dicionário de dados do Senior...`);
  const { tableName, columns, fields } = await validateQuery(query);
  console.log(`OK — todas as colunas existem em "${tableName}".`);

  const fieldByName = new Map(fields.map((f) => [f.fldnam.toLowerCase(), f]));

  // Mapeia o nome de origem do campo (ex.: "USU_CodEmp") para o alias escolhido
  // na query (ex.: "codemp") — os dois podem divergir, sobretudo em tabelas
  // customizadas (USU_*), onde o prefixo é removido do alias por convenção.
  const aliasBySource = new Map(columns.map((c) => [c.source.toLowerCase(), c.alias.toLowerCase()]));

  const tableInfo = await getTableInfo(tableName);
  const missingPkFields = tableInfo.pkFields.filter((pk) => !aliasBySource.has(pk.toLowerCase()));
  if (missingPkFields.length > 0) {
    console.warn(
      `AVISO: a chave primária real de "${tableName}" inclui ${tableInfo.pkFields.join(", ")}, mas a query não selecionou: ${missingPkFields.join(", ")}. O upsert do job de sync pode ficar incorreto.`
    );
  }
  const pkAliases = tableInfo.pkFields.map((pk) => aliasBySource.get(pk.toLowerCase()) ?? pk.toLowerCase());

  interface ResolvedColumn {
    alias: string;
    field: SeniorField;
    mapped: ReturnType<typeof mapSeniorType>;
  }

  const resolved: ResolvedColumn[] = [];
  for (const column of columns) {
    const field = fieldByName.get(column.source.toLowerCase())!;
    const mapped = mapSeniorType(field);
    if (mapped.prismaType === "Bytes") {
      console.warn(`AVISO: coluna "${column.alias}" (binário/blob) foi ignorada — tipo não suportado por este gerador.`);
      continue;
    }
    if (mapped.note) {
      console.warn(`AVISO [${column.alias}]: ${mapped.note}`);
    }
    resolved.push({ alias: column.alias, field, mapped });
  }

  // ---------- Model Prisma ----------
  const pkFieldsLower = pkAliases;
  const isComposite = pkFieldsLower.length > 1;

  const checkConstraints: { column: string; values: string[] }[] = [];
  const modelLines: string[] = [];

  for (const { alias, field, mapped } of resolved) {
    const optional = field.cannul === 1 && !pkFieldsLower.includes(alias.toLowerCase());
    let line = `  ${alias} ${mapped.prismaType}${optional ? "?" : ""}`;
    if (!isComposite && pkFieldsLower.length === 1 && pkFieldsLower[0] === alias.toLowerCase()) {
      line += " @id";
    }
    if (mapped.dbAnnotation) {
      line += ` ${mapped.dbAnnotation}`;
    }

    if (field.enunam) {
      const domainValues = await getFieldDomainValues(field.enunam);
      if (domainValues.length > 0) {
        const values = domainValues.map((d) => d.keynam);
        checkConstraints.push({ column: alias, values });
        modelLines.push(
          `  /// Domínio "${field.enunam}": ${domainValues.map((d) => `${d.keynam}=${d.valkey}`).join(", ")}`
        );
      }
    }
    modelLines.push(line);
  }

  const modelHeaderComment = tableInfo.destbl
    ? `// Espelho local da tabela ${tableName.toUpperCase()} do Senior ERP (${tableInfo.destbl}).`
    : `// Espelho local da tabela ${tableName.toUpperCase()} do Senior ERP.`;

  const idLine = isComposite ? `\n  @@id([${pkAliases.join(", ")}])` : "";

  // Colunas da detecção de exclusão no Senior (ver src/sync/varrerRemovidos.ts). Toda
  // tabela espelho nasce com elas: sem isso a tabela nova fica cega pra exclusão e
  // ninguém lembra de acrescentar depois. Sem índice de propósito — `visto_em_sync` é
  // reescrita em todas as linhas a cada sync, e o Prisma não expressa índice parcial.
  const colunasVarredura = `
  // Carimbo da execução de sync que viu esta linha na origem pela última vez. NULL =
  // nunca vista por uma sync. A varredura compara com \`lt\` estrito, e \`NULL < x\` é NULL
  // em SQL — linha nunca carimbada é imune por construção, o que protege registro que
  // nasça no CaxHub em vez de vir do Senior.
  vistoEmSync      DateTime? @map("visto_em_sync") @db.Timestamptz(6)
  // Quando a varredura constatou que a linha sumiu da origem. NULL = viva. Volta a NULL
  // sozinho se a linha reaparecer, porque todo upsert grava NULL aqui. Nunca há DELETE.
  removidoEmSenior DateTime? @map("removido_em_senior") @db.Timestamptz(6)`;

  const modelBlock = `
${modelHeaderComment}
model ${modelName} {
${modelLines.join("\n")}${colunasVarredura}${idLine}

  @@map("${localTableName}")
}
`;

  fs.appendFileSync(SCHEMA_PATH, modelBlock);
  console.log(`Model "${modelName}" adicionado em ${SCHEMA_PATH}`);

  // ---------- Constraint SQL ----------
  if (checkConstraints.length > 0) {
    fs.mkdirSync(CONSTRAINTS_DIR, { recursive: true });
    const constraintSqlPath = path.join(CONSTRAINTS_DIR, `${localTableName}.sql`);
    const sql = checkConstraints
      .map(({ column, values }) => {
        const valuesList = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
        return `ALTER TABLE "${localTableName}" ADD CONSTRAINT "chk_${localTableName}_${column}" CHECK ("${column}" IN (${valuesList}));`;
      })
      .join("\n");
    fs.writeFileSync(constraintSqlPath, sql + "\n");
    console.log(`Constraints CHECK geradas em ${constraintSqlPath}`);
  }

  // ---------- Job de sync ----------
  const jobName = `${localTableName}-sync`;
  const syncFileName = `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}Sync.ts`;
  const syncFilePath = path.join(SYNC_DIR, syncFileName);

  const interfaceFields = resolved
    .map(({ alias, field, mapped }) => {
      const optional = field.cannul === 1 ? "?" : "";
      return `  ${alias}${optional}: ${tsInterfaceType(mapped.prismaType)};`;
    })
    .join("\n");

  const resolvedByAlias = new Map(resolved.map((r) => [r.alias.toLowerCase(), r]));
  const pkValueExpr = (pkAlias: string) => {
    const pkMapped = resolvedByAlias.get(pkAlias)?.mapped.prismaType ?? "String";
    return upsertValueExpr(pkMapped, `row.${pkAlias}`, false);
  };

  const pkWhere = isComposite
    ? `${pkAliases.join("_")}: { ${pkAliases.map((a) => `${a}: ${pkValueExpr(a)}`).join(", ")} }`
    : `${pkAliases[0]}: ${pkValueExpr(pkAliases[0])}`;

  const dataAssignments = resolved
    .map(({ alias, field, mapped }) => {
      const optional = field.cannul === 1 && !pkFieldsLower.includes(alias.toLowerCase());
      return `${alias}: ${upsertValueExpr(mapped.prismaType, `row.${alias}`, optional)}`;
    })
    .join(", ");

  const modelAccessor = `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`;

  const orderByColumns = pkAliases.map((a) => `"${a}"`).join(", ");

  const syncFileContent = `import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { carimbo } from "./varrerRemovidos";

const JOB_NAME = "${jobName}";
const QUERY = \`${query.replace(/`/g, "\\`")}\`;

interface ${modelName}Row {
${interfaceFields}
}

export async function run${modelName}Sync(): Promise<void> {
  // Instante da execução, carimbado em toda linha vista nesta rodada — é o que permite
  // descobrir depois quem NÃO veio (ver src/sync/varrerRemovidos.ts). Tem que ser
  // capturado antes do primeiro upsert.
  const inicio = new Date();
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, [${orderByColumns}])) as ${modelName}Row[];

    for (const row of rows) {
      const data = { ${dataAssignments}, ...carimbo(inicio) };
      await prisma.${modelAccessor}.upsert({
        where: { ${pkWhere} },
        update: data,
        create: data,
      });
    }

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — vem comentada de
    // propósito: ligar a varredura exige duas decisões que um gerador não tem como
    // adivinhar, e o default de politicaVarredura.ts é "desligada" justamente pra tabela
    // nova nunca começar a marcar registro sozinha.
    //   1. ESCOPO — precisa excluir registro nascido no CaxHub, se esta tabela for de mão
    //      dupla (ex.: { origemCaxHub: false }), senão ele é acusado de removido.
    //   2. CONTAGEM NA ORIGEM — tem que repetir exatamente o mesmo FROM/WHERE da QUERY
    //      acima, incluindo filtro aplicado às linhas dentro do laço, senão a guarda
    //      acusa truncamento onde não houve.
    //
    // Pra ligar: descomentar o bloco, acrescentar aos imports
    //   import { Prisma } from "@prisma/client";
    //   import { carimbo, varrerRemovidos } from "./varrerRemovidos";
    // e registrar o JOB_NAME em src/sync/politicaVarredura.ts começando por "simular" —
    // nunca direto em "marcar", sem antes conferir os detectados contra o ERP.
    //
    // const varredura = await varrerRemovidos<Prisma.${modelName}WhereInput>(prisma.${modelAccessor}, {
    //   jobName: JOB_NAME,
    //   inicio,
    //   linhasProcessadas: rows.length,
    //   escopo: {},
    //   queryContagemOrigem: \`SELECT COUNT(*) AS total FROM ${tableName}\`,
    // });

    await prisma.syncLog.create({
      // Ao ligar a varredura, acrescentar aqui pra ela aparecer no painel:
      //   message: varredura.resumo,
      //   varreduraModo: varredura.modo,
      //   varreduraDetectados: varredura.candidatos,
      //   varreduraInicio: inicio,
      data: { jobName: JOB_NAME, query: QUERY, status: "success" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "error", message },
    });
    console.error(\`[\${JOB_NAME}] falhou:\`, message);
  }
}

// Ajustar o horário conforme a necessidade real de atualização desta tabela.
export function schedule${modelName}Sync(): void {
  cron.schedule("0 4 * * *", run${modelName}Sync);
}
`;

  fs.writeFileSync(syncFilePath, syncFileContent);
  console.log(`Job de sync gerado em ${syncFilePath}`);

  // ---------- Checklist final ----------
  console.log("\n--- Próximos passos manuais ---");
  console.log("1. Parar o backend (npm run dev) antes de rodar o Prisma, senão dá EPERM no Windows.");
  console.log("2. cd backend && npx prisma db push");
  if (checkConstraints.length > 0) {
    console.log(
      `3. Aplicar as constraints: npx prisma db execute --file prisma/constraints/${localTableName}.sql --schema prisma/schema.prisma`
    );
  }
  console.log(
    `4. Registrar em backend/src/server.ts: importar { schedule${modelName}Sync } de "./sync/${syncFileName.replace(".ts", "")}" e chamar schedule${modelName}Sync() dentro do app.listen(...).`
  );
  console.log("5. Rodar o job manualmente uma vez pra validar com dado real antes de confiar no agendamento.");
  console.log(
    "6. Detecção de exclusão no Senior: o model e o job já nascem com as colunas e o carimbo, mas a varredura vem COMENTADA. Pra ligar, seguir as instruções no próprio job gerado e acrescentar a tabela em src/sync/politicaVarredura.ts começando por \"simular\"."
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
