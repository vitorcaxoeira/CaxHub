import axios from "axios";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ListaServidor } from "../../components/colunas/ListaServidor";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { SelectFiltro } from "../../components/ui/ControlesFiltro";
import { DropdownMenu } from "../../components/ui/DropdownMenu";
import { Modal } from "../../components/ui/Modal";
import { MultiSelectDropdown, type MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { toneBadge, type Tone } from "../../components/ui/badges";
import { regras } from "../../components/ui/padroesFiltros/regras";
import { usePadroesTela } from "../../components/ui/padroesFiltros/usePadroesTela";
import { useToast } from "../../components/ui/Toast";
import { classeBotaoPrimario, classeBotaoSecundario } from "../../components/gestao5s/campos";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useSincronizarErp } from "../../hooks/useSincronizarErp";
import { formatHoras } from "../../utils/horas";
import { formatMoeda } from "../../utils/moeda";

// Gestão Propostas (09/11/2026): gestão das propostas — o que foi vendido × o que as RATs executaram, o que é faturável, e as ações que mudam a
// SITUAÇÃO da proposta (Finalizar: Em Execução -> Executada; Em Execução: Executada -> Em Execução). A mudança só vale quando o Senior confirma:
// o clique grava um pedido na fila de saída e a situação da linha muda depois (backend: sync/outboxSeniorProposta.ts).

type Acao = "finalizar" | "em-execucao";

interface PropostaRow {
  codemp: number;
  codpro: number;
  /** Proposta Relacionada (nulo quando não há; o 0 do Senior já vem como nulo). */
  codlev2: number | null;
  numprj: number | null;
  sitpro: number | null;
  sitproLabel: string;
  sitproTone: Tone;
  cliente: string;
  despro: string | null;
  datret: string | null;
  depexeLabel: string;
  /** Forma de faturamento da PROPOSTA (Mediante RAT, Finalização, Antecipado...). */
  forfatLabel: string;
  depcusrecLabel: string | null;
  modpro: number | null;
  modproLabel: string;
  /** Modalidade da proposta relacionada (nula quando não há, ou ela não está no CaxHub). */
  modproRelac: number | null;
  modproRelacLabel: string | null;
  totalItens: number;
  totalRats: number;
  /** RATs Digitada ou Fechada: impedem Finalizar. */
  ratsBloqueando: number;
  // HORAS DECIMAIS (ao contrário da Alocação, que recebe minutos): esta lista exporta CSV/PDF e minuto cru no Excel não se lê.
  horasProposta: number;
  horasRat: number;
  saldoHoras: number;
  horasFaturadas: number;
  horasNaoFaturadas: number;
  valorFaturamento: number | null;
  valorNaoFaturado: number | null;
  // Mudança de situação a caminho do Senior (decorada pelo servidor).
  pendenciaSituacao: "pendente" | "enviando" | "bloqueado" | null;
  pendenciaSituacaoErro: string | null;
  pendenciaSituacaoPara: string | null;
  pendenciaSituacaoAguardando: boolean;
}

interface RatRow {
  id: number;
  numrat: number | null;
  datemi: string | null;
  sitratLabel: string;
  sitratTone: Tone;
  consultorNome: string;
  integracaoLabel: string;
  integracaoTone: Tone;
  totalItens: number;
  // MINUTOS (ao contrário da lista de propostas): vem da mesma consulta de Meus Apontamentos.
  totalMinutos: number;
  minutosFaturaveis: number;
  minutosNaoFaturaveis: number;
  valorFaturamento: number | null;
  valorNaoFaturado: number | null;
}

interface OpcoesFiltro {
  situacoes: { sitpro: number; label: string }[];
  departamentos: { depexe: number; label: string }[];
  modalidades: { modpro: number; label: string }[];
}

