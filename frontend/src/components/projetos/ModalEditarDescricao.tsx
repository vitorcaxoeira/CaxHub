import { useState } from "react";
import { Modal } from "../ui/Modal";
import { erroDeDescricao, textoInicialDaDescricao } from "../../lib/descricao-apontamento";
import { CampoDescricaoApontamento } from "./CampoDescricaoApontamento";

interface ModalEditarDescricaoProps {
  titulo: string;
  valorInicial: string;
  onSalvar: (texto: string) => void;
  onFechar: () => void;
  // Só leitura: mesma janela, sem permitir alteração. Serve pra ler o texto completo de um
  // apontamento que não pode mais ser editado (já registrado no Senior, RAT fora de
  // "Digitada", ou de outro consultor) — na tabela ele aparece truncado.
  somenteLeitura?: boolean;
  /** Só informação, num bloco acima do campo, e referência para recusar texto repetido. */
  descricaoAtividade?: string | null;
  itemDescricao?: string | null;
  // Título da janela no modo só leitura — default "Observação". Mesmo componente reaproveitado
  // (28/08/2026) pra mostrar o erro completo de "falha no envio", que não é uma observação.
  tituloSomenteLeitura?: string;
  /** Repassado ao campo — gestor/admin escrevendo no apontamento de um consultor. */
  placeholder?: string;
}

// Janela de edição da Descrição em "Sessões pendentes de confirmação" — o input inline
// de uma linha ficava apertado demais pro texto que às vezes vem grande (o que o consultor
// escreveu ao parar a atividade, ver ModalObservacaoAtividade.tsx). Fechar
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
  descricaoAtividade,
  itemDescricao,
  placeholder,
}: ModalEditarDescricaoProps) {
  const [texto, setTexto] = useState(() =>
    somenteLeitura ? valorInicial : textoInicialDaDescricao(valorInicial, [descricaoAtividade, itemDescricao])
  );
  const valido = erroDeDescricao(texto, [descricaoAtividade, itemDescricao]) == null;

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
      {somenteLeitura ? (
        <textarea
          autoFocus
          readOnly
          value={texto}
          rows={5}
          placeholder="Sem observação registrada."
          className="w-full cursor-default resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <CampoDescricaoApontamento
          autoFocus
          rows={5}
          valor={texto}
          onChange={setTexto}
          descricaoAtividade={descricaoAtividade}
          itemDescricao={itemDescricao}
          placeholder={placeholder}
          onAtalhoSalvar={() => onSalvar(texto.trim())}
        />
      )}
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
            disabled={!valido}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            Salvar
          </button>
        )}
      </div>
    </Modal>
  );
}
