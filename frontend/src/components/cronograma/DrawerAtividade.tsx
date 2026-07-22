import { useEffect, useState } from "react";
import axios from "axios";
import { HorasAgregadas, StatusNo, formatHorasCompacto, projetarSaldo } from "../../lib/cronograma";
import { NoCronogramaCompleto, PatchNo } from "../../hooks/useCronograma";
import { horasParaMinutos, minutosParaInputHoras } from "../../utils/horas";

const OPCOES_STATUS: { value: Exclude<StatusNo, "bloqueada">; label: string }[] = [
  { value: "nao_iniciada", label: "Não iniciada" },
  { value: "em_curso", label: "Em curso" },
  { value: "concluida", label: "Concluída" },
];

function dataParaInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

interface DrawerAtividadeProps {
  no: NoCronogramaCompleto;
  // Item dono da atividade — pra projetar o saldo do orçamento em tempo real enquanto o
  // usuário digita (ver projetarSaldo). Undefined pra pasta (não tem horasPrevistas
  // editável) ou se por algum motivo o item não for encontrado.
  item?: NoCronogramaCompleto;
  porId: Map<number, NoCronogramaCompleto>;
  agregados: Map<number, HorasAgregadas>;
  candidatosPredecessora: NoCronogramaCompleto[];
  onFechar: () => void;
  onSalvar: (id: number, patch: PatchNo) => Promise<void>;
  // Dígitos mínimos de hora usados na tela inteira (ver larguraHorasProposta).
  larguraHoras: number;
}

