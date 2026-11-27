import { useMemo, useState } from "react";
import { ListaServidor, type LinhaDetalhe } from "../../components/colunas/ListaServidor";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { classeFiltro, competenciaPadrao, fmtCompetencia, fmtHorasMinutos, fmtNumero, Selo, useConsultores, useProcessos } from "./comum";
import { ModalComprovanteHoras, type PedidoDeComprovante, type TipoComprovante } from "./ModalComprovanteHoras";

// Gestão de Bonificação › Horas Kyria x Trabalhadas: uma linha por atendente, com as horas trabalhadas do ponto (HCM), o saldo do banco de horas
// no mês, as extras (só o saldo positivo), o total do mês, as horas apontadas no Kyria, o tempo ocioso (total − Kyria), o % (Kyria ÷ total) e o
// PDI do fechamento; ao abrir a linha, o detalhe por time do chamado e, dentro do time, por área do chamado. É calculado na hora: não precisa
// apurar o fechamento. Horas trabalhadas, Banco de horas e Horas Kyria são links: abrem o comprovante com os lançamentos que formam o número
// (ModalComprovanteHoras). Lista do kit (filtro e ordem por coluna, resumo, CSV); backend: GET /bonificacao/relatorios/horas-kyria (routes/bonificacao.ts).

