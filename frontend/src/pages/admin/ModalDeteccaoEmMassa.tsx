import axios from "axios";
import { useMemo, useState } from "react";
import { Modal } from "../../components/ui/Modal";

// Ação em massa da coluna "Detecção de exclusão" (27/11/2026): escolher as tabelas que estão Desligadas ou Simulando e trocar o modo de todas
// de uma vez. Mesma regra da troca individual: Desligada só vai para Simular; "Marcar" só a partir de Simulando (e com confirmação aqui).
// Serve a tela do ERP e a do HCM (cada uma passa só as suas tabelas e a sua API). Backend: POST {api}/varredura-em-massa.

export type Modo = "desligada" | "simular" | "marcar";
export type FiltroDeModo = "desligada" | "simular";

export interface TabelaDeteccao {
  jobName: string;
  displayName: string;
  tabelaSenior: string;
  tabelaLocal: string;
  varreduraModo: Modo;
  varreduraDisponivel: boolean;
  ultimaVarredura: { modo: string; detectados: number; em: string } | null;
  bloqueioVarredura: { motivo: string | null; candidatos: number } | null;
}

const FILTROS: { valor: FiltroDeModo; rotulo: string }[] = [
  { valor: "desligada", rotulo: "Desligadas" },
  { valor: "simular", rotulo: "Simulando" },
];

/** Para onde cada filtro pode ir. Desligada não pula para Marcar. */
export const DESTINOS: Record<FiltroDeModo, { modo: Modo; rotulo: string }[]> = {
  desligada: [{ modo: "simular", rotulo: "Passar para Simular" }],
  simular: [
    { modo: "desligada", rotulo: "Desligar" },
    { modo: "marcar", rotulo: "Ligar Marcar" },
  ],
};

const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const numero = new Intl.NumberFormat("pt-BR");
const semAcento = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Tabelas do filtro (só as que têm a detecção disponível), com a busca por descrição ou nome da tabela. */
export function tabelasDoFiltro<T extends TabelaDeteccao>(jobs: T[], filtro: FiltroDeModo, busca = ""): T[] {
  const termo = semAcento(busca.trim());
  return jobs.filter(
    (j) => j.varreduraDisponivel && j.varreduraModo === filtro && (!termo || semAcento(`${j.displayName} ${j.tabelaSenior} ${j.tabelaLocal}`).includes(termo))
  );
}

/** O que a última varredura diz sobre a tabela, para a pessoa conferir antes de mudar o modo. */
export function situacaoDaVarredura(j: TabelaDeteccao): { texto: string; alerta: boolean } {
  if (j.bloqueioVarredura) return { texto: `última varredura barrada (${numero.format(j.bloqueioVarredura.candidatos)} candidatos)`, alerta: true };
  const u = j.ultimaVarredura;
  if (!u) return { texto: j.varreduraModo === "simular" ? "ainda não varreu: não há candidatos para conferir" : "ainda não varreu", alerta: j.varreduraModo === "simular" };
  const quando = dataHora.format(new Date(u.em));
  if (u.modo !== "simular") return { texto: `${quando} · ${numero.format(u.detectados)} detectado(s)`, alerta: false };
  return { texto: `${quando} · ${numero.format(u.detectados)} sumiriam (simulado)`, alerta: false };
}

