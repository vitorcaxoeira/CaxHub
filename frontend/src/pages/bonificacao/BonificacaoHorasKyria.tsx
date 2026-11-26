import { useMemo, useState } from "react";
import { ListaServidor, type LinhaDetalhe } from "../../components/colunas/ListaServidor";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { classeFiltro, competenciaPadrao, fmtCompetencia, fmtHorasMinutos, fmtNumero, Selo, useConsultores, useProcessos } from "./comum";

// Gestão de Bonificação › Horas Kyria x Trabalhadas: uma linha por atendente, com as horas apontadas no Kyria sobre as horas trabalhadas do ponto
// (HCM) e o PDI do fechamento; ao abrir a linha, o detalhe por time do chamado. É calculado na hora: não precisa apurar o fechamento. Lista do kit
// (filtro e ordem por coluna, resumo, CSV); backend: GET /bonificacao/relatorios/horas-kyria (routes/bonificacao.ts).

interface LinhaHoras {
  processoId: number;
  processo: string;
  codfor: number;
  codusu: number | null;
  consultor: string;
  minutosPonto: number | null;
  minutosKyria: number | null;
  percentual: number | null;
  pdiHoras: number | null;
  pdiConcluido: "Sim" | "Não" | null;
  motivo: string | null;
  porTime: { time: string; minutos: number }[];
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${fmtNumero(Math.round(v * 100) / 100)}%`);
const mono = "font-mono text-sm tabular-nums text-foreground";

const COLUNAS: DefColuna<LinhaHoras>[] = [
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
  { nome: "minutosPonto", titulo: "Horas trabalhadas", direita: true, largura: 130, dica: "Horas trabalhadas do ponto (HCM) no mês", classe: mono, formatarResumo: fmtHorasMinutos, render: (l) => (l.minutosPonto == null ? "—" : fmtHorasMinutos(l.minutosPonto)) },
  { nome: "minutosKyria", titulo: "Horas Kyria", direita: true, largura: 110, dica: "Horas apontadas no Kyria no mês", classe: mono, formatarResumo: fmtHorasMinutos, render: (l) => (l.minutosKyria == null ? "—" : fmtHorasMinutos(l.minutosKyria)) },
  { nome: "percentual", titulo: "%", direita: true, largura: 80, dica: "Horas Kyria ÷ horas trabalhadas", classe: "font-mono text-sm font-semibold tabular-nums text-primary", render: (l) => pct(l.percentual) },
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

/** Horas por time do chamado: linhas sob o atendente, alinhadas às colunas (time sob "Atendente", horas sob "Horas Kyria", % das horas Kyria sob "%"). */
function linhasPorTime(l: LinhaHoras): LinhaDetalhe[] {
  return l.porTime.map((t) => ({
    chave: t.time,
    valores: {
      consultor: <span className="block truncate pl-5">{t.time}</span>,
      minutosKyria: <span className="font-mono tabular-nums">{fmtHorasMinutos(t.minutos)}</span>,
      percentual: <span className="font-mono tabular-nums">{pct(l.minutosKyria ? (t.minutos * 100) / l.minutosKyria : null)}</span>,
    },
  }));
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

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Bonificação</p>
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold text-foreground">Horas Kyria x Trabalhadas</h1>
        <p className="mt-1 text-sm text-muted">Horas apontadas no Kyria sobre as horas trabalhadas do ponto, por atendente, com o PDI do fechamento. Clique na linha (ou em "Expandir todos") para ver os times do chamado sob cada atendente.</p>
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

      <ListaServidor<LinhaHoras>
        chave="bonificacao.horas-kyria"
        url="/api/bonificacao/relatorios/horas-kyria"
        params={params}
        defs={COLUNAS}
        chaveLinha={(l) => `${l.processoId}-${l.codfor}`}
        rotulo="atendentes"
        vazio="Nenhum atendente enquadrado com indicador de ponto apontado nesta competência."
        pageSize={25}
        exportavel="bonificacao-horas-kyria"
        rotuloExportar="Exportar Excel"
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
          const ponto = d?.totais?.minutosPonto ?? 0;
          const kyria = d?.totais?.minutosKyria ?? 0;
          return (
            <div className="flex flex-wrap gap-x-8 gap-y-1 border-t border-border bg-surface px-5 py-3">
              {(
                [
                  ["Horas trabalhadas (filtro atual)", fmtHorasMinutos(ponto)],
                  ["Horas Kyria", fmtHorasMinutos(kyria)],
                  ["%", pct(ponto > 0 ? (kyria * 100) / ponto : null)],
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
    </div>
  );
}
