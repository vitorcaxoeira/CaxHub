import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/Toast";
import { MultiSelectColumnFilter, VALOR_VAZIO, normalizar } from "../../components/ui/MultiSelectColumnFilter";

// Consulta/edição dos dados JÁ SINCRONIZADOS de um job Kyria (Administração > Integração Kyria
// > Sincronização > "Ver dados", 18/09/2026, pedido do Vitor). Diferente de tudo mais na
// integração Kyria, esta tela GRAVA em cima de dado real — só nos campos que o mapeamento
// registrado marca como internos (nunca vindos da API). Sem entrada própria no Sidebar: só
// alcançável pelo link "Ver dados" da tela de Sincronização (ação contextual, não destino de
// menu).

interface ColunaDados {
  nomeInterno: string;
  ehInterno: boolean;
  relacionamentoModelo: string | null;
  relacionamentoCampo: string | null;
  relacionamentoCampoDescricao: string | null;
}

interface ListaCompleta {
  colunas: ColunaDados[];
  itens: Record<string, unknown>[];
  // Por coluna com campo de descrição registrado: "valor bruto" -> rótulo legível.
  descricoes: Record<string, Record<string, string>>;
}

const PAGE_SIZE = 30;

function formatarValor(valor: unknown): string {
  if (valor === null || valor === undefined) return "—";
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
}

// Mesmo valor usado pra montar as opções do funil e pra testar a linha contra o filtro
// selecionado — precisa ser IDÊNTICO nos dois lugares, senão uma linha com valor nulo nunca
// bate com filtro nenhum (mesmo cuidado de MultiSelectColumnFilter.tsx/ListarPedidos.tsx).
function valorFiltravel(linha: Record<string, unknown>, coluna: string): string {
  const bruto = linha[coluna];
  return bruto === null || bruto === undefined ? VALOR_VAZIO : formatarValor(bruto);
}

// Teto pra decidir modo no seletor de relacionado — ver ModalEscolherRegistroRelacionado.
const LIMITE_INDICE_RELACIONADO = 500;