interface AcoesGestao {
  navegar: (rota: string) => void;
  sincronizar: (row: PropostaRow) => void;
  estaSincronizando: (chave: string) => boolean;
  pedirAcao: (row: PropostaRow, acao: Acao) => void;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const formatData = (valor: string | null) => (valor ? dateFormatter.format(new Date(valor)) : "—");

// Sem o sufixo " h": o título da coluna já diz que é hora, e o espaço antes do "h" forçava quebra de linha em coluna estreita.
const horasCompacto = (horasDecimais: number) => formatHoras(horasDecimais).replace(/ h$/, "");
// formatHoras já devolve o sinal (-0:30), mas uma diferença de ponto flutuante (-0,0001 h) viraria "-0:00": zero de verdade não leva sinal.
const horasComSinal = (horasDecimais: number) => (Math.round(horasDecimais * 60) === 0 ? "0:00" : horasCompacto(horasDecimais));
// Lista filha: minutos -> horas decimais.
const minutos = (m: number) => horasCompacto(m / 60);

const CLASSE_HORAS = "font-mono text-sm tabular-nums text-muted";
const CLASSE_VALOR = "font-mono text-sm tabular-nums text-foreground";

/** Por que a ação está desabilitada (null = pode). Vai no `title` do item do menu. */
function motivoDaAcao(row: PropostaRow, acao: Acao): string | null {
  if (row.pendenciaSituacao === "pendente" || row.pendenciaSituacao === "enviando") {
    return "Já há uma alteração de situação a caminho do ERP para esta proposta";
  }
  if (acao === "finalizar") {
    if (row.sitpro !== 7) return `Só propostas Em Execução podem ser finalizadas (esta está ${row.sitproLabel})`;
    if (row.ratsBloqueando > 0) return `${row.ratsBloqueando} RAT(s) Digitada(s) ou Fechada(s) nesta proposta impedem finalizar`;
    return null;
  }
  return row.sitpro === 8 ? null : `Somente uma proposta Executada pode voltar para Em Execução (esta está ${row.sitproLabel})`;
}

function SeloPendencia({ row }: { row: PropostaRow }) {
  if (!row.pendenciaSituacao) return null;
  const para = row.pendenciaSituacaoPara ?? "nova situação";
  if (row.pendenciaSituacao === "bloqueado") {
    return (
      <span className={`ml-1.5 inline-block rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.destructive}`} title={row.pendenciaSituacaoErro ?? "O envio ao ERP foi bloqueado"}>
        Bloqueado
      </span>
    );
  }
  const rotulo = row.pendenciaSituacao === "enviando" ? "Enviando ao ERP…" : row.pendenciaSituacaoAguardando ? "Aguardando ERP" : "Reenviando…";
  const dica = `Pedido para mudar para "${para}". ${row.pendenciaSituacaoErro ? `${row.pendenciaSituacaoErro} ` : ""}A situação só muda quando o Senior confirmar.`;
  return (
    <span className={`ml-1.5 inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.warning}`} title={dica}>
      {rotulo}
    </span>
  );
}

// Modalidade em poucas letras: as duas colunas (da proposta e da relacionada) são estreitas de propósito. O nome por extenso fica no title do selo, na
// dica do título, no funil e na exportação.
const MODPRO_ABREV: Record<number, string> = { 0: "Serv.", 1: "Lev.", 2: "DRM" };
function SeloModalidade({ codigo, label }: { codigo: number | null; label: string | null }) {
  if (label == null) return <span className="text-sm text-muted">—</span>;
  const texto = codigo != null ? (MODPRO_ABREV[codigo] ?? label) : label;
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium ${toneBadge.neutral}`} title={label}>
      {texto}
    </span>
  );
}

const COLUNAS: DefColuna<PropostaRow, AcoesGestao>[] = [
  {
    nome: "codpro",
    titulo: "Proposta",
    fixa: true,
    // Fica parada à esquerda quando a lista rola na horizontal (pedido do Vitor, 09/11/2026).
    congelada: true,
    largura: 120,
    resumos: ["contagem", "distintos"],
    render: (row, a) => (
      <button
        onClick={(e) => {
          e.stopPropagation();
          a.navegar(`/projetos/proposta/${row.codemp}/${row.codpro}`);
        }}
        className="whitespace-nowrap text-sm font-semibold text-primary hover:underline"
      >
        {row.codpro}
      </button>
    ),
  },
  {
    nome: "modproLabel",
    titulo: "Mod.",
    dica: "Modalidade da proposta (Serv. = Serviço, Lev. = Levantamento)",
    largura: 80,
    texto: (r) => r.modproLabel,
    render: (r) => <SeloModalidade codigo={r.modpro} label={r.modproLabel} />,
  },
  {
    nome: "codlev2",
    titulo: "Relac.",
    dica: "Proposta Relacionada",
    largura: 100,
    render: (r, a) =>
      r.codlev2 != null ? (
        // Mesmo link da coluna Proposta e do de TabelaPedidos (Pedidos): abre a proposta relacionada (na mesma empresa), sem abrir/fechar a linha.
        <button
          onClick={(e) => {
            e.stopPropagation();
            a.navegar(`/projetos/proposta/${r.codemp}/${r.codlev2}`);
          }}
          className="whitespace-nowrap text-sm font-semibold text-primary hover:underline"
        >
          {r.codlev2}
        </button>
      ) : (
        <span className="text-sm text-muted">—</span>
      ),
  },
  {
    nome: "modproRelacLabel",
    titulo: "Mod. R.",
    dica: "Modalidade da proposta relacionada (Serv. = Serviço, Lev. = Levantamento)",
    largura: 80,
    texto: (r) => r.modproRelacLabel,
    render: (r) => <SeloModalidade codigo={r.modproRelac} label={r.modproRelacLabel} />,
  },
  {
    nome: "sitproLabel",
    titulo: "Situação",
    largura: 190,
    texto: (r) => r.sitproLabel,
    render: (r) => (
      <span className="whitespace-nowrap">
        <span className={`inline-block max-w-full truncate whitespace-nowrap align-bottom rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium ${toneBadge[r.sitproTone]}`} title={r.sitproLabel}>
          {r.sitproLabel}
        </span>
        <SeloPendencia row={r} />
      </span>
    ),
  },
  { nome: "numprj", ocultaPorPadrao: true, titulo: "Projeto", largura: 90, classe: "font-mono text-sm text-muted", render: (r) => r.numprj || "—" },
  { nome: "cliente", titulo: "Cliente", largura: 220, classe: "text-sm text-foreground", texto: (r) => r.cliente, render: (r) => r.cliente },
  { nome: "datret", titulo: "Aprovação", largura: 100, classe: "text-sm text-muted", render: (r) => formatData(r.datret) },
  { nome: "despro", titulo: "Descrição", largura: 200, classe: "text-sm text-muted", texto: (r) => r.despro, render: (r) => r.despro ?? "—" },
  {
    nome: "depexeLabel",
    titulo: "Departamento",
    largura: 160,
    render: (r) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.neutral}`}>{r.depexeLabel}</span>,
  },
  {
    nome: "forfatLabel",
    titulo: "Forma Fat.",
    dica: "Forma de Faturamento da proposta no Senior (Mediante RAT, Finalização, Antecipado...)",
    largura: 190,
    texto: (r) => r.forfatLabel,
    // Mesmo visual do selo de Departamento (neutro, arredondado, fonte mono pequena).
    render: (r) => (
      <span className={`inline-block max-w-full truncate whitespace-nowrap align-bottom rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.neutral}`} title={r.forfatLabel}>
        {r.forfatLabel}
      </span>
    ),
  },
  {
    nome: "depcusrecLabel",
    ocultaPorPadrao: true,
    titulo: "Dep. Custo/Rec.",
    dica: "Departamentos de Custo/Receita distintos dos itens da proposta",
    largura: 190,
    texto: (r) => r.depcusrecLabel,
    classe: "text-sm text-muted",
    render: (r) => r.depcusrecLabel ?? "—",
  },
  { nome: "totalItens", ocultaPorPadrao: true, titulo: "Itens", direita: true, largura: 70, classe: CLASSE_HORAS, render: (r) => r.totalItens },
  { nome: "totalRats", ocultaPorPadrao: true, titulo: "RATs", direita: true, largura: 70, classe: CLASSE_HORAS, render: (r) => r.totalRats },
  {
    nome: "horasProposta",
    titulo: "Hrs. Prop.",
    dica: "Horas Total da Proposta: soma das horas vendidas nos itens da proposta",
    direita: true,
    largura: 90,
    classe: CLASSE_HORAS,
    formatarResumo: horasCompacto,
    render: (r) => horasCompacto(r.horasProposta),
  },
  {
    nome: "horasRat",
    titulo: "Hrs. Rat.",
    dica:
      "Horas Total em RAT: horas dos apontamentos válidos das RATs da proposta (sem RAT cancelada, nada excluído no Senior, duração positiva). Pode ser menor que o Total de Meus Apontamentos, que soma tudo.",
    direita: true,
    largura: 90,
    classe: CLASSE_HORAS,
    formatarResumo: horasCompacto,
    render: (r) => horasCompacto(r.horasRat),
  },
  {
    nome: "saldoHoras",
    titulo: "Saldo Prop.",
    dica: "Saldo de Horas: Hrs. Prop. menos Hrs. Rat. Negativo = executou mais do que vendeu.",
    direita: true,
    largura: 100,
    classe: (r) => `font-mono text-sm tabular-nums ${r.saldoHoras < -1 / 120 ? "text-destructive" : "text-foreground"}`,
    formatarResumo: horasComSinal,
    render: (r) => horasComSinal(r.saldoHoras),
  },
  {
    nome: "horasFaturadas",
    titulo: "Hrs. Fat.",
    dica: "Horas Faturadas: horas de RAT em itens com faturamento normal ou antecipado",
    direita: true,
    largura: 90,
    classe: CLASSE_HORAS,
    formatarResumo: horasCompacto,
    render: (r) => horasCompacto(r.horasFaturadas),
  },
  {
    nome: "horasNaoFaturadas",
    titulo: "Hrs. Não Fat.",
    dica: "Horas Não Faturadas: horas de RAT em itens sem faturamento, comercial, suporte ou investimento (e apontamento sem item de proposta)",
    direita: true,
    largura: 110,
    classe: CLASSE_HORAS,
    formatarResumo: horasCompacto,
    render: (r) => horasCompacto(r.horasNaoFaturadas),
  },
  {
    nome: "valorFaturamento",
    titulo: "Vlr. Fat.",
    dica: "Valor para Faturamento: horas faturáveis em RAT × valor-hora do item da proposta (R$)",
    direita: true,
    largura: 110,
    classe: CLASSE_VALOR,
    formatarResumo: formatMoeda,
    render: (r) => formatMoeda(r.valorFaturamento),
  },
  {
    nome: "valorNaoFaturado",
    titulo: "Vlr. Não Fat.",
    dica: "Valor Não Faturado: horas não faturáveis em RAT × valor-hora do item da proposta (R$)",
    direita: true,
    largura: 120,
    classe: CLASSE_VALOR,
    formatarResumo: formatMoeda,
    render: (r) => formatMoeda(r.valorNaoFaturado),
  },
  {
    nome: "ratsBloqueando",
    ocultaPorPadrao: true,
    titulo: "RATs Digitadas/Fechadas",
    dica: "RATs em situação Digitada ou Fechada: impedem Finalizar a proposta",
    direita: true,
    largura: 130,
    classe: (r) => `font-mono text-sm tabular-nums ${r.ratsBloqueando > 0 ? "text-warning" : "text-muted"}`,
    render: (r) => r.ratsBloqueando,
  },
  {
    nome: "acoes",
    titulo: "Ações",
    semOrdenar: true,
    direita: true,
    largura: 60,
    render: (row, a) => {
      const chave = `${row.codemp}-${row.codpro}`;
      const motivoFinalizar = motivoDaAcao(row, "finalizar");
      const motivoExecucao = motivoDaAcao(row, "em-execucao");
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
                {a.estaSincronizando(chave) ? "Sincronizando..." : "Sinc. ERP"}
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => a.pedirAcao(row, "finalizar")} disabled={motivoFinalizar != null} title={motivoFinalizar ?? undefined}>
                Finalizar
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => a.pedirAcao(row, "em-execucao")} disabled={motivoExecucao != null} title={motivoExecucao ?? undefined}>
                Em Execução
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        </span>
      );
    },
  },
];

