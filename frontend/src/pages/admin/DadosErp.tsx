import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { Skeleton } from "../../components/ui/Skeleton";
import { ColunaComFiltro, FiltroColuna, FiltroColunaServidor, OperadorColuna, RespostaValores } from "../../components/admin/FiltroColunaServidor";

// Consulta dos dados JÁ IMPORTADOS de uma tabela do Senior (Administração > Importados do
// Senior > "Ver dados") e, na rota /removidos/, a lista de REMOVIDOS. Somente leitura — o espelho
// nunca é editado aqui. Sem entrada própria no Sidebar: só alcançável pela tela de importação.
// Desde 21/10/2026 (pedido do Vitor) tudo é no SERVIDOR, para qualquer tamanho de tabela: busca de
// texto, funil por coluna com operador e valor (FiltroColunaServidor, nada carregado antes de abrir)
// e paginação. Os filtros ficam na URL (`?f=`), para F5/voltar/link manterem o recorte.

interface ColunaDados extends ColunaComFiltro {
  ehChave: boolean;
  ehControle: boolean;
}

interface RespostaDados {
  jobName: string;
  displayName: string;
  tabelaSenior: string;
  tabelaLocal: string;
  colunas: ColunaDados[];
  total: number;
  itens: Record<string, unknown>[];
  // Só na lista de removidos (?situacao=): contagem de cada situação, início da última varredura e o recorte do filtro da sync.
  situacao?: Situacao;
  contagens?: { removidos: number; candidatos: number };
  candidatosDesde?: string | null;
  recorte?: string[];
  recorteLocal?: boolean;
  motivoSemRecorte?: string | null;
}

// Lista de REMOVIDOS (21/10/2026): a mesma tela, recortada por situação. "Candidatos" usa a mesma conta da varredura (vivos não vistos
// na última varredura, dentro do recorte do filtro da sincronização), para bater com o selo "teto · N" da tela de importação.
type Situacao = "candidatos" | "removidos" | "sumidos";
const SITUACOES: { valor: Situacao; rotulo: string }[] = [
  { valor: "candidatos", rotulo: "Candidatos da última varredura" },
  { valor: "removidos", rotulo: "Marcados como removidos" },
  { valor: "sumidos", rotulo: "Todos os sumidos" },
];

const PAGE_SIZE = 30;

