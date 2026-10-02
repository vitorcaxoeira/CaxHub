import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Skeleton } from "../../components/ui/Skeleton";
import { MultiSelectColumnFilter, VALOR_VAZIO, normalizar } from "../../components/ui/MultiSelectColumnFilter";

// Consulta dos dados JÁ IMPORTADOS de uma tabela do Senior (Administração > Importados do
// Senior > "Ver dados"). Somente leitura — o espelho nunca é editado aqui. Sem entrada própria
// no Sidebar: só alcançável pelo link contextual da tela de importação. Padrão do "Ver dados"
// do Kyria (CaxHub), com o modo decidido pelo tamanho real da tabela:
//   - "índice" (total <= limiteIndice): carrega tudo uma vez; busca, funil por coluna e
//     paginação acontecem no cliente.
//   - "busca" (tabela maior): busca de texto e paginação no servidor, sem funil (montar as
//     opções distintas exigiria ler a tabela inteira).

interface ColunaDados {
  nome: string;
  tipo: "texto" | "inteiro" | "decimal" | "data" | "booleano" | "json";
  ehChave: boolean;
  ehControle: boolean;
}

interface RespostaDados {
  jobName: string;
  displayName: string;
  tabelaSenior: string;
  tabelaLocal: string;
  limiteIndice: number;
  colunas: ColunaDados[];
  total: number;
  itens: Record<string, unknown>[];
}

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

function formatarValor(valor: unknown, coluna: ColunaDados): string {
  if (valor === null || valor === undefined) return "—";
  if (coluna.tipo === "data" && typeof valor === "string") return formatarData(valor);
  if (coluna.tipo === "booleano") return valor ? "sim" : "não";
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
}

// Mesmo valor pra montar as opções do funil e pra testar a linha contra a seleção — precisa
// ser IDÊNTICO nos dois lugares, senão linha com valor nulo nunca bate com filtro nenhum.
function valorFiltravel(linha: Record<string, unknown>, coluna: ColunaDados): string {
  const bruto = linha[coluna.nome];
  return bruto === null || bruto === undefined ? VALOR_VAZIO : formatarValor(bruto, coluna);
}