// ---------- RATs da proposta (linha aberta) ----------

const COLUNAS_RATS: DefColuna<RatRow, (rota: string) => void>[] = [
  {
    nome: "id",
    titulo: "ID",
    fixa: true,
    largura: 100,
    render: (r, navegar) => (
      <button
        onClick={(e) => {
          e.stopPropagation();
          navegar(`/projetos/rat/${r.id}`);
        }}
        className="whitespace-nowrap font-mono text-sm text-primary hover:underline"
      >
        {r.id}
      </button>
    ),
  },
  { nome: "numrat", titulo: "RAT", largura: 100, classe: "font-mono text-sm tabular-nums text-foreground", render: (r) => r.numrat ?? "—" },
  { nome: "datemi", titulo: "Emissão", largura: 110, classe: "text-sm text-muted", render: (r) => formatData(r.datemi) },
  {
    nome: "sitratLabel",
    titulo: "Situação",
    largura: 130,
    render: (r) => (
      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium ${toneBadge[r.sitratTone]}`}>{r.sitratLabel}</span>
    ),
  },
  { nome: "consultorNome", titulo: "Consultor", largura: 200, classe: "text-sm text-foreground", texto: (r) => r.consultorNome, render: (r) => r.consultorNome },
  {
    nome: "integracaoLabel",
    titulo: "Sinc. ERP",
    largura: 120,
    render: (r) => (
      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium ${toneBadge[r.integracaoTone]}`}>{r.integracaoLabel}</span>
    ),
  },
  { nome: "totalItens", titulo: "Itens", direita: true, largura: 70, classe: CLASSE_HORAS, render: (r) => r.totalItens },
  {
    nome: "totalMinutos",
    titulo: "Total",
    dica: "Soma de todos os apontamentos da RAT (como em Meus Apontamentos)",
    direita: true,
    largura: 90,
    classe: CLASSE_HORAS,
    formatarResumo: (v) => minutos(v),
    render: (r) => minutos(r.totalMinutos),
  },
  {
    nome: "minutosFaturaveis",
    ocultaPorPadrao: true,
    titulo: "Horas Faturadas",
    dica: "Apontamentos válidos em itens com faturamento normal ou antecipado",
    direita: true,
    largura: 120,
    classe: CLASSE_HORAS,
    formatarResumo: (v) => minutos(v),
    render: (r) => minutos(r.minutosFaturaveis),
  },
  {
    nome: "minutosNaoFaturaveis",
    ocultaPorPadrao: true,
    titulo: "Horas Não Faturadas",
    direita: true,
    largura: 130,
    classe: CLASSE_HORAS,
    formatarResumo: (v) => minutos(v),
    render: (r) => minutos(r.minutosNaoFaturaveis),
  },
  {
    nome: "valorFaturamento",
    ocultaPorPadrao: true,
    titulo: "Valor para Faturamento",
    direita: true,
    largura: 150,
    classe: CLASSE_VALOR,
    formatarResumo: formatMoeda,
    render: (r) => formatMoeda(r.valorFaturamento),
  },
  {
    nome: "valorNaoFaturado",
    ocultaPorPadrao: true,
    titulo: "Valor Não Faturado",
    direita: true,
    largura: 140,
    classe: CLASSE_VALOR,
    formatarResumo: formatMoeda,
    render: (r) => formatMoeda(r.valorNaoFaturado),
  },
];

