import type { ReactNode } from "react";
import { ParDatasFiltro } from "../ui/ControlesFiltro";
import { ClienteFilter, ClienteOption } from "./ClienteFilter";
import { PortadorFilter, PortadorOption } from "./PortadorFilter";
import { EmpresaFilialFilter, EmpresaOption, FilialOption } from "./EmpresaFilialFilter";

export interface FiltroOpcoes {
  empresas: EmpresaOption[];
  filiais: FilialOption[];
  portadores: PortadorOption[];
}

export interface Filtros {
  clientes: ClienteOption[];
  empresasFiliais: string[];
  situacao: string[];
  portadores: string[];
  vctproInicio: string | null;
  vctproFim: string | null;
  datemiInicio: string | null;
  datemiFim: string | null;
}

interface FiltrosBarProps {
  opcoes: FiltroOpcoes | null;
  filtros: Filtros;
  onChange: (filtros: Filtros) => void;
  /** Estrela de padrão de cada filtro (campo: clientes/fornecedores, empFil, portadores, vencimento, emissao). */
  estrela?: (campo: string) => ReactNode;
}

export function FiltrosBar({ opcoes, filtros, onChange, estrela }: FiltrosBarProps) {
  return (
    <div className="mb-6 flex flex-col gap-3">
    <div className="flex flex-wrap items-center gap-3">
      <ClienteFilter selecionados={filtros.clientes} onChange={(clientes) => onChange({ ...filtros, clientes })} acessorio={estrela?.("clientes")} />

      <EmpresaFilialFilter
        empresas={opcoes?.empresas ?? []}
        filiais={opcoes?.filiais ?? []}
        selecionados={filtros.empresasFiliais}
        onChange={(empresasFiliais) => onChange({ ...filtros, empresasFiliais })}
        acessorio={estrela?.("empFil")}
      />

      <PortadorFilter
        opcoes={opcoes?.portadores ?? []}
        selecionados={filtros.portadores}
        onChange={(portadores) => onChange({ ...filtros, portadores })}
        acessorio={estrela?.("portadores")}
      />
    </div>

    <div className="flex flex-wrap items-center gap-3">
      <ParDatasFiltro
        rotulo="Vencimento"
        de={filtros.vctproInicio ?? ""}
        ate={filtros.vctproFim ?? ""}
        onDe={(v) => onChange({ ...filtros, vctproInicio: v || null })}
        onAte={(v) => onChange({ ...filtros, vctproFim: v || null })}
        acessorio={estrela?.("vencimento")}
      />
      <ParDatasFiltro
        rotulo="Emissão"
        de={filtros.datemiInicio ?? ""}
        ate={filtros.datemiFim ?? ""}
        onDe={(v) => onChange({ ...filtros, datemiInicio: v || null })}
        onAte={(v) => onChange({ ...filtros, datemiFim: v || null })}
        acessorio={estrela?.("emissao")}
      />
    </div>
    </div>
  );
}
