import { useEffect, useRef, useState } from "react";
import { StatusNo } from "../../lib/cronograma";
import { MultiSelectDropdown } from "../ui/MultiSelectDropdown";

const OPCOES_STATUS: { value: StatusNo; label: string }[] = [
  { value: "nao_iniciada", label: "Não iniciada" },
  { value: "em_curso", label: "Em curso" },
  { value: "bloqueada", label: "Bloqueada" },
  { value: "concluida", label: "Concluída" },
];

export interface FiltrosCronograma {
  status: StatusNo[];
  responsaveis: number[];
  somenteAtraso: boolean;
  // Item com distribuído ou realizado acima do contratado (ver estadoAlertaItem).
  somenteExcedidos: boolean;
  // Item com realizado acima do distribuído, ainda dentro do contratado.
  realizadoAcimaPrevisto: boolean;
}

// Resumo de itens em algum estado de alerta — alimenta o chip clicável da barra
// (ver ArvoreCronograma). `temExcedido`/`temRealAcima` dizem qual filtro o chip aplica:
// o mais grave presente sempre vence (excedido > realizado acima do previsto).
export interface ResumoAlertasOrcamento {
  total: number;
  temExcedido: boolean;
  temRealAcima: boolean;
}

interface BarraFerramentasProps {
  buscaInicial: string;
  onBuscaChange: (valor: string) => void;
  tudoExpandido: boolean;
  onToggleExpandirTudo: () => void;
  responsaveisDisponiveis: { codfor: number; nome: string }[];
  filtros: FiltrosCronograma;
  onFiltrosChange: (filtros: FiltrosCronograma) => void;
  visao: "lista" | "gantt";
  onVisaoChange: (visao: "lista" | "gantt") => void;
  // Cria pasta raiz (agrupa itens da proposta entre si) — ausente = usuário sem
  // permissão pra gerenciar a proposta inteira (ver podeGerenciarProposta no backend).
  onNovaPastaRaiz?: () => void;
  resumoAlertas: ResumoAlertasOrcamento;
}

export function BarraFerramentas({
  buscaInicial,
  onBuscaChange,
  tudoExpandido,
  onToggleExpandirTudo,
  responsaveisDisponiveis,
  filtros,
  onFiltrosChange,
  visao,
  onVisaoChange,
  onNovaPastaRaiz,
  resumoAlertas,
}: BarraFerramentasProps) {
  const [buscaLocal, setBuscaLocal] = useState(buscaInicial);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function alterarBusca(valor: string) {
    setBuscaLocal(valor);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onBuscaChange(valor), 250);
  }

  useEffect(() => {
    function aoClicarFora(evento: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(evento.target as Node)) setFiltrosAbertos(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, []);

  const filtrosAtivos =
    filtros.status.length > 0 ||
    filtros.responsaveis.length > 0 ||
    filtros.somenteAtraso ||
    filtros.somenteExcedidos ||
    filtros.realizadoAcimaPrevisto;

  // O chip aplica o filtro do estado mais grave presente — excedido (distribuído ou
  // realizado acima do contratado) sempre vence sobre "realizado acima do previsto".
  function aplicarFiltroMaisGrave() {
    if (resumoAlertas.temExcedido) onFiltrosChange({ ...filtros, somenteExcedidos: true });
    else if (resumoAlertas.temRealAcima) onFiltrosChange({ ...filtros, realizadoAcimaPrevisto: true });
  }

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-surface py-3">
      <div className="relative w-56 flex-none">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Buscar atividade ou responsável..."
          value={buscaLocal}
          onChange={(e) => alterarBusca(e.target.value)}
          className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <button
        onClick={onToggleExpandirTudo}
        className="flex-none rounded-md border border-border px-3 py-1.5 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {tudoExpandido ? "Recolher tudo" : "Expandir tudo"}
      </button>

      <div className="relative flex-none" ref={popoverRef}>
        <button
          onClick={() => setFiltrosAbertos((atual) => !atual)}
          className={`rounded-md border px-3 py-1.5 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            filtrosAtivos ? "border-primary text-primary" : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
          }`}
        >
          Filtros{filtrosAtivos ? " ●" : ""}
        </button>
        {filtrosAbertos && (
          <div className="absolute left-0 top-full z-20 mt-1 w-72 space-y-3 rounded-md border border-border bg-surface p-3 shadow-lg">
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Status</p>
              <MultiSelectDropdown
                opcoes={OPCOES_STATUS}
                selecionados={filtros.status}
                onChange={(status) => onFiltrosChange({ ...filtros, status })}
                labelTodos="Todos os status"
                labelSufixo="status"
              />
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Responsável</p>
              <MultiSelectDropdown
                opcoes={responsaveisDisponiveis.map((r) => ({ value: r.codfor, label: r.nome }))}
                selecionados={filtros.responsaveis}
                onChange={(responsaveis) => onFiltrosChange({ ...filtros, responsaveis })}
                labelTodos="Todos os responsáveis"
                labelSufixo="responsáveis"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={filtros.somenteAtraso}
                onChange={(e) => onFiltrosChange({ ...filtros, somenteAtraso: e.target.checked })}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              Somente com atraso
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={filtros.somenteExcedidos}
                onChange={(e) => onFiltrosChange({ ...filtros, somenteExcedidos: e.target.checked })}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              Somente itens excedidos
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={filtros.realizadoAcimaPrevisto}
                onChange={(e) => onFiltrosChange({ ...filtros, realizadoAcimaPrevisto: e.target.checked })}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              Realizado acima do previsto
            </label>
          </div>
        )}
      </div>

      {resumoAlertas.total > 0 && (
        <button
          onClick={aplicarFiltroMaisGrave}
          className={`flex-none rounded-md border px-3 py-1.5 text-[12.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            resumoAlertas.temExcedido
              ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
              : "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15"
          }`}
        >
          ⚠ {resumoAlertas.total} {resumoAlertas.total === 1 ? "item" : "itens"} em alerta
        </button>
      )}

      {onNovaPastaRaiz && (
        <button
          onClick={onNovaPastaRaiz}
          className="flex-none rounded-md border border-border px-3 py-1.5 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ＋ Nova pasta
        </button>
      )}

      <div className="ml-auto flex flex-none rounded-md border border-border p-0.5">
        <button
          onClick={() => onVisaoChange("lista")}
          className={`rounded px-3 py-1 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${visao === "lista" ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"}`}
        >
          Lista
        </button>
        <button
          onClick={() => onVisaoChange("gantt")}
          className={`rounded px-3 py-1 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${visao === "gantt" ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"}`}
        >
          Gantt
        </button>
      </div>
    </div>
  );
}