export function DadosErp() {
  const { jobName } = useParams<{ jobName: string }>();
  const [resposta, setResposta] = useState<RespostaDados | null>(null);
  const [modoIndice, setModoIndice] = useState<boolean | null>(null);
  const [pagina, setPagina] = useState(1);
  const [busca, setBusca] = useState("");
  const [filtrosColuna, setFiltrosColuna] = useState<Record<string, string[]>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Primeira chamada: pede o teto de uma vez. Se `total` couber, os `itens` recebidos SÃO a
  // tabela inteira (modo índice); se não, descarta o lote (fatia arbitrária) e cai no modo busca.
  useEffect(() => {
    if (!jobName) return;
    setCarregando(true);
    setErro(null);
    setBusca("");
    setPagina(1);
    setFiltrosColuna({});
    setModoIndice(null);
    axios
      .get<RespostaDados>(`/api/sync-erp/${jobName}/dados`, { params: { pageSize: 1000 } })
      .then(({ data }) => {
        setResposta(data);
        setModoIndice(data.total <= data.limiteIndice);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os dados"))
      .finally(() => setCarregando(false));
  }, [jobName]);

  // Modo busca: refaz a chamada no servidor a cada troca de busca/página (com debounce curto
  // pra não disparar uma requisição por tecla).
  useEffect(() => {
    if (modoIndice !== false || !jobName) return;
    const timer = window.setTimeout(() => {
      setCarregando(true);
      axios
        .get<RespostaDados>(`/api/sync-erp/${jobName}/dados`, { params: { busca, page: pagina, pageSize: PAGE_SIZE } })
        .then(({ data }) => {
          setResposta(data);
          setErro(null);
        })
        .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os dados"))
        .finally(() => setCarregando(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [modoIndice, jobName, busca, pagina]);

  const colunas = resposta?.colunas ?? [];
  const todosOsItens = resposta?.itens ?? [];

  const opcoesPorColuna = useMemo(() => {
    const mapa = new Map<string, string[]>();
    if (modoIndice !== true) return mapa;
    for (const coluna of colunas) {
      const valores = new Set<string>();
      for (const linha of todosOsItens) valores.add(valorFiltravel(linha, coluna));
      mapa.set(coluna.nome, [...valores].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })));
    }
    return mapa;
  }, [modoIndice, colunas, todosOsItens]);

  const temFiltro = Object.values(filtrosColuna).some((v) => v.length > 0);

  const itensFiltrados = useMemo(() => {
    if (modoIndice !== true) return [];
    const termo = normalizar(busca.trim());
    return todosOsItens.filter((linha) => {
      if (termo && !colunas.some((c) => normalizar(formatarValor(linha[c.nome], c)).includes(termo))) return false;
      return colunas.every((c) => {
        const selecionados = filtrosColuna[c.nome];
        return !selecionados || selecionados.length === 0 || selecionados.includes(valorFiltravel(linha, c));
      });
    });
  }, [modoIndice, todosOsItens, colunas, busca, filtrosColuna]);

  const totalRegistros = modoIndice === true ? itensFiltrados.length : resposta?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / PAGE_SIZE));
  const itensPagina = modoIndice === true ? itensFiltrados.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE) : todosOsItens;

  function alterarFiltro(coluna: string, selecionados: string[]) {
    setFiltrosColuna((atual) => ({ ...atual, [coluna]: selecionados }));
    setPagina(1);
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        <Link to="/admin/sincronizacao-erp" className="hover:underline">
          Administração · Importados do Senior
        </Link>
      </p>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Dados importados — {resposta?.displayName ?? jobName}</h1>
          <p className="mt-1 text-sm text-muted">
            {resposta ? (
              <>
                Espelho local <span className="font-mono">{resposta.tabelaLocal}</span> da tabela{" "}
                <span className="font-mono">{resposta.tabelaSenior}</span> do Senior · somente leitura.
              </>
            ) : (
              "Somente leitura."
            )}
          </p>
        </div>
        <Link
          to="/admin/sincronizacao-erp"
          className="flex-none rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition hover:bg-surface-2"
        >
          ← Voltar pra lista
        </Link>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>
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
        {temFiltro && (
          <button
            onClick={() => {
              setFiltrosColuna({});
              setPagina(1);
            }}
            className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20"
          >
            Limpar filtros
          </button>
        )}
        {modoIndice === false && (
          <span className="text-[11px] text-muted">
            Tabela grande ({resposta?.total.toLocaleString("pt-BR")} linhas) — filtro por coluna indisponível, use a busca.
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {colunas.map((c) => (
                  <th
                    key={c.nome}
                    className={`whitespace-nowrap bg-surface-2 px-2.5 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted ${
                      c.tipo === "inteiro" || c.tipo === "decimal" ? "text-right" : "text-left"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      <span title={c.ehChave ? "Chave" : c.ehControle ? "Controle do espelho" : undefined}>
                        {c.nome}
                        {c.ehChave ? " ★" : ""}
                      </span>
                      {modoIndice === true && (
                        <MultiSelectColumnFilter
                          titulo={c.nome}
                          opcoes={opcoesPorColuna.get(c.nome) ?? []}
                          selecionados={filtrosColuna[c.nome] ?? []}
                          onChange={(selecionados) => alterarFiltro(c.nome, selecionados)}
                        />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {carregando &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td colSpan={colunas.length || 1} className="px-2.5 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))}
              {!carregando && resposta && itensPagina.length === 0 && (
                <tr>
                  <td colSpan={colunas.length || 1} className="px-2.5 py-4 text-center text-sm text-muted">
                    {resposta.total === 0 && !busca ? "Nenhum registro importado ainda." : "Nenhum registro bate com a busca/filtro."}
                  </td>
                </tr>
              )}
              {!carregando &&
                itensPagina.map((linha, i) => (
                  <tr key={i} className="border-t border-border/60">
                    {colunas.map((c) => (
                      <td
                        key={c.nome}
                        className={`whitespace-nowrap px-2.5 py-2 text-[12.5px] ${
                          c.ehControle ? "text-muted" : "text-foreground"
                        } ${c.tipo === "inteiro" || c.tipo === "decimal" ? "text-right tabular-nums" : ""}`}
                      >
                        {formatarValor(linha[c.nome], c)}
                      </td>
                    ))}
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
            página {pagina} de {totalPaginas} ({totalRegistros.toLocaleString("pt-BR")}
            {modoIndice === true && (temFiltro || busca) ? ` de ${todosOsItens.length.toLocaleString("pt-BR")}` : ""} registros)
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