export function DrawerAtividade({
  no,
  item,
  porId,
  agregados,
  candidatosPredecessora,
  onFechar,
  onSalvar,
  larguraHoras,
}: DrawerAtividadeProps) {
  const [nome, setNome] = useState(no.nome);
  const [responsavelCodfor, setResponsavelCodfor] = useState<number | "">(no.responsavelCodfor ?? "");
  const [consultores, setConsultores] = useState<{ codfor: number; nome: string }[]>([]);
  const [horasTexto, setHorasTexto] = useState(minutosParaInputHoras(no.horasPrevistas));
  const [inicio, setInicio] = useState(dataParaInput(no.dataPrevistaInicio));
  const [fim, setFim] = useState(dataParaInput(no.dataPrevistaFim));
  const [predecessoraId, setPredecessoraId] = useState<number | "">(no.predecessoraId ?? "");
  const [status, setStatus] = useState<Exclude<StatusNo, "bloqueada">>(no.statusManual ?? "nao_iniciada");
  const [observacao, setObservacao] = useState(no.observacao ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Projeção em tempo real do saldo do item (roda a cada tecla, é O(1) — ver
  // projetarSaldo) — feedback antes de salvar, não depois. Só existe pra atividade
  // (pasta não tem horasPrevistas editável nem item dono no mesmo sentido).
  const horasPrevistasProjetadas = no.tipo === "atividade" ? horasParaMinutos(horasTexto) : null;
  const saldoProjetado =
    item && horasPrevistasProjetadas != null ? projetarSaldo(item, no.id, horasPrevistasProjetadas, porId, agregados) : null;
  const estouraOrcamento = saldoProjetado != null && saldoProjetado < 0;

  useEffect(() => {
    setNome(no.nome);
    setResponsavelCodfor(no.responsavelCodfor ?? "");
    setHorasTexto(minutosParaInputHoras(no.horasPrevistas));
    setInicio(dataParaInput(no.dataPrevistaInicio));
    setFim(dataParaInput(no.dataPrevistaFim));
    setPredecessoraId(no.predecessoraId ?? "");
    setStatus(no.statusManual ?? "nao_iniciada");
    setObservacao(no.observacao ?? "");
    setErro(null);
  }, [no.id]);

  useEffect(() => {
    if (no.tipo !== "atividade" || no.depexe == null) return;
    axios
      .get("/api/alocacao/consultores-elegiveis", { params: { depexe: no.depexe } })
      .then(({ data }) => setConsultores(data.consultores))
      .catch(() => setConsultores([]));
  }, [no.tipo, no.depexe]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  async function salvar() {
    if (nome.trim() === "") {
      setErro("Nome é obrigatório");
      return;
    }
    setSalvando(true);
    setErro(null);
    const patch: PatchNo = { nome: nome.trim() };
    if (no.tipo === "atividade") {
      const horasPrevistas = horasParaMinutos(horasTexto);
      if (horasTexto.trim() !== "" && horasPrevistas == null) {
        setErro("Horas previstas inválidas");
        setSalvando(false);
        return;
      }
      const consultorSelecionado = consultores.find((c) => c.codfor === responsavelCodfor);
      patch.responsavelCodfor = responsavelCodfor === "" ? null : responsavelCodfor;
      patch.responsavelNome = responsavelCodfor === "" ? null : consultorSelecionado?.nome ?? null;
      patch.horasPrevistas = horasPrevistas;
      patch.dataPrevistaInicio = inicio === "" ? null : inicio;
      patch.dataPrevistaFim = fim === "" ? null : fim;
      patch.predecessoraId = predecessoraId === "" ? null : predecessoraId;
      patch.statusManual = status;
      patch.observacao = observacao.trim() === "" ? null : observacao.trim();
      // Distribuição pode ser provisória — não bloqueia o salvamento quando estoura o
      // orçamento do item, só avisa (ver saldoProjetado acima) e manda essa confirmação
      // "leve" junto (o rótulo do botão já é o aviso; não pede um segundo clique).
      if (estouraOrcamento) patch.confirmarExcedente = true;
    }
    try {
      await onSalvar(no.id, patch);
      onFechar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-foreground/20" onClick={onFechar} />
      <div className="relative flex h-full w-full flex-col overflow-y-auto border-l border-border bg-surface p-5 shadow-xl sm:w-[420px]">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {no.tipo === "pasta" ? "Pasta" : "Atividade"}
          </p>
          <button
            onClick={onFechar}
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="drawer-nome" className="mb-1 block text-[12.5px] font-medium text-muted">
              Nome
            </label>
            <input
              id="drawer-nome"
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {no.tipo === "atividade" && (
            <>
              <div>
                <label htmlFor="drawer-responsavel" className="mb-1 block text-[12.5px] font-medium text-muted">
                  Responsável
                </label>
                <select
                  id="drawer-responsavel"
                  value={responsavelCodfor}
                  onChange={(e) => setResponsavelCodfor(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Sem responsável</option>
                  {consultores.map((c) => (
                    <option key={c.codfor} value={c.codfor}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="drawer-horas" className="mb-1 block text-[12.5px] font-medium text-muted">
                  Horas previstas (h:mm)
                </label>
                <input
                  id="drawer-horas"
                  type="text"
                  inputMode="numeric"
                  placeholder="ex.: 4:30"
                  value={horasTexto}
                  onChange={(e) => setHorasTexto(e.target.value)}
                  className={`w-full rounded-md border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    estouraOrcamento ? "border-destructive" : "border-border"
                  }`}
                />
                {saldoProjetado != null && (
                  <p className={`mt-1 text-[11px] ${estouraOrcamento ? "text-destructive" : "text-success"}`}>
                    Saldo do item após salvar: {formatHorasCompacto(saldoProjetado, larguraHoras)}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="drawer-inicio" className="mb-1 block text-[12.5px] font-medium text-muted">
                    Início previsto
                  </label>
                  <input
                    id="drawer-inicio"
                    type="date"
                    value={inicio}
                    onChange={(e) => setInicio(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label htmlFor="drawer-fim" className="mb-1 block text-[12.5px] font-medium text-muted">
                    Fim previsto
                  </label>
                  <input
                    id="drawer-fim"
                    type="date"
                    value={fim}
                    onChange={(e) => setFim(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="drawer-predecessora" className="mb-1 block text-[12.5px] font-medium text-muted">
                  Predecessora
                </label>
                <select
                  id="drawer-predecessora"
                  value={predecessoraId}
                  onChange={(e) => setPredecessoraId(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Nenhuma</option>
                  {candidatosPredecessora
                    .filter((c) => c.id !== no.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label htmlFor="drawer-status" className="mb-1 block text-[12.5px] font-medium text-muted">
                  Status
                </label>
                <select
                  id="drawer-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as Exclude<StatusNo, "bloqueada">)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {OPCOES_STATUS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-muted">
                  "Bloqueada" é calculada automaticamente quando a predecessora não está concluída.
                </p>
              </div>

              <div>
                <label htmlFor="drawer-observacao" className="mb-1 block text-[12.5px] font-medium text-muted">
                  Observação
                </label>
                <textarea
                  id="drawer-observacao"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </>
          )}
        </div>

        {erro && <p className="mt-4 text-sm text-destructive">{erro}</p>}

        <div className="mt-auto flex gap-2 pt-5">
          <button
            onClick={onFechar}
            className="flex-1 rounded-md border border-border py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando}
            className={`flex-1 rounded-md py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              estouraOrcamento ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"
            }`}
          >
            {salvando ? "Salvando..." : estouraOrcamento ? "Salvar mesmo excedendo" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
