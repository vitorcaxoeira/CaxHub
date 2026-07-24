import { useState } from "react";
import { NoCronogramaCompleto } from "../../hooks/useCronograma";
import { DropdownMenu } from "../ui/DropdownMenu";

// `id` é sempre um nó real (pasta) ou virtual (item) já existente na árvore — nunca um
// sentinela "raiz" à parte, já que "raiz do item" é só escolher o próprio nó do item.
export interface DestinoMover {
  id: number;
  label: string;
}

interface MenuAcoesNoProps {
  no: NoCronogramaCompleto;
  contagemDescendentes: number;
  destinosPossiveis: DestinoMover[];
  // Item de proposta: nunca é uma linha real (vem do Senior, virtual) — não dá pra
  // renomear/duplicar/excluir por aqui, só agrupar/soltar de uma pasta raiz.
  ehItem?: boolean;
  onRenomear: () => void;
  onDuplicar: () => void;
  onMoverPara: (parentId: number) => void;
  onSoltar?: () => void;
  onAdicionarDentro?: (tipo: "pasta" | "atividade") => void;
  permiteAdicionarAtividade?: boolean;
  // Presente só pro item e pra pasta filha de item (nunca pasta raiz da proposta, que
  // não tem teto de horas próprio — ver ArvoreCronograma).
  onAlocarConsultores?: () => void;
  onExcluir: () => void;
}

export function MenuAcoesNo({
  no,
  contagemDescendentes,
  destinosPossiveis,
  ehItem = false,
  onRenomear,
  onDuplicar,
  onMoverPara,
  onSoltar,
  onAdicionarDentro,
  permiteAdicionarAtividade = true,
  onAlocarConsultores,
  onExcluir,
}: MenuAcoesNoProps) {
  const [open, setOpen] = useState(false);
  const [mostrarMover, setMostrarMover] = useState(false);

  function aoMudarAberto(proximo: boolean) {
    setOpen(proximo);
    if (!proximo) setMostrarMover(false);
  }

  function confirmarExcluir() {
    const aviso =
      contagemDescendentes > 0
        ? `Excluir "${no.nome}" e ${contagemDescendentes} item(ns) dentro dele?`
        : `Excluir "${no.nome}"?`;
    if (window.confirm(aviso)) onExcluir();
  }

  return (
    <DropdownMenu open={open} onOpenChange={aoMudarAberto}>
      <DropdownMenu.Trigger>
        <button
          onClick={(e) => e.stopPropagation()}
          className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Ações"
        >
          ⋯
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {!mostrarMover ? (
          <>
            {!ehItem && (
              <>
                <DropdownMenu.Item onSelect={onRenomear}>Renomear</DropdownMenu.Item>
                <DropdownMenu.Item onSelect={onDuplicar}>Duplicar</DropdownMenu.Item>
              </>
            )}
            {destinosPossiveis.length > 0 && (
              <DropdownMenu.Item closeOnSelect={false} onSelect={() => setMostrarMover(true)}>
                {ehItem ? "Agrupar em pasta…" : "Mover para…"}
              </DropdownMenu.Item>
            )}
            {ehItem && onSoltar && no.parentId != null && <DropdownMenu.Item onSelect={onSoltar}>Soltar do grupo</DropdownMenu.Item>}
            {onAlocarConsultores && (
              <>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={onAlocarConsultores} className="text-primary hover:bg-primary/10">
                  Alocar consultores…
                </DropdownMenu.Item>
              </>
            )}
            {onAdicionarDentro && (
              <>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => onAdicionarDentro("pasta")}>Adicionar pasta dentro</DropdownMenu.Item>
                {permiteAdicionarAtividade && (
                  <DropdownMenu.Item onSelect={() => onAdicionarDentro("atividade")}>Adicionar atividade dentro</DropdownMenu.Item>
                )}
              </>
            )}
            {!ehItem && (
              <>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={confirmarExcluir} destructive>
                  Excluir
                </DropdownMenu.Item>
              </>
            )}
          </>
        ) : (
          <DropdownMenu.Panel>
            <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted">Mover para</p>
            {destinosPossiveis.map((d) => (
              <DropdownMenu.Item key={d.id} onSelect={() => onMoverPara(d.id)} className="truncate">
                {d.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Panel>
        )}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
