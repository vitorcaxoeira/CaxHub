import axios from "axios";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { MultiSelectDropdown, MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { Pagination } from "../../components/ui/Pagination";
import { Skeleton } from "../../components/ui/Skeleton";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useToast } from "../../components/ui/Toast";
import { PedidosDashboard, PedidosIndicadoresData } from "../../components/mercado/PedidosDashboard";
import { TabelaPedidos } from "../../components/mercado/TabelaPedidos";
import { DATA_EMBUTIDA, MolduraFiltro } from "../../components/ui/ControlesFiltro";
import { campoListaFixa, campoParDatas } from "../../components/ui/padroesFiltros/campos";
import { usePadroesTela } from "../../components/ui/padroesFiltros/usePadroesTela";

type Visao = "lista" | "cliente" | "dash";

interface ClienteGrupo {
  codcli: number;
  nome: string;
  quantidade: number;
  valorLiquido: number;
}

// Linha enxuta de GET /pedidos/por-cliente/indice — um registro por pedido do filtro da barra, só pra agrupar por cliente (Qtd. e Valor
// Líquido). Os pedidos de cada cliente vêm da tabela do padrão (TabelaPedidos), que busca em GET /pedidos?codcli=.
interface PedidoIndice {
  chave: string;
  codcli: number;
  vlrliq: number | null;
}

const SITPED_OPCOES: MultiSelectOption<number>[] = [
  { value: 1, label: "Aberto Total" },
  { value: 2, label: "Aberto Parcial" },
  { value: 3, label: "Suspenso" },
  { value: 4, label: "Liquidado" },
  { value: 5, label: "Cancelado" },
  { value: 6, label: "Aguardando Integração WMS" },
  { value: 7, label: "Em Transmissão" },
  { value: 8, label: "Preparação Análise ou NF" },
  { value: 9, label: "Não Fechado" },
];

// Domínio "USU_ModPro" do Senior (modalidade da proposta) — mesmos valores de
// backend/src/domain/propostasDominio.ts (MODPRO_LABELS).
const MODPRO_OPCOES: MultiSelectOption<number>[] = [
  { value: 0, label: "Serviço" },
  { value: 1, label: "Levantamento" },
  { value: 2, label: "DRM" },
];

const PAGE_SIZE = 30;

const currencyFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (v: number) => `R$ ${currencyFormatter.format(v)}`;

// Padding das células reduzido 30% em relação ao padrão do resto do app — tela com muitas colunas, densidade maior aqui de propósito.
const TH_CLASS = "bg-surface-2 px-[7px] py-[8px] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted";
const TH_CLASS_RIGHT = "bg-surface-2 px-[7px] py-[8px] text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted";

