import type { Dispatch, SetStateAction } from "react";
import { campoEmpFil, campoListaFixa, campoParDatas } from "../ui/padroesFiltros/campos";
import { regras } from "../ui/padroesFiltros/regras";
import type { DefCampo } from "../ui/padroesFiltros/usePadroesTela";
import { SITUACOES } from "./SituacaoFilter";

// Padrão de cada filtro (estrela) das telas de títulos (Contas a Receber / Contas a Pagar), que têm a mesma forma de filtros:
// cliente/fornecedor escolhidos, empresa/filial, portadores, situação (tabela) e os pares Vencimento e Emissão.

interface FiltrosTitulos {
  empresasFiliais: string[];
  situacao: string[];
  portadores: string[];
  vctproInicio: string | null;
  vctproFim: string | null;
  datemiInicio: string | null;
  datemiFim: string | null;
}

interface OpcoesTitulos {
  filiais: { codemp: number; codfil: number }[];
  portadores: { codpor: string }[];
}

export function camposTitulos<F extends FiltrosTitulos>(
  filtros: F,
  setFiltros: Dispatch<SetStateAction<F>>,
  opcoes: OpcoesTitulos | null,
  parceiro: { campo: "clientes" | "fornecedores"; rotulo: string; chave: string }
): Record<string, DefCampo> {
  return {
    [parceiro.campo]: {
      rotulo: parceiro.rotulo,
      atual: (filtros as unknown as Record<string, unknown>)[parceiro.campo],
      aplicar: (v: never) => setFiltros((f) => ({ ...f, [parceiro.campo]: v })),
      validar: regras.listaObjetos(parceiro.chave),
      semOpcoes: true,
    },
    empFil: campoEmpFil(filtros.empresasFiliais, (v) => setFiltros((f) => ({ ...f, empresasFiliais: v })), opcoes?.filiais),
    portadores: {
      rotulo: "Portador",
      atual: filtros.portadores,
      aplicar: (v: string[]) => setFiltros((f) => ({ ...f, portadores: v })),
      validar: regras.lista("string", opcoes?.portadores.map((p) => p.codpor)),
    },
    situacao: campoListaFixa("Situação", "string", filtros.situacao, (v) => setFiltros((f) => ({ ...f, situacao: v })), SITUACOES.map((s) => s.value)),
    vencimento: campoParDatas("Vencimento", filtros.vctproInicio, filtros.vctproFim, (de, ate) => setFiltros((f) => ({ ...f, vctproInicio: de, vctproFim: ate }))),
    emissao: campoParDatas("Emissão", filtros.datemiInicio, filtros.datemiFim, (de, ate) => setFiltros((f) => ({ ...f, datemiInicio: de, datemiFim: ate }))),
  };
}
