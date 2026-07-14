import { runSqlViaSoap } from "./client";

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
     FROM r996fld
     WHERE tblnam = '${tblnam.toUpperCase()}'
     ORDER BY fldord`
  );
  return rows as SeniorField[];
}

/** Busca a descrição e os campos de chave primária de uma tabela (r996tbl). `pkflds` é separado por ";". */
export async function getTableInfo(tblnam: string): Promise<SeniorTableInfo> {
  const rows = (await runSqlViaSoap(
    `SELECT destbl AS destbl, pkflds AS pkflds FROM r996tbl WHERE tblnam = '${tblnam.toUpperCase()}'`
  )) as { destbl: string | null; pkflds: string | null }[];

  const row = rows[0];
  if (!row) {
    throw new Error(`Tabela "${tblnam}" não encontrada em r996tbl`);
  }

  return {
    destbl: row.destbl,
    pkFields: (row.pkflds ?? "").split(";").map((f) => f.trim()).filter(Boolean),
  };
}

/** Busca os valores válidos (domínio) de um campo, ex. lstnam="LJurFis" -> [{keynam:"J",...}, {keynam:"F",...}]. */
export async function getFieldDomainValues(lstnam: string): Promise<SeniorDomainValue[]> {
  const rows = await runSqlViaSoap(
    `SELECT keynam AS keynam, valkey AS valkey, keyord AS keyord FROM r996lsf WHERE lstnam = '${lstnam}' ORDER BY keyord`
  );
  return rows as SeniorDomainValue[];
}
