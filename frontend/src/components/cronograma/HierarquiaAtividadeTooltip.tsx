import { useEffect, useState } from "react";
import { carregarHierarquiaAtividade, NoHierarquia } from "../../lib/hierarquiaAtividadeCache";
import { IconeStatusAtividade, iniciais } from "./LinhaNo";
import { Spinner } from "../ui/Spinner";

type Estado = { fase: "carregando" } | { fase: "erro"; mensagem: string } | { fase: "ok"; cadeia: NoHierarquia[] };

interface HierarquiaAtividadeTooltipProps {
  atividadeId: number;
  // Item da proposta (📦) que encabeça a cadeia — já disponível na própria linha da Lista
  // (itemDescricao/depexeLabel), então não faz parte da resposta do endpoint: seria uma
  // segunda fonte pro MESMO dado que a linha já tem.
  itemNome: string;
  itemDepexeLabel: string;
}

// Reproduz, em modo leitura, só a coluna "Estrutura" da árvore do Cronograma (ver
// LinhaNo.tsx) — item → pasta(s) → a própria atividade. Sem horas/orçamento (decisão do
// usuário): a tooltip é sobre ONDE a atividade mora dentro da estrutura, os números de
// consumo já vivem na própria linha da Lista (ver ConsumoHoras em AtividadesTable.tsx).
//
// Busca só a estrutura do ITEM desta atividade (GET /atividades/:id/hierarquia), não a
// proposta inteira — liberado pra qualquer atividade que já apareça na Lista pro usuário
// logado, mesmo sem ele gerenciar o departamento (decisão do usuário; ver comentário da
// rota em backend/src/routes/atividades.ts).
export function HierarquiaAtividadeTooltip({ atividadeId, itemNome, itemDepexeLabel }: HierarquiaAtividadeTooltipProps) {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });

  useEffect(() => {
    let cancelado = false;
    setEstado({ fase: "carregando" });
    carregarHierarquiaAtividade(atividadeId)
      .then((cadeia) => {
        if (!cancelado) setEstado({ fase: "ok", cadeia });
      })
      .catch(() => {
        if (!cancelado) setEstado({ fase: "erro", mensagem: "Não foi possível carregar a hierarquia." });
      });
    return () => {
      cancelado = true;
    };
  }, [atividadeId]);

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

  return (
    // Sem largura fixa: o painel se ajusta ao nome mais longo da cadeia em vez de reservar
    // espaço pra colunas de números que não existem mais aqui. O teto evita estourar
    // viewport estreito.
    <div className="max-w-[90vw] divide-y divide-border/60">
      <div className="flex items-center gap-1.5 whitespace-nowrap bg-surface px-2 py-1.5">
        <span className="flex-none text-[12px]">📦</span>
        <span className="text-[12.5px] font-medium text-foreground">{itemNome}</span>
        {itemDepexeLabel && (
          <span className="flex-none rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] font-medium text-muted">{itemDepexeLabel}</span>
        )}
      </div>
      {estado.cadeia.map((no, i) => (
        <div key={no.id} className="flex items-center gap-1.5 whitespace-nowrap bg-surface px-2 py-1.5" style={{ paddingLeft: 8 + (i + 1) * 18 }}>
          <span className="flex-none text-[12px]">{no.tipo === "pasta" ? "📁" : null}</span>
          {no.tipo === "atividade" && <IconeStatusAtividade status={no.status ?? "nao_iniciada"} />}
          <span className="text-[12.5px] text-foreground">{no.nome}</span>
          {no.tipo === "atividade" && (
            <span
              className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-surface-2 font-mono text-[8.5px] font-medium text-muted"
              title={no.responsavelNome ?? "Sem responsável"}
            >
              {iniciais(no.responsavelNome)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