// Data-só-dia (@db.Date chega como meia-noite UTC) vira dd/mm/aaaa; data com hora vira
// dd/mm/aaaa hh:mm no fuso local. Texto de data é montado na mão, sem `new Date(...)` no caso
// de dia puro, pra não deslocar o dia em America/Sao_Paulo.
function formatarData(iso: string): string {
  if (iso.endsWith("T00:00:00.000Z")) {
    const [ano, mes, dia] = iso.slice(0, 10).split("-");
    return `${dia}/${mes}/${ano}`;
  }
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatarValor(valor: unknown, coluna: Pick<ColunaDados, "tipo" | "dominio">): string {
  if (valor === null || valor === undefined) return "—";
  // Coluna com domínio documentado no schema: "código · rótulo" (código fora do domínio fica só o código).
  if (coluna.dominio) {
    const op = coluna.dominio.find((o) => o.valor === String(valor));
    if (op) return `${op.valor} · ${op.rotulo}`;
  }
  if (coluna.tipo === "data" && typeof valor === "string") return formatarData(valor);
  if (coluna.tipo === "booleano") return valor ? "sim" : "não";
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
}

// Chip de um filtro ativo: "datlct entre 01/01/2026 e 31/03/2026".
const ROTULO_CHIP: Record<OperadorColuna, string> = {
  "=": "=",
  "≠": "≠",
  IN: "em",
  "≥": "≥",
  "≤": "≤",
  entre: "entre",
  contém: "contém",
  "começa com": "começa com",
  vazio: "vazio",
  "não vazio": "não vazio",
};
function textoDoChip(f: FiltroColuna, coluna: ColunaDados | undefined): string {
  const fmt = (v: string) => {
    const op = coluna?.dominio?.find((o) => o.valor === v);
    if (op) return `${op.valor} · ${op.rotulo}`;
    return coluna?.tipo === "data" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split("-").reverse().join("/") : coluna?.tipo === "booleano" ? (v === "true" ? "sim" : "não") : v;
  };
  const vals =
    f.operador === "entre"
      ? `${fmt(f.valores[0])} e ${fmt(f.valores[1])}`
      : f.operador === "IN"
        ? f.valores.length > 3
          ? `${f.valores.slice(0, 3).map(fmt).join(", ")} +${f.valores.length - 3}`
          : f.valores.map(fmt).join(", ")
        : f.valores.map(fmt).join("");
  return `${f.coluna} ${ROTULO_CHIP[f.operador]}${vals ? ` ${vals}` : ""}`;
}

function lerFiltros(bruto: string | null): FiltroColuna[] {
  if (!bruto) return [];
  try {
    const v = JSON.parse(bruto);
    return Array.isArray(v) ? (v as FiltroColuna[]) : [];
  } catch {
    return [];
  }
}

export function DadosErp() {
  const { jobName } = useParams<{ jobName: string }>();
  const local = useLocation();
  // A mesma tela serve ao ERP (/admin/sincronizacao-erp/dados/...) e ao HCM (/admin/sincronizacao-hcm/dados/...).
  const hcm = local.pathname.startsWith("/admin/sincronizacao-hcm");
  const API = hcm ? "/api/sync-hcm" : "/api/sync-erp";
  const ROTA = hcm ? "/admin/sincronizacao-hcm" : "/admin/sincronizacao-erp";
  const TITULO = hcm ? "Importados do HCM" : "Importados do ERP";
  // /admin/sincronizacao-erp/removidos/:jobName — a lista de removidos com os mesmos filtros do "Ver dados".
  const modoRemovidos = local.pathname.includes("/removidos/");
  const [params, setParams] = useSearchParams();
  const situacaoParam = params.get("situacao");
  const situacao: Situacao | undefined = modoRemovidos
    ? situacaoParam === "candidatos" || situacaoParam === "removidos" || situacaoParam === "sumidos"
      ? situacaoParam
      : "sumidos"
    : undefined;
  const filtrosTexto = params.get("f");
  const filtros = useMemo(() => lerFiltros(filtrosTexto), [filtrosTexto]);

  const [resposta, setResposta] = useState<RespostaDados | null>(null);
  const [pagina, setPagina] = useState(1);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Troca de tabela zera busca e página (filtros e situação vêm da URL).
  useEffect(() => {
    setBusca("");
    setPagina(1);
    setResposta(null);
  }, [jobName, API]);

  function atualizarUrl(mudar: (n: URLSearchParams) => void) {
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        mudar(n);
        return n;
      },
      { replace: true }
    );
    setPagina(1);
  }
  const trocarSituacao = (valor: Situacao) => atualizarUrl((n) => n.set("situacao", valor));
  function definirFiltros(novos: FiltroColuna[]) {
    atualizarUrl((n) => (novos.length > 0 ? n.set("f", JSON.stringify(novos)) : n.delete("f")));
  }
  function aplicarFiltroDaColuna(coluna: string, filtro: FiltroColuna | null) {
    const outros = filtros.filter((f) => f.coluna !== coluna);
    definirFiltros(filtro ? [...outros, filtro] : outros);
  }

  // Tudo no servidor: busca (com debounce), filtros, situação e página.
  useEffect(() => {
    if (!jobName) return;
    let cancelado = false;
    const timer = window.setTimeout(() => {
      setCarregando(true);
      axios
        .get<RespostaDados>(`${API}/${jobName}/dados`, {
          params: { busca, page: pagina, pageSize: PAGE_SIZE, situacao, filtros: filtros.length > 0 ? JSON.stringify(filtros) : undefined },
        })
        .then(({ data }) => {
          if (cancelado) return;
          setResposta(data);
          setErro(null);
        })
        .catch((err) => !cancelado && setErro(err.response?.data?.error ?? "Falha ao carregar os dados"))
        .finally(() => !cancelado && setCarregando(false));
    }, busca ? 250 : 0);
    return () => {
      cancelado = true;
      window.clearTimeout(timer);
    };
  }, [jobName, API, busca, pagina, situacao, filtros]);

  const colunas = resposta?.colunas ?? [];
  const itens = resposta?.itens ?? [];
  const totalRegistros = resposta?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / PAGE_SIZE));
  const colunaPorNome = (nome: string) => colunas.find((c) => c.nome === nome);

  const carregarValores = (coluna: string) => (termo: string) =>
    axios
      .get<RespostaValores>(`${API}/${jobName}/dados/valores`, {
        params: { coluna, termo, busca, situacao, filtros: filtros.length > 0 ? JSON.stringify(filtros) : undefined },
      })
      .then(({ data }) => data);

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        <Link to={ROTA} className="hover:underline">
          Administração · {TITULO}
        </Link>
      </p>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            {modoRemovidos ? "Removidos no Senior" : "Dados importados"} — {resposta?.displayName ?? jobName}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {modoRemovidos ? (
              <>
                Registros que não vieram mais na consulta ao {hcm ? "HCM" : "Senior"}. Confira alguns direto no ERP: se não existem mais lá, a
                detecção está correta. Nada é apagado: só marcado.
              </>
            ) : resposta ? (
              <>
                Espelho local <span className="font-mono">{resposta.tabelaLocal}</span> da tabela{" "}
                <span className="font-mono">{resposta.tabelaSenior}</span> do {hcm ? "HCM" : "Senior"} · somente leitura.
              </>
            ) : (
              "Somente leitura."
            )}
          </p>
        </div>
        <Link
          to={ROTA}
          className="flex-none rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition hover:bg-surface-2"
        >
          ← Voltar pra lista
        </Link>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>
      )}

      {modoRemovidos && (
        <div className="mb-4 space-y-2">
          <div className="inline-flex flex-wrap gap-1 rounded-md border border-border p-1" role="group" aria-label="Situação">
            {SITUACOES.map((o) => {
              const n =
                o.valor === "candidatos"
                  ? resposta?.contagens?.candidatos
                  : o.valor === "removidos"
                    ? resposta?.contagens?.removidos
                    : resposta?.contagens
                      ? resposta.contagens.candidatos + resposta.contagens.removidos
                      : undefined;
              const ativa = situacao === o.valor;
              return (
                <button
                  key={o.valor}
                  type="button"
                  onClick={() => trocarSituacao(o.valor)}
                  aria-pressed={ativa}
                  className={`rounded px-3 py-1.5 text-[12.5px] font-medium transition ${ativa ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"}`}
                >
                  {o.rotulo}
                  {n != null && <span className="ml-1.5 font-mono tabular-nums opacity-80">{n.toLocaleString("pt-BR")}</span>}
                </button>
              );
            })}
          </div>
          <p className="text-[12px] text-muted">
            {resposta?.candidatosDesde
              ? `Candidatos = vivos que não vieram na última varredura (${formatarData(resposta.candidatosDesde)})`
              : "Ainda não houve varredura nesta tabela"}
            {resposta?.recorte && resposta.recorte.length > 0 && (
              <>
                {" "}· recorte do filtro da sincronização: <span className="font-mono text-foreground">{resposta.recorte.join(" e ")}</span>
              </>
            )}
            {resposta && resposta.recorteLocal === false && (
              <span className="text-destructive"> · o filtro usa campo não guardado localmente ({resposta.motivoSemRecorte}): candidatos não podem ser calculados.</span>
            )}
          </p>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setPagina(1);
          }}
          placeholder="Buscar..."
          className="w-full max-w-sm rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {filtros.map((f) => (
          <span key={f.coluna} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11.5px] font-medium text-primary">
            <span className="max-w-[320px] truncate" title={textoDoChip(f, colunaPorNome(f.coluna))}>
              {textoDoChip(f, colunaPorNome(f.coluna))}
            </span>
            <button type="button" onClick={() => aplicarFiltroDaColuna(f.coluna, null)} aria-label={`Remover filtro de ${f.coluna}`} className="hover:text-foreground">
              ✕
            </button>
          </span>
        ))}
        {filtros.length > 0 && (
          <button onClick={() => definirFiltros([])} className="text-[11.5px] text-muted hover:text-foreground hover:underline">
            Limpar filtros
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {colunas.map((c) => (
                  <th
                    key={c.nome}
                    className={`whitespace-nowrap bg-surface-2 px-2.5 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted ${
                      (c.tipo === "inteiro" || c.tipo === "decimal") && !c.dominio ? "text-right" : "text-left"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      <span title={c.ehChave ? "Chave" : c.ehControle ? "Controle do espelho" : undefined}>
                        {c.nome}
                        {c.ehChave ? " ★" : ""}
                      </span>
                      {c.operadores.length > 0 && (
                        <FiltroColunaServidor
                          coluna={c}
                          filtro={filtros.find((f) => f.coluna === c.nome) ?? null}
                          onAplicar={(f) => aplicarFiltroDaColuna(c.nome, f)}
                          carregarValores={carregarValores(c.nome)}
                          formatarValor={(v) => formatarValor(v, c)}
                        />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {carregando &&
                !resposta &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td colSpan={colunas.length || 1} className="px-2.5 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))}
              {resposta && itens.length === 0 && (
                <tr>
                  <td colSpan={colunas.length || 1} className="px-2.5 py-4 text-center text-sm text-muted">
                    {busca || filtros.length > 0
                      ? "Nenhum registro bate com a busca/filtro."
                      : modoRemovidos
                        ? "Nenhum registro nesta situação."
                        : "Nenhum registro importado ainda."}
                  </td>
                </tr>
              )}
              {itens.map((linha, i) => (
                <tr key={i} className={`border-t border-border/60 ${carregando ? "opacity-60" : ""}`}>
                  {colunas.map((c) => {
                    const texto = formatarValor(linha[c.nome], c);
                    return (
                      <td
                        key={c.nome}
                        // Domínio: "código · rótulo" alinhado à esquerda, cortado com "…" e inteiro no mouse.
                        title={c.dominio ? texto : undefined}
                        className={`whitespace-nowrap px-2.5 py-2 text-[12.5px] ${c.ehControle ? "text-muted" : "text-foreground"} ${
                          c.dominio ? "max-w-[220px] truncate" : c.tipo === "inteiro" || c.tipo === "decimal" ? "text-right tabular-nums" : ""
                        }`}
                      >
                        {texto}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalRegistros > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted">
          <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1} className="hover:text-foreground disabled:opacity-40">
            ← Anterior
          </button>
          <span>
            página {pagina} de {totalPaginas.toLocaleString("pt-BR")} ({totalRegistros.toLocaleString("pt-BR")} registros)
          </span>
          <button
            onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            disabled={pagina >= totalPaginas}
            className="hover:text-foreground disabled:opacity-40"
          >
            Próxima →
          </button>
        </div>
      )}
    </div>
  );
}
