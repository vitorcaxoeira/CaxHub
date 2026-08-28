import { useState } from "react";
import { Modal } from "../ui/Modal";

interface ModalObservacaoAtividadeProps {
  titulo: string;
  // Descrição da atividade, vinda do servidor (ver descricaoPadraoDaAtividade). Abre o
  // campo já preenchido — é o mesmo texto que a parada automática grava sozinha.
  descricaoPadrao?: string | null;
  onConfirmar: (observacao: string) => void;
  onFechar: () => void;
  // "O que foi feito?" (parar/mover) por padrão; "O que está sendo feito?" (28/08/2026) pra
  // salvar nota de progresso sem parar — ver Atividades.tsx.
  pergunta?: string;
  // "Pular" (parar/mover) ainda executa a ação, só sem texto — "Cancelar" (nota de progresso)
  // não executa nada. O rótulo muda junto pra não confundir os dois comportamentos.
  rotuloFechar?: string;
}

// Abre ao sair de "Em Andamento" (mover o card ou clicar Parar, ver Atividades.tsx) —
// pré-preenche a Descrição em Meus Apontamentos depois. Fechar NÃO cancela a movimentação,
// que já aconteceu/foi confirmada pelo usuário antes deste modal abrir — só decide se leva
// texto junto.
//
// Sai só pelos botões (ou pelo ✕): clique fora e Esc não fecham, senão um clique torto na
// tela descartaria o texto que a pessoa acabou de escrever.
//
// Vem com a descrição da atividade já escrita: o que a pessoa editar prevalece, e "Pular"
// deixa a herança acontecer do lado do servidor de qualquer forma.
export function ModalObservacaoAtividade({
  titulo,
  descricaoPadrao,
  onConfirmar,
  onFechar,
  pergunta = "O que foi feito?",
  rotuloFechar = "Pular",
}: ModalObservacaoAtividadeProps) {
  const [texto, setTexto] = useState(descricaoPadrao ?? "");

  return (
    <Modal open onClose={onFechar} fecharPorFora={false} title={pergunta} subtitulo={titulo}>
      <textarea
        autoFocus
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onConfirmar(texto.trim());
        }}
        rows={3}
        placeholder="Descreva rapidamente o que foi realizado (opcional)..."
        className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onFechar}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {rotuloFechar}
        </button>
        <button
          onClick={() => onConfirmar(texto.trim())}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Salvar
        </button>
      </div>
    </Modal>
  );
}
