import { useState } from "react";
import { Modal } from "../ui/Modal";

export interface DadosManutencaoSessao {
  /** AAAA-MM-DD */
  data: string;
  /** HH:MM */
  inicio: string;
  /** HH:MM */
  fim: string;
  descricao: string;
}

interface ModalManutencaoSessaoProps {
  titulo: string;
  /** Linhas curtas de contexto (consultor, proposta, RAT…), para o admin não alterar a sessão errada. */
  contexto: string[];
  inicial: DadosManutencaoSessao;
  /** Só leitura: quem não é admin, ou RAT que não está mais Digitada. Sem botão Salvar. */
  somenteLeitura: boolean;
  /** Por que está em leitura (texto vindo do servidor). */
  motivoSomenteLeitura?: string | null;
  /** O apontamento já está no Senior: salvar manda a alteração para lá na hora (tipEve A). */
  registradoNoSenior: boolean;
  salvando: boolean;
  erro: string | null;
  onSalvar: (dados: DadosManutencaoSessao) => void;
  onFechar: () => void;
}

const classeCampo =
  "rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:bg-surface-2";

// Manutenção dos dados de uma sessão já confirmada (Meus Apontamentos › RATs › Sessão). Os 4 campos são exatamente os
// que viajam no apontamento da RAT e no Senior (data, início, fim, descrição). Quem decide se pode salvar é o servidor — a
// tela só reflete (`somenteLeitura`). Esc/clique fora ficam desligados na edição para não perder o que foi digitado.
export function ModalManutencaoSessao({
  titulo,
  contexto,
  inicial,
  somenteLeitura,
  motivoSomenteLeitura,
  registradoNoSenior,
  salvando,
  erro,
  onSalvar,
  onFechar,
}: ModalManutencaoSessaoProps) {
  const [dados, setDados] = useState(inicial);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const atualizar = (parcial: Partial<DadosManutencaoSessao>) => setDados((d) => ({ ...d, ...parcial }));

  function salvar() {
    if (!dados.data || !dados.inicio || !dados.fim) {
      setErroLocal("Informe a data, a hora inicial e a hora final.");
      return;
    }
    if (dados.fim <= dados.inicio) {
      setErroLocal("A hora final precisa ser depois da inicial.");
      return;
    }
    if (!dados.descricao.trim()) {
      setErroLocal("A descrição é obrigatória.");
      return;
    }
    setErroLocal(null);
    onSalvar({ ...dados, descricao: dados.descricao.trim() });
  }

  const mensagemErro = erroLocal ?? erro;

  return (
    <Modal
      open
      onClose={() => !salvando && onFechar()}
      fecharPorFora={somenteLeitura}
      title={somenteLeitura ? "Sessão (somente leitura)" : "Manutenção da sessão"}
      subtitulo={titulo}
    >
      <div className="space-y-3 p-4">
        {contexto.length > 0 && (
          <ul className="rounded-md border border-border/60 bg-surface-2 px-2.5 py-2 text-[12px] text-muted">
            {contexto.map((linha) => (
              <li key={linha}>{linha}</li>
            ))}
          </ul>
        )}

        {somenteLeitura && motivoSomenteLeitura && (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-[12.5px] text-warning">{motivoSomenteLeitura}</p>
        )}
        {!somenteLeitura && registradoNoSenior && (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-[12.5px] text-warning">
            Este apontamento já está registrado no Senior. Ao salvar, a alteração é enviada ao Senior na hora (tipEve = A) para equalizar —
            se o Senior recusar ou divergir, a falha aparece na coluna "Sinc. ERP".
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="ms-data" className="text-[12px] text-muted">
            Data
          </label>
          <input
            id="ms-data"
            type="date"
            value={dados.data}
            onChange={(e) => atualizar({ data: e.target.value })}
            disabled={somenteLeitura || salvando}
            className={classeCampo}
          />
          <label htmlFor="ms-ini" className="text-[12px] text-muted">
            das
          </label>
          <input
            id="ms-ini"
            type="time"
            value={dados.inicio}
            onChange={(e) => atualizar({ inicio: e.target.value })}
            disabled={somenteLeitura || salvando}
            className={classeCampo}
          />
          <label htmlFor="ms-fim" className="text-[12px] text-muted">
            às
          </label>
          <input
            id="ms-fim"
            type="time"
            value={dados.fim}
            onChange={(e) => atualizar({ fim: e.target.value })}
            disabled={somenteLeitura || salvando}
            className={classeCampo}
          />
        </div>

        <div>
          <label htmlFor="ms-desc" className="mb-1 block text-[12px] text-muted">
            Descrição
          </label>
          <textarea
            id="ms-desc"
            value={dados.descricao}
            onChange={(e) => atualizar({ descricao: e.target.value })}
            readOnly={somenteLeitura}
            disabled={salvando}
            maxLength={1000}
            rows={5}
            placeholder={somenteLeitura ? "Sem descrição registrada." : "Descreva o que foi realizado nessa sessão..."}
            className={`w-full resize-none ${classeCampo}`}
          />
        </div>

        {mensagemErro && <p className="text-[12px] text-destructive">{mensagemErro}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onFechar}
            disabled={salvando}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
          >
            {somenteLeitura ? "Fechar" : "Cancelar"}
          </button>
          {!somenteLeitura && (
            <button
              onClick={salvar}
              disabled={salvando}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {salvando ? "Salvando..." : registradoNoSenior ? "Salvar e enviar ao Senior" : "Salvar"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
