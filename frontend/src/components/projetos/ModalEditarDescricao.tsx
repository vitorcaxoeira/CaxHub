import { useState } from "react";
import { Modal } from "../ui/Modal";

interface ModalEditarDescricaoProps {
  titulo: string;
  valorInicial: string;
  onSalvar: (texto: string) => void;
  onFechar: () => void;
}

// Janela de edição da Descrição em "Sessões pendentes de confirmação" — o input inline
// de uma linha ficava apertado demais pro texto que às vezes vem grande (pré-preenchido
// do modal de observação ao parar a atividade, ver ModalObservacaoAtividade.tsx).
// Diferente daquele modal, aqui fechar sem salvar (Cancelar/Esc/backdrop) É um cancelar
// de verdade — não muda o valor atual.
export function ModalEditarDescricao({ titulo, valorInicial, onSalvar, onFechar }: ModalEditarDescricaoProps) {
  const [texto, setTexto] = useState(valorInicial);

  return (
    <Modal open onClose={onFechar} title="Editar descrição" subtitulo={titulo}>
      <textarea
        autoFocus
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSalvar(texto.trim());
        }}
        rows={5}
        placeholder="Descreva o que foi realizado nessa sessão..."
        className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onFechar}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancelar
        </button>
        <button
          onClick={() => onSalvar(texto.trim())}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Salvar
        </button>
      </div>
    </Modal>
  );
}
