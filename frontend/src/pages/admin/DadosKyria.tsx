import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/Toast";
import { MultiSelectColumnFilter, VALOR_VAZIO, normalizar } from "../../components/ui/MultiSelectColumnFilter";
import { TabelaDadosImportados, type ColunaDados, type RespostaDadosBase } from "../../components/colunas/TabelaDadosImportados";

// Consulta/edição dos dados JÁ SINCRONIZADOS de um job Kyria (Administração > Integração Kyria
// > Sincronização > "Ver dados", 18/09/2026, pedido do Vitor). Diferente de tudo mais na
// integração Kyria, esta tela GRAVA em cima de dado real — só nos campos que o mapeamento
// registrado marca como internos (nunca vindos da API). Sem entrada própria no Sidebar: só
// alcançável pelo link "Ver dados" da tela de Sincronização (ação contextual, não destino de
// menu).
//
// Desde 17/11/2026 (pedido do Vitor) a tabela é a mesma do "Ver dados" do ERP (TabelaDadosImportados):
// busca, funil por coluna, ordem, rodapé de totais e paginação no SERVIDOR, com "Por página" e a
// estrela de padrão. Antes carregava a tabela inteira ("índice") — não cabe em kyria_time_entries.

/** Coluna do Kyria: as do motor genérico + o que o mapeamento registrado diz sobre campo interno/relacionamento. */
interface ColunaKyria extends ColunaDados {
  // A coluna não aceita nulo: o controle de edição não oferece "limpar" (o servidor já manda este campo, ver ColunaDados no backend).
  obrigatoria?: boolean;
  ehInterno: boolean;
  relacionamentoModelo: string | null;
  relacionamentoCampo: string | null;
  relacionamentoCampoDescricao: string | null;
  // Só linhas cujo `campo` vale um dos `valores` podem receber vínculo neste campo (ex.: kyria_members.codusu só pra role attendant, admin ou manager).
  vinculoRestrito: { campo: string; valores: string[]; motivo: string } | null;
}

interface RespostaKyria extends RespostaDadosBase {
  jobName: string;
  displayName: string;
  tabelaLocal: string;
  colunas: ColunaKyria[];
  // Por coluna (nome do campo) com campo de descrição registrado: "valor bruto" -> rótulo legível, só das linhas da página.
  descricoes: Record<string, Record<string, string>>;
}

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

const CONTROLE_CELULA =
  "rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60";

/**
 * Célula de um campo INTERNO que não é vínculo com outra tabela (18/11/2026, pedido do Vitor: informar o valor de kyria_label_groups.fitro_dep_time):
 * edita direto na célula, pelo tipo da coluna. Boolean = lista Sim / Não (e "—" para limpar, quando a coluna aceita vazio); texto, inteiro e número =
 * caixa que grava ao sair do campo ou no Enter (Esc desiste; vazio limpa, quando a coluna aceita). `salvar` devolve false se o servidor recusar.
 */
function CelulaCampoInternoEditavel({ coluna, valor, salvar }: { coluna: ColunaKyria; valor: unknown; salvar: (campo: string, valor: unknown) => Promise<boolean> }) {
  const [gravando, setGravando] = useState(false);
  const [rascunho, setRascunho] = useState<string | null>(null);
  const campo = coluna.rotulo ?? coluna.nome;

  async function gravar(novo: unknown) {
    setGravando(true);
    await salvar(campo, novo);
    setGravando(false);
    setRascunho(null);
  }

  if (coluna.tipo === "booleano") {
    const atual = valor === true ? "sim" : valor === false ? "nao" : "";
    return (
      <select
        aria-label={`Editar ${campo}`}
        value={atual}
        disabled={gravando}
        onChange={(e) => gravar(e.target.value === "sim" ? true : e.target.value === "nao" ? false : null)}
        className={`${CONTROLE_CELULA} w-24`}
      >
        {!coluna.obrigatoria && <option value="">—</option>}
        <option value="sim">Sim</option>
        <option value="nao">Não</option>
      </select>
    );
  }

  const original = valor === null || valor === undefined ? "" : String(valor);
  const texto = rascunho ?? original;
  function confirmar() {
    if (rascunho === null || rascunho === original) {
      setRascunho(null);
      return;
    }
    const limpo = rascunho.trim();
    if (limpo === "") return void gravar(null);
    if (coluna.tipo === "inteiro" || coluna.tipo === "decimal") return void gravar(Number(limpo.replace(",", ".")));
    return void gravar(limpo);
  }
  return (
    <input
      aria-label={`Editar ${campo}`}
      value={texto}
      disabled={gravando}
      inputMode={coluna.tipo === "inteiro" ? "numeric" : coluna.tipo === "decimal" ? "decimal" : undefined}
      placeholder="—"
      onChange={(e) => setRascunho(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setRascunho(null);
      }}
      className={`${CONTROLE_CELULA} w-40`}
    />
  );
}

interface EdicaoAberta {
  linhaId: string;
  campo: string;
  modelo: string;
  campoAlvo: string;
}

