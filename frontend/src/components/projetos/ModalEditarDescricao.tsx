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
  // Título da janela no modo só leitura — default "Observação". Mesmo componente reaproveitado
  // (28/08/2026) pra mostrar o erro completo de "falha no envio", que não é uma observação.
  tituloSomenteLeitura?: string;
}

// Janela de edição da Descrição em "Sessões pendentes de confirmação" — o input inline
// de uma linha ficava apertado demais pro texto que às vezes vem grande (pré-preenchido
// do modal de observação ao parar a atividade, ver ModalObservacaoAtividade.tsx). Fechar
// sem clicar "Salvar" (Cancelar/✕) É um cancelar de verdade — não muda o valor já salvo —
// mas fechar por ACIDENTE (clique fora, Esc) ainda perderia o texto digitado até ali, por
// isso Esc/backdrop ficam desligados em modo de edição (ver fecharPorFora abaixo).
export function ModalEditarDescricao({
  titulo,
  valorInicial,
  onSalvar,
  onFechar,
  somenteLeitura = false,
  tituloSomenteLeitura = "Observação",
}: ModalEditarDescricaoProps) {
  const [texto, setTexto] = useState(valorInicial);

  return (
    // fecharPorFora={!somenteLeitura}: no modo de edição de verdade (textarea livre), sair
    // sem querer (clique fora, Esc) perderia o texto digitado — mesmo cuidado já aplicado em
    // ModalObservacaoAtividade.tsx/ModalLancarDespesa.tsx. No modo só-leitura não há nada a
    // perder, então continua fechando fácil (comportamento de sempre).
    <Modal
      open
      onClose={onFechar}
      fecharPorFora={somenteLeitura}
      title={somenteLeitura ? tituloSomenteLeitura : "Editar descrição"}
      subtitulo={titulo}
    >
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