export function ModalDeteccaoEmMassa<T extends TabelaDeteccao>({ api, jobs, onFechar, onAplicado }: { api: string; jobs: T[]; onFechar: () => void; onAplicado: () => void }) {
  const [filtro, setFiltro] = useState<FiltroDeModo>("desligada");
  const [busca, setBusca] = useState("");
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set());
  const [confirmandoMarcar, setConfirmandoMarcar] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);

  const lista = useMemo(() => tabelasDoFiltro(jobs, filtro, busca), [jobs, filtro, busca]);
  // Só vale o que está à vista: uma tabela escondida pela busca (ou que mudou de modo) nunca é alterada junto.
  const selecionadas = lista.filter((j) => marcadas.has(j.jobName));
  const todasMarcadas = lista.length > 0 && selecionadas.length === lista.length;
  const semDeteccao = jobs.filter((j) => !j.varreduraDisponivel).length;
  const jaMarcando = jobs.filter((j) => j.varreduraDisponivel && j.varreduraModo === "marcar").length;
  const semVarredura = selecionadas.filter((j) => situacaoDaVarredura(j).alerta).length;
  const candidatos = selecionadas.reduce((s, j) => s + (j.ultimaVarredura?.modo === "simular" ? j.ultimaVarredura.detectados : 0), 0);

  function trocarFiltro(novo: FiltroDeModo) {
    setFiltro(novo);
    setMarcadas(new Set());
    setConfirmandoMarcar(false);
    setErro(null);
    setResultado(null);
  }
  function alternar(jobName: string) {
    setConfirmandoMarcar(false);
    setMarcadas((m) => {
      const n = new Set(m);
      if (n.has(jobName)) n.delete(jobName);
      else n.add(jobName);
      return n;
    });
  }
  function alternarTodas() {
    setConfirmandoMarcar(false);
    setMarcadas(todasMarcadas ? new Set() : new Set(lista.map((j) => j.jobName)));
  }

  async function aplicar(modo: Modo) {
    if (modo === "marcar" && !confirmandoMarcar) {
      setConfirmandoMarcar(true);
      return;
    }
    setAplicando(true);
    setErro(null);
    setResultado(null);
    try {
      const { data } = await axios.post(`${api}/varredura-em-massa`, { modo, jobNames: selecionadas.map((j) => j.jobName) });
      const ignoradas = (data.ignoradas ?? []) as { motivo: string }[];
      const nomeDoModo = { desligada: "Desligada", simular: "Simular", marcar: "Marcar" }[modo];
      setResultado(`${data.alteradas.length} tabela(s) agora em "${nomeDoModo}".` + (ignoradas.length ? ` Não alteradas: ${ignoradas.map((i) => i.motivo).join(" ")}` : ""));
      setMarcadas(new Set());
      setConfirmandoMarcar(false);
      onAplicado();
    } catch (e: any) {
      setErro(e.response?.data?.error ?? "Falha ao alterar a detecção de exclusão");
    } finally {
      setAplicando(false);
    }
  }

  const botao = "rounded-md border px-3 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <Modal
      open
      onClose={onFechar}
      title="Detecção de exclusão em massa"
      subtitulo='Vale a partir da próxima sincronização completa ("Todos"); "Alterados" não varre.'
      className="max-w-4xl"
      corpoFixo
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Modo atual das tabelas" className="inline-flex overflow-hidden rounded-md border border-border">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              aria-pressed={filtro === f.valor}
              onClick={() => trocarFiltro(f.valor)}
              className={`px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filtro === f.valor ? "bg-primary text-primary-foreground" : "bg-surface text-foreground hover:bg-surface-2"}`}
            >
              {f.rotulo} ({tabelasDoFiltro(jobs, f.valor).length})
            </button>
          ))}
        </div>
        <input
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setConfirmandoMarcar(false);
          }}
          placeholder="Buscar tabela..."
          aria-label="Buscar tabela"
          className="w-64 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="ml-auto text-[11.5px] text-muted">
          {jaMarcando} já em Marcar{semDeteccao > 0 ? ` · ${semDeteccao} sem detecção disponível` : ""}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-surface-2">
            <tr>
              <th className="w-10 px-3 py-2">
                <input type="checkbox" aria-label="Selecionar todas as tabelas deste filtro" checked={todasMarcadas} disabled={lista.length === 0} onChange={alternarTodas} />
              </th>
              <th className="px-2 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Tabela</th>
              <th className="px-2 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Última varredura</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((j) => {
              const s = situacaoDaVarredura(j);
              return (
                <tr key={j.jobName} className="cursor-pointer border-t border-border/60 hover:bg-surface-2" onClick={() => alternar(j.jobName)}>
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Selecionar ${j.displayName}`} checked={marcadas.has(j.jobName)} onClick={(e) => e.stopPropagation()} onChange={() => alternar(j.jobName)} />
                  </td>
                  <td className="px-2 py-2">
                    <span className="text-foreground">{j.displayName}</span>
                    <span className="block text-[11px] text-muted">
                      {j.tabelaSenior} → {j.tabelaLocal}
                    </span>
                  </td>
                  <td className={`px-2 py-2 text-[12.5px] ${s.alerta ? "text-warning" : "text-muted"}`} title={j.bloqueioVarredura?.motivo ?? undefined}>
                    {s.texto}
                  </td>
                </tr>
              );
            })}
            {lista.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-sm text-muted">
                  {busca.trim() ? "Nenhuma tabela deste filtro com essa busca." : filtro === "desligada" ? "Nenhuma tabela desligada." : "Nenhuma tabela simulando."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {confirmandoMarcar && (
        <p role="alert" className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
          Em "Marcar", a próxima sincronização completa passa a marcar como removido o que sumiu do Senior em <b>{selecionadas.length} tabela(s)</b> (nada é apagado; as telas deixam de contar o que for
          marcado). Na última simulação, sumiriam <b>{numero.format(candidatos)}</b> registro(s)
          {semVarredura > 0 ? (
            <>
              , e <b>{semVarredura} tabela(s)</b> estão sem uma simulação limpa para conferir
            </>
          ) : null}
          . Clique em "Confirmar Marcar" para aplicar.
        </p>
      )}
      {erro && <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
      {resultado && (
        <p role="status" className="mt-3 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-foreground">
          {resultado}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">
          {selecionadas.length} de {lista.length} selecionada(s)
        </span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onFechar} className={`${botao} border-border text-foreground hover:bg-surface-2`}>
            Fechar
          </button>
          {DESTINOS[filtro].map((d) => (
            <button
              key={d.modo}
              type="button"
              disabled={selecionadas.length === 0 || aplicando}
              onClick={() => aplicar(d.modo)}
              className={`${botao} ${d.modo === "desligada" ? "border-border text-foreground hover:bg-surface-2" : "border-primary bg-primary text-primary-foreground hover:opacity-90"}`}
            >
              {aplicando ? "Aplicando..." : d.modo === "marcar" && confirmandoMarcar ? "Confirmar Marcar" : d.rotulo}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
