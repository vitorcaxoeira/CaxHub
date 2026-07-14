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

  const tableInfo = await getTableInfo(tableName);
  const selectedAliases = new Set(columns.map((c) => c.alias.toLowerCase()));
  const missingPkFields = tableInfo.pkFields.filter((pk) => !selectedAliases.has(pk.toLowerCase()));
  if (missingPkFields.length > 0) {
    console.warn(
      `AVISO: a chave primária real de "${tableName}" inclui ${tableInfo.pkFields.join(", ")}, mas a query não selecionou: ${missingPkFields.join(", ")}. O upsert do job de sync pode ficar incorreto.`
    );
  }

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
  const pkFieldsLower = tableInfo.pkFields.map((f) => f.toLowerCase());
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

  const idLine = isComposite ? `\n  @@id([${tableInfo.pkFields.map((f) => f.toLowerCase()).join(", ")}])` : "";

  const modelBlock = `
${modelHeaderComment}
model ${modelName} {
${modelLines.join("\n")}${idLine}

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
  const pkValueExpr = (fieldName: string) => {
    const pkAlias = fieldName.toLowerCase();
    const pkMapped = resolvedByAlias.get(pkAlias)?.mapped.prismaType ?? "String";
    return upsertValueExpr(pkMapped, `row.${pkAlias}`, false);
  };

  const pkWhere = isComposite
    ? `${pkFieldsLower.join("_")}: { ${tableInfo.pkFields
        .map((f) => `${f.toLowerCase()}: ${pkValueExpr(f)}`)
        .join(", ")} }`
    : `${pkFieldsLower[0]}: ${pkValueExpr(tableInfo.pkFields[0])}`;

  const dataAssignments = resolved
    .map(({ alias, field, mapped }) => {
      const optional = field.cannul === 1 && !pkFieldsLower.includes(alias.toLowerCase());
      return `${alias}: ${upsertValueExpr(mapped.prismaType, `row.${alias}`, optional)}`;
    })
    .join(", ");

  const modelAccessor = `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`;

  const orderByColumns = tableInfo.pkFields.map((f) => `"${f.toLowerCase()}"`).join(", ");

  const syncFileContent = `import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

const JOB_NAME = "${jobName}";
const QUERY = \`${query.replace(/`/g, "\\`")}\`;

interface ${modelName}Row {
${interfaceFields}
}

export async function run${modelName}Sync(): Promise<void> {
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, [${orderByColumns}])) as ${modelName}Row[];

    for (const row of rows) {
      const data = { ${dataAssignments} };
      await prisma.${modelAccessor}.upsert({
        where: { ${pkWhere} },
        update: data,
        create: data,
      });
    }

    await prisma.syncLog.create({
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
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
