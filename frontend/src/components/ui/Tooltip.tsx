import { cloneElement, isValidElement, ReactElement, ReactNode, useState } from "react";
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  Placement,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { cn } from "../../lib/cn";

// Tooltip de conteúdo RICO (JSX, não string) — o atributo HTML `title` nativo não dá conta
// de layout com ícones/cores/colunas (ex.: a hierarquia do item na Lista de Atividades, ver
// HierarquiaAtividadeTooltip). Mesma base do DropdownMenu (@floating-ui/react), trocando
// useClick por useHover: abre com um pequeno atraso (evita disparo ao só passar o mouse de
// leve) e usa safePolygon pra não fechar ao mover o cursor do trigger até o próprio
// conteúdo, necessário porque o painel pode ser maior que o trigger.
//
// `asChild`: clona o filho único em vez de embrulhar num elemento extra — importante aqui
// porque o trigger normalmente já é um <span> com `truncate`/`min-w-0` dentro de um flex, e
// mais uma camada de wrapper quebraria esse layout (mesma lição do bug de truncate sem
// `block`, ver AtividadesTable.tsx).
interface TooltipProps {
  children: ReactElement;
  content: ReactNode;
  placement?: Placement;
  // Tooltip nunca abre (nem registra os listeners de hover) — usado quando o chamador sabe
  // de antemão que não há conteúdo pra mostrar (ex.: atividade sem nó de estrutura).
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Tooltip({ children, content, placement = "top", disabled, onOpenChange }: TooltipProps) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: !disabled && open,
    onOpenChange: (proximo) => {
      setOpen(proximo);
      onOpenChange?.(proximo);
    },
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });

  const hover = useHover(context, { delay: { open: 300, close: 100 }, handleClose: safePolygon(), enabled: !disabled });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss, role]);

  if (disabled || !isValidElement(children)) return children;

  const child = children as ReactElement<any>;

  return (
    <>
      {cloneElement(child, getReferenceProps({ ref: refs.setReference, ...child.props }))}
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className={cn("z-popover overflow-hidden rounded-md border border-border bg-surface shadow-lg")}
            {...getFloatingProps()}
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