export function ListarPedidos() {
  const toast = useToast();
  const [visao, setVisao] = useState<Visao>("lista");
  const [indicadores, setIndicadores] = useState<PedidosIndicadoresData | null>(null);
  const [loadingIndicadores, setLoadingIndicadores] = useState(true);

  const [clienteInput, setClienteInput] = useState("");
  const clienteDebounced = useDebouncedValue(clienteInput, 350);
  const [numpedInput, setNumpedInput] = useState("");
  const numpedDebounced = useDebouncedValue(numpedInput, 350);
  const [numratInput, setNumratInput] = useState("");
  const numratDebounced = useDebouncedValue(numratInput, 350);
  const [codproInput, setCodproInput] = useState("");
  const codproDebounced = useDebouncedValue(codproInput, 350);
  // Pré-marcado com "Aberto Total" (1), "Aberto Parcial" (2) e "Não Fechado" (9) —
  // decisão do usuário, não existe valor "Digitado" no domínio real LSitPed.
  const [sitpedFiltro, setSitpedFiltro] = useState<number[]>([1, 2, 9]);
  const [modproFiltro, setModproFiltro] = useState<number[]>([]);
  // Emissão: "yyyy-mm-dd" ou "" (formato nativo do <input type="date">). Sem debounce
  // porque o input só emite a data completa — não há estado intermediário meio digitado.
  const [datemiDe, setDatemiDe] = useState("");
  const [datemiAte, setDatemiAte] = useState("");

  // Aba Lista: ListaServidor (TabelaPedidos) cuida de página, ordem, funil e totais; `recargaLista` força buscar de novo.
  const [recargaLista, setRecargaLista] = useState(0);

  // Padrão de cada filtro de lista (estrela): situação, modalidade e emissão. Aplicado uma vez ao abrir, antes da 1ª consulta.
  const p = usePadroesTela({
    tela: "mercado.pedidos",
    campos: {
      sitped: campoListaFixa("Situação", "number", sitpedFiltro, setSitpedFiltro, SITPED_OPCOES.map((o) => o.value)),
      modpro: campoListaFixa("Modalidade", "number", modproFiltro, setModproFiltro, MODPRO_OPCOES.map((o) => o.value)),
      emissao: campoParDatas("Emissão", datemiDe || null, datemiAte || null, (de, ate) => {
        setDatemiDe(de ?? "");
        setDatemiAte(ate ?? "");
      }),
    },
  });

  const [pageCliente, setPageCliente] = useState(1);
  // Índice de TODOS os pedidos do filtro atual (ver GET /pedidos/por-cliente/indice).
  // Os grupos da aba passam a ser derivados dele, não de uma chamada agregada: só assim
  // dá pra recalcular Qtd./Valor de cada accordion depois do filtro de coluna e esconder
  // cliente que ficou sem resultado.
  const [indice, setIndice] = useState<PedidoIndice[]>([]);
  const [nomesClientes, setNomesClientes] = useState<Record<number, string>>({});
  const [loadingClientes, setLoadingClientes] = useState(true);
  const [clientesExpandidos, setClientesExpandidos] = useState<Set<number>>(new Set());
  // Contador de recarga da tabela de cada cliente aberto (depois do "Sinc. ERP" dele): a tabela busca de novo quando o número muda.
  const [recargaCliente, setRecargaCliente] = useState<Record<number, number>>({});
  // Clientes com "Sinc. ERP" rodando agora — Set (e não um único codcli) porque dá pra
  // disparar a sincronização de vários clientes da lista sem esperar o anterior acabar.
  const [sincronizandoClientes, setSincronizandoClientes] = useState<Set<number>>(new Set());
  // Sincronização do filtro inteiro: o POST só dispara (202) e o resultado chega por
  // polling em /sincronizar/status — o lote pode passar de minutos, muito além do
  // timeout do nginx (ver comentário na rota, backend/src/routes/pedidos.ts).
  const [sincronizandoFiltro, setSincronizandoFiltro] = useState(false);
  const pollingRef = useRef<number | null>(null);

  const [erro, setErro] = useState<string | null>(null);

  // Filtros mandados pras rotas de listagem e pro disparo da sincronização do filtro —
  // centralizado pra "o que a tela mostra" e "o que a sincronização vai buscar" nunca
  // divergirem. (A rota de itens de um cliente ignora `cliente`, já escopada pelo path.)
  function paramsFiltros() {
    return {
      cliente: clienteDebounced || undefined,
      numped: numpedDebounced || undefined,
      numrat: numratDebounced || undefined,
      codpro: codproDebounced || undefined,
      sitped: sitpedFiltro.length > 0 ? sitpedFiltro.join(",") : undefined,
      modpro: modproFiltro.length > 0 ? modproFiltro.join(",") : undefined,
      datemiDe: datemiDe || undefined,
      datemiAte: datemiAte || undefined,
    };
  }

  function carregarPorCliente() {
    setLoadingClientes(true);
    axios
      .get("/api/pedidos/por-cliente/indice", { params: paramsFiltros() })
      .then(({ data }) => {
        setIndice(data.pedidos);
        setNomesClientes(Object.fromEntries((data.clientes as { codcli: number; nome: string }[]).map((c) => [c.codcli, c.nome])));
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar clientes"))
      .finally(() => setLoadingClientes(false));
  }

  function carregarIndicadores() {
    setLoadingIndicadores(true);
    axios
      .get("/api/pedidos/indicadores")
      .then(({ data }) => setIndicadores(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar indicadores"))
      .finally(() => setLoadingIndicadores(false));
  }

  // Indicadores do "Dash" refletem sempre a base inteira, não os filtros das outras
  // abas (mesmo comportamento de /atividades/indicadores em relação à lista de
  // Atividades) — por isso carrega só uma vez ao montar, fora dos effects de filtro.
  useEffect(() => {
    carregarIndicadores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cada aba só busca o próprio dado quando está ativa (a Lista, pelo TabelaPedidos).
  // Sem `pageCliente` nas dependências: a aba Por Cliente carrega o índice inteiro do
  // filtro de uma vez e pagina no cliente, porque o filtro de coluna tem que ser aplicado
  // antes de fatiar as páginas.
  useEffect(() => {
    if (visao === "cliente" && p.pronto) carregarPorCliente();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visao, p.pronto, clienteDebounced, numpedDebounced, numratDebounced, codproDebounced, sitpedFiltro, modproFiltro, datemiDe, datemiAte]);

  // Digitar ou trocar filtro reseta as duas paginações pra página 1 (senão a busca pode
  // "sumir" numa página que não existe mais) e colapsa qualquer cliente expandido — a tabela
  // dele refletiria o filtro antigo, inconsistente com a contagem nova do grupo.
  useEffect(() => {
    setPageCliente(1);
    setClientesExpandidos(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteDebounced, numpedDebounced, numratDebounced, codproDebounced, sitpedFiltro, modproFiltro, datemiDe, datemiAte]);

  // Alcance da sincronização global: quem o BACKEND vai sincronizar. Ele só conhece os
  // filtros da barra — os de coluna são client-side —, então este número ignora os funis
  // de propósito, pra não prometer um recorte que o disparo não faz.
  const totalClientesFiltro = useMemo(() => new Set(indice.map((p) => p.codcli)).size, [indice]);

  // Grupos recalculados a partir do índice já filtrado: Qtd. e Valor Líquido de cada
  // accordion refletem só os pedidos visíveis. Cliente que ficou sem nenhum pedido
  // simplesmente não entra na lista — some da tela, mesmo tratamento que a aba já dá
  // quando um filtro da barra não casa com ninguém ("Nenhum cliente encontrado"), em vez
  // de deixar linha com contagem 0 que não abre nada.
  const grupos = useMemo<ClienteGrupo[]>(() => {
    const porCliente = new Map<number, { quantidade: number; valorLiquido: number }>();
    for (const p of indice) {
      const bucket = porCliente.get(p.codcli) ?? { quantidade: 0, valorLiquido: 0 };
      bucket.quantidade += 1;
      bucket.valorLiquido += p.vlrliq ?? 0;
      porCliente.set(p.codcli, bucket);
    }
    return [...porCliente.entries()]
      .map(([codcli, bucket]) => ({ codcli, nome: nomesClientes[codcli] ?? String(codcli), ...bucket }))
      .sort((a, b) => b.valorLiquido - a.valorLiquido);
  }, [indice, nomesClientes]);

  // Paginação passou a ser client-side: o filtro de coluna precisa ser aplicado ANTES de
  // paginar, senão a página 1 mostraria os clientes de sempre com contagens filtradas.
  const clientes = useMemo(
    () => grupos.slice((pageCliente - 1) * PAGE_SIZE, pageCliente * PAGE_SIZE),
    [grupos, pageCliente]
  );

  function toggleExpandirCliente(cliente: ClienteGrupo) {
    setClientesExpandidos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(cliente.codcli)) {
        proximo.delete(cliente.codcli);
      } else {
        proximo.add(cliente.codcli);
      }
      return proximo;
    });
  }

  // Puxa do Senior, na hora, todos os pedidos deste cliente (POST .../sincronizar) e
  // recarrega a tela com o resultado (a tabela do cliente, se aberta, busca de novo).
  async function sincronizarCliente(cliente: ClienteGrupo) {
    if (sincronizandoClientes.has(cliente.codcli)) return;
    setSincronizandoClientes((s) => new Set(s).add(cliente.codcli));
    try {
      const { data } = await axios.post(`/api/pedidos/por-cliente/${cliente.codcli}/sincronizar`);
      toast.mostrar(
        `${cliente.nome}: ${data.total} pedido(s) no Senior — ${data.criados} novo(s), ${data.atualizados} atualizado(s).`,
        "success"
      );
      carregarPorCliente();
      // Tabela do cliente (se estiver aberta) busca de novo; fechada, busca ao abrir.
      setRecargaCliente((r) => ({ ...r, [cliente.codcli]: (r[cliente.codcli] ?? 0) + 1 }));
    } catch (err) {
      const mensagem = axios.isAxiosError(err) ? err.response?.data?.error : null;
      toast.mostrar(mensagem ?? "Falha ao sincronizar os pedidos deste cliente com o ERP", "destructive");
    } finally {
      setSincronizandoClientes((s) => {
        const proximo = new Set(s);
        proximo.delete(cliente.codcli);
        return proximo;
      });
    }
  }

  function pararPolling() {
    if (pollingRef.current != null) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  // Acompanha a sincronização do filtro até acabar. Chamado tanto logo após o disparo
  // quanto ao entrar na aba com um lote já rodando (outra aba do navegador, F5 no meio,
  // ou outro admin) — por isso é idempotente.
  function acompanharSincronizacaoFiltro() {
    if (pollingRef.current != null) return;
    pollingRef.current = window.setInterval(() => {
      axios
        .get("/api/pedidos/sincronizar/status")
        .then(({ data }) => {
          if (data.emAndamento) return;
          pararPolling();
          setSincronizandoFiltro(false);

          if (data.erro) {
            toast.mostrar(`Falha na sincronização do filtro: ${data.erro}`, "destructive");
          } else if (data.resultado) {
            toast.mostrar(
              `${data.totalClientes} cliente(s) sincronizado(s): ${data.resultado.total} pedido(s) — ` +
                `${data.resultado.criados} novo(s), ${data.resultado.atualizados} atualizado(s).`,
              "success"
            );
          }

          // Toda a listagem pode ter mudado (pedidos novos entram em grupos, valores
          // somados mudam), então recarrega o agrupamento.
          // Colapsa os grupos abertos junto — mesmo comportamento de quando um filtro
          // muda, e evita reabrir tudo com dado velho.
          carregarPorCliente();
          setRecargaLista((n) => n + 1);
          setClientesExpandidos(new Set());
        })
        // Erro no polling é transitório (rede/deploy): não derruba o acompanhamento,
        // tenta de novo no próximo tick.
        .catch(() => {});
    }, 3000);
  }

  // Dispara a sincronização de TODOS os clientes do filtro atual (todas as páginas, não
  // só a visível) — os mesmos params que a listagem usa vão pro backend, que resolve a
  // lista de clientes do jeito idêntico.
  async function sincronizarFiltro() {
    if (sincronizandoFiltro) return;
    setSincronizandoFiltro(true);
    try {
      const { data } = await axios.post("/api/pedidos/sincronizar", null, { params: paramsFiltros() });
      toast.mostrar(`Sincronizando ${data.totalClientes} cliente(s) com o Senior — rodando em segundo plano.`, "neutral");
      acompanharSincronizacaoFiltro();
    } catch (err) {
      setSincronizandoFiltro(false);
      const mensagem = axios.isAxiosError(err) ? err.response?.data?.error : null;
      toast.mostrar(mensagem ?? "Falha ao disparar a sincronização do filtro", "destructive");
    }
  }

  // Ao abrir a aba Por Cliente, verifica se já existe lote rodando (outra aba, F5 no
  // meio, ou outro admin) pra tela refletir isso em vez de oferecer um disparo que o
  // backend recusaria com 409.
  useEffect(() => {
    if (visao !== "cliente" || sincronizandoFiltro) return;
    axios
      .get("/api/pedidos/sincronizar/status")
      .then(({ data }) => {
        if (!data.emAndamento) return;
        setSincronizandoFiltro(true);
        acompanharSincronizacaoFiltro();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visao]);

  useEffect(() => pararPolling, []);

  const tabClass = (ativa: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      ativa ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
    }`;

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Mercado · Listar Pedidos</p>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Listar Pedidos</h1>
          <p className="mt-1 text-sm text-muted">Pedidos importados do Senior (E120PED).</p>
        </div>
        <div className="flex flex-wrap gap-2 rounded-md border border-border p-1">
          <button onClick={() => setVisao("lista")} className={tabClass(visao === "lista")}>
            Lista
          </button>
          <button onClick={() => setVisao("cliente")} className={tabClass(visao === "cliente")}>
            Por Cliente
          </button>
          <button onClick={() => setVisao("dash")} className={tabClass(visao === "dash")}>
            Dash
          </button>
        </div>
      </div>

      {erro && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {erro}
        </div>
      )}

      {visao !== "dash" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={clienteInput}
            onChange={(e) => setClienteInput(e.target.value)}
            placeholder="Buscar cliente..."
            className="w-56 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            value={numpedInput}
            onChange={(e) => setNumpedInput(e.target.value)}
            placeholder="Nro. do pedido... (separe por vírgula)"
            className="w-40 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            value={numratInput}
            onChange={(e) => setNumratInput(e.target.value)}
            placeholder="Nro. da RAT... (separe por vírgula)"
            className="w-40 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            value={codproInput}
            onChange={(e) => setCodproInput(e.target.value)}
            placeholder="Nro. da proposta... (separe por vírgula)"
            className="w-40 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <MultiSelectDropdown
            opcoes={SITPED_OPCOES}
            selecionados={sitpedFiltro}
            onChange={setSitpedFiltro}
            labelTodos="Todas as situações"
            labelSufixo="situações"
            acessorio={p.estrela("sitped")}
          />
          <MultiSelectDropdown
            opcoes={MODPRO_OPCOES}
            selecionados={modproFiltro}
            onChange={setModproFiltro}
            labelTodos="Todas as modalidades"
            labelSufixo="modalidades"
            acessorio={p.estrela("modpro")}
          />
          {/* Emissão: os dois limites são independentes — preencher só um já filtra
              (a partir de / até). O `max`/`min` cruzado impede escolher um intervalo
              invertido, que só retornaria lista vazia. */}
          <MolduraFiltro rotulo="Emissão:" acessorio={p.estrela("emissao")}>
            <input
              type="date"
              value={datemiDe}
              max={datemiAte || undefined}
              onChange={(e) => setDatemiDe(e.target.value)}
              title="Emitidos a partir desta data"
              className={DATA_EMBUTIDA}
            />
            <span className="text-sm text-muted">–</span>
            <input
              type="date"
              value={datemiAte}
              min={datemiDe || undefined}
              onChange={(e) => setDatemiAte(e.target.value)}
              title="Emitidos até esta data"
              className={DATA_EMBUTIDA}
            />
            {(datemiDe || datemiAte) && (
              <button
                onClick={() => {
                  setDatemiDe("");
                  setDatemiAte("");
                }}
                title="Limpar o período"
                className="text-sm leading-none text-muted hover:text-foreground"
              >
                ×
              </button>
            )}
          </MolduraFiltro>
          {/* Ação global da aba Por Cliente: alcança TODOS os clientes do filtro da barra
              (as outras páginas também), por isso o contador vem de totalClientesFiltro e
              não do tamanho da página nem do recorte dos funis. */}
          {visao === "cliente" && (
            <button
              onClick={sincronizarFiltro}
              disabled={sincronizandoFiltro || loadingClientes || totalClientesFiltro === 0}
              title="Puxa do Senior os pedidos de todos os clientes que batem com os filtros da barra, incluindo os das próximas páginas (os filtros de coluna não entram nesta ação)"
              className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sincronizandoFiltro
                ? "Sincronizando com o ERP..."
                : `Sinc. ERP — ${totalClientesFiltro} cliente${totalClientesFiltro === 1 ? "" : "s"} do filtro`}
            </button>
          )}
        </div>
      )}

      {visao === "dash" && <PedidosDashboard dados={indicadores} loading={loadingIndicadores} />}

      {visao === "lista" && p.pronto && <TabelaPedidos params={paramsFiltros()} recarga={recargaLista} />}

      {visao === "cliente" && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="overflow-x-auto">
            {/* table-fixed + colgroup em vez de deixar o browser dimensionar pelo conteúdo:
                a largura sai do colgroup e ponto, sem depender de como cada engine concilia
                width/max-width numa célula. Cliente ganha 44rem (cabe a maior razão social
                da base: 75 caracteres, quase toda em caixa alta), Ações o suficiente pro
                "Sinc. ERP", e as duas colunas sem largura dividem toda a sobra em partes
                iguais — é isso que espalha Qtd. Pedidos e Valor Líquido. */}
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col className="w-[44rem]" />
                <col />
                <col />
                <col className="w-[7rem]" />
              </colgroup>
              <thead>
                <tr>
                  <th className={TH_CLASS}>
                    <span className="inline-flex items-center gap-2">
                      Cliente
                    </span>
                  </th>
                  <th className={`${TH_CLASS_RIGHT} whitespace-nowrap`}>Qtd. Pedidos</th>
                  <th className={`${TH_CLASS_RIGHT} whitespace-nowrap`}>Valor Líquido</th>
                  <th className={`${TH_CLASS_RIGHT} whitespace-nowrap`}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {loadingClientes &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="px-[7px] py-[10px]" colSpan={4}>
                        <Skeleton className="h-6 w-full" />
                      </td>
                    </tr>
                  ))}
                {!loadingClientes &&
                  clientes.map((c) => {
                    const expandida = clientesExpandidos.has(c.codcli);
                    const sincronizando = sincronizandoClientes.has(c.codcli);
                    return (
                      <Fragment key={c.codcli}>
                        <tr
                          onClick={() => toggleExpandirCliente(c)}
                          className={`cursor-pointer transition ${
                            expandida ? "border-t border-primary bg-primary/5" : "border-t border-border/60 hover:bg-surface-2"
                          }`}
                        >
                          {/* Sem width aqui: com table-fixed quem manda é o colgroup, e a
                              célula já tem largura definida — é o que faz o truncate do
                              nome cortar em 44rem em vez de esticar a tabela. */}
                          <td className={`px-[7px] py-[10px] ${expandida ? "border-l border-primary" : ""}`}>
                            <p className="flex items-center gap-2 truncate whitespace-nowrap text-sm font-semibold text-foreground" title={c.nome}>
                              <span className="shrink-0 text-muted">{expandida ? "▾" : "▸"}</span>
                              <span className="truncate">{c.nome}</span>
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-[7px] py-[10px] text-right font-mono text-sm tabular-nums text-muted">
                            {c.quantidade}
                          </td>
                          <td className="whitespace-nowrap px-[7px] py-[10px] text-right font-mono text-sm tabular-nums text-foreground">
                            {formatMoney(c.valorLiquido)}
                          </td>
                          {/* stopPropagation: a linha inteira é o toggle de expandir — sem isso,
                              sincronizar também abriria/fecharia o grupo. */}
                          <td
                            className={`whitespace-nowrap px-[7px] py-[10px] text-right ${expandida ? "border-r border-primary" : ""}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => sincronizarCliente(c)}
                              disabled={sincronizando || sincronizandoFiltro}
                              title="Puxa do Senior todos os pedidos deste cliente, sem esperar a sincronização diária"
                              className="text-sm text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {sincronizando ? "Sincronizando..." : "Sinc. ERP"}
                            </button>
                          </td>
                        </tr>
                        {expandida && (
                          <tr className="border-t border-border/60 bg-surface-2/40">
                            <td colSpan={4} className="border-b border-l border-r border-primary px-[7px] py-3">
                              {/* Tabela do padrão (a mesma da aba Lista), só deste cliente: filtro, ordem e colunas próprios. */}
                              <TabelaPedidos
                                chave="mercado.pedidos.por-cliente"
                                semCliente
                                params={{ ...paramsFiltros(), cliente: undefined, codcli: c.codcli }}
                                recarga={recargaCliente[c.codcli] ?? 0}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                {!loadingClientes && clientes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-[7px] py-8 text-center text-sm text-muted">
                      Nenhum cliente encontrado com esses filtros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={pageCliente}
            pageSize={PAGE_SIZE}
            total={grupos.length}
            loading={loadingClientes}
            onPageChange={setPageCliente}
            label="clientes"
          />
        </div>
      )}
    </div>
  );
}
