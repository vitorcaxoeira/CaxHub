import { useEffect, useState } from "react";
import { derivarStatus, StatusNo } from "../../lib/cronograma";
import { NoCronogramaCompleto } from "../../hooks/useCronograma";
import { carregarCronogramaLeve } from "../../lib/cronogramaCache";
import { IconeStatusAtividade, iniciais } from "./LinhaNo";
import { Spinner } from "../ui/Spinner";

type Estado =
  | { fase: "carregando" }
  | { fase: "erro"; mensagem: string }
  | { fase: "ok"; cadeia: (NoCronogramaCompleto & { profundidade: number })[]; statusPorId: Map<number, StatusNo> };

interface HierarquiaAtividadeTooltipProps {
  codemp: number;
  codpro: number;
  estruturaAtividadeId: number;
}

// Reproduz, em modo leitura, só a coluna "Estrutura" da árvore do Cronograma (ver
// LinhaNo.tsx) — item → pasta(s) → a própria atividade. Sem horas/orçamento de propósito
// (decisão do usuário): a tooltip é sobre ONDE a atividade mora dentro da estrutura, os
// números de consumo já vivem na própria linha da Lista (ver ConsumoHoras em
// AtividadesTable.tsx) e repeti-los aqui só disputava espaço com o nome dos nós.
export function HierarquiaAtividadeTooltip({ codemp, codpro, estruturaAtividadeId }: HierarquiaAtividadeTooltipProps) {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });

  useEffect(() => {
    let cancelado = false;
    setEstado({ fase: "carregando" });
    carregarCronogramaLeve(codemp, codpro)
      .then(({ nos }) => {
        if (cancelado) return;
        const porId = new Map(nos.map((n) => [n.id, n]));
        const folha = porId.get(estruturaAtividadeId);
        if (!folha) {
          setEstado({ fase: "erro", mensagem: "Atividade não encontrada na estrutura." });
          return;
        }

        // Sobe de pai em pai a partir da folha até (e incluindo) o nó do ITEM — não sobe
        // além dele (ex.: pasta raiz da proposta que agrupa vários itens): a tooltip é sobre
        // "onde a atividade mora dentro do item", não sobre a organização da proposta
        // inteira.
        const cadeiaReversa: NoCronogramaCompleto[] = [];
        let atual: NoCronogramaCompleto | undefined = folha;
        while (atual) {
          cadeiaReversa.push(atual);
          if (atual.tipo === "item") break;
          atual = atual.parentId != null ? porId.get(atual.parentId) : undefined;
        }
        const cadeia = cadeiaReversa.reverse().map((no, profundidade) => ({ ...no, profundidade }));

        setEstado({ fase: "ok", cadeia, statusPorId: derivarStatus(nos) });
      })
      .catch(() => {
        if (!cancelado) setEstado({ fase: "erro", mensagem: "Não foi possível carregar a hierarquia." });
      });
    return () => {
      cancelado = true;
    };
  }, [codemp, codpro, estruturaAtividadeId]);

  if (estado.fase === "carregando") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted">
        <Spinner className="h-3 w-3" /> Carregando estrutura…
      </div>
    );
  }
  if (estado.fase === "erro") {
    return <div className="max-w-[240px] px-3 py-2 text-[12px] text-destructive">{estado.mensagem}</div>;
  }

  const { cadeia, statusPorId } = estado;

  return (
    // Sem largura fixa: só sobrou nome + ícone + chip/avatar, então o painel pode se ajustar
    // ao conteúdo (nome mais longo da cadeia) em vez de reservar espaço pra colunas que não
    // existem mais aqui. O teto evita estourar viewport estreito.
    <div className="max-w-[90vw] divide-y divide-border/60">
      {cadeia.map((no) => {
        const status = statusPorId.get(no.id) ?? "nao_iniciada";
        return (
          <div
            key={no.id}
            className="flex items-center gap-1.5 whitespace-nowrap bg-surface px-2 py-1.5"
            style={{ paddingLeft: 8 + no.profundidade * 18 }}
          >
            <span className="flex-none text-[12px]">{no.tipo === "item" ? "📦" : no.tipo === "pasta" ? "📁" : null}</span>
            {no.tipo === "atividade" && <IconeStatusAtividade status={status} />}
            <span className={`text-[12.5px] ${no.tipo === "item" ? "font-medium text-foreground" : "text-foreground"}`}>{no.nome}</span>

            {/* Mesma vaga compartilhada de LinhaNo: item mostra o departamento executor,
                atividade mostra o responsável. Pasta fica sem nada aqui. */}
            {no.tipo === "item" && no.depexeLabel && (
              <span className="flex-none rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] font-medium text-muted">
                {no.depexeLabel}
              </span>
            )}
            {no.tipo === "atividade" && (
              <span
                className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-surface-2 font-mono text-[8.5px] font-medium text-muted"
                title={no.responsavelNome ?? "Sem responsável"}
              >
                {iniciais(no.responsavelNome)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
