import axios from "axios";
import { Palmtree, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { cn } from "../../lib/cn";
import { formatHorasCompacto } from "../../lib/cronograma";
import {
  type Aquisitivo,
  type DiaCalendario,
  DIAS_SEMANA_CURTO,
  type RespostaCalendario,
  dataBr,
  hhmm,
  horaParaMinutos,
  mensagemDeErro,
} from "../../lib/feriasCalendario";
import { type Feriado, carregarFeriados } from "../../lib/feriados";

// Peças do calendário de trabalho do consultor (13/11/2026), usadas pela página /projetos/calendario e pelo card "Calendário" da Home: a grade do mês, a célula
// do dia, o modal do dia (marcar/remover folga) e o hook que busca o mês. Férias e folgas saem da meta (domain/calendarioTrabalho.ts no backend).

export const horas = (min: number) => `${formatHorasCompacto(min)} h`;

/** O período aquisitivo que contém a data (YYYY-MM-DD), se houver. */
const aquisitivoDa = (saldos: Aquisitivo[], data: string) => saldos.find((a) => a.inicio <= data && data <= a.fim);

/** Busca o calendário de um mês (GET /calendario) e os feriados nacionais do ano. `codfor` ausente = o próprio usuário. */
export function useCalendarioMes(ano: number, mes: number, codfor?: number | null) {
  const [resposta, setResposta] = useState<RespostaCalendario | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [feriados, setFeriados] = useState<Record<string, string>>({});
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    axios
      .get<RespostaCalendario>("/api/calendario", { params: { ano, mes, codfor: codfor ?? undefined } })
      .then(({ data }) => {
        if (!vivo) return;
        setResposta(data);
        setErro(null);
      })
      .catch((err) => vivo && setErro(mensagemDeErro(err, "Falha ao carregar o calendário")))
      .finally(() => vivo && setLoading(false));
    return () => {
      vivo = false;
    };
  }, [ano, mes, codfor, versao]);

  useEffect(() => {
    let vivo = true;
    carregarFeriados(ano).then((lista: Feriado[]) => vivo && setFeriados(Object.fromEntries(lista.map((f) => [f.date, f.name]))));
    return () => {
      vivo = false;
    };
  }, [ano]);

  // `semConsultor`: o usuário não tem cadastro de consultor (ex.: admin) e nenhum foi escolhido: não há calendário a mostrar.
  const semConsultor = resposta?.semConsultor === true;
  const dados = resposta && !semConsultor ? resposta : null;
  return { dados, semConsultor, loading, erro, feriados, recarregar: () => setVersao((v) => v + 1) };
}

/** A grade do mês (dias da semana + células). Clicar num dia chama `onDia`. */
export function GradeDoMes({
  dados,
  loading,
  feriados,
  onDia,
  compacto = false,
}: {
  dados: RespostaCalendario | null;
  loading: boolean;
  feriados: Record<string, string>;
  onDia: (data: string) => void;
  compacto?: boolean;
}) {
  // Começa no domingo da semana do dia 1.
  const celulas = useMemo(() => {
    if (!dados) return [];
    const vazios = Array.from({ length: dados.dias[0]?.diaSemana ?? 0 }, () => null);
    return [...vazios, ...dados.dias];
  }, [dados]);
  const hojeIso = new Date().toISOString().slice(0, 10);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border bg-surface-2">
        {DIAS_SEMANA_CURTO.map((d) => (
          <div key={d} className="px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-wider text-muted">
            {d}
          </div>
        ))}
      </div>
      <div className={cn("grid grid-cols-7", loading && "opacity-60")} aria-busy={loading}>
        {celulas.map((dia, i) =>
          dia == null ? (
            <div key={`v${i}`} className={cn("border-b border-r border-border/60 bg-surface-2/30", compacto ? "min-h-16" : "min-h-24")} />
          ) : (
            <CelulaDia key={dia.data} dia={dia} feriado={feriados[dia.data]} ehHoje={dia.data === hojeIso} onClick={() => onDia(dia.data)} compacto={compacto} />
          ),
        )}
      </div>
    </div>
  );
}

