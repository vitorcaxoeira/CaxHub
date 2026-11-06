import axios from "axios";
import { Fragment, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { MultiSelectDropdown, MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { ListaServidor, type Resposta } from "../../components/colunas/ListaServidor";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { KpiCard } from "../../components/ui/KpiCard";
import { Skeleton } from "../../components/ui/Skeleton";
import { toneBadge } from "../../components/ui/badges";
import { formatHoras } from "../../utils/horas";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useSincronizarErp } from "../../hooks/useSincronizarErp";
import { useToast } from "../../components/ui/Toast";
import { DropdownMenu } from "../../components/ui/DropdownMenu";
import { CaixaMarcacaoFiltro } from "../../components/ui/ControlesFiltro";
import { regras } from "../../components/ui/padroesFiltros/regras";
import { usePadroesTela } from "../../components/ui/padroesFiltros/usePadroesTela";

interface OpcaoFiltro {
  value: number;
  label: string;
}

interface PropostaRow {
  codemp: number;
  codpro: number;
  numprj: number;
  cliente: string;
  despro: string | null;
  sitpro: number | null;
  sitproLabel: string;
  sitproTone: "success" | "warning" | "destructive" | "neutral";
  // "Data de Retorno" no Senior — não existe campo de "data de aprovação" na origem, e esta
  // tela só lista propostas Aprovada/Em Execução (SITPRO_ALOCAVEL), então datret já é a data
  // da aprovação pra toda linha aqui.
  datret: string | null;
  depexeLabel: string;
  /** Dep. Custo/Rec. distintos dos itens da proposta (o depexeLabel acima é o da proposta). */
  depcusrecLista: string[];
  depcusrecLabel: string;
  modproLabel: string;
  totalItens: number;
  qtdhorTotal: number;
  horasAlocadas: number;
  saldo: number;
  // false = proposta fora de Aprovada/Em Execução, trazida só pela busca por número exato
  // (ver GET /alocacao/propostas): só o Sync. ERP faz sentido nela.
  alocavel: boolean;
}

interface ConsultorResumo {
  codfor: number;
  nome: string;
  depexeLabel: string;
  horasAlocadas: number;
  horasExcedentes: number;
  horasRealizadas: number;
  saldo: number;
}

interface KpiValor {
  quantidade: number;
  horas: number;
}

interface KpisResumo {
  totalNoEscopo: number;
  semAlocacao: KpiValor;
  saldoPendente: KpiValor;
  totalmenteAlocadas: KpiValor;
  compartilhadasEmAberto: KpiValor;
  horasDivergentes: KpiValor;
}

type Situacao = "semAlocacao" | "saldoPendente" | "totalmenteAlocadas" | "compartilhadasEmAberto" | "horasDivergentes";

const PAGE_SIZE = 20;

// Domínio "USU_ModPro" do Senior (modalidade da proposta) — mesmos valores de
// backend/src/domain/propostasDominio.ts (MODPRO_LABELS) e de MODPRO_OPCOES em
// ListarPedidos.tsx.
const MODPRO_OPCOES: MultiSelectOption<number>[] = [
  { value: 0, label: "Serviço" },
  { value: 1, label: "Levantamento" },
  { value: 2, label: "DRM" },
];

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
function formatData(valor: string | null): string {
  return valor ? dateFormatter.format(new Date(valor)) : "—";
}

// Sem o sufixo " h" do formatHoras — nas colunas Total/Alocado/Saldo dessa tabela ele
// forçava quebra de linha (espaço antes do "h") em colunas já estreitas; o cabeçalho já
// deixa claro que é hora, não precisa repetir por linha.
const formatHorasCompacto = (horasDecimais: number) => formatHoras(horasDecimais).replace(/ h$/, "");

// Ponto de entrada da área de Alocação: controle sempre por proposta (uma proposta com
// muitos itens ficava perdida num feed único de itens misturados de propostas
// diferentes) — aqui cada linha é uma proposta, com o total/alocado/saldo agregado;
// o detalhe item-a-item fica na tela seguinte (AlocacaoPropostaDetalhe.tsx).
interface AcoesAlocacao {
  navegar: (rota: string) => void;
  sincronizar: (row: PropostaRow) => void;
  estaSincronizando: (chave: string) => boolean;
}

// Lista de propostas com filtro e ordem por coluna, colunas configuráveis, resumo no rodapé e colunas calculadas (ListaServidor + lista em
// memória no servidor, 03/11/2026). Escopo de departamento, KPIs e filtros do topo continuam no servidor. A linha abre os consultores.
const horas = (minutos: number) => formatHorasCompacto(minutos / 60);
const COLUNAS_ALOCACAO: DefColuna<PropostaRow, AcoesAlocacao>[] = [
  {
    nome: "codpro",
    titulo: "Proposta",
    fixa: true,
    largura: 150,
    resumos: ["contagem", "distintos"],
    render: (row, a) => (
      // Número (e o aviso "Fora do recorte", quando houver) numa linha só: sem nowrap o aviso desce sozinho e a linha dobra de altura. A situação da proposta tem coluna própria.
      <p className="flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-foreground">
        <button
          onClick={(e) => {
            e.stopPropagation();
            a.navegar(`/projetos/proposta/${row.codemp}/${row.codpro}`);
          }}
          className="text-primary hover:underline"
        >
          {row.codpro}
        </button>
        {!row.alocavel && (
          <span
            className={`rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium ${toneBadge.warning}`}
            title="Situação fora do recorte de alocação (Aprovada/Em Execução) — rode o Sync. ERP para atualizar"
          >
            Fora do recorte
          </span>
        )}
      </p>
    ),
  },
  {
    nome: "sitproLabel",
    titulo: "Situação",
    largura: 130,
    texto: (r) => r.sitproLabel,
    render: (r) => (
      <span className={`inline-block max-w-full truncate whitespace-nowrap align-bottom rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium ${toneBadge[r.sitproTone]}`} title={r.sitproLabel}>
        {r.sitproLabel}
      </span>
    ),
  },
  { nome: "numprj", ocultaPorPadrao: true, titulo: "Projeto", largura: 90, classe: "font-mono text-sm text-muted", render: (r) => r.numprj || "—" },
  { nome: "cliente", titulo: "Cliente", largura: 200, classe: "text-sm text-foreground", texto: (r) => r.cliente, render: (r) => r.cliente },
  { nome: "datret", titulo: "Data Aprovação", largura: 110, classe: "text-sm text-muted", render: (r) => formatData(r.datret) },
  { nome: "despro", titulo: "Descrição", largura: 200, classe: "text-sm text-muted", texto: (r) => r.despro, render: (r) => r.despro ?? "—" },
  {
    nome: "depexeLabel",
    titulo: "Departamento",
    largura: 160,
    render: (r) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.neutral}`}>{r.depexeLabel}</span>,
  },
  {
    // Dep. Custo/Rec. dos ITENS da proposta (05/11/2026): os distintos, um selo por departamento, logo depois do Departamento da proposta.
    nome: "depcusrecLabel",
    titulo: "Dep. Custo/Rec.",
    dica: "Departamentos de Custo/Receita distintos dos itens da proposta",
    largura: 190,
    texto: (r) => r.depcusrecLabel,
    render: (r) =>
      r.depcusrecLista.length === 0 ? (
        <span className="text-muted">—</span>
      ) : (
        <span className="flex gap-1 whitespace-nowrap">
          {r.depcusrecLista.map((d) => (
            <span key={d} className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.neutral}`}>
              {d}
            </span>
          ))}
        </span>
      ),
  },
  {
    nome: "modproLabel",
    titulo: "Modalidade",
    largura: 130,
    render: (r) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.neutral}`}>{r.modproLabel}</span>,
  },
  { nome: "totalItens", titulo: "Itens", direita: true, largura: 70, classe: "font-mono text-sm tabular-nums text-muted", render: (r) => r.totalItens },
  { nome: "qtdhorTotal", titulo: "Total", direita: true, largura: 90, classe: "font-mono text-sm tabular-nums text-muted", formatarResumo: horas, render: (r) => horas(r.qtdhorTotal) },
  { nome: "horasAlocadas", titulo: "Alocado", direita: true, largura: 90, classe: "font-mono text-sm tabular-nums text-muted", formatarResumo: horas, render: (r) => horas(r.horasAlocadas) },
  {
    nome: "saldo",
    titulo: "Saldo",
    direita: true,
    largura: 90,
    classe: (r) => `font-mono text-sm tabular-nums ${r.saldo < 0 ? "text-destructive" : "text-foreground"}`,
    formatarResumo: horas,
    render: (r) => horas(r.saldo),
  },
  {
    nome: "acoes",
    titulo: "Ações",
    semOrdenar: true,
    direita: true,
    largura: 60,
    render: (row, a) => {
      const chave = `${row.codemp}-${row.codpro}`;
      return (
        <span onClick={(e) => e.stopPropagation()}>
          <DropdownMenu placement="bottom-end">
            <DropdownMenu.Trigger>
              <button
                className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Ações da proposta"
              >
                ⋯
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item onSelect={() => a.sincronizar(row)} disabled={a.estaSincronizando(chave)}>
                {a.estaSincronizando(chave) ? "Sincronizando..." : "Sync. ERP"}
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => a.navegar(`/projetos/alocacao/${row.codemp}/${row.codpro}/cronograma`)} disabled={!row.alocavel}>
                Cronograma
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        </span>
      );
    },
  },
];

const TH_SUB = "whitespace-nowrap py-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted";

/** Consultores alocados numa proposta (linha aberta da lista): quanto cada um tem alocado, excedente, realizado e saldo. */
function ConsultoresDaProposta({ row }: { row: PropostaRow }) {
  const [consultores, setConsultores] = useState<ConsultorResumo[] | "carregando" | "erro">("carregando");
  useEffect(() => {
    let cancelado = false;
    axios
      .get(`/api/alocacao/propostas/${row.codemp}/${row.codpro}/consultores`)
      .then(({ data }) => !cancelado && setConsultores(data.consultores))
      .catch(() => !cancelado && setConsultores("erro"));
    return () => {
      cancelado = true;
    };
  }, [row.codemp, row.codpro]);

  if (consultores === "carregando") return <p className="py-2 text-sm text-muted">Carregando consultores...</p>;
  if (consultores === "erro") return <p className="py-2 text-sm text-destructive">Falha ao carregar consultores desta proposta.</p>;
  if (consultores.length === 0) return <p className="py-2 text-sm text-muted">Ninguém alocado ainda nesta proposta.</p>;
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={`${TH_SUB} text-left`}>Consultor</th>
          <th className={`${TH_SUB} text-left`}>Nome Consultor</th>
          <th className={`${TH_SUB} text-left`}>Departamento</th>
          <th className={`${TH_SUB} text-right`}>Horas Alocada</th>
          <th className={`${TH_SUB} text-right`}>Excedente</th>
          <th className={`${TH_SUB} text-right`}>Realizado</th>
          <th className={`${TH_SUB} text-right`}>Saldo</th>
          <th className={`${TH_SUB} text-right`}>% do Alocado</th>
        </tr>
      </thead>
      <tbody>
        {consultores.map((c) => {
          const pct = row.horasAlocadas > 0 ? Math.round((c.horasAlocadas / row.horasAlocadas) * 100) : 0;
          return (
            <tr key={c.codfor} className="border-t border-border/40">
              <td className="whitespace-nowrap py-1.5 font-mono text-[12.5px] tabular-nums text-muted">{c.codfor}</td>
              <td className="whitespace-nowrap py-1.5 text-[12.5px] text-foreground">{c.nome}</td>
              <td className="whitespace-nowrap py-1.5">
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.neutral}`}>{c.depexeLabel}</span>
              </td>
              <td className="whitespace-nowrap py-1.5 text-right font-mono text-[12.5px] tabular-nums text-foreground">{formatHoras(c.horasAlocadas / 60)}</td>
              <td className="whitespace-nowrap py-1.5 text-right font-mono text-[12.5px] tabular-nums text-muted">
                {c.horasExcedentes > 0 ? formatHoras(c.horasExcedentes / 60) : "—"}
              </td>
              <td className="whitespace-nowrap py-1.5 text-right font-mono text-[12.5px] tabular-nums text-muted">{formatHoras(c.horasRealizadas / 60)}</td>
              <td className={`whitespace-nowrap py-1.5 text-right font-mono text-[12.5px] tabular-nums ${c.saldo < 0 ? "text-destructive" : "text-foreground"}`}>
                {formatHoras(c.saldo / 60)}
              </td>
              <td className="whitespace-nowrap py-1.5 pl-4">
                <div className="flex items-center justify-end gap-2">
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted/20">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-9 font-mono text-[11px] tabular-nums text-muted">{pct}%</span>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Alocacao() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { sincronizar, estaSincronizando } = useSincronizarErp<{
    ok: boolean;
    encontrada: boolean;
    totalItens: number;
    totalAtividades: number;
  }>();
  // Filtros ficam sincronizados na URL — assim, ao voltar da tela de detalhe da
  // proposta (via histórico do navegador), a lista reaparece com os mesmos filtros
  // em vez de resetar.
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<PropostaRow[]>([]);
  const [kpis, setKpis] = useState<KpisResumo | null>(null);
  const [departamentos, setDepartamentos] = useState<OpcaoFiltro[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPageState] = useState(Number(searchParams.get("page")) || 1);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);

  // Number("") é 0 (não NaN) — sem o parâmetro na URL, split(",") vira [""] e viraria
  // erroneamente [0] ("Diretoria" selecionado) em vez de "todos" se não checar antes.
  const depexeParam = searchParams.get("depexe");
  const depexeInicial = depexeParam
    ? depexeParam
        .split(",")
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n))
    : [];
  const [depexe, setDepexeState] = useState<number[]>(depexeInicial);
  const codforParam = searchParams.get("codfor");
  const codforInicial = codforParam
    ? codforParam
        .split(",")
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n))
    : [];
  const [codfor, setCodforState] = useState<number[]>(codforInicial);
  const [busca, setBuscaState] = useState(searchParams.get("busca") ?? "");
  // Digitar atualiza a caixa na hora; a busca pesada (2 queries sem filtro seletivo no
  // banco) só dispara 350ms depois de parar de digitar — sem isso, cada tecla repetia
  // o carregamento completo do escopo do usuário.
  const [buscaInput, setBuscaInput] = useState(busca);
  const buscaDebounced = useDebouncedValue(buscaInput, 350);
  // Nº da proposta pro "Sync. ERP" avulso (28/08/2026) — diferente da busca acima (que só
  // filtra o que já está carregado), este dispara uma sincronização real contra o Senior
  // pra um número que o CaxHub pode nunca ter visto. Chave fixa "avulso" no
  // useSincronizarErp, sem colisão com as chaves por linha (`${codemp}-${codpro}`).
  const [codproDigitado, setCodproDigitado] = useState("");
  const [apenasComSaldo, setApenasComSaldoState] = useState(searchParams.get("apenasComSaldo") !== "false");
  const modproParam = searchParams.get("modpro");
  const modproInicial = modproParam
    ? modproParam
        .split(",")
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n))
    : [];
  const [modpro, setModproState] = useState<number[]>(modproInicial);
  const situacoesValidas: Situacao[] = [
    "semAlocacao",
    "saldoPendente",
    "totalmenteAlocadas",
    "compartilhadasEmAberto",
    "horasDivergentes",
  ];
  const situacaoInicial = situacoesValidas.includes(searchParams.get("situacao") as Situacao)
    ? (searchParams.get("situacao") as Situacao)
    : null;
  const [situacao, setSituacaoState] = useState<Situacao | null>(situacaoInicial);

  function atualizarFiltros(
    patch: Partial<{
      depexe: number[];
      codfor: number[];
      modpro: number[];
      busca: string;
      apenasComSaldo: boolean;
      situacao: Situacao | null;
      page: number;
    }>
  ) {
    const mudouFiltro =
      patch.depexe !== undefined ||
      patch.codfor !== undefined ||
      patch.modpro !== undefined ||
      patch.busca !== undefined ||
      patch.apenasComSaldo !== undefined ||
      patch.situacao !== undefined;
    const proximo = {
      depexe: patch.depexe ?? depexe,
      codfor: patch.codfor ?? codfor,
      modpro: patch.modpro ?? modpro,
      busca: patch.busca ?? busca,
      apenasComSaldo: patch.apenasComSaldo ?? apenasComSaldo,
      situacao: patch.situacao !== undefined ? patch.situacao : situacao,
      page: patch.page ?? (mudouFiltro ? 1 : page),
    };
    setDepexeState(proximo.depexe);
    setCodforState(proximo.codfor);
    setModproState(proximo.modpro);
    setBuscaState(proximo.busca);
    setApenasComSaldoState(proximo.apenasComSaldo);
    setSituacaoState(proximo.situacao);
    setPageState(proximo.page);

    const params = new URLSearchParams();
    if (proximo.depexe.length > 0) params.set("depexe", proximo.depexe.join(","));
    if (proximo.codfor.length > 0) params.set("codfor", proximo.codfor.join(","));
    if (proximo.modpro.length > 0) params.set("modpro", proximo.modpro.join(","));
    if (proximo.busca) params.set("busca", proximo.busca);
    if (!proximo.apenasComSaldo) params.set("apenasComSaldo", "false");
    if (proximo.situacao) params.set("situacao", proximo.situacao);
    if (proximo.page > 1) params.set("page", String(proximo.page));
    setSearchParams(params, { replace: true });
  }

  useEffect(() => {
    if (buscaDebounced !== busca) atualizarFiltros({ busca: buscaDebounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaDebounced]);

  // Clicar num KPI vira o único critério de "situação" da tabela abaixo (substitui o
  // checkbox de saldo enquanto ativo, e é a ÚNICA forma de ver as compartilhadas — não
  // tem mais checkbox manual pra isso) — clicar de novo no mesmo KPI desliga o filtro e
  // volta pro checkbox manual de saldo. Também realinha o checkbox "só com saldo
  // pendente" com o KPI escolhido, pra não ficarem contraditórios quando o filtro do KPI
  // for desligado depois (ex.: "100% alocadas" implica saldo=0, mas o checkbox pede
  // saldo>0).
  function clicarKpi(tipo: Situacao) {
    if (situacao === tipo) {
      atualizarFiltros({ situacao: null });
      return;
    }
    atualizarFiltros({ situacao: tipo, apenasComSaldo: tipo !== "totalmenteAlocadas" });
  }

  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const [consultoresPorProposta, setConsultoresPorProposta] = useState<
    Record<string, ConsultorResumo[] | "carregando" | "erro">
  >({});
  const [consultores, setConsultores] = useState<OpcaoFiltro[]>([]);
  const [deptosProntos, setDeptosProntos] = useState(false);
  const [consultoresProntos, setConsultoresProntos] = useState(false);
  const [opcoesFalharam, setOpcoesFalharam] = useState(false);

  useEffect(() => {
    if (!user) return;
    // Guarda de "efeito superado" (28/08/2026) — mesma classe de corrida já corrigida em
    // AuthContext.tsx e Sidebar.tsx: este efeito dispara de novo toda vez que `user` muda
    // (login/logout/troca de conta), e sem isso a resposta de uma sessão ANTERIOR podia
    // chegar depois de já estar logado como outra pessoa e preencher o filtro de
    // departamentos com o recorte de quem não é mais o usuário atual.
    let cancelado = false;
    const carregarDepartamentos =
      user.role === "admin"
        ? axios.get("/api/atividades/opcoes-filtro").then(({ data }) => data.departamentos as OpcaoFiltro[])
        : axios
            .get("/api/dashboard/meu-perfil")
            .then(
              ({ data }) =>
                (data.departamentosGerenciados ?? []).map((d: any) => ({ value: d.depexe, label: d.depexeLabel })) as OpcaoFiltro[]
            );

    carregarDepartamentos
      .then((departamentos) => {
        if (!cancelado) setDepartamentos(departamentos);
      })
      .catch(() => !cancelado && setOpcoesFalharam(true))
      .finally(() => !cancelado && setDeptosProntos(true));
    return () => {
      cancelado = true;
    };
  }, [user]);

  // Mesmo endpoint independente do papel — /opcoes-filtro já resolve internamente quem cada
  // pessoa deve ver (colegas de departamento pro gestor, todo mundo visível pro admin).
  useEffect(() => {
    axios
      .get("/api/atividades/opcoes-filtro")
      .then(({ data }) => setConsultores(data.consultores as OpcaoFiltro[]))
      .catch(() => setOpcoesFalharam(true))
      .finally(() => setConsultoresProntos(true));
  }, []);

  // Padrão de cada filtro (estrela, 03/11/2026): aplicado uma vez ao abrir, antes da 1ª consulta. O que veio na URL (voltar do detalhe
  // da proposta, link) vale mais. Setters direto no estado: atualizarFiltros lê o render atual e chamadas seguidas desfariam umas às outras.
  const [daUrlPadroes] = useState(() =>
    (["depexe", "codfor", "modpro", "apenasComSaldo"] as const).filter((c) => searchParams.has(c) || (c === "apenasComSaldo" && searchParams.has("situacao")))
  );
  const padroes = usePadroesTela({
    tela: "projetos.alocacao",
    opcoesProntas: deptosProntos && consultoresProntos,
    opcoesFalharam,
    daUrl: daUrlPadroes,
    campos: {
      depexe: { rotulo: "Departamento", atual: depexe, aplicar: setDepexeState, validar: regras.lista("number", departamentos.map((o) => o.value)) },
      codfor: { rotulo: "Consultor", atual: codfor, aplicar: setCodforState, validar: regras.lista("number", consultores.map((o) => o.value)) },
      modpro: {
        rotulo: "Modalidade",
        atual: modpro,
        aplicar: setModproState,
        validar: regras.lista("number", MODPRO_OPCOES.map((o) => o.value)),
        semOpcoes: true,
      },
      apenasComSaldo: {
        rotulo: "Só com saldo pendente",
        atual: apenasComSaldo,
        aplicar: setApenasComSaldoState,
        validar: regras.booleano(),
        semOpcoes: true,
      },
    },
  });

  // A lista (ListaServidor) busca sozinha; isto só força buscar de novo (depois de um Sync. ERP).
  const [recarga, setRecarga] = useState(0);
  const carregar = () => setRecarga((n) => n + 1);

  // "Sync. ERP" por número digitado (28/08/2026) — mesma rota da ação por linha, mas o
  // número pode não existir localmente ainda (codemp=1 fixo, única empresa hoje). Só
  // habilitado com o campo preenchido (ver disabled do botão no JSX).
  async function sincronizarPropostaAvulsa() {
    const codpro = codproDigitado.trim();
    if (!codpro) return;
    const resultado = await sincronizar("avulso", `/api/alocacao/propostas/1/${codpro}/sincronizar`);
    if (resultado.ok) {
      if (resultado.data.encontrada) {
        toast.mostrar(
          `Sincronizado — ${resultado.data.totalItens} item(ns), ${resultado.data.totalAtividades} atividade(s) de consultor`,
          "success"
        );
        // Traz a proposta recém-trazida pra tela na hora, sem o usuário precisar procurar.
        setBuscaInput(codpro);
        setCodproDigitado("");
        carregar();
      } else {
        toast.mostrar("Proposta não encontrada no Senior", "warning");
        setCodproDigitado("");
      }
    } else {
      // Mantém o campo preenchido (403 sem acesso ou 502 falha no Senior) — facilita
      // tentar de novo sem redigitar o número.
      toast.mostrar(resultado.erro, "destructive");
    }
  }

  function toggleExpandir(row: PropostaRow) {
    const chave = `${row.codemp}-${row.codpro}`;
    setExpandidas((atual) => {
      const next = new Set(atual);
      if (next.has(chave)) {
        next.delete(chave);
      } else {
        next.add(chave);
        if (!consultoresPorProposta[chave]) {
          setConsultoresPorProposta((c) => ({ ...c, [chave]: "carregando" }));
          axios
            .get(`/api/alocacao/propostas/${row.codemp}/${row.codpro}/consultores`)
            .then(({ data }) => setConsultoresPorProposta((c) => ({ ...c, [chave]: data.consultores })))
            .catch(() => setConsultoresPorProposta((c) => ({ ...c, [chave]: "erro" })));
        }
      }
      return next;
    });
  }

  const selectClass =
    "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (semAcesso) {
    return (
      <div>
        <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
          Gestão de Projetos · Alocação
        </p>
        <p className="rounded-md border border-border bg-surface p-6 text-sm text-muted">
          Esta área é só para quem gerencia algum departamento. Fale com um administrador se você acha que deveria ter
          acesso.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Gestão de Projetos · Alocação
      </p>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Alocação de Atividades</h1>
          <p className="mt-1 text-sm text-muted">
            Escolha uma proposta pra distribuir as horas dos itens dela entre os consultores do seu time.
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="Nº da proposta..."
            value={codproDigitado}
            onChange={(e) => setCodproDigitado(e.target.value)}
            className={`${selectClass} w-32`}
          />
          <button
            onClick={sincronizarPropostaAvulsa}
            disabled={codproDigitado.trim() === "" || estaSincronizando("avulso")}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            title="Sync. ERP — busca no Senior a proposta e os itens deste número"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={estaSincronizando("avulso") ? "animate-spin" : ""}
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-5">
              <Skeleton className="mb-2 h-3.5 w-24" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="mt-2 h-1 w-full" />
              <Skeleton className="mt-2 h-3 w-20" />
            </div>
          ))}
        </div>
      ) : (
        kpis && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard
            label="Sem alocação"
            tone="destructive"
            quantidade={kpis.semAlocacao.quantidade}
            total={kpis.totalNoEscopo}
            horas={kpis.semAlocacao.horas}
            horasLabel="previstas"
            ativo={situacao === "semAlocacao"}
            onClick={() => clicarKpi("semAlocacao")}
          />
          <KpiCard
            label="Saldo pendente"
            tone="warning"
            quantidade={kpis.saldoPendente.quantidade}
            total={kpis.totalNoEscopo}
            horas={kpis.saldoPendente.horas}
            horasLabel="restantes"
            ativo={situacao === "saldoPendente"}
            onClick={() => clicarKpi("saldoPendente")}
          />
          <KpiCard
            label="100% alocadas"
            tone="success"
            quantidade={kpis.totalmenteAlocadas.quantidade}
            total={kpis.totalNoEscopo}
            horas={kpis.totalmenteAlocadas.horas}
            horasLabel="alocadas"
            ativo={situacao === "totalmenteAlocadas"}
            onClick={() => clicarKpi("totalmenteAlocadas")}
          />
          <KpiCard
            label="Compartilhadas em aberto"
            tone="primary"
            quantidade={kpis.compartilhadasEmAberto.quantidade}
            total={kpis.totalNoEscopo}
            horas={kpis.compartilhadasEmAberto.horas}
            horasLabel="em aberto"
            ativo={situacao === "compartilhadasEmAberto"}
            onClick={() => clicarKpi("compartilhadasEmAberto")}
          />
          <KpiCard
            label="Horas divergentes"
            tone="warning"
            quantidade={kpis.horasDivergentes.quantidade}
            total={kpis.totalNoEscopo}
            horas={kpis.horasDivergentes.horas}
            horasLabel="fora de sincronia"
            ativo={situacao === "horasDivergentes"}
            onClick={() => clicarKpi("horasDivergentes")}
          />
        </div>
        )
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Buscar cliente ou proposta..."
          value={buscaInput}
          onChange={(e) => setBuscaInput(e.target.value)}
          className={`${selectClass} w-56`}
        />
        {departamentos.length > 1 && (
          <MultiSelectDropdown
            opcoes={departamentos}
            selecionados={depexe}
            onChange={(selecionados) => atualizarFiltros({ depexe: selecionados })}
            labelTodos="Todos os departamentos"
            labelSufixo="departamentos"
            acessorio={padroes.estrela("depexe")}
          />
        )}
        {consultores.length > 1 && (
          <MultiSelectDropdown
            opcoes={consultores}
            selecionados={codfor}
            onChange={(selecionados) => atualizarFiltros({ codfor: selecionados })}
            labelTodos="Todos os consultores"
            labelSufixo="consultores"
            acessorio={padroes.estrela("codfor")}
          />
        )}
        <MultiSelectDropdown
          opcoes={MODPRO_OPCOES}
          selecionados={modpro}
          onChange={(selecionados) => atualizarFiltros({ modpro: selecionados })}
          labelTodos="Todas as modalidades"
          labelSufixo="modalidades"
          acessorio={padroes.estrela("modpro")}
        />
        {situacao ? (
          <button
            onClick={() => atualizarFiltros({ situacao: null })}
            className="flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/25"
          >
            Filtro do KPI ativo <span aria-hidden>✕</span>
          </button>
        ) : (
          <>
            <CaixaMarcacaoFiltro
              marcado={apenasComSaldo}
              onChange={(marcado) => atualizarFiltros({ apenasComSaldo: marcado })}
              acessorio={padroes.estrela("apenasComSaldo")}
            >
              Só propostas com saldo pendente
            </CaixaMarcacaoFiltro>
          </>
        )}
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {padroes.pronto && (
        <ListaServidor<PropostaRow, AcoesAlocacao>
          chave="projetos.alocacao.propostas"
          url="/api/alocacao/propostas"
          params={{
            depexe: depexe.length > 0 ? depexe.join(",") : undefined,
            codfor: codfor.length > 0 ? codfor.join(",") : undefined,
            modpro: modpro.length > 0 ? modpro.join(",") : undefined,
            busca: busca || undefined,
            apenasComSaldo: apenasComSaldo || undefined,
            situacao: situacao || undefined,
          }}
          recarga={recarga}
          defs={COLUNAS_ALOCACAO}
          ctx={{
            navegar: navigate,
            estaSincronizando,
            sincronizar: async (row) => {
              const chave = `${row.codemp}-${row.codpro}`;
              const resultado = await sincronizar(chave, `/api/alocacao/propostas/${row.codemp}/${row.codpro}/sincronizar`);
              if (resultado.ok) {
                toast.mostrar(
                  resultado.data.encontrada
                    ? `Sincronizado — ${resultado.data.totalItens} item(ns), ${resultado.data.totalAtividades} atividade(s) de consultor`
                    : "Proposta não encontrada mais no Senior",
                  resultado.data.encontrada ? "success" : "warning"
                );
                carregar();
              } else {
                toast.mostrar(resultado.erro, "destructive");
              }
            },
          }}
          chaveLinha={(r) => `${r.codemp}-${r.codpro}`}
          detalhe={(r) => <ConsultoresDaProposta row={r} />}
          rotulo="propostas"
          vazio="Nenhuma proposta encontrada com os filtros atuais."
          pageSize={PAGE_SIZE}
          opcoesPorPagina={[PAGE_SIZE, 50, 100, 200]}
          aoCarregar={(d) => {
            setKpis((d as Resposta<PropostaRow> & { kpis: KpisResumo }).kpis);
            setLoading(false);
            setErro(null);
            setSemAcesso(false);
          }}
          aoErro={(status) => {
            setLoading(false);
            if (status === 403) setSemAcesso(true);
          }}
        />
      )}
    </div>
  );
}
