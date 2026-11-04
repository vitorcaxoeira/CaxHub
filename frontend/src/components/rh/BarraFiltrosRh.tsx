import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { MolduraFiltro, SelectFiltro } from "../ui/ControlesFiltro";
import { usePadroesTela } from "../ui/padroesFiltros/usePadroesTela";
import { buscarOpcoes, type OpcoesRh } from "./opcoesRh";
import { camposRh, TELA_RH } from "./usePadroesRh";
import { fmtData, fmtDataHora, fmtMesAno } from "./formato";
import {
  aplicarPreset,
  atualizarFiltro,
  limparRecorte,
  PRESETS,
  PresetPeriodo,
  recortesAtivos,
  useFiltroRh,
} from "./filtroStore";

const seletor =
  "h-9 min-w-0 rounded-md border border-border bg-surface px-2 text-[13px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-ring";

function Campo({ rotulo, children, className }: { rotulo: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted">{rotulo}</span>
      {children}
    </label>
  );
}

export function BarraFiltrosRh({ escopoPadrao }: { escopoPadrao?: string }) {
  const f = useFiltroRh();
  const [opcoes, setOpcoes] = useState<OpcoesRh | null>(null);
  const [maisFiltros, setMaisFiltros] = useState(false);
  const ativos = recortesAtivos(f);
  // Estrela de padrão de cada filtro (salvo por usuário, valendo para as 10 telas de RH); quem aplica ao abrir é o useRh.
  const p = usePadroesTela({ tela: TELA_RH, campos: camposRh(f, opcoes, f.empresa), soEstrela: true });

  useEffect(() => {
    let vivo = true;
    buscarOpcoes()
      .then((o) => vivo && setOpcoes(o))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const filiais = opcoes?.filiais.filter((x) => f.empresa == null || x.empresa === f.empresa) ?? [];
  const centros = opcoes?.centrosDeCusto.filter((x) => f.empresa == null || x.empresa === f.empresa) ?? [];

  function alternarTipo(valor: number) {
    const tem = f.tipcol.includes(valor);
    atualizarFiltro({ tipcol: tem ? f.tipcol.filter((t) => t !== valor) : [...f.tipcol, valor].sort() });
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Campo rotulo="Período" className="w-44">
          <SelectFiltro acessorio={p.estrela("periodo")} value={f.preset} onChange={(e) => aplicarPreset(e.target.value as PresetPeriodo)}>
            {PRESETS.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.rotulo}
              </option>
            ))}
          </SelectFiltro>
        </Campo>
        <Campo rotulo="De">
          <input
            type="date"
            className={seletor}
            value={f.de}
            max={f.ate}
            onChange={(e) => e.target.value && atualizarFiltro({ preset: "personalizado", de: e.target.value })}
          />
        </Campo>
        <Campo rotulo="Até">
          <input
            type="date"
            className={seletor}
            value={f.ate}
            min={f.de}
            onChange={(e) => e.target.value && atualizarFiltro({ preset: "personalizado", ate: e.target.value })}
          />
        </Campo>

        {opcoes && opcoes.empresas.length > 1 && (
          <Campo rotulo="Empresa" className="w-44">
            <SelectFiltro acessorio={p.estrela("empresa")} value={f.empresa ?? ""}
              onChange={(e) => atualizarFiltro({ empresa: e.target.value === "" ? null : Number(e.target.value), filial: null, ccu: null })}
            >
              <option value="">Todas</option>
              {opcoes.empresas.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </SelectFiltro>
          </Campo>
        )}

        <Campo rotulo="Tipo de colaborador">
          <MolduraFiltro acessorio={p.estrela("tipcol")} className="gap-1">
            {(opcoes?.tiposDeColaborador ?? []).map((t) => {
              const on = f.tipcol.includes(t.valor);
              return (
                <button
                  key={t.valor}
                  type="button"
                  onClick={() => alternarTipo(t.valor)}
                  aria-pressed={on}
                  className={cn(
                    "h-8 rounded-full border px-3 text-[12px] font-medium transition",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted hover:text-foreground"
                  )}
                >
                  {t.rotulo}
                </button>
              );
            })}
          </MolduraFiltro>
        </Campo>

        <div className="ml-auto flex items-center gap-2 pb-0.5">
          <button
            type="button"
            onClick={() => setMaisFiltros((v) => !v)}
            className="h-9 rounded-md border border-border px-3 text-[13px] font-medium text-foreground transition hover:bg-surface-2"
            aria-expanded={maisFiltros}
          >
            Mais filtros{ativos > 0 ? ` (${ativos})` : ""}
          </button>
          {ativos > 0 && (
            <button type="button" onClick={limparRecorte} className="h-9 rounded-md px-2 text-[13px] text-muted underline decoration-dotted hover:text-foreground">
              Limpar
            </button>
          )}
        </div>
      </div>

      {maisFiltros && (
        <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Filial">
            <SelectFiltro acessorio={p.estrela("filial")} value={f.filial ?? ""} onChange={(e) => atualizarFiltro({ filial: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">Todas</option>
              {filiais.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </SelectFiltro>
          </Campo>
          <Campo rotulo="Centro de custo">
            <SelectFiltro acessorio={p.estrela("ccu")} value={f.ccu ?? ""} onChange={(e) => atualizarFiltro({ ccu: e.target.value === "" ? null : e.target.value })}>
              <option value="">Todos</option>
              {centros.map((o) => (
                <option key={`${o.empresa}:${o.valor}`} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </SelectFiltro>
          </Campo>
          <Campo rotulo="Local de trabalho">
            <SelectFiltro acessorio={p.estrela("local")} value={f.local ?? ""} onChange={(e) => atualizarFiltro({ local: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">Todos</option>
              {(opcoes?.locais ?? []).map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </SelectFiltro>
          </Campo>
          <Campo rotulo="Cargo">
            <SelectFiltro acessorio={p.estrela("cargo")} value={f.cargo ?? ""} onChange={(e) => atualizarFiltro({ cargo: e.target.value === "" ? null : e.target.value })}>
              <option value="">Todos</option>
              {(opcoes?.cargos ?? []).map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </SelectFiltro>
          </Campo>
        </div>
      )}

      <p className="mt-2 text-[11.5px] text-muted">
        {escopoPadrao && <span className="mr-2 font-medium text-foreground">{escopoPadrao}</span>}
        {fmtData(f.de)} a {fmtData(f.ate)}
        {opcoes?.dados.ultimaSincronizacao && <> · dados do HCM sincronizados em {fmtDataHora(opcoes.dados.ultimaSincronizacao)}</>}
        {opcoes?.dados.ultimaApuracaoDePonto && <> · ponto até {fmtData(opcoes.dados.ultimaApuracaoDePonto)}</>}
        {opcoes?.dados.ultimaCompetenciaDeFolha && <> · folha até {fmtMesAno(opcoes.dados.ultimaCompetenciaDeFolha)}</>}
      </p>
    </div>
  );
}
