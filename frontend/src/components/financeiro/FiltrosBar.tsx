import { ClienteFilter, ClienteOption } from "./ClienteFilter";

export interface FiltroOpcoes {
  empresas: { codemp: number; nomemp: string }[];
  filiais: { codemp: number; codfil: number; nomfil: string }[];
}

export interface Filtros {
  clientes: ClienteOption[];
  codemp: number | null;
  codfil: number | null;
  situacao: string | null;
}

interface FiltrosBarProps {
  opcoes: FiltroOpcoes | null;
  filtros: Filtros;
  onChange: (filtros: Filtros) => void;
}

const SITUACOES = [
  { value: "AB", label: "Aberto Normal" },
  { value: "AP", label: "Aberto Protestado" },
  { value: "CO", label: "Aberto Cobrança" },
  { value: "LQ", label: "Liquidado Normal" },
  { value: "CA", label: "Cancelado" },
];

function selectClass() {
  return "rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
}

export function FiltrosBar({ opcoes, filtros, onChange }: FiltrosBarProps) {
  const filiaisDaEmpresa = opcoes?.filiais.filter((f) => filtros.codemp === null || f.codemp === filtros.codemp) ?? [];

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <ClienteFilter selecionados={filtros.clientes} onChange={(clientes) => onChange({ ...filtros, clientes })} />

      <select
        className={selectClass()}
        value={filtros.codemp ?? ""}
        onChange={(e) => onChange({ ...filtros, codemp: e.target.value ? Number(e.target.value) : null, codfil: null })}
      >
        <option value="">Todas as empresas</option>
        {opcoes?.empresas.map((emp) => (
          <option key={emp.codemp} value={emp.codemp}>
            {emp.nomemp}
          </option>
        ))}
      </select>

      <select
        className={selectClass()}
        value={filtros.codfil ?? ""}
        onChange={(e) => onChange({ ...filtros, codfil: e.target.value ? Number(e.target.value) : null })}
      >
        <option value="">Todas as filiais</option>
        {filiaisDaEmpresa.map((fil) => (
          <option key={`${fil.codemp}-${fil.codfil}`} value={fil.codfil}>
            {fil.nomfil}
          </option>
        ))}
      </select>

      <select
        className={selectClass()}
        value={filtros.situacao ?? ""}
        onChange={(e) => onChange({ ...filtros, situacao: e.target.value || null })}
      >
        <option value="">Todas as situações</option>
        {SITUACOES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
