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
}

function dateInputClass() {
  return "rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
}

export function FiltrosBar({ opcoes, filtros, onChange }: FiltrosBarProps) {
  return (
    <div className="mb-6 flex flex-col gap-3">
    <div className="flex flex-wrap items-center gap-3">
      <ClienteFilter selecionados={filtros.clientes} onChange={(clientes) => onChange({ ...filtros, clientes })} />

      <EmpresaFilialFilter
        empresas={opcoes?.empresas ?? []}
        filiais={opcoes?.filiais ?? []}
        selecionados={filtros.empresasFiliais}
        onChange={(empresasFiliais) => onChange({ ...filtros, empresasFiliais })}
      />

      <PortadorFilter
        opcoes={opcoes?.portadores ?? []}
        selecionados={filtros.portadores}
        onChange={(portadores) => onChange({ ...filtros, portadores })}
      />
    </div>

    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">Vencimento:</span>
        <input
          type="date"
          className={dateInputClass()}
          value={filtros.vctproInicio ?? ""}
          onChange={(e) => onChange({ ...filtros, vctproInicio: e.target.value || null })}
        />
        <span className="text-sm text-muted">até</span>
        <input
          type="date"
          className={dateInputClass()}
          value={filtros.vctproFim ?? ""}
          onChange={(e) => onChange({ ...filtros, vctproFim: e.target.value || null })}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">Emissão:</span>
        <input
          type="date"
          className={dateInputClass()}
          value={filtros.datemiInicio ?? ""}
          onChange={(e) => onChange({ ...filtros, datemiInicio: e.target.value || null })}
        />
        <span className="text-sm text-muted">até</span>
        <input
          type="date"
          className={dateInputClass()}
          value={filtros.datemiFim ?? ""}
          onChange={(e) => onChange({ ...filtros, datemiFim: e.target.value || null })}
        />
      </div>
    </div>
    </div>
  );
}
