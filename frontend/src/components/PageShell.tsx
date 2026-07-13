import { ReactNode } from "react";

export function PageShell({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <div className="app">
      <div className={narrow ? "wrap-narrow" : "wrap"}>{children}</div>
    </div>
  );
}
