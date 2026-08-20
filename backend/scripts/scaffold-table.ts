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

// Cast SQL explícito por tipo Prisma, usado pelo upsert em lote (sync/upsertEmLote.ts).
// String vira sempre "text", NUNCA o varchar(N) declarado na coluna — cast largo pra coluna
// estreita preserva o erro de truncamento (22001) em vez de truncar em silêncio (mesma razão
// de codccu::text em vez de ::varchar(9), ver upsertEmLote.ts).
function sqlCast(prismaType: string): string {
  switch (prismaType) {
    case "Int":
      return "int";
    case "BigInt":
      return "bigint";
    case "Decimal":
      return "numeric";
    case "Boolean":
      return "boolean";
    case "DateTime":
      // mapSeniorType só produz DateTime com @db.Date (dattyp=4) — nunca Timestamptz pra
      // coluna de dado (Timestamptz é só pro carimbo de varredura, à parte).
      return "date";
    case "String":
    default:
      return "text";
  }
}

// Valor já formatado como string (ou null) pronto pro upsert em lote — nunca number/bigint/
// Date cru (tira BigInt/Decimal/Date do caminho de serialização do driver, ver
// upsertEmLote.ts). `!= null` (não `!== undefined`) trata ausência de chave e null da mesma
// forma — os dois colapsam pra null explícito.
function upsertLoteValueExpr(mapped: { prismaType: string }, field: SeniorField, accessor: string, optional: boolean): string {
  if (mapped.prismaType === "BigInt" || mapped.prismaType === "Int" || mapped.prismaType === "Boolean") {
    return optional ? `${accessor} != null ? String(${accessor}) : null` : `String(${accessor})`;
  }
  if (mapped.prismaType === "Decimal") {
    // prefld = casas decimais reais do campo no Senior; dattyp=10 (customizado) não informa
    // prefld, por isso o default 2 (mesmo default de mapSeniorType pro Decimal(18,2)).
    const casas = field.prefld > 0 ? field.prefld : 2;
    return optional ? `${accessor} != null ? ${accessor}.toFixed(${casas}) : null` : `${accessor}.toFixed(${casas})`;
  }
  if (mapped.prismaType === "DateTime") {
    // String(v).slice(0,10), nunca new Date(v) — "2025-03-14" é UTC mas
    // "2025-03-14T00:00:00" é local, e em America/Sao_Paulo isso desloca o dia.
    return optional ? `${accessor} != null ? String(${accessor}).slice(0, 10) : null` : `String(${accessor}).slice(0, 10)`;
  }
  // String — já é string, só normaliza null/undefined. NÃO mapeia "" pra null: uma string
  // vazia pode ter significado próprio no domínio (ex.: despar em plano_contabil).
  return optional ? `${accessor} != null ? ${accessor} : null` : accessor;
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

  // Colunas do INSERT em lote (sync/upsertEmLote.ts), na ordem usada em LinhaUpsert.valores.
  const colunasLiteral = resolved
    .map(({ alias, mapped }) => `  { nome: "${alias}", cast: "${sqlCast(mapped.prismaType)}" },`)
    .join("\n");

  // Chave de dedup dentro do lote — concatenação dos valores de PK (ver upsertEmLote.ts:
  // ON CONFLICT derruba o lote inteiro se a mesma PK aparecer 2x no mesmo VALUES).
  const chaveExpr = "`" + pkAliases.map((a) => "${row." + a + "}").join("-") + "`";

  const valoresLiteral = resolved
    .map(({ alias, field, mapped }) => {
      const optional = field.cannul === 1 && !pkFieldsLower.includes(alias.toLowerCase());
      return `      ${upsertLoteValueExpr(mapped, field, `row.${alias}`, optional)},`;
    })
    .join("\n");

  const modelAccessor = `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`;

  const orderByColumns = pkAliases.map((a) => `"${a}"`).join(", ");
  const pkColunas = pkAliases.map((a) => `"${a}"`).join(", ");

  const syncFileContent = `import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";

const JOB_NAME = "${jobName}";
const QUERY = \`${query.replace(/`/g, "\\`")}\`;

interface ${modelName}Row {
${interfaceFields}
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores.
const COLUNAS: ColunaUpsert[] = [
${colunasLiteral}
];

function linhaDe(row: ${modelName}Row): LinhaUpsert {
  return {
    chave: ${chaveExpr},
    valores: [
${valoresLiteral}
    ],
  };
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
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(QUERY, [${orderByColumns}])) as ${modelName}Row[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "${localTableName}",
      colunas: COLUNAS,
      colunasPk: [${pkColunas}],
      carimbo: inicio,
    });
    const msEscrita = Date.now() - inicioEscrita;

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
    //   import { varrerRemovidos } from "./varrerRemovidos";
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
      //   message: \`\${resultado.linhasProcessadas} linhas em ...s — \${varredura.resumo}\`,
      //   varreduraModo: varredura.modo,
      //   varreduraDetectados: varredura.candidatos,
      //   varreduraInicio: inicio,
      data: {
        jobName: JOB_NAME,
        query: QUERY,
        status: "success",
        message:
          \`\${resultado.linhasProcessadas} linhas em \${((msFetch + msEscrita) / 1000).toFixed(1)}s \` +
          \`(fetch \${(msFetch / 1000).toFixed(1)}s, escrita \${(msEscrita / 1000).toFixed(1)}s, \${resultado.lotes} lotes)\`,
      },
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