// Modal de seleção — busca/lista linhas de QUALQUER model relacionado (genérico: mesmas colunas
// cruas pra Consultor, Cliente, ou o que vier depois). Clicar numa linha usa o valor da coluna
// `campoAlvo` como o novo valor do campo interno sendo editado.
//
// Dois modos, decididos pelo TAMANHO real da tabela (não hardcoded por model — esse seletor é
// genérico pra qualquer um dos ~75 models do schema, e alguns têm centenas de milhares de linhas
// — ex.: RatItem, LancamentoContabil, vistos nesta mesma sessão):
//   - "índice" (total <= LIMITE_INDICE_RELACIONADO, o caso real de Consultor/Cliente/qualquer
//     tabela de referência): busca TUDO uma vez, filtro por coluna (funil) + busca de texto
//     filtrando no cliente, paginação no cliente — mesma filosofia de DadosKyria.tsx.
//   - "busca" (tabela grande demais pra ler inteira com segurança): comportamento antigo,
//     inalterado — busca de texto e paginação no SERVIDOR, sem funil (não dá pra montar opção
//     distinta sem ler a tabela toda, e ler a tabela toda é exatamente o que não pode acontecer
//     aqui).
function ModalEscolherRegistroRelacionado({
  modelo,
  campoAlvo,
  onEscolher,
  onFechar,
}: {
  modelo: string;
  campoAlvo: string;
  onEscolher: (valor: unknown) => void;
  onFechar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [modoIndice, setModoIndice] = useState<boolean | null>(null);
  const [colunas, setColunas] = useState<string[]>([]);
  // Modo índice: tudo carregado uma vez.
  const [todosOsItens, setTodosOsItens] = useState<Record<string, unknown>[]>([]);
  const [filtrosColuna, setFiltrosColuna] = useState<Record<string, string[]>>({});
  // Modo busca: uma página de cada vez, vinda do servidor.
  const [dadosBusca, setDadosBusca] = useState<{ total: number; itens: Record<string, unknown>[] } | null>(null);

  // Decide o modo uma vez por model — pede até LIMITE_INDICE_RELACIONADO de uma vez só; se
  // `total` vier menor ou igual, os `itens` já recebidos SÃO a tabela inteira (não busca de
  // novo). Se vier maior, descarta esse primeiro lote (não é útil como "a página 1" — é só uma
  // fatia arbitrária) e cai no modo busca.
  useEffect(() => {
    setCarregando(true);
    setErro(null);
    setBusca("");
    setPagina(1);
    setFiltrosColuna({});
    axios
      .get(`/api/sync-kyria/dados/relacionados/${modelo}`, { params: { pageSize: LIMITE_INDICE_RELACIONADO } })
      .then(({ data }) => {
        setColunas(data.colunas);
        if (data.total <= LIMITE_INDICE_RELACIONADO) {
          setModoIndice(true);
          setTodosOsItens(data.itens);
        } else {
          setModoIndice(false);
          setTodosOsItens([]);
        }
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao buscar registros"))
      .finally(() => setCarregando(false));
  }, [modelo]);

  // Modo busca: refaz a chamada no servidor a cada troca de busca/página.
  useEffect(() => {
    if (modoIndice !== false) return;
    setCarregando(true);
    axios
      .get(`/api/sync-kyria/dados/relacionados/${modelo}`, { params: { busca, page: pagina, pageSize: 20 } })
      .then(({ data }) => {
        setDadosBusca(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao buscar registros"))
      .finally(() => setCarregando(false));
  }, [modoIndice, modelo, busca, pagina]);

  const opcoesPorColuna = useMemo(() => {
    const mapa = new Map<string, string[]>();
    if (modoIndice !== true) return mapa;
    for (const coluna of colunas) {
      const valores = new Set<string>();
      for (const linha of todosOsItens) valores.add(valorFiltravel(linha, coluna));
      mapa.set(coluna, [...valores].sort((a, b) => a.localeCompare(b, "pt-BR")));
    }
    return mapa;
  }, [modoIndice, colunas, todosOsItens]);

  const temFiltroColuna = Object.values(filtrosColuna).some((v) => v.length > 0);

  const itensFiltrados = useMemo(() => {
    if (modoIndice !== true) return [];
    const termo = normalizar(busca.trim());
    return todosOsItens.filter((linha) => {
      if (termo && !colunas.some((c) => normalizar(formatarValor(linha[c])).includes(termo))) return false;
      if (temFiltroColuna) {
        return Object.entries(filtrosColuna).every(([coluna, selecionados]) => selecionados.length === 0 || selecionados.includes(valorFiltravel(linha, coluna)));
      }
      return true;
    });
  }, [modoIndice, todosOsItens, colunas, busca, filtrosColuna, temFiltroColuna]);

  function alterarFiltroColuna(coluna: string, selecionados: string[]) {
    setFiltrosColuna((atual) => ({ ...atual, [coluna]: selecionados }));
    setPagina(1);
  }

  // Linhas/total/paginação — uma fonte por modo, mesma forma pro resto do JSX não precisar
  // ramificar de novo.
  const PAGE_SIZE_MODAL = 20;
  const totalRegistros = modoIndice === true ? itensFiltrados.length : dadosBusca?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / PAGE_SIZE_MODAL));
  const itensPagina =
    modoIndice === true ? itensFiltrados.slice((pagina - 1) * PAGE_SIZE_MODAL, pagina * PAGE_SIZE_MODAL) : dadosBusca?.itens ?? [];

  return (
    <Modal open onClose={onFechar} title={`Escolher registro de ${modelo}`} className="max-w-3xl">
      <div className="mb-3 flex items-center gap-2">
        <input
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setPagina(1);
          }}
          placeholder="Buscar..."
          autoFocus
          className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {temFiltroColuna && (
          <button
            onClick={() => {
              setFiltrosColuna({});
              setPagina(1);
            }}
            className="flex-none rounded-full border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
          >
            Limpar filtros
          </button>
        )}
      </div>
      {modoIndice === false && (
        <p className="mb-3 text-[11px] text-muted">Tabela grande demais pra filtro por coluna — use a busca acima.</p>
      )}
      {erro && <p className="mb-3 text-sm text-destructive">{erro}</p>}
      <div className="max-h-80 overflow-auto rounded-md border border-border">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {colunas.map((c) => (
                <th key={c} className="sticky top-0 bg-surface-2 px-2 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                    <span className="font-mono text-[10px] uppercase tracking-wider">{c}</span>
                    {modoIndice === true && (
                      <MultiSelectColumnFilter
                        titulo={c}
                        opcoes={opcoesPorColuna.get(c) ?? []}
                        selecionados={filtrosColuna[c] ?? []}
                        onChange={(selecionados) => alterarFiltroColuna(c, selecionados)}
                      />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr>
                <td colSpan={colunas.length || 1} className="px-2 py-3">
                  <Skeleton className="h-4 w-full" />
                </td>
              </tr>
            )}
            {!carregando && itensPagina.length === 0 && (
              <tr>
                <td colSpan={colunas.length || 1} className="px-2 py-3 text-center text-sm text-muted">
                  Nenhum registro encontrado.
                </td>
              </tr>
            )}
            {!carregando &&
              itensPagina.map((linha, i) => (
                <tr
                  key={i}
                  onClick={() => onEscolher(linha[campoAlvo])}
                  className="cursor-pointer border-t border-border/60 hover:bg-surface-2"
                >
                  {colunas.map((c) => (
                    <td key={c} className="px-2 py-1.5 text-[12.5px] text-foreground">
                      {formatarValor(linha[c])}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {totalRegistros > PAGE_SIZE_MODAL && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted">
          <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1} className="hover:text-foreground disabled:opacity-40">
            ← Anterior
          </button>
          <span>
            página {pagina} de {totalPaginas}
          </span>
          <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={pagina >= totalPaginas} className="hover:text-foreground disabled:opacity-40">
            Próxima →
          </button>
        </div>
      )}
    </Modal>
  );
}

export function DadosKyria() {
  const { jobName } = useParams<{ jobName: string }>();
  const toast = useToast();
  const [dados, setDados] = useState<ListaCompleta | null>(null);
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [edicaoAberta, setEdicaoAberta] = useState<{ linhaId: string; campo: string; modelo: string; campoAlvo: string } | null>(null);
  // Filtro de coluna (mesmo padrão de ListarPedidos "Por Cliente") — chave dinâmica
  // (nomeInterno) em vez de um union type fixo, já que as colunas aqui vêm do mapeamento
  // registrado, não são conhecidas em tempo de compilação. Coluna ausente = sem filtro.
  const [filtrosColuna, setFiltrosColuna] = useState<Record<string, string[]>>({});

  function carregar() {
    if (!jobName) return;
    setCarregando(true);
    // "Índice" (todas as linhas, sem paginação) — precisa de tudo carregado pra montar as
    // opções de cada funil e filtrar direito. Tabelas Kyria de hoje são pequenas (dezenas a
    // poucas centenas de linhas); mesmo espírito de routes/pedidos.ts:GET /por-cliente/indice.
    axios
      .get(`/api/sync-kyria/dados/${jobName}/indice`)
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os dados"))
      .finally(() => setCarregando(false));
  }

  useEffect(() => {
    carregar();
    setFiltrosColuna({});
    setPagina(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobName]);

  // Desfaz o relacionamento: grava null no campo interno. O registro relacionado em si não é
  // tocado — só o vínculo desta linha. Dá pra vincular de novo depois.
  const [removendo, setRemovendo] = useState<string | null>(null);
  async function removerVinculo(linhaId: string, campo: string, rotulo: string) {
    if (!jobName) return;
    if (!window.confirm(`Remover o vínculo de "${campo}" (${rotulo})? O registro relacionado não é apagado — só deixa de estar ligado a esta linha.`)) {
      return;
    }
    setRemovendo(`${linhaId}:${campo}`);
    try {
      await axios.patch(`/api/sync-kyria/dados/${jobName}/${linhaId}`, { campo, valor: null });
      toast.mostrar("Vínculo removido.", "success");
      carregar();
    } catch (err: any) {
      toast.mostrar(err.response?.data?.error ?? "Falha ao remover o vínculo", "destructive");
    } finally {
      setRemovendo(null);
    }
  }

  async function escolherRegistro(valor: unknown) {
    if (!edicaoAberta || !jobName) return;
    try {
      await axios.patch(`/api/sync-kyria/dados/${jobName}/${edicaoAberta.linhaId}`, { campo: edicaoAberta.campo, valor });
      toast.mostrar("Valor atualizado.", "success");
      setEdicaoAberta(null);
      carregar();
    } catch (err: any) {
      toast.mostrar(err.response?.data?.error ?? "Falha ao salvar", "destructive");
    }
  }

  const opcoesPorColuna = useMemo(() => {
    const mapa = new Map<string, string[]>();
    if (!dados) return mapa;
    for (const coluna of dados.colunas) {
      const valores = new Set<string>();
      for (const linha of dados.itens) valores.add(valorFiltravel(linha, coluna.nomeInterno));
      mapa.set(coluna.nomeInterno, [...valores].sort((a, b) => a.localeCompare(b, "pt-BR")));
    }
    return mapa;
  }, [dados]);

  const temFiltro = Object.values(filtrosColuna).some((selecionados) => selecionados.length > 0);

  const itensFiltrados = useMemo(() => {
    if (!dados) return [];
    if (!temFiltro) return dados.itens;
    return dados.itens.filter((linha) =>
      Object.entries(filtrosColuna).every(([coluna, selecionados]) => selecionados.length === 0 || selecionados.includes(valorFiltravel(linha, coluna)))
    );
  }, [dados, filtrosColuna, temFiltro]);

  function alterarFiltroColuna(coluna: string, selecionados: string[]) {
    setFiltrosColuna((atual) => ({ ...atual, [coluna]: selecionados }));
    setPagina(1);
  }

  function limparFiltros() {
    setFiltrosColuna({});
    setPagina(1);
  }

  const totalPaginas = Math.max(1, Math.ceil(itensFiltrados.length / PAGE_SIZE));
  const itensPagina = itensFiltrados.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        <Link to="/admin/sincronizacao-kyria" className="hover:underline">
          Administração · Integração Kyria · Sincronização
        </Link>
      </p>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Dados sincronizados — {jobName}</h1>
          <p className="mt-1 text-sm text-muted">
            Colunas internas (sem origem na API) podem ser editadas escolhendo um registro da tabela relacionada.
          </p>
        </div>
        <Link
          to="/admin/sincronizacao-kyria"
          className="flex-none rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition hover:bg-surface-2"
        >
          ← Voltar pra lista
        </Link>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {temFiltro && (
        <div className="mb-3">
          <button
            onClick={limparFiltros}
            className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20"
          >
            Limpar filtros
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {(dados?.colunas ?? []).map((c) => (
                  <th key={c.nomeInterno} className="bg-surface-2 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                      <span className="font-mono text-[10px] uppercase tracking-wider">{c.nomeInterno}</span>
                      {c.ehInterno && <span className="text-primary" title="Campo interno, editável">●</span>}
                      <MultiSelectColumnFilter
                        titulo={c.nomeInterno}
                        opcoes={opcoesPorColuna.get(c.nomeInterno) ?? []}
                        selecionados={filtrosColuna[c.nomeInterno] ?? []}
                        onChange={(selecionados) => alterarFiltroColuna(c.nomeInterno, selecionados)}
                      />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {carregando &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td colSpan={dados?.colunas.length ?? 1} className="px-2.5 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))}
              {!carregando && dados && dados.itens.length === 0 && (
                <tr>
                  <td colSpan={dados.colunas.length} className="px-2.5 py-4 text-center text-sm text-muted">
                    Nenhum registro sincronizado ainda.
                  </td>
                </tr>
              )}
              {!carregando && dados && dados.itens.length > 0 && itensFiltrados.length === 0 && (
                <tr>
                  <td colSpan={dados.colunas.length} className="px-2.5 py-4 text-center text-sm text-muted">
                    Nenhum registro bate com o filtro selecionado.
                  </td>
                </tr>
              )}
              {!carregando &&
                dados &&
                itensPagina.map((linha) => (
                  <tr key={String(linha.id)} className="border-t border-border/60">
                    {dados.colunas.map((c) => (
                      <td key={c.nomeInterno} className="px-2.5 py-2 text-[12.5px] text-foreground">
                        {c.ehInterno && c.relacionamentoModelo && c.relacionamentoCampo ? (
                          (() => {
                            const valorAtual = linha[c.nomeInterno];
                            const vinculado = valorAtual !== null && valorAtual !== undefined && valorAtual !== "";
                            const descricao = dados.descricoes[c.nomeInterno]?.[String(valorAtual)];
                            const rotulo = `${formatarValor(valorAtual)}${descricao ? ` — ${descricao}` : ""}`;
                            const chaveRemocao = `${String(linha.id)}:${c.nomeInterno}`;
                            return (
                              <span className="inline-flex items-center gap-2">
                                <button
                                  onClick={() =>
                                    setEdicaoAberta({
                                      linhaId: String(linha.id),
                                      campo: c.nomeInterno,
                                      modelo: c.relacionamentoModelo!,
                                      campoAlvo: c.relacionamentoCampo!,
                                    })
                                  }
                                  className="text-primary hover:underline"
                                >
                                  {rotulo}
                                  {vinculado ? " · trocar" : " · vincular"}
                                </button>
                                {vinculado && (
                                  <button
                                    onClick={() => removerVinculo(String(linha.id), c.nomeInterno, rotulo)}
                                    disabled={removendo === chaveRemocao}
                                    title="Remover o vínculo deste registro"
                                    className="text-destructive hover:underline disabled:opacity-50"
                                  >
                                    {removendo === chaveRemocao ? "removendo…" : "remover"}
                                  </button>
                                )}
                              </span>
                            );
                          })()
                        ) : (
                          formatarValor(linha[c.nomeInterno])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {itensFiltrados.length > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted">
          <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1} className="hover:text-foreground disabled:opacity-40">
            ← Anterior
          </button>
          <span>
            página {pagina} de {totalPaginas} ({itensFiltrados.length}
            {temFiltro ? ` de ${dados?.itens.length ?? 0}` : ""} registros)
          </span>
          <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={pagina >= totalPaginas} className="hover:text-foreground disabled:opacity-40">
            Próxima →
          </button>
        </div>
      )}

      {edicaoAberta && (
        <ModalEscolherRegistroRelacionado
          modelo={edicaoAberta.modelo}
          campoAlvo={edicaoAberta.campoAlvo}
          onEscolher={escolherRegistro}
          onFechar={() => setEdicaoAberta(null)}
        />
      )}
    </div>
  );
}