export function DadosKyria() {
  const { jobName } = useParams<{ jobName: string }>();
  const toast = useToast();
  const [resposta, setResposta] = useState<RespostaKyria | null>(null);
  const [edicaoAberta, setEdicaoAberta] = useState<EdicaoAberta | null>(null);
  // Soma 1 a cada alteração gravada: a tabela busca a página atual de novo (sem voltar à página 1).
  const [recarregar, setRecarregar] = useState(0);

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
      setRecarregar((n) => n + 1);
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
      setRecarregar((n) => n + 1);
    } catch (err: any) {
      toast.mostrar(err.response?.data?.error ?? "Falha ao salvar", "destructive");
    }
  }

  // Grava o valor de um campo interno que não é vínculo (Boolean, texto, número). Devolve false se o servidor recusar (a mensagem vai no toast).
  async function salvarValorInterno(linhaId: string, campo: string, valor: unknown): Promise<boolean> {
    if (!jobName) return false;
    try {
      await axios.patch(`/api/sync-kyria/dados/${jobName}/${linhaId}`, { campo, valor });
      toast.mostrar("Valor atualizado.", "success");
      setRecarregar((n) => n + 1);
      return true;
    } catch (err: any) {
      toast.mostrar(err.response?.data?.error ?? "Falha ao salvar", "destructive");
      return false;
    }
  }

  // Campo interno SEM relacionamento e de um tipo que a tela edita: controle direto na célula. Qualquer outra coluna devolve undefined.
  function celulaDeValor(linha: Record<string, unknown>, c: ColunaKyria) {
    if (!c.ehInterno || c.relacionamentoModelo || c.relacionamentoCampo) return undefined;
    if (!["booleano", "texto", "inteiro", "decimal"].includes(c.tipo)) return undefined;
    const linhaId = String(linha.id);
    return <CelulaCampoInternoEditavel key={`${linhaId}:${c.nome}`} coluna={c} valor={linha[c.nome]} salvar={(campo, valor) => salvarValorInterno(linhaId, campo, valor)} />;
  }

  // Célula de um campo INTERNO com relacionamento: mostra "valor — descrição" e deixa vincular/trocar/remover. Qualquer outra
  // coluna devolve undefined e a tabela mostra o valor formatado de sempre. O PATCH usa o nome da COLUNA do Postgres (`rotulo`),
  // que é o que o mapeamento registra; `nome` é o campo Prisma (chave de filtro/ordem).
  function celulaDeVinculo(linha: Record<string, unknown>, c: ColunaKyria, r: RespostaKyria | null) {
    if (!(c.ehInterno && c.relacionamentoModelo && c.relacionamentoCampo)) return undefined;
    const rotuloColuna = c.rotulo ?? c.nome;
    const valorAtual = linha[c.nome];
    const vinculado = valorAtual !== null && valorAtual !== undefined && valorAtual !== "";
    const descricao = r?.descricoes[c.nome]?.[String(valorAtual)];
    const rotulo = `${formatarValor(valorAtual)}${descricao ? ` — ${descricao}` : ""}`;
    const linhaId = String(linha.id);
    const chaveRemocao = `${linhaId}:${rotuloColuna}`;
    // Linha que não cumpre a regra do campo (ex.: membro que não é atendente) não oferece "vincular"/"trocar". Se já tem vínculo
    // antigo, ele continua visível e removível.
    const podeVincular = !c.vinculoRestrito || c.vinculoRestrito.valores.includes(String(linha[c.vinculoRestrito.campo]));
    if (!podeVincular && !vinculado) {
      return (
        <span className="text-muted" title={c.vinculoRestrito?.motivo}>
          —
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2">
        {podeVincular ? (
          <button
            onClick={() => setEdicaoAberta({ linhaId, campo: rotuloColuna, modelo: c.relacionamentoModelo!, campoAlvo: c.relacionamentoCampo! })}
            className="text-primary hover:underline"
          >
            {rotulo}
            {vinculado ? " · trocar" : " · vincular"}
          </button>
        ) : (
          <span title={c.vinculoRestrito?.motivo}>{rotulo}</span>
        )}
        {vinculado && (
          <button
            onClick={() => removerVinculo(linhaId, rotuloColuna, rotulo)}
            disabled={removendo === chaveRemocao}
            title="Remover o vínculo deste registro"
            className="text-destructive hover:underline disabled:opacity-50"
          >
            {removendo === chaveRemocao ? "removendo…" : "remover"}
          </button>
        )}
      </span>
    );
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        <Link to="/admin/sincronizacao-kyria" className="hover:underline">
          Administração · Integração Kyria · Sincronização
        </Link>
      </p>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Dados sincronizados — {resposta?.displayName ?? jobName}</h1>
          <p className="mt-1 text-sm text-muted">
            {resposta ? (
              <>
                Espelho local <span className="font-mono">{resposta.tabelaLocal}</span>. Colunas internas (marcadas com ●, sem origem na API) são
                editáveis: as ligadas a outra tabela, escolhendo um registro; as demais, direto na célula.
              </>
            ) : (
              "Colunas internas (marcadas com ●, sem origem na API) são editáveis: as ligadas a outra tabela, escolhendo um registro; as demais, direto na célula."
            )}
          </p>
        </div>
        <Link
          to="/admin/sincronizacao-kyria"
          className="flex-none rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition hover:bg-surface-2"
        >
          ← Voltar pra lista
        </Link>
      </div>

      {/* Busca, funil e ordem por coluna, colunas configuráveis, rodapé de totais e paginação: tudo no servidor (TabelaDadosImportados). */}
      <TabelaDadosImportados<RespostaKyria>
        endpoint={`/api/sync-kyria/dados/${jobName}`}
        reinicia={`/api/sync-kyria/dados/${jobName}`}
        mensagemVazio="Nenhum registro sincronizado ainda."
        tituloControle="Controle do espelho"
        onResposta={setResposta}
        renderCelula={(linha, c, r) => celulaDeVinculo(linha, c, r) ?? celulaDeValor(linha, c)}
        decorarCabecalho={(c) =>
          c.ehInterno ? (
            <span className="ml-1 text-primary" title="Campo interno, editável">
              ●
            </span>
          ) : null
        }
        recarregar={recarregar}
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
