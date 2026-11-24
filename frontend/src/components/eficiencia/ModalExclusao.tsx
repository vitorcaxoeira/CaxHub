import { FormEvent, useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import { MotivoExclusao, hhmm } from "../../lib/eficiencia";

const OBSERVACAO_MAX = 300;

// Pede o motivo (lista fechada) e, para "Outro", a observação. As regras repetem as do servidor
// (domain/eficienciaExclusoes.ts) só pra avisar antes do envio; quem decide é sempre o backend.
export function ModalExclusao({
  aberto,
  motivos,
  resumo,
  minutos,
  onConfirmar,
  onCancelar,
}: {
  aberto: boolean;
  motivos: MotivoExclusao[];
  /** Uma linha dizendo qual apontamento será tirado (data, consultor...). */
  resumo: string;
  minutos: number;
  /** Devolve a mensagem de erro, ou null se deu certo (o pai fecha o modal). */
  onConfirmar: (motivo: string, observacao: string) => Promise<string | null>;
  onCancelar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (aberto) {
      setMotivo("");
      setObservacao("");
      setErro(null);
      setEnviando(false);
    }
  }, [aberto]);

  const exigeObservacao = motivo === "outro";
  const invalido = !motivo || (exigeObservacao && observacao.trim().length === 0) || observacao.length > OBSERVACAO_MAX;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (invalido || enviando) return;
    setEnviando(true);
    setErro(null);
    const falha = await onConfirmar(motivo, observacao.trim());
    if (falha) {
      setErro(falha);
      setEnviando(false);
    }
  }

  const campo =
    "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Modal open={aberto} onClose={onCancelar} title="Tirar do cálculo" subtitulo={resumo} fecharPorFora={false}>
      <form onSubmit={enviar} className="space-y-4">
        <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-muted">
          Estes <b className="font-mono text-foreground">{hhmm(minutos)} h</b> deixam de contar no executado do item neste painel. O apontamento, a RAT, o teto da Alocação e o
          Senior <b className="text-foreground">não mudam</b>. Você pode restaurar depois.
        </p>

        <div>
          <label htmlFor="motivo-exclusao" className="mb-1 block text-[13px] font-medium text-foreground">
            Motivo
          </label>
          <select id="motivo-exclusao" value={motivo} onChange={(e) => setMotivo(e.target.value)} className={campo} required>
            <option value="">Selecione…</option>
            {motivos.map((m) => (
              <option key={m.chave} value={m.chave}>
                {m.rotulo}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="obs-exclusao" className="mb-1 block text-[13px] font-medium text-foreground">
            Observação {exigeObservacao ? <span className="text-destructive">(obrigatória)</span> : <span className="text-muted">(opcional)</span>}
          </label>
          <textarea
            id="obs-exclusao"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={3}
            maxLength={OBSERVACAO_MAX}
            placeholder={exigeObservacao ? "Explique por que este apontamento sai do cálculo" : "Algo que ajude quem ler o histórico"}
            className={`${campo} resize-y`}
          />
          <p className="mt-1 text-right text-[11.5px] text-muted">
            {observacao.length}/{OBSERVACAO_MAX}
          </p>
        </div>

        {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{erro}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={enviando}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={invalido || enviando}
            className="rounded-md bg-destructive px-3 py-1.5 text-[13px] font-medium text-destructive-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {enviando ? "Tirando…" : "Tirar do cálculo"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