export function CelulaDia({ dia, feriado, ehHoje, onClick, compacto = false }: { dia: DiaCalendario; feriado?: string; ehHoje: boolean; onClick: () => void; compacto?: boolean }) {
  const fimDeSemana = dia.diaSemana === 0 || dia.diaSemana === 6;
  const folgaInteira = dia.ausencias.some((a) => a.diaInteiro);
  return (
    <button
      type="button"
      onClick={onClick}
      title={feriado}
      className={cn(
        "flex flex-col items-stretch border-b border-r border-border/60 text-left transition hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        compacto ? "min-h-16 gap-0.5 p-1" : "min-h-24 gap-1 p-1.5",
        fimDeSemana && dia.baseMinutos === 0 && "bg-surface-2/40",
        dia.ferias && "bg-primary/10",
        !dia.ferias && folgaInteira && "bg-warning/10",
      )}
    >
      <span className="flex items-center justify-between">
        <span className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-mono text-[11px]", ehHoje ? "bg-primary text-white" : "text-foreground")}>{Number(dia.data.slice(8))}</span>
        {!compacto && dia.metaMinutos > 0 && <span className="font-mono text-[10px] text-muted">meta {horas(dia.metaMinutos)}</span>}
      </span>
      {dia.ferias && (
        <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1 py-0.5 text-[10.5px] font-medium text-primary">
          <Palmtree size={11} aria-hidden /> Férias
        </span>
      )}
      {dia.ausencias.map((a) => (
        <span key={a.id} className="truncate rounded bg-warning/15 px-1 py-0.5 text-[10.5px] font-medium text-warning" title={a.motivo ?? undefined}>
          Folga {a.diaInteiro ? "" : `${hhmm(a.inicioMin as number)}–${hhmm(a.fimMin as number)}`}
        </span>
      ))}
      {feriado && (compacto ? <span className="h-1.5 w-1.5 rounded-full bg-muted" title={feriado} aria-label={feriado} /> : <span className="truncate rounded bg-surface-2 px-1 py-0.5 text-[10.5px] text-muted">{feriado}</span>)}
      {dia.apontadoMinutos > 0 && <span className="mt-auto font-mono text-[10.5px] text-foreground">{horas(dia.apontadoMinutos)}</span>}
    </button>
  );
}

export function Legenda() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 text-[12px] text-muted">
      <p className="font-mono text-[10px] uppercase tracking-widest">Legenda</p>
      <ul className="mt-2 space-y-1">
        <li>
          <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-primary/40" /> Férias (lançadas pelo gestor)
        </li>
        <li>
          <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-warning/40" /> Folga (você marca)
        </li>
        <li>Dia abonado não entra na meta. Folga fora do seu horário de trabalho não muda a meta.</li>
        <li>Feriados são só informativos: não reduzem a meta.</li>
      </ul>
    </div>
  );
}

