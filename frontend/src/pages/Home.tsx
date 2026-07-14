import { useAuth } from "../auth/AuthContext";

export function Home() {
  const { user } = useAuth();

  return (
    <div className="rounded-lg border border-border bg-surface p-8">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">CaxHub</p>
      <h1 className="mt-2 font-display text-2xl font-bold text-foreground">
        Bem-vindo{user ? `, ${user.nome}` : ""}
      </h1>
      <p className="mt-2 text-sm text-muted">Selecione uma opção no menu para começar.</p>
    </div>
  );
}
