import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MultiSelectDropdown, type MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { Skeleton } from "../../components/ui/Skeleton";
import { CONTROLE } from "../../components/ui/estilos";
import { cn } from "../../lib/cn";
import { formatarValor, mesAnterior, type FormatoIndicador } from "../../lib/rentabilidade";

interface Coluna {
  codigo: string;
  rotulo: string;
  formato: FormatoIndicador;
}
interface Linha {
  codccu: string;
  desccu: string;
  valores: Record<string, number | null>;
}
interface Resultado {
  colunas: Coluna[];
  linhas: Linha[];
  total: Record<string, number | null>;
  avisos: string[];
}
interface Opcoes {
  setores: string[];
  centros: { codccu: string; desccu: string }[];
}

// Rentabilidade por centro de custo (17/11/2026): uma linha por CC, uma coluna por indicador. QUAIS indicadores existem e como cada um é
// calculado vem da configuração (Administração › Indicadores de Rentabilidade) — esta tela não conhece conta nenhuma. Só admin.
export function RentabilidadePorCC() {
  const [inicio, setInicio] = useState(mesAnterior());
  const [fim, setFim] = useState(mesAnterior());
  const [setor, setSetor] = useState("");
  const [ccs, setCcs] = useState<string[]>([]);
  const [restringirModelo, setRestringirModelo] = useState(true);
  const [opcoes, setOpcoes] = useState<Opcoes>({ setores: [], centros: [] });
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<{ coluna: string; sentido: 1 | -1 } | null>(null);

  useEffect(() => {
    axios
      .get<Opcoes>("/api/rentabilidade/opcoes")
      .then(({ data }) => setOpcoes(data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!inicio || !fim) return;
    let cancelado = false;
    setCarregando(true);
    axios
      .get<Resultado>("/api/rentabilidade/calcular", { params: { inicio, fim, setor: setor || undefined, cc: ccs.length ? ccs.join(",") : undefined, restringirModelo: restringirModelo ? "1" : "0" } })
      .then(({ data }) => {
        if (cancelado) return;
        setResultado(data);
        setErro(null);
      })
      .catch((e) => {
        if (cancelado) return;
        setErro(e.response?.data?.error ?? "Falha ao calcular a rentabilidade");
        setResultado(null);
      })
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
  }, [inicio, fim, setor, ccs, restringirModelo]);

  const opcoesCc: MultiSelectOption<string>[] = useMemo(() => opcoes.centros.map((c) => ({ value: c.codccu, label: `${c.codccu} · ${c.desccu}` })), [opcoes.centros]);

  const linhas = useMemo(() => {
    if (!resultado) return [];
    if (!ordem) return resultado.linhas;
    return [...resultado.linhas].sort((a, b) => {
      const va = a.valores[ordem.coluna];
      const vb = b.valores[ordem.coluna];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (va - vb) * ordem.sentido;
    });
  }, [resultado, ordem]);

  const alternarOrdem = (coluna: string) => setOrdem((o) => (o?.coluna === coluna ? (o.sentido === -1 ? { coluna, sentido: 1 } : null) : { coluna, sentido: -1 }));
  const periodoInvalido = !!inicio && !!fim && inicio > fim;

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Contábil · Rentabilidade por centro de custo</p>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-foreground">Rentabilidade por CC</h1>
        <Link to="/admin/indicadores-rentabilidade" className="text-sm text-primary underline-offset-2 hover:underline">
          Configurar indicadores
        </Link>
      </div>
      <p className="mb-5 max-w-3xl text-sm text-muted">
        Cada coluna é um indicador configurado (soma de contas, fórmula ou campo do sistema). O total é calculado sobre o recorte inteiro, não somando as razões das linhas.
      </p>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          De
          <input type="month" id="rent-inicio" value={inicio} onChange={(e) => setInicio(e.target.value)} className={cn(CONTROLE, "w-40")} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Até
          <input type="month" id="rent-fim" value={fim} onChange={(e) => setFim(e.target.value)} className={cn(CONTROLE, "w-40")} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Setor
          <select id="rent-setor" value={setor} onChange={(e) => setSetor(e.target.value)} className={cn(CONTROLE, "w-40")}>
            <option value="">Todos</option>
            {opcoes.setores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-xs text-muted">
          Centro de custo
          <MultiSelectDropdown opcoes={opcoesCc} selecionados={ccs} onChange={setCcs} labelTodos="Todos" labelSufixo="centros de custo" />
        </div>
        <label className="flex h-9 items-center gap-2 text-sm text-foreground" title="Como o BI: conta ou CC fora do modelo de plano da empresa (E043PCM) não entra">
          <input type="checkbox" id="rent-modelo" checked={restringirModelo} onChange={(e) => setRestringirModelo(e.target.checked)} />
          Só contas e CCs do modelo do Senior
        </label>
      </div>

      {periodoInvalido && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">O mês inicial é depois do final.</p>}
      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}
      {resultado?.avisos.map((a) => (
        <p key={a} className="mb-3 rounded-md border border-border bg-surface-2 px-4 py-2.5 text-sm text-muted">
          {a}
        </p>
      ))}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 z-20 min-w-[16rem] bg-surface-2 px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Centro de custo</th>
                {resultado?.colunas.map((c) => (
                  <th key={c.codigo} className="whitespace-nowrap bg-surface-2 px-4 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    <button type="button" onClick={() => alternarOrdem(c.codigo)} className="uppercase tracking-wider hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Ordenar">
                      {c.rotulo}
                      {ordem?.coluna === c.codigo ? (ordem.sentido === -1 ? " ↓" : " ↑") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {carregando &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-48" />
                    </td>
                    <td className="px-4 py-3" colSpan={Math.max(1, resultado?.colunas.length ?? 4)}>
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))}
              {!carregando && resultado && resultado.colunas.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-muted">
                    Nenhum indicador configurado. <Link to="/admin/indicadores-rentabilidade" className="text-primary underline-offset-2 hover:underline">Cadastre ou importe a configuração</Link>.
                  </td>
                </tr>
              )}
              {!carregando && resultado && resultado.colunas.length > 0 && linhas.length === 0 && (
                <tr>
                  <td colSpan={resultado.colunas.length + 1} className="px-4 py-8 text-center text-sm text-muted">
                    Nenhum centro de custo com movimento neste recorte.
                  </td>
                </tr>
              )}
              {!carregando &&
                resultado &&
                linhas.map((l) => (
                  <tr key={l.codccu} className="border-t border-border/60 hover:bg-surface-2">
                    <td className="sticky left-0 bg-surface px-4 py-2.5 text-foreground">
                      <span className="font-mono text-xs text-muted">{l.codccu}</span> {l.desccu}
                    </td>
                    {resultado.colunas.map((c) => (
                      <td key={c.codigo} className={cn("whitespace-nowrap px-4 py-2.5 text-right tabular-nums", (l.valores[c.codigo] ?? 0) < 0 && c.formato !== "percentual" && "text-destructive")}>
                        {formatarValor(l.valores[c.codigo], c.formato)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
            {!carregando && resultado && resultado.colunas.length > 0 && linhas.length > 0 && (
              <tfoot className="sticky bottom-0">
                <tr className="border-t-2 border-border">
                  <td className="sticky left-0 bg-surface-2 px-4 py-3 font-semibold text-foreground">Total do recorte</td>
                  {resultado.colunas.map((c) => (
                    <td key={c.codigo} className={cn("whitespace-nowrap bg-surface-2 px-4 py-3 text-right font-semibold tabular-nums", (resultado.total[c.codigo] ?? 0) < 0 && c.formato !== "percentual" && "text-destructive")}>
                      {formatarValor(resultado.total[c.codigo], c.formato)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
