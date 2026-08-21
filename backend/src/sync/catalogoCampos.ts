// Catálogo de campos filtráveis por job de sincronização — Fase 2 do plano de filtros na
// importação (~/.claude/plans/se-liga-na-necessidade-resilient-lark.md). Só leitura: não
// aplica filtro nenhum ainda (isso é Fase 3), só descreve o que existe e qual o tipo de cada
// campo, pros dois caminhos decididos com o Vitor (21/08/2026):
//   1. `camposEspelhados` — instantâneo, sem SOAP, a partir de `job.colunas` (a própria
//      SELECT do job) cruzado com o schema Prisma local (`job.tabelaLocal`). É o que a tela
//      mostra por padrão ao expandir uma linha.
//   2. `camposErp` — sob demanda ("ver todos os campos do ERP"), 1 round-trip SOAP
//      (getTableFields, cacheado — ver soap/metadataCache.ts) trazendo TODO campo da tabela
//      no Senior, espelhado ou não, com tipo/nulabilidade/domínio vindos do dicionário real.
import { Prisma } from "@prisma/client";
import { getTableFields, getFieldDomainValues, SeniorField } from "../soap/metadata";
import { mapSeniorType } from "../soap/typeMapping";
import { comCache } from "../soap/metadataCache";
// `import type`: só usado como anotação de tipo abaixo. Desde a Fase 5, este módulo passou a
// ser importado por sync/filtrosAtivos.ts (pra `campoLocal`), que por sua vez é importado por
// TODOS os 35 jobs de sync que registry.ts importa — um `import` de VALOR aqui fecharia
// exatamente o ciclo (registry -> qualquer job -> filtrosAtivos -> catalogoCampos -> registry)
// que já derrubou o boot uma vez na Fase 3 (ver [[import-circular-quebra-array-eager]] no
// segundo cérebro). `import type` é sempre apagado na compilação, não deixa `require()`
// nenhum pra trás capaz de fechar o ciclo.
import type { SyncJobDescriptor } from "./registry";

export interface CampoCatalogo {
  // Nome de ORIGEM no Senior — o que o WHERE do filtro (Fase 3) precisa usar, nunca o alias
  // (ver montarQuerySenior/Fase 1: 13 dos 35 jobs têm alias diferente da origem).
  origem: string;
  // Nome espelhado localmente (schema.prisma), quando este campo já é sincronizado hoje.
  // Vazio quando o campo só existe no Senior (só aparece via camposErp).
  alias: string | null;
  espelhado: boolean;
  // Tipo Prisma ("String", "Int", "BigInt", "Decimal", "DateTime", "Boolean", "Bytes") — null
  // quando não foi possível determinar (ex.: campo espelhado sem correspondência exata no
  // schema local, caso do único campo do projeto sem @map, ver nota em registry.ts).
  tipoPrisma: string | null;
  // null = não determinado. Em camposEspelhados vem do schema local; em camposErp vem de
  // `cannul` do dicionário do Senior.
  nullable: boolean | null;
  // Descrição do campo (`desfld`) — só preenchida pela fonte=erp, o schema local não guarda isso.
  descricao: string | null;
  // Nome do domínio (`enunam`), quando o campo é uma lista fechada de valores — só pela
  // fonte=erp. `valoresDominio` só vem preenchido quando o catálogo já buscou os valores
  // (camposErp busca pra todo campo com domínio, em paralelo).
  dominio: string | null;
  valoresDominio: { chave: string; rotulo: string }[] | null;
  // Nota de cautela repassada de mapSeniorType (ex.: dattyp=3 nunca confirmado com dado real)
  // ou gerada aqui (campo espelhado sem match no schema local).
  observacao: string | null;
}

// --- Caminho 1: instantâneo, a partir do schema local (sem SOAP) -----------------------