export function SaldoDeFerias({ saldos }: { saldos: Aquisitivo[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Saldo de férias</p>
      {saldos.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-muted">Nenhum período aquisitivo cadastrado. O gestor lança na tela Férias.</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {saldos.map((a) => (
            <li key={a.id} className="text-[12.5px]">
              <p className="text-foreground">
                {dataBr(a.inicio)} a {dataBr(a.fim)}
              </p>
              <p className="font-mono text-[11.5px] text-muted">
                direito {a.diasDireito} d · gozados {a.diasGozados} d
                {a.diasFolgaDescontada > 0 && ` · folgas ${a.diasFolgaDescontada} d`}
              </p>
              <p className={cn("font-mono text-sm font-semibold", a.saldo > 0 ? "text-primary" : "text-muted")}>Saldo {a.saldo} dia(s)</p>
              {a.gozos
                .filter((g) => g.situacao !== "cancelada")
                .map((g) => (
                  <p key={g.id} className="font-mono text-[11px] text-muted">
                    {dataBr(g.inicio)} a {dataBr(g.fim)} · {g.diasCorridos} d
                  </p>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface ModalDiaProps {
  dia: DiaCalendario;
  dados: RespostaCalendario;
  feriado?: string;
  onFechar: () => void;
  onMudou: () => void;
  toast: (mensagem: string, tone?: "success" | "warning" | "destructive" | "neutral") => void;
}

export function ModalDia({ dia, dados, feriado, onFechar, onMudou, toast }: ModalDiaProps) {
  const [diaInteiro, setDiaInteiro] = useState(true);
  const [inicio, setInicio] = useState("14:00");
  const [fim, setFim] = useState("18:00");
  const [motivo, setMotivo] = useState("");
  const [desconta, setDesconta] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const aquisitivo = aquisitivoDa(dados.saldos, dia.data);
  const podeEditar = dados.permissoes.editarFolgas && !dia.ferias;
  const jaTemInteira = dia.ausencias.some((a) => a.diaInteiro);

  async function lancar() {
    setSalvando(true);
    setErro(null);
    try {
      await axios.post("/api/calendario/ausencias", {
        codfor: dados.consultor.codfor,
        data: dia.data,
        diaInteiro,
        inicioMin: diaInteiro ? null : horaParaMinutos(inicio),
        fimMin: diaInteiro ? null : horaParaMinutos(fim),
        motivo: motivo.trim() || null,
        descontaFerias: diaInteiro && desconta,
      });
      toast("Folga lançada: o gestor foi avisado.", "success");
      setMotivo("");
      setDesconta(false);
      onMudou();
    } catch (err) {
      setErro(mensagemDeErro(err, "Não foi possível lançar a folga"));
    } finally {
      setSalvando(false);
    }
  }

  async function remover(id: number) {
    try {
      await axios.delete(`/api/calendario/ausencias/${id}`);
      toast("Folga removida.", "success");
      onMudou();
    } catch (err) {
      setErro(mensagemDeErro(err, "Não foi possível remover a folga"));
    }
  }

  return (
    <Modal open onClose={onFechar} title={dataBr(dia.data)} subtitulo={`${DIAS_SEMANA_CURTO[dia.diaSemana]}${feriado ? ` · ${feriado}` : ""}`}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Meta do dia: <span className="font-mono text-foreground">{horas(dia.metaMinutos)}</span>
          {dia.baseMinutos !== dia.metaMinutos && <span className="font-mono"> (jornada {horas(dia.baseMinutos)})</span>} · apontado{" "}
          <span className="font-mono text-foreground">{horas(dia.apontadoMinutos)}</span>
        </p>

        {dia.ferias && (
          <p className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-primary">
            Este dia está dentro de um período de férias lançado pelo gestor: não conta na meta e não aceita folga.
          </p>
        )}

        {dia.ausencias.length > 0 && (
          <ul className="space-y-1.5">
            {dia.ausencias.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                <span>
                  <span className="font-medium text-foreground">{a.diaInteiro ? "Folga o dia todo" : `Folga das ${hhmm(a.inicioMin as number)} às ${hhmm(a.fimMin as number)}`}</span>
                  {a.descontaFerias && <span className="ml-2 text-[11.5px] text-warning">desconta do saldo de férias</span>}
                  {a.motivo && <span className="block text-[12px] text-muted">{a.motivo}</span>}
                </span>
                {podeEditar && (
                  <button type="button" onClick={() => remover(a.id)} aria-label="Remover folga" title="Remover folga" className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-destructive">
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {podeEditar && !jaTemInteira && (
          <fieldset className="space-y-3 rounded-md border border-border p-3">
            <legend className="px-1 font-mono text-[10px] uppercase tracking-widest text-muted">Marcar folga</legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={diaInteiro} onChange={() => setDiaInteiro(true)} className="accent-primary" /> Dia inteiro
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={!diaInteiro} onChange={() => setDiaInteiro(false)} className="accent-primary" /> Parte do dia
              </label>
            </div>
            {!diaInteiro && (
              <div className="flex items-center gap-2">
                <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} aria-label="Início da folga" className="rounded-md border border-border bg-surface px-2 py-1 text-foreground" />
                <span className="text-muted">até</span>
                <input type="time" value={fim} onChange={(e) => setFim(e.target.value)} aria-label="Fim da folga" className="rounded-md border border-border bg-surface px-2 py-1 text-foreground" />
              </div>
            )}
            <input
              type="text"
              value={motivo}
              maxLength={200}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo (opcional)"
              aria-label="Motivo da folga"
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-foreground placeholder:text-muted"
            />
            {diaInteiro && (
              <label className={cn("flex items-start gap-2 text-[12.5px]", !aquisitivo && "opacity-60")}>
                <input type="checkbox" checked={desconta} disabled={!aquisitivo} onChange={(e) => setDesconta(e.target.checked)} className="mt-0.5 accent-primary" />
                <span>
                  Descontar do saldo de férias (1 dia)
                  <span className="block text-muted">
                    {aquisitivo ? `Período ${dataBr(aquisitivo.inicio)} a ${dataBr(aquisitivo.fim)}: saldo ${aquisitivo.saldo} dia(s).` : "Não há período aquisitivo cadastrado para esta data."}
                  </span>
                </span>
              </label>
            )}
            {erro && <p className="text-destructive">{erro}</p>}
            <div className="flex justify-end">
              <button type="button" onClick={lancar} disabled={salvando} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
                {salvando ? "Salvando..." : "Lançar folga"}
              </button>
            </div>
          </fieldset>
        )}
        {podeEditar && jaTemInteira && <p className="text-[12.5px] text-muted">O dia todo já está como folga. Remova-a para marcar outra.</p>}
        {!dados.permissoes.editarFolgas && <p className="text-[12.5px] text-muted">Você só visualiza este calendário.</p>}
        {!podeEditar && erro && <p className="text-destructive">{erro}</p>}
      </div>
    </Modal>
  );
}
