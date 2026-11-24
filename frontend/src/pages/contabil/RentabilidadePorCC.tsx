import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MultiSelectDropdown, type MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { TabelaLocal } from "../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
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
/** Uma linha da tabela: um centro de custo, ou (`total`) o total do recorte desenhado no rodapé. */
type LinhaTela = Linha & { total?: boolean };
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

  // As colunas são os indicadores configurados + o centro de custo. Ordem, visibilidade, largura, título, filtro, ordem e resumo (Σ) por coluna são do kit de
  // colunas do CaxHub (por usuário, chave abaixo); o total do recorte é o do servidor (razões e percentuais não se somam), na linha de total do rodapé.
  const defs = useMemo<DefColuna<LinhaTela>[]>(
    () => [
      {
        nome: "centroDeCusto",
        titulo: "Centro de custo",
        fixa: true,
        congelada: true,
        largura: 280,
        texto: (l) => (l.total ? "Total do recorte" : `${l.codccu} ${l.desccu}`),
        classe: "text-foreground",
        render: (l) =>
          l.total ? (
            "Total do recorte"
          ) : (
            <>
              <span className="font-mono text-xs text-muted">{l.codccu}</span> {l.desccu}
            </>
          ),
      },
      ...(resultado?.colunas ?? []).map<DefColuna<LinhaTela>>((c) => ({
        nome: c.codigo,
        titulo: c.rotulo,
        direita: true,
        largura: 130,
        formatarValor: (v) => formatarValor(typeof v === "number" ? v : null, c.formato),
        formatarResumo: (v) => formatarValor(v, c.formato),
        // Percentual não se soma.
        ...(c.formato === "percentual" ? { resumos: ["media", "minimo", "maximo", "mediana"] as const } : {}),
        classe: (l) => cn("whitespace-nowrap tabular-nums", (l.valores[c.codigo] ?? 0) < 0 && c.formato !== "percentual" && "text-destructive"),
        render: (l) => formatarValor(l.valores[c.codigo], c.formato),
      })),
    ],
    [resultado?.colunas]
  );
  const colunasLocais = useMemo<ColunaLocal[]>(
    () => [{ nome: "centroDeCusto", tipo: "texto", obrigatoria: true }, ...(resultado?.colunas ?? []).map((c): ColunaLocal => ({ nome: c.codigo, tipo: "decimal" }))],
    [resultado?.colunas]
  );
  const lerCelula = useMemo(
    () => (l: LinhaTela, coluna: string): unknown => (coluna === "centroDeCusto" ? `${l.codccu} ${l.desccu}` : l.valores[coluna]),
    []
  );
  const linhaDeTotal = useMemo<LinhaTela | undefined>(() => (resultado ? { codccu: "", desccu: "Total do recorte", valores: resultado.total, total: true } : undefined), [resultado]);
  const linhas = useMemo<LinhaTela[]>(() => resultado?.linhas ?? [], [resultado]);

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

      {!carregando && resultado && resultado.colunas.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          Nenhum indicador configurado.{" "}
          <Link to="/admin/indicadores-rentabilidade" className="text-primary underline-offset-2 hover:underline">
            Cadastre ou importe a configuração
          </Link>
          .
        </p>
      ) : (
        <TabelaLocal<LinhaTela>
          chave="contabil.rentabilidade-cc"
          defs={defs}
          colunas={colunasLocais}
          linhas={linhas}
          ler={lerCelula}
          chaveLinha={(l) => l.codccu}
          loading={carregando}
          vazio="Nenhum centro de custo com movimento neste recorte."
          alturaMax="max-h-[70vh]"
          linhaDeTotal={linhaDeTotal}
        />
      )}
    </div>
  );
}
