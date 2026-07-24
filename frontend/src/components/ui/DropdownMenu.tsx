import {
  ButtonHTMLAttributes,
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingList,
  FloatingPortal,
  offset,
  Placement,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListItem,
  useListNavigation,
  useMergeRefs,
  useRole,
  useTypeahead,
} from "@floating-ui/react";
import { cn } from "../../lib/cn";

// Dropdown de contexto único e reutilizável (menu "..." das linhas de qualquer tabela/
// árvore do app) — substitui os popovers antigos posicionados manualmente com
// `createPortal` + `getBoundingClientRect()` + `position: fixed`, que cortavam/ficavam
// cobertos perto da borda da tela ou dentro de container com overflow (ver
// frontend/src/components/cronograma/MenuAcoesNo.tsx antes desta migração).
//
// Uso:
//   <DropdownMenu>
//     <DropdownMenu.Trigger>
//       <button>⋯</button>
//     </DropdownMenu.Trigger>
//     <DropdownMenu.Content>
//       <DropdownMenu.Item onSelect={...}>Renomear</DropdownMenu.Item>
//       <DropdownMenu.Item onSelect={...} destructive>Excluir</DropdownMenu.Item>
//     </DropdownMenu.Content>
//   </DropdownMenu>

interface DropdownMenuContextValue {
  getReferenceProps: ReturnType<typeof useInteractions>["getReferenceProps"];
  getFloatingProps: ReturnType<typeof useInteractions>["getFloatingProps"];
  getItemProps: ReturnType<typeof useInteractions>["getItemProps"];
  setReference: (node: HTMLElement | null) => void;
  setFloating: (node: HTMLElement | null) => void;
  floatingStyles: React.CSSProperties;
  open: boolean;
  setOpen: (open: boolean) => void;
  activeIndex: number | null;
  context: ReturnType<typeof useFloating>["context"];
  elementsRef: React.MutableRefObject<(HTMLElement | null)[]>;
  labelsRef: React.MutableRefObject<(string | null)[]>;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenuContext() {
  const ctx = useContext(DropdownMenuContext);
  if (!ctx) throw new Error("Componentes DropdownMenu.* precisam estar dentro de <DropdownMenu>");
  return ctx;
}

interface DropdownMenuProps {
  children: ReactNode;
  placement?: Placement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DropdownMenu({ children, placement = "bottom-end", open: openControlado, onOpenChange }: DropdownMenuProps) {
  const [openInterno, setOpenInterno] = useState(false);
  const open = openControlado ?? openInterno;
  const setOpen = (proximo: boolean) => {
    setOpenInterno(proximo);
    onOpenChange?.(proximo);
  };

  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const elementsRef = useRef<(HTMLElement | null)[]>([]);
  const labelsRef = useRef<(string | null)[]>([]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip(), shift({ padding: 8 })],
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "menu" });
  const listNavigation = useListNavigation(context, {
    listRef: elementsRef,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
  });
  const typeahead = useTypeahead(context, {
    listRef: labelsRef,
    activeIndex,
    onMatch: open ? setActiveIndex : undefined,
  });

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([click, dismiss, role, listNavigation, typeahead]);