/**
 * Limita o detalhe (linha aberta) à área VISÍVEL da lista de propostas e o prende à esquerda quando ela rola. O detalhe vive numa célula com a largura da
 * tabela inteira (muito mais larga que a tela), então a lista de RATs nunca estourava o próprio container: só existia a barra horizontal da lista de
 * propostas, lá embaixo, e rolar por ela arrastava o detalhe junto. Com a largura da área visível, a lista de RATs ganha a sua própria barra horizontal,
 * junto das linhas dela, e rola independente. Acompanha o redimensionamento da janela e das colunas (ResizeObserver).
 */
const RECUO_DO_DETALHE = 20; // px de cada lado: o padding da célula do detalhe (px-5 em ListaServidor)
function AreaVisivelDoDetalhe({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // O contêiner que rola na horizontal: o ancestral mais próximo com overflow-x auto/scroll (a rolagem da lista de propostas).
    let pai = el.parentElement;
    while (pai && !/(auto|scroll)/.test(getComputedStyle(pai).overflowX)) pai = pai.parentElement;
    if (!pai) return;
    const area = pai;
    const medir = () => setLargura(Math.max(320, area.clientWidth - RECUO_DO_DETALHE * 2));
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(area);
    return () => observador.disconnect();
  }, []);
  return (
    <div ref={ref} className="sticky" style={{ left: RECUO_DO_DETALHE, width: largura ?? undefined, maxWidth: "100%" }}>
      {children}
    </div>
  );
}

