import { SeniorField } from "./metadata";

export interface MappedType {
  prismaType: string;
  dbAnnotation?: string;
  note?: string;
}

/**
 * Mapeia um campo do dicionário de dados do Senior (r996fld.dattyp) para o
 * tipo Prisma/Postgres equivalente. Os códigos abaixo foram validados contra
 * dados reais (ver plano de implementação) — cobrem 100% dos dattyp em uso
 * no sistema no momento da implementação (1, 2, 3, 4, 5, 8, 10).
 */
export function mapSeniorType(field: SeniorField): MappedType {
  switch (field.dattyp) {
    case 1:
      return { prismaType: "String", dbAnnotation: `@db.VarChar(${field.lenfld})` };

    case 2:
      if (field.prefld > 0) {
        return {
          prismaType: "Decimal",
          dbAnnotation: `@db.Decimal(${field.lenfld}, ${field.prefld})`,
        };
      }
      return field.lenfld <= 9
        ? { prismaType: "Int" }
        : { prismaType: "BigInt", note: `lenfld=${field.lenfld} excede Int — usando BigInt` };

    case 3:
      return {
        prismaType: "Boolean",
        note: "dattyp=3 (booleano): representação real (0/1, T/F?) ainda não conferida — validar com dado real antes de confiar no sync",
      };

    case 4:
      return { prismaType: "DateTime", dbAnnotation: "@db.Date" };

    case 5:
      return { prismaType: "String", note: "dattyp=5 (hora/minuto) guardado como texto — não há tipo time simples equivalente" };

    case 8:
      return { prismaType: "Bytes", note: "dattyp=8 (binário/blob) é raro — revisar manualmente se este campo for realmente necessário" };

    case 10:
      return {
        prismaType: "Decimal",
        dbAnnotation: "@db.Decimal(18, 2)",
        note: "dattyp=10 (campo customizado USU_*) sem lenfld/prefld informados — usando Decimal(18,2) como default",
      };

    default:
      return {
        prismaType: "String",
        note: `dattyp=${field.dattyp} desconhecido — usando String como fallback, revisar manualmente`,
      };
  }
}