  const value = useMemo<DropdownMenuContextValue>(
    () => ({
      getReferenceProps,
      getFloatingProps,
      getItemProps,
      setReference: refs.setReference,
      setFloating: refs.setFloating,
      floatingStyles,
      open,
      setOpen,
      activeIndex,
      context,
      elementsRef,
      labelsRef,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, activeIndex, floatingStyles]
  );

  return <DropdownMenuContext.Provider value={value}>{children}</DropdownMenuContext.Provider>;
}

interface TriggerProps {
  children: ReactNode;
  asChild?: boolean;
}

// `asChild` (padrão): clona o filho único (ex.: o botão "⋯" já estilizado pelo chamador)
// em vez de embrulhar num elemento extra — evita `<button><button>...` aninhado.
DropdownMenu.Trigger = function Trigger({ children, asChild = true }: TriggerProps) {
  const { setReference, getReferenceProps, open } = useDropdownMenuContext();

  if (asChild && isValidElement(children)) {
    const child = children as React.ReactElement<any>;
    return cloneElement(
      child,
      getReferenceProps({
        ref: setReference,
        "aria-expanded": open,
        onClick: (e: React.MouseEvent) => {
          child.props.onClick?.(e);
        },
      })
    );
  }

  return (
    <button type="button" ref={setReference} {...getReferenceProps()} aria-expanded={open}>
      {children}
    </button>
  );
};

interface ContentProps {
  children: ReactNode;
  className?: string;
}

DropdownMenu.Content = function Content({ children, className }: ContentProps) {
  const { open, setFloating, floatingStyles, getFloatingProps, context, elementsRef, labelsRef } = useDropdownMenuContext();

  if (!open) return null;

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
        <div
          ref={setFloating}
          style={floatingStyles}
          className={cn("z-popover w-56 rounded-md border border-border bg-surface p-1 text-sm shadow-lg outline-none", className)}
          {...getFloatingProps({
            // Portal escapa da árvore DOM, mas eventos sintéticos do React ainda sobem
            // pela árvore de COMPONENTES — sem isso, clicar num item propagaria pro
            // onClick da linha por trás (abriria o drawer/selecionaria o nó junto com a
            // ação do menu). Vem depois no objeto (getFloatingProps mescla handlers em
            // vez de sobrescrever — cada hook de interação chama o anterior antes do seu
            // próprio comportamento), então roda sempre.
            onClick: (e) => e.stopPropagation(),
          })}
        >
          <FloatingList elementsRef={elementsRef} labelsRef={labelsRef}>
            {children}
          </FloatingList>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
};

interface ItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> {
  children: ReactNode;
  onSelect?: () => void;
  destructive?: boolean;
  // false pra itens que só trocam o conteúdo do MESMO painel (ex.: "Mover para…" abrindo
  // a sub-lista de destinos) em vez de executar uma ação e fechar o menu.
  closeOnSelect?: boolean;
}

DropdownMenu.Item = forwardRef<HTMLButtonElement, ItemProps>(function Item(
  { children, onSelect, destructive, closeOnSelect = true, className, disabled, ...rest },
  propRef
) {
  const { activeIndex, getItemProps, setOpen } = useDropdownMenuContext();
  const { ref: listItemRef, index } = useListItem({ label: typeof children === "string" ? children : undefined });
  const mergedRef = useMergeRefs([listItemRef, propRef]);
  const isActive = activeIndex === index;

  return (
    <button
      type="button"
      ref={mergedRef}
      role="menuitem"
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      className={cn(
        "block w-full rounded px-2.5 py-1.5 text-left outline-none",
        destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-surface-2",
        isActive && (destructive ? "bg-destructive/10" : "bg-surface-2"),
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
        className
      )}
      {...getItemProps({
        ...rest,
        onClick(e) {
          rest.onClick?.(e as React.MouseEvent<HTMLButtonElement>);
          onSelect?.();
          if (closeOnSelect) setOpen(false);
        },
      })}
    >
      {children}
    </button>
  );
});

DropdownMenu.Separator = function Separator() {
  return <div className="my-1 border-t border-border" role="separator" />;
};

// Usado quando um item do menu precisa trocar o conteúdo do MESMO painel por um
// submenu simples (ex.: "Mover para…" — lista de destinos dentro do próprio popover,
// sem abrir um novo <DropdownMenu> aninhado) — só um wrapper com o mesmo espaçamento
// do conteúdo padrão, pra manter a largura/posição consistentes entre os dois estados.
DropdownMenu.Panel = function Panel({ children }: { children: ReactNode }) {
  return <div className="p-1">{children}</div>;
};

export { useDropdownMenuContext };
