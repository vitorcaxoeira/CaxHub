import { useState } from "react";
import { Modal } from "../ui/Modal";

interface ModalEditarDescricaoProps {
  titulo: string;
  valorInicial: string;
  onSalvar: (texto: string) => void;
  onFechar: () => void;
  // Só leitura: mesma janela, sem permitir alteração. Serve pra ler o texto completo de um
  // apontamento que não pode mais ser editado (já registrado no Senior, RAT fora de
  // "Digitada", ou de outro consultor) — na tabela ele aparece truncado.
  somenteLeitura?: boolean;
}

// Janela de edição da Descrição em "Sessões pendentes de confirmação" — o input inline
// de uma linha ficava apertado demais pro texto que às vezes vem grande (pré-preenchido
// do modal de observação ao parar a atividade, ver ModalObservacaoAtividade.tsx).
// Diferente daquele modal, aqui fechar sem salvar (Cancelar/Esc/backdrop) É um cancelar
// de verdade — não muda o valor atual.
export function ModalEditarDescricao({
  titulo,
  valorInicial,
  onSalvar,
  onFechar,
  somenteLeitura = false,
}: ModalEditarDescricaoProps) {
  const [texto, setTexto] = useState(valorInicial);

  return (
    <Modal open onClose={onFechar} title={somenteLeitura ? "Observação" : "Editar descrição"} subtitulo={titulo}>
      <textarea
        autoFocus
        readOnly={somenteLeitura}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (!somenteLeitura && e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSalvar(texto.trim());
        }}
        rows={5}
        placeholder={somenteLeitura ? "Sem observação registrada." : "Descreva o que foi realizado nessa sessão..."}
        className={`w-full resize-none rounded-md border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          somenteLeitura ? "cursor-default bg-surface-2" : "bg-surface"
        }`}
      />
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onFechar}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {somenteLeitura ? "Fechar" : "Cancelar"}
        </button>
        {!somenteLeitura && (
          <button
            onClick={() => onSalvar(texto.trim())}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Salvar
          </button>
        )}
      </div>
    </Modal>
  );
}