export interface LinhaHoras {
  processoId: number;
  processo: string;
  codemp: number;
  codfor: number;
  codusu: number | null;
  consultor: string;
  minutosPonto: number | null;
  saldoBanco: number | null;
  minutosExtras: number | null;
  minutosTotal: number | null;
  minutosKyria: number | null;
  minutosOcioso: number | null;
  percentual: number | null;
  pdiHoras: number | null;
  pdiConcluido: "Sim" | "Não" | null;
  motivo: string | null;
  porTime: { time: string; minutos: number; porArea: { area: string; minutos: number }[] }[];
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${fmtNumero(Math.round(v * 100) / 100)}%`);
const mono = "font-mono text-sm tabular-nums text-foreground";
const horas = (v: number | null) => (v == null ? "—" : fmtHorasMinutos(v));

/** O que as células da lista sabem fazer: abrir o comprovante de um número. */
export interface AcoesHoras {
  abrir: (linha: LinhaHoras, tipo: TipoComprovante, minutosNaTela: number) => void;
}

/** Número clicável que abre o comprovante. O clique não chega na linha (que abre/fecha os times). */
function LinkComprovante({ linha, tipo, minutos, acoes, classe, children }: { linha: LinhaHoras; tipo: TipoComprovante; minutos: number; acoes: AcoesHoras; classe?: string; children: string }) {
  const oQue = { ponto: "horas trabalhadas", banco: "lançamentos do banco de horas", kyria: "apontamentos do Kyria" }[tipo];
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        acoes.abrir(linha, tipo, minutos);
      }}
      className={`font-mono tabular-nums underline decoration-dotted underline-offset-2 hover:decoration-solid focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${classe ?? "text-primary"}`}
      title={`Ver o comprovante: ${oQue} de ${linha.consultor}`}
    >
      {children}
    </button>
  );
}

/** Coluna de tempo (minutos na linha, HH:MM na tela) com soma no resumo. `comprovante`: o número vira link (zero não tem o que mostrar). */
const colunaHoras = (
  nome: "minutosPonto" | "minutosExtras" | "minutosTotal" | "minutosKyria" | "minutosOcioso",
  titulo: string,
  largura: number,
  dica: string,
  comprovante?: TipoComprovante
): DefColuna<LinhaHoras, AcoesHoras> => ({
  nome,
  titulo,
  direita: true,
  largura,
  dica,
  classe: mono,
  formatarResumo: fmtHorasMinutos,
  render: (l, acoes) => {
    const minutos = l[nome];
    if (!comprovante || !acoes || !minutos) return horas(minutos);
    return (
      <LinkComprovante linha={l} tipo={comprovante} minutos={minutos} acoes={acoes}>
        {fmtHorasMinutos(minutos)}
      </LinkComprovante>
    );
  },
});

export const COLUNAS: DefColuna<LinhaHoras, AcoesHoras>[] = [
  {
    nome: "consultor",
    titulo: "Atendente",
    fixa: true,
    largura: 240,
    texto: (l) => l.consultor,
    resumos: ["contagem"],
    render: (l) => (
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{l.consultor}</div>
        {l.motivo && <div className="truncate text-[11px] text-warning">{l.motivo}</div>}
      </div>
    ),
  },
  { nome: "processo", titulo: "Processo", largura: 200, classe: "text-sm text-muted", texto: (l) => l.processo, render: (l) => l.processo },
  colunaHoras("minutosPonto", "Horas trabalhadas", 130, "Horas trabalhadas do ponto (HCM) no mês", "ponto"),
  {
    nome: "saldoBanco",
    titulo: "Banco de horas",
    direita: true,
    largura: 150,
    dica: "Saldo dos lançamentos do banco de horas no mês (créditos − débitos), sem o saldo anterior. Só o saldo positivo entra como extra.",
    classe: mono,
    formatarResumo: fmtHorasMinutos,
    render: (l, acoes) => {
      if (l.saldoBanco == null) return horas(null);
      const negativo = l.saldoBanco < 0;
      const numero = acoes ? (
        <LinkComprovante linha={l} tipo="banco" minutos={l.saldoBanco} acoes={acoes} classe={negativo ? "text-warning" : undefined}>
          {fmtHorasMinutos(l.saldoBanco)}
        </LinkComprovante>
      ) : negativo ? (
        <span className="text-warning">{fmtHorasMinutos(l.saldoBanco)}</span>
      ) : (
        fmtHorasMinutos(l.saldoBanco)
      );
      return negativo ? (
        <>
          {numero}
          <div className="font-sans text-[10.5px] text-warning">não entrou no cálculo</div>
        </>
      ) : (
        numero
      );
    },
  },
  colunaHoras("minutosExtras", "Extras", 100, "Horas extras no cálculo: o saldo do banco de horas no mês, quando positivo"),
  colunaHoras("minutosTotal", "Total do mês", 120, "Horas trabalhadas + extras"),
  colunaHoras("minutosKyria", "Horas Kyria", 110, "Horas apontadas no Kyria no mês", "kyria"),
  colunaHoras("minutosOcioso", "Ocioso", 100, "Total do mês − horas Kyria (negativo: o Kyria passou do total)"),
  { nome: "percentual", titulo: "%", direita: true, largura: 80, dica: "Horas Kyria ÷ total do mês", classe: "font-mono text-sm font-semibold tabular-nums text-primary", render: (l) => pct(l.percentual) },
  { nome: "pdiHoras", titulo: "PDI realizado", direita: true, largura: 120, dica: "Horas de PDI lançadas no fechamento", classe: mono, render: (l) => (l.pdiHoras == null ? "—" : `${fmtNumero(l.pdiHoras)} h`) },
  {
    nome: "pdiConcluido",
    titulo: "Concluído?",
    centro: true,
    largura: 100,
    render: (l) => (l.pdiConcluido == null ? <span className="text-muted">—</span> : <Selo texto={l.pdiConcluido === "Sim" ? "S" : "N"} tone={l.pdiConcluido === "Sim" ? "success" : "destructive"} />),
  },
  { nome: "motivo", titulo: "Observação", largura: 260, ocultaPorPadrao: true, classe: "text-sm text-warning", texto: (l) => l.motivo, render: (l) => l.motivo ?? "" },
];

/**
 * Horas por time do chamado e, dentro do time, por área do chamado: linhas sob o atendente, alinhadas às colunas (nome sob "Atendente", horas sob
 * "Horas Kyria", % das horas Kyria do atendente sob "%").
 */
export function linhasPorTime(l: LinhaHoras): LinhaDetalhe[] {
  const linha = (chave: string, nome: string, minutos: number, recuo: string, texto: string): LinhaDetalhe => ({
    chave,
    valores: {
      consultor: (
        <span className={`block truncate ${recuo} ${texto}`} title={nome}>
          {nome}
        </span>
      ),
      minutosKyria: <span className={`font-mono tabular-nums ${texto}`}>{fmtHorasMinutos(minutos)}</span>,
      percentual: <span className={`font-mono tabular-nums ${texto}`}>{pct(l.minutosKyria ? (minutos * 100) / l.minutosKyria : null)}</span>,
    },
  });
  return l.porTime.flatMap((t) => [
    linha(t.time, t.time, t.minutos, "pl-5", "font-medium"),
    ...t.porArea.map((a) => linha(`${t.time}|${a.area}`, a.area, a.minutos, "pl-10", "text-[11.5px] text-muted")),
  ]);
}

export function BonificacaoHorasKyria() {
  const processos = useProcessos();
  const consultores = useConsultores();
  const [competencia, setCompetencia] = useState(competenciaPadrao());
  const [processoId, setProcessoId] = useState("");
  const [codfor, setCodfor] = useState("");
  // Os times de cada atendente começam recolhidos; clicar na linha abre/fecha uma, e o botão abre/fecha todas as da página.
  const [chaves, setChaves] = useState<string[]>([]);
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(new Set());
  const [comprovante, setComprovante] = useState<PedidoDeComprovante | null>(null);
  const todasAbertas = chaves.length > 0 && chaves.every((c) => abertas.has(c));
  const alternar = (_l: LinhaHoras, chave: string) =>
    setAbertas((a) => {
      const n = new Set(a);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });
  const alternarTodas = () => setAbertas(todasAbertas ? new Set() : new Set(chaves));

  // Título do relatório impresso/PDF: com a competência, como o relatório original ("Horas Disponíveis X Trabalhadas 09/2026").
  const tituloRelatorio = `Horas Kyria x Trabalhadas ${fmtCompetencia(competencia)}`;

  const params = useMemo(
    () => ({ competencia: /^\d{4}-\d{2}$/.test(competencia) ? competencia : undefined, processoId: processoId || undefined, codfor: codfor || undefined }),
    [competencia, processoId, codfor]
  );

  // Competência da lista (campo vazio = o servidor usa o mês anterior, o mesmo padrão da tela).
  const competenciaDaLista = params.competencia ?? competenciaPadrao();
  const acoes = useMemo<AcoesHoras>(
    () => ({
      abrir: (l, tipo, minutosNaTela) => setComprovante({ tipo, codemp: l.codemp, codfor: l.codfor, consultor: l.consultor, competencia: competenciaDaLista, minutosNaTela }),
    }),
    [competenciaDaLista]
  );

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Bonificação</p>
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold text-foreground">Horas Kyria x Trabalhadas</h1>
        <p className="mt-1 text-sm text-muted">Horas apontadas no Kyria sobre o total do mês (horas trabalhadas do ponto + extras do banco de horas), por atendente, com o tempo ocioso e o PDI do fechamento. Saldo negativo do banco de horas é mostrado, mas não entra no cálculo. Clique em Horas trabalhadas, Banco de horas ou Horas Kyria para ver os lançamentos que formam o número. Clique na linha (ou em "Expandir todos") para ver os times e as áreas dos chamados sob cada atendente.</p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="month" aria-label="Competência" className={classeFiltro} value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
        <select aria-label="Processo" className={classeFiltro} value={processoId} onChange={(e) => setProcessoId(e.target.value)}>
          <option value="">Todos os processos com ponto apontado</option>
          {processos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
        {consultores.length > 1 && (
          <select aria-label="Atendente" className={classeFiltro} value={codfor} onChange={(e) => setCodfor(e.target.value)}>
            <option value="">Todos os atendentes</option>
            {consultores.map((c) => (
              <option key={c.codfor} value={c.codfor}>
                {c.nome}
              </option>
            ))}
          </select>
        )}
      </div>

      <ListaServidor<LinhaHoras, AcoesHoras>
        ctx={acoes}
        chave="bonificacao.horas-kyria"
        url="/api/bonificacao/relatorios/horas-kyria"
        params={params}
        defs={COLUNAS}
        chaveLinha={(l) => `${l.processoId}-${l.codfor}`}
        rotulo="atendentes"
        vazio="Nenhum atendente enquadrado com indicador de ponto apontado nesta competência."
        pageSize={25}
        exportavel="bonificacao-horas-kyria"
        imprimir={{ titulo: tituloRelatorio }}
        pdf={{ titulo: tituloRelatorio, arquivo: "horas-kyria-x-trabalhadas" }}
        // O relatório segue a tela: os times saem sob os atendentes que estavam abertos ("Expandir todos" ou clique na linha).
        paramsRelatorio={() => ({ detalhe: [...abertas].filter((c) => chaves.includes(c)).join(",") })}
        topo={() => (
          <button
            type="button"
            onClick={alternarTodas}
            disabled={chaves.length === 0}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            {todasAbertas ? "Contrair todos" : "Expandir todos"}
          </button>
        )}
        linhasDetalhe={linhasPorTime}
        abertas={abertas}
        onAlternarAberta={alternar}
        aoCarregar={(d) => setChaves(d.itens.map((l) => `${l.processoId}-${l.codfor}`))}
        rodape={(d) => {
          const total = d?.totais?.minutosTotal ?? 0;
          const kyria = d?.totais?.minutosKyria ?? 0;
          return (
            <div className="flex flex-wrap gap-x-8 gap-y-1 border-t border-border bg-surface px-5 py-3">
              {(
                [
                  ["Horas trabalhadas (filtro atual)", fmtHorasMinutos(d?.totais?.minutosPonto ?? 0)],
                  ["Extras", fmtHorasMinutos(d?.totais?.minutosExtras ?? 0)],
                  ["Total do mês", fmtHorasMinutos(total)],
                  ["Horas Kyria", fmtHorasMinutos(kyria)],
                  ["Ocioso", fmtHorasMinutos(d?.totais?.minutosOcioso ?? 0)],
                  ["%", pct(total > 0 ? (kyria * 100) / total : null)],
                ] as const
              ).map(([rotulo, valor]) => (
                <div key={rotulo}>
                  <p className="text-[10.5px] text-muted">{rotulo}</p>
                  <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{valor}</p>
                </div>
              ))}
            </div>
          );
        }}
      />
      {comprovante && <ModalComprovanteHoras pedido={comprovante} onFechar={() => setComprovante(null)} />}
    </div>
  );
}