/** As RATs de uma proposta (linha aberta): lista própria, paginada (há proposta com mais de 800 RATs), com as mesmas exportações. */
function RatsDaProposta({
  row,
  porPagina,
  aoMudarPorPagina,
  estrelaPorPagina,
}: {
  row: PropostaRow;
  porPagina: number;
  aoMudarPorPagina: (n: number) => void;
  estrelaPorPagina: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <AreaVisivelDoDetalhe>
      <div className="py-1">
        <ListaServidor<RatRow, (rota: string) => void>
        // Chave própria: a arrumação de colunas da lista filha não é a da lista de propostas.
        chave="projetos.gestao-propostas.rats"
        url="/api/gestao-propostas/rats"
        params={{ codemp: row.codemp, codpro: row.codpro }}
        defs={COLUNAS_RATS}
        ctx={(rota) => navigate(rota)}
        chaveLinha={(r) => String(r.id)}
        rotulo="RATs"
        vazio="Nenhuma RAT lançada nesta proposta ainda."
        classeCelula={CELULA_COMPACTA}
        // Só o tamanho INICIAL: a lista guarda o valor depois; quem abre outra linha já começa com o que a pessoa escolheu (porPagina vem da tela).
        pageSize={porPagina}
        opcoesPorPagina={POR_PAGINA_RATS}
        aoMudarPorPagina={aoMudarPorPagina}
        acessorioPorPagina={estrelaPorPagina}
        />
      </div>
    </AreaVisivelDoDetalhe>
  );
}

// ---------- Confirmação da ação ----------

const TEXTO_ACAO: Record<Acao, { titulo: (r: PropostaRow) => string; destino: string; aviso: string }> = {
  finalizar: {
    titulo: (r) => `Finalizar a proposta ${r.codpro}?`,
    destino: "Executada",
    aviso:
      "Antes de pedir, as RATs da proposta são conferidas com o Senior: nenhuma pode estar Digitada ou Fechada. A situação só muda quando o Senior confirmar.",
  },
  "em-execucao": {
    titulo: (r) => `Voltar a proposta ${r.codpro} para Em Execução?`,
    destino: "Em Execução",
    aviso: "A situação só muda quando o Senior confirmar.",
  },
};

