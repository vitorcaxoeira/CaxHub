import { cn } from "../../lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} />;
}

/** Linhas de tabela em esqueleto (uma barra por coluna), no lugar das linhas reais enquanto a lista carrega. */
export function SkeletonLinhas({ linhas, colunas }: { linhas: number; colunas: number }) {
  return (
    <>
      {Array.from({ length: linhas }).map((_, i) => (
        <tr key={i} className="border-t border-border/60">
          {Array.from({ length: colunas }).map((__, j) => (
            <td key={j} className="px-[7px] py-[10px]">
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
