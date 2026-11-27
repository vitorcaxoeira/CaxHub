import { useState } from "react";
import { Modal } from "../ui/Modal";
import { ModalObservacaoAtividade } from "./ModalObservacaoAtividade";

/** Tela filtrada nos apontamentos que ainda precisam de descrição. */
export const ROTA_AJUSTAR_DESCRICOES = "/projetos/apontamentos?semDescricao=1";

/** O que vai junto no reenvio do início, depois de o consultor descrever a atividade que estava em andamento. */
export interface DescricaoDaEmAndamento {
  observacaoEmAndamento: string;
  sessaoEmAndamentoId: number;
}

interface EmAndamento {
  sessaoId: number;
  titulo: string;
  descricaoAtividade: string | null;
  itemDescricao: string | null;
  nota: string | null;
}

export function ModalDescricaoPendente({
  mensagem,
  onAjustar,
  onFechar,
}: {
  mensagem: string;
  /** Ausente quando quem tentou iniciar não é o consultor: só ele descreve. */
  onAjustar?: () => void;
  onFechar: () => void;
}) {
  return (
    <Modal open onClose={onFechar} title="Há apontamento sem descrição">
      <p className="text-sm leading-relaxed text-foreground">{mensagem}</p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          onClick={onFechar}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Fechar
        </button>
        {onAjustar && (
          <button
            onClick={onAjustar}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Ajustar em Meus Apontamentos
          </button>
        )}
      </div>
    </Modal>
  );
}

// As duas recusas de início (botão Iniciar ou arrastar o card pra "Em Andamento"), tratadas num lugar só pra tela de Atividades e a janela
// flutuante: 409 `descrever_em_andamento` (conte o que fez na que está rodando e o início é reenviado) e 409 `descricao_pendente`
// (há apontamento sem descrição: bloqueado até ajustar em Meus Apontamentos).
export function useRecusaDeInicio(onAjustar: () => void) {
  const [pedido, setPedido] = useState<{ dados: EmAndamento; continuar: (extras: DescricaoDaEmAndamento) => void } | null>(null);
  const [bloqueio, setBloqueio] = useState<{ mensagem: string; souOConsultor: boolean } | null>(null);

  /** `true` quando o erro era uma dessas recusas (e já foi tratado). `continuar` refaz o início com a descrição. */
  function tratarRecusa(err: any, continuar: (extras: DescricaoDaEmAndamento) => void): boolean {
    const corpo = err?.response?.data;
    if (corpo?.codigo === "descrever_em_andamento") {
      setPedido({ dados: corpo.emAndamento, continuar });
      return true;
    }
    if (corpo?.codigo === "descricao_pendente") {
      setBloqueio({ mensagem: corpo.error, souOConsultor: corpo.souOConsultor === true });
      return true;
    }
    return false;
  }

  const modais = (
    <>
      {pedido && (
        <ModalObservacaoAtividade
          key={pedido.dados.sessaoId}
          titulo={pedido.dados.titulo}
          descricaoAtividade={pedido.dados.descricaoAtividade}
          itemDescricao={pedido.dados.itemDescricao}
          nota={pedido.dados.nota}
          aviso="Esta atividade está em andamento e será pausada. Conte o que foi feito nela para iniciar a outra."
          rotuloSalvar="Salvar e iniciar"
          onCancelar={() => setPedido(null)}
          onConfirmar={(texto) => {
            setPedido(null);
            pedido.continuar({ observacaoEmAndamento: texto, sessaoEmAndamentoId: pedido.dados.sessaoId });
          }}
        />
      )}
      {bloqueio && (
        <ModalDescricaoPendente
          mensagem={bloqueio.mensagem}
          onFechar={() => setBloqueio(null)}
          onAjustar={
            bloqueio.souOConsultor
              ? () => {
                  setBloqueio(null);
                  onAjustar();
                }
              : undefined
          }
        />
      )}
    </>
  );

  return { tratarRecusa, modais };
}
