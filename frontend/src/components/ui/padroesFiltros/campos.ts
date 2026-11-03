import { PRESETS_PERIODO, type PeriodoEstado } from "../../../utils/periodo";
import type { DefCampo } from "./usePadroesTela";
import { regras, valorDoPeriodo } from "./regras";

// Definições de campo que se repetem em várias telas (padrão de cada filtro, 03/11/2026). O nome do campo é escolhido por quem usa.

type Filial = { codemp: number; codfil: number };

/** Empresa/filial ("codemp:codfil"): vale o que ainda existe nas opções. */
export function campoEmpFil(atual: string[], aplicar: (v: string[]) => void, filiais?: readonly Filial[], rotulo = "Empresa/filial"): DefCampo {
  return { rotulo, atual, aplicar, validar: regras.lista("string", filiais?.map((f) => `${f.codemp}:${f.codfil}`)) };
}

/** Período do SeletorPeriodo: o preset relativo, ou as datas fixas se estiver "Personalizado". */
export function campoPeriodo(periodo: PeriodoEstado, rotulo = "Período"): DefCampo {
  return {
    rotulo,
    atual: valorDoPeriodo(periodo),
    aplicar: periodo.definir,
    validar: regras.periodo(PRESETS_PERIODO.map((p) => p.valor)),
    semOpcoes: true,
    ordem: true,
  };
}

/** Lista de valores de opções fixas na própria tela (não vêm do servidor): aplica sem esperar. */
export function campoListaFixa<T extends string | number>(
  rotulo: string,
  tipo: "string" | "number",
  atual: T[],
  aplicar: (v: T[]) => void,
  existentes: readonly T[]
): DefCampo {
  return { rotulo, atual, aplicar, validar: regras.lista(tipo, existentes), semOpcoes: true };
}

/** Par De/Até de datas AAAA-MM-DD (null = sem data). */
export function campoParDatas(rotulo: string, de: string | null, ate: string | null, aplicar: (de: string | null, ate: string | null) => void): DefCampo {
  return {
    rotulo,
    atual: [de ?? "", ate ?? ""],
    aplicar: ([d, a]: [string, string]) => aplicar(d || null, a || null),
    validar: regras.parDatas(),
    semOpcoes: true,
    ordem: true,
  };
}