// Exportado pra sync/filtrosAtivos.ts reaproveitar (Fase 5, recorte retroativo) — o `where`
// local do Prisma precisa do tipo REAL do schema, não do tipo que o dicionário do Senior
// reporta: um campo de domínio (categoria "dominio" em filtroSenior.ts) pode ser Int por
// baixo (ex.: `sitped`) ou String (ex.: um domínio de sigla) — só o schema local sabe qual.
export function campoLocal(tabelaLocal: string, coluna: string): { tipo: string; nullable: boolean } | null {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.dbName === tabelaLocal);
  if (!model) return null;
  // Casa pelo nome de coluna REAL no Postgres: `dbName` quando o campo tem `@map`, senão o
  // próprio nome do campo (é o caso do único campo do projeto sem @map — Rat.dataApr — que
  // por isso não bate com o alias em minúsculas da query e fica sem match aqui, de propósito).
  const field = model.fields.find((f) => (f.dbName ?? f.name) === coluna);
  if (!field || field.kind !== "scalar") return null;
  return { tipo: field.type, nullable: !field.isRequired };
}

export function camposEspelhados(job: SyncJobDescriptor): CampoCatalogo[] {
  return job.colunas.map((coluna) => {
    const local = campoLocal(job.tabelaLocal, coluna.alias);
    return {
      origem: coluna.origem,
      alias: coluna.alias,
      espelhado: true,
      tipoPrisma: local?.tipo ?? null,
      nullable: local?.nullable ?? null,
      descricao: null,
      dominio: null,
      valoresDominio: null,
      observacao: local
        ? null
        : `Coluna espelhada mas não localizada no schema Prisma de "${job.tabelaLocal}" — provavelmente o campo sem @map do projeto (ver Rat.dataApr); confira o tipo em "ver todos os campos do ERP".`,
    };
  });
}

// --- Caminho 2: sob demanda, a partir do dicionário real do Senior ---------------------

export interface ResultadoCamposErp {
  temDicionario: boolean;
  campos: CampoCatalogo[];
}

export async function camposErp(job: SyncJobDescriptor): Promise<ResultadoCamposErp> {
  if (!job.temDicionario) {
    // USU_VBI00Cons/USU_VBI01CTRCS: views de BI sem registro em r996tbl/r998tbl. Devolver
    // lista vazia seria ambíguo (pareceria "tabela sem campos"); melhor ser explícito.
    return { temDicionario: false, campos: [] };
  }

  const origensEspelhadas = new Set(job.colunas.map((c) => c.origem.toLowerCase()));
  const fields = await comCache(`campos:${job.tabelaSenior}`, () => getTableFields(job.tabelaSenior));

  // Domínio (lista fechada de valores) só existe pra campo com `enunam` preenchido — busca em
  // paralelo, uma vez por lstnam distinto (vários campos podem repetir o mesmo domínio, ex.
  // "LSitTit" usado em mais de uma tabela). Cacheado igual aos campos.
  const dominiosNomes = [...new Set(fields.map((f) => f.enunam).filter((n): n is string => !!n))];
  const dominios = await Promise.all(
    dominiosNomes.map(async (nome) => [nome, await comCache(`dominio:${nome}`, () => getFieldDomainValues(nome))] as const)
  );
  const valoresPorDominio = new Map(dominios);

  const campos: CampoCatalogo[] = fields.map((field: SeniorField) => {
    const mapeado = mapSeniorType(field);
    const alias = job.colunas.find((c) => c.origem.toLowerCase() === field.fldnam.toLowerCase())?.alias ?? null;
    const valores = field.enunam ? valoresPorDominio.get(field.enunam) : undefined;
    return {
      origem: field.fldnam,
      alias,
      espelhado: origensEspelhadas.has(field.fldnam.toLowerCase()),
      tipoPrisma: mapeado.prismaType,
      nullable: field.cannul === 1,
      descricao: field.desfld,
      dominio: field.enunam,
      valoresDominio: valores ? valores.map((v) => ({ chave: v.keynam, rotulo: v.valkey })) : null,
      observacao: mapeado.note ?? null,
    };
  });

  return { temDicionario: true, campos };
}
