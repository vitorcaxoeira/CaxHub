import { useState } from "react";
import { Modal } from "../ui/Modal";
import { erroDeDescricao, textoInicialDaDescricao } from "../../lib/descricao-apontamento";
import { CampoDescricaoApontamento } from "./CampoDescricaoApontamento";

interface ModalObservacaoAtividadeProps {
  titulo: string;
  /** Só informação, num bloco acima do campo — o campo NUNCA abre com ela. */
  descricaoAtividade?: string | null;
  itemDescricao?: string | null;
  /** Nota de progresso que o próprio consultor já salvou na sessão; sem ela o campo abre vazio. */
  nota?: string | null;
  onConfirmar: (observacao: string) => void;
  /** Desistir NÃO executa nada: não para, não move e não inicia. */
  onCancelar: () => void;
  /** "O que foi feito?" (parar/mover/iniciar outra) ou "O que está sendo feito?" (nota de progresso). */
  pergunta?: string;
  /** Recado acima do campo (ex.: por que a pergunta apareceu ao iniciar outra atividade). */
  aviso?: string;
  rotuloSalvar?: string;
}

// Abre ao sair de "Em Andamento" (parar, mover o card, iniciar outra) e pra salvar a nota de progresso. A descrição é obrigatória
// (27/11/2026): "Salvar" só liga com um texto que o servidor vai aceitar.
//
// Sai só pelos botões (ou pelo ✕): clique fora e Esc não fecham, senão um clique torto na tela descartaria o texto que a pessoa acabou
// de escrever.
export function ModalObservacaoAtividade({
  titulo,
  descricaoAtividade,
  itemDescricao,
  nota,
  onConfirmar,
  onCancelar,
  pergunta = "O que foi feito?",
  aviso,
  rotuloSalvar = "Salvar",
}: ModalObservacaoAtividadeProps) {
  const [texto, setTexto] = useState(() => textoInicialDaDescricao(nota, [descricaoAtividade, itemDescricao]));
  const valido = erroDeDescricao(texto, [descricaoAtividade, itemDescricao]) == null;
  const confirmar = () => {
    if (valido) onConfirmar(texto.trim());
  };

  return (
    <Modal open onClose={onCancelar} fecharPorFora={false} title={pergunta} subtitulo={titulo}>
      {aviso && <p className="mb-3 text-[12.5px] leading-snug text-muted">{aviso}</p>}
      <CampoDescricaoApontamento
        autoFocus
        valor={texto}
        onChange={setTexto}
        descricaoAtividade={descricaoAtividade}
        itemDescricao={itemDescricao}
        onAtalhoSalvar={confirmar}
      />
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancelar}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancelar
        </button>
        <button
          onClick={confirmar}
          disabled={!valido}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {rotuloSalvar}
        </button>
      </div>
    </Modal>
  );
}