function ModalAcao({ alvo, enviando, onConfirmar, onFechar }: { alvo: { row: PropostaRow; acao: Acao }; enviando: boolean; onConfirmar: () => void; onFechar: () => void }) {
  const { row, acao } = alvo;
  const texto = TEXTO_ACAO[acao];
  return (
    // Modal de decisão: não fecha ao clicar fora nem no Esc (preferência registrada); o ✕ e o Cancelar fecham.
    <Modal open onClose={onFechar} title={texto.titulo(row)} fecharPorFora={false} className="max-w-lg">
      <div className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted">Cliente</dt>
          <dd className="text-foreground">{row.cliente}</dd>
          {row.despro && (
            <>
              <dt className="text-muted">Descrição</dt>
              <dd className="text-foreground">{row.despro}</dd>
            </>
          )}
          <dt className="text-muted">Situação</dt>
          <dd className="text-foreground">
            {row.sitproLabel} <span aria-hidden>→</span> <strong>{texto.destino}</strong>
          </dd>
        </dl>
        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-muted">{texto.aviso}</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onFechar} disabled={enviando} className={classeBotaoSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={onConfirmar} disabled={enviando} className={classeBotaoPrimario}>
            {enviando ? "Enviando…" : acao === "finalizar" ? "Finalizar" : "Voltar para Em Execução"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Página ----------

const lerLista = (valor: string | null): number[] =>
  valor
    ? valor
        .split(",")
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n))
    : [];

// Padrão do filtro de Situação (pedido do Vitor, 09/11/2026): Aprovada (4), Em Execução (7) e Executada (8). Vale só quando a URL não traz o filtro e
// a pessoa não salvou o próprio padrão (a estrela); limpar a seleção continua significando "todas as situações".
const SITUACOES_PADRAO = [4, 7, 8];

// "Por página": a lista de propostas abre com 15 e a de RATs com 10 (pedidos do Vitor, 09/11/2026); a estrela ao lado do seletor grava o tamanho que a
// pessoa prefere como padrão dela (usePadroesTela, junto com os filtros do topo).
const POR_PAGINA_PROPOSTAS = [10, 15, 25, 50, 100, 200];
const POR_PAGINA_RATS = [10, 25, 50, 100];
const POR_PAGINA_PROPOSTAS_PADRAO = 15;
const POR_PAGINA_RATS_PADRAO = 10;

// Linhas compactas (pedido do Vitor, 09/11/2026): o espaço vertical da célula, que era 9px em cima e embaixo, cai 50% (4,5px). Vale para a lista
// de propostas e para a de RATs que abre na linha.
const CELULA_COMPACTA = "py-[4.5px]";

// "Propostas" (copiado do filtro da Eficiência, 09/11/2026): de clientes, internas (cliente = a própria empresa) ou todas. Padrão: De clientes.
type TipoProposta = "cli" | "int" | "all";
const TIPOS_PROPOSTA: TipoProposta[] = ["cli", "int", "all"];
const TIPO_PADRAO: TipoProposta = "cli";
const lerTipo = (valor: string | null): TipoProposta => (TIPOS_PROPOSTA.includes(valor as TipoProposta) ? (valor as TipoProposta) : TIPO_PADRAO);

const selectClass =
  "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function GestaoPropostas() {
  const navigate = useNavigate();
  const toast = useToast();
  const { sincronizar, estaSincronizando } = useSincronizarErp<{
    ok: boolean;
    encontrada: boolean;
    totalItens: number;
    totalAtividades: number;
    totalRats: number;
    totalItensRat: number;
  }>();

  // Filtros ficam na URL: voltar do detalhe da proposta reabre a lista como estava. O estado é a fonte; a URL é escrita por um efeito.
  const [searchParams, setSearchParams] = useSearchParams();
  // `has` (e não só o valor): "?situacao=" vazio é "todas" de propósito e não deve voltar para o padrão ao recarregar.
  const [tipo, setTipo] = useState<TipoProposta>(() => lerTipo(searchParams.get("tipo")));
  const [situacao, setSituacao] = useState<number[]>(() => (searchParams.has("situacao") ? lerLista(searchParams.get("situacao")) : SITUACOES_PADRAO));
  const [depexe, setDepexe] = useState<number[]>(() => lerLista(searchParams.get("depexe")));
  const [modpro, setModpro] = useState<number[]>(() => lerLista(searchParams.get("modpro")));
  const [buscaInput, setBuscaInput] = useState(searchParams.get("busca") ?? "");
  const busca = useDebouncedValue(buscaInput, 350);
  // Nº digitado para o "Sinc. ERP" avulso: diferente da busca (que só filtra o que já está aqui), este sincroniza de verdade com o Senior um
  // número que o CaxHub pode nunca ter visto. Chave fixa "avulso" no hook (sem colidir com as chaves por linha).
  const [codproDigitado, setCodproDigitado] = useState("");

  useEffect(() => {
    const p = new URLSearchParams();
    p.set("tipo", tipo);
    p.set("situacao", situacao.join(","));
    if (depexe.length > 0) p.set("depexe", depexe.join(","));
    if (modpro.length > 0) p.set("modpro", modpro.join(","));
    if (busca) p.set("busca", busca);
    setSearchParams(p, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, situacao, depexe, modpro, busca]);

  const [porPagina, setPorPagina] = useState(POR_PAGINA_PROPOSTAS_PADRAO);
  const [porPaginaRats, setPorPaginaRats] = useState(POR_PAGINA_RATS_PADRAO);

  // Opções dos filtros: sempre do backend (nunca lista fixa aqui).
  const [opcoes, setOpcoes] = useState<OpcoesFiltro | null>(null);
  const [opcoesFalharam, setOpcoesFalharam] = useState(false);
  useEffect(() => {
    let cancelado = false;
    axios
      .get<OpcoesFiltro>("/api/gestao-propostas/opcoes-filtro")
      .then(({ data }) => !cancelado && setOpcoes(data))
      .catch(() => !cancelado && setOpcoesFalharam(true));
    return () => {
      cancelado = true;
    };
  }, []);
  const opcoesSituacao: MultiSelectOption<number>[] = (opcoes?.situacoes ?? []).map((o) => ({ value: o.sitpro, label: o.label }));
  const opcoesDepartamento: MultiSelectOption<number>[] = (opcoes?.departamentos ?? []).map((o) => ({ value: o.depexe, label: o.label }));
  const opcoesModalidade: MultiSelectOption<number>[] = (opcoes?.modalidades ?? []).map((o) => ({ value: o.modpro, label: o.label }));

  // Padrão de cada filtro (estrela): aplicado uma vez ao abrir, antes da 1ª consulta; o que veio na URL vale mais.
  const [daUrlPadroes] = useState(() => (["tipo", "situacao", "depexe", "modpro"] as const).filter((c) => searchParams.has(c)));
  const padroes = usePadroesTela({
    tela: "projetos.gestao-propostas",
    opcoesProntas: opcoes != null,
    opcoesFalharam,
    daUrl: daUrlPadroes,
    campos: {
      tipo: { rotulo: "Propostas", atual: tipo, aplicar: setTipo, validar: regras.valorUnico("string", TIPOS_PROPOSTA), semOpcoes: true },
      situacao: { rotulo: "Situação", atual: situacao, aplicar: setSituacao, validar: regras.lista("number", opcoesSituacao.map((o) => o.value)) },
      depexe: { rotulo: "Departamento", atual: depexe, aplicar: setDepexe, validar: regras.lista("number", opcoesDepartamento.map((o) => o.value)) },
      modpro: { rotulo: "Modalidade", atual: modpro, aplicar: setModpro, validar: regras.lista("number", opcoesModalidade.map((o) => o.value)) },
      // Tamanho de página: as opções são fixas da tela (nada a esperar do servidor), então aplica já. Aplicado antes da 1ª consulta (a lista só renderiza
      // quando `padroes.pronto`), então a lista abre direto no tamanho salvo.
      porPagina: { rotulo: "Por página", atual: porPagina, aplicar: setPorPagina, validar: regras.valorUnico("number", POR_PAGINA_PROPOSTAS), semOpcoes: true },
      porPaginaRats: { rotulo: "Por página (RATs)", atual: porPaginaRats, aplicar: setPorPaginaRats, validar: regras.valorUnico("number", POR_PAGINA_RATS), semOpcoes: true },
    },
  });

  // A lista busca sozinha; isto só força buscar de novo (depois de um Sinc. ERP ou de uma ação).
  const [recarga, setRecarga] = useState(0);
  const carregar = useCallback(() => setRecarga((n) => n + 1), []);

  // Várias linhas abertas ao mesmo tempo; trocar filtro ou página não fecha nenhuma.
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(new Set());
  const alternarAberta = (chave: string) =>
    setAbertas((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(chave)) proximo.add(chave);
      return proximo;
    });

  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  async function sincronizarLinha(row: PropostaRow) {
    const resultado = await sincronizar(`${row.codemp}-${row.codpro}`, `/api/gestao-propostas/propostas/${row.codemp}/${row.codpro}/sincronizar`);
    if (resultado.ok) {
      toast.mostrar(
        resultado.data.encontrada
          ? `Sincronizado — ${resultado.data.totalItens} item(ns), ${resultado.data.totalRats} RAT(s), ${resultado.data.totalItensRat} apontamento(s)`
          : "Proposta não encontrada mais no Senior",
        resultado.data.encontrada ? "success" : "warning",
      );
      carregar();
    } else {
      toast.mostrar(resultado.erro, "destructive");
    }
  }

  // "Sinc. ERP" por número digitado: o número pode não existir localmente ainda (codemp=1 fixo, única empresa hoje).
  async function sincronizarPropostaAvulsa() {
    const codpro = codproDigitado.trim();
    if (!codpro) return;
    const resultado = await sincronizar("avulso", `/api/gestao-propostas/propostas/1/${codpro}/sincronizar`);
    if (resultado.ok) {
      if (resultado.data.encontrada) {
        toast.mostrar(`Sincronizado — ${resultado.data.totalItens} item(ns), ${resultado.data.totalRats} RAT(s), ${resultado.data.totalItensRat} apontamento(s)`, "success");
        // Traz a proposta recém-trazida para a tela na hora, sem a pessoa precisar procurar: a situação dela pode estar fora do filtro de
        // situações (ex.: Rejeitada) ou ser interna, então os dois filtros vão para "todas".
        setSituacao([]);
        setTipo("all");
        setBuscaInput(codpro);
        setCodproDigitado("");
        carregar();
      } else {
        toast.mostrar("Proposta não encontrada no Senior", "warning");
        setCodproDigitado("");
      }
    } else {
      // Mantém o campo preenchido (falha no Senior): facilita tentar de novo sem redigitar.
      toast.mostrar(resultado.erro, "destructive");
    }
  }

  // Depois de pedir a mudança: acompanha a pendência até o Senior confirmar (ou recusar). Se o ERP ainda não pode receber (porta não
  // publicada / escrita desligada), não há o que acompanhar: a linha fica com o selo "Aguardando ERP".
  async function acompanhar(row: PropostaRow, destinoLabel: string) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      if (!montado.current) return;
      try {
        const { data } = await axios.get(`/api/gestao-propostas/propostas/${row.codemp}/${row.codpro}/situacao`);
        const p = data.pendencia;
        if (!p) return;
        if (p.status === "enviado") {
          toast.mostrar(`Proposta ${row.codpro} agora está ${data.sitproLabel}`, "success");
          carregar();
          return;
        }
        if (p.status === "bloqueado") {
          toast.mostrar(`O Senior não aceitou mudar a proposta ${row.codpro} para ${destinoLabel}: ${p.ultimoErro ?? "sem mensagem"}`, "destructive");
          carregar();
          return;
        }
        if (p.aguardando) return;
      } catch {
        return;
      }
    }
  }

  const [alvo, setAlvo] = useState<{ row: PropostaRow; acao: Acao } | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function confirmarAcao() {
    if (!alvo) return;
    const { row, acao } = alvo;
    setEnviando(true);
    try {
      const { data } = await axios.post(`/api/gestao-propostas/propostas/${row.codemp}/${row.codpro}/${acao}`);
      setAlvo(null);
      carregar();
      if (data.portaPublicada) {
        toast.mostrar(`Pedido enviado: proposta ${row.codpro} para ${data.destinoLabel}. Aguardando o Senior confirmar.`, "success");
        void acompanhar(row, data.destinoLabel);
      } else {
        toast.mostrar(
          `Pedido registrado para a proposta ${row.codpro} (${data.destinoLabel}). Ele fica aguardando o ERP: a situação não mudou e só muda quando o Senior confirmar.`,
          "warning",
        );
      }
    } catch (err: any) {
      // 400/409: o motivo vem do servidor (situação de origem, RAT impedindo, ação já em andamento). Fecha o modal e atualiza a linha.
      toast.mostrar(err.response?.data?.error ?? "Falha ao pedir a mudança de situação", "destructive");
      setAlvo(null);
      carregar();
    } finally {
      setEnviando(false);
    }
  }

  const titulo = "Gestão de Propostas";
  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Projetos · Gestão Propostas</p>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{titulo}</h1>
          <p className="mt-1 text-sm text-muted">
            Horas vendidas × executadas em RAT, o que é faturável e as ações que mudam a situação da proposta. Clique numa linha para ver as RATs dela.
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="Nº da proposta..."
            value={codproDigitado}
            onChange={(e) => setCodproDigitado(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sincronizarPropostaAvulsa()}
            className={`${selectClass} w-32`}
          />
          <button
            onClick={sincronizarPropostaAvulsa}
            disabled={codproDigitado.trim() === "" || estaSincronizando("avulso")}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            title="Sync. ERP — busca no Senior a proposta, os itens e as RATs deste número"
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

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          Propostas
          <SelectFiltro aria-label="Propostas" className="w-40" value={tipo} onChange={(e) => setTipo(lerTipo(e.target.value))} acessorio={padroes.estrela("tipo")}>
            <option value="cli">De clientes</option>
            <option value="int">Internas</option>
            <option value="all">Todas</option>
          </SelectFiltro>
        </label>
        <input
          type="text"
          placeholder="Buscar cliente, proposta ou projeto..."
          value={buscaInput}
          onChange={(e) => setBuscaInput(e.target.value)}
          className={`${selectClass} w-64`}
        />
        <MultiSelectDropdown
          opcoes={opcoesSituacao}
          selecionados={situacao}
          onChange={setSituacao}
          labelTodos="Todas as situações"
          labelSufixo="situações"
          acessorio={padroes.estrela("situacao")}
        />
        <MultiSelectDropdown
          opcoes={opcoesDepartamento}
          selecionados={depexe}
          onChange={setDepexe}
          labelTodos="Todos os departamentos"
          labelSufixo="departamentos"
          acessorio={padroes.estrela("depexe")}
        />
        <MultiSelectDropdown
          opcoes={opcoesModalidade}
          selecionados={modpro}
          onChange={setModpro}
          labelTodos="Todas as modalidades"
          labelSufixo="modalidades"
          acessorio={padroes.estrela("modpro")}
        />
      </div>

      {padroes.pronto && (
        <ListaServidor<PropostaRow, AcoesGestao>
          chave="projetos.gestao-propostas.propostas"
          url="/api/gestao-propostas/propostas"
          params={{
            tipo,
            situacao: situacao.length > 0 ? situacao.join(",") : undefined,
            depexe: depexe.length > 0 ? depexe.join(",") : undefined,
            modpro: modpro.length > 0 ? modpro.join(",") : undefined,
            busca: busca || undefined,
          }}
          recarga={recarga}
          defs={COLUNAS}
          ctx={{
            navegar: navigate,
            estaSincronizando,
            sincronizar: sincronizarLinha,
            pedirAcao: (row, acao) => setAlvo({ row, acao }),
          }}
          chaveLinha={(r) => `${r.codemp}-${r.codpro}`}
          detalhe={(r) => (
            <RatsDaProposta row={r} porPagina={porPaginaRats} aoMudarPorPagina={setPorPaginaRats} estrelaPorPagina={padroes.estrela("porPaginaRats")} />
          )}
          abertas={abertas}
          onAlternarAberta={(_, chave) => alternarAberta(chave)}
          rotulo="propostas"
          vazio="Nenhuma proposta encontrada com os filtros atuais."
          classeCelula={CELULA_COMPACTA}
          // Abre com 15 registros por página (pedido do Vitor, 09/11/2026), ou no tamanho que a pessoa salvou na estrela do seletor.
          pageSize={porPagina}
          opcoesPorPagina={POR_PAGINA_PROPOSTAS}
          aoMudarPorPagina={setPorPagina}
          acessorioPorPagina={padroes.estrela("porPagina")}
          exportavel="gestao-propostas"
          rotuloExportar="Exportar Excel"
          imprimir={{ titulo }}
          pdf={{ titulo, arquivo: "gestao-propostas" }}
        />
      )}

      {alvo && <ModalAcao alvo={alvo} enviando={enviando} onConfirmar={confirmarAcao} onFechar={() => !enviando && setAlvo(null)} />}
    </div>
  );
}
