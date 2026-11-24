import { useState } from "react";
import { ImpactoDatas } from "../../hooks/useCronograma";
import { formatarDataBr } from "../../lib/cronograma";
import { Modal } from "../ui/Modal";

interface ModalAjusteDatasFilhosProps {
  impactos: ImpactoDatas[];
  onAplicar: () => Promise<void>;
  onCancelar: () => void;
}

const ROTULO_TIPO: Record<ImpactoDatas["tipo"], string> = { item: "Item", pasta: "Pasta", atividade: "Atividade" };

function periodo(inicio: string | null, fim: string | null): string {
  if (!inicio && !fim) return "sem datas";
  return `${formatarDataBr(inicio) || "…"} → ${formatarDataBr(fim) || "…"}`;
}

// Aviso de que mexer no período de um pai (ou mover um nó/item pra outro pai) deixaria nós abaixo
// dele fora do novo período. Nada foi salvo ainda: "Ajustar e salvar" repete a operação pedindo
// ao servidor pra encaixar as datas de todos eles no novo período, numa transação só.
export function ModalAjusteDatasFilhos({ impactos, onAplicar, onCancelar }: ModalAjusteDatasFilhosProps) {
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const temProprio = impactos.some((i) => i.proprio);
  const descendentes = impactos.filter((i) => !i.proprio).length;

  async function aplicar() {
    setAplicando(true);
    setErro(null);
    try {
      await onAplicar();
    } catch (err) {
      setErro((err as Error).message);
      setAplicando(false);
    }
  }

  return (
    <Modal
      open
      onClose={aplicando ? () => undefined : onCancelar}
      title="Datas fora do período"
      subtitulo="Nada foi salvo ainda"
      fecharPorFora={false}
      className="max-w-2xl"
    >
      <p className="text-sm text-foreground">
        {temProprio
          ? descendentes > 0
            ? "O nó movido e os itens abaixo dele ficam fora do período do novo pai."
            : "O nó movido fica fora do período do novo pai."
          : `${descendentes} ${descendentes === 1 ? "item abaixo fica" : "itens abaixo ficam"} fora do novo período.`}{" "}
        Ajustar encaixa as datas de cada um dentro do período — quem já estava dentro não muda.
      </p>

      <ul className="mt-3 divide-y divide-border rounded-md border border-border">
        {impactos.map((i) => (
          <li key={i.chave} className="px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="flex-none rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
                {ROTULO_TIPO[i.tipo]}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={i.nome}>
                {i.nome}
                {i.proprio && <span className="ml-1.5 text-[11px] font-normal text-muted">(o próprio)</span>}
              </span>
            </div>
            {i.caminho && (
              <p className="mt-0.5 truncate text-[11.5px] text-muted" title={i.caminho}>
                {i.caminho}
              </p>
            )}
            <p className="mt-1 font-mono text-[12px] tabular-nums">
              <span className="text-muted line-through">{periodo(i.inicio, i.fim)}</span>
              <span className="mx-1.5 text-muted">→</span>
              <span className="text-foreground">{periodo(i.novoInicio, i.novoFim)}</span>
            </p>
          </li>
        ))}
      </ul>

      {erro && <p className="mt-3 text-sm text-destructive">{erro}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancelar}
          disabled={aplicando}
          className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={aplicar}
          disabled={aplicando}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {aplicando ? "Ajustando..." : `Ajustar ${impactos.length} ${impactos.length === 1 ? "item" : "itens"} e salvar`}
        </button>
      </div>
    </Modal>
  );
}
