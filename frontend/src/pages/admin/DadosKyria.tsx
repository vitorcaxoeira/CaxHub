import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/Toast";
import { MultiSelectColumnFilter, VALOR_VAZIO, normalizar } from "../../components/ui/MultiSelectColumnFilter";
import { TabelaLocal } from "../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";

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

/** O que as células dos campos internos podem fazer (vincular/trocar e remover o vínculo). */
interface AcoesKyria {
  descricoes: Record<string, Record<string, string>>;
  removendo: string | null;
  editar: (e: { linhaId: string; campo: string; modelo: string; campoAlvo: string }) => void;
  remover: (linhaId: string, campo: string, rotulo: string) => void;
}

export function DadosKyria() {
  const { jobName } = useParams<{ jobName: string }>();
  const toast = useToast();
  const [dados, setDados] = useState<ListaCompleta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [edicaoAberta, setEdicaoAberta] = useState<{ linhaId: string; campo: string; modelo: string; campoAlvo: string } | null>(null);

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

  // Tabela com filtro e ordem por coluna, colunas configuráveis e resumo no rodapé (TabelaLocal, 03/11/2026): a lista já vem inteira
  // (índice). O tipo de cada coluna sai dos próprios valores (as colunas vêm do mapeamento registrado, não do código).
  const colunasLocais = useMemo<ColunaLocal[]>(
    () =>
      (dados?.colunas ?? []).map((c) => {
        const valores = (dados?.itens ?? []).map((l) => l[c.nomeInterno]).filter((v) => v !== null && v !== undefined && v !== "");
        const tipo =
          valores.length > 0 && valores.every((v) => typeof v === "boolean")
            ? "booleano"
            : valores.length > 0 && valores.every((v) => typeof v === "number")
              ? valores.every((v) => Number.isInteger(v))
                ? "inteiro"
                : "decimal"
              : "texto";
        return { nome: c.nomeInterno, tipo };
      }),
    [dados]
  );
  const defs = useMemo<DefColuna<Record<string, unknown>, AcoesKyria>[]>(
    () =>
      (dados?.colunas ?? []).map((c, i) => ({
        nome: c.nomeInterno,
        titulo: c.nomeInterno,
        cabecalho: (
          <>
            {c.nomeInterno}
            {c.ehInterno && (
              <span className="ml-1 text-primary" title="Campo interno, editável">
                ●
              </span>
            )}
          </>
        ),
        fixa: i === 0,
        largura: 160,
        classe: "text-[12.5px] text-foreground",
        texto: (l) => formatarValor(l[c.nomeInterno]),
        formatarValor: (v) => formatarValor(v),
        render: (linha, a) => {
          if (!(c.ehInterno && c.relacionamentoModelo && c.relacionamentoCampo)) return formatarValor(linha[c.nomeInterno]);
          const valorAtual = linha[c.nomeInterno];
          const vinculado = valorAtual !== null && valorAtual !== undefined && valorAtual !== "";
          const descricao = a.descricoes[c.nomeInterno]?.[String(valorAtual)];
          const rotulo = `${formatarValor(valorAtual)}${descricao ? ` — ${descricao}` : ""}`;
          const chaveRemocao = `${String(linha.id)}:${c.nomeInterno}`;
          return (
            <span className="inline-flex items-center gap-2">
              <button
                onClick={() => a.editar({ linhaId: String(linha.id), campo: c.nomeInterno, modelo: c.relacionamentoModelo!, campoAlvo: c.relacionamentoCampo! })}
                className="text-primary hover:underline"
              >
                {rotulo}
                {vinculado ? " · trocar" : " · vincular"}
              </button>
              {vinculado && (
                <button
                  onClick={() => a.remover(String(linha.id), c.nomeInterno, rotulo)}
                  disabled={a.removendo === chaveRemocao}
                  title="Remover o vínculo deste registro"
                  className="text-destructive hover:underline disabled:opacity-50"
                >
                  {a.removendo === chaveRemocao ? "removendo…" : "remover"}
                </button>
              )}
            </span>
          );
        },
      })),
    [dados]
  );

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

      <TabelaLocal<Record<string, unknown>, AcoesKyria>
        chave={`admin.kyria.${(jobName ?? "").toLowerCase().replace(/[^a-z0-9._-]+/g, ".")}`.slice(0, 80)}
        defs={defs}
        colunas={colunasLocais}
        linhas={dados?.itens ?? []}
        chaveLinha={(l, i) => String(l.id ?? i)}
        loading={carregando}
        vazio="Nenhum registro sincronizado ainda."
        ctx={{ descricoes: dados?.descricoes ?? {}, removendo, editar: setEdicaoAberta, remover: removerVinculo }}
      />

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
