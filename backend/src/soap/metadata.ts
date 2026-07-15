import { runSqlViaSoap } from "./client";

/**
 * Objetos customizados pelo cliente no Senior (tabelas, campos e domínios com
 * prefixo "USU_") têm seus metadados no dicionário de dados r998* em vez do
 * r996* padrão. Detectamos isso pelo prefixo do nome para rotear a query certa.
 */
function metadataPrefix(name: string): "996" | "998" {
  return name.toUpperCase().startsWith("USU_") ? "998" : "996";
}

export interface SeniorField {
  fldnam: string;
  fldord: number;
  dattyp: number;
  lenfld: number;
  prefld: number;
  cannul: number;
  reqfld: string;
  enunam: string | null;
  desfld: string | null;
}

export interface SeniorTableInfo {
  destbl: string | null;
  pkFields: string[];
}

export interface SeniorDomainValue {
  keynam: string;
  valkey: string;
  keyord: number;
}

/** Busca os campos reais de uma tabela do Senior via o dicionário de dados (r996fld). */
export async function getTableFields(tblnam: string): Promise<SeniorField[]> {
  const rows = await runSqlViaSoap(
    `SELECT fldnam AS fldnam, fldord AS fldord, dattyp AS dattyp, lenfld AS lenfld,
            prefld AS prefld, cannul AS cannul, reqfld AS reqfld, enunam AS enunam, desfld AS desfld
     FROM r${metadataPrefix(tblnam)}fld
     WHERE tblnam = '${tblnam.toUpperCase()}'
     ORDER BY fldord`
  );
  return rows as SeniorField[];
}

/** Busca a descrição e os campos de chave primária de uma tabela (r996tbl). `pkflds` é separado por ";". */
export async function getTableInfo(tblnam: string): Promise<SeniorTableInfo> {
  const rows = (await runSqlViaSoap(
    `SELECT destbl AS destbl, pkflds AS pkflds FROM r${metadataPrefix(tblnam)}tbl WHERE tblnam = '${tblnam.toUpperCase()}'`
  )) as { destbl: string | null; pkflds: string | null }[];

  const row = rows[0];
  if (!row) {
    throw new Error(`Tabela "${tblnam}" não encontrada em r${metadataPrefix(tblnam)}tbl`);
  }

  return {
    destbl: row.destbl,
    pkFields: (row.pkflds ?? "").split(";").map((f) => f.trim()).filter(Boolean),
  };
}

/** Busca os valores válidos (domínio) de um campo, ex. lstnam="LJurFis" -> [{keynam:"J",...}, {keynam:"F",...}]. */
export async function getFieldDomainValues(lstnam: string): Promise<SeniorDomainValue[]> {
  const rows = await runSqlViaSoap(
    `SELECT keynam AS keynam, valkey AS valkey, keyord AS keyord FROM r${metadataPrefix(lstnam)}lsf WHERE lstnam = '${lstnam}' ORDER BY keyord`
  );
  return rows as SeniorDomainValue[];
}
